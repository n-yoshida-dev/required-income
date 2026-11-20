/**
 * 要る世帯年収と埋め方の換算。期待値は金額を直書きせず、「答えの収入を税の計算に通すと要る手取りに届き、
 * 1 刻み下げると届かない」「総当たりの最小と一致する」の形で固定する（税の表が変わっても壊れない）。
 */

import { describe, expect, it } from 'vitest'
import {
  householdTaxAt,
  incomeConversions,
  requiredHouseholdGross,
  searchMinimalUnits,
  topEarner,
} from '../../../src/domain/plan/requiredIncome'
import { expectedLevels, householdTaxInput } from '../../../src/domain/plan/taxBridge'
import type { IncomeLevels, LifePlan, SolveContext } from '../../../src/domain/plan/types'
import { DEFAULT_REQUIRED_GROSS_OPTIONS } from '../../../src/domain/tax/requiredGross'
import { adult, defaults, makePlan, tables } from './planFixtures'

const STEP = DEFAULT_REQUIRED_GROSS_OPTIONS.step

/** 計画とある年から、換算の材料を作る */
const contextOf = (plan: LifePlan, year: number): SolveContext => ({
  plan,
  year,
  expected: expectedLevels(plan, year),
  taxInput: householdTaxInput(plan, defaults.taxBridge),
  settings: defaults.taxBridge,
  sideMonthlyStep: defaults.search.sideMonthlyStep.value,
  tables,
})

/** 1 人の水準を差し替えたときの世帯の手取り */
const netWith = (
  ctx: SolveContext,
  personId: string,
  patch: { main?: number; sideMonthly?: number },
): number => {
  const levels: IncomeLevels = new Map(ctx.expected)
  const current = ctx.expected.get(personId)
  if (current === undefined) throw new Error(personId)
  ;(levels as Map<string, { main: number; sideMonthly: number }>).set(personId, {
    ...current,
    ...patch,
  })
  return householdTaxAt(ctx, levels).netIncome
}

const couple = makePlan({
  adults: [
    adult({ annualIncome: 4800000 }),
    adult({ id: 'adult-2', birthYear: 1981, annualIncome: 2900000 }),
  ],
})

describe('searchMinimalUnits', () => {
  it('右上がりなら、満たす最小の刻み数', () => {
    expect(searchMinimalUnits((k) => k >= 37, 1000, 10)).toBe(37)
    expect(searchMinimalUnits((k) => k >= 0, 1000, 10)).toBe(0)
    expect(searchMinimalUnits((k) => k >= 1000, 1000, 10)).toBe(1000)
  })

  it('上限でも満たさなければ null', () => {
    expect(searchMinimalUnits(() => false, 1000, 10)).toBeNull()
  })

  it('段差の手前にある小さい解を、総当たりの幅の中なら拾う', () => {
    // 40〜44 で満たし、45〜49 で一度満たさなくなり、50 から満たす（等級の段差の形）
    const meets = (k: number) => (k >= 40 && k < 45) || k >= 50
    expect(searchMinimalUnits(meets, 1000, 20)).toBe(40)
    // 総当たりの幅が足りなければ拾えない（幅の意味の確認）
    const found = searchMinimalUnits(meets, 1000, 0)
    expect(found === 40 || found === 50).toBe(true)
  })

  it('上限・幅が負や小数なら契約違反', () => {
    expect(() => searchMinimalUnits(() => true, -1, 0)).toThrow(RangeError)
    expect(() => searchMinimalUnits(() => true, 10, 1.5)).toThrow(RangeError)
  })
})

describe('topEarner', () => {
  it('本業を動かせる大人のうち見込みがいちばん大きい人。同じなら先の人', () => {
    expect(topEarner(contextOf(couple, 2031))?.id).toBe('adult-1')
    const same = makePlan({ adults: [adult(), adult({ id: 'adult-2' })] })
    expect(topEarner(contextOf(same, 2031))?.id).toBe('adult-1')
  })

  it('働いていない・退職した大人は動かせない', () => {
    const plan = makePlan({
      adults: [adult({ workStyle: 'notWorking' }), adult({ id: 'adult-2', birthYear: 1990 })],
    })
    expect(topEarner(contextOf(plan, 2031))?.id).toBe('adult-2')
    // 1979 年生まれは 2044 年に、1981 年生まれは 2046 年に退職する
    expect(topEarner(contextOf(couple, 2045))?.id).toBe('adult-2')
    expect(topEarner(contextOf(couple, 2046))).toBeNull()
  })
})

describe('requiredHouseholdGross（解いた年収を税の計算に通すと要る手取りに届く）', () => {
  it('会社員の共働き：いちばん稼ぐ大人の額面を動かし、もう 1 人は見込みのまま', () => {
    const ctx = contextOf(couple, 2033)
    const target = 6400000
    const result = requiredHouseholdGross(ctx, target)
    if (result === null) throw new Error('解けるはず')
    expect(result.mover?.personId).toBe('adult-1')
    expect(result.gross).toBe((result.mover?.main ?? 0) + 2900000)
    expect(result.taxYear.netIncome).toBeGreaterThanOrEqual(target)
    expect(netWith(ctx, 'adult-1', { main: (result.mover?.main ?? 0) - STEP })).toBeLessThan(target)
  })

  it('自営業：所得を動かす（国保・国民年金の世帯でも届く）', () => {
    const plan = makePlan({ adults: [adult({ workStyle: 'selfEmployed', annualIncome: 3900000 })] })
    const ctx = contextOf(plan, 2033)
    const target = 4100000
    const result = requiredHouseholdGross(ctx, target)
    if (result === null) throw new Error('解けるはず')
    expect(result.taxYear.netIncome).toBeGreaterThanOrEqual(target)
    expect(netWith(ctx, 'adult-1', { main: result.gross - STEP })).toBeLessThan(target)
    // 料率の無い自治体（ダミー）なので、国保は概算になる
    expect(result.taxYear.nationalHealthInsurance?.approximated).toBe(true)
  })

  it('手取りが額面で下がる段差（社会保険の等級）があっても、総当たりの最小と一致する', () => {
    const plan = makePlan()
    const ctx = contextOf(plan, 2033)
    const net = (main: number) => netWith(ctx, 'adult-1', { main })
    // 300 万〜900 万で、1 刻み上げると手取りが下がる所を探す
    let dip: number | null = null
    for (let main = 3000000; main < 9000000 && dip === null; main += STEP) {
      if (net(main + STEP) < net(main)) dip = main
    }
    if (dip === null) throw new Error('段差が見つからない')
    const target = net(dip)
    // 総当たりの最小
    let brute = 0
    while (net(brute) < target) brute += STEP
    const result = requiredHouseholdGross(ctx, target)
    expect(result?.gross).toBe(brute)
    expect(brute).toBeLessThanOrEqual(dip)
  })

  it('上限（1 億円）まで上げても届かなければ null', () => {
    expect(requiredHouseholdGross(contextOf(couple, 2033), 900000000)).toBeNull()
  })

  it('動かせる大人がいないときは、見込みのままで届けばその世帯年収、届かなければ null', () => {
    const plan = makePlan({
      adults: [adult({ workStyle: 'notWorking', sideMonthlyProfit: 41000 })],
    })
    const ctx = contextOf(plan, 2033)
    const net = householdTaxAt(ctx, ctx.expected).netIncome
    expect(requiredHouseholdGross(ctx, net)).toMatchObject({ gross: 41000 * 12, mover: null })
    expect(requiredHouseholdGross(ctx, net + 1)).toBeNull()
  })
})

describe('incomeConversions（埋め方の換算）', () => {
  const ctx = contextOf(couple, 2033)
  const expectedNet = householdTaxAt(ctx, ctx.expected).netIncome
  const target = expectedNet + 1300000

  it('本業・副業・もう 1 人の、どれも今から上げて届く最小の額', () => {
    const required = requiredHouseholdGross(ctx, target)
    const set = incomeConversions(ctx, target, required)

    expect(set.mainJob).toMatchObject({ personId: 'adult-1', current: 4800000 })
    expect(set.mainJob?.required).toBe(required?.mover?.main)
    expect(set.mainJob?.increase).toBe((set.mainJob?.required ?? 0) - 4800000)

    const side = set.sideJob
    if (side === null) throw new Error('副業で届くはず')
    expect(side).toMatchObject({ personId: 'adult-1', current: 0 })
    expect(netWith(ctx, 'adult-1', { sideMonthly: side.required })).toBeGreaterThanOrEqual(target)
    expect(
      netWith(ctx, 'adult-1', {
        sideMonthly: side.required - defaults.search.sideMonthlyStep.value,
      }),
    ).toBeLessThan(target)

    const other = set.otherAdult
    if (other === null) throw new Error('もう 1 人で届くはず')
    expect(other).toMatchObject({ personId: 'adult-2', current: 2900000 })
    expect(other.increase % STEP).toBe(0)
    expect(netWith(ctx, 'adult-2', { main: other.required })).toBeGreaterThanOrEqual(target)
    expect(netWith(ctx, 'adult-2', { main: other.required - STEP })).toBeLessThan(target)
  })

  it('要る世帯年収の答えが今の見込みを下回るときは、本業を今から上へ探し直す', () => {
    // 答えを今より低くした偽物を渡しても、本業の換算は今以上になる
    const fake = requiredHouseholdGross(ctx, target)
    if (fake === null) throw new Error('解けるはず')
    const lowered = { ...fake, mover: { personId: 'adult-1', main: 1000000 } }
    const set = incomeConversions(ctx, target, lowered)
    expect(set.mainJob?.required).toBe(fake.mover?.main)
  })

  it('もう 1 人が働いていない・大人が 1 人なら、もう 1 人の換算は null', () => {
    const single = contextOf(makePlan(), 2033)
    const singleTarget = householdTaxAt(single, single.expected).netIncome + 500000
    expect(incomeConversions(single, singleTarget, null).otherAdult).toBeNull()

    const plan = makePlan({
      adults: [adult(), adult({ id: 'adult-2', workStyle: 'notWorking', annualIncome: 0 })],
    })
    const withHomemaker = contextOf(plan, 2033)
    const t = householdTaxAt(withHomemaker, withHomemaker.expected).netIncome + 500000
    expect(incomeConversions(withHomemaker, t, null).otherAdult).toBeNull()
  })

  it('動かせる大人がいなければ、どれも null', () => {
    const plan = makePlan({ adults: [adult({ workStyle: 'notWorking' })] })
    expect(incomeConversions(contextOf(plan, 2033), 1, null)).toEqual({
      mainJob: null,
      sideJob: null,
      otherAdult: null,
    })
  })
})

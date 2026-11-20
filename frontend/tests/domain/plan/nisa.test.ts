/**
 * NISA の上限の知らせ（`domain/plan/nisa.ts`）のテスト。
 * 上限の値は data/benefit/nisa.json の裏取り済みの値（`tables.nisa`）。積む元本の並びと生まれ年は架空。
 */

import { describe, expect, it } from 'vitest'
import {
  childNisaBreaches,
  householdNisaBreaches,
  principalByYear,
} from '../../../src/domain/plan/nisa'
import { evaluate } from '../../../src/domain/plan/evaluate'
import type { FundPlan, Goal, Notice } from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { adult, defaults, makePlan, tables } from './planFixtures'

const limits = tables.nisa
const MINOR_ANNUAL = limits.minor.annual
const MINOR_LIFETIME = limits.minor.lifetime
const ADULT_ANNUAL = limits.adult.annualTsumitate + limits.adult.annualGrowth
const ADULT_LIFETIME = limits.adult.lifetime

/** 年 → 元本の並びを Map にする */
const principal = (entries: [number, number][]) => new Map(entries)

/** from から n 年、毎年 amount を積む並び */
const yearsOf = (from: number, count: number, amount: number): [number, number][] =>
  Array.from({ length: count }, (_, k) => [from + k, amount])

describe('上限の値（前提）', () => {
  it('未成年者は年 60 万・生涯 600 万（2027 年から）、大人は年 120 万 ＋ 240 万・生涯 1,800 万', () => {
    expect([MINOR_ANNUAL, MINOR_LIFETIME, limits.minor.fromYear]).toEqual([600000, 6000000, 2027])
    expect([ADULT_ANNUAL, ADULT_LIFETIME, limits.adult.fromYear]).toEqual([3600000, 18000000, 2024])
  })
})

describe('childNisaBreaches（子の名義の NISA・大学資金）', () => {
  const BIRTH = 2020

  it('年の上限：ちょうど 600,000 は超えない、600,001 は超える', () => {
    expect(childNisaBreaches(principal([[2028, MINOR_ANNUAL]]), BIRTH, limits)).toEqual([])
    expect(childNisaBreaches(principal([[2028, MINOR_ANNUAL + 1]]), BIRTH, limits)).toEqual([
      {
        account: 'minor',
        limit: 'annual',
        year: 2028,
        amount: MINOR_ANNUAL + 1,
        cap: MINOR_ANNUAL,
        holders: 1,
      },
    ])
  })

  it('生涯の上限：累計ちょうど 6,000,000 は超えない、1 円足すとその年に超える', () => {
    const tenYears = yearsOf(2027, 10, MINOR_ANNUAL)
    expect(childNisaBreaches(principal(tenYears), BIRTH, limits)).toEqual([])
    expect(childNisaBreaches(principal([...tenYears, [2037, 1]]), BIRTH, limits)).toEqual([
      {
        account: 'minor',
        limit: 'lifetime',
        year: 2037,
        amount: MINOR_LIFETIME + 1,
        cap: MINOR_LIFETIME,
        holders: 1,
      },
    ])
  })

  it('2027 年より前は判定せず、生涯の累計にも入れない（口座が無い）', () => {
    const early = principal([[2025, 900000], [2026, 900000], ...yearsOf(2027, 10, MINOR_ANNUAL)])
    expect(childNisaBreaches(early, BIRTH, limits)).toEqual([])
  })

  it('生まれる前の年は判定しない。生まれた年は未成年者の枠で数える', () => {
    expect(childNisaBreaches(principal([[2029, 900000]]), 2030, limits)).toEqual([])
    expect(childNisaBreaches(principal([[2030, 900000]]), 2030, limits)).toMatchObject([
      { account: 'minor', limit: 'annual', year: 2030 },
    ])
  })

  it('1 月 1 日に 18 歳の年（生まれ年 ＋ 19）からは大人の枠（年 360 万）と比べ、生涯は数えない', () => {
    const birth = 2015
    // 2033 年：1 月 1 日に 17 歳 → まだ未成年者の枠
    expect(childNisaBreaches(principal([[2033, MINOR_ANNUAL + 1]]), birth, limits)).toMatchObject([
      { account: 'minor', limit: 'annual', year: 2033 },
    ])
    // 2034 年：1 月 1 日に 18 歳 → 大人の枠。ちょうど 3,600,000 は超えない、1 円足すと超える
    expect(childNisaBreaches(principal([[2034, ADULT_ANNUAL]]), birth, limits)).toEqual([])
    expect(childNisaBreaches(principal([[2034, ADULT_ANNUAL + 1]]), birth, limits)).toEqual([
      {
        account: 'adult',
        limit: 'annual',
        year: 2034,
        amount: ADULT_ANNUAL + 1,
        cap: ADULT_ANNUAL,
        holders: 1,
      },
    ])
    // 大人の年の元本は未成年者の生涯の累計に入れない（2027〜2033 年で 420 万 ＋ 2034 年 300 万でも超えない）
    const mixed = principal([...yearsOf(2027, 7, MINOR_ANNUAL), [2034, 3000000]])
    expect(childNisaBreaches(mixed, birth, limits)).toEqual([])
  })

  it('年の上限は口座の種類ごとに最初の 1 件：未成年者の枠で超えても、18 歳からの枠の年の超えも出す', () => {
    const birth = 2015
    // 2032 年は 1 月 1 日に 16 歳（未成年者の枠）、2034 年は 18 歳（18 歳からの枠）
    const found = childNisaBreaches(
      principal([
        [2032, MINOR_ANNUAL + 1],
        [2034, ADULT_ANNUAL + 1],
      ]),
      birth,
      limits,
    )
    expect(found.map((b) => [b.account, b.limit, b.year])).toEqual([
      ['minor', 'annual', 2032],
      ['adult', 'annual', 2034],
    ])
  })

  it('年・生涯それぞれ、最初に超えた年だけを出す（Map の順によらず年の昇順で見る）', () => {
    const many = principal([[2036, 800000], [2032, 700000], ...yearsOf(2037, 8, MINOR_ANNUAL)])
    // 2030 年生まれ（2044 年の 1 月 1 日でも 13 歳。すべて未成年者の枠）
    const found = childNisaBreaches(many, 2030, limits)
    expect(found.filter((b) => b.limit === 'annual').map((b) => b.year)).toEqual([2032])
    // 累計：2032 年 70 万、2036 年 150 万、2037〜2044 年に 60 万ずつ → 2044 年に 630 万で超える
    expect(found.filter((b) => b.limit === 'lifetime')).toEqual([
      {
        account: 'minor',
        limit: 'lifetime',
        year: 2044,
        amount: 6300000,
        cap: MINOR_LIFETIME,
        holders: 1,
      },
    ])
  })
})

describe('householdNisaBreaches（世帯の NISA・老後資金）', () => {
  const COUPLE = [1985, 1988]

  it('大人 2 人：年の上限は 7,200,000（ちょうどは超えない）、超えれば holders 2', () => {
    expect(householdNisaBreaches(principal([[2032, ADULT_ANNUAL * 2]]), COUPLE, limits)).toEqual([])
    expect(
      householdNisaBreaches(principal([[2032, ADULT_ANNUAL * 2 + 1]]), COUPLE, limits),
    ).toEqual([
      {
        account: 'adult',
        limit: 'annual',
        year: 2032,
        amount: 7200001,
        cap: 7200000,
        holders: 2,
      },
    ])
  })

  it('大人 2 人：生涯の上限は 36,000,000（ちょうどは超えない、1 円足すとその年に超える）', () => {
    const five = yearsOf(2031, 5, ADULT_ANNUAL * 2)
    expect(householdNisaBreaches(principal(five), COUPLE, limits)).toEqual([])
    expect(householdNisaBreaches(principal([...five, [2036, 1]]), COUPLE, limits)).toEqual([
      {
        account: 'adult',
        limit: 'lifetime',
        year: 2036,
        amount: 36000001,
        cap: 36000000,
        holders: 2,
      },
    ])
  })

  it('1 月 1 日に 18 歳未満の大人は数えない（その年は 1 人ぶんの上限）', () => {
    // 2015 年生まれは 2033 年の 1 月 1 日に 17 歳、2034 年に 18 歳
    const birthYears = [1985, 2015]
    expect(
      householdNisaBreaches(principal([[2033, ADULT_ANNUAL + 1]]), birthYears, limits),
    ).toMatchObject([{ year: 2033, cap: ADULT_ANNUAL, holders: 1 }])
    expect(
      householdNisaBreaches(principal([[2034, ADULT_ANNUAL + 1]]), birthYears, limits),
    ).toEqual([])
  })

  it('NISA の始まる 2024 年より前の年と、口座を持てる大人がいない年は判定しない', () => {
    expect(householdNisaBreaches(principal([[2023, 99000000]]), COUPLE, limits)).toEqual([])
    expect(householdNisaBreaches(principal([[2030, 99000000]]), [2020], limits)).toEqual([])
  })
})

describe('principalByYear（暦年ごとの元本）', () => {
  it('家計の月額と児童手当の月額を、月の属する暦年に足す', () => {
    const plan: FundPlan = {
      goalId: 'g',
      from: yearMonth(2031, 11),
      useMonth: yearMonth(2033, 3),
      monthlyRate: 0,
      householdMonthly: 5000,
      allowanceMonthly: [10000, 10000, 15000],
      reached: { saved: 0, allowance: 0, household: 0, total: 0 },
    }
    // 2031 年：11・12 月 → 5,000 × 2 ＋ 10,000 × 2 = 30,000
    // 2032 年：12 か月 → 5,000 × 12 ＋ 15,000（1 月の児童手当）= 75,000
    // 2033 年：1・2 月 → 5,000 × 2 = 10,000
    expect([...principalByYear(plan)]).toEqual([
      [2031, 30000],
      [2032, 75000],
      [2033, 10000],
    ])
  })
})

describe('fundNotices（evaluate の知らせ）', () => {
  /** NISA の上限の知らせだけ */
  const nisaNotices = (goals: Goal[], overrides = {}) =>
    evaluate(makePlan({ goals, ...overrides }), tables, defaults).notices.filter(
      (n): n is Extract<Notice, { kind: 'nisaLimit' }> => n.kind === 'nisaLimit',
    )

  /** 3 年で 5,000 万円の老後資金（大人 1 人の上限を超える）。金額は架空 */
  const bigRetirement = (vehicle: 'nisa' | 'deposit'): Goal => ({
    id: 'goal-big',
    enabled: true,
    kind: 'retirement',
    targetAmount: 50000000,
    byYear: 2034,
    vehicle,
    saved: 0,
  })

  it('老後資金（NISA）：年の上限を超える年と、生涯の上限を超える年を知らせる', () => {
    const found = nisaNotices([bigRetirement('nisa')])
    const annual = found.find((n) => n.limit === 'annual')
    // 起点 2031-01 → 2034-01 の 36 か月。月額 × 12 が 2031 年の元本
    expect(annual).toMatchObject({
      goalId: 'goal-big',
      account: 'adult',
      year: 2031,
      cap: ADULT_ANNUAL,
      holders: 1,
    })
    expect(annual?.amount).toBeGreaterThan(ADULT_ANNUAL)
    expect(found.find((n) => n.limit === 'lifetime')).toMatchObject({
      year: 2032,
      cap: ADULT_LIFETIME,
    })
    // 大人が 2 人なら上限も 2 人ぶん
    const couple = nisaNotices([bigRetirement('nisa')], {
      adults: [adult(), adult({ id: 'adult-2', birthYear: 1981 })],
    })
    expect(couple.find((n) => n.limit === 'annual')).toMatchObject({
      cap: ADULT_ANNUAL * 2,
      holders: 2,
    })
  })

  it('預金なら NISA の上限は知らせない。オフのカードも知らせない', () => {
    expect(nisaNotices([bigRetirement('deposit')])).toEqual([])
    expect(nisaNotices([{ ...bigRetirement('nisa'), enabled: false }])).toEqual([])
  })

  it('大学資金（子の名義の NISA）：児童手当から回す分も元本に入れて、未成年者の枠と比べる', () => {
    const university: Goal = {
      id: 'goal-uni',
      enabled: true,
      kind: 'university',
      childId: 'child-a',
      targetAmount: 9000000,
      allocateChildAllowance: true,
      vehicle: 'childNisa',
      saved: 0,
    }
    // 2030 年 9 月生まれ：起点 2037-01 から 2049-04 まで（147 か月）。家計から月数万円を積むので、児童手当と合わせて年 60 万円を超える
    // 大人は 1985 年生まれ・65 歳で退職（2050 年）なので、積立は使う月まで切れない
    const overrides = {
      baseYearMonth: yearMonth(2037, 1),
      adults: [adult({ birthYear: 1985 })],
      children: [{ id: 'child-a', birthYear: 2030, birthMonth: 9 as const }],
    }
    const found = nisaNotices([university], overrides)
    expect(found.find((n) => n.limit === 'annual')).toMatchObject({
      goalId: 'goal-uni',
      account: 'minor',
      year: 2037,
      cap: MINOR_ANNUAL,
      holders: 1,
    })
    // 預金なら知らせない
    expect(nisaNotices([{ ...university, vehicle: 'deposit' }], overrides)).toEqual([])
  })
})

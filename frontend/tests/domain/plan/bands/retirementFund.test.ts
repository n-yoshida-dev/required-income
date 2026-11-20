/**
 * 老後資金のカード → 帯（`bands/retirementFund.ts`）のテスト。
 * 積立の月額を閉じた式（年金終価係数）で手計算して突き合わせる。金額は架空。
 */

import { describe, expect, it } from 'vitest'
import { bandContext, expandGoal, fundPlanOf } from '../../../../src/domain/plan/bands/index'
import {
  retirementBands,
  retirementFundPlan,
  retirementUseMonth,
} from '../../../../src/domain/plan/bands/retirementFund'
import { evaluate } from '../../../../src/domain/plan/evaluate'
import type { LifePlan, RetirementGoal } from '../../../../src/domain/plan/types'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'
import { defaults, makePlan, tables } from '../planFixtures'

// 架空の計画：起点 2031-01（makePlan の既定）、1979 年生まれ・65 歳で退職 → 「ずっと」の終わりは 2044-01。前提の利回りは 3%
const BASE = yearMonth(2031, 1)

/** 老後資金のカード（既定：2050 年の前年末までに 2,000 万円・NISA・貯まっている額 0） */
const card = (overrides: Partial<RetirementGoal> = {}): RetirementGoal => ({
  id: 'goal-retire',
  enabled: true,
  kind: 'retirement',
  targetAmount: 20000000,
  byYear: 2050,
  vehicle: 'nisa',
  saved: 0,
  ...overrides,
})

const contextOf = (overrides: Partial<LifePlan> = {}) =>
  bandContext(makePlan(overrides), defaults, tables)

/** 月の利率（年 3%） */
const I = Math.pow(1.03, 1 / 12) - 1
/** 毎月末に 1 を n か月積んだ到達額 */
const S = (n: number) => (Math.pow(1 + I, n) - 1) / I

describe('老後資金の積立の帯', () => {
  it('起点から byYear の 1 月の前まで（2031-01 → 2050-01 の 228 か月）。「ずっと」の終わり（2044-01）で切り詰めない', () => {
    expect(retirementUseMonth({ byYear: 2050 })).toEqual(yearMonth(2050, 1))
    const plan = retirementFundPlan(card(), contextOf())
    expect(plan?.from).toEqual(BASE)
    expect(plan?.useMonth).toEqual(yearMonth(2050, 1))
    expect(retirementBands(card(), contextOf())).toEqual([
      {
        goalId: 'goal-retire',
        label: '老後資金の積立',
        kind: 'saving',
        monthly: plan?.householdMonthly,
        from: BASE,
        to: yearMonth(2050, 1),
      },
    ])
    expect(contextOf().until).toEqual(yearMonth(2044, 1))
  })

  it('NISA：月額 ＝ ⌈(目標額 − 貯まっている額 × (1 + i)^228) ÷ S(228)⌉。到達額は内訳の和', () => {
    const goal = card({ saved: 1270000 })
    const plan = retirementFundPlan(goal, contextOf())
    if (plan === null) throw new Error('積立の答えが出ない')
    const savedFv = 1270000 * Math.pow(1 + I, 228)
    const raw = (20000000 - savedFv) / S(228)
    expect(plan.monthlyRate).toBeCloseTo(I, 15)
    expect(plan.householdMonthly).toBe(Math.ceil(raw))
    expect(plan.reached.saved).toBe(Math.round(savedFv))
    expect(plan.reached.household).toBe(Math.round(plan.householdMonthly * S(228)))
    expect(plan.reached.allowance).toBe(0)
    expect(plan.reached.total).toBe(plan.reached.saved + plan.reached.household)
    expect(plan.reached.total).toBeGreaterThanOrEqual(20000000)
    // 1 円少ないと届かない
    expect(savedFv + (plan.householdMonthly - 1) * S(228)).toBeLessThan(20000000)
    expect(plan.allowanceMonthly).toEqual([])
  })

  it('前提の利回りが 0 なら単純な割り算：(20,000,000 − 1,270,000) ÷ 228 = 82,149.1… → 82,150', () => {
    const plan = retirementFundPlan(
      card({ saved: 1270000 }),
      contextOf({ assumptions: { investmentReturnRate: 0, inflationRate: 0, mortgageRate: 0.01 } }),
    )
    expect(plan?.monthlyRate).toBe(0)
    expect(plan?.householdMonthly).toBe(82150)
    expect(plan?.reached.saved).toBe(1270000)
  })

  it('預金なら前提の利回りがあっても利率 0', () => {
    const plan = retirementFundPlan(card({ vehicle: 'deposit', saved: 1270000 }), contextOf())
    expect(plan?.monthlyRate).toBe(0)
    expect(plan?.householdMonthly).toBe(82150)
  })

  it('貯まっている額で届いていれば 0 円の帯（足りていることが読める）', () => {
    const deposit = card({ vehicle: 'deposit', saved: 20000000 })
    expect(retirementBands(deposit, contextOf()).map((b) => [b.monthly, b.from, b.to])).toEqual([
      [0, BASE, yearMonth(2050, 1)],
    ])
    // NISA なら育つので、もっと少なくても届く：11,500,000 × 1.03^19 ≒ 2,013 万円
    const nisa = card({ saved: 11500000 })
    expect(retirementFundPlan(nisa, contextOf())?.householdMonthly).toBe(0)
  })

  it('期限の年が起点の年以前なら帯を出さない（2031-01 起点で 2031 年 → 0 か月、2030 年 → 過ぎている）', () => {
    expect(retirementFundPlan(card({ byYear: 2031 }), contextOf())).toBeNull()
    expect(retirementBands(card({ byYear: 2031 }), contextOf())).toEqual([])
    expect(retirementBands(card({ byYear: 2030 }), contextOf())).toEqual([])
  })

  it('起点が 11 月で期限が翌年なら 2 か月だけ積む（2031-11 → 2032-01）', () => {
    const ctx = contextOf({ baseYearMonth: yearMonth(2031, 11) })
    const plan = retirementFundPlan(
      card({ byYear: 2032, vehicle: 'deposit', targetAmount: 640000 }),
      ctx,
    )
    expect(plan?.householdMonthly).toBe(320000)
    expect(
      retirementBands(card({ byYear: 2032, vehicle: 'deposit', targetAmount: 640000 }), ctx),
    ).toEqual([
      {
        goalId: 'goal-retire',
        label: '老後資金の積立',
        kind: 'saving',
        monthly: 320000,
        from: yearMonth(2031, 11),
        to: yearMonth(2032, 1),
      },
    ])
  })

  it('期限が過ぎたオンのカードは、evaluate が fundDeadlinePast を出す。オフなら出さない', () => {
    const notices = (goal: RetirementGoal) =>
      evaluate(makePlan({ goals: [goal] }), tables, defaults).notices.filter(
        (n) => n.kind === 'fundDeadlinePast',
      )
    expect(notices(card({ byYear: 2030 }))).toEqual([
      { kind: 'fundDeadlinePast', goalId: 'goal-retire' },
    ])
    expect(notices(card({ byYear: 2030, enabled: false }))).toEqual([])
    expect(notices(card())).toEqual([])
  })

  it('入口：expandGoal と fundPlanOf は同じ答え。fundPlanOf はオフでも答えを返す', () => {
    const ctx = contextOf()
    const plan = fundPlanOf(card(), ctx)
    expect(expandGoal(card(), ctx)[0]?.monthly).toBe(plan?.householdMonthly)
    expect(fundPlanOf(card({ enabled: false }), ctx)).toEqual(plan)
  })
})

describe('契約違反', () => {
  it('金額が負・整数でない、期限の年が整数でない、置き場が選択肢に無いなら投げる', () => {
    const ctx = contextOf()
    expect(() => retirementBands(card({ targetAmount: -1 }), ctx)).toThrow(RangeError)
    expect(() => retirementBands(card({ saved: 1.5 }), ctx)).toThrow(RangeError)
    expect(() => retirementBands(card({ byYear: 2050.5 }), ctx)).toThrow(RangeError)
    expect(() =>
      retirementBands(card({ vehicle: 'childNisa' as RetirementGoal['vehicle'] }), ctx),
    ).toThrow(RangeError)
  })
})

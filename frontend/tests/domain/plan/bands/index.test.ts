import { describe, expect, it } from 'vitest'
import { appDefaults } from '../../../../src/data/appData'
import {
  bandContext,
  expandGoal,
  expandPlan,
  rentUntil,
} from '../../../../src/domain/plan/bands/index'
import type {
  Adult,
  ChildProfile,
  Goal,
  HomeGoal,
  LifePlan,
  UniversityGoal,
} from '../../../../src/domain/plan/types'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'
import { tables } from '../planFixtures'

const adult = (overrides: Partial<Adult> = {}): Adult => ({
  id: 'adult-1',
  birthYear: 1980,
  workStyle: 'employee',
  annualIncome: 5000000,
  raiseRate: 0,
  outlookSteps: [],
  sideMonthlyProfit: 0,
  retirementAge: 50,
  ...overrides,
})

const custom = (id: string, enabled = true): Goal => ({
  id,
  enabled,
  kind: 'custom',
  name: `カード ${id}`,
  amountType: 'monthly',
  direction: 'expense',
  amount: 10000,
  from: yearMonth(2027, 1),
  to: yearMonth(2028, 1),
})

/** 家のカード（金額はダミー） */
const home = (overrides: Partial<HomeGoal> = {}): HomeGoal => ({
  id: 'goal-home',
  enabled: true,
  kind: 'home',
  saved: 0,
  purchaseYear: 2028,
  price: 30000000,
  downPayment: 3000000,
  loanYears: 35,
  monthlyUpkeep: 20000,
  ...overrides,
})

const plan = (overrides: Partial<LifePlan> = {}): LifePlan => ({
  baseYearMonth: yearMonth(2026, 11),
  adults: [adult()],
  children: [],
  municipality: '99001',
  living: { monthlyLivingCost: 200000, monthlyRent: 85000 },
  goals: [],
  assumptions: { investmentReturnRate: 0.03, inflationRate: 0, mortgageRate: 0.01 },
  ...overrides,
})

/** 家賃の帯 */
const rentOf = (goals: Goal[]) =>
  expandPlan(plan({ goals }), appDefaults, tables).filter((b) => b.label === '家賃')

describe('bandContext', () => {
  it('until は要る手取りを数える最後の年（退職の前年）の翌年 1 月。前提の物価・金利・利回りと、家の諸費用の率・車の下取りの率と金利を持つ', () => {
    // 1980 年生まれ・50 歳で退職 → 退職は 2030 年、最後の年は 2029 年
    expect(bandContext(plan(), appDefaults, tables)).toEqual({
      base: { year: 2026, month: 11 },
      until: { year: 2030, month: 1 },
      children: [],
      tables,
      assumptions: { inflationRate: 0, mortgageRate: 0.01, investmentReturnRate: 0.03 },
      settings: {
        homeClosingCostRate: appDefaults.home.closingCostRate.value,
        carResaleRate: appDefaults.car.resaleRate.value,
        carLoanRate: appDefaults.car.loanRate.value,
      },
      allowanceEarmarked: new Set(),
    })
  })

  it('児童手当を回している子は、オンで「回す」の大学資金のカードの子だけ', () => {
    const children: ChildProfile[] = [
      { id: 'child-a', birthYear: 2030, birthMonth: 7 },
      { id: 'child-b', birthYear: 2032, birthMonth: 2 },
      { id: 'child-c', birthYear: 2033, birthMonth: 10 },
    ]
    const university = (
      id: string,
      childId: string,
      overrides: Partial<UniversityGoal> = {},
    ): UniversityGoal => ({
      id,
      enabled: true,
      kind: 'university',
      childId,
      saved: 0,
      targetAmount: 3800000,
      allocateChildAllowance: true,
      vehicle: 'childNisa',
      ...overrides,
    })
    const ctx = bandContext(
      plan({
        children,
        goals: [
          university('u-a', 'child-a'),
          university('u-b', 'child-b', { enabled: false }),
          university('u-c', 'child-c', { allocateChildAllowance: false }),
        ],
      }),
      appDefaults,
      tables,
    )
    expect(ctx.allowanceEarmarked).toEqual(new Set(['child-a']))
  })

  it('もう退職の年を過ぎていれば until は起点で止める', () => {
    expect(
      bandContext(plan({ adults: [adult({ retirementAge: 40 })] }), appDefaults, tables).until,
    ).toEqual({ year: 2026, month: 11 })
  })
})

describe('expandGoal', () => {
  const ctx = bandContext(plan(), appDefaults, tables)

  it('オフのカードは帯を出さない', () => {
    expect(expandGoal(custom('goal-a', false), ctx)).toEqual([])
    expect(expandGoal(home({ enabled: false }), ctx)).toEqual([])
  })

  it('家のカードは帯にする（T7）', () => {
    expect(expandGoal(home(), ctx).map((b) => b.label)).toEqual([
      '頭金と諸費用の積立',
      '返済',
      '修繕と税',
    ])
  })

  it('車のカードは帯にする（T8）', () => {
    const car: Goal = {
      id: 'goal-car',
      enabled: true,
      kind: 'car',
      saved: 0,
      purchaseYear: 2028,
      price: 3000000,
      payment: { type: 'cash' },
      monthlyUpkeep: 15000,
      replaceEveryYears: 7,
    }
    expect(expandGoal(car, ctx).map((b) => b.label)).toEqual([
      '車の積立',
      '車の維持費',
      '次の車の積立',
    ])
    expect(expandGoal({ ...car, enabled: false }, ctx)).toEqual([])
  })

  it('老後資金のカードは帯にする（T10）。オフなら出さない', () => {
    const retirement: Goal = {
      id: 'goal-retire',
      enabled: true,
      kind: 'retirement',
      saved: 0,
      targetAmount: 20000000,
      byYear: 2050,
      vehicle: 'nisa',
    }
    expect(expandGoal(retirement, ctx).map((b) => b.label)).toEqual(['老後資金の積立'])
    expect(expandGoal({ ...retirement, enabled: false }, ctx)).toEqual([])
  })
})

describe('expandPlan：大学資金のカード（T10）', () => {
  const university = (id: string, childId: string): Goal => ({
    id,
    enabled: true,
    kind: 'university',
    childId,
    saved: 0,
    targetAmount: 3800000,
    allocateChildAllowance: false,
    vehicle: 'deposit',
  })
  const children: ChildProfile[] = [
    { id: 'child-a', birthYear: 2030, birthMonth: 7 },
    { id: 'child-b', birthYear: 2032, birthMonth: 2 },
  ]

  it('子ごとに 1 枚なら帯にする', () => {
    const bands = expandPlan(
      plan({ children, goals: [university('u-a', 'child-a'), university('u-b', 'child-b')] }),
      appDefaults,
      tables,
    )
    expect(bands.filter((b) => b.kind === 'saving').map((b) => `${b.goalId}:${b.label}`)).toEqual([
      'u-a:大学資金の積立（1人目）',
      'u-b:大学資金の積立（2人目）',
    ])
  })

  it('同じ子に大学資金のカードが 2 枚あれば契約違反（児童手当を二重に回す）', () => {
    expect(() =>
      expandPlan(
        plan({ children, goals: [university('u-a', 'child-a'), university('u-a2', 'child-a')] }),
        appDefaults,
        tables,
      ),
    ).toThrow(RangeError)
    expect(() =>
      expandPlan(
        plan({ children, goals: [university('u-a', 'child-a'), university('u-a2', 'child-a')] }),
        appDefaults,
        tables,
      ),
    ).toThrow(/大学資金のカードが 2 枚/)
  })
})

describe('expandPlan', () => {
  it('暮らし → カードの順に帯を並べ、オフのカードは飛ばす', () => {
    const bands = expandPlan(
      plan({ goals: [custom('goal-a'), custom('goal-b', false), custom('goal-c')] }),
      appDefaults,
      tables,
    )
    expect(bands.map((b) => `${b.goalId}:${b.label}`)).toEqual([
      'living:生活費',
      'living:家賃',
      'goal-a:カード goal-a',
      'goal-c:カード goal-c',
    ])
  })

  it('カードの id が重なる・living と同じなら契約違反', () => {
    expect(() =>
      expandPlan(plan({ goals: [custom('goal-a'), custom('goal-a')] }), appDefaults, tables),
    ).toThrow(/重なって/)
    expect(() => expandPlan(plan({ goals: [custom('living')] }), appDefaults, tables)).toThrow(
      /重なって/,
    )
  })
})

describe('家を買うと家賃が終わる（SPEC §3.2 の暮らし）', () => {
  it('完了条件：家賃の帯は買う月（買う年の 1 月）の前で終わり、同じ月から返済が始まる', () => {
    const bands = expandPlan(plan({ goals: [home({ purchaseYear: 2028 })] }), appDefaults, tables)
    const rent = bands.find((b) => b.label === '家賃')
    const repayment = bands.find((b) => b.label === '返済')
    expect(rent?.to).toEqual({ year: 2028, month: 1 })
    expect(repayment?.from).toEqual({ year: 2028, month: 1 })
  })

  it('家のカードが無い・オフなら、家賃はずっと（until の前まで）続く', () => {
    expect(rentOf([])[0]?.to).toEqual({ year: 2030, month: 1 })
    expect(rentOf([home({ enabled: false })])[0]?.to).toEqual({ year: 2030, month: 1 })
  })

  it('家のカードをオフにすると家賃が戻る（オン → オフで、家賃の終わりが until に戻る）', () => {
    expect(rentOf([home()])[0]?.to).toEqual({ year: 2028, month: 1 })
    expect(rentOf([home({ enabled: false })])[0]?.to).toEqual({ year: 2030, month: 1 })
  })

  it('家のカードが 2 枚なら、オンのうちいちばん早い買う月で家賃が終わる', () => {
    const early = home({ id: 'home-early', purchaseYear: 2027 })
    const late = home({ id: 'home-late', purchaseYear: 2029 })
    expect(rentOf([late, early])[0]?.to).toEqual({ year: 2027, month: 1 })
    expect(rentOf([late, { ...early, enabled: false }])[0]?.to).toEqual({ year: 2029, month: 1 })
  })

  it('買う月が「ずっと」の終わりより後なら、家賃はそこで止める（帯の終わりを延ばさない）', () => {
    expect(rentUntil([home({ purchaseYear: 2040 })], { until: yearMonth(2030, 1) })).toEqual({
      year: 2030,
      month: 1,
    })
  })

  it('もう買った（買う年が起点の年より前）なら、家賃の帯は出ない', () => {
    expect(rentOf([home({ purchaseYear: 2020 })])).toEqual([])
  })
})

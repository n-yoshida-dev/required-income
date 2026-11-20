import { describe, expect, it } from 'vitest'
import { appDefaults } from '../../../src/data/appData'
import type { CarGoal, Goal, HomeGoal, LifePlan } from '../../../src/domain/plan/types'
import { goalSummaries } from '../../../src/features/home/goalSummary'

/** 起点は 2026-11 */
const plan = (goals: Goal[]): Pick<LifePlan, 'baseYearMonth' | 'children' | 'goals'> => ({
  baseYearMonth: { year: 2026, month: 11 },
  children: [{ id: 'child-a', birthYear: 2010, birthMonth: 4 }],
  goals,
})

/** 既定値（家の諸費用の率）は画面と同じ物を渡す */
const summaries = (goals: Goal[]) => goalSummaries(plan(goals), appDefaults)

describe('goalSummaries', () => {
  it('毎月の自由入力は、月額と期間（終わりは最後に掛かる月）', () => {
    const [row] = summaries([
      {
        id: 'g1',
        enabled: true,
        kind: 'custom',
        name: '習い事',
        amountType: 'monthly',
        direction: 'expense',
        amount: 30000,
        from: { year: 2027, month: 1 },
        to: { year: 2030, month: 1 },
      },
    ])
    expect(row).toMatchObject({
      name: '習い事',
      amount: { monthly: true, man: '3' },
      period: '2027年1月〜2029年12月',
      progress: null,
    })
  })

  it('一度きりは、金額・使う月・貯まり具合（貯まり過ぎは 1 で止める）', () => {
    const once = (saved: number): Goal => ({
      id: 'g2',
      enabled: true,
      kind: 'custom',
      name: '旅行',
      amountType: 'once',
      direction: 'expense',
      amount: 400000,
      at: { year: 2028, month: 8 },
      saved,
    })
    expect(summaries([once(100000)])[0]).toMatchObject({
      amount: { monthly: false, man: '40' },
      period: '2028年8月',
      progress: 0.25,
    })
    expect(summaries([once(500000)])[0]?.progress).toBe(1)
  })

  it('家は、価格・買う年・貯まり具合（貯まっている額 ÷（頭金 ＋ 諸費用））', () => {
    const home = (saved: number): HomeGoal => ({
      id: 'h1',
      enabled: true,
      kind: 'home',
      purchaseYear: 2031,
      price: 30000000,
      downPayment: 3000000,
      loanYears: 35,
      monthlyUpkeep: 20000,
      saved,
    })
    // 頭金 300 万 ＋ 諸費用（3,000 万 × 率）
    const upfront = 3000000 + Math.round(30000000 * appDefaults.home.closingCostRate.value)
    expect(summaries([home(upfront / 2)])[0]).toMatchObject({
      name: '家',
      amount: { monthly: false, man: '3,000' },
      period: '2031年',
      progress: 0.5,
    })
    expect(summaries([home(upfront + 1)])[0]?.progress).toBe(1)
  })

  it('もう買った家（買う年が起点の年以前）は、頭金を払い終えているので貯まり具合を出さない', () => {
    const bought = (purchaseYear: number): HomeGoal => ({
      id: 'h2',
      enabled: true,
      kind: 'home',
      purchaseYear,
      price: 30000000,
      downPayment: 3000000,
      loanYears: 35,
      monthlyUpkeep: 20000,
      saved: 0,
    })
    // 起点 2026-11：2026 年 1 月に買った・2015 年に買った家は出さない。来年買う家は出す
    expect(summaries([bought(2026)])[0]).toMatchObject({ period: '2026年', progress: null })
    expect(summaries([bought(2015)])[0]?.progress).toBeNull()
    expect(summaries([bought(2027)])[0]?.progress).toBe(0)
  })

  it('車は、価格・買う年・貯まり具合（現金で買うときだけ。貯まっている額 ÷ 価格。T8）', () => {
    const car = (overrides: Partial<CarGoal> = {}): CarGoal => ({
      id: 'c1',
      enabled: true,
      kind: 'car',
      purchaseYear: 2029,
      price: 2400000,
      payment: { type: 'cash' },
      monthlyUpkeep: 18000,
      replaceEveryYears: 7,
      saved: 600000,
      ...overrides,
    })
    expect(summaries([car()])[0]).toMatchObject({
      name: '車',
      amount: { monthly: false, man: '240' },
      period: '2029年',
      progress: 0.25,
    })
    expect(summaries([car({ saved: 3000000 })])[0]?.progress).toBe(1)
    // ローンで買う車・もう持っている車（起点 2026-11 より前か、2026 年 1 月に買った）は出さない
    expect(summaries([car({ payment: { type: 'loan', years: 5 } })])[0]?.progress).toBeNull()
    expect(summaries([car({ purchaseYear: 2026 })])[0]?.progress).toBeNull()
  })

  it('子の費用は、金額を出さず、期限に高校を出る月を出す。貯まり具合は無い（T9）', () => {
    const cost = (childId: string): Goal => ({
      id: 'k1',
      enabled: true,
      kind: 'childCost',
      childId,
      schools: { elementary: 'public', juniorHigh: 'public', highSchool: 'private' },
      cramSchools: [],
      lessonsMonthly: null,
      childcareMonthly: null,
    })
    // 2010 年 4 月生まれ → 2017 年 4 月に小学校 → 高 3 の 3 月は 2029 年 3 月
    expect(summaries([cost('child-a')])[0]).toMatchObject({
      name: '子の費用（1人目）',
      amount: null,
      period: '〜2029年3月',
      progress: null,
    })
    const withChild = (birthYear: number, birthMonth: 1 | 3 | 5) =>
      goalSummaries(
        { ...plan([cost('child-b')]), children: [{ id: 'child-b', birthYear, birthMonth }] },
        appDefaults,
      )[0]?.period
    // 早生まれは 1 年早く出る
    expect(withChild(2010, 3)).toBe('〜2028年3月')
    // もう高校を出た子（起点 2026-11）は期限を出さない
    expect(withChild(2007, 5)).toBeNull()
  })

  it('子ごとのカードは子の順を名前に添える。外したカードは enabled が false', () => {
    const [row] = summaries([
      {
        id: 'u1',
        enabled: false,
        kind: 'university',
        childId: 'child-a',
        targetAmount: 5000000,
        saved: 0,
        allocateChildAllowance: true,
        vehicle: 'childNisa',
      },
    ])
    expect(row).toMatchObject({ name: '大学資金（1人目）', enabled: false, progress: 0 })
  })

  it('大学資金は、目標額・期限（高 3 の 3 月）・貯まり具合。もう高校を出た子は期限を出さない（T10）', () => {
    const university = (childId: string): Goal => ({
      id: 'u2',
      enabled: true,
      kind: 'university',
      childId,
      targetAmount: 4200000,
      saved: 1050000,
      allocateChildAllowance: true,
      vehicle: 'childNisa',
    })
    // 2010 年 4 月生まれ：2017 年に小学校、2029 年 3 月に高校を出る
    expect(summaries([university('child-a')])[0]).toMatchObject({
      amount: { monthly: false, man: '420' },
      period: '〜2029年3月',
      progress: 0.25,
    })
    const graduated = goalSummaries(
      {
        ...plan([university('child-old')]),
        children: [{ id: 'child-old', birthYear: 2006, birthMonth: 8 }],
      },
      appDefaults,
    )[0]
    expect(graduated?.period).toBeNull()
  })

  it('老後資金は、目標額・期限（使い始める年の前年 12 月）・貯まり具合（T10）', () => {
    const [row] = summaries([
      {
        id: 'r1',
        enabled: true,
        kind: 'retirement',
        targetAmount: 18000000,
        byYear: 2045,
        saved: 4500000,
        vehicle: 'nisa',
      },
    ])
    expect(row).toMatchObject({
      name: '老後資金',
      amount: { monthly: false, man: '1,800' },
      period: '〜2044年12月',
      progress: 0.25,
    })
  })
})

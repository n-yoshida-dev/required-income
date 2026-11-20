import { describe, expect, it } from 'vitest'
import { bandContext, expandPlan } from '../../../../src/domain/plan/bands/index'
import {
  homeBands,
  homeLoanPrincipal,
  homeUpfrontCost,
} from '../../../../src/domain/plan/bands/home'
import { yearlyNeeds } from '../../../../src/domain/plan/need'
import type { Band, HomeGoal, LifePlan } from '../../../../src/domain/plan/types'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'
import { monthlyLoanPayment } from '../../../../src/domain/expense/loan'
import { defaults, makePlan, tables } from '../planFixtures'

// 架空の計画：起点 2031-01、1979 年生まれ・65 歳で退職 → 階段は 2043 年まで（until は 2044-01）
const RATE = 0.01
const CLOSING = defaults.home.closingCostRate.value

/** 家のカード（金額はダミー）。2035 年に 3,000 万円、頭金 300 万円 */
const home = (overrides: Partial<HomeGoal> = {}): HomeGoal => ({
  id: 'goal-home',
  enabled: true,
  kind: 'home',
  purchaseYear: 2035,
  price: 30000000,
  downPayment: 3000000,
  loanYears: 35,
  monthlyUpkeep: 20000,
  saved: 0,
  ...overrides,
})

const planWith = (goal: HomeGoal, overrides: Partial<LifePlan> = {}): LifePlan =>
  makePlan({
    goals: [goal],
    assumptions: { investmentReturnRate: 0.03, inflationRate: 0, mortgageRate: RATE },
    ...overrides,
  })

const bandsOf = (goal: HomeGoal, overrides: Partial<LifePlan> = {}): Band[] =>
  homeBands(goal, bandContext(planWith(goal, overrides), defaults, tables))

const byLabel = (bands: readonly Band[], label: string): Band[] =>
  bands.filter((band) => band.label === label)

describe('完了条件（T7）', () => {
  it('買う月（買う年の 1 月）で家賃の帯が終わり、同じ月から返済が始まる', () => {
    const bands = expandPlan(planWith(home()), defaults, tables)
    const [rent] = byLabel(bands, '家賃')
    const [repayment] = byLabel(bands, '返済')
    expect(rent?.to).toEqual(yearMonth(2035, 1))
    expect(repayment?.from).toEqual(yearMonth(2035, 1))
    // 年ごとに見ても、2034 年は家賃、2035 年は返済になる
    const years = yearlyNeeds(bands, yearMonth(2031, 1), 2036)
    const living = (year: number) =>
      years.find((y) => y.year === year)?.byGoal.find((g) => g.goalId === 'living')?.annual
    expect(living(2034)).toBe((220000 + 74000) * 12)
    expect(living(2035)).toBe(220000 * 12)
  })

  it('頭金を変えると返済が変わる（借りる額 ＝ 価格 − 頭金）', () => {
    const [small] = byLabel(bandsOf(home({ downPayment: 3000000 })), '返済')
    const [large] = byLabel(bandsOf(home({ downPayment: 6000000 })), '返済')
    expect(small?.monthly).toBe(
      monthlyLoanPayment({ principal: 27000000, years: 35, annualRate: RATE }),
    )
    expect(large?.monthly).toBe(
      monthlyLoanPayment({ principal: 24000000, years: 35, annualRate: RATE }),
    )
    expect(large?.monthly).toBeLessThan(small?.monthly ?? 0)
  })
})

describe('homeBands：帯の形', () => {
  it('頭金と諸費用の積立（起点 → 買う月）・返済（買う月から 35 年）・修繕と税（買う月 → until）', () => {
    const bands = bandsOf(home())
    // 諸費用 = 3,000 万 × 率。（頭金 + 諸費用）÷ 48 か月（2031-01 → 2035-01）を切り上げ
    const upfront = 3000000 + Math.round(30000000 * CLOSING)
    expect(bands).toEqual([
      {
        goalId: 'goal-home',
        label: '頭金と諸費用の積立',
        kind: 'saving',
        monthly: Math.ceil(upfront / 48),
        from: yearMonth(2031, 1),
        to: yearMonth(2035, 1),
      },
      {
        goalId: 'goal-home',
        label: '返済',
        kind: 'payment',
        monthly: monthlyLoanPayment({ principal: 27000000, years: 35, annualRate: RATE }),
        from: yearMonth(2035, 1),
        to: yearMonth(2070, 1),
      },
      {
        goalId: 'goal-home',
        label: '修繕と税',
        kind: 'payment',
        monthly: 20000,
        from: yearMonth(2035, 1),
        to: yearMonth(2044, 1),
      },
    ])
  })

  it('返済の月額は monthlyLoanPayment の値と一致する（金利は前提の値）', () => {
    for (const mortgageRate of [0, 0.0381, 0.05]) {
      const goal = home()
      const [repayment] = byLabel(
        bandsOf(goal, {
          assumptions: { investmentReturnRate: 0.03, inflationRate: 0, mortgageRate },
        }),
        '返済',
      )
      expect(repayment?.monthly).toBe(
        monthlyLoanPayment({
          principal: homeLoanPrincipal(goal),
          years: goal.loanYears,
          annualRate: mortgageRate,
        }),
      )
    }
  })

  it('積立は（頭金 ＋ 諸費用 − 貯まっている額）を残りの月で割って切り上げる', () => {
    const upfront = homeUpfrontCost(home(), CLOSING)
    const [saving] = byLabel(bandsOf(home({ saved: 1000000 })), '頭金と諸費用の積立')
    expect(saving?.monthly).toBe(Math.ceil((upfront - 1000000) / 48))
  })

  it('貯まっている額が頭金 ＋ 諸費用を超えていれば、積立は 0 円の帯（足りていることが読める）', () => {
    const upfront = homeUpfrontCost(home(), CLOSING)
    expect(byLabel(bandsOf(home({ saved: upfront })), '頭金と諸費用の積立')[0]?.monthly).toBe(0)
    expect(
      byLabel(bandsOf(home({ saved: upfront + 5000000 })), '頭金と諸費用の積立')[0]?.monthly,
    ).toBe(0)
  })

  it('頭金が価格と同じ（借りない）なら返済の帯は出ない', () => {
    const bands = bandsOf(home({ downPayment: 30000000 }))
    expect(byLabel(bands, '返済')).toEqual([])
    expect(byLabel(bands, '修繕と税')).toHaveLength(1)
  })
})

describe('homeBands：ローンの年数の端', () => {
  it('1 年なら返済は 12 か月', () => {
    const [repayment] = byLabel(bandsOf(home({ loanYears: 1 })), '返済')
    expect(repayment?.from).toEqual(yearMonth(2035, 1))
    expect(repayment?.to).toEqual(yearMonth(2036, 1))
    expect(repayment?.monthly).toBe(
      monthlyLoanPayment({ principal: 27000000, years: 1, annualRate: RATE }),
    )
  })

  it('返済が階段の終わり（until）より後まで続いても、帯は買う月から年数ぶんのまま（数えるのは yearlyNeeds）', () => {
    const [repayment] = byLabel(bandsOf(home({ loanYears: 50 })), '返済')
    expect(repayment?.to).toEqual(yearMonth(2085, 1))
  })

  it('0 年・整数でない年数は契約違反', () => {
    expect(() => bandsOf(home({ loanYears: 0 }))).toThrow(RangeError)
    expect(() => bandsOf(home({ loanYears: 2.5 }))).toThrow(RangeError)
  })
})

describe('homeBands：買う年が起点の年・過去', () => {
  it('起点の年の 1 月が起点と同じ（1 月起点で今年買う）なら、積立は出さず、返済と修繕と税は起点から', () => {
    const bands = bandsOf(home({ purchaseYear: 2031 }))
    expect(bands.map((b) => b.label)).toEqual(['返済', '修繕と税'])
    expect(bands[0]?.from).toEqual(yearMonth(2031, 1))
    expect(bands[1]?.from).toEqual(yearMonth(2031, 1))
  })

  it('起点が年の途中で、買う年が起点の年なら「もう買った」扱い：積立は出さず、返済はその年の 1 月から、修繕と税は起点から', () => {
    const goal = home({ purchaseYear: 2031 })
    const plan = planWith(goal, { baseYearMonth: yearMonth(2031, 7) })
    const bands = homeBands(goal, bandContext(plan, defaults, tables))
    expect(bands.map((b) => b.label)).toEqual(['返済', '修繕と税'])
    expect(bands[0]?.from).toEqual(yearMonth(2031, 1))
    expect(bands[1]?.from).toEqual(yearMonth(2031, 7))
    // 家賃の帯は出ない（買う月が起点より前）
    expect(byLabel(expandPlan(plan, defaults, tables), '家賃')).toEqual([])
  })

  it('過去に買った家は、買った月から数えた残りの返済だけが要る手取りに入る', () => {
    const goal = home({ purchaseYear: 2020, loanYears: 15 })
    const plan = planWith(goal)
    const bands = expandPlan(plan, defaults, tables)
    const [repayment] = byLabel(bands, '返済')
    expect(repayment?.from).toEqual(yearMonth(2020, 1))
    expect(repayment?.to).toEqual(yearMonth(2035, 1))
    const homeAnnual = (year: number) =>
      yearlyNeeds(bands, plan.baseYearMonth, 2036)
        .find((y) => y.year === year)
        ?.byGoal.find((g) => g.goalId === 'goal-home')?.annual
    expect(homeAnnual(2034)).toBe(((repayment?.monthly ?? 0) + 20000) * 12)
    expect(homeAnnual(2035)).toBe(20000 * 12)
  })

  it('買う月が階段の終わりより後なら、修繕と税の帯は出ない', () => {
    expect(byLabel(bandsOf(home({ purchaseYear: 2050 })), '修繕と税')).toEqual([])
  })
})

describe('homeBands：物価（SPEC §3.4）', () => {
  const inflated = { investmentReturnRate: 0.03, inflationRate: 0.02, mortgageRate: RATE }

  it('返済に物価は掛からない（1 本のまま、物価 0 のときと同じ月額）', () => {
    const flat = byLabel(bandsOf(home()), '返済')
    const withInflation = byLabel(bandsOf(home(), { assumptions: inflated }), '返済')
    expect(withInflation).toEqual(flat)
  })

  it('頭金と諸費用の積立にも物価は掛からない', () => {
    expect(byLabel(bandsOf(home(), { assumptions: inflated }), '頭金と諸費用の積立')).toEqual(
      byLabel(bandsOf(home()), '頭金と諸費用の積立'),
    )
  })

  it('修繕と税（維持費）には起点の年からの物価を掛け、暦年ごとの帯に分ける', () => {
    const upkeep = byLabel(bandsOf(home(), { assumptions: inflated }), '修繕と税')
    expect(upkeep[0]).toMatchObject({ from: yearMonth(2035, 1), to: yearMonth(2036, 1) })
    // 2031 年が起点なので 2035 年は 4 年ぶん
    expect(upkeep[0]?.monthly).toBe(Math.round(20000 * 1.02 ** 4))
    expect(upkeep.at(-1)?.to).toEqual(yearMonth(2044, 1))
  })
})

describe('homeBands：契約違反', () => {
  it('頭金が価格を超える・金額が負・金利が負なら投げる', () => {
    expect(() => bandsOf(home({ downPayment: 30000001 }))).toThrow(/頭金/)
    expect(() => bandsOf(home({ price: -1 }))).toThrow(RangeError)
    expect(() => bandsOf(home({ monthlyUpkeep: -1 }))).toThrow(RangeError)
    expect(() => bandsOf(home({ saved: -1 }))).toThrow(RangeError)
    expect(() =>
      bandsOf(home(), {
        assumptions: { investmentReturnRate: 0.03, inflationRate: 0, mortgageRate: -0.01 },
      }),
    ).toThrow(RangeError)
  })
})

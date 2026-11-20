import { describe, expect, it } from 'vitest'
import { evaluate } from '../../../src/domain/plan/evaluate'
import { homeUpfrontCost } from '../../../src/domain/plan/bands/home'
import {
  homeLoanCheck,
  homeLoanNotices,
  homeSavingSoonNotices,
} from '../../../src/domain/plan/homeLoan'
import type { HomeGoal } from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { adult, defaults, makePlan, tables } from './planFixtures'

// 架空の計画：起点 2031-01、大人 1 人（年収 480 万）。目安の倍率は 7 倍で固定して見る
const LIMIT = 7
const INCOME = 4800000

/** 家のカード（金額はダミー）。借りる額 ＝ 価格 − 頭金 */
const home = (principal: number, overrides: Partial<HomeGoal> = {}): HomeGoal => ({
  id: 'goal-home',
  enabled: true,
  kind: 'home',
  purchaseYear: 2034,
  price: principal + 1900000,
  downPayment: 1900000,
  loanYears: 35,
  monthlyUpkeep: 20000,
  saved: 0,
  ...overrides,
})

describe('homeLoanCheck（借りる額 ÷ 買う年の見込みの世帯年収。SPEC §3.7）', () => {
  it('ちょうど目安の倍率は超えていない。1 円でも多く借りると超える', () => {
    const plan = makePlan()
    const exact = homeLoanCheck(plan, home(INCOME * LIMIT), LIMIT)
    expect(exact).toEqual({
      principal: INCOME * LIMIT,
      expectedGross: INCOME,
      ratio: LIMIT,
      limit: LIMIT,
      over: false,
    })
    expect(homeLoanCheck(plan, home(INCOME * LIMIT + 1), LIMIT)?.over).toBe(true)
  })

  it('年収は買う年の見込み（見込みの段・昇給を使う）', () => {
    const plan = makePlan({
      adults: [adult({ outlookSteps: [{ year: 2034, annualIncome: 6000000 }] })],
    })
    expect(homeLoanCheck(plan, home(30000000), LIMIT)?.expectedGross).toBe(6000000)
    expect(homeLoanCheck(plan, home(30000000, { purchaseYear: 2033 }), LIMIT)?.expectedGross).toBe(
      INCOME,
    )
  })

  it('借りない・もう買った（買う月が起点の月以前）なら出さない', () => {
    const plan = makePlan()
    expect(homeLoanCheck(plan, home(0), LIMIT)).toBeNull()
    expect(homeLoanCheck(plan, home(30000000, { purchaseYear: 2031 }), LIMIT)).toBeNull()
    expect(homeLoanCheck(plan, home(30000000, { purchaseYear: 2025 }), LIMIT)).toBeNull()
  })

  it('買う年の見込みの年収が 0 なら割れないので null、超えたとみなす', () => {
    const plan = makePlan({ adults: [adult({ workStyle: 'notWorking', annualIncome: 0 })] })
    expect(homeLoanCheck(plan, home(10000000), LIMIT)).toMatchObject({ ratio: null, over: true })
  })

  it('倍率が正の数でなければ契約違反', () => {
    expect(() => homeLoanCheck(makePlan(), home(1000000), 0)).toThrow(RangeError)
    expect(() => homeLoanCheck(makePlan(), home(1000000), Number.NaN)).toThrow(RangeError)
  })
})

describe('知らせ（homeLoanHeavy）', () => {
  it('目安を超えたオンの家のカードだけ知らせる', () => {
    const heavy = home(INCOME * LIMIT + 1)
    expect(homeLoanNotices(makePlan({ goals: [heavy] }), LIMIT)).toEqual([
      {
        kind: 'homeLoanHeavy',
        goalId: 'goal-home',
        ratio: (INCOME * LIMIT + 1) / INCOME,
        limit: LIMIT,
      },
    ])
    expect(homeLoanNotices(makePlan({ goals: [{ ...heavy, enabled: false }] }), LIMIT)).toEqual([])
    expect(homeLoanNotices(makePlan({ goals: [home(INCOME * LIMIT)] }), LIMIT)).toEqual([])
  })

  it('evaluate はアプリの既定値の倍率で知らせる（計算は止めない）', () => {
    const limit = defaults.home.loanToIncomeLimit.value
    const plan = makePlan({ goals: [home(INCOME * limit + 1000000)] })
    const result = evaluate(plan, tables, defaults)
    expect(result.notices).toContainEqual(
      expect.objectContaining({ kind: 'homeLoanHeavy', goalId: 'goal-home', limit }),
    )
    expect(result.steps.length).toBeGreaterThan(0)
    expect(evaluate(makePlan({ goals: [home(INCOME)] }), tables, defaults).notices).toEqual([])
  })

  it('起点の月が年の途中でも、買う年が来年なら見る', () => {
    const plan = makePlan({ baseYearMonth: yearMonth(2033, 9) })
    expect(homeLoanCheck(plan, home(INCOME * LIMIT + 1), LIMIT)?.over).toBe(true)
  })
})

describe('知らせ（homeSavingSoon：買う月まで 12 か月を切り、頭金と諸費用が残っている）', () => {
  const CLOSING = defaults.home.closingCostRate.value
  const SOON = defaults.notices.onceSoonMonths.value
  // 買う月は 2034-01。起点を動かして残りの月数を変える
  const goal = home(10000000)
  const upfront = homeUpfrontCost(goal, CLOSING)
  const at = (base: [number, number], saved = 0) =>
    homeSavingSoonNotices(
      makePlan({ baseYearMonth: yearMonth(...base), goals: [{ ...goal, saved }] }),
      CLOSING,
      SOON,
    )

  it('残りが 12 か月を切ったら出す。12 か月ちょうどは出さない', () => {
    expect(at([2033, 2])).toEqual([{ kind: 'homeSavingSoon', goalId: 'goal-home', monthsLeft: 11 }])
    expect(at([2033, 12])).toEqual([{ kind: 'homeSavingSoon', goalId: 'goal-home', monthsLeft: 1 }])
    expect(at([2033, 1])).toEqual([])
  })

  it('貯まっている額で頭金と諸費用が足りていれば出さない（1 円足りなければ出す）', () => {
    expect(at([2033, 6], upfront)).toEqual([])
    expect(at([2033, 6], upfront - 1)).toHaveLength(1)
  })

  it('もう買った（買う月が起点の月以前）・オフのカードは出さない', () => {
    expect(at([2034, 1])).toEqual([])
    expect(at([2034, 5])).toEqual([])
    const off = makePlan({
      baseYearMonth: yearMonth(2033, 6),
      goals: [{ ...goal, enabled: false }],
    })
    expect(homeSavingSoonNotices(off, CLOSING, SOON)).toEqual([])
  })

  it('evaluate の知らせに入る', () => {
    const plan = makePlan({ baseYearMonth: yearMonth(2033, 6), goals: [goal] })
    expect(evaluate(plan, tables, defaults).notices).toContainEqual({
      kind: 'homeSavingSoon',
      goalId: 'goal-home',
      monthsLeft: 7,
    })
  })
})

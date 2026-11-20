import { describe, expect, it } from 'vitest'
import { appDefaults, sampleHousehold } from '../../../src/data/appData'
import { sampleLifePlan } from '../../../src/domain/plan/defaults'
import type { CustomGoal, Goal, HomeGoal, LifePlan } from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { INPUT_LIMITS } from '../../../src/features/plan/inputLimits'
import {
  goalAmount,
  goalTime,
  reviewAdults,
  reviewChanges,
  reviewTouched,
  shiftGoalTime,
  stepAnnualIncome,
  stepGoalAmount,
  stepReturnRate,
  stepSideMonthly,
  stepValue,
  withGoal,
  withGoalEnabled,
} from '../../../src/features/review/reviewDraft'
import { REVIEW_LIMITS, REVIEW_STEPS } from '../../../src/features/review/reviewSteps'

const BASE = yearMonth(2026, 11)

/** 見本の世帯（金額はどれもダミー） */
function samplePlan(): LifePlan {
  return sampleLifePlan(appDefaults, sampleHousehold, BASE)
}

/** 種類で目標を 1 つ取り出す */
function goalOf<K extends Goal['kind']>(plan: LifePlan, kind: K): Extract<Goal, { kind: K }> {
  const goal = plan.goals.find((one): one is Extract<Goal, { kind: K }> => one.kind === kind)
  if (goal === undefined) throw new Error(`見本に ${kind} のカードが無い`)
  return goal
}

describe('stepValue', () => {
  it('目盛りの上の値は幅だけ動く', () => {
    expect(stepValue(3_000_000, 1_000_000, 1, 0, Infinity)).toBe(4_000_000)
    expect(stepValue(3_000_000, 1_000_000, -1, 0, Infinity)).toBe(2_000_000)
  })

  it('目盛りから外れた値は、まず向きの側の目盛りへ揃える', () => {
    expect(stepValue(48_600_000, 1_000_000, 1, 0, Infinity)).toBe(49_000_000)
    expect(stepValue(48_600_000, 1_000_000, -1, 0, Infinity)).toBe(48_000_000)
  })

  it('範囲の外へは出さない（0 円の下・上限の上）', () => {
    expect(stepValue(0, 10_000, -1, 0, Infinity)).toBe(0)
    expect(stepValue(5_000, 10_000, -1, 0, Infinity)).toBe(0)
    expect(stepValue(0.1, 0.005, 1, 0, 0.1)).toBe(0.1)
  })

  it('小数の幅でも割り算の誤差で目盛りを取り違えない（3.5% → 4%・3%）', () => {
    expect(stepValue(0.035, 0.005, 1, 0, 1)).toBe(0.04)
    expect(stepValue(0.035, 0.005, -1, 0, 1)).toBe(0.03)
    expect(stepValue(0.03, 0.005, 1, 0, 1)).toBe(0.035)
  })
})

describe('目標の時期と金額', () => {
  it('種類ごとに動かせる欄（家・車：買う年と価格、大学資金：目標額だけ、老後資金：使い始める年と目標額、子の費用：なし）', () => {
    const plan = samplePlan()
    const home = goalOf(plan, 'home')
    expect(goalTime(home)?.text).toBe(`${home.purchaseYear}年`)
    expect(goalAmount(home)?.text).toBe('4,860万円')
    expect(goalTime(goalOf(plan, 'car'))?.name).toBe('買う年')
    expect(goalTime(goalOf(plan, 'university'))).toBeNull()
    expect(goalAmount(goalOf(plan, 'university'))?.name).toBe('目標額')
    expect(goalTime(goalOf(plan, 'retirement'))?.name).toBe('使い始める年')
    expect(goalTime(goalOf(plan, 'childCost'))).toBeNull()
    expect(goalAmount(goalOf(plan, 'childCost'))).toBeNull()
  })

  it('家を 1 年ずつずらす。範囲（「計画」の欄と同じ幅）の外へは動かさない', () => {
    const home = goalOf(samplePlan(), 'home')
    const later = shiftGoalTime(shiftGoalTime(home, 1, BASE), 1, BASE) as HomeGoal
    expect(later.purchaseYear).toBe(home.purchaseYear + 2)
    expect(later.price).toBe(home.price)
    const edge: HomeGoal = { ...home, purchaseYear: BASE.year + INPUT_LIMITS.planYear.yearsAfter }
    expect(shiftGoalTime(edge, 1, BASE)).toBe(edge)
  })

  it('毎月の自由入力は、期間の長さを変えずに始まりと終わりを一緒にずらす', () => {
    const goal: CustomGoal = {
      id: 'goal-x',
      enabled: true,
      kind: 'custom',
      name: '習いごと',
      amountType: 'monthly',
      direction: 'expense',
      amount: 7_500,
      from: yearMonth(2027, 4),
      to: yearMonth(2030, 4),
    }
    const moved = shiftGoalTime(goal, -1, BASE)
    expect(moved).toMatchObject({ from: yearMonth(2026, 4), to: yearMonth(2029, 4) })
    expect(goalTime(goal)?.text).toBe('2027〜2030年')
    // 金額は目盛り（0.1万円）にそろえて動く
    expect(stepGoalAmount(goal, 1)).toMatchObject({ amount: 8_000 })
    expect(goalAmount(goal)?.text).toBe('月 0.8万円')
  })

  it('一度きりの自由入力は使う月を 1 年ずらし、金額は 10万円の幅', () => {
    const once = samplePlan().goals.find(
      (one): one is CustomGoal => one.kind === 'custom' && one.amountType === 'once',
    )
    if (once === undefined || once.amountType !== 'once') throw new Error('見本に一度きりが無い')
    const moved = shiftGoalTime(once, 1, BASE)
    expect(moved).toMatchObject({ at: yearMonth(once.at.year + 1, once.at.month) })
    expect(stepGoalAmount(once, 1)).toMatchObject({
      amount: Math.floor(once.amount / REVIEW_STEPS.customOnce + 1) * REVIEW_STEPS.customOnce,
    })
  })

  it('家の価格は頭金より下へ行かない（押すだけで計算できない案を作らない）', () => {
    const home: HomeGoal = {
      ...goalOf(samplePlan(), 'home'),
      price: 4_500_000,
      downPayment: 3_900_000,
    }
    // 450万円 → 400万円（目盛り）→ 390万円（頭金で止まる）→ 390万円のまま
    const once = stepGoalAmount(home, -1) as HomeGoal
    expect(once.price).toBe(4_000_000)
    const lowest = stepGoalAmount(once, -1) as HomeGoal
    expect(lowest.price).toBe(3_900_000)
    expect(stepGoalAmount(lowest, -1)).toMatchObject({ price: 3_900_000 })
  })

  it('値は数字と単位のかけらに分ける（単位を小さく添えるため）', () => {
    const home = goalOf(samplePlan(), 'home')
    expect(goalAmount(home)?.parts).toEqual([
      { text: '4,860', unit: false },
      { text: '万円', unit: true },
    ])
    expect(goalTime(home)?.parts).toEqual([
      { text: String(home.purchaseYear), unit: false },
      { text: '年', unit: true },
    ])
  })

  it('金額は 0 円の下へ行かない。子の費用は動かない', () => {
    const car = { ...goalOf(samplePlan(), 'car'), price: 0 }
    expect(stepGoalAmount(car, -1)).toMatchObject({ price: 0 })
    const child = goalOf(samplePlan(), 'childCost')
    expect(stepGoalAmount(child, 1)).toBe(child)
    expect(shiftGoalTime(child, 1, BASE)).toBe(child)
  })
})

describe('収入と利回り', () => {
  it('副業は働く大人ごと、年収はもう 1 人だけ', () => {
    const adults = reviewAdults(samplePlan())
    expect(adults.map((adult) => [adult.title, adult.showsIncome])).toEqual([
      ['本人', false],
      ['もう 1 人', true],
    ])
  })

  it('働いていない大人は出さない。大人が 1 人なら呼び方を付けない', () => {
    const plan = samplePlan()
    const [first, second] = plan.adults
    if (first === undefined || second === undefined) throw new Error('見本の大人が 2 人でない')
    expect(reviewAdults({ ...plan, adults: [first] })[0]?.title).toBeNull()
    expect(
      reviewAdults({ ...plan, adults: [first, { ...second, workStyle: 'notWorking' }] }),
    ).toHaveLength(1)
  })

  it('副業は 1万円、年収は 10万円、利回りは 0.5% ずつ動く。利回りは上限で止まる', () => {
    const plan = samplePlan()
    const [first, second] = plan.adults
    if (first === undefined || second === undefined) throw new Error('見本の大人が 2 人でない')
    expect(stepSideMonthly(plan, first.id, 1).adults[0]?.sideMonthlyProfit).toBe(
      first.sideMonthlyProfit + REVIEW_STEPS.sideMonthly,
    )
    expect(stepAnnualIncome(plan, second.id, -1).adults[1]?.annualIncome).toBe(
      second.annualIncome - REVIEW_STEPS.annualIncome,
    )
    const rate = plan.assumptions.investmentReturnRate
    expect(stepReturnRate(plan, 1).assumptions.investmentReturnRate).toBeCloseTo(
      rate + REVIEW_STEPS.returnRate,
    )
    const top = {
      ...plan,
      assumptions: { ...plan.assumptions, investmentReturnRate: REVIEW_LIMITS.returnRateMax },
    }
    expect(stepReturnRate(top, 1).assumptions.investmentReturnRate).toBe(
      REVIEW_LIMITS.returnRateMax,
    )
  })
})

describe('利回りの端', () => {
  it('「計画」で負の利回りを入れてあれば、下げる側の端はその値（押しても 0% へ上がらない）', () => {
    const plan = samplePlan()
    const negative = { ...plan, assumptions: { ...plan.assumptions, investmentReturnRate: -0.01 } }
    expect(stepReturnRate(negative, -1).assumptions.investmentReturnRate).toBe(-0.01)
    expect(stepReturnRate(negative, 1).assumptions.investmentReturnRate).toBe(-0.005)
  })
})

describe('今の計画と比べる', () => {
  it('写したばかりの案は、どこも動いていない', () => {
    const plan = samplePlan()
    expect(reviewChanges(plan, plan)).toEqual([])
    expect(
      reviewChanges(plan, { ...plan, goals: plan.goals.map((goal) => ({ ...goal })) }),
    ).toEqual([])
  })

  it('動かした欄を、直した印の形で返す（オン・オフ、買う年、副業、利回り）', () => {
    const plan = samplePlan()
    const home = goalOf(plan, 'home')
    const [first] = plan.adults
    if (first === undefined) throw new Error('見本に大人がいない')
    let draft = withGoalEnabled(plan, home.id, false)
    draft = withGoal(draft, shiftGoalTime(goalOf(draft, 'home'), 1, BASE))
    draft = stepSideMonthly(draft, first.id, 1)
    draft = stepReturnRate(draft, -1)
    expect(reviewChanges(plan, draft)).toEqual([
      `goals.${home.id}.enabled`,
      `goals.${home.id}.purchaseYear`,
      `adults.${first.id}.sideMonthlyProfit`,
      'assumptions.investmentReturnRate',
    ])
  })

  it('動かして元の値へ戻すと、動いていない扱いに戻る', () => {
    const plan = samplePlan()
    const home = goalOf(plan, 'home')
    const there = withGoal(plan, shiftGoalTime(home, 1, BASE))
    const back = withGoal(there, shiftGoalTime(goalOf(there, 'home'), -1, BASE))
    expect(reviewChanges(plan, back)).toEqual([])
  })

  it('今の計画にするときの印は、今の印に動かした欄の印を重ねずに足す', () => {
    const plan = samplePlan()
    const home = goalOf(plan, 'home')
    const draft = withGoalEnabled(plan, home.id, false)
    expect(reviewTouched(plan, draft, ['living.monthlyRent', `goals.${home.id}.enabled`])).toEqual([
      'living.monthlyRent',
      `goals.${home.id}.enabled`,
    ])
    expect(reviewTouched(plan, draft, [])).toEqual([`goals.${home.id}.enabled`])
  })
})

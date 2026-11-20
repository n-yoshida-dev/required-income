/**
 * 「見直す」の案（今の計画の写し）を動かす純粋関数（SPEC §4.3）。年収・階段の計算はせず（`evaluate` に任せる）、計画の次の形を作るだけ。
 *
 * 動かせる物：目標のオン・オフ／目標ごとの時期と金額／副業の月額／もう 1 人の大人の年収／積立の利回り。
 * 目標ごとに「時期」と「金額」に当たる欄を 1 つずつ決める（無い種類は null）：
 *
 * | 種類 | 時期 | 金額 |
 * |---|---|---|
 * | 家 | 買う年 | 価格 |
 * | 車 | 買う年 | 価格 |
 * | 大学資金 | なし（子の学年で決まる） | 目標額 |
 * | 老後資金 | 使い始める年（`byYear`） | 目標額 |
 * | 自由入力・毎月 | 期間（始まりと終わりを一緒に動かす） | 月額 |
 * | 自由入力・一度きり | 使う月 | 金額 |
 * | 子の費用 | なし | なし（オン・オフだけ） |
 *
 * 押すと 1 年・決まった幅（`reviewSteps.ts`）だけ動く。細かい直しは「計画」に任せる。
 */

import type { Goal, LifePlan, Rate, YearMonth, Yen } from '../../domain/plan/types'
import { addMonths, monthIndex } from '../../domain/plan/yearMonth'
import { INPUT_LIMITS } from '../plan/inputLimits'
import { touchedKey, withTouched } from '../plan/touched'
import { formatPercent, manNumber } from '../shared/format'
import { REVIEW_LIMITS, REVIEW_STEPS } from './reviewSteps'

/** 押す向き（−1 は早める・減らす、+1 は遅らせる・増やす） */
export type Direction = -1 | 1

/** 値の 1 かけら。数字（`unit: false`）と単位（万円・年・月・%。本文の字で小さく添える。DESIGN.md「Typography」） */
export type KnobPart = { text: string; unit: boolean }

/**
 * 動かす欄 1 つの見え方。`parts` は画面に出すかけら（数字と単位を分ける）、`text` はそのつなぎ（読み上げ・テスト）、
 * `value` は比べるための数（今の計画と違えば「動かした」と見せる）
 */
export type KnobView = { parts: KnobPart[]; text: string; value: number }

/** 数字のかけら */
const num = (text: string): KnobPart => ({ text, unit: false })
/** 単位のかけら */
const unit = (text: string): KnobPart => ({ text, unit: true })

/** かけらから見え方を作る */
function knobView(parts: KnobPart[], value: number): KnobView {
  return { parts, text: parts.map((part) => part.text).join(''), value }
}

/** 年（「2032年」） */
function yearParts(year: number): KnobPart[] {
  return [num(String(year)), unit('年')]
}

/** 年の範囲（「2026〜2037年」。1 年なら「2026年」） */
function yearRangeParts(from: number, to: number): KnobPart[] {
  return [num(from === to ? String(from) : `${from}〜${to}`), unit('年')]
}

/** 年月（「2029年1月」） */
function yearMonthParts(value: YearMonth): KnobPart[] {
  return [num(String(value.year)), unit('年'), num(String(value.month)), unit('月')]
}

/** 万円（「4,860万円」） */
function manParts(yen: Yen): KnobPart[] {
  return [num(manNumber(yen)), unit('万円')]
}

/** 月額の万円（「月 0.8万円」） */
function monthlyManParts(yen: Yen): KnobPart[] {
  return [unit('月 '), num(manNumber(yen, { digits: 1 })), unit('万円')]
}

/** 数を幅の目盛りに沿って 1 つ動かす。目盛りから外れた値は、まず向きの側の目盛りへ揃える。範囲の外へは出さない */
export function stepValue(
  value: number,
  step: number,
  direction: Direction,
  min: number,
  max: number,
): number {
  // 割り算の誤差（0.035 / 0.005 = 6.999…）で目盛りを取り違えないよう、小さな幅をみてから切る
  const units = value / step
  const next = direction > 0 ? Math.floor(units + 1e-9) + 1 : Math.ceil(units - 1e-9) - 1
  // 利回りのような小数は、掛け算の誤差を落とす（0.035000000000000003 にしない）
  const moved = Math.round(next * step * 1e9) / 1e9
  return Math.min(Math.max(moved, min), max)
}

// ---------------------------------------------------------------------------
// 目標の時期と金額
// ---------------------------------------------------------------------------

/** 目標の欄の見え方と、その欄の名前（読み上げに使う。画面には値だけを出す） */
export type GoalKnobView = KnobView & { name: string }

/** 目標の時期の見え方。時期を動かせない種類は null */
export function goalTime(goal: Goal): GoalKnobView | null {
  switch (goal.kind) {
    case 'home':
    case 'car':
      return { name: '買う年', ...knobView(yearParts(goal.purchaseYear), goal.purchaseYear * 12) }
    case 'retirement':
      return { name: '使い始める年', ...knobView(yearParts(goal.byYear), goal.byYear * 12) }
    case 'custom':
      if (goal.amountType === 'once') {
        return { name: '使う月', ...knobView(yearMonthParts(goal.at), monthIndex(goal.at)) }
      }
      // 1 年ずつずらすので、年だけを出す（最後に掛かる月の年まで）
      return {
        name: '期間',
        ...knobView(
          yearRangeParts(goal.from.year, addMonths(goal.to, -1).year),
          monthIndex(goal.from),
        ),
      }
    case 'university':
    case 'childCost':
      return null
  }
}

/** 目標の金額の見え方。金額を動かせない種類は null */
export function goalAmount(goal: Goal): GoalKnobView | null {
  switch (goal.kind) {
    case 'home':
    case 'car':
      return { name: '価格', ...knobView(manParts(goal.price), goal.price) }
    case 'university':
    case 'retirement':
      return { name: '目標額', ...knobView(manParts(goal.targetAmount), goal.targetAmount) }
    case 'custom':
      if (goal.amountType === 'once') {
        return { name: '金額', ...knobView(manParts(goal.amount), goal.amount) }
      }
      return { name: '月額', ...knobView(monthlyManParts(goal.amount), goal.amount) }
    case 'childCost':
      return null
  }
}

/** 時期を 1 年ずらした目標。動かせない種類・範囲の外は、同じ目標をそのまま返す */
export function shiftGoalTime(goal: Goal, direction: Direction, base: YearMonth): Goal {
  const years = REVIEW_STEPS.years * direction
  const minYear = base.year - INPUT_LIMITS.planYear.yearsBefore
  const maxYear = base.year + INPUT_LIMITS.planYear.yearsAfter
  const inRange = (year: number) => year >= minYear && year <= maxYear
  switch (goal.kind) {
    case 'home':
    case 'car': {
      const purchaseYear = goal.purchaseYear + years
      return inRange(purchaseYear) ? { ...goal, purchaseYear } : goal
    }
    case 'retirement': {
      const byYear = goal.byYear + years
      return inRange(byYear) ? { ...goal, byYear } : goal
    }
    case 'custom': {
      if (goal.amountType === 'once') {
        const at = addMonths(goal.at, years * 12)
        return inRange(at.year) ? { ...goal, at } : goal
      }
      // 期間の長さは変えず、始まりと終わりを一緒にずらす
      const from = addMonths(goal.from, years * 12)
      const to = addMonths(goal.to, years * 12)
      return inRange(from.year) && inRange(to.year) ? { ...goal, from, to } : goal
    }
    case 'university':
    case 'childCost':
      return goal
  }
}

/**
 * 金額を 1 つ動かした目標（0 円より下へは行かない）。動かせない種類は、同じ目標をそのまま返す。
 * 家の価格は頭金より下へ行かない（頭金が価格を超えると計算できない契約違反になるため。押すだけで計算できない案を作らない）
 */
export function stepGoalAmount(goal: Goal, direction: Direction): Goal {
  const move = (value: Yen, step: number, min = 0) =>
    stepValue(value, step, direction, Math.min(min, value), Infinity)
  switch (goal.kind) {
    case 'home':
      return { ...goal, price: move(goal.price, REVIEW_STEPS.homePrice, goal.downPayment) }
    case 'car':
      return { ...goal, price: move(goal.price, REVIEW_STEPS.carPrice) }
    case 'university':
      return { ...goal, targetAmount: move(goal.targetAmount, REVIEW_STEPS.universityTarget) }
    case 'retirement':
      return { ...goal, targetAmount: move(goal.targetAmount, REVIEW_STEPS.retirementTarget) }
    case 'custom':
      return {
        ...goal,
        amount: move(
          goal.amount,
          goal.amountType === 'once' ? REVIEW_STEPS.customOnce : REVIEW_STEPS.customMonthly,
        ),
      }
    case 'childCost':
      return goal
  }
}

/** 計画の中の目標 1 つを差し替える */
export function withGoal(plan: LifePlan, goal: Goal): LifePlan {
  return { ...plan, goals: plan.goals.map((other) => (other.id === goal.id ? goal : other)) }
}

/** 目標をオン・オフした計画 */
export function withGoalEnabled(plan: LifePlan, goalId: string, enabled: boolean): LifePlan {
  return {
    ...plan,
    goals: plan.goals.map((goal) => (goal.id === goalId ? { ...goal, enabled } : goal)),
  }
}

// ---------------------------------------------------------------------------
// 収入と利回り
// ---------------------------------------------------------------------------

/** 副業の所得（月）の見え方 */
export function sideMonthlyView(monthly: Yen): KnobView {
  return knobView(monthlyManParts(monthly), monthly)
}

/** 年収の見え方 */
export function annualIncomeView(annual: Yen): KnobView {
  return knobView(manParts(annual), annual)
}

/** 利回りの見え方（「3%」。数字と % を分ける） */
export function returnRateView(rate: Rate): KnobView {
  return knobView([num(formatPercent(rate).replace('%', '')), unit('%')], rate)
}

/** 大人 1 人の副業の所得（月）を 1 つ動かした計画 */
export function stepSideMonthly(plan: LifePlan, adultId: string, direction: Direction): LifePlan {
  return {
    ...plan,
    adults: plan.adults.map((adult) =>
      adult.id === adultId
        ? {
            ...adult,
            sideMonthlyProfit: stepValue(
              adult.sideMonthlyProfit,
              REVIEW_STEPS.sideMonthly,
              direction,
              0,
              Infinity,
            ),
          }
        : adult,
    ),
  }
}

/** 大人 1 人の年収（会社員は額面、自営業は所得）を 1 つ動かした計画 */
export function stepAnnualIncome(plan: LifePlan, adultId: string, direction: Direction): LifePlan {
  return {
    ...plan,
    adults: plan.adults.map((adult) =>
      adult.id === adultId
        ? {
            ...adult,
            annualIncome: stepValue(
              adult.annualIncome,
              REVIEW_STEPS.annualIncome,
              direction,
              0,
              Infinity,
            ),
          }
        : adult,
    ),
  }
}

/**
 * 積立の利回りを 1 つ動かした計画（0 から `REVIEW_LIMITS.returnRateMax` まで）。
 * 「計画」で範囲の外（負・上限の上）を入れてあれば、その値を端にする（押しただけで逆の向きへ飛ばない）
 */
export function stepReturnRate(plan: LifePlan, direction: Direction): LifePlan {
  const current = plan.assumptions.investmentReturnRate
  const investmentReturnRate = stepValue(
    current,
    REVIEW_STEPS.returnRate,
    direction,
    Math.min(0, current),
    Math.max(REVIEW_LIMITS.returnRateMax, current),
  )
  return { ...plan, assumptions: { ...plan.assumptions, investmentReturnRate } }
}

/**
 * 「見直す」で動かす大人。副業はどの働く大人にもあり、年収はもう 1 人（先頭でない大人）だけ（SPEC §4.3）。
 * 働いていない大人の収入は計算に使われないので出さない
 */
export function reviewAdults(plan: LifePlan): {
  id: string
  /** 「本人」「もう 1 人」（大人が 1 人なら null） */
  title: string | null
  /** 年収の欄を出すか（もう 1 人だけ） */
  showsIncome: boolean
  selfEmployed: boolean
}[] {
  return plan.adults.flatMap((adult, index) =>
    adult.workStyle === 'notWorking'
      ? []
      : [
          {
            id: adult.id,
            title: plan.adults.length === 1 ? null : ADULT_TITLES[index === 0 ? 0 : 1],
            showsIncome: index > 0,
            selfEmployed: adult.workStyle === 'selfEmployed',
          },
        ],
  )
}

/** 大人の呼び方（「計画」の家族の見出しと同じ） */
const ADULT_TITLES = ['本人', 'もう 1 人'] as const

// ---------------------------------------------------------------------------
// 今の計画と比べる
// ---------------------------------------------------------------------------

/** 「見直す」で動かす目標の欄（直した印の名前と同じ。`features/plan/touched.ts`） */
const GOAL_FIELDS = [
  'enabled',
  'purchaseYear',
  'price',
  'targetAmount',
  'byYear',
  'from',
  'to',
  'at',
  'amount',
] as const

/** 「見直す」で動かす大人の欄 */
const ADULT_FIELDS = ['sideMonthlyProfit', 'annualIncome'] as const

/**
 * 案が今の計画から動いた欄を、直した印の形（`goals.<id>.price` など）で並べる。空なら案は今の計画と同じ。
 * 「見直す」は行を足しも外しもしないので、目標と大人は id で突き合わせる
 */
export function reviewChanges(base: LifePlan, draft: LifePlan): string[] {
  const changes: string[] = []
  for (const goal of draft.goals) {
    const before = base.goals.find((other) => other.id === goal.id)
    if (before === undefined) continue
    for (const field of GOAL_FIELDS) {
      if (differs(fieldOf(before, field), fieldOf(goal, field))) {
        changes.push(touchedKey('goals', goal.id, field))
      }
    }
  }
  for (const adult of draft.adults) {
    const before = base.adults.find((other) => other.id === adult.id)
    if (before === undefined) continue
    for (const field of ADULT_FIELDS) {
      if (before[field] !== adult[field]) changes.push(touchedKey('adults', adult.id, field))
    }
  }
  if (base.assumptions.investmentReturnRate !== draft.assumptions.investmentReturnRate) {
    changes.push(touchedKey('assumptions', 'investmentReturnRate'))
  }
  return changes
}

/** 案を今の計画にするときの印：今の印に、動いた欄の印を足す（「見直す」で動かした欄は、本人が直した欄） */
export function reviewTouched(
  base: LifePlan,
  draft: LifePlan,
  touched: readonly string[],
): string[] {
  return reviewChanges(base, draft).reduce<string[]>(
    (keys, key) => withTouched(keys, key),
    [...touched],
  )
}

/** 目標の欄を、種類を問わずに読む（無い欄は undefined） */
function fieldOf(goal: Goal, field: (typeof GOAL_FIELDS)[number]): unknown {
  return (goal as Partial<Record<(typeof GOAL_FIELDS)[number], unknown>>)[field]
}

/** 2 つの欄の値が違うか（年月は中身で比べる） */
function differs(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b)
}

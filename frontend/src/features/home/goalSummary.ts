/**
 * 「ながめる」の目標の一覧の 1 行（SPEC §4.1 の 3）：目標・金額・期限・貯まり具合（`saved` ÷ 目標額）。
 *
 * 計算はせず、カードの入力を並べ直すだけ。貯まり具合は積立の型で目標額が 1 つに決まるカードにだけ出す。
 * 家の貯まり具合は「貯まっている額 ÷（頭金 ＋ 諸費用）」（買う月の前までに用意する額。T7 の呼び出し側の決定）。
 * もう買った家（買う月が起点の月以前）は頭金を払い終えているので、貯まり具合を出さない。
 * 車の貯まり具合は、現金で買うときだけ「貯まっている額 ÷ 価格」。ローンで買う・もう持っている車は、買う前に貯める物が無いので出さない（T8）。
 * 子の費用は金額を出さず、期限（高校を出る月）だけを出す（T9）。
 * 大学資金・老後資金は目標額・期限（積み立てる最後の月）・貯まり具合（貯まっている額 ÷ 目標額）を出す（T10）。
 */

import { FIRST_GRADE, schoolEntryYear } from '../../domain/expense/education'
import { carAlreadyOwned } from '../../domain/plan/bands/car'
import { universityUseMonth } from '../../domain/plan/bands/childAllowance'
import { retirementUseMonth } from '../../domain/plan/bands/retirementFund'
import { SCHOOL_YEAR_START_MONTH, toLegacyChild } from '../../domain/plan/bands/childCost'
import { homePurchaseMonth, homeUpfrontCost } from '../../domain/plan/bands/home'
import type { AppDefaults, ChildCostGoal, Goal, LifePlan, YearMonth } from '../../domain/plan/types'
import { compareYearMonth, yearMonth } from '../../domain/plan/yearMonth'
import { formatEndExclusive, formatYearMonth, manNumber } from '../shared/format'
import { goalName } from '../shared/goalNames'

/** 一覧の 1 行 */
export type GoalSummary = {
  id: string
  name: string
  /**
   * 金額。`man` は万円の数字だけ（"186"・"6.8"）で、毎月の目標は `monthly` が true（画面は「月 6.8万円」と出し、「月」と「万円」を小さくする）。
   * 無いカードは null
   */
  amount: { monthly: boolean; man: string } | null
  /** 期限・期間（"2029年1月"・"2026年11月〜2034年12月"）。無いカードは null */
  period: string | null
  /** 貯まり具合（0〜1）。出さないカードは null */
  progress: number | null
  /** 見直しで外したカード */
  enabled: boolean
}

/**
 * 計画の目標カードを、一覧の行に直す。並びはカードの順のまま
 *
 * @param defaults アプリの既定値（家の諸費用の率を読む）
 */
export function goalSummaries(
  plan: Pick<LifePlan, 'baseYearMonth' | 'children' | 'goals'>,
  defaults: Pick<AppDefaults, 'home'>,
): GoalSummary[] {
  return plan.goals.map((goal) => ({
    id: goal.id,
    name: goalName(goal, plan),
    enabled: goal.enabled,
    ...details(goal, plan.baseYearMonth, plan.children, defaults),
  }))
}

/** カードの種類ごとの金額・期限・貯まり具合 */
function details(
  goal: Goal,
  base: YearMonth,
  children: LifePlan['children'],
  defaults: Pick<AppDefaults, 'home'>,
): Pick<GoalSummary, 'amount' | 'period' | 'progress'> {
  switch (goal.kind) {
    case 'custom':
      return goal.amountType === 'monthly'
        ? {
            amount: { monthly: true, man: manNumber(goal.amount, { digits: 1 }) },
            period: `${formatYearMonth(goal.from)}〜${formatEndExclusive(goal.to)}`,
            progress: null,
          }
        : {
            amount: once(goal.amount),
            period: formatYearMonth(goal.at),
            progress: ratio(goal.saved, goal.amount),
          }
    case 'university':
      // 期限は高校 3 年の 3 月（積み立てる最後の月）。もう過ぎていれば出さない
      return {
        amount: once(goal.targetAmount),
        period: universityUntil(goal.childId, children, base),
        progress: ratio(goal.saved, goal.targetAmount),
      }
    case 'retirement':
      // 期限は `byYear` の前年の 12 月（積み立てる最後の月）
      return {
        amount: once(goal.targetAmount),
        period: `〜${formatEndExclusive(retirementUseMonth(goal))}`,
        progress: ratio(goal.saved, goal.targetAmount),
      }
    case 'home':
      return {
        amount: once(goal.price),
        period: `${goal.purchaseYear}年`,
        progress:
          compareYearMonth(homePurchaseMonth(goal), base) <= 0
            ? null
            : ratio(goal.saved, homeUpfrontCost(goal, defaults.home.closingCostRate.value)),
      }
    case 'car':
      return {
        amount: once(goal.price),
        period: `${goal.purchaseYear}年`,
        progress:
          goal.payment.type === 'cash' && !carAlreadyOwned(goal, base)
            ? ratio(goal.saved, goal.price)
            : null,
      }
    case 'childCost':
      // 金額は年ごとに変わる（学年・塾の行）ので 1 つに決まらず、出さない（毎月いくらは「計画」のカードが出す）。
      // 期限は高校を出る月（その子の費用の帯が終わる月）。もう出ていれば出さない。貯まり具合は無い（積立の型でない）
      return { amount: null, period: childCostUntil(goal, children, base), progress: null }
  }
}

/** 子の費用のカードの期限：「〜2029年3月」（高 3 の 3 月）。子が見つからない・もう高校を出ていれば null */
function childCostUntil(
  goal: ChildCostGoal,
  children: LifePlan['children'],
  base: YearMonth,
): string | null {
  const child = children.find((entry) => entry.id === goal.childId)
  if (child === undefined) return null
  // 高 3 の次の年度の 4 月の前まで（学年は 4 月に上がる。帯の終わりと同じ数え方）
  const end = yearMonth(
    schoolEntryYear(toLegacyChild(child, goal)) + FIRST_GRADE.university - 1,
    SCHOOL_YEAR_START_MONTH,
  )
  return compareYearMonth(end, base) <= 0 ? null : `〜${formatEndExclusive(end)}`
}

/** 大学資金のカードの期限：「〜2031年3月」（高 3 の 3 月）。子が見つからない・もう過ぎていれば null */
function universityUntil(
  childId: string,
  children: LifePlan['children'],
  base: YearMonth,
): string | null {
  const child = children.find((entry) => entry.id === childId)
  if (child === undefined) return null
  const end = universityUseMonth(child)
  return compareYearMonth(end, base) <= 0 ? null : `〜${formatEndExclusive(end)}`
}

/** 一度に払う金額（毎月でない）の見せ方 */
function once(yen: number): GoalSummary['amount'] {
  return { monthly: false, man: manNumber(yen) }
}

/** 貯まり具合。目標額が 0 なら出さない。貯まり過ぎは 1 で止める */
function ratio(saved: number, target: number): number | null {
  if (target <= 0) return null
  return Math.min(1, saved / target)
}

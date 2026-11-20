/**
 * 家のカードの知らせ。借りる額の目安（SPEC §3.7「毎月払えても、ローンを借りられないことがある」）と、
 * 買う月が近いのに頭金と諸費用が貯まり切っていないこと（SPEC §3.7 の「使う月まで 12 か月を切った一度きりの出費」と同じ考え方）。
 *
 * 「借りる額 ÷ 買う年の見込みの世帯年収」を出し、アプリの既定値の倍率（★）を超えたら知らせる。計算は止めない。
 * 買う月が起点の月以前（もう買った）のカードは、借りるかどうかを決める時を過ぎているので見ない。
 */

import { homeLoanPrincipal, homePurchaseMonth, homeUpfrontCost } from './bands/home'
import { expectedLevels, householdGross } from './taxBridge'
import type { HomeGoal, LifePlan, Notice, Yen } from './types'
import { compareYearMonth, monthsBetween } from './yearMonth'

/** 借りる額の目安の結果 */
export type HomeLoanCheck = {
  /** 借りる額（価格 − 頭金） */
  principal: Yen
  /** 買う年の見込みの世帯年収（本業 ＋ 副業の所得） */
  expectedGross: Yen
  /** 借りる額 ÷ 見込みの世帯年収。見込みが 0 なら null（割れない） */
  ratio: number | null
  /** 目安の倍率 */
  limit: number
  /** 目安を超えたか。見込みが 0 で借りるときも超えたとみなす。ちょうど目安の倍率は超えていない */
  over: boolean
}

/**
 * 家のカード 1 枚の借りる額の目安を出す。
 * 借りない（頭金で全額）・もう買った（買う月が起点の月以前）なら null
 *
 * @param limit 目安の倍率（`defaults.json` の `home.loanToIncomeLimit`）
 * @throws {RangeError} 倍率が正の数でないとき
 */
export function homeLoanCheck(plan: LifePlan, goal: HomeGoal, limit: number): HomeLoanCheck | null {
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new RangeError(`借りる額の目安の倍率は正の数で指定してください: ${limit}`)
  }
  const principal = homeLoanPrincipal(goal)
  if (principal <= 0) return null
  if (compareYearMonth(homePurchaseMonth(goal), plan.baseYearMonth) <= 0) return null

  const expectedGross = householdGross(expectedLevels(plan, goal.purchaseYear))
  const ratio = expectedGross > 0 ? principal / expectedGross : null
  return { principal, expectedGross, ratio, limit, over: ratio === null || ratio > limit }
}

/**
 * オンの家のカードのうち、買う月まで `soonMonths` か月を切っていて、頭金と諸費用がまだ貯まり切っていない物の知らせ
 * （`evaluate` が使う。自由入力の一度きりの `onceGoalSoon` と同じ考え方。貯まっている額で足りていれば出さない）。
 * もう買った（買う月が起点の月以前）カードは見ない
 *
 * @param closingCostRate 家の諸費用の率
 * @param soonMonths この月数を切ったら知らせる（`defaults.json` の `notices.onceSoonMonths` と同じ値を使う）
 */
export function homeSavingSoonNotices(
  plan: LifePlan,
  closingCostRate: number,
  soonMonths: number,
): Notice[] {
  const notices: Notice[] = []
  for (const goal of plan.goals) {
    if (goal.kind !== 'home' || !goal.enabled) continue
    const monthsLeft = monthsBetween(plan.baseYearMonth, homePurchaseMonth(goal))
    if (
      monthsLeft > 0 &&
      monthsLeft < soonMonths &&
      homeUpfrontCost(goal, closingCostRate) > goal.saved
    ) {
      notices.push({ kind: 'homeSavingSoon', goalId: goal.id, monthsLeft })
    }
  }
  return notices
}

/** オンの家のカードのうち、目安を超える物の知らせ（`evaluate` が使う） */
export function homeLoanNotices(plan: LifePlan, limit: number): Notice[] {
  const notices: Notice[] = []
  for (const goal of plan.goals) {
    if (goal.kind !== 'home' || !goal.enabled) continue
    const check = homeLoanCheck(plan, goal, limit)
    if (check?.over) {
      notices.push({ kind: 'homeLoanHeavy', goalId: goal.id, ratio: check.ratio, limit })
    }
  }
  return notices
}

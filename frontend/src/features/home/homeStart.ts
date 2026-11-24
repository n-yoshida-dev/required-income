/**
 * 目標がまだ無いときの「ながめる」（T25。SPEC §4.1「目標がまだ無いとき」。D48）。
 *
 * 結果（要る年収と図）を答えのように見せられないあいだは、今やること 1 つだけを出す：
 *
 * - 入力の途中（案内のあいだ）：目標の有無にかかわらず「続きを入れる」で「計画」の済んでいない最初の区分へ。
 *   家族・収入・暮らしに見本の値が残っているので、目標を足していても結果を出さない（W35・D49）
 * - 入力を終えて、自分で足した目標（子の費用のカードは子ごとに付くので数えない）が無い：「目標を足す」で「計画」の目標の区分へ
 *
 * 入力を終えて目標を 1 つでも足せば、ふつうの「ながめる」（目標を足したのに「まだ入っていません」と出さない）。
 * 見本の世帯のあいだは出さない（見本には目標がある）。React に依存しない関数にして、単体テストで確かめる。
 */

import type { Goal } from '../../domain/plan/types'
import type { Guide } from '../plan/guide'

/** 目標がまだ無いときに出す物。`to` は移る先（router の path） */
export type HomeStart = { sentence: string; action: string; to: string }

/** 入力の途中のとき */
export const RESUME_START: HomeStart = {
  sentence: '自分の数字を入れている途中です',
  action: '続きを入れる',
  // `/plan` は案内の済んでいない最初の区分へ置き換わる（router の PlanResume）
  to: '/plan',
}

/** 入力を終えたとき */
export const ADD_GOAL_START: HomeStart = {
  sentence: 'やりたいことが、まだ入っていません',
  action: '目標を足す',
  to: '/plan/goals',
}

/** 自分で足した目標の数（子の費用のカードは数えない。見直しで外した目標は数える） */
export function ownGoalCount(goals: readonly Pick<Goal, 'kind'>[]): number {
  return goals.filter((goal) => goal.kind !== 'childCost').length
}

/**
 * 「ながめる」の代わりに出す物を決める。ふつうの「ながめる」を出すときは null
 *
 * @param origin 見本の世帯か、利用者の計画か
 * @param goals 計画の目標カード
 * @param guide 案内の進み具合（null は案内のあいだでない）
 */
export function homeStart(
  origin: 'sample' | 'saved',
  goals: readonly Pick<Goal, 'kind'>[],
  guide: Guide | null,
): HomeStart | null {
  if (origin === 'sample') return null
  if (guide !== null) return RESUME_START
  return ownGoalCount(goals) > 0 ? null : ADD_GOAL_START
}

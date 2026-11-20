/**
 * 「計画」の各かたまりに渡す、直す操作の束。印（`touched`）の付け外しをここにまとめ、部品は計画の次の形を作るだけにする。
 */

import type { LifePlan } from '../../domain/plan/types'
import type { PlanIssues } from './planIssues'
import { isTouched } from './touched'

/** 直す操作の束 */
export type PlanEditor = {
  plan: LifePlan
  touched: readonly string[]
  issues: PlanIssues
  /**
   * 欄 1 つを直す。その欄に印を付ける。
   * `reset` に渡した欄の印は外す（直した結果、ほかの欄が既定値に戻るとき。カードの型の切り替えなど）
   */
  set: (key: string, next: LifePlan, reset?: readonly string[]) => void
  /** 行（大人・子・カード）を足す。足しただけでは印を付けない（中身は雛形＝既定値のまま） */
  add: (next: LifePlan) => void
  /** 行を外す。その行の印もまとめて外す（子を外すと子の費用のカードも消えるので、行を複数渡せる） */
  remove: (prefix: string | readonly string[], next: LifePlan) => void
}

/** 欄の部品に渡す「直したか」と「問題」 */
export function fieldState(
  editor: Pick<PlanEditor, 'touched' | 'issues'>,
  key: string,
): { touched: boolean; issue: string | null } {
  return { touched: isTouched(editor.touched, key), issue: editor.issues.get(key) ?? null }
}

/**
 * 大学資金・老後資金のカードの到達額の足し算（SPEC §3.2「大学資金・老後資金のカードの細部」の入力と画面）を、画面に出す行にする。
 *
 * 計算はせず、domain の答え（`FundPlan.reached`）を見せる桁（万円の小数 1 桁）にそろえるだけ。
 * 行ごとに丸めると足し算が 0.1 万円ずれて見えるので、段の内訳と同じ配り方（`shared/displayMan.ts` の `apportionMan`）で、
 * 画面に出ている数字どうしの和が答えの行にちょうど等しくなるようにする。
 */

import type { FundPlan, Yen } from '../../domain/plan/types'
import { apportionMan, roundMan } from '../shared/displayMan'

/** 見せる桁（万円の小数 1 桁） */
export const FUND_DIGITS = 1

/** 足し算の 1 行 */
export type FundRow = {
  key: 'allowance' | 'household' | 'saved'
  label: string
  /** 見せる値の円（0.1 万円単位） */
  yen: Yen
  /** 貯まっている額の行だけ：今の額（入れた額）。使う月までに増えないときは null（行は 1 つの数字だけ） */
  fromYen: Yen | null
}

/**
 * 到達額の行と答えを作る。児童手当の行は回すときだけ、貯まっている額の行は 0 より大きいときだけ
 *
 * @param allocate 児童手当を回すか（大学資金のカードの「回す」）
 * @param saved 入れた貯まっている額（今の額）
 */
export function fundRows(
  reached: FundPlan['reached'],
  allocate: boolean,
  saved: Yen,
): { rows: FundRow[]; total: Yen } {
  const rows: Omit<FundRow, 'yen'>[] = []
  const raw: Yen[] = []
  if (allocate) {
    rows.push({ key: 'allowance', label: '児童手当', fromYen: null })
    raw.push(reached.allowance)
  }
  rows.push({ key: 'household', label: '家計から足す', fromYen: null })
  raw.push(reached.household)
  if (reached.saved > 0) {
    // 利回りで増えるなら「今の額 → 使う月の額」と並べる。増えない（預金・利回り 0）なら 1 つだけ
    rows.push({
      key: 'saved',
      label: '貯まっている額',
      fromYen: reached.saved === saved ? null : saved,
    })
    raw.push(reached.saved)
  }
  const shown = apportionMan(raw, reached.total, FUND_DIGITS)
  return {
    rows: rows.map((row, index) => ({ ...row, yen: shown[index] ?? 0 })),
    total: roundMan(reached.total, FUND_DIGITS),
  }
}

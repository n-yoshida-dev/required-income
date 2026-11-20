/**
 * 大学資金・老後資金のカードの到達額の足し算（`fundRows`）。画面に出す数字（万円の小数 1 桁）どうしで、行の和が答えにちょうど等しいこと
 */

import { describe, expect, it } from 'vitest'
import { fundRows } from '../../../src/features/plan/fundRows'

describe('fundRows', () => {
  it('行ごとに丸めると 0.1 万円ずれる到達額でも、配り直して和を答えに合わせる', () => {
    // 行ごとの四捨五入だと 56.5 ＋ 81.1 ＋ 280.3 ＝ 417.9（答えは 418.0）
    const reached = { allowance: 564840, household: 811450, saved: 2803320, total: 4179610 }
    expect(reached.allowance + reached.household + reached.saved).toBe(reached.total)
    const { rows, total } = fundRows(reached, true, 2460000)
    expect(total).toBe(4180000)
    expect(rows.map((row) => row.key)).toEqual(['allowance', 'household', 'saved'])
    expect(rows.reduce((sum, row) => sum + row.yen, 0)).toBe(total)
    // 切り捨てられた端数のいちばん大きい行（家計 81.145 → 81.1）が 0.1 万円を受け持つ
    expect(rows.map((row) => row.yen)).toEqual([565000, 812000, 2803000])
  })

  it('貯まっている額は、増えるなら今の額も持ち、増えない（預金・利回り 0）なら 1 つだけ', () => {
    const grown = fundRows(
      { allowance: 0, household: 1000000, saved: 2100000, total: 3100000 },
      false,
      1900000,
    )
    expect(grown.rows.find((row) => row.key === 'saved')?.fromYen).toBe(1900000)
    const flat = fundRows(
      { allowance: 0, household: 1000000, saved: 1900000, total: 2900000 },
      false,
      1900000,
    )
    expect(flat.rows.find((row) => row.key === 'saved')?.fromYen).toBeNull()
  })

  it('児童手当の行は回すときだけ、貯まっている額の行は 0 より大きいときだけ', () => {
    const { rows } = fundRows(
      { allowance: 0, household: 1234567, saved: 0, total: 1234567 },
      false,
      0,
    )
    expect(rows.map((row) => row.key)).toEqual(['household'])
    expect(rows[0]?.yen).toBe(1235000)
  })
})

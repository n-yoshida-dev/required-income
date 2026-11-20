/**
 * 画面に出す万円の丸め（SPEC §4.1 の 2「内訳の万円の配り方」。「計画」の大学資金・老後資金のカードの到達額の足し算も同じ。T10）。
 * 計算はせず、見せる桁にそろえるだけ。
 *
 * 計算（`domain/`）は円で合っていても、行ごとに万円へ丸めると、画面の数字どうしの足し算が 1 万円ずれて見える
 * （例：行を足すと 941、手取りは 942）。そこで次の決まりで、画面に出ている万円どうしの足し引きを合わせる。
 *
 * - 合計（手取り・要る世帯年収・見込み）は、それぞれ四捨五入して見せる
 * - 内訳の行は、まず四捨五入し、行の和が合計の見せる値と違う分を 1 単位（1 万円）ずつ配る（最大剰余方式）：
 *   足りないときは「切り捨てられた端数がいちばん大きい行」から 1 単位足し、多すぎるときは「切り上げられた端数がいちばん大きい行」から 1 単位引く。
 *   端数が同じなら金額の絶対値が大きい行、それも同じなら上の行を先にする。ずれが行の数より大きければ、同じ順でもう 1 周する
 * - 差の数字（税・社会保険、見込みより +◯、換算の +◯）は、見せる値どうしの引き算で出す
 *
 * 戻り値はどれも「見せる値の円」（1 万円単位なら 10,000 の倍数）。文字にするのは `format.ts` の `manNumber`。
 */

import type { Yen } from '../../domain/plan/types'

/** 万円の小数の桁数に対応する、見せる 1 単位の円 */
function unitOf(digits: number): number {
  return 10000 / 10 ** digits
}

/** 見せる桁（万円の小数 `digits` 桁）に四捨五入した円 */
export function roundMan(yen: Yen, digits = 0): Yen {
  const unit = unitOf(digits)
  return Math.round(yen / unit) * unit
}

/**
 * 内訳の行を、見せる桁で合計に合うように丸める（上の最大剰余方式）。
 *
 * @param values 行の円（負の行があってよい）
 * @param total 合計の円。見せる値は `roundMan(total, digits)`
 * @returns 行ごとの見せる値の円。和は `roundMan(total, digits)` にちょうど等しい
 */
export function apportionMan(values: readonly Yen[], total: Yen, digits = 0): Yen[] {
  const unit = unitOf(digits)
  const units = values.map((value) => Math.round(value / unit))
  if (values.length === 0) return []
  const target = Math.round(total / unit)
  let gap = target - units.reduce((sum, value) => sum + value, 0)
  if (gap === 0) return units.map((value) => value * unit)

  // 端数（四捨五入でどれだけ動いたか）。正なら切り捨てられた分、負なら切り上げられた分
  const order = values
    .map((value, index) => ({
      index,
      rest: value / unit - (units[index] ?? 0),
      size: Math.abs(value),
    }))
    .sort((a, b) => {
      const byRest = gap > 0 ? b.rest - a.rest : a.rest - b.rest
      if (byRest !== 0) return byRest
      if (b.size !== a.size) return b.size - a.size
      return a.index - b.index
    })

  const step = gap > 0 ? 1 : -1
  for (let i = 0; gap !== 0; i = (i + 1) % order.length) {
    const entry = order[i]
    if (entry === undefined) break
    units[entry.index] = (units[entry.index] ?? 0) + step
    gap -= step
  }
  return units.map((value) => value * unit)
}

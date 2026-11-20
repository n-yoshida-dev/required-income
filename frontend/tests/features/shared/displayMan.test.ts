import { describe, expect, it } from 'vitest'
import { apportionMan, roundMan } from '../../../src/features/shared/displayMan'

/** 円の配列の和 */
const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0)

describe('roundMan', () => {
  it('見せる桁に四捨五入した円を返す', () => {
    expect(roundMan(9_415_000)).toBe(9_420_000)
    expect(roundMan(9_414_999)).toBe(9_410_000)
    expect(roundMan(278_600, 1)).toBe(279_000)
    expect(roundMan(0)).toBe(0)
  })
})

describe('apportionMan', () => {
  it('四捨五入の和が合計と合えば、そのまま', () => {
    expect(apportionMan([3_000_000, 2_000_000], 5_000_000)).toEqual([3_000_000, 2_000_000])
  })

  it('和が足りないときは、切り捨てられた端数がいちばん大きい行に 1 万円足す', () => {
    // 四捨五入：312・264・159（和 735）。合計 735.9 → 736。端数は 0.4・0.3・0.2 なので 312 の行に足す
    const rows = [3_124_000, 2_643_000, 1_592_000]
    const shown = apportionMan(rows, sum(rows))
    expect(shown).toEqual([3_130_000, 2_640_000, 1_590_000])
    expect(sum(shown)).toBe(roundMan(sum(rows)))
  })

  it('和が多すぎるときは、切り上げられた端数がいちばん大きい行から 1 万円引く', () => {
    // 四捨五入：313・265・159（和 737）。合計 736.6 → 737 になるので、合計を 736 にずらして確かめる
    const rows = [3_126_000, 2_645_000, 1_590_000]
    const shown = apportionMan(rows, 7_360_000)
    // 端数（切り上げの分）は 0.4・0.5・0 → 265 の行から引く
    expect(shown).toEqual([3_130_000, 2_640_000, 1_590_000])
    expect(sum(shown)).toBe(7_360_000)
  })

  it('端数が同じなら金額の大きい行、それも同じなら上の行を先にする', () => {
    // 端数はどちらも 0.25（2 進数で割り切れる値にして、比べ方を確かめる）
    expect(apportionMan([1_002_500, 2_002_500], 3_005_000)).toEqual([1_000_000, 2_010_000])
    expect(apportionMan([1_002_500, 1_002_500], 2_010_000)).toEqual([1_010_000, 1_000_000])
  })

  it('負の行（収入の帯）があっても和が合計に合う', () => {
    const rows = [5_004_000, -1_004_000, 2_004_000]
    const shown = apportionMan(rows, sum(rows))
    expect(sum(shown)).toBe(roundMan(sum(rows)))
  })

  it('ずれが行の数より大きければ、同じ順でもう 1 周する', () => {
    const shown = apportionMan([1_000_000, 1_000_000], 1_040_000 + 1_000_000)
    expect(shown).toEqual([1_020_000, 1_020_000])
  })

  it('行が 1 つなら、その行は合計の四捨五入と同じ', () => {
    expect(apportionMan([3_126_000], 3_126_000)).toEqual([3_130_000])
    // 合計が行とずれていても、行は合計の見せ方に合わせる
    expect(apportionMan([3_126_000], 3_136_000)).toEqual([3_140_000])
  })

  it('全部 0 円なら、全部 0 円のまま', () => {
    expect(apportionMan([0, 0, 0], 0)).toEqual([0, 0, 0])
  })

  it('小数 1 桁（副業の月額など）でも配れる', () => {
    // 1 単位は 1,000 円。行は 1.2 万円ずつ、合計 2.47 万円 → 2.5 万円
    const shown = apportionMan([12_340, 12_340], 24_680, 1)
    expect(shown).toEqual([13_000, 12_000])
    expect(sum(shown)).toBe(roundMan(24_680, 1))
  })

  it('行が無ければ空', () => {
    expect(apportionMan([], 1_000_000)).toEqual([])
  })
})

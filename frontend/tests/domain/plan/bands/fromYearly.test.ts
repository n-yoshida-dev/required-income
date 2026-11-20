import { describe, expect, it } from 'vitest'
import { bandsFromYearly } from '../../../../src/domain/plan/bands/fromYearly'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'

const meta = { goalId: 'goal-x', label: '学校', kind: 'payment' as const }

describe('bandsFromYearly（年額 → 同じ額の続く区間の帯）', () => {
  it('年度（4 月始まり）：同じ額の年はまとめ、額が変わる年度の 4 月で切る。0 円の年は帯にしない', () => {
    // 2031 年度から 2032 年度は年 120,000、2033 年度は年 240,000、2034 年度からは 0
    const annual = (year: number) =>
      year <= 2030 ? 0 : year <= 2032 ? 120000 : year === 2033 ? 240000 : 0
    const bands = bandsFromYearly(
      meta,
      annual,
      { from: yearMonth(2031, 1), to: yearMonth(2040, 1) },
      4,
    )
    expect(bands).toEqual([
      { ...meta, monthly: 10000, from: yearMonth(2031, 4), to: yearMonth(2033, 4) },
      { ...meta, monthly: 20000, from: yearMonth(2033, 4), to: yearMonth(2034, 4) },
    ])
  })

  it('起点が 1〜3 月なら前の年の年度から数え、帯は起点から始める。終わりは区間の終わりで切る', () => {
    const asked: number[] = []
    const bands = bandsFromYearly(
      meta,
      (year) => {
        asked.push(year)
        return 60000
      },
      { from: yearMonth(2031, 2), to: yearMonth(2032, 7) },
      4,
    )
    expect(asked).toEqual([2030, 2031, 2032])
    expect(bands).toEqual([
      { ...meta, monthly: 5000, from: yearMonth(2031, 2), to: yearMonth(2032, 7) },
    ])
  })

  it('月額は年額 ÷ 12 を円に四捨五入する（年度ごとに 1 回）', () => {
    const bands = bandsFromYearly(
      meta,
      () => 110110,
      { from: yearMonth(2031, 4), to: yearMonth(2032, 4) },
      4,
    )
    // 110,110 ÷ 12 = 9,175.83… → 9,176
    expect(bands.map((b) => b.monthly)).toEqual([9176])
  })

  it('区間が空なら帯を出さない。年額が負なら契約違反として投げる', () => {
    expect(
      bandsFromYearly(meta, () => 12000, { from: yearMonth(2031, 4), to: yearMonth(2031, 4) }, 4),
    ).toEqual([])
    expect(() =>
      bandsFromYearly(meta, () => -1, { from: yearMonth(2031, 4), to: yearMonth(2032, 4) }, 4),
    ).toThrow(RangeError)
  })

  it('暦年（1 月始まり）でも使える', () => {
    const bands = bandsFromYearly(
      meta,
      (year) => (year === 2032 ? 24000 : 12000),
      { from: yearMonth(2031, 6), to: yearMonth(2034, 1) },
      1,
    )
    expect(bands).toEqual([
      { ...meta, monthly: 1000, from: yearMonth(2031, 6), to: yearMonth(2032, 1) },
      { ...meta, monthly: 2000, from: yearMonth(2032, 1), to: yearMonth(2033, 1) },
      { ...meta, monthly: 1000, from: yearMonth(2033, 1), to: yearMonth(2034, 1) },
    ])
  })
})

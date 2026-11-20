import { describe, expect, it } from 'vitest'
import { livingBands } from '../../../../src/domain/plan/bands/living'
import type { BandContext } from '../../../../src/domain/plan/types'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'
import { tables } from '../planFixtures'

/** 暮らしの帯は物価を引数で受け取るので、前提と既定値は使わない（0 を入れておく） */
const unused = {
  children: [],
  tables,
  assumptions: { inflationRate: 0, mortgageRate: 0, investmentReturnRate: 0 },
  settings: { homeClosingCostRate: 0, carResaleRate: 0, carLoanRate: 0 },
  allowanceEarmarked: new Set<string>(),
}
const ctx: BandContext = { base: yearMonth(2026, 11), until: yearMonth(2030, 1), ...unused }
const living = { monthlyLivingCost: 260000, monthlyRent: 95000 }

describe('livingBands', () => {
  it('物価 0 なら生活費と家賃が 1 本ずつ、起点から until の前まで', () => {
    expect(livingBands(living, 0, ctx)).toEqual([
      {
        goalId: 'living',
        label: '生活費',
        kind: 'payment',
        monthly: 260000,
        from: { year: 2026, month: 11 },
        to: { year: 2030, month: 1 },
      },
      {
        goalId: 'living',
        label: '家賃',
        kind: 'payment',
        monthly: 95000,
        from: { year: 2026, month: 11 },
        to: { year: 2030, month: 1 },
      },
    ])
  })

  it('家賃は rentUntil の前まで。起点以前に終わるなら家賃の帯は出さない', () => {
    const rent = livingBands(living, 0, ctx, yearMonth(2028, 4)).find((b) => b.label === '家賃')
    expect(rent?.to).toEqual({ year: 2028, month: 4 })
    expect(livingBands(living, 0, ctx, yearMonth(2026, 11)).map((b) => b.label)).toEqual(['生活費'])
  })

  it('0 円の生活費・家賃も月額 0 の帯として出す', () => {
    const bands = livingBands({ monthlyLivingCost: 0, monthlyRent: 0 }, 0, ctx)
    expect(bands.map((b) => b.monthly)).toEqual([0, 0])
  })

  it('物価が 0 でなければ、生活費を暦年ごとに分けて起点の年からの物価を掛ける（家賃には掛けない）', () => {
    const bands = livingBands(living, 0.02, ctx)
    const cost = bands.filter((b) => b.label === '生活費')
    // 260,000 × 1.02 = 265,200、× 1.02² = 270,504、× 1.02³ = 275,914.08 → 275,914
    expect(cost.map((b) => [b.from, b.to, b.monthly])).toEqual([
      [{ year: 2026, month: 11 }, { year: 2027, month: 1 }, 260000],
      [{ year: 2027, month: 1 }, { year: 2028, month: 1 }, 265200],
      [{ year: 2028, month: 1 }, { year: 2029, month: 1 }, 270504],
      [{ year: 2029, month: 1 }, { year: 2030, month: 1 }, 275914],
    ])
    expect(bands.find((b) => b.label === '家賃')?.monthly).toBe(95000)
  })

  it('数える期間が無い（until が起点と同じ）なら帯を出さない', () => {
    const empty: BandContext = { ...ctx, until: yearMonth(2026, 11) }
    expect(livingBands(living, 0, empty)).toEqual([])
    expect(livingBands(living, 0.02, empty)).toEqual([])
  })

  it('金額が負なら投げる', () => {
    expect(() => livingBands({ monthlyLivingCost: -1, monthlyRent: 0 }, 0, ctx)).toThrow(RangeError)
    expect(() => livingBands({ monthlyLivingCost: 0, monthlyRent: -1 }, 0, ctx)).toThrow(RangeError)
  })
})

import { describe, expect, it } from 'vitest'
import { assertBand, makeBand } from '../../../../src/domain/plan/bands/band'
import type { Band } from '../../../../src/domain/plan/types'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'

const band = (overrides: Partial<Band> = {}): Band => ({
  goalId: 'goal-a',
  label: 'テスト',
  kind: 'payment',
  monthly: 10000,
  from: yearMonth(2027, 1),
  to: yearMonth(2028, 1),
  ...overrides,
})

describe('makeBand / assertBand', () => {
  it('正しい帯はそのまま返す。月額 0 円と長さ 0 の帯は認める', () => {
    expect(makeBand(band())).toEqual(band())
    expect(() => assertBand(band({ monthly: 0 }))).not.toThrow()
    expect(() => assertBand(band({ to: yearMonth(2027, 1) }))).not.toThrow()
  })

  it('月額が負・小数・NaN なら投げる', () => {
    expect(() => assertBand(band({ monthly: -1 }))).toThrow(RangeError)
    expect(() => assertBand(band({ monthly: 0.5 }))).toThrow(RangeError)
    expect(() => assertBand(band({ monthly: Number.NaN }))).toThrow(RangeError)
  })

  it('始まりが終わりより後なら契約違反', () => {
    expect(() => makeBand(band({ from: yearMonth(2028, 2), to: yearMonth(2028, 1) }))).toThrow(
      /始まり.*終わり.*より後/,
    )
  })
})

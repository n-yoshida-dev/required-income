import { describe, expect, it } from 'vitest'
import {
  assertNonNegativeYen,
  findForYear,
  pickBand,
  pickForYear,
  pickRange,
  roundDownTo,
} from '../../../src/domain/tax/schedule'

const schedule = [
  { fromYear: 2020, untilYear: 2024, label: 'a' },
  { fromYear: 2025, untilYear: 2025, label: 'b' },
  { fromYear: 2026, untilYear: null, label: 'c' },
]

describe('pickForYear', () => {
  it('fromYear 以上 untilYear 以下の段を引く（境界は両端とも含む）', () => {
    expect(pickForYear(schedule, 2020, 'x').label).toBe('a')
    expect(pickForYear(schedule, 2024, 'x').label).toBe('a')
    expect(pickForYear(schedule, 2025, 'x').label).toBe('b')
    expect(pickForYear(schedule, 2026, 'x').label).toBe('c')
  })

  it('untilYear が null の段は終期未定として将来の年にも効く', () => {
    expect(pickForYear(schedule, 2060, 'x').label).toBe('c')
  })

  it('効く段が無い年は例外（表の欠落・対応外の年）', () => {
    expect(() => pickForYear(schedule, 2019, '給与所得控除')).toThrow(RangeError)
    expect(() => pickForYear(schedule, 2025.5, 'x')).toThrow(RangeError)
  })

  it('findForYear は無ければ null（途中の年分から創設された控除に使う）', () => {
    expect(findForYear(schedule, 2019)).toBeNull()
    expect(findForYear(schedule, 2025)?.label).toBe('b')
  })
})

describe('pickBand', () => {
  const table = [
    { upTo: 1000, value: 'low' },
    { upTo: 2000, value: 'mid' },
    { upTo: null, value: 'high' },
  ]

  it('金額が upTo 以下になる最初の行を引く。境界ちょうどは下の行', () => {
    expect(pickBand(table, 0, (row) => row.upTo, 'x').value).toBe('low')
    expect(pickBand(table, 1000, (row) => row.upTo, 'x').value).toBe('low')
    expect(pickBand(table, 1001, (row) => row.upTo, 'x').value).toBe('mid')
    expect(pickBand(table, 999999, (row) => row.upTo, 'x').value).toBe('high')
  })

  it('上限なしの行が無い表で上限を超えると例外', () => {
    const capped = table.slice(0, 2)
    expect(() => pickBand(capped, 3000, (row) => row.upTo, 'x')).toThrow(RangeError)
  })

  it('金額が有限でなければ例外', () => {
    expect(() => pickBand(table, Number.NaN, (row) => row.upTo, 'x')).toThrow(RangeError)
  })
})

describe('pickRange', () => {
  const table = [
    { over: 100, upTo: 200, amount: 1 },
    { over: 200, upTo: null, amount: 2 },
  ]
  const rangeOf = (row: (typeof table)[number]) => ({ over: row.over, upTo: row.upTo })

  it('over 超 upTo 以下の行を引く。下端ちょうどは入らず、上端ちょうどは入る', () => {
    expect(pickRange(table, 100, rangeOf)).toBeNull()
    expect(pickRange(table, 101, rangeOf)?.amount).toBe(1)
    expect(pickRange(table, 200, rangeOf)?.amount).toBe(1)
    expect(pickRange(table, 201, rangeOf)?.amount).toBe(2)
  })

  it('帯の外は null（控除なし）で例外にしない', () => {
    expect(pickRange(table, 50, rangeOf)).toBeNull()
  })
})

describe('roundDownTo / assertNonNegativeYen', () => {
  it('単位で切り捨てる', () => {
    expect(roundDownTo(1766680, 1000)).toBe(1766000)
    expect(roundDownTo(500500, 1000)).toBe(500000)
    expect(roundDownTo(999, 1000)).toBe(0)
  })

  it('単位が正の整数でなければ例外', () => {
    expect(() => roundDownTo(1000, 0)).toThrow(RangeError)
    expect(() => roundDownTo(1000, 0.5)).toThrow(RangeError)
  })

  it('負の金額を弾く', () => {
    expect(() => assertNonNegativeYen(-1, 'x')).toThrow(RangeError)
    expect(() => assertNonNegativeYen(Number.POSITIVE_INFINITY, 'x')).toThrow(RangeError)
    expect(() => assertNonNegativeYen(0, 'x')).not.toThrow()
  })
})

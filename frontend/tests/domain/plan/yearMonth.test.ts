import { describe, expect, it } from 'vitest'
import {
  addMonths,
  assertYearMonth,
  compareYearMonth,
  fromMonthIndex,
  laterOf,
  monthIndex,
  monthsBetween,
  monthsInYear,
  overlapMonths,
  parseYearMonth,
  startOfYear,
  yearMonth,
} from '../../../src/domain/plan/yearMonth'
import type { YearMonth } from '../../../src/domain/plan/types'

describe('yearMonth', () => {
  it('1 月と 12 月を作れる', () => {
    expect(yearMonth(2026, 1)).toEqual({ year: 2026, month: 1 })
    expect(yearMonth(2026, 12)).toEqual({ year: 2026, month: 12 })
  })

  it('月が 0・13・小数、年が小数なら投げる', () => {
    expect(() => yearMonth(2026, 0)).toThrow(RangeError)
    expect(() => yearMonth(2026, 13)).toThrow(RangeError)
    expect(() => yearMonth(2026, 1.5)).toThrow(RangeError)
    expect(() => yearMonth(2026.5, 1)).toThrow(RangeError)
  })

  it('assertYearMonth は壊れた年月を投げる', () => {
    expect(() =>
      assertYearMonth({ year: 2026, month: 13 } as unknown as YearMonth, '起点'),
    ).toThrow(/起点/)
    expect(() => assertYearMonth(yearMonth(2026, 4), '起点')).not.toThrow()
  })
})

describe('parseYearMonth', () => {
  it('"YYYY-MM" を読む', () => {
    expect(parseYearMonth('2028-08')).toEqual({ year: 2028, month: 8 })
    expect(parseYearMonth('2026-12')).toEqual({ year: 2026, month: 12 })
  })

  it('形が違う・月が範囲外なら投げる', () => {
    expect(() => parseYearMonth('2026-1')).toThrow(RangeError)
    expect(() => parseYearMonth('2026/01')).toThrow(RangeError)
    expect(() => parseYearMonth('2026-13')).toThrow(RangeError)
    expect(() => parseYearMonth('2026-00')).toThrow(RangeError)
  })
})

describe('月の通し番号とずらし', () => {
  it('12 月の翌月は翌年 1 月、1 月の前月は前年 12 月', () => {
    expect(addMonths(yearMonth(2026, 12), 1)).toEqual({ year: 2027, month: 1 })
    expect(addMonths(yearMonth(2027, 1), -1)).toEqual({ year: 2026, month: 12 })
    expect(addMonths(yearMonth(2026, 11), 14)).toEqual({ year: 2028, month: 1 })
  })

  it('通し番号は行って戻ると同じ年月になる', () => {
    for (const ym of [yearMonth(2026, 1), yearMonth(2026, 12), yearMonth(2030, 6)]) {
      expect(fromMonthIndex(monthIndex(ym))).toEqual(ym)
    }
  })

  it('小数の月数・通し番号は投げる', () => {
    expect(() => addMonths(yearMonth(2026, 1), 0.5)).toThrow(RangeError)
    expect(() => fromMonthIndex(1.5)).toThrow(RangeError)
  })

  it('比べる・後のほうを取る・その年の 1 月', () => {
    expect(compareYearMonth(yearMonth(2026, 12), yearMonth(2027, 1))).toBeLessThan(0)
    expect(compareYearMonth(yearMonth(2027, 1), yearMonth(2027, 1))).toBe(0)
    expect(laterOf(yearMonth(2026, 12), yearMonth(2027, 1))).toEqual({ year: 2027, month: 1 })
    expect(startOfYear(2030)).toEqual({ year: 2030, month: 1 })
  })

  it('monthsBetween は to の前までの月数。逆向きは負', () => {
    expect(monthsBetween(yearMonth(2026, 11), yearMonth(2028, 8))).toBe(21)
    expect(monthsBetween(yearMonth(2026, 11), yearMonth(2026, 11))).toBe(0)
    expect(monthsBetween(yearMonth(2026, 11), yearMonth(2026, 10))).toBe(-1)
  })
})

describe('overlapMonths', () => {
  const ym = yearMonth

  it('重なる月数を数える', () => {
    expect(overlapMonths(ym(2026, 3), ym(2026, 9), ym(2026, 1), ym(2027, 1))).toBe(6)
    expect(overlapMonths(ym(2025, 3), ym(2026, 3), ym(2026, 1), ym(2027, 1))).toBe(2)
  })

  it('接しているだけ（終わりの月と次の始まりの月が同じ）は 0', () => {
    expect(overlapMonths(ym(2026, 1), ym(2026, 3), ym(2026, 3), ym(2026, 6))).toBe(0)
  })

  it('離れていれば 0、長さ 0 の区間も 0', () => {
    expect(overlapMonths(ym(2020, 1), ym(2021, 1), ym(2026, 1), ym(2027, 1))).toBe(0)
    expect(overlapMonths(ym(2026, 5), ym(2026, 5), ym(2026, 1), ym(2027, 1))).toBe(0)
  })

  it('始まりが終わりより後の区間は契約違反', () => {
    expect(() => overlapMonths(ym(2026, 5), ym(2026, 4), ym(2026, 1), ym(2027, 1))).toThrow(
      RangeError,
    )
  })
})

describe('monthsInYear', () => {
  const ym = yearMonth

  it('年をまたぐ帯は年ごとに分けて数える', () => {
    expect(monthsInYear(ym(2026, 11), ym(2027, 3), 2026)).toBe(2)
    expect(monthsInYear(ym(2026, 11), ym(2027, 3), 2027)).toBe(2)
    expect(monthsInYear(ym(2026, 11), ym(2027, 3), 2028)).toBe(0)
  })

  it('1 月から翌年 1 月の前までは 12 か月、12 月だけは 1 か月、1 月だけは 1 か月', () => {
    expect(monthsInYear(ym(2026, 1), ym(2027, 1), 2026)).toBe(12)
    expect(monthsInYear(ym(2026, 12), ym(2027, 1), 2026)).toBe(1)
    expect(monthsInYear(ym(2026, 12), ym(2027, 1), 2027)).toBe(0)
    expect(monthsInYear(ym(2027, 1), ym(2027, 2), 2027)).toBe(1)
  })
})

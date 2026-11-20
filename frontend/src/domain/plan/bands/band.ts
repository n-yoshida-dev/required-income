/**
 * 帯 1 本の作り方と確かめ方。どのカードの展開もここを通して帯を作る。
 */

import type { Band, Yen } from '../types'
import { assertYearMonth, compareYearMonth } from '../yearMonth'

/** 金額が 0 以上の円の整数かを確かめる。違えば契約違反として投げる */
export function assertNonNegativeYen(value: Yen, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label}は 0 以上の円の整数で指定してください: ${value}`)
  }
}

/**
 * 帯が契約どおりかを確かめる。違えば投げる。
 * 月額は 0 以上の整数、年月は正しい形、始まりは終わりより後でない（同じ月は長さ 0 の帯として認める）。
 */
export function assertBand(band: Band): void {
  assertNonNegativeYen(band.monthly, `帯「${band.label}」の月額`)
  assertYearMonth(band.from, `帯「${band.label}」の始まり`)
  assertYearMonth(band.to, `帯「${band.label}」の終わり`)
  if (compareYearMonth(band.from, band.to) > 0) {
    throw new RangeError(
      `帯「${band.label}」の始まり（${band.from.year}-${band.from.month}）が終わり（${band.to.year}-${band.to.month}）より後です`,
    )
  }
}

/** 帯を作る。契約に反していれば投げる */
export function makeBand(band: Band): Band {
  assertBand(band)
  return band
}

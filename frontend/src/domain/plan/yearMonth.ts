/**
 * 年月の扱い（SPEC §1 `yearMonth.ts`）。
 *
 * 帯は「この月から、この月の前まで」の半開区間で持つ。月の数え方をここだけに置き、
 * 帯の展開と年ごとの要る手取りが同じ数え方をするようにする。
 */

import type { Month, Year, YearMonth } from './types'

/** 年月を作る。年が整数でない、月が 1〜12 でないときは契約違反として投げる */
export function yearMonth(year: number, month: number): YearMonth {
  if (!Number.isInteger(year)) {
    throw new RangeError(`年は整数で指定してください: ${year}`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`月は 1〜12 の整数で指定してください: ${month}`)
  }
  return { year, month: month as Month }
}

/** 渡された値が正しい年月かを確かめる。正しくなければ投げる */
export function assertYearMonth(value: YearMonth, label: string): void {
  try {
    yearMonth(value.year, value.month)
  } catch (error) {
    throw new RangeError(`${label}が正しい年月ではありません`, { cause: error })
  }
}

/** `"YYYY-MM"` の文字列を年月に直す（JSON の既定値を読むため）。形が違えば投げる */
export function parseYearMonth(text: string): YearMonth {
  const matched = /^(\d{4})-(\d{2})$/.exec(text)
  if (matched === null) {
    throw new RangeError(`年月は "YYYY-MM" の形で指定してください: ${text}`)
  }
  return yearMonth(Number(matched[1]), Number(matched[2]))
}

/** その年の 1 月 */
export function startOfYear(year: Year): YearMonth {
  return yearMonth(year, 1)
}

/** 年月を通し番号（月の数）に直す。差を取れば月数になる */
export function monthIndex(value: YearMonth): number {
  return value.year * 12 + (value.month - 1)
}

/** 通し番号から年月に戻す */
export function fromMonthIndex(index: number): YearMonth {
  if (!Number.isInteger(index)) {
    throw new RangeError(`月の通し番号は整数で指定してください: ${index}`)
  }
  const year = Math.floor(index / 12)
  return yearMonth(year, index - year * 12 + 1)
}

/** 年月を比べる。a が前なら負、同じなら 0、後なら正 */
export function compareYearMonth(a: YearMonth, b: YearMonth): number {
  return monthIndex(a) - monthIndex(b)
}

/** 2 つのうち後の年月 */
export function laterOf(a: YearMonth, b: YearMonth): YearMonth {
  return compareYearMonth(a, b) >= 0 ? a : b
}

/** 年月を n か月ずらす（n は負でもよい） */
export function addMonths(value: YearMonth, months: number): YearMonth {
  if (!Number.isInteger(months)) {
    throw new RangeError(`ずらす月数は整数で指定してください: ${months}`)
  }
  return fromMonthIndex(monthIndex(value) + months)
}

/** from から to の前までの月数。to が from より前なら負になる（呼び出し側が扱いを決める） */
export function monthsBetween(from: YearMonth, to: YearMonth): number {
  return monthIndex(to) - monthIndex(from)
}

/**
 * 2 つの区間 [aFrom, aTo) と [bFrom, bTo) が重なる月数。重ならなければ 0。
 * どちらかの区間の始まりが終わりより後なら契約違反として投げる。
 */
export function overlapMonths(
  aFrom: YearMonth,
  aTo: YearMonth,
  bFrom: YearMonth,
  bTo: YearMonth,
): number {
  if (compareYearMonth(aFrom, aTo) > 0 || compareYearMonth(bFrom, bTo) > 0) {
    throw new RangeError('区間の始まりが終わりより後です')
  }
  const start = Math.max(monthIndex(aFrom), monthIndex(bFrom))
  const end = Math.min(monthIndex(aTo), monthIndex(bTo))
  return Math.max(0, end - start)
}

/** 区間 [from, to) が、ある年（1〜12 月）に何か月重なるか */
export function monthsInYear(from: YearMonth, to: YearMonth, year: Year): number {
  return overlapMonths(from, to, startOfYear(year), startOfYear(year + 1))
}

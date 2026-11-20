/**
 * 制度の表から「その年に効く 1 段」「その金額が入る 1 行」を引く共通関数。
 *
 * 税制の表は年分で切り替わる段（`schedule[]`。D25）と、金額の帯で決まる行（`upTo` / `totalIncomeUpTo`）の
 * 2 種類の引き方しかない。引き方を 1 か所に集めて、各税で境界の扱い（以下／未満）がぶれないようにする。
 *
 * 見つからないのは表の欠落（データの不備）か対応外の年なので、契約違反として例外を投げる。
 */

import type { Year, YearRange, Yen } from '../types'

/**
 * `fromYear` 以上 `untilYear` 以下（null は終期未定）の段を返す。
 *
 * @param label エラーメッセージに出す表の名前
 * @throws {RangeError} 年が整数でない、その年に効く段が無いとき
 */
export function pickForYear<T extends YearRange>(
  schedule: readonly T[],
  year: Year,
  label: string,
): T {
  assertYear(year)
  const found = schedule.find(
    (entry) => entry.fromYear <= year && (entry.untilYear === null || year <= entry.untilYear),
  )
  if (found === undefined) {
    throw new RangeError(`${label}に ${year} 年分の表がありません`)
  }
  return found
}

/**
 * `pickForYear` と同じ引き方で、無ければ null を返す。
 *
 * 途中の年分から創設された控除（特定親族特別控除は 2025 年分から）のように、
 * 「その年に表が無い」ことが正当な結果（＝適用なし）になる表に使う。
 */
export function findForYear<T extends YearRange>(schedule: readonly T[], year: Year): T | null {
  assertYear(year)
  const found = schedule.find(
    (entry) => entry.fromYear <= year && (entry.untilYear === null || year <= entry.untilYear),
  )
  return found ?? null
}

/**
 * 金額が `upTo` 以下になる最初の行を返す（`upTo` が null の行は上限なし）。
 *
 * 表は `upTo` の昇順で並んでいる前提。「以下」で判定するので、ちょうど境界の金額は下の行に入る
 * （課税所得 195 万円ちょうどは 5% の行）。
 *
 * @throws {RangeError} 金額が有限でない、どの行にも入らないとき（上限なしの行が無い表）
 */
export function pickBand<T>(
  table: readonly T[],
  amount: Yen,
  upToOf: (row: T) => Yen | null,
  label: string,
): T {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`${label}を引く金額が有限の数値ではありません: ${amount}`)
  }
  const found = table.find((row) => {
    const upTo = upToOf(row)
    return upTo === null || amount <= upTo
  })
  if (found === undefined) {
    throw new RangeError(`${label}に ${amount} 円が入る行がありません`)
  }
  return found
}

/**
 * 金額が `over` 超 `upTo` 以下になる行を返す。無ければ null（＝その控除は適用されない）。
 *
 * 配偶者特別控除・特定親族特別控除のように「所得要件を超えてから上限まで」の帯で額が決まる表に使う。
 * 帯の外は控除なしが正しい結果なので、`pickBand` と違って例外にしない。
 */
export function pickRange<T>(
  table: readonly T[],
  amount: Yen,
  rangeOf: (row: T) => { over: Yen; upTo: Yen | null },
): T | null {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`帯を引く金額が有限の数値ではありません: ${amount}`)
  }
  const found = table.find((row) => {
    const { over, upTo } = rangeOf(row)
    return over < amount && (upTo === null || amount <= upTo)
  })
  return found ?? null
}

/**
 * 金額を `unit` 単位で切り捨てる（課税所得の 1,000 円未満切捨て、標準賞与額の 1,000 円未満切捨て）。
 *
 * @throws {RangeError} 単位が正の整数でない、金額が有限でないとき
 */
export function roundDownTo(amount: Yen, unit: number): Yen {
  if (!Number.isInteger(unit) || unit <= 0) {
    throw new RangeError(`切り捨ての単位は正の整数で指定してください: ${unit}`)
  }
  if (!Number.isFinite(amount)) {
    throw new RangeError(`金額が有限の数値ではありません: ${amount}`)
  }
  return Math.floor(amount / unit) * unit
}

/**
 * 年の指定を検証する。
 *
 * @throws {RangeError} 整数でないとき
 */
export function assertYear(year: Year): void {
  if (!Number.isInteger(year)) {
    throw new RangeError(`年は整数で指定してください: ${year}`)
  }
}

/**
 * 金額が 0 以上の有限の数値かを検証する。
 *
 * @throws {RangeError} 負または有限でないとき
 */
export function assertNonNegativeYen(amount: Yen, label: string): void {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`${label}は 0 以上の有限の数値で指定してください: ${amount}`)
  }
}

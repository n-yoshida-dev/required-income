/**
 * 金額の扱いを 1 か所に集める。
 *
 * このアプリの出力は「いくら必要か」という金額そのものなので、
 * 丸めの位置がぶれると結果が信用できなくなる。
 * 金額は常に「円単位の整数」で持ち、計算の途中で小数を残さない。
 */

/** 円単位の金額。負の値は支出超過や債務を表す */
export type Yen = number

/** 年利・上昇率などの割合。0.02 なら 2% */
export type Rate = number

/**
 * 円単位に丸める。
 *
 * 0.5 は絶対値の大きい側へ寄せる（四捨五入）。
 * `Math.round` は負の 0.5 を 0 側へ寄せる（-0.5 → -0）ため、そのままでは使わない。
 * 収支には負の値が出るので、正負で丸め方が変わるのは避ける。
 */
export function roundYen(value: number): Yen {
  if (!Number.isFinite(value)) {
    throw new RangeError(`金額が有限の数値ではありません: ${value}`)
  }
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/**
 * 金額を合計する。丸めは合計したあとに 1 回だけ行う。
 *
 * 項目ごとに丸めてから足すと、項目数に比例して誤差が積み上がる。
 */
export function sumYen(values: readonly number[]): Yen {
  let total = 0
  for (const value of values) {
    if (!Number.isFinite(value)) {
      throw new RangeError(`金額が有限の数値ではありません: ${value}`)
    }
    total += value
  }
  return roundYen(total)
}

/**
 * 年率で `years` 年ぶん増やす（インフレ・昇給・運用利回りに共通で使う）。
 *
 * @param amount 元の金額
 * @param rate 年率。0.02 なら年 2%
 * @param years 経過年数。0 なら元の金額をそのまま返す
 */
export function compound(amount: Yen, rate: Rate, years: number): Yen {
  if (!Number.isInteger(years) || years < 0) {
    throw new RangeError(`経過年数は 0 以上の整数で指定してください: ${years}`)
  }
  if (rate <= -1) {
    throw new RangeError(`年率が -100% 以下です: ${rate}`)
  }
  if (years === 0) {
    return roundYen(amount)
  }
  return roundYen(amount * Math.pow(1 + rate, years))
}

/**
 * 割合を掛ける（稼働率・軽減率・手取り係数など）。
 *
 * @param amount 元の金額
 * @param ratio 掛ける割合。0.95 なら 95%
 */
export function applyRatio(amount: Yen, ratio: Rate): Yen {
  if (!Number.isFinite(ratio) || ratio < 0) {
    throw new RangeError(`割合は 0 以上の有限の数値で指定してください: ${ratio}`)
  }
  return roundYen(amount * ratio)
}

/** 月額から年額へ。端数は年額にしてから丸める */
export function monthlyToAnnual(monthly: Yen): Yen {
  return roundYen(monthly * 12)
}

/** 年額から月額へ。1 円未満は切り捨てず四捨五入する */
export function annualToMonthly(annual: Yen): Yen {
  return roundYen(annual / 12)
}

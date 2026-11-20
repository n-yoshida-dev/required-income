/**
 * 物価を掛ける帯の作り方（SPEC §3.4）。生活費（暮らし）・家の維持費（修繕と税）・車の維持費が使う。
 *
 * 物価が 0 なら 1 本。0 でなければ暦年ごとに分け、起点の年からの年数ぶん物価を掛ける。
 * 月額の丸めは `compound`（年ごとに 1 回、円に四捨五入）。
 */

import { compound } from '../../money'
import type { Band, Rate, Year, YearMonth, Yen } from '../types'
import { compareYearMonth, startOfYear } from '../yearMonth'
import { makeBand } from './band'

/**
 * [from, to) の区間に、物価を掛けた帯を並べる。区間が空（from が to 以降）なら帯を出さない。
 *
 * @param band 帯の持ち主・名前・種類（月額と期間はここで決める）
 * @param monthly 起点の年の月額
 * @param baseYear 物価を数え始める年（起点の年）。from はこの年より前であってはならない
 */
export function inflatedBands(
  band: Pick<Band, 'goalId' | 'label' | 'kind'>,
  monthly: Yen,
  inflationRate: Rate,
  from: YearMonth,
  to: YearMonth,
  baseYear: Year,
): Band[] {
  if (!Number.isFinite(inflationRate)) {
    throw new RangeError(`物価の上がり方が有限の数値ではありません: ${inflationRate}`)
  }
  if (from.year < baseYear) {
    throw new RangeError(`物価を掛ける帯は起点の年（${baseYear}）より前から始められません`)
  }
  const make = (amount: Yen, start: YearMonth, end: YearMonth): Band =>
    makeBand({ ...band, monthly: amount, from: start, to: end })

  if (compareYearMonth(to, from) <= 0) {
    return []
  }
  if (inflationRate === 0) {
    return [make(monthly, from, to)]
  }

  const bands: Band[] = []
  let start = from
  while (compareYearMonth(start, to) < 0) {
    const nextYear = startOfYear(start.year + 1)
    const end = compareYearMonth(nextYear, to) < 0 ? nextYear : to
    bands.push(make(compound(monthly, inflationRate, start.year - baseYear), start, end))
    start = end
  }
  return bands
}

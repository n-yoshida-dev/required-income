/**
 * 年額を返す既存の関数を、同じ額の続く区間の帯にまとめる（SPEC §1・§3.2 の `childCost`）。
 *
 * 前の版の計算（教育費・保育料・就学支援金）は「年 → 年額」を返す。学校と保育は 4 月始まりの年度で動くので、
 * 年 Y の年額を「Y 年 `startMonth` 月から翌年 `startMonth` 月の前まで」の 12 か月に置き、月額は年額 ÷ 12 を円に四捨五入する
 * （`annualToMonthly`）。暦年（1 月始まり）に均すと、入学・卒業・無償化の年の額がずれるため。
 *
 * 隣り合う区間の月額が同じなら 1 本にまとめる。月額 0 の区間は帯にしない（通っていない年は帯が無い）。
 * 帯は `range`（起点から「ずっと」の終わりまで）の中に切り詰める。
 */

import { annualToMonthly } from '../../money'
import type { Band, Month, Year, YearMonth, Yen } from '../types'
import { compareYearMonth, laterOf, yearMonth } from '../yearMonth'
import { assertNonNegativeYen, makeBand } from './band'

/**
 * 年額の関数から帯を作る。
 *
 * @param band 帯の持ち主・名前・種類（月額と期間はここで決める）
 * @param annualInYear 年 Y（`startMonth` 月に始まる 1 年）の年額。0 以上の円の整数を返すこと
 * @param range 帯を置く区間 [from, to)。空なら帯を出さない
 * @param startMonth 1 年の始まりの月（年度なら 4、暦年なら 1）
 */
export function bandsFromYearly(
  band: Pick<Band, 'goalId' | 'label' | 'kind'>,
  annualInYear: (year: Year) => Yen,
  range: { from: YearMonth; to: YearMonth },
  startMonth: Month,
): Band[] {
  if (compareYearMonth(range.from, range.to) >= 0) {
    return []
  }
  // range.from を含む 1 年から始める（年度なら、1〜3 月は前の年の年度に入る）
  const firstYear = range.from.month >= startMonth ? range.from.year : range.from.year - 1
  const bands: Band[] = []

  for (let year = firstYear; compareYearMonth(yearMonth(year, startMonth), range.to) < 0; year++) {
    const annual = annualInYear(year)
    assertNonNegativeYen(annual, `帯「${band.label}」の ${year} 年の年額`)
    const monthly = annualToMonthly(annual)
    if (monthly === 0) continue

    const from = laterOf(yearMonth(year, startMonth), range.from)
    const nextStart = yearMonth(year + 1, startMonth)
    const to = compareYearMonth(nextStart, range.to) < 0 ? nextStart : range.to

    const last = bands[bands.length - 1]
    if (last !== undefined && last.monthly === monthly && compareYearMonth(last.to, from) === 0) {
      bands[bands.length - 1] = makeBand({ ...last, to })
    } else {
      bands.push(makeBand({ ...band, monthly, from, to }))
    }
  }
  return bands
}

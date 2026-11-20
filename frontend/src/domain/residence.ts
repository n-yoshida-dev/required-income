/**
 * 居住地の解決。
 *
 * 住民税と国民健康保険の料率は自治体ごとに違うため、
 * 転居する年を境に参照する制度データが切り替わる。
 * 前の版の家賃・転居の年を引く関数は T13 で消した（新しい版では家賃は暮らしの帯が持つ）。
 */

import type { MunicipalityCode, ResidencePeriod, ResidenceHistory, Year } from './types'

/**
 * その年に住んでいる場所を返す。
 *
 * 履歴のうち `fromYear` が `year` 以下で最大のものを採る。
 * 履歴が `fromYear` の昇順に並んでいなくても正しく動く。
 *
 * @throws {RangeError} 履歴が空、または `year` が最初の `fromYear` より前のとき。
 *   シミュレーション期間全体をカバーする履歴を渡すのは呼び出し側の責務（契約違反）
 */
export function resolveResidence(history: ResidenceHistory, year: Year): ResidencePeriod {
  if (history.length === 0) {
    throw new RangeError('居住の履歴が空です')
  }

  let current: ResidencePeriod | undefined
  for (const period of history) {
    if (period.fromYear <= year) {
      if (current === undefined || period.fromYear > current.fromYear) {
        current = period
      }
    }
  }

  if (current === undefined) {
    const earliest = Math.min(...history.map((p) => p.fromYear))
    throw new RangeError(`${year} 年の居住地が履歴にありません。履歴の開始は ${earliest} 年です`)
  }

  return current
}

/** その年に住んでいる自治体を返す */
export function resolveMunicipality(history: ResidenceHistory, year: Year): MunicipalityCode {
  return resolveResidence(history, year).municipality
}

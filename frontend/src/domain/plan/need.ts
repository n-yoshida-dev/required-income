/**
 * 年ごとの要る手取り（SPEC §3.3）。
 *
 * 要る手取り(年) ＝ Σ（saving・payment の帯の月額 × その年に重なる月数）
 *              − Σ（income の帯の月額 × その年に重なる月数）
 *
 * - 暦年（1〜12 月）で数える。税の計算と同じ切り方
 * - 起点の年は残りの月しか無いので、12 か月ぶんに直す（目標ごとに × 12 ÷ 残りの月数 をして円に四捨五入）
 * - 最後の年は、働く大人のうち最初に退職する人の退職の年の前年（`lastNeedYear`）
 * - `earmarked`（児童手当をこども NISA に回す分）は数えない
 */

import { roundYen, sumYen } from '../money'
import { assertBand } from './bands/band'
import type { Band, BandOwner, LifePlan, Year, YearMonth, YearNeed } from './types'
import { assertYearMonth, overlapMonths, startOfYear } from './yearMonth'

/**
 * 要る手取りを数える最後の年。働く大人（`notWorking` でない人）のうち、最初に退職する人の退職の年（生まれ年 ＋ 退職の年齢）の前年。
 * 1 人が退職したあとの年は、残った 1 人だけで要る世帯年収を解くことになり（年金を入れていない）実際より大きく出るので、
 * 階段はそこで切り、その先は老後資金のカードが受け持つ（2026-11-17 の呼び出し側の設計の決定）。
 * 働く大人がいなければ、大人全員のうち最初に退職の年齢になる人の前年で数える。
 * 大人が 1〜2 人でない、年が整数でないときは契約違反として投げる。
 */
export function lastNeedYear(plan: Pick<LifePlan, 'adults'>): Year {
  const { adults } = plan
  if (adults.length < 1 || adults.length > 2) {
    throw new RangeError(`大人は 1〜2 人で指定してください: ${adults.length} 人`)
  }
  for (const adult of adults) {
    if (!Number.isInteger(adult.birthYear)) {
      throw new RangeError(`生まれ年は整数で指定してください: ${adult.birthYear}`)
    }
    if (!Number.isInteger(adult.retirementAge) || adult.retirementAge < 0) {
      throw new RangeError(`退職の年齢は 0 以上の整数で指定してください: ${adult.retirementAge}`)
    }
  }
  const working = adults.filter((adult) => adult.workStyle !== 'notWorking')
  const pool = working.length > 0 ? working : adults
  return Math.min(...pool.map((adult) => adult.birthYear + adult.retirementAge)) - 1
}

/**
 * 帯の束から、起点の年から `lastYear` までの年ごとの要る手取りと目標ごとの内訳を出す。
 * `lastYear` が起点の年より前なら空の配列（数える年が無い）。
 *
 * 丸めは目標ごと・年ごとに 1 回（起点の年の 12 か月換算のあと）。合計は丸めた内訳の和なので、内訳と必ず一致する。
 */
export function yearlyNeeds(bands: readonly Band[], base: YearMonth, lastYear: Year): YearNeed[] {
  assertYearMonth(base, '起点')
  if (!Number.isInteger(lastYear)) {
    throw new RangeError(`最後の年は整数で指定してください: ${lastYear}`)
  }
  bands.forEach(assertBand)

  const years: YearNeed[] = []
  for (let year = base.year; year <= lastYear; year++) {
    const windowFrom = year === base.year ? base : startOfYear(year)
    const windowTo = startOfYear(year + 1)
    const windowMonths = year === base.year ? 13 - base.month : 12

    // 目標ごとの年額（丸める前）。Map は入れた順を保つので、帯が最初に出た順に並ぶ
    const raw = new Map<BandOwner, number>()
    for (const band of bands) {
      if (band.kind === 'earmarked') continue
      const months = overlapMonths(band.from, band.to, windowFrom, windowTo)
      if (months === 0) continue
      const sign = band.kind === 'income' ? -1 : 1
      raw.set(band.goalId, (raw.get(band.goalId) ?? 0) + sign * band.monthly * months)
    }

    const byGoal = [...raw].map(([goalId, amount]) => ({
      goalId,
      annual: roundYen((amount * 12) / windowMonths),
    }))
    years.push({ year, requiredNet: sumYen(byGoal.map((g) => g.annual)), byGoal })
  }
  return years
}

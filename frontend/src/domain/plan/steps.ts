/**
 * 段へのまとめと段の理由（SPEC §3.5）。
 *
 * 1. 年を前から見て、要る手取りが今の段の基準（段の最初の年の値）から、割合と金額の **両方** のしきい値を超えて変わったら新しい段
 * 2. 段の値は、その段の中でいちばん大きい年の要る手取り（同じなら早い年）
 * 3. 段の理由は、前の段と比べて始まった・終わった帯。段の値になった年どうしで帯ごとの年額を比べ、月額の差の大きい順に上限まで。
 *    帯ごとに、始まる・終わる・増える・減るのどれかを添える（W18）
 *
 * ここに渡す金額は、すでに今のお金の価値に割り戻した物（SPEC §3.4 の順番。割り戻しは `evaluate` がする）。
 */

import { roundYen } from '../money'
import type {
  Band,
  BandAnnual,
  BandOwner,
  CauseChange,
  StepCause,
  StepThresholds,
  Year,
  YearMonth,
  YearNeed,
  Yen,
} from './types'
import { overlapMonths, startOfYear } from './yearMonth'

/** 段のまとまり（年の範囲と、値になった年） */
export type StepGroup = {
  fromYear: Year
  toYear: Year
  peakYear: Year
  requiredNet: Yen
}

/**
 * 基準の値から見て、新しい段を始めるほど変わったか。
 * 差の絶対値が「基準の絶対値 × 割合」を超え、かつ「金額」を超えたとき true（ちょうどは同じ段）
 */
export function isNewStep(baseline: Yen, value: Yen, thresholds: StepThresholds): boolean {
  const diff = Math.abs(value - baseline)
  return diff > Math.abs(baseline) * thresholds.changeRatio && diff > thresholds.changeYen
}

/** 年ごとの要る手取りを段にまとめる。年が空なら空。年は連続して並んでいること */
export function groupSteps(years: readonly YearNeed[], thresholds: StepThresholds): StepGroup[] {
  assertThresholds(thresholds)
  years.forEach((entry, index) => {
    const previous = years[index - 1]
    if (previous !== undefined && entry.year !== previous.year + 1) {
      throw new RangeError(`年が続いていません: ${previous.year} の次が ${entry.year}`)
    }
  })

  const groups: StepGroup[] = []
  let current: StepGroup | null = null
  let baseline = 0
  for (const entry of years) {
    if (current === null || isNewStep(baseline, entry.requiredNet, thresholds)) {
      current = {
        fromYear: entry.year,
        toYear: entry.year,
        peakYear: entry.year,
        requiredNet: entry.requiredNet,
      }
      baseline = entry.requiredNet
      groups.push(current)
      continue
    }
    current.toYear = entry.year
    // 段の値は最大の年。同じなら早い年のまま
    if (entry.requiredNet > current.requiredNet) {
      current.requiredNet = entry.requiredNet
      current.peakYear = entry.year
    }
  }
  return groups
}

/**
 * 帯ごとの、ある年の年額（入れた金額どおり。要る手取りと同じ数え方）。
 * 起点の年は 12 か月ぶんに直す。`earmarked` は数えず、収入は負。同じ目標・同じ名前の帯は足す
 */
export function bandAnnualsInYear(
  bands: readonly Band[],
  base: YearMonth,
  year: Year,
): BandAnnual[] {
  const windowFrom = year === base.year ? base : startOfYear(year)
  const windowTo = startOfYear(year + 1)
  const windowMonths = year === base.year ? 13 - base.month : 12

  const byKey = new Map<string, { goalId: BandOwner; label: string; amount: number }>()
  for (const band of bands) {
    if (band.kind === 'earmarked') continue
    const months = overlapMonths(band.from, band.to, windowFrom, windowTo)
    if (months === 0) continue
    const key = `${band.goalId}\u0000${band.label}`
    const sign = band.kind === 'income' ? -1 : 1
    const entry = byKey.get(key) ?? { goalId: band.goalId, label: band.label, amount: 0 }
    entry.amount += sign * band.monthly * months
    byKey.set(key, entry)
  }
  return [...byKey.values()].map(({ goalId, label, amount }) => ({
    goalId,
    label,
    annual: roundYen((amount * 12) / windowMonths),
  }))
}

/**
 * 段の理由：前の段の帯の年額と、この段の帯の年額を比べ、月額の差が 0 でない帯を、差の絶対値の大きい順に上限まで。
 * 同じ大きさなら、この段 → 前の段の順に帯が出た順。
 *
 * どう変わったか（`change`。W18）：前の段の年に無い帯は始まる、この段の年に無い帯は終わる。
 * どちらの年にもある帯は、`following`（この段の年の次の年の年額）に無く、額が減っていれば、この段の年の途中で終わる（終わる）。
 * それ以外は額の大きさで増える・減る。`following` を渡さなければ、年の途中で終わる帯も減るになる
 */
export function stepCauses(
  previous: readonly BandAnnual[],
  current: readonly BandAnnual[],
  maxCauses: number,
  following: readonly BandAnnual[] | null = null,
): StepCause[] {
  const key = (entry: BandAnnual): string => `${entry.goalId}\u0000${entry.label}`
  const before = new Map(previous.map((entry) => [key(entry), entry.annual]))
  const now = new Map(current.map((entry) => [key(entry), entry.annual]))
  const next = following === null ? null : new Set(following.map(key))
  const owners = new Map<string, { goalId: BandOwner; label: string }>()
  for (const entry of [...current, ...previous]) {
    if (!owners.has(key(entry)))
      owners.set(key(entry), { goalId: entry.goalId, label: entry.label })
  }
  return [...owners.entries()]
    .map(([id, { goalId, label }]): StepCause => {
      const was = before.get(id)
      const is = now.get(id)
      const monthlyDelta = roundYen(((is ?? 0) - (was ?? 0)) / 12)
      const change = changeOf(was, is, next === null ? true : next.has(id))
      const monthly =
        change === 'start'
          ? roundYen(Math.abs(is ?? 0) / 12)
          : change === 'end'
            ? roundYen(Math.abs(was ?? 0) / 12)
            : Math.abs(monthlyDelta)
      return { goalId, label, monthlyDelta, change, monthly }
    })
    .filter((cause) => cause.monthlyDelta !== 0)
    .sort((a, b) => Math.abs(b.monthlyDelta) - Math.abs(a.monthlyDelta))
    .slice(0, maxCauses)
}

/**
 * 帯 1 本の変わり方。`was`・`is` は前の段の年・この段の年の年額（無ければ undefined）、
 * `continues` はこの段の年の次の年にもあるか
 */
function changeOf(
  was: number | undefined,
  is: number | undefined,
  continues: boolean,
): CauseChange {
  if (was === undefined) return 'start'
  if (is === undefined) return 'end'
  const shrinks = Math.abs(is) < Math.abs(was)
  if (shrinks && !continues) return 'end'
  return shrinks ? 'less' : 'more'
}

/** しきい値が契約どおりかを確かめる */
function assertThresholds(thresholds: StepThresholds): void {
  if (!Number.isFinite(thresholds.changeRatio) || thresholds.changeRatio < 0) {
    throw new RangeError(`段の割合のしきい値は 0 以上で指定してください: ${thresholds.changeRatio}`)
  }
  if (!Number.isFinite(thresholds.changeYen) || thresholds.changeYen < 0) {
    throw new RangeError(`段の金額のしきい値は 0 以上で指定してください: ${thresholds.changeYen}`)
  }
  if (!Number.isInteger(thresholds.maxCauses) || thresholds.maxCauses < 0) {
    throw new RangeError(`段の理由の数は 0 以上の整数で指定してください: ${thresholds.maxCauses}`)
  }
}

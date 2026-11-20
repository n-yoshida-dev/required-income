/**
 * 昇進シナリオを年次に展開する。
 *
 * このアプリの主目的は「昇進しなかった場合、副業でいくら必要か」を出すことなので、
 * シナリオごとの給与額面をぶれなく年次に展開できることが前提になる（SPEC §2.3）。
 */

import { compound } from '../money'
import type {
  EmploymentIncome,
  PersonId,
  PromotionScenario,
  PromotionStep,
  Year,
  Yen,
} from '../types'

/**
 * ある年の給与の額面。
 *
 * 賞与を分けて持つのは、社会保険の掛かり方が月給と違うため
 * （標準賞与額の上限が別にあり、支給回数で頭打ちが変わる。`tax/socialInsurance.ts`）。
 */
export type EmploymentPay = {
  annualGross: Yen
  annualBonus: Yen
}

/**
 * その年に適用されている昇進の段を返す。まだ昇進していなければ null。
 *
 * `steps` は年の昇順で持つ規約だが、順序に依存せず「`year` 以下で最大の段」を探す。
 * 入力の並びで金額が変わるのは事故のもとなので、並びを前提にしない。
 *
 * @throws {RangeError} 同じ年の段が重複しているとき（どちらを適用すべきか決まらない）
 */
export function resolvePromotionStep(
  scenario: PromotionScenario | null,
  personId: PersonId,
  year: Year,
): PromotionStep | null {
  if (scenario === null) {
    return null
  }

  const track = scenario.tracks.find((candidate) => candidate.personId === personId)
  if (track === undefined) {
    // 昇進を見込まない世帯員（個人事業主など）は tracks に含まれない
    return null
  }

  const seenYears = new Set<Year>()
  for (const step of track.steps) {
    if (seenYears.has(step.year)) {
      throw new RangeError(
        `同じ年の昇進が重複しています: scenarioId=${scenario.id}, personId=${personId}, year=${step.year}`,
      )
    }
    seenYears.add(step.year)
  }

  let applicable: PromotionStep | null = null
  for (const step of track.steps) {
    if (step.year > year) {
      continue
    }
    if (applicable === null || step.year > applicable.year) {
      applicable = step
    }
  }
  return applicable
}

/**
 * ある年の給与額面を求める。
 *
 * **昇進した年を昇給の新しい起点にする。**
 * 昇進で額面が置き換わったあとも起点を `baseYear` のままにすると、
 * 昇進前に積み上がった昇給が昇進後の額面にも二重に乗ってしまう。
 *
 * ```
 * その年の額面 = 直近の昇進後額面 × (1 + 昇給率) ^ (年 − 昇進年)
 * ```
 *
 * 昇進がまだなら、起点は `baseYear`・額面は `income.annualGross` になる。
 *
 * @param baseYear 計算の起点となる年
 * @param year 求めたい年
 * @throws {RangeError} `year` が `baseYear` より前のとき（過去は計算対象外）
 */
export function employmentPayInYear(
  income: EmploymentIncome,
  scenario: PromotionScenario | null,
  baseYear: Year,
  year: Year,
): EmploymentPay {
  if (!Number.isInteger(baseYear) || !Number.isInteger(year)) {
    throw new RangeError(`年は整数で指定してください: baseYear=${baseYear}, year=${year}`)
  }
  if (year < baseYear) {
    throw new RangeError(`起点より前の年は計算できません: baseYear=${baseYear}, year=${year}`)
  }

  const step = resolvePromotionStep(scenario, income.personId, year)
  const anchorYear = step === null ? baseYear : step.year
  const baseGross = step === null ? income.annualGross : step.annualGross
  const baseBonus = step === null ? income.annualBonus : step.annualBonus

  // 昇進年が baseYear より前（既に昇進済み）でも、そこを起点に昇給を積む
  const elapsedYears = year - anchorYear

  return {
    annualGross: compound(baseGross, income.baseRaiseRate, elapsedYears),
    annualBonus: compound(baseBonus, income.baseRaiseRate, elapsedYears),
  }
}

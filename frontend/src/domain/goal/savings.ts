/**
 * 目標に向けた積立の数式（SPEC §2.13）。
 *
 * 「使う年の前年末に目標額が貯まっている」ように、家計から毎年いくら積み立てればよいかを解き、
 * その積立が各年末にいくらになっているか（積立線）を年次で並べる。
 *
 * ```
 * 積立線(t) = 積立線(t−1) × (1 + 利回り) + 家計からの積立 h(t) + 児童手当から回した額 e(t)
 * 目標額    = 積立線(使う年 − 1)
 * ```
 *
 * 家計からの積立 h(t) は、段階積立（D29 案 1）で利用者が先に決めた年はその額、残りの年は定額 c。
 * c は「目標額から、児童手当と段階の分を将来価値に直して引いた残り」を残りの年数の年金終価係数で割って解く。
 *
 * 利回りは置き場所が投資なら運用利回り、現金なら 0 を渡す。順方向シミュレーションが
 * 投資資産に利回りを掛けるのと同じ順序（前年末の残高に利回り → その年の積立を足す）にしてあり、
 * 積み立てた額を実際に投資へ移せば積立線と同じ推移になる。
 *
 * **c は切り上げる。** 端数を四捨五入すると使う年の前年末に目標額へ数円届かない。
 * 積立線は目標額を上限にするので、切り上げた分が線に出ることはない。
 */

import { roundYen } from '../money'
import type { GoalSchedule, Rate, SavingsStage, Year, Yen } from '../types'

/** 積立の前提。金額・期間・利回り・段階 */
export type SavingsTerms = {
  /** 使う年の前年末に貯まっているべき額 */
  amount: Yen
  /** 積立線が始まる年（児童手当・家計のどちらか早い方が入り始める年） */
  startYear: Year
  /** 家計から積み立て始める年。家計からは積み立てないなら null */
  householdFromYear: Year | null
  /** 使う年。積立はこの前年まで */
  useYear: Year
  /** 積み立てた額に掛かる年率（投資なら運用利回り、現金なら 0） */
  rate: Rate
  /**
   * 段階積立。`untilYear` の昇順。前の段階の翌年（最初は `householdFromYear`）からその年までを
   * `annualAmount` で積む。空なら全年が定額 c
   */
  stages: readonly SavingsStage[]
}

/**
 * 年金現価係数の逆（年金終価係数）。毎年末に 1 を `years` 回積んだときの最後の年末の残高。
 *
 * ```
 * Σ_{k=0}^{years−1} (1 + rate)^k     利回り 0 なら years
 * ```
 *
 * @throws {RangeError} 年数が 0 以上の整数でない、または年率が -100% 以下のとき
 */
export function annuityFactor(rate: Rate, years: number): number {
  if (!Number.isInteger(years) || years < 0) {
    throw new RangeError(`年数は 0 以上の整数で指定してください: ${years}`)
  }
  if (!Number.isFinite(rate) || rate <= -1) {
    throw new RangeError(`年率が不正です: ${rate}`)
  }
  if (rate === 0) {
    return years
  }
  return (Math.pow(1 + rate, years) - 1) / rate
}

/**
 * 定額 c で積む最初の年。段階があれば最後の段階の翌年、無ければ家計からの積立の開始年。
 * 家計からは積み立てないなら null
 */
export function solvedFromYear(terms: SavingsTerms): Year | null {
  if (terms.householdFromYear === null) {
    return null
  }
  const last = terms.stages.at(-1)
  return last === undefined ? terms.householdFromYear : last.untilYear + 1
}

/**
 * その年に家計から積む額。家計からの積立の期間外なら 0、段階の年ならその額、残りの年は `contribution`。
 *
 * 段階は昇順なので、`untilYear` がその年以上の最初の段階がその年を含む段階になる。
 */
export function householdContributionInYear(
  terms: SavingsTerms,
  contribution: Yen,
  year: Year,
): Yen {
  if (terms.householdFromYear === null || year < terms.householdFromYear || year >= terms.useYear) {
    return 0
  }
  const stage = terms.stages.find((candidate) => year <= candidate.untilYear)
  return stage === undefined ? contribution : stage.annualAmount
}

/**
 * 使う年の前年末に目標額へ届くために、家計から（段階の後の残りの年に）毎年いくら積み立てればよいか。
 *
 * 児童手当から回す分（`earmarked`）と段階の分は先に将来価値（使う年の前年末時点）に直して目標額から引く。
 * それだけで目標額に届くなら 0。`householdFromYear` が null なら家計からは積み立てないので 0。
 *
 * @param earmarked 年 → その年に児童手当から回す額。積立の期間外の年は無視する
 * @throws {RangeError} 前提が不正なとき（`assertTerms`）、段階の額だけで目標額を超えるとき
 */
export function solveHouseholdContribution(
  terms: SavingsTerms,
  earmarked: ReadonlyMap<Year, Yen>,
): Yen {
  assertTerms(terms)
  const fromYear = solvedFromYear(terms)
  if (fromYear === null) {
    return 0
  }

  const lastYear = terms.useYear - 1
  const earmarkedValue = futureValueOfEarmarked(terms, earmarked, lastYear)
  const stagedValue = futureValueOfStages(terms, lastYear)
  const remaining = terms.amount - earmarkedValue - stagedValue
  // 段階の額だけで目標額を超えるのは矛盾（順方向は段階の額をそのまま積むので、超過分が副業の必要額に乗る）。
  // 児童手当だけで超える場合は従来どおり c = 0（手当は利用者が額を決められない）
  if (terms.stages.length > 0 && terms.amount - earmarkedValue <= 0) {
    throw new RangeError('児童手当だけで目標額に届くので、段階積立は置けません')
  }
  if (terms.stages.length > 0 && remaining < 0) {
    throw new RangeError(
      `段階積立の額が目標額を超えています: 段階の合計（使う年の前年末の価値）=${roundYen(stagedValue)}, 目標額から児童手当を引いた残り=${roundYen(terms.amount - earmarkedValue)}`,
    )
  }
  if (remaining <= 0) {
    return 0
  }

  const factor = annuityFactor(terms.rate, terms.useYear - fromYear)
  return Math.ceil(remaining / factor)
}

/**
 * 積立線を年次で並べる。`startYear` から `useYear − 1` まで。
 *
 * 各年の `required` は目標額を上限にする。児童手当だけで目標額を超える場合や、
 * 切り上げた積立額の端数ぶんを線に出さないため。
 *
 * @param contribution 段階の後の残りの年の積立額（`solveHouseholdContribution` の結果）
 * @throws {RangeError} 前提が不正、または積立額が負のとき
 */
export function buildSavingsSchedule(
  terms: SavingsTerms,
  contribution: Yen,
  earmarked: ReadonlyMap<Year, Yen>,
): readonly GoalSchedule[] {
  assertTerms(terms)
  if (!Number.isFinite(contribution) || contribution < 0) {
    throw new RangeError(`積立額は 0 以上の有限の数値で指定してください: ${contribution}`)
  }

  const schedule: GoalSchedule[] = []
  let balance = 0
  for (let year = terms.startYear; year < terms.useYear; year += 1) {
    const household = householdContributionInYear(terms, contribution, year)
    const fromAllowance = earmarkedInYear(earmarked, year)
    balance = balance * (1 + terms.rate) + household + fromAllowance
    schedule.push({
      year,
      contribution: household,
      earmarked: fromAllowance,
      required: Math.min(roundYen(balance), terms.amount),
    })
  }
  return schedule
}

/** 児童手当から回す分を `atYear` の年末時点の価値に直して合計する */
function futureValueOfEarmarked(
  terms: SavingsTerms,
  earmarked: ReadonlyMap<Year, Yen>,
  atYear: Year,
): number {
  let total = 0
  for (let year = terms.startYear; year <= atYear; year += 1) {
    total += earmarkedInYear(earmarked, year) * Math.pow(1 + terms.rate, atYear - year)
  }
  return total
}

/** 段階の年に積む額を `atYear` の年末時点の価値に直して合計する。段階が無ければ 0 */
function futureValueOfStages(terms: SavingsTerms, atYear: Year): number {
  if (terms.householdFromYear === null) {
    return 0
  }
  let total = 0
  let year = terms.householdFromYear
  for (const stage of terms.stages) {
    for (; year <= stage.untilYear; year += 1) {
      total += stage.annualAmount * Math.pow(1 + terms.rate, atYear - year)
    }
  }
  return total
}

/**
 * その年に児童手当から回す額。
 *
 * @throws {RangeError} 額が負、または有限の数値でないとき
 */
function earmarkedInYear(earmarked: ReadonlyMap<Year, Yen>, year: Year): Yen {
  const amount = earmarked.get(year) ?? 0
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`児童手当から回す額は 0 以上の有限の数値で指定してください: ${amount}`)
  }
  return amount
}

/**
 * 積立の前提を検証する。
 *
 * @throws {RangeError} 目標額が負、年が整数でない、開始年が使う年以降、
 *   家計の開始年が積立の期間外、年率が不正、段階が不正なとき（`assertStages`）
 */
function assertTerms(terms: SavingsTerms): void {
  if (!Number.isFinite(terms.amount) || terms.amount < 0) {
    throw new RangeError(`目標額は 0 以上の有限の数値で指定してください: ${terms.amount}`)
  }
  if (!Number.isInteger(terms.startYear) || !Number.isInteger(terms.useYear)) {
    throw new RangeError(
      `年は整数で指定してください: startYear=${terms.startYear}, useYear=${terms.useYear}`,
    )
  }
  if (terms.startYear >= terms.useYear) {
    throw new RangeError(
      `積立の開始年は使う年より前でなければなりません: startYear=${terms.startYear}, useYear=${terms.useYear}`,
    )
  }
  if (terms.householdFromYear !== null) {
    if (
      !Number.isInteger(terms.householdFromYear) ||
      terms.householdFromYear < terms.startYear ||
      terms.householdFromYear >= terms.useYear
    ) {
      throw new RangeError(
        `家計からの積立の開始年は積立の期間内でなければなりません: householdFromYear=${terms.householdFromYear}, startYear=${terms.startYear}, useYear=${terms.useYear}`,
      )
    }
  }
  if (!Number.isFinite(terms.rate) || terms.rate <= -1) {
    throw new RangeError(`年率が不正です: ${terms.rate}`)
  }
  assertStages(terms)
}

/**
 * 段階積立を検証する。
 *
 * - 家計から積み立てない（`householdFromYear` が null）なら段階は置けない
 * - `untilYear` は整数で、家計からの積立の開始年以上、使う年の 2 年前以下（残りを解く年を 1 年は残す）
 * - `untilYear` は狭義の昇順（同じ年の段階が 2 つあると、どちらの額か決まらない）
 * - 額は 0 以上の有限の数値
 *
 * @throws {RangeError} 上のいずれかに反するとき
 */
function assertStages(terms: SavingsTerms): void {
  if (terms.stages.length === 0) {
    return
  }
  if (terms.householdFromYear === null) {
    throw new RangeError('家計から積み立てない目標には段階積立を置けません')
  }
  let previous: Year | null = null
  for (const stage of terms.stages) {
    if (!Number.isInteger(stage.untilYear)) {
      throw new RangeError(`段階積立の年は整数で指定してください: ${stage.untilYear}`)
    }
    if (stage.untilYear < terms.householdFromYear || stage.untilYear > terms.useYear - 2) {
      throw new RangeError(
        `段階積立の年は家計からの積立の開始年（${terms.householdFromYear}）以上、使う年の 2 年前（${terms.useYear - 2}）以下で指定してください: ${stage.untilYear}`,
      )
    }
    if (previous !== null && stage.untilYear <= previous) {
      throw new RangeError(
        `段階積立の年は昇順で、同じ年を重ねられません: ${previous} → ${stage.untilYear}`,
      )
    }
    if (!Number.isFinite(stage.annualAmount) || stage.annualAmount < 0) {
      throw new RangeError(
        `段階積立の額は 0 以上の有限の数値で指定してください: ${stage.annualAmount}`,
      )
    }
    previous = stage.untilYear
  }
}

/**
 * 所得の種類ごとに、その年の所得を求める。
 *
 * **合算した数値では持たない。** 種類ごとに税・社会保険の扱いが違うため、
 * ここでは種類を保ったまま所得だけを出し、税と社保の計算は後段に任せる（SPEC §2.4）。
 *
 * 「収入」と「所得」を混ぜないこと。このモジュールが返すのは所得（収入 − 必要経費）で、
 * 給与だけは控除の計算が後段にあるため額面（＝収入）を返す。
 */

import { roundYen } from '../money'
import type {
  BusinessIncome,
  InvestmentProperty,
  Person,
  RealEstateIncome,
  SideBusinessIncome,
  SideBusinessSchedule,
  Year,
  Yen,
} from '../types'

/**
 * 就労を終える年。**この年までは働き、翌年から給与・事業の所得は 0 になる。**
 *
 * 実際には誕生日で退職するので最終年は年の途中までだが、
 * フェーズ1では最終年を満額として扱う。月割りはフェーズ2で税の実装と一緒に入れる。
 *
 * **寿命想定の年を越えては働かない。** 退職年齢が寿命想定より後の入力でも、寿命想定の年で就労を終える
 * （越えて所得を計上すると、税・社会保険の計算で「対象外の人に給与がある」という食い違いになる。2026-09-19）。
 */
export function lastWorkingYear(person: Person): Year {
  return person.birthYear + Math.min(person.retirementAge, person.lifeExpectancy)
}

/** その年に就労しているか */
export function isWorking(person: Person, year: Year): boolean {
  return year <= lastWorkingYear(person)
}

/**
 * 事業所得（個人事業主）。
 *
 * - 開業年より前は 0
 * - **開業年は月割りする。** 10月開業なら 3か月ぶん（`13 - startMonth`）
 * - 売上は開業年を起点に複利で伸ばし、`revenueCeiling` で頭打ちにする
 * - 必要経費は年額固定。伸ばさない（伸びる経費は売上側の想定に織り込む）
 *
 * 青色申告特別控除はここでは引かない。課税所得の計算はフェーズ2の税モジュールで行う。
 */
export function businessProfitInYear(income: BusinessIncome, person: Person, year: Year): Yen {
  if (year < income.startYear || !isWorking(person, year)) {
    return 0
  }

  const grownRevenue = compoundRevenue(income, year)
  const revenue =
    income.revenueCeiling === null ? grownRevenue : Math.min(grownRevenue, income.revenueCeiling)

  const activeMonths = year === income.startYear ? 13 - income.startMonth : 12

  return roundYen(((revenue - income.annualExpenses) * activeMonths) / 12)
}

/** 開業年を起点に売上を複利で伸ばす。丸めは呼び出し側で1回だけ行う */
function compoundRevenue(income: BusinessIncome, year: Year): number {
  if (income.revenueGrowthRate <= -1) {
    throw new RangeError(`売上の成長率が -100% 以下です: ${income.revenueGrowthRate}`)
  }
  return income.annualRevenue * Math.pow(1 + income.revenueGrowthRate, year - income.startYear)
}

/**
 * 不動産所得。**家賃収入から物件の運営経費を引いた「所得」を返す。**
 *
 * 固定資産税・管理費・修繕費はここで引く。支出側（`ExpenseBreakdown.investmentProperty`）
 * には計上しない。両方に載せると経費が二重に引かれる。
 *
 * 共有名義の場合、収入も経費も同じ持分で按分されるため、差し引いてから持分を掛ける。
 * 退職しても賃貸収入は続くので、就労の判定は行わない。
 *
 * @throws {RangeError} 物件が対応していない、稼働率・持分が不正なとき
 */
export function realEstateProfitInYear(
  income: RealEstateIncome,
  property: InvestmentProperty,
  year: Year,
): Yen {
  if (property.id !== income.propertyId) {
    throw new RangeError(
      `物件が対応していません: income.propertyId=${income.propertyId}, property.id=${property.id}`,
    )
  }
  if (!Number.isFinite(income.occupancyRate) || income.occupancyRate < 0) {
    throw new RangeError(`稼働率は 0 以上の有限の数値で指定してください: ${income.occupancyRate}`)
  }
  if (!Number.isFinite(income.ownershipShare) || income.ownershipShare < 0) {
    throw new RangeError(
      `持分割合は 0 以上の有限の数値で指定してください: ${income.ownershipShare}`,
    )
  }

  // 売却した翌年から家賃収入は無くなる。売却年は満額計上する（フェーズ1の簡略化）
  const { disposition } = property
  if (disposition.kind === 'sell' && year > disposition.year) {
    return 0
  }

  const annualRent = income.monthlyRent * 12 * income.occupancyRate
  const annualCost =
    property.annualPropertyTax + property.annualManagementCost + property.annualRepairCost

  return roundYen((annualRent - annualCost) * income.ownershipShare)
}

/**
 * 副業の所得。ゴールシークが動かす対象。
 *
 * 入力値は「現時点の見込み」であり、年次では伸ばさない。
 * いくらまで伸ばす必要があるかを逆算するのがこのアプリの目的なので、
 * ここで勝手に成長させると逆算の答えが入力に埋まってしまう。
 */
export function sideBusinessProfitInYear(
  income: SideBusinessIncome,
  person: Person,
  year: Year,
): Yen {
  if (!isWorking(person, year)) {
    return 0
  }
  return roundYen(income.annualRevenue - income.annualExpenses)
}

/**
 * スケジュールで指定された副業所得（ゴールシークが差し込む候補・解）。
 *
 * その年を含む期間の `annualProfit` を返す。どの期間にも含まれない年は 0。
 * 入力の `SideBusinessIncome` と同じく、就労を終えた翌年からは 0 になる。
 *
 * @throws {RangeError} 期間が重なっている、開始年が終了年より後、所得が有限の数値でないとき
 */
export function scheduledSideBusinessProfitInYear(
  schedule: SideBusinessSchedule,
  person: Person,
  year: Year,
): Yen {
  assertSchedule(schedule)
  if (!isWorking(person, year)) {
    return 0
  }
  const period = schedule.periods.find(
    (candidate) => candidate.fromYear <= year && year <= candidate.toYear,
  )
  return period === undefined ? 0 : roundYen(period.annualProfit)
}

/** スケジュールの期間が整合しているかを確かめる（重なりは二重計上になるので契約違反） */
function assertSchedule(schedule: SideBusinessSchedule): void {
  const sorted = [...schedule.periods].sort((a, b) => a.fromYear - b.fromYear)
  let previousEnd: Year | null = null
  for (const period of sorted) {
    if (!Number.isInteger(period.fromYear) || !Number.isInteger(period.toYear)) {
      throw new RangeError(
        `副業スケジュールの年は整数で指定してください: fromYear=${period.fromYear}, toYear=${period.toYear}`,
      )
    }
    if (period.fromYear > period.toYear) {
      throw new RangeError(
        `副業スケジュールの開始年が終了年より後です: fromYear=${period.fromYear}, toYear=${period.toYear}`,
      )
    }
    if (!Number.isFinite(period.annualProfit)) {
      throw new RangeError(
        `副業スケジュールの所得が有限の数値ではありません: ${period.annualProfit}`,
      )
    }
    if (previousEnd !== null && period.fromYear <= previousEnd) {
      throw new RangeError(
        `副業スケジュールの期間が重なっています: ${period.fromYear}年（前の期間は${previousEnd}年まで）`,
      )
    }
    previousEnd = period.toYear
  }
}

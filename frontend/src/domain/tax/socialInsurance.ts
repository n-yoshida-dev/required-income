/**
 * 被用者（会社員）の社会保険料の本人負担ぶんを、額面の年収から求める。
 *
 * 健康保険・介護保険・子ども・子育て支援金・厚生年金は「標準報酬月額 × 料率 × 本人負担割合」で、
 * 標準報酬月額は月給を等級表で丸めた額。賞与は「標準賞与額（1,000 円未満切捨て）× 料率 × 本人負担割合」で、
 * 健保は年度の累計、厚生年金は支給 1 回ごとに上限がある。雇用保険だけは等級表を使わず賃金の総額に料率を掛ける。
 *
 * **年次モデルへの当てはめ（この関数の前提。制度そのものではない）：**
 * - 月給は年収 ÷ 12 の定額とみなす（実際は 4〜6 月の報酬で決まる定時決定だが、年次モデルでは平均で置く）
 * - 料率・等級は「その年の 4 月から始まる年度」の値を暦年全体に使う。1〜3 月は前年度の料率が正しいが、
 *   差は年収の 0.1% 未満なので年次モデルでは区別しない
 * - 年度の値が無い将来年は、最新の年度の値をそのまま延ばす（毎年度の告示待ち。KNOWLEDGE.md 2026-09-14）
 * - 年齢は「その年 − 生年」で置く（介護保険の 40〜64 歳の判定を年単位で行う）
 * - 賞与は年 `bonusPaymentCount` 回の等分払いとみなして上限を掛ける
 * - 協会けんぽの健康保険料率は、本来は勤め先（事業所）の所在地の都道府県支部で決まる。勤め先の場所は入力に無いので、
 *   住所の都道府県で代える。表に無い県（見本の架空のコードなど）と県を渡さない呼び出しは、表の `appDefault` の県で概算する
 */

import { roundYen } from '../money'
import type { EmploymentPay } from '../income/promotion'
import type { SocialInsuranceTable, StandardRemunerationGrade, Year, Yen } from '../types'
import { assertNonNegativeYen, assertYear, roundDownTo } from './schedule'

/** 社会保険料を求める入力 */
export type EmployeeSocialInsuranceInput = {
  year: Year
  /** その年の年齢（年 − 生年）。介護保険の判定に使う */
  age: number
  /** 額面の年収（月給ぶん）と賞与の年額 */
  pay: EmploymentPay
  /** 賞与の支給回数（年）。賞与が 0 なら使わない */
  bonusPaymentCount: number
  /**
   * 健康保険料率を引く都道府県のコード（"01"〜"47"。住所の自治体コードの頭 2 桁）。
   * 省くか表に無いときは表の `appDefault.fallbackPrefectureCode` の県で概算する
   */
  prefectureCode?: string
}

/** 社会保険料の内訳（すべて本人負担ぶん・年額） */
export type EmployeeSocialInsurance = {
  /** 健康保険の標準報酬月額 */
  standardMonthly: Yen
  /** 厚生年金の標準報酬月額（健保より上限が低い） */
  pensionStandardMonthly: Yen
  /** 健康保険料（介護・支援金を除く） */
  healthInsurance: Yen
  /** 介護保険料（40〜64 歳のみ） */
  longTermCare: Yen
  /** 子ども・子育て支援金 */
  childRearingSupport: Yen
  /** 厚生年金保険料 */
  pension: Yen
  /** 雇用保険料 */
  employmentInsurance: Yen
  /** 合計。所得税・住民税の社会保険料控除に使う */
  total: Yen
}

/**
 * その年の社会保険料（本人負担）を求める。
 *
 * 年収が 0（退職後など）なら全項目 0 を返す。
 *
 * @throws {RangeError} 年・年齢・金額・支給回数が不正なとき、表がその年に対応していないとき
 */
export function employeeSocialInsurance(
  input: EmployeeSocialInsuranceInput,
  table: SocialInsuranceTable,
): EmployeeSocialInsurance {
  const { year, age, pay, bonusPaymentCount } = input
  assertYear(year)
  if (!Number.isInteger(age) || age < 0) {
    throw new RangeError(`年齢は 0 以上の整数で指定してください: ${age}`)
  }
  assertNonNegativeYen(pay.annualGross, '額面の年収')
  assertNonNegativeYen(pay.annualBonus, '賞与の年額')
  if (pay.annualBonus > 0 && (!Number.isInteger(bonusPaymentCount) || bonusPaymentCount <= 0)) {
    throw new RangeError(`賞与の支給回数は正の整数で指定してください: ${bonusPaymentCount}`)
  }

  const { healthInsurance: health, pension } = table
  if (year < health.fiscalYear) {
    throw new RangeError(`社会保険料の表は ${health.fiscalYear} 年度からしかありません: ${year} 年`)
  }

  if (pay.annualGross === 0 && pay.annualBonus === 0) {
    return {
      standardMonthly: 0,
      pensionStandardMonthly: 0,
      healthInsurance: 0,
      longTermCare: 0,
      childRearingSupport: 0,
      pension: 0,
      employmentInsurance: 0,
      total: 0,
    }
  }

  // --- 標準報酬月額 ---
  const monthlyPay = pay.annualGross / 12
  const standardMonthly = lookupGrade(health.grades, monthlyPay).standardMonthly
  const pensionStandardMonthly = pensionStandard(standardMonthly, year, table)

  // --- 標準賞与額 ---
  // 健保は年度内の累計に上限、厚生年金は支給 1 回ごとに上限。等分払いとみなす
  const perPaymentBonus =
    pay.annualBonus === 0
      ? 0
      : roundDownTo(pay.annualBonus / bonusPaymentCount, health.bonusRoundDownUnit)
  const healthBonusBase = Math.min(
    perPaymentBonus * bonusPaymentCount,
    health.bonusCapPerFiscalYear,
  )
  const pensionBonusBase =
    Math.min(roundDownTo(perPaymentBonus, pension.bonusRoundDownUnit), pension.bonusCapPerMonth) *
    (pay.annualBonus === 0 ? 0 : bonusPaymentCount)

  // --- 料率を掛ける（月額は月ごとに丸めて 12 倍。賞与は年額でまとめて丸める） ---
  const isLongTermCareAge = health.longTermCareAgeFrom <= age && age <= health.longTermCareAgeTo
  const healthShare = healthInsuranceRate(input.prefectureCode, table) * health.employeeShare
  const careShare = isLongTermCareAge ? health.longTermCareRate * health.employeeShare : 0
  const supportShare = health.childRearingSupportRate * health.childRearingSupportEmployeeShare
  const pensionShare = pension.rate * pension.employeeShare

  const healthInsurance = annualPremium(standardMonthly, healthBonusBase, healthShare)
  const longTermCare = annualPremium(standardMonthly, healthBonusBase, careShare)
  const childRearingSupport = annualPremium(standardMonthly, healthBonusBase, supportShare)
  const pensionPremium = annualPremium(pensionStandardMonthly, pensionBonusBase, pensionShare)

  // 雇用保険は賃金（月給 + 賞与）の総額に直接掛ける
  const employmentInsurancePremium = roundYen(
    (pay.annualGross + pay.annualBonus) * employmentInsuranceRate(year, table),
  )

  const total =
    healthInsurance +
    longTermCare +
    childRearingSupport +
    pensionPremium +
    employmentInsurancePremium

  return {
    standardMonthly,
    pensionStandardMonthly,
    healthInsurance,
    longTermCare,
    childRearingSupport,
    pension: pensionPremium,
    employmentInsurance: employmentInsurancePremium,
    total,
  }
}

/**
 * 健康保険料率（協会けんぽの都道府県支部ごと）を引く。表に無い県・県を渡さない呼び出しは、
 * 表の `appDefault.fallbackPrefectureCode` の県の料率で概算する。
 *
 * @throws {RangeError} 代わりの県の料率まで表に無いとき（表の誤り）
 */
export function healthInsuranceRate(
  prefectureCode: string | undefined,
  table: SocialInsuranceTable,
): number {
  const { ratesByPrefecture, appDefault } = table.healthInsurance
  const own = prefectureCode === undefined ? undefined : ratesByPrefecture[prefectureCode]
  if (own !== undefined) {
    return own
  }
  const fallback = ratesByPrefecture[appDefault.fallbackPrefectureCode]
  if (fallback === undefined) {
    throw new RangeError(
      `健康保険料率の代わりの県が表にありません: ${appDefault.fallbackPrefectureCode}`,
    )
  }
  return fallback
}

/** 自治体コード（5 桁）の頭 2 桁＝都道府県コード。健康保険料率を住所の県で引くのに使う */
export function prefectureCodeOf(municipalityCode: string): string {
  return municipalityCode.slice(0, 2)
}

/** 月額ぶん（月ごとに丸めて 12 倍）と賞与ぶん（年額で丸める）を足す */
function annualPremium(standardMonthly: Yen, bonusBase: Yen, share: number): Yen {
  return roundYen(standardMonthly * share) * 12 + roundYen(bonusBase * share)
}

/**
 * 報酬月額が入る等級を返す。`from` 以上 `to` 未満（`to` が null は上限なし）。
 *
 * @throws {RangeError} どの等級にも入らないとき（表の欠落）
 */
function lookupGrade(
  grades: readonly StandardRemunerationGrade[],
  monthlyPay: Yen,
): StandardRemunerationGrade {
  const found = grades.find(
    (grade) => grade.from <= monthlyPay && (grade.to === null || monthlyPay < grade.to),
  )
  if (found === undefined) {
    throw new RangeError(`標準報酬月額の等級表に報酬月額 ${monthlyPay} 円が入る等級がありません`)
  }
  return found
}

/**
 * 厚生年金の標準報酬月額。
 *
 * 等級表がある期間はその表で引く。上限額だけが決まっている期間（2027 年 9 月以降の段階的な引き上げ）は、
 * 健保の標準報酬月額を下限・上限で挟んで代用する。厚生年金の等級は健保の等級と同じ刻みで、
 * 重なる範囲では標準報酬月額が一致するため、上限だけ変えれば新等級と同じ値になる。
 *
 * 適用する表は「その年の 4 月」時点のもの。年の途中で上限が変わる年（2027〜2029 年の 9 月）は、
 * 変更前の上限を暦年全体に使う（差は上限付近の高所得者で年 1 万円未満）。
 *
 * @throws {RangeError} その年に効く表も上限も無いとき
 */
function pensionStandard(healthStandardMonthly: Yen, year: Year, table: SocialInsuranceTable): Yen {
  const { pension } = table
  const yearMonth = fiscalYearStartMonth(year)

  const period = pension.grades.schedule.find(
    (entry) =>
      entry.fromMonth <= yearMonth && (entry.untilMonth === null || yearMonth <= entry.untilMonth),
  )
  if (period !== undefined) {
    return lookupGrade(period.grades, healthStandardMonthly).standardMonthly
  }

  // 等級表の無い期間：上限スケジュールのうち、その時点で効いている最新のものを使う
  const limit = [...pension.upperLimitSchedule]
    .filter((entry) => entry.fromMonth <= yearMonth)
    .sort((a, b) => (a.fromMonth < b.fromMonth ? 1 : -1))[0]
  const latestGrades = pension.grades.schedule[pension.grades.schedule.length - 1]
  if (limit === undefined || latestGrades === undefined) {
    throw new RangeError(`厚生年金の標準報酬月額の表に ${year} 年に効くものがありません`)
  }
  const minimum = latestGrades.grades[0]?.standardMonthly
  if (minimum === undefined) {
    throw new RangeError('厚生年金の等級表が空です')
  }
  return Math.min(Math.max(healthStandardMonthly, minimum), limit.maxStandardMonthly)
}

/**
 * 雇用保険の本人負担の料率。既定の事業の種類（一般の事業）で、その年度の率を引く。
 * 年度の値が無い将来年は最新の年度を延ばす。
 *
 * @throws {RangeError} その年以前の年度の表が無いとき
 */
function employmentInsuranceRate(year: Year, table: SocialInsuranceTable): number {
  const { employmentInsurance } = table
  const candidates = employmentInsurance.schedule
    .filter(
      (entry) =>
        entry.businessType === employmentInsurance.defaultBusinessType && entry.fiscalYear <= year,
    )
    .sort((a, b) => b.fiscalYear - a.fiscalYear)
  const latest = candidates[0]
  if (latest === undefined) {
    throw new RangeError(`雇用保険の料率に ${year} 年度以前の表がありません`)
  }
  return latest.employeeRate
}

/** その年の 4 月（年度の開始月）を "YYYY-MM" で返す。表の `fromMonth` と文字列で比較する */
function fiscalYearStartMonth(year: Year): string {
  return `${year}-04`
}

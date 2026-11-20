/**
 * 給与所得者 1 人の「額面 → 手取り」。社会保険料 → 所得税 → 住民税の順に束ねる。
 *
 * 手取り = 額面 − 社会保険料 − 所得税 − 住民税。
 * 社会保険料は額面だけで決まり、所得税は「給与所得 − 社会保険料控除 − 人的控除」に掛かり、
 * 住民税は**前年の所得**に対して当年度に掛かる。この 1 年のずれを壊さないよう、この関数は
 * 「その年の所得が生む翌年度の住民税」を返すだけにし、その年に納める住民税（前年の所得ぶん）は
 * 呼び出し側が持ち回って `employmentNetPay` に渡す（`TaxBase` の持ち回りはフェーズ 2 の (2)〜(3)）。
 *
 * 逆算（必要手取り → 必要額面）のように「同じ給与がずっと続く」前提で 1 年ぶんの手取りが欲しいときは
 * `steadyStateEmploymentNetPay` を使う（前年も同じ所得だったとみなして翌年度の住民税を当年に当てる）。
 */

import type { EmploymentPay } from '../income/promotion'
import type { MasterTables, MunicipalityCode, PersonalDeductionContext, Year, Yen } from '../types'
import { employmentIncomeAmount, incomeTax, type IncomeTaxResult } from './incomeTax'
import { residentTax, type ResidentTaxResult } from './residentTax'
import {
  employeeSocialInsurance,
  prefectureCodeOf,
  type EmployeeSocialInsurance,
} from './socialInsurance'

/** 税・社会保険の計算に要るマスタデータ */
export type TaxTables = Pick<MasterTables, 'incomeTax' | 'socialInsurance' | 'residentTax'>

/** 給与の税・社会保険を求める入力 */
export type EmploymentTaxInput = {
  year: Year
  /** 額面の年収（月給ぶん）と賞与の年額 */
  pay: EmploymentPay
  /** その年の年齢（年 − 生年） */
  age: number
  /** 賞与の支給回数（年） */
  bonusPaymentCount: number
  /** 住民税の課税地（1 月 1 日時点の住所地） */
  municipalityCode: MunicipalityCode
  personal: PersonalDeductionContext
}

/** ある年の給与に掛かる税・社会保険 */
export type EmploymentTaxYear = {
  year: Year
  /** 給与等の収入金額（月給 + 賞与の額面） */
  grossRevenue: Yen
  /** 給与所得（収入 − 給与所得控除）。合計所得金額として住民税・保育料の判定に使う */
  employmentIncome: Yen
  socialInsurance: EmployeeSocialInsurance
  incomeTax: IncomeTaxResult
  /** この年の所得に対して翌年度に課される住民税 */
  residentTaxNextFiscalYear: ResidentTaxResult
}

/**
 * ある年の給与に掛かる社会保険料・所得税と、翌年度の住民税を求める。
 *
 * @throws {RangeError} 入力が不正なとき、表がその年に対応していないとき
 */
export function employmentTaxYear(input: EmploymentTaxInput, tables: TaxTables): EmploymentTaxYear {
  const { year, pay, age, bonusPaymentCount, municipalityCode, personal } = input

  // 健康保険料率は住所の県で引く（本来は勤め先の所在地の支部。socialInsurance.ts の前提）
  const socialInsurance = employeeSocialInsurance(
    { year, age, pay, bonusPaymentCount, prefectureCode: prefectureCodeOf(municipalityCode) },
    tables.socialInsurance,
  )
  const grossRevenue = pay.annualGross + pay.annualBonus
  const employmentIncome = employmentIncomeAmount(grossRevenue, year, tables.incomeTax)

  const tax = incomeTax(
    {
      year,
      totalIncome: employmentIncome,
      socialInsurancePaid: socialInsurance.total,
      personal,
    },
    tables.incomeTax,
  )
  const residentTaxNextFiscalYear = residentTax(
    {
      incomeYear: year,
      municipalityCode,
      totalIncome: employmentIncome,
      socialInsurancePaid: socialInsurance.total,
      personal,
    },
    tables.residentTax,
  )

  return {
    year,
    grossRevenue,
    employmentIncome,
    socialInsurance,
    incomeTax: tax,
    residentTaxNextFiscalYear,
  }
}

/**
 * その年の手取り。住民税は前年の所得ぶん（呼び出し側が持ち回る）を引く。
 *
 * @param residentTaxPaid その年に納める住民税（前年の所得に対する当年度分）
 * @throws {RangeError} 住民税が負または有限でないとき
 */
export function employmentNetPay(taxYear: EmploymentTaxYear, residentTaxPaid: Yen): Yen {
  if (!Number.isFinite(residentTaxPaid) || residentTaxPaid < 0) {
    throw new RangeError(`納める住民税は 0 以上の有限の数値で指定してください: ${residentTaxPaid}`)
  }
  return (
    taxYear.grossRevenue - taxYear.socialInsurance.total - taxYear.incomeTax.tax - residentTaxPaid
  )
}

/**
 * 同じ給与が前年も続いていた前提での 1 年ぶんの手取り（定常状態）。
 *
 * 翌年度の住民税をそのまま当年に当てる。逆算（必要手取り → 必要額面の二分探索）や
 * 「この年収なら手取りはいくらか」の目安に使う。年次シミュレーションの各年には使わない
 * （前年の所得が違う年は `employmentNetPay` に前年ぶんの住民税を渡す）。
 */
export function steadyStateEmploymentNetPay(input: EmploymentTaxInput, tables: TaxTables): Yen {
  const taxYear = employmentTaxYear(input, tables)
  return employmentNetPay(taxYear, taxYear.residentTaxNextFiscalYear.total)
}

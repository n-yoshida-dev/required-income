/**
 * 1 人ぶんの「収入 → 手取り」。給与・事業・不動産・副業（雑所得）を同じ人に合算して税を掛ける。
 *
 * 所得税と住民税は所得の種類を問わず同じ計算（`incomeTax.ts` / `residentTax.ts`）を使い、違うのは社会保険だけ：
 * 会社員は給与から決まる健康保険・厚生年金（`socialInsurance.ts`）、個人事業主は国民健康保険と国民年金
 * （`nationalInsurance.ts`）。給与だけの人をこの関数に通した結果は `employment.ts` と一致する。
 *
 * **前年の所得で決まるものが 2 つある。** 住民税と国民健康保険料は前年の所得に対して当年に掛かる。
 * この関数はその年の所得だけを見て、
 * - 国保・国民年金はその年に納める額を**引数で受け取り**（国保は前年の `TaxBase` から呼び出し側が先に求める）、
 * - 住民税は「その年の所得が生む翌年度の額」を**返す**（`employment.ts` と同じ形）。
 * 年をまたぐ受け渡しは `householdTaxBase` が作る `TaxBase` で行う（SPEC §2.4）。
 *
 * 国保は世帯主に世帯ぶんがまとめて請求され、払った人の社会保険料控除になる。誰が払うかは呼び出し側が決め、
 * 払う人の `nationalInsurancePaid` に載せる。
 */

import type { EmploymentPay } from '../income/promotion'
import type {
  FilingType,
  MunicipalityCode,
  PersonId,
  PersonalDeductionContext,
  TaxBase,
  Year,
  Yen,
} from '../types'
import type { TaxTables } from './employment'
import { employmentIncomeAmount, incomeTax, type IncomeTaxResult } from './incomeTax'
import { residentTax, type ResidentTaxResult } from './residentTax'
import { assertNonNegativeYen } from './schedule'
import {
  employeeSocialInsurance,
  prefectureCodeOf,
  type EmployeeSocialInsurance,
} from './socialInsurance'
import { totalIncomeOf, type TotalIncomeResult } from './totalIncome'

/** 1 人ぶんの税・社会保険を求める入力 */
export type PersonTaxInput = {
  year: Year
  /**
   * 会社の社会保険料の表を引く年。省略すると `year`。
   * 社会保険の表が始まる年より前の年を、表の最初の年度として計算するために世帯の束ね（`household.ts`）が渡す。
   * 所得税と住民税は年分ごとの表があるので、こちらには影響させない
   */
  socialInsuranceTableYear?: Year
  /** その年の年齢（年 − 生年） */
  age: number
  /** 住民税の課税地（1 月 1 日時点の住所地） */
  municipalityCode: MunicipalityCode
  personal: PersonalDeductionContext
  /** 給与。会社員でなければ null（会社の社会保険は給与がある人だけに掛かる） */
  employment: { pay: EmploymentPay; bonusPaymentCount: number } | null
  /** 事業所得（収入 − 経費。青色申告特別控除前。赤字は負）。事業として申告する副業はここに足す */
  businessProfit: Yen
  /** 申告方式。事業をしていなければ null */
  filingType: FilingType | null
  /** 不動産所得（家賃収入 − 運営経費。赤字は負） */
  realEstateProfit: Yen
  /** 雑所得として申告する副業（収入 − 経費） */
  miscellaneousProfit: Yen
  /** この人がその年に納める国民健康保険料と国民年金保険料。納めない人は両方 0 */
  nationalInsurancePaid: { healthInsurance: Yen; pension: Yen }
}

/** ある年の 1 人ぶんの税・社会保険 */
export type PersonTaxYear = {
  year: Year
  /** 手元に入る額（給与の額面 + 事業・不動産・副業の所得）。青色申告特別控除は引かない（現金は出ていかない） */
  cashIncome: Yen
  income: TotalIncomeResult
  socialInsurance: {
    /** 会社の社会保険（本人負担）。給与が無ければ null */
    employee: EmployeeSocialInsurance | null
    nationalHealthInsurance: Yen
    nationalPension: Yen
    total: Yen
  }
  incomeTax: IncomeTaxResult
  /** この年の所得に対して翌年度に課される住民税 */
  residentTaxNextFiscalYear: ResidentTaxResult
}

/**
 * ある年の 1 人ぶんの社会保険料・所得税と、翌年度の住民税を求める。
 *
 * @throws {RangeError} 入力が不正なとき、表がその年に対応していないとき
 */
export function personTaxYear(input: PersonTaxInput, tables: TaxTables): PersonTaxYear {
  const { year, age, municipalityCode, personal, employment, nationalInsurancePaid } = input
  assertNonNegativeYen(nationalInsurancePaid.healthInsurance, '国民健康保険料')
  assertNonNegativeYen(nationalInsurancePaid.pension, '国民年金保険料')

  const employee =
    employment === null
      ? null
      : employeeSocialInsurance(
          {
            year: input.socialInsuranceTableYear ?? year,
            age,
            pay: employment.pay,
            bonusPaymentCount: employment.bonusPaymentCount,
            // 健康保険料率は住所の県で引く（本来は勤め先の所在地の支部。socialInsurance.ts の前提）
            prefectureCode: prefectureCodeOf(municipalityCode),
          },
          tables.socialInsurance,
        )
  const grossPay = employment === null ? 0 : employment.pay.annualGross + employment.pay.annualBonus

  const income = personTotalIncome(input, tables)

  const socialInsuranceTotal =
    (employee?.total ?? 0) + nationalInsurancePaid.healthInsurance + nationalInsurancePaid.pension

  const tax = incomeTax(
    { year, totalIncome: income.totalIncome, socialInsurancePaid: socialInsuranceTotal, personal },
    tables.incomeTax,
  )
  const residentTaxNextFiscalYear = residentTax(
    {
      incomeYear: year,
      municipalityCode,
      totalIncome: income.totalIncome,
      socialInsurancePaid: socialInsuranceTotal,
      personal,
    },
    tables.residentTax,
  )

  return {
    year,
    // 雑所得の赤字も現金の流出なので、0 に切り捨てる前の額を足す（税の計算だけが赤字を無視する）
    cashIncome:
      grossPay + input.businessProfit + input.realEstateProfit + input.miscellaneousProfit,
    income,
    socialInsurance: {
      employee,
      nationalHealthInsurance: nationalInsurancePaid.healthInsurance,
      nationalPension: nationalInsurancePaid.pension,
      total: socialInsuranceTotal,
    },
    incomeTax: tax,
    residentTaxNextFiscalYear,
  }
}

/**
 * 1 人ぶんの合計所得金額（給与所得控除と青色申告特別控除を引いたあと。所得控除を引く前）。
 *
 * `personTaxYear` の最初の段だけを切り出したもの。配偶者控除は相手の合計所得金額で決まるので、
 * 世帯を束ねる側（`household.ts`）は全員ぶんをこれで先に求めてから `PersonalDeductionContext` を組み立てる。
 * 社会保険料や家族の情報には依存しない。
 *
 * @throws {RangeError} 入力が不正なとき、表がその年に対応していないとき
 */
export function personTotalIncome(
  input: Pick<
    PersonTaxInput,
    | 'year'
    | 'employment'
    | 'businessProfit'
    | 'filingType'
    | 'realEstateProfit'
    | 'miscellaneousProfit'
  >,
  tables: Pick<TaxTables, 'incomeTax'>,
): TotalIncomeResult {
  const { year, employment } = input
  const grossPay = employment === null ? 0 : employment.pay.annualGross + employment.pay.annualBonus
  return totalIncomeOf(
    {
      employmentIncome:
        employment === null ? 0 : employmentIncomeAmount(grossPay, year, tables.incomeTax),
      businessProfit: input.businessProfit,
      realEstateProfit: input.realEstateProfit,
      miscellaneousProfit: input.miscellaneousProfit,
      filingType: input.filingType,
    },
    tables.incomeTax,
  )
}

/**
 * その年の手取り。住民税は前年の所得ぶん（呼び出し側が `TaxBase` で持ち回る）を引く。
 * 事業が赤字の年は負になりうる（赤字と社会保険料はそのまま資金の流出）。
 *
 * @param residentTaxPaid その年に納める住民税（前年の所得に対する当年度分）
 * @throws {RangeError} 住民税が負または有限でないとき
 */
export function personNetIncome(taxYear: PersonTaxYear, residentTaxPaid: Yen): Yen {
  assertNonNegativeYen(residentTaxPaid, '納める住民税')
  return (
    taxYear.cashIncome - taxYear.socialInsurance.total - taxYear.incomeTax.tax - residentTaxPaid
  )
}

/**
 * 世帯のその年の `TaxBase`（翌年の住民税・国民健康保険料・保育料の材料）を作る。
 *
 * 年ループは「前年の `TaxBase` から当年の国保料と住民税を決める → 当年の `personTaxYear` を求める →
 * 当年の `TaxBase` を作って翌年へ渡す」の順に回す。
 *
 * @throws {RangeError} 同じ人が 2 回出てくる、年が揃っていないとき
 */
export function householdTaxBase(
  year: Year,
  people: readonly { personId: PersonId; taxYear: PersonTaxYear }[],
): TaxBase {
  const totalIncomeByPerson = new Map<PersonId, Yen>()
  const residentTaxNextFiscalYearByPerson = new Map<PersonId, Yen>()
  let municipalTaxIncomeLevy = 0
  for (const { personId, taxYear } of people) {
    if (taxYear.year !== year) {
      throw new RangeError(`TaxBase の年と計算結果の年が違います: ${year} / ${taxYear.year}`)
    }
    if (totalIncomeByPerson.has(personId)) {
      throw new RangeError(`同じ世帯員が 2 回渡されました: ${personId}`)
    }
    totalIncomeByPerson.set(personId, taxYear.income.totalIncome)
    residentTaxNextFiscalYearByPerson.set(personId, taxYear.residentTaxNextFiscalYear.total)
    municipalTaxIncomeLevy += taxYear.residentTaxNextFiscalYear.childcareMunicipalIncomeLevy
  }
  return { year, totalIncomeByPerson, residentTaxNextFiscalYearByPerson, municipalTaxIncomeLevy }
}

/**
 * 1 人ぶんの「収入 → 手取り」の結合。各段の期待値は nationalInsurance / incomeTax / residentTax のテストと同じ手計算。
 *
 * 基準ケース（2026 年・1984 年生まれ（42 歳）・個人事業主・川崎市・扶養なし・事業の所得 565 万・青色 65 万）：
 * - 合計所得金額 = 565 万 − 65 万 = 500 万
 * - 前年も同じ所得なら 国保 722,335 円 + 国民年金 215,040 円 = 社会保険料 937,375 円
 * - 所得税：500 万 − 937,375 − 基礎控除 67 万 → 課税所得 3,392,000 → 250,900 × 1.021 = 256,169 円
 * - 翌年度の住民税：500 万 − 937,375 − 43 万 → 課税所得 3,632,000 → 366,908 円
 * - 定常状態の手取り = 565 万 − 937,375 − 256,169 − 366,908 = 4,089,548 円
 */

import { describe, expect, it } from 'vitest'
import { employmentNetPay, employmentTaxYear } from '../../../src/domain/tax/employment'
import {
  nationalHealthInsurance,
  nationalPensionPremium,
} from '../../../src/domain/tax/nationalInsurance'
import {
  householdTaxBase,
  personNetIncome,
  personTaxYear,
  type PersonTaxInput,
} from '../../../src/domain/tax/person'
import type { TaxBase } from '../../../src/domain/types'
import { masterTables } from '../fixtures'

const BIRTH_YEAR = 1984

const soleProprietor: PersonTaxInput = {
  year: 2026,
  age: 2026 - BIRTH_YEAR,
  municipalityCode: '14130',
  personal: { spouse: null, dependents: [] },
  employment: null,
  businessProfit: 5650000,
  filingType: 'blue65',
  realEstateProfit: 0,
  miscellaneousProfit: 0,
  nationalInsurancePaid: { healthInsurance: 722335, pension: 215040 },
}

const employee: PersonTaxInput = {
  year: 2026,
  age: 35,
  municipalityCode: '14130',
  personal: { spouse: null, dependents: [] },
  employment: { pay: { annualGross: 4200000, annualBonus: 800000 }, bonusPaymentCount: 2 },
  businessProfit: 0,
  filingType: null,
  realEstateProfit: 0,
  miscellaneousProfit: 0,
  nationalInsurancePaid: { healthInsurance: 0, pension: 0 },
}

describe('personTaxYear：個人事業主', () => {
  it('青色申告特別控除 → 国保・国民年金の控除 → 所得税 → 翌年度の住民税を順に出す', () => {
    const result = personTaxYear(soleProprietor, masterTables)
    expect(result.cashIncome).toBe(5650000)
    expect(result.income.blueReturnDeduction.total).toBe(650000)
    expect(result.income.totalIncome).toBe(5000000)
    expect(result.socialInsurance).toEqual({
      employee: null,
      nationalHealthInsurance: 722335,
      nationalPension: 215040,
      total: 937375,
    })
    expect(result.incomeTax.deductions.socialInsurance).toBe(937375)
    expect(result.incomeTax.taxableIncome).toBe(3392000)
    expect(result.incomeTax.tax).toBe(256169)
    expect(result.residentTaxNextFiscalYear.fiscalYear).toBe(2027)
    expect(result.residentTaxNextFiscalYear.taxableIncome).toBe(3632000)
    expect(result.residentTaxNextFiscalYear.total).toBe(366908)
  })

  it('手取り = 所得 − 国保・国民年金 − 所得税 − 渡された住民税（青色申告特別控除は現金が出ていかない）', () => {
    const taxYear = personTaxYear(soleProprietor, masterTables)
    expect(personNetIncome(taxYear, 366908)).toBe(4089548)
    expect(() => personNetIncome(taxYear, -1)).toThrow(RangeError)
    expect(() => personNetIncome(taxYear, Number.NaN)).toThrow(RangeError)
  })

  it('国保の前年所得には、この関数が返す合計所得金額をそのまま使える', () => {
    const taxYear = personTaxYear(soleProprietor, masterTables)
    const nhi = nationalHealthInsurance(
      {
        fiscalYear: 2027,
        municipalityCode: '14130',
        members: [
          {
            personId: 'owner',
            birthYear: BIRTH_YEAR,
            birthMonth: null,
            previousYearTotalIncome: taxYear.income.totalIncome,
            isSalaryEarner: false,
          },
        ],
        householder: { kind: 'member', personId: 'owner' },
      },
      masterTables.nationalInsurance,
    )
    // (500 万 − 43 万) × 料率 + 均等割。医療分 420,743・支援分 147,379・介護分 137,847・子ども分 16,366
    expect(nhi.total).toBe(722335)
  })

  it('事業が赤字の年は税が 0 でも、赤字と社会保険料がそのまま流出する', () => {
    const taxYear = personTaxYear(
      {
        ...soleProprietor,
        businessProfit: -500000,
        nationalInsurancePaid: { healthInsurance: 54000, pension: 215040 },
      },
      masterTables,
    )
    expect(taxYear.income.totalIncome).toBe(0)
    expect(taxYear.income.netLoss).toBe(500000)
    expect(taxYear.incomeTax.tax).toBe(0)
    expect(taxYear.residentTaxNextFiscalYear.total).toBe(0)
    expect(personNetIncome(taxYear, 0)).toBe(-769040)
  })

  it('国保・国民年金が負または有限でなければ例外', () => {
    expect(() =>
      personTaxYear(
        { ...soleProprietor, nationalInsurancePaid: { healthInsurance: -1, pension: 0 } },
        masterTables,
      ),
    ).toThrow(RangeError)
    expect(() =>
      personTaxYear(
        { ...soleProprietor, nationalInsurancePaid: { healthInsurance: 0, pension: Number.NaN } },
        masterTables,
      ),
    ).toThrow(RangeError)
  })
})

describe('personTaxYear：給与のある人', () => {
  it('給与だけなら employment.ts の束ねと同じ結果になる', () => {
    const viaPerson = personTaxYear(employee, masterTables)
    const viaEmployment = employmentTaxYear(
      {
        year: 2026,
        pay: { annualGross: 4200000, annualBonus: 800000 },
        age: 35,
        bonusPaymentCount: 2,
        municipalityCode: '14130',
        personal: { spouse: null, dependents: [] },
      },
      masterTables,
    )
    expect(viaPerson.cashIncome).toBe(viaEmployment.grossRevenue)
    expect(viaPerson.income.totalIncome).toBe(viaEmployment.employmentIncome)
    expect(viaPerson.socialInsurance.employee).toEqual(viaEmployment.socialInsurance)
    expect(viaPerson.incomeTax).toEqual(viaEmployment.incomeTax)
    expect(viaPerson.residentTaxNextFiscalYear).toEqual(viaEmployment.residentTaxNextFiscalYear)
    expect(personNetIncome(viaPerson, 240994)).toBe(employmentNetPay(viaEmployment, 240994))
    expect(personNetIncome(viaPerson, 240994)).toBe(3915532)
  })

  it('不動産所得の赤字は給与所得と損益通算され、税が下がる', () => {
    // 給与所得 356 万 − 36 万 = 320 万。所得税 70,300 × 1.021 = 71,776、翌年度の住民税 204,904
    const taxYear = personTaxYear({ ...employee, realEstateProfit: -360000 }, masterTables)
    expect(taxYear.income.totalIncome).toBe(3200000)
    expect(taxYear.incomeTax.tax).toBe(71776)
    expect(taxYear.residentTaxNextFiscalYear.total).toBe(204904)
    // 手元は 500 万 − 36 万。社会保険料は給与だけで決まるので変わらない
    expect(taxYear.socialInsurance.total).toBe(753320)
    expect(personNetIncome(taxYear, 204904)).toBe(3610000)
  })

  it('雑所得の副業は特別控除なしで給与に足され、社会保険料は増えない', () => {
    // 356 万 + 46 万 = 402 万。所得税 125,100 × 1.021 = 127,727、翌年度の住民税 287,109
    const taxYear = personTaxYear({ ...employee, miscellaneousProfit: 460000 }, masterTables)
    expect(taxYear.income.totalIncome).toBe(4020000)
    expect(taxYear.socialInsurance.total).toBe(753320)
    expect(taxYear.incomeTax.tax).toBe(127727)
    expect(taxYear.residentTaxNextFiscalYear.total).toBe(287109)
    expect(personNetIncome(taxYear, 287109)).toBe(4291844)
  })

  it('雑所得の赤字は税を下げないが、手元の現金は減る', () => {
    const taxYear = personTaxYear({ ...employee, miscellaneousProfit: -150000 }, masterTables)
    expect(taxYear.incomeTax.tax).toBe(90154)
    expect(taxYear.residentTaxNextFiscalYear.total).toBe(240994)
    expect(personNetIncome(taxYear, 240994)).toBe(3915532 - 150000)
  })
})

describe('householdTaxBase：前年の所得を翌年へ持ち回る', () => {
  it('世帯員ごとの合計所得金額・翌年度の住民税と、保育料用の市民税所得割の世帯合計を持つ', () => {
    const owner = personTaxYear(soleProprietor, masterTables)
    const partner = personTaxYear(employee, masterTables)
    const taxBase = householdTaxBase(2026, [
      { personId: 'owner', taxYear: owner },
      { personId: 'partner', taxYear: partner },
    ])
    expect(taxBase.year).toBe(2026)
    expect(taxBase.totalIncomeByPerson.get('owner')).toBe(5000000)
    expect(taxBase.totalIncomeByPerson.get('partner')).toBe(3560000)
    expect(taxBase.residentTaxNextFiscalYearByPerson.get('owner')).toBe(366908)
    expect(taxBase.residentTaxNextFiscalYearByPerson.get('partner')).toBe(240994)
    // 6% 換算・調整控除後：3,632,000 × 6% − 1,500 と 2,376,000 × 6% − 1,500
    expect(taxBase.municipalTaxIncomeLevy).toBe(216420 + 141060)
  })

  it('年の違う結果・同じ人の重複は例外', () => {
    const owner = personTaxYear(soleProprietor, masterTables)
    expect(() => householdTaxBase(2027, [{ personId: 'owner', taxYear: owner }])).toThrow(
      RangeError,
    )
    expect(() =>
      householdTaxBase(2026, [
        { personId: 'owner', taxYear: owner },
        { personId: 'owner', taxYear: owner },
      ]),
    ).toThrow(RangeError)
  })

  it('所得が増えた翌年に国保と住民税が増える（1 年のずれ）', () => {
    // 事業の所得が 2026 年 215 万 → 2027・2028 年 565 万。2025 年は 2026 年と同じ所得だったとみなす
    const profitByYear = new Map([
      [2026, 2150000],
      [2027, 5650000],
      [2028, 5650000],
    ])

    /** 前年の TaxBase から当年の国保を出す */
    const nhiFrom = (previous: TaxBase, fiscalYear: number) =>
      nationalHealthInsurance(
        {
          fiscalYear,
          municipalityCode: '14130',
          members: [
            {
              personId: 'owner',
              birthYear: BIRTH_YEAR,
              birthMonth: null,
              previousYearTotalIncome: previous.totalIncomeByPerson.get('owner') ?? 0,
              isSalaryEarner: false,
            },
          ],
          householder: { kind: 'member', personId: 'owner' },
        },
        masterTables.nationalInsurance,
      ).total

    // 起点の前年（2025 年）：2026 年と同じ所得の定常状態
    let previous: TaxBase = {
      year: 2025,
      totalIncomeByPerson: new Map([['owner', 1500000]]),
      residentTaxNextFiscalYearByPerson: new Map([['owner', 65657]]),
      municipalTaxIncomeLevy: 0,
    }

    const rows = new Map<
      number,
      { nhi: number; incomeTax: number; residentTaxPaid: number; net: number }
    >()
    for (const [year, businessProfit] of profitByYear) {
      const nhi = nhiFrom(previous, year)
      const taxYear = personTaxYear(
        {
          ...soleProprietor,
          year,
          age: year - BIRTH_YEAR,
          businessProfit,
          nationalInsurancePaid: {
            healthInsurance: nhi,
            pension: nationalPensionPremium(year, 1, masterTables.nationalInsurance),
          },
        },
        masterTables,
      )
      const residentTaxPaid = previous.residentTaxNextFiscalYearByPerson.get('owner') ?? 0
      rows.set(year, {
        nhi,
        incomeTax: taxYear.incomeTax.tax,
        residentTaxPaid,
        net: personNetIncome(taxYear, residentTaxPaid),
      })
      previous = householdTaxBase(year, [{ personId: 'owner', taxYear }])
    }

    // 2026：所得 150 万。国保は (150 万 − 43 万) × 料率 + 均等割 = 227,435
    expect(rows.get(2026)).toEqual({
      nhi: 227435,
      incomeTax: 868,
      residentTaxPaid: 65657,
      net: 1641000,
    })
    // 2027：所得は 500 万に増えたが、国保と住民税はまだ前年（150 万）の水準
    expect(rows.get(2027)).toEqual({
      nhi: 227435,
      incomeTax: 356431,
      residentTaxPaid: 65657,
      net: 4780997,
    })
    // 2028：所得は同じ 500 万でも、国保 +49 万・住民税 +35 万が 1 年遅れて乗り、手取りが 75 万減る
    expect(rows.get(2028)).toEqual({
      nhi: 722335,
      incomeTax: 265562,
      residentTaxPaid: 416131,
      net: 4026492,
    })
  })
})

/**
 * 給与の「額面 → 手取り」の結合。各段の期待値は socialInsurance / incomeTax / residentTax のテストと同じ手計算。
 *
 * 基準ケース（2026 年・35 歳・月給ぶん 420 万・賞与 80 万を 2 回・川崎市・扶養なし）：
 * - 社会保険料 753,320 円 → 給与所得 356 万 → 所得税 90,154 円 → 翌年度の住民税 240,994 円
 * - 定常状態の手取り = 500 万 − 753,320 − 90,154 − 240,994 = 3,915,532 円
 */

import { describe, expect, it } from 'vitest'
import {
  employmentNetPay,
  employmentTaxYear,
  steadyStateEmploymentNetPay,
} from '../../../src/domain/tax/employment'
import { masterTables } from '../fixtures'

const base = {
  year: 2026,
  pay: { annualGross: 4200000, annualBonus: 800000 },
  age: 35,
  bonusPaymentCount: 2,
  municipalityCode: '14130',
  personal: { spouse: null, dependents: [] },
}

describe('employmentTaxYear', () => {
  it('社会保険料 → 給与所得 → 所得税 → 翌年度の住民税を順に出す', () => {
    const result = employmentTaxYear(base, masterTables)
    expect(result.grossRevenue).toBe(5000000)
    expect(result.socialInsurance.total).toBe(753320)
    expect(result.employmentIncome).toBe(3560000)
    expect(result.incomeTax.deductions.socialInsurance).toBe(753320)
    expect(result.incomeTax.tax).toBe(90154)
    expect(result.residentTaxNextFiscalYear.fiscalYear).toBe(2027)
    expect(result.residentTaxNextFiscalYear.total).toBe(240994)
  })

  it('住民税の課税地は自治体コードで切り替わる', () => {
    const yokohama = employmentTaxYear({ ...base, municipalityCode: '14100' }, masterTables)
    expect(yokohama.residentTaxNextFiscalYear.total).toBe(241894)
  })

  it('健康保険料率は住所の県（自治体コードの頭 2 桁）で引く（2026-11-20）', () => {
    // 27：36 万 × 10.13% ÷ 2 = 18,234 円/月 → 218,808 円 + 賞与 80 万 × 5.065% = 40,520 円 = 259,328 円
    // （実装とは別に Decimal で計算した）
    const osaka = employmentTaxYear({ ...base, municipalityCode: '27100' }, masterTables)
    expect(osaka.socialInsurance.healthInsurance).toBe(259328)
    expect(osaka.socialInsurance.total).toBe(753320 - 253952 + 259328)
  })
})

describe('employmentNetPay', () => {
  it('手取り = 額面 − 社会保険料 − 所得税 − 渡された住民税', () => {
    const taxYear = employmentTaxYear(base, masterTables)
    expect(employmentNetPay(taxYear, 240994)).toBe(3915532)
    // 前年の所得が無い年（就職 1 年目）は住民税 0：500 万 − 753,320 − 90,154
    expect(employmentNetPay(taxYear, 0)).toBe(4156526)
  })

  it('住民税が負または有限でなければ例外', () => {
    const taxYear = employmentTaxYear(base, masterTables)
    expect(() => employmentNetPay(taxYear, -1)).toThrow(RangeError)
    expect(() => employmentNetPay(taxYear, Number.NaN)).toThrow(RangeError)
  })
})

describe('steadyStateEmploymentNetPay', () => {
  it('同じ給与が続く前提で、翌年度の住民税をそのまま当年に当てる', () => {
    expect(steadyStateEmploymentNetPay(base, masterTables)).toBe(3915532)
  })

  it('額面が増えると手取りも増えるが、増え方は額面より小さい（累進）', () => {
    const low = steadyStateEmploymentNetPay(base, masterTables)
    const high = steadyStateEmploymentNetPay(
      { ...base, pay: { annualGross: 8400000, annualBonus: 1600000 } },
      masterTables,
    )
    expect(high).toBeGreaterThan(low)
    expect(high - low).toBeLessThan(5000000)
  })

  it('額面 0 なら非課税で手取りも 0（均等割で負にならない）', () => {
    expect(
      steadyStateEmploymentNetPay(
        { ...base, pay: { annualGross: 0, annualBonus: 0 } },
        masterTables,
      ),
    ).toBe(0)
  })
})

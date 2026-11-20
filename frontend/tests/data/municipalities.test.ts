/**
 * 市ごと・県ごとの制度データが互いに食い違っていないかを確かめる（2026-11-20。収録する市を 7 つに広げたとき）。
 * 値そのものは各計算のテストで確かめる。ここは「表どうしの約束」だけを見る。
 */

import { describe, expect, it } from 'vitest'
import codesJson from '../../src/data/municipality/codes.json'
import nationalInsuranceJson from '../../src/data/tax/national-insurance.json'
import residentTaxJson from '../../src/data/tax/resident-tax.json'
import socialInsuranceJson from '../../src/data/tax/social-insurance.json'

const nhi = nationalInsuranceJson.values.nationalHealthInsurance
const residentTax = residentTaxJson.values
const health = socialInsuranceJson.values.healthInsurance
const codes: Record<string, unknown> = codesJson.values

const nhiCodes = Object.keys(nhi.byMunicipality).sort()

describe('収録した市（国保・住民税）', () => {
  it('国保の市と住民税の市が同じ集合で、どれも全国の自治体コードの一覧にある', () => {
    expect(Object.keys(residentTax.municipalities).sort()).toEqual(nhiCodes)
    expect(Object.keys(residentTax.municipalitySurcharges).sort()).toEqual(nhiCodes)
    for (const code of nhiCodes) {
      expect(codes[code], code).toBeDefined()
    }
    // 住民税の行の県コードが自治体コードの頭 2 桁と合い、その県の超過課税の記録がある
    for (const [code, row] of Object.entries(residentTax.municipalities)) {
      expect(row.prefectureCode, code).toBe(code.slice(0, 2))
      expect(Object.keys(residentTax.prefectureSurcharges), code).toContain(row.prefectureCode)
    }
  })

  it('国保の代わりの市は表にあり、会社員の健康保険の代わりの県はその市の県', () => {
    const fallback = nhi.appDefault.fallbackMunicipalityCode
    expect(nhiCodes).toContain(fallback)
    expect(health.appDefault.fallbackPrefectureCode).toBe(fallback.slice(0, 2))
  })

  it('平等割の有無の印と各区分の平等割の額が合い、端数の処理は対応した値だけ', () => {
    for (const [code, row] of Object.entries(nhi.byMunicipality)) {
      const perHousehold = [row.medical, row.support, row.longTermCare, row.childcare].map(
        (segment) => segment.perHousehold,
      )
      expect(
        perHousehold.some((amount) => amount !== 0),
        code,
      ).toBe(row.hasPerHousehold)
      const rounding: Record<string, unknown> = 'rounding' in row ? row.rounding : {}
      for (const [key, value] of Object.entries(rounding)) {
        const allowed: Record<string, readonly unknown[]> = {
          incomeLevy: ['floor', 'perMemberFloor'],
          reductionAmount: ['ceil'],
          segmentPremiumFloorUnit: [10, 100],
        }
        expect(allowed[key], `${code} の rounding.${key}`).toContain(value)
      }
    }
  })
})

describe('協会けんぽの都道府県支部の料率', () => {
  it('01〜47 の 47 支部がそろい、どれも 0 より大きく 0.2 未満', () => {
    const expected = Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(2, '0'))
    expect(Object.keys(health.ratesByPrefecture).sort()).toEqual(expected)
    for (const [prefecture, rate] of Object.entries(health.ratesByPrefecture)) {
      expect(rate, prefecture).toBeGreaterThan(0)
      expect(rate, prefecture).toBeLessThan(0.2)
    }
  })
})

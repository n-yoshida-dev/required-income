/**
 * 期待値は `resident-tax.json` の表から手で計算した値。実装の出力を写していない。
 * 収録した市（`resident-tax.json` の `municipalities`）の自治体コードは制度データの裏取り対象で、実在の値を使ってよい
 * （`.claude/rules/dummy-values.md` の例外）。裏取りの無い自治体は架空の 99001 で表す。
 */

import { describe, expect, it } from 'vitest'
import { residentTax } from '../../../src/domain/tax/residentTax'
import { residentTax as table } from '../fixtures'

const noFamily = { spouse: null, dependents: [] }

/**
 * 基準ケース：2026 年の所得 356 万・社保 753,320 円・扶養なし・川崎市。
 * - 所得控除 = 753,320 + 基礎控除 43 万 = 1,183,320 → 課税所得 2,376,680 → 2,376,000
 * - 所得割（調整控除前）市民税 8% = 190,080、県民税 2.025% = 48,114
 * - 調整控除：人的控除の差 5 万。課税所得 200 万超 → max(5 万 − 37.6 万, 5 万) = 5 万 × 市 4% / 県 1% = 2,000 / 500
 * - 均等割 市 3,000 + 県 1,300 + 森林環境税 1,000
 */
const base = {
  incomeYear: 2026,
  municipalityCode: '14130',
  totalIncome: 3560000,
  socialInsurancePaid: 753320,
  personal: noFamily,
}

describe('residentTax', () => {
  it('基準ケース（川崎市）', () => {
    const result = residentTax(base, table)
    expect(result.fiscalYear).toBe(2027)
    expect(result.municipalityKnown).toBe(true)
    expect(result.deductions.total).toBe(1183320)
    expect(result.taxableIncome).toBe(2376000)
    expect(result.exemptFromIncomeLevy).toBe(false)
    expect(result.exemptFromPerCapitaLevy).toBe(false)
    expect(result.incomeLevyBeforeCredit).toEqual({ municipal: 190080, prefectural: 48114 })
    expect(result.adjustmentCredit).toEqual({ municipal: 2000, prefectural: 500 })
    expect(result.incomeLevy).toEqual({ municipal: 188080, prefectural: 47614 })
    expect(result.perCapitaLevy).toEqual({
      municipal: 3000,
      prefectural: 1300,
      forestEnvironmentTax: 1000,
    })
    expect(result.total).toBe(240994)
  })

  it('保育料用の所得割は 6% で計算し直し、標準税率ぶんの調整控除 3% を引く', () => {
    // 2,376,000 × 6% = 142,560 − 5 万 × 3% = 1,500 → 141,060
    expect(residentTax(base, table).childcareMunicipalIncomeLevy).toBe(141060)
  })

  it('横浜市は均等割が違う（横浜みどり税 900 円を含む市民税 3,900 円）', () => {
    const result = residentTax({ ...base, municipalityCode: '14100' }, table)
    expect(result.incomeLevy).toEqual({ municipal: 188080, prefectural: 47614 })
    expect(result.perCapitaLevy).toEqual({
      municipal: 3900,
      prefectural: 1300,
      forestEnvironmentTax: 1000,
    })
    expect(result.total).toBe(241894)
  })

  it('裏取りの無い自治体は標準税率（6% + 4%・均等割 4,000 円 + 森林環境税）で計算し、その旨を返す', () => {
    const result = residentTax({ ...base, municipalityCode: '99001' }, table)
    expect(result.municipalityKnown).toBe(false)
    expect(result.incomeLevyBeforeCredit).toEqual({ municipal: 142560, prefectural: 95040 })
    expect(result.adjustmentCredit).toEqual({ municipal: 1500, prefectural: 1000 })
    expect(result.incomeLevy).toEqual({ municipal: 141060, prefectural: 94040 })
    expect(result.perCapitaLevy).toEqual({
      municipal: 3000,
      prefectural: 1000,
      forestEnvironmentTax: 1000,
    })
    expect(result.total).toBe(240100)
    // 標準税率の自治体では市民税所得割そのものが保育料の基準
    expect(result.childcareMunicipalIncomeLevy).toBe(141060)
  })

  // 2026-11-20 に足した 5 市（いずれも指定都市・所得割の超過課税なし。均等割は府県・市の上乗せを含む）。
  // 期待値は実装とは別に Decimal で計算した。
  // 課税所得 2,376,000 × 市 8% = 190,080 − 2,000、× 県 2% = 47,520 − 500
  it.each([
    { code: '27100', perCapita: { municipal: 3000, prefectural: 1300 }, total: 240400 },
    { code: '01100', perCapita: { municipal: 3000, prefectural: 1000 }, total: 240100 },
    { code: '40130', perCapita: { municipal: 3000, prefectural: 1500 }, total: 240600 },
    { code: '28100', perCapita: { municipal: 3400, prefectural: 1800 }, total: 241300 },
    { code: '26100', perCapita: { municipal: 3000, prefectural: 1600 }, total: 240700 },
  ])('$code：指定都市の税率（8% + 2%）と、その市の均等割で計算する', (expected) => {
    const result = residentTax({ ...base, municipalityCode: expected.code }, table)
    expect(result.municipalityKnown).toBe(true)
    expect(result.incomeLevyBeforeCredit).toEqual({ municipal: 190080, prefectural: 47520 })
    expect(result.adjustmentCredit).toEqual({ municipal: 2000, prefectural: 500 })
    expect(result.incomeLevy).toEqual({ municipal: 188080, prefectural: 47020 })
    expect(result.perCapitaLevy).toEqual({ ...expected.perCapita, forestEnvironmentTax: 1000 })
    expect(result.total).toBe(expected.total)
  })

  it('課税所得 200 万以下の調整控除は「人的控除の差と課税所得の小さい方」× 5%', () => {
    // 所得 200 万・社保 30 万 → 所得控除 73 万 → 課税所得 127 万。差 5 万 < 127 万 → 5 万 × 4% / 1%
    // 所得割 市 101,600、県 1,270,000 × 2.025% = 25,717.5 → 25,718
    const result = residentTax(
      { ...base, totalIncome: 2000000, socialInsurancePaid: 300000 },
      table,
    )
    expect(result.taxableIncome).toBe(1270000)
    expect(result.incomeLevyBeforeCredit).toEqual({ municipal: 101600, prefectural: 25718 })
    expect(result.adjustmentCredit).toEqual({ municipal: 2000, prefectural: 500 })
    expect(result.total).toBe(99600 + 25218 + 5300)
  })

  it('人的控除：配偶者（所得 0）33 万・17 歳の子 33 万・10 歳の子 0。調整控除の差は 5 + 5 + 5 万', () => {
    // 所得 500 万・社保 70 万 → 所得控除 179 万 → 課税所得 321 万
    // 市 256,800、県 3,210,000 × 2.025% = 65,002.5 → 65,003。差 15 万 − 121 万 < 5 万 → 5 万
    const result = residentTax(
      {
        ...base,
        totalIncome: 5000000,
        socialInsurancePaid: 700000,
        personal: {
          spouse: { totalIncome: 0, age: 40 },
          dependents: [
            { age: 17, totalIncome: 0 },
            { age: 10, totalIncome: 0 },
          ],
        },
      },
      table,
    )
    expect(result.deductions.spouse).toBe(330000)
    expect(result.deductions.dependents).toBe(330000)
    expect(result.taxableIncome).toBe(3210000)
    expect(result.incomeLevyBeforeCredit).toEqual({ municipal: 256800, prefectural: 65003 })
    expect(result.adjustmentCredit).toEqual({ municipal: 2000, prefectural: 500 })
    expect(result.total).toBe(254800 + 64503 + 5300)
  })

  it('人的控除の差が大きく課税所得が 200 万以下なら、調整控除は差の全額に率を掛ける', () => {
    // 所得 250 万・社保 35 万・配偶者 0・20 歳の子（特定 45 万）→ 所得控除 156 万 → 課税所得 94 万
    // 差 = 5 万 + 5 万 + 18 万 = 28 万 ≤ 94 万 → 28 万 × 4% = 11,200 / 1% = 2,800
    // 市 75,200、県 940,000 × 2.025% = 19,035
    const result = residentTax(
      {
        ...base,
        totalIncome: 2500000,
        socialInsurancePaid: 350000,
        personal: {
          spouse: { totalIncome: 0, age: 40 },
          dependents: [{ age: 20, totalIncome: 0 }],
        },
      },
      table,
    )
    expect(result.deductions.dependents).toBe(450000)
    expect(result.taxableIncome).toBe(940000)
    expect(result.adjustmentCredit).toEqual({ municipal: 11200, prefectural: 2800 })
    expect(result.incomeLevy).toEqual({ municipal: 64000, prefectural: 16235 })
    expect(result.exemptFromIncomeLevy).toBe(false)
    // 保育料用：940,000 × 6% = 56,400 − 28 万 × 3% = 8,400 → 48,000
    expect(result.childcareMunicipalIncomeLevy).toBe(48000)
  })

  it('配偶者特別控除・老人配偶者・本人の所得帯', () => {
    const withSpouse = (payer: number, spouseIncome: number, age = 40) =>
      residentTax(
        {
          ...base,
          totalIncome: payer,
          personal: { spouse: { totalIncome: spouseIncome, age }, dependents: [] },
        },
        table,
      ).deductions.spouse
    // 配偶者 100 万（58 万超 100 万以下）・本人 500 万 → 33 万
    expect(withSpouse(5000000, 1000000)).toBe(330000)
    // 配偶者 120 万（115 万超 120 万以下）・本人 500 万 → 16 万
    expect(withSpouse(5000000, 1200000)).toBe(160000)
    // 老人控除対象配偶者 → 38 万
    expect(withSpouse(5000000, 0, 70)).toBe(380000)
    // 本人 920 万 → 配偶者控除 22 万
    expect(withSpouse(9200000, 0)).toBe(220000)
    // 本人 1,000 万超 → 0
    expect(withSpouse(10500000, 0)).toBe(0)
    // 配偶者 133 万超 → 0
    expect(withSpouse(5000000, 1340000)).toBe(0)
  })

  it('特定親族特別控除：19〜22 歳で所得 58 万超 123 万以下', () => {
    const withRelative = (income: number) =>
      residentTax(
        { ...base, personal: { spouse: null, dependents: [{ age: 20, totalIncome: income }] } },
        table,
      ).deductions
    expect(withRelative(1000000)).toMatchObject({ dependents: 0, specifiedRelative: 410000 })
    expect(withRelative(1300000)).toMatchObject({ dependents: 0, specifiedRelative: 0 })
  })

  it('老人扶養親族 38 万、同居の直系尊属なら 45 万', () => {
    const elderly = residentTax(
      { ...base, personal: { spouse: null, dependents: [{ age: 75, totalIncome: 0 }] } },
      table,
    )
    expect(elderly.deductions.dependents).toBe(380000)
    const cohabiting = residentTax(
      {
        ...base,
        personal: {
          spouse: null,
          dependents: [{ age: 75, totalIncome: 0, cohabitingLinealAscendant: true }],
        },
      },
      table,
    )
    expect(cohabiting.deductions.dependents).toBe(450000)
  })

  it('非課税：扶養なしで所得 45 万以下は均等割・所得割とも掛からない', () => {
    const result = residentTax({ ...base, totalIncome: 450000, socialInsurancePaid: 0 }, table)
    expect(result.exemptFromPerCapitaLevy).toBe(true)
    expect(result.exemptFromIncomeLevy).toBe(true)
    expect(result.total).toBe(0)
    expect(result.childcareMunicipalIncomeLevy).toBe(0)
  })

  it('非課税の限度額は同一生計配偶者と扶養親族（16 歳未満も）の数で上がり、均等割と所得割で加算額が違う', () => {
    // 配偶者 + 子 1 人 = 2 人 → 均等割 35 万 × 3 + 10 万 + 21 万 = 136 万、所得割 35 万 × 3 + 10 万 + 32 万 = 147 万
    const family = { spouse: { totalIncome: 0, age: 40 }, dependents: [{ age: 5, totalIncome: 0 }] }
    const between = residentTax(
      { ...base, totalIncome: 1400000, socialInsurancePaid: 0, personal: family },
      table,
    )
    expect(between.exemptFromPerCapitaLevy).toBe(false)
    expect(between.exemptFromIncomeLevy).toBe(true)
    expect(between.incomeLevy).toEqual({ municipal: 0, prefectural: 0 })
    expect(between.total).toBe(5300)

    const below = residentTax(
      { ...base, totalIncome: 1360000, socialInsurancePaid: 0, personal: family },
      table,
    )
    expect(below.exemptFromPerCapitaLevy).toBe(true)
    expect(below.total).toBe(0)
  })

  it('控除が所得を上回れば課税所得 0。均等割だけ残る', () => {
    const result = residentTax(
      { ...base, totalIncome: 1000000, socialInsurancePaid: 800000 },
      table,
    )
    expect(result.taxableIncome).toBe(0)
    expect(result.incomeLevy).toEqual({ municipal: 0, prefectural: 0 })
    expect(result.total).toBe(5300)
  })

  it('表の対応範囲より前の年度は例外（2026 年度分から）', () => {
    expect(() => residentTax({ ...base, incomeYear: 2024 }, table)).toThrow(RangeError)
    expect(() => residentTax({ ...base, incomeYear: 2025 }, table)).not.toThrow()
  })

  it('入力の契約違反は例外', () => {
    expect(() => residentTax({ ...base, totalIncome: Number.NaN }, table)).toThrow(RangeError)
    expect(() => residentTax({ ...base, socialInsurancePaid: -1 }, table)).toThrow(RangeError)
    expect(() =>
      residentTax(
        { ...base, personal: { spouse: null, dependents: [{ age: 1.5, totalIncome: 0 }] } },
        table,
      ),
    ).toThrow(RangeError)
  })
})

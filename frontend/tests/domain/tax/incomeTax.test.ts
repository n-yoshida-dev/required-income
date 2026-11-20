/**
 * 期待値は `income-tax.json` の表から手で計算した値。実装の出力を写していない。
 */

import { describe, expect, it } from 'vitest'
import {
  applicableSurtaxRate,
  employmentIncomeAmount,
  incomeTax,
  incomeTaxBasicDeduction,
  incomeTaxDependentDeductions,
  incomeTaxSpouseDeduction,
} from '../../../src/domain/tax/incomeTax'
import { incomeTax as table } from '../fixtures'

const noFamily = { spouse: null, dependents: [] }

describe('employmentIncomeAmount（給与所得）', () => {
  it('2026 年分：500 万円 → 控除 500 万 × 20% + 44 万 = 144 万 → 給与所得 356 万円', () => {
    expect(employmentIncomeAmount(5000000, 2026, table)).toBe(3560000)
  })

  it('2026 年分の低所得の特例：74.1 万以上 219.1 万未満は「収入 − 74 万」', () => {
    expect(employmentIncomeAmount(1000000, 2026, table)).toBe(260000)
  })

  it('2026 年分の低所得の特例：69.1 万以上 74.1 万未満は給与所得 0', () => {
    expect(employmentIncomeAmount(700000, 2026, table)).toBe(0)
  })

  it('2026 年分：69.1 万未満は表の最低保障 74 万で控除され、所得は負にならず 0', () => {
    expect(employmentIncomeAmount(690000, 2026, table)).toBe(0)
  })

  it('2026 年分の特例の端：219.3 万以上 219.6 万未満は 145.3 万円', () => {
    expect(employmentIncomeAmount(2195000, 2026, table)).toBe(1453000)
  })

  it('2028 年分以後：式（30% + 8 万）が最低保障 69 万に届かない収入は 69 万で控除する', () => {
    // 200 万 × 30% + 8 万 = 68 万 < 69 万 → 200 万 − 69 万
    expect(employmentIncomeAmount(2000000, 2028, table)).toBe(1310000)
  })

  it('2025 年分：190 万以下は定額 65 万', () => {
    expect(employmentIncomeAmount(1500000, 2025, table)).toBe(850000)
  })

  it('2024 年分以前：162.5 万超 180 万以下は「収入 × 40% − 10 万」', () => {
    // 170 万 × 40% − 10 万 = 58 万 ≥ 最低保障 55 万
    expect(employmentIncomeAmount(1700000, 2024, table)).toBe(1120000)
  })

  it('850 万超は控除 195 万で頭打ち', () => {
    expect(employmentIncomeAmount(10000000, 2026, table)).toBe(8050000)
  })

  it('表が無い年分と負の収入は例外', () => {
    expect(() => employmentIncomeAmount(5000000, 2019, table)).toThrow(RangeError)
    expect(() => employmentIncomeAmount(-1, 2026, table)).toThrow(RangeError)
  })
})

describe('incomeTaxBasicDeduction（基礎控除）', () => {
  it('2026〜2027 年分：合計所得 489 万以下は 104 万、655 万以下は 67 万、2,350 万以下は 62 万', () => {
    expect(incomeTaxBasicDeduction(3560000, 2026, table)).toBe(1040000)
    expect(incomeTaxBasicDeduction(4890000, 2027, table)).toBe(1040000)
    expect(incomeTaxBasicDeduction(5000000, 2026, table)).toBe(670000)
    expect(incomeTaxBasicDeduction(10000000, 2026, table)).toBe(620000)
  })

  it('高所得の逓減：2,400 万超 2,450 万以下は 32 万、2,500 万超は 0', () => {
    expect(incomeTaxBasicDeduction(24300000, 2026, table)).toBe(320000)
    expect(incomeTaxBasicDeduction(26000000, 2026, table)).toBe(0)
  })

  it('年分で段が変わる：2025 年分 88 万、2028 年分以後は 132 万以下だけ 99 万で残りは 62 万', () => {
    expect(incomeTaxBasicDeduction(3000000, 2025, table)).toBe(880000)
    expect(incomeTaxBasicDeduction(1000000, 2028, table)).toBe(990000)
    expect(incomeTaxBasicDeduction(3000000, 2028, table)).toBe(620000)
  })
})

describe('incomeTaxSpouseDeduction（配偶者控除・配偶者特別控除）', () => {
  it('配偶者の所得が要件（2026 年分 62 万）以下なら配偶者控除 38 万。70 歳以上は 48 万', () => {
    expect(incomeTaxSpouseDeduction(5000000, { totalIncome: 500000, age: 40 }, 2026, table)).toBe(
      380000,
    )
    expect(incomeTaxSpouseDeduction(5000000, { totalIncome: 620000, age: 70 }, 2026, table)).toBe(
      480000,
    )
  })

  it('要件を超え 133 万以下なら配偶者特別控除。配偶者 100 万・本人 500 万 → 36 万', () => {
    expect(incomeTaxSpouseDeduction(5000000, { totalIncome: 1000000, age: 40 }, 2026, table)).toBe(
      360000,
    )
  })

  it('本人の所得で額が下がる：本人 920 万 → 配偶者控除 26 万、特別控除（配偶者 100 万）24 万', () => {
    expect(incomeTaxSpouseDeduction(9200000, { totalIncome: 0, age: 40 }, 2026, table)).toBe(260000)
    expect(incomeTaxSpouseDeduction(9200000, { totalIncome: 1000000, age: 40 }, 2026, table)).toBe(
      240000,
    )
  })

  it('本人 1,000 万超、配偶者 133 万超、配偶者なしは 0', () => {
    expect(incomeTaxSpouseDeduction(11000000, { totalIncome: 0, age: 40 }, 2026, table)).toBe(0)
    expect(incomeTaxSpouseDeduction(5000000, { totalIncome: 1340000, age: 40 }, 2026, table)).toBe(
      0,
    )
    expect(incomeTaxSpouseDeduction(5000000, null, 2026, table)).toBe(0)
  })

  it('2024 年分以前は要件が 48 万', () => {
    expect(incomeTaxSpouseDeduction(5000000, { totalIncome: 500000, age: 40 }, 2024, table)).toBe(
      380000,
    )
  })
})

describe('incomeTaxDependentDeductions（扶養控除・特定親族特別控除）', () => {
  it('16 歳未満は 0、16〜18 歳は 38 万、19〜22 歳は 63 万、70 歳以上は 48 万（同居の直系尊属は 58 万）', () => {
    expect(
      incomeTaxDependentDeductions([{ age: 10, totalIncome: 0 }], 2026, table).dependents,
    ).toBe(0)
    expect(
      incomeTaxDependentDeductions([{ age: 17, totalIncome: 0 }], 2026, table).dependents,
    ).toBe(380000)
    expect(
      incomeTaxDependentDeductions([{ age: 20, totalIncome: 0 }], 2026, table).dependents,
    ).toBe(630000)
    expect(
      incomeTaxDependentDeductions([{ age: 75, totalIncome: 0 }], 2026, table).dependents,
    ).toBe(480000)
    expect(
      incomeTaxDependentDeductions(
        [{ age: 75, totalIncome: 0, cohabitingLinealAscendant: true }],
        2026,
        table,
      ).dependents,
    ).toBe(580000)
  })

  it('複数人は合算する', () => {
    const result = incomeTaxDependentDeductions(
      [
        { age: 17, totalIncome: 0 },
        { age: 10, totalIncome: 0 },
        { age: 20, totalIncome: 0 },
      ],
      2026,
      table,
    )
    expect(result.dependents).toBe(380000 + 630000)
  })

  it('所得要件（2026 年分 62 万）を超えると扶養控除は 0。19〜22 歳なら特定親族特別控除に移る', () => {
    expect(incomeTaxDependentDeductions([{ age: 17, totalIncome: 700000 }], 2026, table)).toEqual({
      dependents: 0,
      specifiedRelative: 0,
    })
    // 所得 100 万 → 95 万超 100 万以下の帯 → 41 万
    expect(incomeTaxDependentDeductions([{ age: 20, totalIncome: 1000000 }], 2026, table)).toEqual({
      dependents: 0,
      specifiedRelative: 410000,
    })
    // 123 万超は 0
    expect(incomeTaxDependentDeductions([{ age: 20, totalIncome: 1300000 }], 2026, table)).toEqual({
      dependents: 0,
      specifiedRelative: 0,
    })
  })

  it('特定親族特別控除は 2025 年分から。2024 年分には無い', () => {
    expect(incomeTaxDependentDeductions([{ age: 20, totalIncome: 600000 }], 2024, table)).toEqual({
      dependents: 0,
      specifiedRelative: 0,
    })
    // 2024 年分の要件は 48 万なので、所得 48 万は扶養控除（特定）
    expect(
      incomeTaxDependentDeductions([{ age: 20, totalIncome: 480000 }], 2024, table).dependents,
    ).toBe(630000)
  })

  it('年齢が負なら例外', () => {
    expect(() => incomeTaxDependentDeductions([{ age: -1, totalIncome: 0 }], 2026, table)).toThrow(
      RangeError,
    )
  })
})

describe('incomeTax（所得税の税額）', () => {
  it('基準ケース：2026 年・給与所得 356 万・社保 753,320 円・扶養なし', () => {
    // 所得控除 = 753,320 + 基礎控除 104 万 = 1,793,320 → 課税所得 1,766,680 → 1,766,000（千円未満切捨て）
    // 195 万以下 → 5% = 88,300 円。復興特別所得税 2.1% → 90,154.3 → 90,154 円
    const result = incomeTax(
      { year: 2026, totalIncome: 3560000, socialInsurancePaid: 753320, personal: noFamily },
      table,
    )
    expect(result.deductions.socialInsurance).toBe(753320)
    expect(result.deductions.basic).toBe(1040000)
    expect(result.deductions.total).toBe(1793320)
    expect(result.taxableIncome).toBe(1766000)
    expect(result.baseTax).toBe(88300)
    expect(result.surtaxRate).toBeCloseTo(0.021, 10)
    expect(result.tax).toBe(90154)
  })

  it('上の区分：課税所得 617.9 万 → 20% − 427,500 = 808,300 円 → 付加税込み 825,274 円', () => {
    // 合計所得 800 万 → 基礎控除 62 万。所得控除 1,821,000 → 課税所得 6,179,000
    // 808,300 × 1.021 = 825,274.3 → 825,274（.5 ちょうどになる値は浮動小数点で丸めが揺れるので避けている）
    const result = incomeTax(
      { year: 2026, totalIncome: 8000000, socialInsurancePaid: 1201000, personal: noFamily },
      table,
    )
    expect(result.taxableIncome).toBe(6179000)
    expect(result.baseTax).toBe(808300)
    expect(result.tax).toBe(825274)
  })

  it('人的控除が課税所得を減らす：配偶者（所得 0）と 17 歳の子で 38 万 + 38 万', () => {
    const result = incomeTax(
      {
        year: 2026,
        totalIncome: 3560000,
        socialInsurancePaid: 753320,
        personal: {
          spouse: { totalIncome: 0, age: 40 },
          dependents: [{ age: 17, totalIncome: 0 }],
        },
      },
      table,
    )
    expect(result.deductions.spouse).toBe(380000)
    expect(result.deductions.dependents).toBe(380000)
    // 1,766,680 − 760,000 = 1,006,680 → 1,006,000 × 5% = 50,300 → × 1.021 = 51,356.3
    expect(result.taxableIncome).toBe(1006000)
    expect(result.tax).toBe(51356)
  })

  it('控除が所得を上回れば課税所得 0・税 0', () => {
    const result = incomeTax(
      { year: 2026, totalIncome: 900000, socialInsurancePaid: 100000, personal: noFamily },
      table,
    )
    expect(result.taxableIncome).toBe(0)
    expect(result.tax).toBe(0)
  })

  it('合計所得が負（事業の損失）でも例外にせず税 0', () => {
    const result = incomeTax(
      { year: 2026, totalIncome: -500000, socialInsurancePaid: 0, personal: noFamily },
      table,
    )
    expect(result.taxableIncome).toBe(0)
    expect(result.tax).toBe(0)
  })

  it('付加税は年分で組み替わる：2026 年まで復興 2.1%、2027 年から復興 1.1% + 防衛 1%、2048 年は防衛だけ', () => {
    expect(applicableSurtaxRate(table, 2026)).toBeCloseTo(0.021, 10)
    expect(applicableSurtaxRate(table, 2027)).toBeCloseTo(0.021, 10)
    expect(applicableSurtaxRate(table, 2047)).toBeCloseTo(0.021, 10)
    expect(applicableSurtaxRate(table, 2048)).toBeCloseTo(0.01, 10)
  })

  it('入力の契約違反は例外', () => {
    expect(() =>
      incomeTax(
        { year: 2026, totalIncome: Number.NaN, socialInsurancePaid: 0, personal: noFamily },
        table,
      ),
    ).toThrow(RangeError)
    expect(() =>
      incomeTax(
        { year: 2026, totalIncome: 3000000, socialInsurancePaid: -1, personal: noFamily },
        table,
      ),
    ).toThrow(RangeError)
    expect(() =>
      incomeTax(
        { year: 2019, totalIncome: 3000000, socialInsurancePaid: 0, personal: noFamily },
        table,
      ),
    ).toThrow(RangeError)
  })
})

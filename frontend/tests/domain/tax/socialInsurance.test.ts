/**
 * 期待値は `social-insurance.json` の表から手で計算した値。実装の出力を写していない。
 *
 * 基準ケース（2026 年・35 歳・月給ぶん 420 万円・賞与 80 万円を年 2 回）：
 * - 月給 35 万円 → 健保 第 25 級（35 万円以上 37 万円未満）→ 標準報酬月額 36 万円
 * - 健保 36 万 × 9.92% × 1/2 = 17,856 円/月 → 214,272 円。賞与 80 万 × 4.96% = 39,680 円 → 253,952 円
 * - 支援金 36 万 × 0.23% × 1/2 = 414 円/月 → 4,968 円。賞与 80 万 × 0.115% = 920 円 → 5,888 円
 * - 厚生年金 36 万 × 18.3% × 1/2 = 32,940 円/月 → 395,280 円。賞与 80 万 × 9.15% = 73,200 円 → 468,480 円
 * - 雇用保険 500 万 × 0.5% = 25,000 円
 * - 合計 753,320 円
 */

import { describe, expect, it } from 'vitest'
import {
  employeeSocialInsurance,
  healthInsuranceRate,
  prefectureCodeOf,
} from '../../../src/domain/tax/socialInsurance'
import { socialInsurance as table } from '../fixtures'

const base = {
  year: 2026,
  age: 35,
  pay: { annualGross: 4200000, annualBonus: 800000 },
  bonusPaymentCount: 2,
}

describe('employeeSocialInsurance', () => {
  it('基準ケース：標準報酬月額の等級を引き、月給と賞与に料率を掛けて本人負担ぶんを出す', () => {
    const result = employeeSocialInsurance(base, table)
    expect(result.standardMonthly).toBe(360000)
    expect(result.pensionStandardMonthly).toBe(360000)
    expect(result.healthInsurance).toBe(253952)
    expect(result.longTermCare).toBe(0)
    expect(result.childRearingSupport).toBe(5888)
    expect(result.pension).toBe(468480)
    expect(result.employmentInsurance).toBe(25000)
    expect(result.total).toBe(753320)
  })

  it('40〜64 歳は介護保険料が乗る（36 万 × 1.62% × 1/2 = 2,916 円/月。賞与 80 万 × 0.81% = 6,480 円）', () => {
    expect(employeeSocialInsurance({ ...base, age: 40 }, table).longTermCare).toBe(34992 + 6480)
    expect(employeeSocialInsurance({ ...base, age: 64 }, table).longTermCare).toBe(41472)
    expect(employeeSocialInsurance({ ...base, age: 65 }, table).longTermCare).toBe(0)
    expect(employeeSocialInsurance({ ...base, age: 39 }, table).longTermCare).toBe(0)
  })

  it('高所得では健保と厚生年金で標準報酬月額の上限が違い、賞与の上限も別々に掛かる', () => {
    // 月給 100 万円 → 健保 第 43 級（95.5 万以上 100.5 万未満）→ 98 万円。厚生年金は 63.5 万以上で頭打ち → 65 万円
    // 賞与 400 万を 2 回：健保は年度累計 573 万以下なので 400 万。厚生年金は 1 回 150 万が上限 → 300 万
    const result = employeeSocialInsurance(
      { ...base, pay: { annualGross: 12000000, annualBonus: 4000000 } },
      table,
    )
    expect(result.standardMonthly).toBe(980000)
    expect(result.pensionStandardMonthly).toBe(650000)
    // 98 万 × 4.96% = 48,608 円/月 → 583,296 円。賞与 400 万 × 4.96% = 198,400 円
    expect(result.healthInsurance).toBe(583296 + 198400)
    // 65 万 × 9.15% = 59,475 円/月 → 713,700 円。賞与 300 万 × 9.15% = 274,500 円
    expect(result.pension).toBe(713700 + 274500)
  })

  it('健保の賞与は年度累計 573 万円で頭打ち', () => {
    // 賞与 800 万を 2 回 → 累計 800 万 > 573 万 → 573 万 × 4.96% = 284,208 円
    const result = employeeSocialInsurance(
      { ...base, pay: { annualGross: 12000000, annualBonus: 8000000 } },
      table,
    )
    expect(result.healthInsurance).toBe(583296 + 284208)
  })

  it('厚生年金の上限は 2027 年 9 月から段階的に上がる。その年の 4 月時点の上限を暦年に使う', () => {
    const high = { ...base, pay: { annualGross: 12000000, annualBonus: 0 } }
    expect(employeeSocialInsurance({ ...high, year: 2027 }, table).pensionStandardMonthly).toBe(
      650000,
    )
    expect(employeeSocialInsurance({ ...high, year: 2028 }, table).pensionStandardMonthly).toBe(
      680000,
    )
    expect(employeeSocialInsurance({ ...high, year: 2029 }, table).pensionStandardMonthly).toBe(
      710000,
    )
    expect(employeeSocialInsurance({ ...high, year: 2030 }, table).pensionStandardMonthly).toBe(
      750000,
    )
    expect(employeeSocialInsurance({ ...high, year: 2045 }, table).pensionStandardMonthly).toBe(
      750000,
    )
  })

  it('厚生年金の下限は 8.8 万円（健保の第 1 級 5.8 万円より高い）。等級表の無い年でも同じ', () => {
    const low = { ...base, pay: { annualGross: 720000, annualBonus: 0 } }
    expect(employeeSocialInsurance(low, table).standardMonthly).toBe(58000)
    expect(employeeSocialInsurance(low, table).pensionStandardMonthly).toBe(88000)
    expect(employeeSocialInsurance({ ...low, year: 2028 }, table).pensionStandardMonthly).toBe(
      88000,
    )
  })

  it('等級の境界：報酬月額は from 以上 to 未満', () => {
    // 37 万円ちょうど → 第 26 級（37 万以上 39.5 万未満）→ 38 万円
    const atBoundary = employeeSocialInsurance(
      { ...base, pay: { annualGross: 370000 * 12, annualBonus: 0 } },
      table,
    )
    expect(atBoundary.standardMonthly).toBe(380000)
  })

  it('標準賞与額は 1,000 円未満を切り捨てる', () => {
    // 賞与 500,500 円を 1 回 → 500,000 円 × 4.96% = 24,800 円（月給ぶん 214,272 円と合わせる）
    const result = employeeSocialInsurance(
      { ...base, pay: { annualGross: 4200000, annualBonus: 500500 }, bonusPaymentCount: 1 },
      table,
    )
    expect(result.healthInsurance).toBe(214272 + 24800)
  })

  it('雇用保険は年度の表が無い将来年に最新の年度の率を延ばす', () => {
    expect(employeeSocialInsurance({ ...base, year: 2040 }, table).employmentInsurance).toBe(25000)
  })

  it('年収が 0 なら全項目 0', () => {
    const result = employeeSocialInsurance(
      { ...base, pay: { annualGross: 0, annualBonus: 0 } },
      table,
    )
    expect(result.total).toBe(0)
    expect(result.standardMonthly).toBe(0)
  })

  it('表の年度より前の年は例外', () => {
    expect(() => employeeSocialInsurance({ ...base, year: 2025 }, table)).toThrow(RangeError)
  })

  it('入力の契約違反は例外', () => {
    expect(() =>
      employeeSocialInsurance({ ...base, pay: { annualGross: -1, annualBonus: 0 } }, table),
    ).toThrow(RangeError)
    expect(() => employeeSocialInsurance({ ...base, bonusPaymentCount: 0 }, table)).toThrow(
      RangeError,
    )
    expect(() => employeeSocialInsurance({ ...base, age: -1 }, table)).toThrow(RangeError)
    expect(() => employeeSocialInsurance({ ...base, year: 2026.5 }, table)).toThrow(RangeError)
  })

  it('賞与が 0 なら支給回数は問わない', () => {
    expect(() =>
      employeeSocialInsurance(
        { ...base, pay: { annualGross: 4200000, annualBonus: 0 }, bonusPaymentCount: 0 },
        table,
      ),
    ).not.toThrow()
  })
})

/**
 * 協会けんぽの健康保険料率は都道府県支部ごと（2026-11-20）。期待値は実装とは別に Decimal で計算した。
 * 標準報酬月額 36 万・賞与 80 万（基準ケースと同じ）。
 */
describe('employeeSocialInsurance：健康保険料率を県で引く', () => {
  it('県で料率が変わる（北海道 10.28%・福岡県 10.11%）。介護・支援金は全国一律のまま', () => {
    // 01：36 万 × 5.14% = 18,504 円/月 → 222,048 円。賞与 80 万 × 5.14% = 41,120 円
    const hokkaido = employeeSocialInsurance({ ...base, prefectureCode: '01' }, table)
    expect(hokkaido.healthInsurance).toBe(263168)
    // 40：36 万 × 5.055% = 18,198 円/月 → 218,376 円。賞与 80 万 × 5.055% = 40,440 円
    const fukuoka = employeeSocialInsurance({ ...base, prefectureCode: '40' }, table)
    expect(fukuoka.healthInsurance).toBe(258816)
    expect(fukuoka.childRearingSupport).toBe(5888)
    expect(fukuoka.total).toBe(753320 - 253952 + 258816)
    expect(
      employeeSocialInsurance({ ...base, prefectureCode: '01', age: 40 }, table).longTermCare,
    ).toBe(34992 + 6480)
  })

  it('表に無い県・県を渡さないときは、表の代わりの県（国保の代わりの市の県）の料率で概算する', () => {
    const fallback = table.healthInsurance.appDefault.fallbackPrefectureCode
    const expected = employeeSocialInsurance({ ...base, prefectureCode: fallback }, table)
    expect(employeeSocialInsurance({ ...base, prefectureCode: '99' }, table)).toEqual(expected)
    expect(employeeSocialInsurance(base, table)).toEqual(expected)
    expect(healthInsuranceRate('99', table)).toBe(healthInsuranceRate(fallback, table))
    expect(prefectureCodeOf('27100')).toBe('27')
  })
})

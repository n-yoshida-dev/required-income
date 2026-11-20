import { describe, expect, it } from 'vitest'
import { employmentPayInYear, resolvePromotionStep } from '../../../src/domain/income/promotion'
import type { EmploymentIncome, PromotionScenario } from '../../../src/domain/types'

const BASE_YEAR = 2025

const employment: EmploymentIncome = {
  kind: 'employment',
  personId: 'adult-1',
  annualGross: 5000000,
  annualBonus: 1000000,
  baseRaiseRate: 0.02,
  bonusPaymentCount: 2,
}

const scenario: PromotionScenario = {
  id: 'promoted-twice',
  tracks: [
    {
      personId: 'adult-1',
      steps: [
        { year: 2028, annualGross: 5700000, annualBonus: 1140000 },
        { year: 2034, annualGross: 7400000, annualBonus: 1480000 },
      ],
    },
  ],
}

describe('resolvePromotionStep', () => {
  it('シナリオが無ければ null', () => {
    expect(resolvePromotionStep(null, 'adult-1', 2030)).toBeNull()
  })

  it('tracks に含まれない世帯員は null', () => {
    expect(resolvePromotionStep(scenario, 'adult-2', 2030)).toBeNull()
  })

  it('最初の昇進より前の年は null', () => {
    expect(resolvePromotionStep(scenario, 'adult-1', 2027)).toBeNull()
  })

  it('昇進した年から、その段が適用される', () => {
    expect(resolvePromotionStep(scenario, 'adult-1', 2028)?.annualGross).toBe(5700000)
    expect(resolvePromotionStep(scenario, 'adult-1', 2033)?.annualGross).toBe(5700000)
    expect(resolvePromotionStep(scenario, 'adult-1', 2034)?.annualGross).toBe(7400000)
  })

  it('steps の並び順に結果が左右されない', () => {
    const reversed: PromotionScenario = {
      id: 'reversed',
      tracks: [
        {
          personId: 'adult-1',
          steps: [
            { year: 2034, annualGross: 7400000, annualBonus: 1480000 },
            { year: 2028, annualGross: 5700000, annualBonus: 1140000 },
          ],
        },
      ],
    }
    expect(resolvePromotionStep(reversed, 'adult-1', 2030)?.annualGross).toBe(5700000)
  })

  it('同じ年の昇進が重複していたら例外を投げる', () => {
    const duplicated: PromotionScenario = {
      id: 'duplicated',
      tracks: [
        {
          personId: 'adult-1',
          steps: [
            { year: 2028, annualGross: 5700000, annualBonus: 1140000 },
            { year: 2028, annualGross: 6300000, annualBonus: 1260000 },
          ],
        },
      ],
    }
    expect(() => resolvePromotionStep(duplicated, 'adult-1', 2030)).toThrow(RangeError)
  })
})

describe('employmentPayInYear', () => {
  it('起点の年は入力の額面そのまま', () => {
    expect(employmentPayInYear(employment, scenario, BASE_YEAR, 2025)).toEqual({
      annualGross: 5000000,
      annualBonus: 1000000,
    })
  })

  it('昇進前は基本昇給だけが複利で乗る', () => {
    // 5,000,000 × 1.02^2 = 5,202,000
    expect(employmentPayInYear(employment, scenario, BASE_YEAR, 2027).annualGross).toBe(5202000)
  })

  it('昇進した年は、昇進後の額面がそのまま出る', () => {
    // 昇進年を新しい起点にするので、昇進前の昇給は乗らない
    expect(employmentPayInYear(employment, scenario, BASE_YEAR, 2028)).toEqual({
      annualGross: 5700000,
      annualBonus: 1140000,
    })
  })

  it('昇進の翌年からは、昇進年を起点に昇給が乗る', () => {
    // 5,700,000 × 1.02^2 = 5,930,280
    expect(employmentPayInYear(employment, scenario, BASE_YEAR, 2030).annualGross).toBe(5930280)
  })

  it('2回目の昇進でも起点が置き換わる', () => {
    expect(employmentPayInYear(employment, scenario, BASE_YEAR, 2034).annualGross).toBe(7400000)
    // 7,400,000 × 1.02 = 7,548,000
    expect(employmentPayInYear(employment, scenario, BASE_YEAR, 2035).annualGross).toBe(7548000)
  })

  it('昇進なしなら、起点からずっと基本昇給だけが乗る', () => {
    const noPromotion: PromotionScenario = { id: 'no-promotion', tracks: [] }
    // 5,000,000 × 1.02^9 = 5,975,463.36... → 5,975,463
    expect(employmentPayInYear(employment, noPromotion, BASE_YEAR, 2034).annualGross).toBe(5975463)
  })

  it('賞与にも同じ昇給率が乗る', () => {
    // 1,000,000 × 1.02^2 = 1,040,400
    expect(employmentPayInYear(employment, null, BASE_YEAR, 2027).annualBonus).toBe(1040400)
  })

  it('起点より前の年は例外を投げる', () => {
    expect(() => employmentPayInYear(employment, scenario, BASE_YEAR, 2024)).toThrow(RangeError)
  })

  it('年が整数でなければ例外を投げる', () => {
    expect(() => employmentPayInYear(employment, scenario, BASE_YEAR, 2030.5)).toThrow(RangeError)
  })
})

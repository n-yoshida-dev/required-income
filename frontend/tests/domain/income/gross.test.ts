import { describe, expect, it } from 'vitest'
import {
  businessProfitInYear,
  isWorking,
  lastWorkingYear,
  realEstateProfitInYear,
  scheduledSideBusinessProfitInYear,
  sideBusinessProfitInYear,
} from '../../../src/domain/income/gross'
import type {
  BusinessIncome,
  InvestmentProperty,
  Person,
  RealEstateIncome,
  SideBusinessIncome,
} from '../../../src/domain/types'

const person: Person = {
  id: 'adult-1',
  birthYear: 1985,
  retirementAge: 70,
  lifeExpectancy: 95,
}

/** 2025年で就労を終える人。退職の境界を確かめるために使う */
const retiringPerson: Person = {
  id: 'adult-2',
  birthYear: 1985,
  retirementAge: 40,
  lifeExpectancy: 95,
}

describe('就労期間', () => {
  it('生年 + 退職年齢の年まで働く', () => {
    expect(lastWorkingYear(person)).toBe(2055)
    expect(isWorking(person, 2055)).toBe(true)
    expect(isWorking(person, 2056)).toBe(false)
  })

  it('退職年齢が寿命想定より後でも、寿命想定の年で就労を終える', () => {
    // 1985 年生・退職 70 歳・寿命想定 60 歳 → 2045 年まで。越えて所得を計上すると税・社会保険の対象外の人に給与が残る
    const shortLived: Person = { ...person, retirementAge: 70, lifeExpectancy: 60 }

    expect(lastWorkingYear(shortLived)).toBe(2045)
    expect(isWorking(shortLived, 2045)).toBe(true)
    expect(isWorking(shortLived, 2046)).toBe(false)
  })
})

describe('businessProfitInYear', () => {
  const business: BusinessIncome = {
    kind: 'business',
    personId: 'adult-1',
    startYear: 2027,
    startMonth: 10,
    annualRevenue: 1740000,
    annualExpenses: 320000,
    revenueGrowthRate: 0.1,
    revenueCeiling: 2700000,
    filingType: 'blue65',
  }

  it('開業年より前は 0', () => {
    expect(businessProfitInYear(business, person, 2026)).toBe(0)
  })

  it('開業年は開業月からの月数で按分する', () => {
    // 10月開業なので3か月ぶん。(1,740,000 − 320,000) × 3 / 12
    expect(businessProfitInYear(business, person, 2027)).toBe(355000)
  })

  it('翌年からは満年で、売上に成長率が乗る', () => {
    // 1,740,000 × 1.1 − 320,000
    expect(businessProfitInYear(business, person, 2028)).toBe(1594000)
  })

  it('売上は上限で頭打ちになる', () => {
    // 1.1^4 = 1.4641 → 2,547,534（上限未満）
    expect(businessProfitInYear(business, person, 2031)).toBe(2227534)
    // 1.1^5 = 1.61051 → 2,802,287 だが 2,700,000 で頭打ち
    expect(businessProfitInYear(business, person, 2032)).toBe(2380000)
  })

  it('上限が null なら伸び続ける', () => {
    const unlimited: BusinessIncome = { ...business, revenueCeiling: null }
    expect(businessProfitInYear(unlimited, person, 2032)).toBe(2482287)
  })

  it('退職の翌年から 0 になる', () => {
    expect(businessProfitInYear(business, retiringPerson, 2025)).toBe(0) // 開業前
    const early: BusinessIncome = { ...business, startYear: 2024, startMonth: 1 }
    expect(businessProfitInYear(early, retiringPerson, 2025)).toBeGreaterThan(0)
    expect(businessProfitInYear(early, retiringPerson, 2026)).toBe(0)
  })

  it('成長率が -100% 以下なら例外を投げる', () => {
    const broken: BusinessIncome = { ...business, revenueGrowthRate: -1 }
    expect(() => businessProfitInYear(broken, person, 2027)).toThrow(RangeError)
  })
})

describe('realEstateProfitInYear', () => {
  const income: RealEstateIncome = {
    kind: 'realEstate',
    personId: 'adult-1',
    propertyId: 'prop-1',
    monthlyRent: 76000,
    occupancyRate: 0.9,
    ownershipShare: 0.5,
  }

  const property: InvestmentProperty = {
    id: 'prop-1',
    currentValue: 9600000,
    remainingLoan: 0,
    annualPropertyTax: 77000,
    annualManagementCost: 31000,
    annualRepairCost: 53000,
    disposition: { kind: 'hold' },
  }

  it('家賃収入から運営経費を引いた所得を、持分で按分して返す', () => {
    // 家賃 76,000 × 12 × 0.9 = 820,800
    // 経費 77,000 + 31,000 + 53,000 = 161,000
    // (820,800 − 161,000) × 0.5 = 329,900
    expect(realEstateProfitInYear(income, property, 2025)).toBe(329900)
  })

  it('経費が家賃を上回れば赤字になる', () => {
    const costly: InvestmentProperty = { ...property, annualRepairCost: 1200000 }
    // (820,800 − 1,308,000) × 0.5 = −243,600
    expect(realEstateProfitInYear(income, costly, 2025)).toBe(-243600)
  })

  it('単独名義なら按分しない', () => {
    const sole: RealEstateIncome = { ...income, ownershipShare: 1 }
    expect(realEstateProfitInYear(sole, property, 2025)).toBe(659800)
  })

  it('空室が続けば経費だけが残る', () => {
    const vacant: RealEstateIncome = { ...income, occupancyRate: 0 }
    expect(realEstateProfitInYear(vacant, property, 2025)).toBe(-80500)
  })

  it('売却年までは計上し、その翌年から 0 になる', () => {
    const sold: InvestmentProperty = {
      ...property,
      disposition: {
        kind: 'sell',
        year: 2030,
        expectedPrice: 8000000,
        acquisitionCost: null,
        acquisitionYear: null,
      },
    }
    expect(realEstateProfitInYear(income, sold, 2030)).toBe(329900)
    expect(realEstateProfitInYear(income, sold, 2031)).toBe(0)
  })

  it('対応しない物件を渡したら例外を投げる', () => {
    const other: InvestmentProperty = { ...property, id: 'prop-2' }
    expect(() => realEstateProfitInYear(income, other, 2025)).toThrow(RangeError)
  })

  it('稼働率が負なら例外を投げる', () => {
    const broken: RealEstateIncome = { ...income, occupancyRate: -0.1 }
    expect(() => realEstateProfitInYear(broken, property, 2025)).toThrow(RangeError)
  })
})

describe('sideBusinessProfitInYear', () => {
  const income: SideBusinessIncome = {
    kind: 'sideBusiness',
    personId: 'adult-1',
    annualRevenue: 600000,
    annualExpenses: 100000,
    taxCategory: 'miscellaneous',
    filingType: 'white',
  }

  it('売上から経費を引いた額を返す', () => {
    expect(sideBusinessProfitInYear(income, person, 2025)).toBe(500000)
  })

  it('年が変わっても勝手に伸ばさない（伸ばす額は逆算で求めるため）', () => {
    expect(sideBusinessProfitInYear(income, person, 2040)).toBe(500000)
  })

  it('退職の翌年から 0 になる', () => {
    expect(sideBusinessProfitInYear(income, retiringPerson, 2025)).toBe(500000)
    expect(sideBusinessProfitInYear(income, retiringPerson, 2026)).toBe(0)
  })
})

describe('scheduledSideBusinessProfitInYear', () => {
  const schedule = {
    personId: 'adult-1',
    periods: [
      { fromYear: 2025, toYear: 2027, annualProfit: 300000 },
      { fromYear: 2028, toYear: 2030, annualProfit: 0 },
      { fromYear: 2031, toYear: 2040, annualProfit: 900000 },
    ],
  }

  it('その年を含む期間の額を返す（境界の年は両端とも含む）', () => {
    expect(scheduledSideBusinessProfitInYear(schedule, person, 2025)).toBe(300000)
    expect(scheduledSideBusinessProfitInYear(schedule, person, 2027)).toBe(300000)
    expect(scheduledSideBusinessProfitInYear(schedule, person, 2028)).toBe(0)
    expect(scheduledSideBusinessProfitInYear(schedule, person, 2031)).toBe(900000)
  })

  it('どの期間にも含まれない年は 0', () => {
    expect(scheduledSideBusinessProfitInYear(schedule, person, 2024)).toBe(0)
    expect(scheduledSideBusinessProfitInYear(schedule, person, 2041)).toBe(0)
  })

  it('退職の翌年から 0 になる（入力の副業と同じ扱い）', () => {
    expect(scheduledSideBusinessProfitInYear(schedule, retiringPerson, 2025)).toBe(300000)
    expect(scheduledSideBusinessProfitInYear(schedule, retiringPerson, 2026)).toBe(0)
  })

  it('期間が重なっていれば例外（二重計上になる）', () => {
    const overlapping = {
      personId: 'adult-1',
      periods: [
        { fromYear: 2025, toYear: 2027, annualProfit: 100000 },
        { fromYear: 2027, toYear: 2029, annualProfit: 200000 },
      ],
    }
    expect(() => scheduledSideBusinessProfitInYear(overlapping, person, 2025)).toThrow(RangeError)
  })

  it('開始年が終了年より後なら例外', () => {
    const reversed = {
      personId: 'adult-1',
      periods: [{ fromYear: 2027, toYear: 2025, annualProfit: 100000 }],
    }
    expect(() => scheduledSideBusinessProfitInYear(reversed, person, 2025)).toThrow(RangeError)
  })
})

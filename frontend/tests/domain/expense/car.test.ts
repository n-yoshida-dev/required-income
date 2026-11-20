import { describe, expect, it } from 'vitest'
import {
  carCostInYear,
  carPurchaseLumpSum,
  isPurchaseYear,
  purchaseYearsUpTo,
  requiredAnnualReplacementSaving,
} from '../../../src/domain/expense/car'
import type { Car } from '../../../src/domain/types'

const BASE_YEAR = 2025

const car: Car = {
  firstPurchaseYear: 2027,
  price: 2600000,
  downPayment: 600000,
  loan: { principal: 2000000, annualRate: 0.03, years: 5 },
  replacementCycleYears: 7,
  resaleRate: 0.4,
  annualUpkeep: 380000,
  annualPrePurchaseMobilityCost: 170000,
}

describe('isPurchaseYear', () => {
  it('最初の購入年と、そこから周期ごとの年が該当する', () => {
    expect(isPurchaseYear(car, 2027)).toBe(true)
    expect(isPurchaseYear(car, 2034)).toBe(true)
    expect(isPurchaseYear(car, 2041)).toBe(true)
  })

  it('購入年より前と、周期に当たらない年は該当しない', () => {
    expect(isPurchaseYear(car, 2026)).toBe(false)
    expect(isPurchaseYear(car, 2028)).toBe(false)
    expect(isPurchaseYear(car, 2033)).toBe(false)
  })

  it('買い替え周期が正の整数でなければ例外を投げる', () => {
    expect(() => isPurchaseYear({ ...car, replacementCycleYears: 0 }, 2030)).toThrow(RangeError)
  })

  it('下取り率が 0〜1 の外なら例外を投げる', () => {
    expect(() => isPurchaseYear({ ...car, resaleRate: 1.2 }, 2030)).toThrow(RangeError)
  })
})

describe('purchaseYearsUpTo', () => {
  it('その年までの購入年を古い順に返す', () => {
    expect(purchaseYearsUpTo(car, 2041)).toEqual([2027, 2034, 2041])
  })

  it('最初の購入前は空', () => {
    expect(purchaseYearsUpTo(car, 2026)).toEqual([])
  })

  it('起点年より前の購入も含める（既に保有している車のローンが残るため）', () => {
    const owned: Car = { ...car, firstPurchaseYear: 2023 }
    expect(purchaseYearsUpTo(owned, 2025)).toEqual([2023])
  })
})

describe('carPurchaseLumpSum', () => {
  it('最初の購入は頭金の全額', () => {
    expect(carPurchaseLumpSum(car, 2027)).toBe(600000)
  })

  it('買い替えでは下取り額を頭金から引く', () => {
    // 下取り率 0.1 なら 600,000 − 2,600,000 × 0.1
    const lowResale: Car = { ...car, resaleRate: 0.1 }
    expect(carPurchaseLumpSum(lowResale, 2034)).toBe(340000)
  })

  it('下取り額が頭金を上回っても 0 で止める（現金では戻さない）', () => {
    // 600,000 − 2,600,000 × 0.4 = −440,000 → 0
    expect(carPurchaseLumpSum(car, 2034)).toBe(0)
  })
})

describe('requiredAnnualReplacementSaving', () => {
  it('次の買い替えの持ち出しを周期で割った額を返す', () => {
    // 下取り率 0.1 なら (600,000 − 260,000) ÷ 7年
    const lowResale: Car = { ...car, resaleRate: 0.1 }
    expect(requiredAnnualReplacementSaving(lowResale)).toBe(48571)
  })

  it('下取りだけで足りるなら積み立てる必要はない', () => {
    expect(requiredAnnualReplacementSaving(car)).toBe(0)
  })
})

describe('carCostInYear（購入前）', () => {
  it('起点の年はカーシェア等の移動費だけ', () => {
    const cost = carCostInYear(car, 0.02, BASE_YEAR, 2025)

    expect(cost.upkeep).toBe(170000)
    expect(cost.loanRepayment).toBe(0)
    expect(cost.lumpSum).toBe(0)
    expect(cost.total).toBe(170000)
  })

  it('移動費はインフレで逓増する', () => {
    expect(carCostInYear(car, 0.02, BASE_YEAR, 2026).upkeep).toBe(173400)
  })
})

describe('carCostInYear（購入年以降）', () => {
  it('購入年は移動費が維持費に変わり、頭金とローン返済が乗る', () => {
    const cost = carCostInYear(car, 0.02, BASE_YEAR, 2027)

    // 380,000 × 1.02^2
    expect(cost.upkeep).toBe(395352)
    expect(cost.loanRepayment).toBe(431244)
    expect(cost.lumpSum).toBe(600000)
    expect(cost.total).toBe(395352 + 431244 + 600000)
  })

  it('ローン完済の翌年から返済が消える', () => {
    // 2027年から5年 → 2031年が最終年
    expect(carCostInYear(car, 0.02, BASE_YEAR, 2031).loanRepayment).toBe(431244)
    expect(carCostInYear(car, 0.02, BASE_YEAR, 2032).loanRepayment).toBe(0)
  })

  it('買い替え年に大型支出と新しいローンが立つ', () => {
    const cost = carCostInYear(car, 0.02, BASE_YEAR, 2034)

    // 下取りが頭金を上回るので現金の持ち出しは 0
    expect(cost.lumpSum).toBe(0)
    // 買い替えで組み直したローンの返済が再開する
    expect(cost.loanRepayment).toBe(431244)
  })

  it('買い替えの谷間はローンが無く維持費だけになる', () => {
    const cost = carCostInYear(car, 0.02, BASE_YEAR, 2033)

    expect(cost.loanRepayment).toBe(0)
    expect(cost.lumpSum).toBe(0)
    expect(cost.total).toBe(cost.upkeep)
  })

  it('周期がローンの返済年数より短ければ返済が重なって合算される', () => {
    // 3年ごとに買い替えるのに、ローンは5年で組む
    const frequent: Car = { ...car, replacementCycleYears: 3 }
    const cost = carCostInYear(frequent, 0.02, BASE_YEAR, 2030)

    // 2027年ぶんと 2030年ぶんの2本が並走する
    expect(cost.loanRepayment).toBe(431244 * 2)
  })

  it('ローンを組まない（現金一括）なら返済は 0', () => {
    const cash: Car = { ...car, loan: null }
    expect(carCostInYear(cash, 0.02, BASE_YEAR, 2027).loanRepayment).toBe(0)
  })

  it('維持費はインフレで逓増する', () => {
    expect(carCostInYear(car, 0.02, BASE_YEAR, 2041).upkeep).toBe(521659)
  })
})

describe('carCostInYear（入力の検査）', () => {
  it('起点より前の年は例外を投げる', () => {
    expect(() => carCostInYear(car, 0.02, BASE_YEAR, 2024)).toThrow(RangeError)
  })

  it('インフレ率が -100% 以下なら例外を投げる', () => {
    expect(() => carCostInYear(car, -1, BASE_YEAR, 2030)).toThrow(RangeError)
  })
})

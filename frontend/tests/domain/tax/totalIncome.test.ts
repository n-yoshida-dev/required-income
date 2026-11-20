/**
 * 所得の合算（青色申告特別控除 → 雑所得の赤字切り捨て → 損益通算）。
 *
 * 控除額は `income-tax.json` の `blueReturnDeduction`（65 万・55 万・10 万）。期待値はすべて手計算。
 */

import { describe, expect, it } from 'vitest'
import { totalIncomeOf, type IncomeComponents } from '../../../src/domain/tax/totalIncome'
import { incomeTax } from '../fixtures'

const none: IncomeComponents = {
  employmentIncome: 0,
  businessProfit: 0,
  realEstateProfit: 0,
  miscellaneousProfit: 0,
  filingType: null,
}

describe('totalIncomeOf：青色申告特別控除', () => {
  it('事業所得だけなら、申告方式の額をそのまま引く', () => {
    const blue65 = totalIncomeOf(
      { ...none, businessProfit: 4650000, filingType: 'blue65' },
      incomeTax,
    )
    expect(blue65.blueReturnDeduction).toEqual({ realEstate: 0, business: 650000, total: 650000 })
    expect(blue65.businessIncome).toBe(4000000)
    expect(blue65.totalIncome).toBe(4000000)

    expect(
      totalIncomeOf({ ...none, businessProfit: 4650000, filingType: 'blue55' }, incomeTax)
        .totalIncome,
    ).toBe(4100000)
    expect(
      totalIncomeOf({ ...none, businessProfit: 4650000, filingType: 'blue10' }, incomeTax)
        .totalIncome,
    ).toBe(4550000)
  })

  it('白色申告・事業なし（null）は控除なし', () => {
    expect(
      totalIncomeOf({ ...none, businessProfit: 4650000, filingType: 'white' }, incomeTax)
        .totalIncome,
    ).toBe(4650000)
    expect(totalIncomeOf({ ...none, realEstateProfit: 900000 }, incomeTax).totalIncome).toBe(900000)
  })

  it('不動産所得 → 事業所得の順に引き、合計で上限まで', () => {
    const result = totalIncomeOf(
      { ...none, businessProfit: 3000000, realEstateProfit: 400000, filingType: 'blue65' },
      incomeTax,
    )
    // 不動産 40 万を先に使い切り、残り 25 万を事業から
    expect(result.blueReturnDeduction).toEqual({
      realEstate: 400000,
      business: 250000,
      total: 650000,
    })
    expect(result.realEstateIncome).toBe(0)
    expect(result.businessIncome).toBe(2750000)
    expect(result.totalIncome).toBe(2750000)
  })

  it('控除は黒字の範囲まで。所得が控除額に満たなければ所得までしか引けない', () => {
    const result = totalIncomeOf(
      { ...none, businessProfit: 380000, filingType: 'blue65' },
      incomeTax,
    )
    expect(result.blueReturnDeduction.total).toBe(380000)
    expect(result.totalIncome).toBe(0)
    expect(result.netLoss).toBe(0)
  })

  it('赤字の所得からは引かない（控除で赤字を膨らませない）', () => {
    const result = totalIncomeOf(
      { ...none, businessProfit: -700000, realEstateProfit: 200000, filingType: 'blue65' },
      incomeTax,
    )
    expect(result.blueReturnDeduction).toEqual({ realEstate: 200000, business: 0, total: 200000 })
    expect(result.businessIncome).toBe(-700000)
  })
})

describe('totalIncomeOf：損益通算と雑所得', () => {
  it('事業・不動産の赤字は給与所得から引ける', () => {
    const result = totalIncomeOf(
      { ...none, employmentIncome: 3560000, realEstateProfit: -360000 },
      incomeTax,
    )
    expect(result.totalIncome).toBe(3200000)
    expect(result.netLoss).toBe(0)
  })

  it('雑所得の赤字は 0 として扱い、他の所得を減らさない', () => {
    const result = totalIncomeOf(
      { ...none, employmentIncome: 3560000, miscellaneousProfit: -150000 },
      incomeTax,
    )
    expect(result.miscellaneousIncome).toBe(0)
    expect(result.totalIncome).toBe(3560000)
  })

  it('雑所得の黒字はそのまま足す（特別控除なし）', () => {
    const result = totalIncomeOf(
      { ...none, employmentIncome: 3560000, miscellaneousProfit: 450000, filingType: 'blue65' },
      incomeTax,
    )
    expect(result.blueReturnDeduction.total).toBe(0)
    expect(result.totalIncome).toBe(4010000)
  })

  it('通算しきれない赤字は合計所得を 0 で止め、純損失として返す', () => {
    const result = totalIncomeOf(
      { ...none, employmentIncome: 500000, businessProfit: -1200000, filingType: 'blue65' },
      incomeTax,
    )
    expect(result.totalIncome).toBe(0)
    expect(result.netLoss).toBe(700000)
  })
})

describe('totalIncomeOf：入力の検証', () => {
  it('有限でない金額・負の給与所得は例外', () => {
    expect(() => totalIncomeOf({ ...none, businessProfit: Number.NaN }, incomeTax)).toThrow(
      RangeError,
    )
    expect(() =>
      totalIncomeOf({ ...none, realEstateProfit: Number.POSITIVE_INFINITY }, incomeTax),
    ).toThrow(RangeError)
    expect(() => totalIncomeOf({ ...none, employmentIncome: -1 }, incomeTax)).toThrow(RangeError)
  })

  it('「所得が限度」でない表は未対応として例外', () => {
    const table = {
      ...incomeTax,
      blueReturnDeduction: { ...incomeTax.blueReturnDeduction, limitedToIncome: false },
    }
    expect(() =>
      totalIncomeOf({ ...none, businessProfit: 1000000, filingType: 'blue65' }, table),
    ).toThrow(RangeError)
  })
})

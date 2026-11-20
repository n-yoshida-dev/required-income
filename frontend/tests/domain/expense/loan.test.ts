import { describe, expect, it } from 'vitest'
import {
  annualLoanRepayment,
  monthlyLoanPayment,
  remainingLoanBalance,
  totalLoanRepayment,
} from '../../../src/domain/expense/loan'
import type { LoanTerms } from '../../../src/domain/types'

/** 4,000万円・年1.2%・35年 */
const mortgage: LoanTerms = {
  principal: 40000000,
  annualRate: 0.012,
  years: 35,
}

/** 金利 0 のローン。式の分母が 0 になる分岐を通す */
const interestFree: LoanTerms = {
  principal: 12000000,
  annualRate: 0,
  years: 10,
}

describe('monthlyLoanPayment', () => {
  it('元利均等の月額を返す', () => {
    expect(monthlyLoanPayment(mortgage)).toBe(116681)
  })

  it('金利 0 なら借入額を回数で割るだけ', () => {
    expect(monthlyLoanPayment(interestFree)).toBe(100000)
  })

  it('借入額 0 なら返済も 0', () => {
    expect(monthlyLoanPayment({ ...mortgage, principal: 0 })).toBe(0)
  })

  it('金利が上がれば月額も上がる', () => {
    const higher = monthlyLoanPayment({ ...mortgage, annualRate: 0.02 })
    expect(higher).toBeGreaterThan(monthlyLoanPayment(mortgage))
  })

  it('返済年数が正の整数でなければ例外を投げる', () => {
    expect(() => monthlyLoanPayment({ ...mortgage, years: 0 })).toThrow(RangeError)
    expect(() => monthlyLoanPayment({ ...mortgage, years: 35.5 })).toThrow(RangeError)
  })

  it('借入額や金利が負なら例外を投げる', () => {
    expect(() => monthlyLoanPayment({ ...mortgage, principal: -1 })).toThrow(RangeError)
    expect(() => monthlyLoanPayment({ ...mortgage, annualRate: -0.01 })).toThrow(RangeError)
  })
})

describe('annualLoanRepayment', () => {
  const startYear = 2030

  it('返済期間の中は月額の12か月ぶん', () => {
    expect(annualLoanRepayment(mortgage, startYear, 2030)).toBe(1400172)
    expect(annualLoanRepayment(mortgage, startYear, 2050)).toBe(1400172)
  })

  it('借入より前の年は 0', () => {
    expect(annualLoanRepayment(mortgage, startYear, 2029)).toBe(0)
  })

  it('最終年まで返済し、その翌年から 0 になる', () => {
    // 2030年から35年 → 2064年が最終年
    expect(annualLoanRepayment(mortgage, startYear, 2064)).toBe(1400172)
    expect(annualLoanRepayment(mortgage, startYear, 2065)).toBe(0)
  })

  it('インフレでは増えない（名目で固定される）', () => {
    // 呼び出し側がインフレ率を掛けないことを、引数を持たないことで担保する
    expect(annualLoanRepayment(mortgage, startYear, 2031)).toBe(
      annualLoanRepayment(mortgage, startYear, 2060),
    )
  })
})

describe('remainingLoanBalance', () => {
  const startYear = 2030

  it('借入前は借入額のまま', () => {
    expect(remainingLoanBalance(mortgage, startYear, 2029)).toBe(40000000)
  })

  it('返済が進むほど減る', () => {
    // 借入年の年末＝12回返済済み
    expect(remainingLoanBalance(mortgage, startYear, 2030)).toBe(39074750)
    // 10年後＝120回返済済み
    expect(remainingLoanBalance(mortgage, startYear, 2039)).toBe(30228598)
  })

  it('完済年に 0 になる', () => {
    expect(remainingLoanBalance(mortgage, startYear, 2064)).toBe(0)
  })

  it('完済後は 0 のままで、負にならない', () => {
    expect(remainingLoanBalance(mortgage, startYear, 2080)).toBe(0)
  })

  it('金利 0 でも残高が求まる', () => {
    // 借入年の年末で12回済み。2035年末は6年目＝72回返済済み
    expect(remainingLoanBalance(interestFree, startYear, 2035)).toBe(4800000)
    expect(remainingLoanBalance(interestFree, startYear, 2039)).toBe(0)
  })
})

describe('totalLoanRepayment', () => {
  it('元金と利息の合計を返す', () => {
    // 116,681 × 420回
    expect(totalLoanRepayment(mortgage)).toBe(49006020)
  })

  it('金利 0 なら借入額と一致する', () => {
    expect(totalLoanRepayment(interestFree)).toBe(12000000)
  })

  it('利息のぶんだけ借入額を上回る', () => {
    expect(totalLoanRepayment(mortgage)).toBeGreaterThan(mortgage.principal)
  })
})

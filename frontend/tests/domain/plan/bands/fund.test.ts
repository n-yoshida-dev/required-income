/**
 * 大学資金・老後資金の積立の式（`bands/fund.ts`）のテスト。
 * 月の利率・到達額・家計から足す月額（切り上げ）を、閉じた式で書いた手計算と突き合わせる。金額は架空。
 */

import { describe, expect, it } from 'vitest'
import {
  fundReached,
  monthlyRateOf,
  solveHouseholdMonthly,
  type FundTerms,
} from '../../../../src/domain/plan/bands/fund'

/** 毎月末に 1 を n か月積んだ到達額（年金終価係数）。利率 0 なら n */
const annuity = (i: number, n: number) => (i === 0 ? n : (Math.pow(1 + i, n) - 1) / i)

const terms = (overrides: Partial<FundTerms> = {}): FundTerms => ({
  months: 150,
  monthlyRate: monthlyRateOf(0.035),
  saved: 0,
  allowanceMonthly: [],
  ...overrides,
})

describe('monthlyRateOf', () => {
  it('0 なら 0。年 4% は 12 回複利で 1.04 に戻る', () => {
    expect(monthlyRateOf(0)).toBe(0)
    const i = monthlyRateOf(0.04)
    expect(Math.pow(1 + i, 12)).toBeCloseTo(1.04, 12)
    // 単利の 4% ÷ 12 より小さい
    expect(i).toBeLessThan(0.04 / 12)
  })

  it('−100% 以下・数でないのは契約違反', () => {
    expect(() => monthlyRateOf(-1)).toThrow(RangeError)
    expect(() => monthlyRateOf(Number.NaN)).toThrow(RangeError)
    expect(() => monthlyRateOf(Number.POSITIVE_INFINITY)).toThrow(RangeError)
    // −100% より大きいマイナスは受け付ける
    expect(monthlyRateOf(-0.02)).toBeLessThan(0)
  })
})

describe('fundReached（到達額の内訳）', () => {
  it('貯まっている額は (1 + i)^n、家計の月額は年金終価係数で育つ。合計は内訳の和', () => {
    const t = terms({ saved: 830000 })
    const reached = fundReached(t, 21700)
    expect(reached.saved).toBe(Math.round(830000 * Math.pow(1 + t.monthlyRate, t.months)))
    expect(reached.household).toBe(Math.round(21700 * annuity(t.monthlyRate, t.months)))
    expect(reached.allowance).toBe(0)
    expect(reached.total).toBe(reached.saved + reached.allowance + reached.household)
  })

  it('児童手当は m 月目の末に積む：n − 1 − m か月育つ。足りない月は 0', () => {
    const i = monthlyRateOf(0.035)
    // 3 か月の積立に、0 月目 15,000 と 1 月目 10,000 だけ（2 月目は無い）
    const reached = fundReached(terms({ months: 3, allowanceMonthly: [15000, 10000] }), 0)
    expect(reached.allowance).toBe(Math.round(15000 * (1 + i) ** 2 + 10000 * (1 + i)))
    expect(reached.household).toBe(0)
  })

  it('家計の月額が負・整数でない、前提が契約に反するなら投げる', () => {
    expect(() => fundReached(terms(), -1)).toThrow(RangeError)
    expect(() => fundReached(terms(), 0.5)).toThrow(RangeError)
    expect(() => fundReached(terms({ months: 0 }), 0)).toThrow(RangeError)
  })
})

describe('solveHouseholdMonthly（家計から足す月額）', () => {
  it('解いた月額で積めば目標額に届き、1 円少なければ届かない（切り上げ）', () => {
    const t = terms({ saved: 410000, allowanceMonthly: Array.from({ length: 60 }, () => 10000) })
    const target = 6230000
    const monthly = solveHouseholdMonthly(t, target)
    expect(monthly).toBeGreaterThan(0)
    expect(fundReached(t, monthly).total).toBeGreaterThanOrEqual(target)
    // 丸める前の到達額で比べる（内訳を円に丸めると ±1 円ぶれるため）
    const rawReached = (m: number) =>
      410000 * (1 + t.monthlyRate) ** t.months +
      t.allowanceMonthly.reduce(
        (sum, amount, k) => sum + amount * (1 + t.monthlyRate) ** (t.months - 1 - k),
        0,
      ) +
      m * annuity(t.monthlyRate, t.months)
    expect(rawReached(monthly)).toBeGreaterThanOrEqual(target)
    expect(rawReached(monthly - 1)).toBeLessThan(target)
  })

  it('貯まっている額だけで目標額を超えていれば 0。ちょうど届くときも 0', () => {
    expect(solveHouseholdMonthly(terms({ saved: 5000000 }), 4000000)).toBe(0)
    // 利率 0 なら貯まっている額はそのまま → ちょうど目標額
    expect(solveHouseholdMonthly(terms({ monthlyRate: 0, saved: 4000000 }), 4000000)).toBe(0)
    expect(solveHouseholdMonthly(terms(), 0)).toBe(0)
  })

  it('利率 0（預金）なら単純な割り算：⌈(目標額 − 貯まっている額 − 児童手当の合計) ÷ 月数⌉', () => {
    const t = terms({
      months: 120,
      monthlyRate: 0,
      saved: 370000,
      allowanceMonthly: Array.from({ length: 120 }, () => 10000),
    })
    // (4,180,000 − 370,000 − 1,200,000) ÷ 120 = 21,750
    expect(solveHouseholdMonthly(t, 4180000)).toBe(21750)
    // 割り切れなければ切り上げ：(4,180,001 − 1,570,000) ÷ 120 = 21,750.008… → 21,751
    expect(solveHouseholdMonthly(t, 4180001)).toBe(21751)
    expect(fundReached(t, 21750)).toEqual({
      saved: 370000,
      allowance: 1200000,
      household: 2610000,
      total: 4180000,
    })
  })

  it('目標額が負・整数でない、月数が 0、児童手当の並びが月数より長い・負の額は契約違反', () => {
    expect(() => solveHouseholdMonthly(terms(), -1)).toThrow(RangeError)
    expect(() => solveHouseholdMonthly(terms(), 1.5)).toThrow(RangeError)
    expect(() => solveHouseholdMonthly(terms({ months: 0 }), 1000)).toThrow(RangeError)
    expect(() => solveHouseholdMonthly(terms({ months: 2.5 }), 1000)).toThrow(RangeError)
    expect(() => solveHouseholdMonthly(terms({ monthlyRate: -1 }), 1000)).toThrow(RangeError)
    expect(() => solveHouseholdMonthly(terms({ saved: -1 }), 1000)).toThrow(RangeError)
    expect(() =>
      solveHouseholdMonthly(terms({ months: 2, allowanceMonthly: [1, 1, 1] }), 1000),
    ).toThrow(RangeError)
    expect(() => solveHouseholdMonthly(terms({ allowanceMonthly: [-1] }), 1000)).toThrow(RangeError)
  })
})

import { describe, expect, it } from 'vitest'
import {
  annualToMonthly,
  applyRatio,
  compound,
  monthlyToAnnual,
  roundYen,
  sumYen,
} from '../../src/domain/money'

describe('roundYen', () => {
  it('整数はそのまま返す', () => {
    expect(roundYen(0)).toBe(0)
    expect(roundYen(250000)).toBe(250000)
  })

  it('0.5 は絶対値の大きい側へ寄せる', () => {
    expect(roundYen(0.5)).toBe(1)
    expect(roundYen(1.5)).toBe(2)
  })

  it('負の 0.5 も絶対値の大きい側へ寄せる（Math.round との違い）', () => {
    // Math.round(-0.5) は -0、Math.round(-1.5) は -1 になる。
    // 収支には負の値が出るため、正負で丸め方が変わらないことを固定する。
    expect(roundYen(-0.5)).toBe(-1)
    expect(roundYen(-1.5)).toBe(-2)
  })

  it('0.5 未満は切り捨てる', () => {
    expect(roundYen(0.49)).toBe(0)
    expect(roundYen(-0.49)).toBe(-0)
  })

  it('有限でない値は例外にする', () => {
    expect(() => roundYen(Number.NaN)).toThrow(RangeError)
    expect(() => roundYen(Number.POSITIVE_INFINITY)).toThrow(RangeError)
  })
})

describe('sumYen', () => {
  it('空配列は 0', () => {
    expect(sumYen([])).toBe(0)
  })

  it('合計してから 1 回だけ丸める', () => {
    // 0.4 を 3 つ。項目ごとに丸めると 0 だが、合計してから丸めると 1
    expect(sumYen([0.4, 0.4, 0.4])).toBe(1)
  })

  it('正負が混ざっても合計できる', () => {
    expect(sumYen([400000, -600000])).toBe(-200000)
  })

  it('有限でない値が混ざったら例外にする', () => {
    expect(() => sumYen([1, Number.NaN])).toThrow(RangeError)
  })
})

describe('compound', () => {
  it('0 年なら元の金額', () => {
    expect(compound(1000000, 0.02, 0)).toBe(1000000)
  })

  it('年率 0% なら何年経っても変わらない', () => {
    expect(compound(1000000, 0, 30)).toBe(1000000)
  })

  it('年 2% を 1 年', () => {
    expect(compound(1000000, 0.02, 1)).toBe(1020000)
  })

  it('年 3% を 10 年（複利）', () => {
    // 1,000,000 * 1.03^10 = 1,343,916.379...
    expect(compound(1000000, 0.03, 10)).toBe(1343916)
  })

  it('マイナス金利でも計算できる', () => {
    expect(compound(1000000, -0.01, 2)).toBe(980100)
  })

  it('経過年数が負や小数なら例外にする', () => {
    expect(() => compound(1000, 0.02, -1)).toThrow(RangeError)
    expect(() => compound(1000, 0.02, 1.5)).toThrow(RangeError)
  })

  it('年率が -100% 以下なら例外にする', () => {
    expect(() => compound(1000, -1, 1)).toThrow(RangeError)
  })
})

describe('applyRatio', () => {
  it('稼働率 95% を家賃収入に適用する', () => {
    expect(applyRatio(90000, 0.95)).toBe(85500)
  })

  it('0 を掛けたら 0', () => {
    expect(applyRatio(90000, 0)).toBe(0)
  })

  it('負の割合は例外にする', () => {
    expect(() => applyRatio(1000, -0.1)).toThrow(RangeError)
  })
})

describe('monthlyToAnnual / annualToMonthly', () => {
  it('月額から年額', () => {
    expect(monthlyToAnnual(90000)).toBe(1080000)
  })

  it('年額から月額', () => {
    expect(annualToMonthly(1080000)).toBe(90000)
  })

  it('12 で割り切れない年額は四捨五入する', () => {
    // 1,000,000 / 12 = 83,333.33...
    expect(annualToMonthly(1000000)).toBe(83333)
  })

  it('往復すると誤差が出ることを明示しておく', () => {
    // 丸めが入るため往復は一致しない。呼び出し側はどちらかを正とすること。
    expect(monthlyToAnnual(annualToMonthly(1000000))).toBe(999996)
  })
})

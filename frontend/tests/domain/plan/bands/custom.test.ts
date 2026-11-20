import { describe, expect, it } from 'vitest'
import { customBands } from '../../../../src/domain/plan/bands/custom'
import type { BandContext, CustomGoal } from '../../../../src/domain/plan/types'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'
import { tables } from '../planFixtures'

/** 自由入力の帯は前提と既定値を使わない（物価も掛けない。SPEC §3.4） */
const ctx: BandContext = {
  base: yearMonth(2026, 11),
  until: yearMonth(2046, 1),
  children: [],
  tables,
  assumptions: { inflationRate: 0, mortgageRate: 0, investmentReturnRate: 0 },
  settings: { homeClosingCostRate: 0, carResaleRate: 0, carLoanRate: 0 },
  allowanceEarmarked: new Set(),
}

const monthly = (overrides: Partial<CustomGoal> = {}): CustomGoal =>
  ({
    id: 'goal-m',
    enabled: true,
    kind: 'custom',
    name: '趣味の教室',
    amountType: 'monthly',
    direction: 'expense',
    amount: 10000,
    from: yearMonth(2027, 4),
    to: yearMonth(2028, 4),
    ...overrides,
  }) as CustomGoal

const once = (overrides: Partial<CustomGoal> = {}): CustomGoal =>
  ({
    id: 'goal-o',
    enabled: true,
    kind: 'custom',
    name: '家族旅行',
    amountType: 'once',
    direction: 'expense',
    amount: 1000000,
    at: yearMonth(2027, 6),
    saved: 0,
    ...overrides,
  }) as CustomGoal

describe('customBands：毎月', () => {
  it('支出は payment の帯をそのまま 1 本', () => {
    expect(customBands(monthly(), ctx)).toEqual([
      {
        goalId: 'goal-m',
        label: '趣味の教室',
        kind: 'payment',
        monthly: 10000,
        from: { year: 2027, month: 4 },
        to: { year: 2028, month: 4 },
      },
    ])
  })

  it('収入は income の帯', () => {
    const [band] = customBands(monthly({ direction: 'income' }), ctx)
    expect(band?.kind).toBe('income')
  })

  it('0 円でも帯を出す（月額 0）', () => {
    expect(customBands(monthly({ amount: 0 }), ctx)[0]?.monthly).toBe(0)
  })

  it('起点より前に始まる帯も、そのままの期間で出す（数えるのは need.ts の役目）', () => {
    const [band] = customBands(monthly({ from: yearMonth(2025, 1) }), ctx)
    expect(band?.from).toEqual({ year: 2025, month: 1 })
  })

  it('from が to より後は契約違反', () => {
    expect(() =>
      customBands(monthly({ from: yearMonth(2028, 5), to: yearMonth(2028, 4) }), ctx),
    ).toThrow(RangeError)
  })

  it('金額が負・小数なら投げる', () => {
    expect(() => customBands(monthly({ amount: -1 }), ctx)).toThrow(RangeError)
    expect(() => customBands(monthly({ amount: 100.5 }), ctx)).toThrow(RangeError)
  })
})

describe('customBands：一度きり', () => {
  it('今から使う月の前までの積立。1 円未満は切り上げる（100 万円 ÷ 7 か月 = 142,857.14… → 142,858）', () => {
    expect(customBands(once(), ctx)).toEqual([
      {
        goalId: 'goal-o',
        label: '家族旅行の積立',
        kind: 'saving',
        monthly: 142858,
        from: { year: 2026, month: 11 },
        to: { year: 2027, month: 6 },
      },
    ])
  })

  it('貯まっている額を引いてから割る（70 万円 ÷ 7 か月 = 10 万円）', () => {
    expect(customBands(once({ saved: 300000 }), ctx)[0]?.monthly).toBe(100000)
  })

  it('貯まっている額が使う額以上なら月額 0 の帯', () => {
    expect(customBands(once({ saved: 1000000 }), ctx)[0]?.monthly).toBe(0)
    expect(customBands(once({ saved: 1200000 }), ctx)[0]?.monthly).toBe(0)
  })

  it('使う月が起点の翌月なら 1 か月で全額', () => {
    expect(customBands(once({ at: yearMonth(2026, 12) }), ctx)[0]?.monthly).toBe(1000000)
  })

  it('使う月が起点の月か過ぎていれば帯を出さない', () => {
    expect(customBands(once({ at: yearMonth(2026, 11) }), ctx)).toEqual([])
    expect(customBands(once({ at: yearMonth(2026, 1) }), ctx)).toEqual([])
  })

  it('一度きりの収入は契約違反', () => {
    expect(() => customBands(once({ direction: 'income' }), ctx)).toThrow(/支出だけ/)
  })

  it('貯まっている額が負なら投げる', () => {
    expect(() => customBands(once({ saved: -1 }), ctx)).toThrow(RangeError)
  })
})

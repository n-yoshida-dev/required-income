import { describe, expect, it } from 'vitest'
import { appDefaults } from '../../../src/data/appData'
import { expandPlan } from '../../../src/domain/plan/bands/index'
import { lastNeedYear, yearlyNeeds } from '../../../src/domain/plan/need'
import type { Adult, Band, LifePlan } from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { tables } from './planFixtures'

const ym = yearMonth

const band = (overrides: Partial<Band>): Band => ({
  goalId: 'living',
  label: '生活費',
  kind: 'payment',
  monthly: 0,
  from: ym(2026, 1),
  to: ym(2030, 1),
  ...overrides,
})

const adult = (overrides: Partial<Adult> = {}): Adult => ({
  id: 'adult-1',
  birthYear: 1980,
  workStyle: 'employee',
  annualIncome: 5000000,
  raiseRate: 0,
  outlookSteps: [],
  sideMonthlyProfit: 0,
  retirementAge: 65,
  ...overrides,
})

describe('lastNeedYear', () => {
  it('働く大人のうち、最初に退職する人の退職の年の前年', () => {
    const adults = [adult(), adult({ id: 'adult-2', birthYear: 1982 })]
    // 1980 + 65 = 2045 年に先に退職 → 2044 年まで（1982 年生まれの 2047 年ではない）
    expect(lastNeedYear({ adults })).toBe(2044)
    // 並びによらない
    expect(lastNeedYear({ adults: [...adults].reverse() })).toBe(2044)
  })

  it('退職の年齢が違う 2 人：生まれが遅くても、早く退職する人で切る', () => {
    const adults = [
      adult({ retirementAge: 70 }),
      adult({ id: 'adult-2', birthYear: 1984, retirementAge: 60 }),
    ]
    // 1980 + 70 = 2050、1984 + 60 = 2044 → 2043 年まで
    expect(lastNeedYear({ adults })).toBe(2043)
  })

  it('働いていない大人は数えない（先に退職の年齢になっても切らない）', () => {
    const adults = [adult(), adult({ id: 'adult-2', birthYear: 1975, workStyle: 'notWorking' })]
    expect(lastNeedYear({ adults })).toBe(2044)
  })

  it('働く大人がいなければ、大人全員のうち最初に退職の年齢になる人の前年', () => {
    const adults = [
      adult({ workStyle: 'notWorking' }),
      adult({ id: 'adult-2', birthYear: 1990, workStyle: 'notWorking' }),
    ]
    expect(lastNeedYear({ adults })).toBe(2044)
  })

  it('大人が 0 人・3 人、退職の年齢が負・小数なら契約違反', () => {
    expect(() => lastNeedYear({ adults: [] })).toThrow(RangeError)
    expect(() => lastNeedYear({ adults: [adult(), adult(), adult()] })).toThrow(RangeError)
    expect(() => lastNeedYear({ adults: [adult({ retirementAge: -1 })] })).toThrow(RangeError)
    expect(() => lastNeedYear({ adults: [adult({ retirementAge: 64.5 })] })).toThrow(RangeError)
  })
})

describe('yearlyNeeds', () => {
  it('起点の年は残りの月を 12 か月ぶんに直す（11 月起点：2 か月 × 6）', () => {
    const years = yearlyNeeds([band({ monthly: 300000 })], ym(2026, 11), 2028)
    expect(years).toEqual([
      { year: 2026, requiredNet: 3600000, byGoal: [{ goalId: 'living', annual: 3600000 }] },
      { year: 2027, requiredNet: 3600000, byGoal: [{ goalId: 'living', annual: 3600000 }] },
      { year: 2028, requiredNet: 3600000, byGoal: [{ goalId: 'living', annual: 3600000 }] },
    ])
  })

  it('起点が 12 月なら 1 か月を 12 倍、1 月なら 12 か月そのまま', () => {
    const bands = [band({ monthly: 250000 })]
    expect(yearlyNeeds(bands, ym(2026, 12), 2026)[0]?.requiredNet).toBe(3000000)
    expect(yearlyNeeds(bands, ym(2026, 1), 2026)[0]?.requiredNet).toBe(3000000)
  })

  it('起点の年の 12 か月換算は目標ごとに 1 回だけ四捨五入する（収入も絶対値で丸める）', () => {
    // 8 月起点（残り 5 か月）で 12 月だけの帯：10,001 × 12 ÷ 5 = 24,002.4 → 24,002
    const bands = [
      band({ goalId: 'goal-a', label: 'A', monthly: 10001, from: ym(2026, 12), to: ym(2027, 1) }),
      band({
        goalId: 'goal-b',
        label: 'B',
        kind: 'income',
        monthly: 10001,
        from: ym(2026, 12),
        to: ym(2027, 1),
      }),
      // 12,501 × 12 ÷ 5 = 30,002.4 → 30,002（.5 ちょうどにならない例をもう 1 つ）
      band({ goalId: 'goal-c', label: 'C', monthly: 12501, from: ym(2026, 12), to: ym(2027, 1) }),
    ]
    const [first] = yearlyNeeds(bands, ym(2026, 8), 2026)
    expect(first?.byGoal).toEqual([
      { goalId: 'goal-a', annual: 24002 },
      { goalId: 'goal-b', annual: -24002 },
      { goalId: 'goal-c', annual: 30002 },
    ])
    expect(first?.requiredNet).toBe(30002)
  })

  it('同じ月に帯が重なれば足す。同じ目標の帯は 1 つの内訳にまとめ、収入は引く', () => {
    const bands = [
      band({ monthly: 250000, from: ym(2027, 1), to: ym(2028, 1) }),
      band({ goalId: 'goal-a', label: '月謝', monthly: 20000, from: ym(2027, 4), to: ym(2027, 7) }),
      band({
        goalId: 'goal-a',
        label: '教材の積立',
        kind: 'saving',
        monthly: 5000,
        from: ym(2027, 4),
        to: ym(2027, 5),
      }),
      band({
        goalId: 'goal-b',
        label: '収入',
        kind: 'income',
        monthly: 30000,
        from: ym(2027, 12),
        to: ym(2028, 2),
      }),
    ]
    const years = yearlyNeeds(bands, ym(2027, 1), 2028)
    expect(years[0]).toEqual({
      year: 2027,
      // 3,000,000 + (60,000 + 5,000) − 30,000
      requiredNet: 3035000,
      byGoal: [
        { goalId: 'living', annual: 3000000 },
        { goalId: 'goal-a', annual: 65000 },
        { goalId: 'goal-b', annual: -30000 },
      ],
    })
    // 2028 年は生活費が 2028-01 の前で終わり、収入の 1 か月だけが残る
    expect(years[1]).toEqual({
      year: 2028,
      requiredNet: -30000,
      byGoal: [{ goalId: 'goal-b', annual: -30000 }],
    })
  })

  it('earmarked の帯は数えない', () => {
    const bands = [
      band({ monthly: 100000 }),
      band({ goalId: 'goal-u', label: '児童手当を回す', kind: 'earmarked', monthly: 10000 }),
    ]
    expect(yearlyNeeds(bands, ym(2027, 1), 2027)[0]?.byGoal).toEqual([
      { goalId: 'living', annual: 1200000 },
    ])
  })

  it('0 円の帯は内訳に 0 で載り、合計は変わらない', () => {
    const bands = [band({ monthly: 100000 }), band({ goalId: 'goal-z', label: 'Z', monthly: 0 })]
    expect(yearlyNeeds(bands, ym(2027, 1), 2027)[0]).toEqual({
      year: 2027,
      requiredNet: 1200000,
      byGoal: [
        { goalId: 'living', annual: 1200000 },
        { goalId: 'goal-z', annual: 0 },
      ],
    })
  })

  it('翌年 1 月の前で終わる帯は翌年に載らない。12 月だけ・1 月だけの帯はその年に 1 か月', () => {
    const bands = [
      band({
        goalId: 'goal-dec',
        label: '12 月',
        monthly: 10000,
        from: ym(2027, 12),
        to: ym(2028, 1),
      }),
      band({
        goalId: 'goal-jan',
        label: '1 月',
        monthly: 20000,
        from: ym(2028, 1),
        to: ym(2028, 2),
      }),
    ]
    const years = yearlyNeeds(bands, ym(2027, 1), 2028)
    expect(years[0]?.byGoal).toEqual([{ goalId: 'goal-dec', annual: 10000 }])
    expect(years[1]?.byGoal).toEqual([{ goalId: 'goal-jan', annual: 20000 }])
  })

  it('起点の月より前の月は数えない', () => {
    // 2026-01〜2026-11 の帯は、11 月起点では 0 か月（11 月の前まで）
    const bands = [band({ monthly: 50000, from: ym(2026, 1), to: ym(2026, 11) })]
    expect(yearlyNeeds(bands, ym(2026, 11), 2026)).toEqual([
      { year: 2026, requiredNet: 0, byGoal: [] },
    ])
  })

  it('最後の年が起点の年より前なら空', () => {
    expect(yearlyNeeds([band({ monthly: 1 })], ym(2026, 11), 2025)).toEqual([])
  })

  it('壊れた帯・小数の最後の年は契約違反', () => {
    expect(() =>
      yearlyNeeds([band({ from: ym(2028, 1), to: ym(2027, 1) })], ym(2026, 11), 2028),
    ).toThrow(RangeError)
    expect(() => yearlyNeeds([], ym(2026, 11), 2028.5)).toThrow(RangeError)
  })
})

describe('暮らしと自由入力だけの計画（T2 の完了条件）', () => {
  // 架空の世帯：1 人、1980 年生まれ・50 歳で退職 → 2026〜2029 年を数える
  const plan: LifePlan = {
    baseYearMonth: ym(2026, 11),
    adults: [adult({ retirementAge: 50 })],
    children: [],
    municipality: '99001',
    living: { monthlyLivingCost: 250000, monthlyRent: 80000 },
    goals: [
      {
        id: 'goal-hobby',
        enabled: true,
        kind: 'custom',
        name: '趣味の教室',
        amountType: 'monthly',
        direction: 'expense',
        amount: 10000,
        from: ym(2027, 4),
        to: ym(2028, 4),
      },
      {
        id: 'goal-sales',
        enabled: true,
        kind: 'custom',
        name: '不用品の販売',
        amountType: 'monthly',
        direction: 'income',
        amount: 5000,
        from: ym(2026, 1),
        to: ym(2030, 1),
      },
      {
        id: 'goal-trip',
        enabled: true,
        kind: 'custom',
        name: '家族旅行',
        amountType: 'once',
        direction: 'expense',
        amount: 600000,
        // 2026-11 から 18 か月：600,000 ÷ 18 = 33,333.3… → 切り上げて 33,334
        at: ym(2028, 5),
        saved: 0,
      },
      {
        id: 'goal-off',
        enabled: false,
        kind: 'custom',
        name: '見直しで外したカード',
        amountType: 'monthly',
        direction: 'expense',
        amount: 90000,
        from: ym(2026, 1),
        to: ym(2030, 1),
      },
    ],
    assumptions: { investmentReturnRate: 0.03, inflationRate: 0, mortgageRate: 0.01 },
  }

  it('年ごとの要る手取りと目標ごとの内訳', () => {
    const years = yearlyNeeds(expandPlan(plan, appDefaults, tables), plan.baseYearMonth, 2029)
    expect(years).toEqual([
      {
        // 起点の年：2 か月 × 6。暮らし 330,000 × 12、収入 −5,000 × 12、旅行 33,334 × 12
        year: 2026,
        requiredNet: 4300008,
        byGoal: [
          { goalId: 'living', annual: 3960000 },
          { goalId: 'goal-sales', annual: -60000 },
          { goalId: 'goal-trip', annual: 400008 },
        ],
      },
      {
        // 趣味は 4〜12 月の 9 か月
        year: 2027,
        requiredNet: 4390008,
        byGoal: [
          { goalId: 'living', annual: 3960000 },
          { goalId: 'goal-hobby', annual: 90000 },
          { goalId: 'goal-sales', annual: -60000 },
          { goalId: 'goal-trip', annual: 400008 },
        ],
      },
      {
        // 趣味は 1〜3 月、旅行の積立は 1〜4 月（5 月に使う）
        year: 2028,
        requiredNet: 4063336,
        byGoal: [
          { goalId: 'living', annual: 3960000 },
          { goalId: 'goal-hobby', annual: 30000 },
          { goalId: 'goal-sales', annual: -60000 },
          { goalId: 'goal-trip', annual: 133336 },
        ],
      },
      {
        year: 2029,
        requiredNet: 3900000,
        byGoal: [
          { goalId: 'living', annual: 3960000 },
          { goalId: 'goal-sales', annual: -60000 },
        ],
      },
    ])
  })

  it('物価を 2% にすると、生活費だけが年ごとに上がる（家賃・自由入力は変わらない）', () => {
    const inflated = { ...plan, assumptions: { ...plan.assumptions, inflationRate: 0.02 } }
    const years = yearlyNeeds(expandPlan(inflated, appDefaults, tables), plan.baseYearMonth, 2029)
    const living = years.map((y) => y.byGoal.find((g) => g.goalId === 'living')?.annual)
    // 生活費 250,000 → 255,000 → 260,100 → 265,302、家賃 80,000 はそのまま
    expect(living).toEqual([3960000, 4020000, 4081200, 4143624])
    expect(years[1]?.byGoal.find((g) => g.goalId === 'goal-hobby')?.annual).toBe(90000)
  })
})

import { describe, expect, it } from 'vitest'
import {
  carAlreadyOwned,
  carBands,
  carReplacementCost,
} from '../../../../src/domain/plan/bands/car'
import { bandContext, type BandDefaults } from '../../../../src/domain/plan/bands/index'
import { yearlyNeeds } from '../../../../src/domain/plan/need'
import type { Band, BandContext, CarGoal, LifePlan } from '../../../../src/domain/plan/types'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'
import { compound } from '../../../../src/domain/money'
import { monthlyLoanPayment } from '../../../../src/domain/expense/loan'
import { defaults, makePlan, tables } from '../planFixtures'

// 架空の計画：起点 2031-01、1979 年生まれ・65 歳で退職 → 階段は 2043 年まで（until は 2044-01）。
// 起点が 1 月なので、起点の年も 12 か月そのまま数える（12 か月換算の倍率が掛からない）
const LAST_YEAR = 2043
const BASE = yearMonth(2031, 1)

/**
 * 手計算しやすい既定値：下取り 25%・車のローンの金利 0%。
 * 価格 336 万円なら、次の車の代金は 336 万 − 84 万 = 252 万円、7 年（84 か月）で割ると月 30,000 円ちょうど
 */
const handDefaults: BandDefaults = {
  ...defaults,
  car: {
    resaleRate: { value: 0.25, basis: 'テスト' },
    loanRate: { value: 0, basis: 'テスト' },
  },
}

/** 車のカード（金額はダミー）。2033 年に 336 万円を現金で、維持費 月 2 万円、7 年ごとに買い替え */
const car = (overrides: Partial<CarGoal> = {}): CarGoal => ({
  id: 'goal-car',
  enabled: true,
  kind: 'car',
  purchaseYear: 2033,
  price: 3360000,
  payment: { type: 'cash' },
  monthlyUpkeep: 20000,
  replaceEveryYears: 7,
  saved: 0,
  ...overrides,
})

const planWith = (goal: CarGoal, overrides: Partial<LifePlan> = {}): LifePlan =>
  makePlan({ goals: [goal], ...overrides })

const ctxOf = (
  goal: CarGoal,
  overrides: Partial<LifePlan> = {},
  bandDefaults: BandDefaults = handDefaults,
): BandContext => bandContext(planWith(goal, overrides), bandDefaults, tables)

const bandsOf = (goal: CarGoal, overrides: Partial<LifePlan> = {}): Band[] =>
  carBands(goal, ctxOf(goal, overrides))

const byLabel = (bands: readonly Band[], label: string): Band[] =>
  bands.filter((band) => band.label === label)

/** 車の帯だけで数えた、年ごとの要る手取り（年 → 円） */
const annualOf = (bands: readonly Band[], base = BASE): Map<number, number> =>
  new Map(yearlyNeeds(bands, base, LAST_YEAR).map((y) => [y.year, y.requiredNet]))

/** 年ごとの要る手取りの合計（起点の年から最後の年まで） */
const totalOf = (bands: readonly Band[], base = BASE): number =>
  [...annualOf(bands, base).values()].reduce((sum, value) => sum + value, 0)

describe('完了条件（T8）：車の代金を二重に数えない', () => {
  it('現金：13 年間の合計が「最初の車の代金 − 貯まっている額」＋ 維持費 ＋ 次の車の積立と、手計算どおりに合う', () => {
    const bands = bandsOf(car({ saved: 480000 }))
    // 最初の車：（336 万 − 48 万）÷ 24 か月（2031-01 → 2033-01）= 120,000
    expect(byLabel(bands, '車の積立')).toEqual([
      {
        goalId: 'goal-car',
        label: '車の積立',
        kind: 'saving',
        monthly: 120000,
        from: yearMonth(2031, 1),
        to: yearMonth(2033, 1),
      },
    ])
    // 返済の帯は無い（現金で買う車の代金は積立にだけ入る）
    expect(byLabel(bands, '車のローンの返済')).toEqual([])

    // 2031〜2043 年（13 年）の合計：
    //   最初の車  120,000 × 24 か月 = 2,880,000（= 336 万 − 48 万。1 回だけ）
    //   維持費     20,000 × 132 か月（2033-01 → 2044-01）= 2,640,000
    //   次の車     30,000 × 132 か月 = 3,960,000
    expect(totalOf(bands)).toBe(2880000 + 2640000 + 3960000)
  })

  it('ローン：最初の車の代金は返済にだけ入り（積立は無い）、返済の合計が価格と合う（金利 0%）', () => {
    const bands = bandsOf(car({ payment: { type: 'loan', years: 5 }, saved: 480000 }))
    expect(byLabel(bands, '車の積立')).toEqual([])
    // 336 万 ÷ 60 回 = 56,000。2033-01 から 5 年
    expect(byLabel(bands, '車のローンの返済')).toEqual([
      {
        goalId: 'goal-car',
        label: '車のローンの返済',
        kind: 'payment',
        monthly: 56000,
        from: yearMonth(2033, 1),
        to: yearMonth(2038, 1),
      },
    ])
    const repayment = byLabel(bands, '車のローンの返済')[0]
    expect((repayment?.monthly ?? 0) * 60).toBe(3360000)
    // ローンでは貯まっている額を使わない（返済は 48 万を引かない）。合計 = 価格 ＋ 維持費 ＋ 次の車の積立
    expect(totalOf(bands)).toBe(3360000 + 2640000 + 3960000)
  })

  it('ローンの返済中に次の車の積立が重なる。ローンが終わっても次の車の積立と維持費は続く', () => {
    const years = annualOf(bandsOf(car({ payment: { type: 'loan', years: 5 } })))
    // 2033〜2037 年：返済 56,000 ＋ 次の車 30,000 ＋ 維持費 20,000 = 106,000 × 12
    for (const year of [2033, 2034, 2035, 2036, 2037]) expect(years.get(year)).toBe(1272000)
    // 2038 年から：次の車 30,000 ＋ 維持費 20,000 = 50,000 × 12
    for (const year of [2038, 2039, 2040, 2041, 2043]) expect(years.get(year)).toBe(600000)
    // 買う前は 0（ローンなので積立は無い）
    expect(years.get(2031)).toBe(0)
    expect(years.get(2032)).toBe(0)
  })

  it('買い替えの年（2040 年）に代金をもう一度足さない。前後の年と同じ額で、それまでの積立が次の車の代金にちょうど届く', () => {
    const goal = car()
    const bands = bandsOf(goal)
    const years = annualOf(bands)
    expect(years.get(2040)).toBe(years.get(2039))
    expect(years.get(2040)).toBe(years.get(2041))
    // 維持費 20,000 ＋ 次の車 30,000 だけ（現金の最初の車の積立は 2033 年 1 月で終わっている）
    expect(years.get(2040)).toBe(600000)
    // 2033-01 → 2040-01 の 84 か月で積み立てる額 = 次の車の代金（336 万 − 下取り 84 万）
    const [nextCar] = byLabel(bands, '次の車の積立')
    expect((nextCar?.monthly ?? 0) * 84).toBe(carReplacementCost(goal, 0.25))
    expect(carReplacementCost(goal, 0.25)).toBe(2520000)
    // 帯は 1 本で、買い替えのたびに同じ額の積立が「ずっと」の終わりまで続く
    expect(byLabel(bands, '次の車の積立')).toEqual([
      {
        goalId: 'goal-car',
        label: '次の車の積立',
        kind: 'saving',
        monthly: 30000,
        from: yearMonth(2033, 1),
        to: yearMonth(2044, 1),
      },
    ])
  })

  it('ローンの年数が買い替えの周期より長くても、ローンは最初の車の 1 本だけ（買い替えでローンを組み直さない）', () => {
    const bands = bandsOf(car({ payment: { type: 'loan', years: 8 } }))
    expect(byLabel(bands, '車のローンの返済')).toEqual([
      expect.objectContaining({ monthly: 35000, from: yearMonth(2033, 1), to: yearMonth(2041, 1) }),
    ])
    // 2040 年（買い替え）も 2041 年（返済が終わる）も、代金の山は無い
    const years = annualOf(bands)
    expect(years.get(2040)).toBe((35000 + 30000 + 20000) * 12)
    expect(years.get(2041)).toBe((30000 + 20000) * 12)
  })

  it('次の車の積立の月額は 1 円未満を切り上げる。周期 1 回ぶんの合計は代金以上で、代金 ＋ 月数 未満', () => {
    // 300 万 − 75 万 = 225 万 ÷ 84 = 26,785.7… → 26,786
    const goal = car({ price: 3000000 })
    const [nextCar] = byLabel(carBands(goal, ctxOf(goal)), '次の車の積立')
    expect(nextCar?.monthly).toBe(26786)
    const perCycle = (nextCar?.monthly ?? 0) * 84
    expect(perCycle).toBeGreaterThanOrEqual(2250000)
    expect(perCycle).toBeLessThan(2250000 + 84)
  })
})

describe('carBands：細部', () => {
  it('アプリの既定値の下取りの率・車のローンの金利を使う（住宅ローンの金利は使わない）', () => {
    const goal = car({ payment: { type: 'loan', years: 5 } })
    const bands = carBands(
      goal,
      ctxOf(
        goal,
        { assumptions: { investmentReturnRate: 0.03, inflationRate: 0, mortgageRate: 0.05 } },
        defaults,
      ),
    )
    expect(byLabel(bands, '車のローンの返済')[0]?.monthly).toBe(
      monthlyLoanPayment({ principal: 3360000, years: 5, annualRate: defaults.car.loanRate.value }),
    )
    expect(byLabel(bands, '次の車の積立')[0]?.monthly).toBe(
      Math.ceil(carReplacementCost(goal, defaults.car.resaleRate.value) / 84),
    )
  })

  it('買い替えない（null）なら次の車の積立は出さない', () => {
    const bands = bandsOf(car({ replaceEveryYears: null }))
    expect(bands.map((b) => b.label)).toEqual(['車の積立', '車の維持費'])
  })

  it('貯まっている額が価格以上なら、車の積立は 0 円の帯', () => {
    expect(byLabel(bandsOf(car({ saved: 4000000 })), '車の積立')[0]?.monthly).toBe(0)
  })

  it('価格 0 のローンなら返済の帯は出さない', () => {
    const bands = bandsOf(car({ price: 0, payment: { type: 'loan', years: 5 } }))
    expect(byLabel(bands, '車のローンの返済')).toEqual([])
  })

  it('維持費にだけ物価を掛ける。ローンの返済と次の車の積立には掛けない', () => {
    const bands = bandsOf(car({ payment: { type: 'loan', years: 5 } }), {
      assumptions: { investmentReturnRate: 0.03, inflationRate: 0.02, mortgageRate: 0 },
    })
    const upkeep = byLabel(bands, '車の維持費')
    expect(upkeep).toHaveLength(11)
    expect(upkeep[0]).toMatchObject({ from: yearMonth(2033, 1), monthly: compound(20000, 0.02, 2) })
    expect(upkeep[1]).toMatchObject({ from: yearMonth(2034, 1), monthly: compound(20000, 0.02, 3) })
    expect(byLabel(bands, '車のローンの返済')).toHaveLength(1)
    expect(byLabel(bands, '次の車の積立')).toEqual([expect.objectContaining({ monthly: 30000 })])
  })

  it('買う年が「ずっと」の終わり以降なら、積立だけを出す（維持費と次の車は階段の外）', () => {
    const bands = bandsOf(car({ purchaseYear: 2045 }))
    expect(bands.map((b) => b.label)).toEqual(['車の積立'])
  })
})

describe('もう持っている車（買う月が起点の月以前）', () => {
  it('ローン：積立は出さず、返済は買う月から数えた残りだけが入る。維持費と次の車の積立は起点から', () => {
    const goal = car({ purchaseYear: 2029, payment: { type: 'loan', years: 5 }, saved: 480000 })
    const bands = bandsOf(goal)
    expect(carAlreadyOwned(goal, BASE)).toBe(true)
    expect(byLabel(bands, '車の積立')).toEqual([])
    expect(byLabel(bands, '車のローンの返済')).toEqual([
      expect.objectContaining({ monthly: 56000, from: yearMonth(2029, 1), to: yearMonth(2034, 1) }),
    ])
    expect(byLabel(bands, '車の維持費')[0]?.from).toEqual(BASE)
    expect(byLabel(bands, '次の車の積立')[0]?.from).toEqual(BASE)
    const years = annualOf(bands)
    // 返済は 2031〜2033 年の 36 か月だけ（2029〜2030 年の 24 か月は払い終えている）
    expect(years.get(2033)).toBe((56000 + 30000 + 20000) * 12)
    expect(years.get(2034)).toBe((30000 + 20000) * 12)
    expect(totalOf(bands)).toBe(56000 * 36 + 20000 * 156 + 30000 * 156)
  })

  it('現金：代金は払い終えているので積立は出さない（貯まっている額は使わない）', () => {
    const bands = bandsOf(car({ purchaseYear: 2027, saved: 480000 }))
    expect(bands.map((b) => b.label)).toEqual(['車の維持費', '次の車の積立'])
  })

  it('起点が 1 月で、その年に買う車も、もう持っている扱い（積立の月が無い）', () => {
    const goal = car({ purchaseYear: 2031 })
    expect(carAlreadyOwned(goal, BASE)).toBe(true)
    expect(byLabel(bandsOf(goal), '車の積立')).toEqual([])
  })
})

describe('carBands：契約違反は投げる', () => {
  it.each<[string, Partial<CarGoal>]>([
    ['価格が負', { price: -1 }],
    ['維持費が整数でない', { monthlyUpkeep: 1.5 }],
    ['貯まっている額が負', { saved: -1 }],
    ['買う年が整数でない', { purchaseYear: 2033.5 }],
    ['ローンの年数が 0', { payment: { type: 'loan', years: 0 } }],
    ['買い替えの周期が 0', { replaceEveryYears: 0 }],
    ['買い替えの周期が整数でない', { replaceEveryYears: 1.5 }],
  ])('%s', (_label, overrides) => {
    expect(() => bandsOf(car(overrides))).toThrow(RangeError)
  })

  it('下取りの率が 0〜1 の外、車のローンの金利が負なら投げる', () => {
    const goal = car()
    const base = ctxOf(goal)
    expect(() =>
      carBands(goal, { ...base, settings: { ...base.settings, carResaleRate: 1.2 } }),
    ).toThrow(/下取り/)
    expect(() =>
      carBands(goal, { ...base, settings: { ...base.settings, carLoanRate: -0.01 } }),
    ).toThrow(/金利/)
  })
})

import { describe, expect, it } from 'vitest'
import {
  bandAnnualsInYear,
  groupSteps,
  isNewStep,
  stepCauses,
} from '../../../src/domain/plan/steps'
import type { Band, StepThresholds, YearNeed } from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'

const ym = yearMonth
const th: StepThresholds = { changeRatio: 0.03, changeYen: 120000, maxCauses: 3 }

/** 合計だけの年ごとの要る手取り（内訳は段のまとめに使わない） */
const yearsOf = (from: number, values: number[]): YearNeed[] =>
  values.map((requiredNet, i) => ({ year: from + i, requiredNet, byGoal: [] }))

describe('isNewStep（3% かつ年 12 万円を超えたら新しい段）', () => {
  it('ちょうどは同じ段、1 円超えたら新しい段（割合と金額が同じ 400 万円の基準）', () => {
    // 400 万 × 3% = 12 万。両方のしきい値がちょうど 12 万になる
    expect(isNewStep(4000000, 4120000, th)).toBe(false)
    expect(isNewStep(4000000, 4120001, th)).toBe(true)
    expect(isNewStep(4000000, 3880000, th)).toBe(false)
    expect(isNewStep(4000000, 3879999, th)).toBe(true)
  })

  it('金額だけ超えても割合が超えなければ同じ段（1,000 万円の基準で 20 万円）', () => {
    expect(isNewStep(10000000, 10200000, th)).toBe(false)
    expect(isNewStep(10000000, 10300000, th)).toBe(false)
    expect(isNewStep(10000000, 10300001, th)).toBe(true)
  })

  it('割合だけ超えても金額が超えなければ同じ段（100 万円の基準で 10 万円）', () => {
    expect(isNewStep(1000000, 1100000, th)).toBe(false)
    expect(isNewStep(1000000, 1120001, th)).toBe(true)
  })

  it('基準が負・0 でも絶対値で比べる', () => {
    expect(isNewStep(-1000000, -1100000, th)).toBe(false)
    expect(isNewStep(0, 120000, th)).toBe(false)
    expect(isNewStep(0, 120001, th)).toBe(true)
  })
})

describe('groupSteps', () => {
  it('段の値は段の中の最大の年、同じなら早い年', () => {
    const groups = groupSteps(
      yearsOf(2031, [5000000, 5100000, 5050000, 5100000, 6000000, 6000000]),
      th,
    )
    expect(groups).toEqual([
      { fromYear: 2031, toYear: 2034, peakYear: 2032, requiredNet: 5100000 },
      { fromYear: 2035, toYear: 2036, peakYear: 2035, requiredNet: 6000000 },
    ])
  })

  it('基準は段の最初の年。少しずつ増えても、最初の年から離れたら新しい段', () => {
    // 1 年ずつは 7 万円（しきい値未満）でも、2 年で 14 万円・3.5% になる
    const groups = groupSteps(yearsOf(2031, [4000000, 4070000, 4140000, 4210000]), th)
    expect(groups.map((g) => [g.fromYear, g.toYear])).toEqual([
      [2031, 2032],
      [2033, 2034],
    ])
  })

  it('下がるときも段を分ける', () => {
    const groups = groupSteps(yearsOf(2031, [6000000, 6000000, 4000000]), th)
    expect(groups.map((g) => g.requiredNet)).toEqual([6000000, 4000000])
  })

  it('年が空なら空、年が続いていなければ契約違反', () => {
    expect(groupSteps([], th)).toEqual([])
    const gap = [...yearsOf(2031, [1]), ...yearsOf(2033, [1])]
    expect(() => groupSteps(gap, th)).toThrow(RangeError)
  })

  it('しきい値が負・理由の数が小数なら契約違反', () => {
    const years = yearsOf(2031, [1])
    expect(() => groupSteps(years, { ...th, changeRatio: -0.01 })).toThrow(RangeError)
    expect(() => groupSteps(years, { ...th, changeYen: -1 })).toThrow(RangeError)
    expect(() => groupSteps(years, { ...th, maxCauses: 1.5 })).toThrow(RangeError)
  })
})

const band = (overrides: Partial<Band>): Band => ({
  goalId: 'living',
  label: '生活費',
  kind: 'payment',
  monthly: 0,
  from: ym(2031, 1),
  to: ym(2040, 1),
  ...overrides,
})

describe('bandAnnualsInYear', () => {
  it('帯ごとの年額。収入は負、児童手当を回す分は数えない、同じ目標・同じ名前は足す', () => {
    const bands = [
      band({ monthly: 200000 }),
      band({ monthly: 10000, from: ym(2032, 7) }),
      band({ goalId: 'g-side', label: '家賃収入', kind: 'income', monthly: 30000 }),
      band({ goalId: 'g-uni', label: '児童手当', kind: 'earmarked', monthly: 10000 }),
    ]
    expect(bandAnnualsInYear(bands, ym(2031, 1), 2032)).toEqual([
      // 20 万 × 12 ＋ 1 万 × 6
      { goalId: 'living', label: '生活費', annual: 2460000 },
      { goalId: 'g-side', label: '家賃収入', annual: -360000 },
    ])
  })

  it('起点の年は 12 か月ぶんに直す（10 月起点：3 か月 × 4）', () => {
    const bands = [band({ monthly: 1001 })]
    expect(bandAnnualsInYear(bands, ym(2031, 10), 2031)).toEqual([
      { goalId: 'living', label: '生活費', annual: 12012 },
    ])
  })
})

describe('stepCauses', () => {
  const previous = [
    { goalId: 'living', label: '生活費', annual: 2400000 },
    { goalId: 'g-car', label: '車', annual: 600000 },
    { goalId: 'g-pet', label: 'ペット', annual: 60000 },
  ]

  it('始まった帯は正、終わった帯は負。変わらない帯は出さない。大きい順', () => {
    const current = [
      { goalId: 'living', label: '生活費', annual: 2400000 },
      { goalId: 'g-home', label: '住まい', annual: 1800000 },
      { goalId: 'g-pet', label: 'ペット', annual: 60000 },
    ]
    expect(stepCauses(previous, current, 3)).toEqual([
      { goalId: 'g-home', label: '住まい', monthlyDelta: 150000, change: 'start', monthly: 150000 },
      { goalId: 'g-car', label: '車', monthlyDelta: -50000, change: 'end', monthly: 50000 },
    ])
  })

  it('増えた・減った帯も差で出す。上限で切る', () => {
    const current = [
      { goalId: 'living', label: '生活費', annual: 2520000 },
      { goalId: 'g-home', label: '住まい', annual: 1200000 },
    ]
    expect(stepCauses(previous, current, 2)).toEqual([
      { goalId: 'g-home', label: '住まい', monthlyDelta: 100000, change: 'start', monthly: 100000 },
      { goalId: 'g-car', label: '車', monthlyDelta: -50000, change: 'end', monthly: 50000 },
    ])
    expect(stepCauses(previous, current, 3)[2]).toEqual({
      goalId: 'living',
      label: '生活費',
      monthlyDelta: 10000,
      change: 'more',
      monthly: 10000,
    })
    expect(stepCauses(previous, current, 0)).toEqual([])
  })

  it('どちらの年にもあり、次の年に無く減った帯は、年の途中で終わる。月額は終わる前の額（W18）', () => {
    // 3 月で終わる学校：前の段の年は 12 か月、この段の年は 3 か月ぶん
    const before = [{ goalId: 'g-child', label: '学校', annual: 360000 }]
    const now = [{ goalId: 'g-child', label: '学校', annual: 90000 }]
    expect(stepCauses(before, now, 3, [])).toEqual([
      { goalId: 'g-child', label: '学校', monthlyDelta: -22500, change: 'end', monthly: 30000 },
    ])
    // 次の年にも続くなら減る（差の大きさ）
    expect(stepCauses(before, now, 3, now)[0]).toMatchObject({ change: 'less', monthly: 22500 })
    // 次の年を渡さなければ減る
    expect(stepCauses(before, now, 3)[0]).toMatchObject({ change: 'less' })
    // 増えた帯は次の年に無くても増える（終わるのは減った帯だけ）
    expect(stepCauses(now, before, 3, [])[0]).toMatchObject({ change: 'more', monthly: 22500 })
  })

  it('収入の帯（負の年額）は額の大きさで見る：終わると正の差で「終わる」、増えると負の差で「増える」', () => {
    const allowance = (annual: number) => [{ goalId: 'g-child', label: '児童手当', annual }]
    expect(stepCauses(allowance(-120000), [], 3)).toEqual([
      { goalId: 'g-child', label: '児童手当', monthlyDelta: 10000, change: 'end', monthly: 10000 },
    ])
    expect(stepCauses(allowance(-120000), allowance(-240000), 3, allowance(-240000))).toEqual([
      {
        goalId: 'g-child',
        label: '児童手当',
        monthlyDelta: -10000,
        change: 'more',
        monthly: 10000,
      },
    ])
    expect(stepCauses([], allowance(-120000), 3)[0]).toMatchObject({
      change: 'start',
      monthly: 10000,
    })
  })

  it('理由をすべて出すと、月額の差の合計 × 12 が段の値の差になる', () => {
    const current = [
      { goalId: 'living', label: '生活費', annual: 2520000 },
      { goalId: 'g-home', label: '住まい', annual: 1200000 },
    ]
    const causes = stepCauses(previous, current, 10)
    const sum = (list: { annual: number }[]) => list.reduce((t, e) => t + e.annual, 0)
    expect(causes.reduce((t, c) => t + c.monthlyDelta * 12, 0)).toBe(sum(current) - sum(previous))
  })
})

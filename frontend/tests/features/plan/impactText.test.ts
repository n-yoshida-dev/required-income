import { describe, expect, it } from 'vitest'
import type { Goal, GoalImpact, LifePlan, PeakGross } from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import {
  impactForCard,
  impactText,
  peakText,
  type ComputedImpacts,
} from '../../../src/features/plan/impactText'

const solved = (gross: number): PeakGross => ({ kind: 'solved', gross })
const UNSOLVABLE: PeakGross = { kind: 'unsolvable' }

/** 重さ 1 つ（outcome は current と toggled から作る。domain と同じ向き） */
const impact = (
  action: GoalImpact['action'],
  current: PeakGross,
  toggled: PeakGross,
  goalId = 'g',
): GoalImpact => ({
  goalId,
  action,
  current,
  toggled,
  outcome:
    current.kind === 'solved' && toggled.kind === 'solved'
      ? {
          kind: 'change',
          change: toggled.gross - current.gross,
          direction:
            toggled.gross < current.gross ? 'down' : toggled.gross > current.gross ? 'up' : 'same',
        }
      : { kind: 'unavailable' },
})

/** カードの 2 行目の文字（画面と同じ並び：「外すと 61万円下がる」） */
const line = (value: GoalImpact): string | null => {
  const text = impactText(value)
  return text === null ? null : `${text.lead} ${text.amount ?? ''}${text.tail}`
}

describe('impactText：オンのカード（外すと）', () => {
  it('下がる・上がる・変わらないを言葉で言う', () => {
    expect(line(impact('remove', solved(9980000), solved(9370000)))).toBe('外すと 61万円下がる')
    expect(line(impact('remove', solved(9980000), solved(10110000)))).toBe('外すと 13万円上がる')
    expect(line(impact('remove', solved(9980000), solved(9980000)))).toBe('外しても 変わらない')
  })

  it('差は「ながめる」に出る四捨五入した万円どうしの引き算（円の差の四捨五入ではない）', () => {
    // 998.4 → 998、997.6 → 998。円の差は 0.8 万円だが、画面の数字どうしは同じなので「変わらない」
    expect(line(impact('remove', solved(9984000), solved(9976000)))).toBe('外しても 変わらない')
    // 998.6 → 999、998.4 → 998。円の差は 0.2 万円でも、画面の数字どうしは 1 万円違う
    expect(line(impact('remove', solved(9986000), solved(9984000)))).toBe('外すと 1万円下がる')
  })

  it('4 桁の差もカンマ付きの万円', () => {
    expect(line(impact('remove', solved(30000000), solved(18000000)))).toBe(
      '外すと 1,200万円下がる',
    )
  })
})

describe('impactText：オフのカード（入れると）', () => {
  it('入れたときの差を出す', () => {
    expect(line(impact('add', solved(10050000), solved(12300000)))).toBe('入れると 225万円上がる')
    expect(line(impact('add', solved(10050000), solved(9900000)))).toBe('入れると 15万円下がる')
    expect(line(impact('add', solved(9820000), solved(9820000)))).toBe('入れても 変わらない')
  })
})

describe('impactText：計算できないとき', () => {
  it('どちらかが解けない・段が無いときは、カードに何も出さない（「届く」「届かない」を使わない）', () => {
    expect(line(impact('remove', UNSOLVABLE, UNSOLVABLE))).toBeNull()
    expect(line(impact('remove', UNSOLVABLE, solved(9820000)))).toBeNull()
    expect(line(impact('add', solved(9820000), UNSOLVABLE))).toBeNull()
    expect(line(impact('remove', { kind: 'noSteps' }, { kind: 'noSteps' }))).toBeNull()
  })
})

describe('peakText（節の頭の基準）', () => {
  it('解ければ四捨五入した万円、解けなければ「ながめる」と同じ「届かない」、段が無ければ出さない', () => {
    expect(peakText(solved(9984000))).toEqual({ amount: '998万円', solved: true })
    expect(peakText(solved(12300000))).toEqual({ amount: '1,230万円', solved: true })
    expect(peakText(UNSOLVABLE)).toEqual({ amount: '届かない', solved: false })
    expect(peakText({ kind: 'noSteps' })).toBeNull()
  })
})

describe('impactForCard', () => {
  const home: Goal = {
    id: 'goal-1',
    enabled: true,
    kind: 'home',
    saved: 0,
    purchaseYear: 2036,
    price: 40000000,
    downPayment: 4000000,
    loanYears: 35,
    monthlyUpkeep: 30000,
  }
  const car: Goal = {
    id: 'goal-1',
    enabled: true,
    kind: 'car',
    saved: 0,
    purchaseYear: 2034,
    price: 3000000,
    payment: { type: 'cash' },
    monthlyUpkeep: 20000,
    replaceEveryYears: 7,
  }
  const planWith = (goals: Goal[]): LifePlan => ({
    baseYearMonth: yearMonth(2031, 1),
    adults: [],
    children: [],
    municipality: '99001',
    living: { monthlyLivingCost: 0, monthlyRent: 0 },
    goals,
    assumptions: { investmentReturnRate: 0, inflationRate: 0, mortgageRate: 0 },
  })
  const computed: ComputedImpacts = {
    source: planWith([home]),
    impacts: new Map([['goal-1', impact('remove', solved(9000000), solved(8000000), 'goal-1')]]),
  }

  it('計算の元のカードと中身が同じなら出す', () => {
    expect(impactForCard(computed, { ...home })).toBe(computed.impacts.get('goal-1'))
  })

  it('消したカードの id を使い回した別のカード（家 → 車）には出さない', () => {
    expect(impactForCard(computed, car)).toBeNull()
  })

  it('直している途中のカード（金額・オン・オフが違う）には出さない', () => {
    expect(impactForCard(computed, { ...home, price: 45000000 })).toBeNull()
    expect(impactForCard(computed, { ...home, enabled: false })).toBeNull()
  })

  it('まだ 1 度も出ていない・元の計画に無いカードには出さない', () => {
    expect(impactForCard({ source: null, impacts: new Map() }, home)).toBeNull()
    expect(impactForCard({ ...computed, source: planWith([]) }, home)).toBeNull()
  })
})

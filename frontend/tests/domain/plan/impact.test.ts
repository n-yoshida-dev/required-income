import { describe, expect, it } from 'vitest'
import sampleJson from '../../../src/data/app/sample-household.json'
import { sampleLifePlan } from '../../../src/domain/plan/defaults'
import { evaluate, stepRequiredGross } from '../../../src/domain/plan/evaluate'
import { goalImpacts, impactCalculator, peakGross } from '../../../src/domain/plan/impact'
import type {
  GoalImpact,
  LifePlan,
  PeakGross,
  SampleHouseholdSource,
} from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { adult, defaults, makePlan, monthly, tables } from './planFixtures'

const sample: SampleHouseholdSource = sampleJson.values

/** 見本の世帯の金利をテストの中で固定する（evaluate.test.ts と同じ値。JSON の月ごとの更新に引きずられない） */
const SAMPLE_TEST_RATE = 0.0381

/** 見本の世帯（起点 2026-11・金利だけテストの値） */
const samplePlan = (): LifePlan => {
  const plan = sampleLifePlan(defaults, sample, yearMonth(2026, 11))
  return { ...plan, assumptions: { ...plan.assumptions, mortgageRate: SAMPLE_TEST_RATE } }
}

/** カード 1 枚のオン・オフを入れ替えた計画 */
const toggle = (plan: LifePlan, goalId: string): LifePlan => ({
  ...plan,
  goals: plan.goals.map((goal) =>
    goal.id === goalId ? { ...goal, enabled: !goal.enabled } : goal,
  ),
})

/** `evaluate` の段から読む、いちばん高い段（重さの計算を通さずに出す比べる相手） */
const peakByEvaluate = (plan: LifePlan): PeakGross =>
  peakGross(evaluate(plan, tables, defaults).steps)

/** 差の数字（両方解けたときだけ） */
const changeOf = (impact: GoalImpact): number | null =>
  impact.outcome.kind === 'change' ? impact.outcome.change : null

describe('goalImpacts：完了条件（T11）', () => {
  const plan = samplePlan()
  const impacts = goalImpacts(plan, tables, defaults)
  const base = peakByEvaluate(plan)

  it('見本の世帯の全部のカードで、重さが「そのカードを外して evaluate し直した、いちばん高い段の差」と一致する', () => {
    expect(impacts.map((impact) => impact.goalId)).toEqual(plan.goals.map((goal) => goal.id))
    expect(base.kind).toBe('solved')
    for (const impact of impacts) {
      const toggled = peakByEvaluate(toggle(plan, impact.goalId))
      expect(impact.action).toBe('remove')
      expect(impact.current).toEqual(base)
      expect(impact.toggled).toEqual(toggled)
      if (base.kind !== 'solved' || toggled.kind !== 'solved') throw new Error('見本は解ける')
      expect(changeOf(impact)).toBe(toggled.gross - base.gross)
    }
  })

  it('下がる・変わらない・上がるが分かれる（大学資金のカードは扶養に効き、外すと上がる。旅行と子の費用はいちばん高い段に関わらない）', () => {
    const direction = new Map(
      impacts.map((impact) => [
        impact.goalId,
        impact.outcome.kind === 'change' ? impact.outcome.direction : 'unavailable',
      ]),
    )
    expect(Object.fromEntries(direction)).toEqual({
      'goal-pet': 'down',
      'goal-trip': 'same',
      'goal-home': 'down',
      'goal-car': 'down',
      'goal-child-1': 'same',
      'goal-child-2': 'same',
      'goal-university-2': 'up',
      'goal-retirement': 'down',
    })
    expect(impacts.find((impact) => impact.goalId === 'goal-trip')?.toggled).toEqual(base)
  })

  it('使い回した結果と、使い回さない結果が一致する（見本の世帯・物価ありの世帯）', () => {
    expect(goalImpacts(plan, tables, defaults, { reuse: false })).toEqual(impacts)
    const inflated: LifePlan = {
      ...plan,
      assumptions: { ...plan.assumptions, inflationRate: 0.02 },
    }
    expect(goalImpacts(inflated, tables, defaults)).toEqual(
      goalImpacts(inflated, tables, defaults, { reuse: false }),
    )
  })
})

describe('goalImpacts：オフのカード', () => {
  it('オフのカードには、入れたときの差を出す（外したときの差と対になる）', () => {
    const plan = samplePlan()
    const off = toggle(plan, 'goal-pet')
    const removed = impactCalculator(plan, tables, defaults).impactOf('goal-pet')
    const added = impactCalculator(off, tables, defaults).impactOf('goal-pet')
    expect(added.action).toBe('add')
    expect(added.current).toEqual(removed.toggled)
    expect(added.toggled).toEqual(removed.current)
    expect(changeOf(added)).toBe(-(changeOf(removed) ?? Number.NaN))
    expect(added.outcome).toMatchObject({ direction: 'up' })
  })
})

describe('goalImpacts：収入のカード', () => {
  it('毎月の収入のカードを外すと、いちばん高い段が上がる', () => {
    const plan = makePlan({
      goals: [
        monthly('g-spend', 60000, [2031, 1], [2041, 1]),
        monthly('g-rent-in', 40000, [2031, 1], [2051, 1], { direction: 'income' }),
      ],
    })
    const impacts = goalImpacts(plan, tables, defaults)
    const income = impacts.find((impact) => impact.goalId === 'g-rent-in')
    expect(income?.outcome).toMatchObject({ kind: 'change', direction: 'up' })
    expect(income?.toggled).toEqual(peakByEvaluate(toggle(plan, 'g-rent-in')))
    expect(impacts.find((impact) => impact.goalId === 'g-spend')?.outcome).toMatchObject({
      direction: 'down',
    })
  })
})

describe('goalImpacts：計算できないとき', () => {
  /** 探索の上限（年 1 億円）でも届かない毎月の支出 */
  const HUGE = 10000000

  it('いちばん高い段が解けない計画では、差を数字にしない（外すと解ける・外しても解けない）', () => {
    const plan = makePlan({
      goals: [
        monthly('g-huge', HUGE, [2031, 1], [2032, 1]),
        monthly('g-small', 30000, [2031, 1], [2041, 1]),
      ],
    })
    const [huge, small] = goalImpacts(plan, tables, defaults)
    expect(huge).toMatchObject({
      current: { kind: 'unsolvable' },
      toggled: { kind: 'solved' },
      outcome: { kind: 'unavailable' },
    })
    expect(small).toMatchObject({
      current: { kind: 'unsolvable' },
      toggled: { kind: 'unsolvable' },
      outcome: { kind: 'unavailable' },
    })
  })

  it('入れると解けなくなるオフのカードも、差を数字にしない', () => {
    const plan = makePlan({
      goals: [{ ...monthly('g-huge', HUGE, [2031, 1], [2032, 1]), enabled: false }],
    })
    const [huge] = goalImpacts(plan, tables, defaults)
    expect(huge).toMatchObject({
      action: 'add',
      current: { kind: 'solved' },
      toggled: { kind: 'unsolvable' },
      outcome: { kind: 'unavailable' },
    })
  })

  it('段が無い計画（大人が全員すでに退職の年齢）は noSteps で、差を数字にしない', () => {
    const plan = makePlan({
      adults: [adult({ birthYear: 1940 })],
      goals: [monthly('g', 30000, [2031, 1], [2041, 1])],
    })
    const [impact] = goalImpacts(plan, tables, defaults)
    expect(impact).toMatchObject({
      current: { kind: 'noSteps' },
      toggled: { kind: 'noSteps' },
      outcome: { kind: 'unavailable' },
    })
  })
})

describe('goalImpacts：カードの数の端', () => {
  it('カードが 1 枚だけなら、外すと暮らしだけの計画との差になる', () => {
    const plan = makePlan({ goals: [monthly('g-only', 80000, [2031, 1], [2041, 1])] })
    const [impact] = goalImpacts(plan, tables, defaults)
    const livingOnly = peakByEvaluate({ ...plan, goals: [] })
    const current = peakByEvaluate(plan)
    if (livingOnly.kind !== 'solved' || current.kind !== 'solved') throw new Error('解ける計画')
    expect(impact?.toggled).toEqual(livingOnly)
    expect(changeOf(impact as GoalImpact)).toBe(livingOnly.gross - current.gross)
    expect(impact?.outcome).toMatchObject({ direction: 'down' })
  })

  it('カードが 0 枚なら空。計画に無いカードを聞くのは契約違反', () => {
    const plan = makePlan()
    expect(goalImpacts(plan, tables, defaults)).toEqual([])
    const calculator = impactCalculator(plan, tables, defaults)
    expect(calculator.base()).toEqual(peakByEvaluate(plan))
    expect(() => calculator.impactOf('no-such-goal')).toThrow(RangeError)
  })
})

describe('stepRequiredGross', () => {
  it('evaluate の段の要る世帯年収と同じ値（見本の世帯・物価あり）', () => {
    const plan = samplePlan()
    const inflated: LifePlan = {
      ...plan,
      assumptions: { ...plan.assumptions, inflationRate: 0.02 },
    }
    for (const target of [plan, inflated]) {
      const fromEvaluate = evaluate(target, tables, defaults).steps.map((step) => ({
        fromYear: step.fromYear,
        toYear: step.toYear,
        peakYear: step.peakYear,
        requiredGross: step.requiredGross,
      }))
      expect(stepRequiredGross(target, tables, defaults)).toEqual(fromEvaluate)
    }
  })
})

describe('peakGross', () => {
  it('段が無ければ noSteps、解けない段があれば unsolvable、ほかはいちばん大きい値', () => {
    expect(peakGross([])).toEqual({ kind: 'noSteps' })
    expect(peakGross([{ requiredGross: 5000000 }, { requiredGross: null }])).toEqual({
      kind: 'unsolvable',
    })
    expect(
      peakGross([{ requiredGross: 5000000 }, { requiredGross: 7200000 }, { requiredGross: 0 }]),
    ).toEqual({ kind: 'solved', gross: 7200000 })
  })
})

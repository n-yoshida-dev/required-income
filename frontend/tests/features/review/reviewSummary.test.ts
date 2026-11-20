import { describe, expect, it } from 'vitest'
import type { Evaluation, Step } from '../../../src/domain/plan/types'
import {
  compareStepViews,
  highestStep,
  highestStepView,
  nextStepView,
  reviewSummary,
  type StepView,
} from '../../../src/features/review/reviewSummary'

/** 段を 1 つ作る（金額はダミー） */
const step = (fromYear: number, toYear: number, requiredGross: number | null): Step => ({
  fromYear,
  toYear,
  peakYear: fromYear,
  requiredNet: 0,
  requiredGross,
  expectedGross: 9_000_000,
  causes: [],
  byGoal: [],
})

/** 段と次の段だけを持つ結果 */
const evaluation = (steps: Step[], nextStep: Step | null): Evaluation => ({
  bands: [],
  years: [],
  steps,
  currentGross: 9_000_000,
  nextStep,
  conversions: [],
  notices: [],
})

/** 次の段の見え方（「◯年から」） */
const nextView = (fromYear: number, gross: number | null): StepView => ({
  kind: 'step',
  fromYear,
  years: `${fromYear}年から`,
  gross,
})

describe('highestStep', () => {
  it('要る世帯年収がいちばん大きい段。同じなら早い段、解けない段はどの段より高い', () => {
    const a = step(2026, 2028, 9_500_000)
    const b = step(2029, 2030, 10_000_000)
    const c = step(2031, 2035, 10_000_000)
    expect(highestStep([a, b, c])).toBe(b)
    const unsolved = step(2036, 2040, null)
    expect(highestStep([a, unsolved, b])).toBe(unsolved)
    expect(highestStep([])).toBeNull()
  })
})

describe('段の見え方', () => {
  it('次の段は「◯年から」、いちばん高い段は年の範囲（1 年なら「2031年」）。金額は万円に四捨五入', () => {
    const next = step(2029, 2030, 10_004_999)
    const result = evaluation(
      [step(2026, 2028, 8_000_000), next, step(2031, 2031, 11_005_000)],
      next,
    )
    expect(nextStepView(result)).toEqual(nextView(2029, 10_000_000))
    expect(highestStepView(result)).toEqual({
      kind: 'step',
      fromYear: 2031,
      years: '2031年',
      gross: 11_010_000,
    })
  })

  it('次の段が無ければ「足りている」、段が無ければ「無い」', () => {
    expect(nextStepView(evaluation([step(2026, 2030, 8_000_000)], null))).toEqual({
      kind: 'enough',
    })
    expect(nextStepView(evaluation([], null))).toEqual({ kind: 'none' })
    expect(highestStepView(evaluation([], null))).toEqual({ kind: 'none' })
  })
})

describe('今の計画と案の 1 行（差は、同じ年から始まる段どうしで、どちらも解けているときだけ）', () => {
  it('同じ年から始まる段どうしなら、見せる値どうしの引き算で差を出し、「前は」は添えない', () => {
    const row = compareStepViews(nextView(2032, 9_980_000), nextView(2032, 9_370_000))
    expect(row.delta).toBe(-610_000)
    expect(row.previous).toBeNull()
  })

  it('同じ段で額も同じなら差は 0、「前は」も添えない（画面は何も足さない）', () => {
    const row = compareStepViews(nextView(2029, 9_480_000), nextView(2029, 9_480_000))
    expect(row.delta).toBe(0)
    expect(row.previous).toBeNull()
  })

  it('段の年がずれたら差を出さず、今の計画の年と金額を添える（副業を足して次の段が後ろへ移ったとき）', () => {
    const row = compareStepViews(nextView(2029, 9_480_000), nextView(2032, 9_900_000))
    expect(row.delta).toBeNull()
    expect(row.previous).toEqual(['前は', '2029年から', '948万円'])
  })

  it('どちらかが「届かない」なら差を出さない', () => {
    const toUnsolved = compareStepViews(nextView(2029, 9_480_000), nextView(2029, null))
    expect(toUnsolved.delta).toBeNull()
    expect(toUnsolved.previous).toEqual(['前は', '2029年から', '948万円'])
    const fromUnsolved = compareStepViews(nextView(2029, null), nextView(2029, 9_480_000))
    expect(fromUnsolved.delta).toBeNull()
    expect(fromUnsolved.previous).toEqual(['前は', '2029年から', '届かない'])
  })

  it('今の計画は足りている → 案で次の段ができた：「前は 足りている」', () => {
    const row = compareStepViews({ kind: 'enough' }, nextView(2031, 9_400_000))
    expect(row.delta).toBeNull()
    expect(row.previous).toEqual(['前は', '足りている'])
  })

  it('案で足りるようになった：今の計画の年と金額を添える', () => {
    const row = compareStepViews(nextView(2029, 9_480_000), { kind: 'enough' })
    expect(row.delta).toBeNull()
    expect(row.previous).toEqual(['前は', '2029年から', '948万円'])
  })

  it('どちらも足りている・どちらも段が無いなら、何も添えない', () => {
    expect(compareStepViews({ kind: 'enough' }, { kind: 'enough' }).previous).toBeNull()
    expect(compareStepViews({ kind: 'none' }, { kind: 'none' }).previous).toBeNull()
  })

  it('いちばん高い段も同じ決まり：年がずれたら差を出さず、範囲の年を添える', () => {
    const before = evaluation(
      [step(2026, 2028, 8_000_000), step(2029, 2035, 10_000_000)],
      step(2029, 2035, 10_000_000),
    )
    const after = evaluation([step(2026, 2035, 8_500_000)], null)
    const summary = reviewSummary(before, after)
    expect(summary.next.after).toEqual({ kind: 'enough' })
    expect(summary.next.previous).toEqual(['前は', '2029年から', '1,000万円'])
    expect(summary.highest.delta).toBeNull()
    expect(summary.highest.previous).toEqual(['前は', '2029〜2035年', '1,000万円'])
  })

  it('いちばん高い段が同じ年から始まるなら差を出す', () => {
    const before = evaluation([step(2026, 2030, 9_000_000), step(2031, 2035, 10_000_000)], null)
    const after = evaluation([step(2026, 2030, 9_000_000), step(2031, 2035, 9_390_000)], null)
    expect(reviewSummary(before, after).highest.delta).toBe(-610_000)
  })
})

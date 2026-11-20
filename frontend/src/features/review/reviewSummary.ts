/**
 * 「見直す」の数字（SPEC §4.3「次の段といちばん高い段が、いくら変わったかを数字で出す」）。計算はせず、2 つの `Evaluation` を並べるだけ。
 *
 * - 次の段：`Evaluation.nextStep`（今の世帯年収を初めて上回る段。SPEC §0）。今の計画と案で別の段になってよい
 * - いちばん高い段：要る世帯年収がいちばん大きい段（解けない段はどの段より高い。同じ額なら早い段）
 * - **差（+◯万円／−◯万円）は、今の計画と案で同じ年から始まる段どうしで、どちらも解けているときだけ出す。**
 *   画面に出す万円どうしの引き算（`features/shared/displayMan.ts` の考え方）。
 *   ほかのとき（段の年がずれた・どちらかが「届かない」・足りている⇄段がある、など）は差を出さず、今の計画の値を「前は …」で薄く添える。
 *   別の段どうしの差を出すと、「副業を足したら次の段が上がった」のように読み違えるため
 */

import type { Evaluation, Step, Yen } from '../../domain/plan/types'
import { roundMan } from '../shared/displayMan'
import { formatYearRange, manNumber } from '../shared/format'

/** 段 1 つの見え方 */
export type StepView =
  /** 段がある。`fromYear` は段の始まりの年、`years` は見せる年、`gross` は見せる値（万円に四捨五入した円）。解けない段は null（「届かない」） */
  | { kind: 'step'; fromYear: number; years: string; gross: Yen | null }
  /** 次の段が無い（どの段も今の世帯年収で足りる） */
  | { kind: 'enough' }
  /** 段が 1 つも無い（働く大人が全員もう退職の年齢） */
  | { kind: 'none' }

/** 今の計画と案の 1 行 */
export type SummaryRow = {
  before: StepView
  after: StepView
  /** 案 − 今の計画（見せる値どうし）。同じ年から始まる段どうしで、どちらも解けているときだけ。ほかは null */
  delta: Yen | null
  /**
   * 差を出せないときに添える今の計画の値（「前は」「2029年から」「948万円」のかけら。かけらの中では折り返さない）。
   * 差を出せるとき・今の計画と同じときは null
   */
  previous: string[] | null
}

/** 次の段の見え方 */
export function nextStepView(evaluation: Evaluation): StepView {
  if (evaluation.steps.length === 0) return { kind: 'none' }
  const step = evaluation.nextStep
  if (step === null) return { kind: 'enough' }
  return {
    kind: 'step',
    fromYear: step.fromYear,
    years: `${step.fromYear}年から`,
    gross: shown(step),
  }
}

/** いちばん高い段の見え方 */
export function highestStepView(evaluation: Evaluation): StepView {
  const step = highestStep(evaluation.steps)
  if (step === null) return { kind: 'none' }
  return {
    kind: 'step',
    fromYear: step.fromYear,
    years: formatYearRange(step.fromYear, step.toYear),
    gross: shown(step),
  }
}

/** 要る世帯年収がいちばん大きい段（解けない段がいちばん高い。同じなら早い段）。段が無ければ null */
export function highestStep(steps: readonly Step[]): Step | null {
  let highest: Step | null = null
  for (const step of steps) {
    if (highest === null || heightOf(step) > heightOf(highest)) highest = step
  }
  return highest
}

/** 今の計画と案を 1 行に並べる */
export function compareStepViews(before: StepView, after: StepView): SummaryRow {
  if (
    before.kind === 'step' &&
    after.kind === 'step' &&
    before.fromYear === after.fromYear &&
    before.gross !== null &&
    after.gross !== null
  ) {
    return { before, after, delta: after.gross - before.gross, previous: null }
  }
  return {
    before,
    after,
    delta: null,
    previous: sameView(before, after) ? null : previousOf(before),
  }
}

/** 次の段といちばん高い段を、今の計画と案で並べる */
export function reviewSummary(
  base: Evaluation,
  draft: Evaluation,
): { next: SummaryRow; highest: SummaryRow } {
  return {
    next: compareStepViews(nextStepView(base), nextStepView(draft)),
    highest: compareStepViews(highestStepView(base), highestStepView(draft)),
  }
}

/** 今の計画の値を添えるかけら（「前は」の後に、年と金額、または「足りている」など） */
function previousOf(view: StepView): string[] {
  if (view.kind === 'none') return ['前は', '段が無い']
  if (view.kind === 'enough') return ['前は', '足りている']
  return ['前は', view.years, view.gross === null ? '届かない' : `${manNumber(view.gross)}万円`]
}

/** 2 つの見え方が同じか（同じなら「前は」を添えない） */
function sameView(a: StepView, b: StepView): boolean {
  if (a.kind !== 'step' || b.kind !== 'step') return a.kind === b.kind
  return a.fromYear === b.fromYear && a.years === b.years && a.gross === b.gross
}

/** 段の要る世帯年収の見せる値（解けない段は null） */
function shown(step: Step): Yen | null {
  return step.requiredGross === null ? null : roundMan(step.requiredGross)
}

/** 比べるための高さ（解けない段はどの段より高い） */
function heightOf(step: Step): number {
  return step.requiredGross ?? Infinity
}

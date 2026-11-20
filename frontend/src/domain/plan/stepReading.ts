/**
 * 段の読み方（W18。SPEC §4.1）。「ながめる」が図の意味を字で出すための判定を、画面の外に置く。
 *
 * - 今の年収で足りる最後の年（次の段の前の年）
 * - 段の理由を、始まる・終わる・増える・減るの組に分ける
 * - 前の段より下がる段と、下がった理由（要る手取りを下げる向きの理由のうち、いちばん大きい物）
 * - 次の段より先の流れ：いちばん高い段と、最後に落ち着く段（D42。概要の 3 つ目の箇条書き）
 *
 * 言葉（「始まる」など）は画面が持つ。ここは組と順番だけを決める。
 */

import type { CauseChange, Step, StepCause, Year } from './types'

/** 組を並べる順。始まる・終わるを先に（W18 の直し方）、増える・減るは後 */
export const CAUSE_CHANGE_ORDER: readonly CauseChange[] = ['start', 'end', 'more', 'less']

/** 同じ変わり方の理由の組 */
export type CauseGroup = { change: CauseChange; causes: StepCause[] }

/** 前の段より下がる段 1 つ */
export type FallingStep = {
  /** `steps` の中の位置 */
  index: number
  fromYear: Year
  /** 下げる向きの理由のうち、いちばん大きい物。理由が無ければ null（上限で切れたなど） */
  cause: StepCause | null
  /** `cause` のほかに下げる向きの理由がいくつあるか */
  others: number
}

/**
 * 今の世帯年収で足りる最後の年。次の段の前の年で、その前に段が 1 つ以上あるときだけ（次の段が最初の段なら null）。
 * 次の段は「今の世帯年収を上回る最初の段」なので、その前の段はどれも今の年収で足りている
 */
export function enoughUntilYear(
  steps: readonly Pick<Step, 'fromYear'>[],
  next: Pick<Step, 'fromYear'> | null,
): Year | null {
  if (next === null) return null
  const before = steps.some((step) => step.fromYear < next.fromYear)
  return before ? next.fromYear - 1 : null
}

/**
 * 理由の帯が収入の帯（児童手当・就学支援金など）か。`monthlyDelta` は要る手取りを押し上げる向きが正なので、
 * 始まる・増えるのに負（要る手取りが下がる）か、終わる・減るのに正（上がる）なら収入の帯（W19。画面が「受け取り」と言うため）
 */
export function causeIsIncome(cause: Pick<StepCause, 'change' | 'monthlyDelta'>): boolean {
  const grows = cause.change === 'start' || cause.change === 'more'
  return grows ? cause.monthlyDelta < 0 : cause.monthlyDelta > 0
}

/** 理由を変わり方の組に分ける。組は `CAUSE_CHANGE_ORDER` の順、組の中は元の順（差の大きい順）。空の組は返さない */
export function causeGroups(causes: readonly StepCause[]): CauseGroup[] {
  return CAUSE_CHANGE_ORDER.map((change) => ({
    change,
    causes: causes.filter((cause) => cause.change === change),
  })).filter((group) => group.causes.length > 0)
}

/**
 * 前の段より下がる段。要る世帯年収で比べ、解けない段（null）はいちばん高いとみなす（図で枠の上端まで伸ばすのと同じ）。
 * 下がった理由は、要る手取りを下げる向き（`monthlyDelta` が負）の理由のうち、いちばん大きい物
 */
export function fallingSteps(
  steps: readonly Pick<Step, 'fromYear' | 'requiredGross' | 'causes'>[],
): FallingStep[] {
  const height = (gross: number | null): number => gross ?? Number.POSITIVE_INFINITY
  const falls: FallingStep[] = []
  steps.forEach((step, index) => {
    const previous = steps[index - 1]
    if (previous === undefined) return
    if (!(height(step.requiredGross) < height(previous.requiredGross))) return
    const lowering = step.causes
      .filter((cause) => cause.monthlyDelta < 0)
      .sort((a, b) => a.monthlyDelta - b.monthlyDelta)
    falls.push({
      index,
      fromYear: step.fromYear,
      cause: lowering[0] ?? null,
      others: Math.max(0, lowering.length - 1),
    })
  })
  return falls
}

/** 流れを読むのに要る段の項目 */
type OutlookStep = Pick<Step, 'fromYear' | 'toYear' | 'requiredGross' | 'causes'>

/** 流れの中の段 1 つ */
export type OutlookPoint = {
  fromYear: Year
  toYear: Year
  /** 要る世帯年収。解けない段は null */
  requiredGross: number | null
}

/** 次の段より先の流れ（D42。概要の 3 つ目の箇条書き） */
export type StepOutlook = {
  /** いちばん高い段（解けない段はいちばん高いとみなし、同じ高さなら早い段）。次の段がいちばん高いなら null */
  peak: OutlookPoint | null
  /** いちばん高い段が最後の段か（「◯年まで続きます」と言うため） */
  peakIsLast: boolean
  /** 最後の段（最後に落ち着く段）。次の段かいちばん高い段と同じなら null */
  last: (OutlookPoint & { fall: FallingStep | null }) | null
}

/**
 * 次の段より先の流れ。いちばん高い段と、最後に落ち着く段を出す。
 * 次の段が無い・次の段が最後の段（その先に段が無い）ときは null（箇条書きを出さない）。
 * 最後の段が前の段より下がるなら、その下がり方（`fallingSteps` の 1 つ）を添える
 */
export function stepOutlook(
  steps: readonly OutlookStep[],
  next: Pick<Step, 'fromYear'> | null,
): StepOutlook | null {
  if (next === null) return null
  const nextIndex = steps.findIndex((step) => step.fromYear === next.fromYear)
  const lastIndex = steps.length - 1
  if (nextIndex < 0 || nextIndex >= lastIndex) return null

  const height = (gross: number | null): number => gross ?? Number.POSITIVE_INFINITY
  // 次の段より前の段は、どれも今の年収で足りる（次の段より低い）ので、次の段から先だけを見る
  let peakIndex = nextIndex
  for (let index = nextIndex + 1; index <= lastIndex; index++) {
    const step = steps[index]
    const peak = steps[peakIndex]
    if (step === undefined || peak === undefined) continue
    if (height(step.requiredGross) > height(peak.requiredGross)) peakIndex = index
  }

  const point = (index: number): OutlookPoint => {
    const step = steps[index]
    if (step === undefined) throw new RangeError(`段の位置が範囲の外: ${index}`)
    return { fromYear: step.fromYear, toYear: step.toYear, requiredGross: step.requiredGross }
  }
  const lastFall = fallingSteps(steps).find((fall) => fall.index === lastIndex) ?? null

  return {
    peak: peakIndex === nextIndex ? null : point(peakIndex),
    peakIsLast: peakIndex === lastIndex,
    last: peakIndex === lastIndex ? null : { ...point(lastIndex), fall: lastFall },
  }
}

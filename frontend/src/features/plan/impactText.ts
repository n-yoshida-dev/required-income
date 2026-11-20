/**
 * 目標カードの見出しに出す重さの言葉と、目標の節の頭に出す基準（SPEC §4.2「外すと −◯万円」・§3.8）。
 * 計算はせず、domain の `GoalImpact` を言葉にするだけ。
 *
 * - 基準は節の頭に 1 回だけ：「いちばん高い段 998万円」（「ながめる」の段の金額と同じ四捨五入した万円）
 * - カードは短く、向きを言葉で：「外すと 61万円下がる」「外すと 13万円上がる」「外しても 変わらない」。
 *   オフのカードは「入れると 225万円上がる」「入れても 変わらない」
 * - 差は、画面に出ている万円どうしの引き算で出す（基準と同じ四捨五入をした値どうしの差。`displayMan.ts` の考え方）。見せる値で差が 0 なら「変わらない」
 * - 今か入れ替えた後のどちらかが解けない・段が無いときは、カードには何も出さない
 *   （「届く」「届かない」は「ながめる」の「見込みで届く・届かない」と取り違えられるため使わない）
 * - どれも勧めない（D31）。色を付けない
 */

import type { Goal, GoalId, GoalImpact, LifePlan, PeakGross } from '../../domain/plan/types'
import { roundMan } from '../shared/displayMan'
import { manNumber } from '../shared/format'

/** カードの 2 行目に出す重さの部品（「外すと」＋「61万円」＋「下がる」） */
export type ImpactText = {
  /** 「外すと」「外しても」「入れると」「入れても」 */
  lead: string
  /** 差の金額（「61万円」。向きは tail が言う）。変わらないときは null */
  amount: string | null
  /** 「下がる」「上がる」「変わらない」 */
  tail: string
}

/** 頭の言葉。`then` は変わるとき、`still` は変わらないとき */
const LEADS = {
  remove: { then: '外すと', still: '外しても' },
  add: { then: '入れると', still: '入れても' },
} as const

/** 重さをカードの言葉にする。どちらかが解けない・段が無いときは null（出さない） */
export function impactText(impact: GoalImpact): ImpactText | null {
  const { current, toggled } = impact
  if (current.kind !== 'solved' || toggled.kind !== 'solved') return null
  const change = roundMan(toggled.gross) - roundMan(current.gross)
  const leads = LEADS[impact.action]
  if (change === 0) return { lead: leads.still, amount: null, tail: '変わらない' }
  return {
    lead: leads.then,
    amount: `${manNumber(Math.abs(change))}万円`,
    tail: change < 0 ? '下がる' : '上がる',
  }
}

/**
 * 節の頭に出す基準の金額（「998万円」）。解けなければ「ながめる」の段と同じ「届かない」。段が無ければ null（出さない）
 */
export function peakText(peak: PeakGross): { amount: string; solved: boolean } | null {
  if (peak.kind === 'noSteps') return null
  if (peak.kind === 'unsolvable') return { amount: '届かない', solved: false }
  return { amount: `${manNumber(roundMan(peak.gross))}万円`, solved: true }
}

/** 重さと、それを計算した元の計画（`useGoalImpacts` が返す） */
export type ComputedImpacts = {
  /** 計算の元にした計画。まだ 1 度も出ていなければ null */
  source: LifePlan | null
  impacts: ReadonlyMap<GoalId, GoalImpact>
}

/**
 * 画面のカードに出してよい重さ。計算の元にした計画の同じ id のカードと、中身（種類・オン・オフ・金額・時期など）がそっくり同じときだけ返す。
 * 直している途中（保存が止まっている・計算が追いついていない）のカードや、消したカードの id を後から足した別のカードが使い回したときに、
 * 前のカードの重さを出さないため
 */
export function impactForCard(computed: ComputedImpacts, goal: Goal): GoalImpact | null {
  const impact = computed.impacts.get(goal.id)
  if (impact === undefined || computed.source === null) return null
  const sourceGoal = computed.source.goals.find((entry) => entry.id === goal.id)
  if (sourceGoal === undefined || JSON.stringify(sourceGoal) !== JSON.stringify(goal)) return null
  return impact
}

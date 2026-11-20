/**
 * 大学資金のカード → 帯（SPEC §3.2 の `university`・「大学資金・老後資金のカードの細部」）。
 *
 * 期間は起点の月から高校 3 年の 3 月まで（使う月＝大学 1 年の 4 月の前まで。`universityUseMonth`）。
 *
 * - 「児童手当」`earmarked`：児童手当を回すとき。その子の児童手当の月額をそのまま（要る手取りに入れない。子の費用のカードは収入の帯を出さない）
 * - 「大学資金の積立」`saving`：家計から足す月額。目標額から、貯まっている額と児童手当を使う月の価値に直して引いた残りを、
 *   利回り（子の名義の NISA は前提の利回り、預金は 0）で積む月額にして解く（`bands/fund.ts`）。届いていれば 0 円の帯
 *
 * 帯の名前に子の順を添える（「大学資金の積立（1人目）」）。子の費用のカードと同じ理由（段の理由は帯の名前だけを出す）。
 * 使う月が起点の月以前（もう高校を出た）なら帯を出さない（知らせ `fundDeadlinePast` は `evaluate` の役目）。
 * 帯は「ずっと」の終わりで切り詰めない（老後資金と同じ。積み立てる期間は使う月で決まり、要る手取りは階段の年だけ数える）。
 */

import type { Band, BandContext, FundPlan, UniversityGoal } from '../types'
import { monthsBetween } from '../yearMonth'
import { assertNonNegativeYen, makeBand } from './band'
import {
  CHILD_ALLOWANCE_LABEL,
  bandsFromMonthly,
  childAllowanceMonthly,
  universityUseMonth,
} from './childAllowance'
import { fundReached, monthlyRateOf, solveHouseholdMonthly } from './fund'

/** 帯の名前（子の順を添える前） */
export const UNIVERSITY_BAND_LABELS = {
  allowance: CHILD_ALLOWANCE_LABEL,
  saving: '大学資金の積立',
} as const

const VEHICLES: readonly UniversityGoal['vehicle'][] = ['childNisa', 'deposit']

/** 大学資金のカードの入力が契約どおりかを確かめる。違えば投げる */
export function assertUniversityGoal(goal: UniversityGoal): void {
  assertNonNegativeYen(goal.targetAmount, '大学資金の目標額')
  assertNonNegativeYen(goal.saved, '大学資金の貯まっている額')
  if (!VEHICLES.includes(goal.vehicle)) {
    throw new RangeError(
      `大学資金の置き場は childNisa か deposit で指定してください: ${goal.vehicle}`,
    )
  }
}

/**
 * 大学資金のカードの積立の答え（月額・到達額・児童手当の月の並び）。使う月が起点の月以前なら null（積み立てる月が無い）。
 * 子が見つからない・入力が契約に反するときは投げる
 */
export function universityFundPlan(goal: UniversityGoal, ctx: BandContext): FundPlan | null {
  assertUniversityGoal(goal)
  const child = ctx.children.find((entry) => entry.id === goal.childId)
  if (child === undefined) {
    throw new RangeError(`大学資金のカードの子が見つかりません: ${goal.childId}`)
  }
  const useMonth = universityUseMonth(child)
  const months = monthsBetween(ctx.base, useMonth)
  if (months <= 0) return null

  const monthlyRate =
    goal.vehicle === 'deposit' ? 0 : monthlyRateOf(ctx.assumptions.investmentReturnRate)
  const allowanceMonthly = goal.allocateChildAllowance
    ? childAllowanceMonthly(ctx, child.id, ctx.base, useMonth)
    : []
  const terms = { months, monthlyRate, saved: goal.saved, allowanceMonthly }
  const householdMonthly = solveHouseholdMonthly(terms, goal.targetAmount)
  return {
    goalId: goal.id,
    from: ctx.base,
    useMonth,
    monthlyRate,
    householdMonthly,
    allowanceMonthly,
    reached: fundReached(terms, householdMonthly),
  }
}

/** 大学資金のカード 1 枚を帯に直す。オン・オフは呼び出し側（`expandGoal`）が見る */
export function universityBands(goal: UniversityGoal, ctx: BandContext): Band[] {
  const plan = universityFundPlan(goal, ctx)
  if (plan === null) return []
  const order = ctx.children.findIndex((entry) => entry.id === goal.childId) + 1
  const bands = bandsFromMonthly(
    {
      goalId: goal.id,
      label: `${UNIVERSITY_BAND_LABELS.allowance}（${order}人目）`,
      kind: 'earmarked',
    },
    plan.allowanceMonthly,
    plan.from,
  )
  // 届いていても 0 円の帯を出す（家・自由入力の一度きりと同じ。足りていることがカードで読める）
  bands.push(
    makeBand({
      goalId: goal.id,
      label: `${UNIVERSITY_BAND_LABELS.saving}（${order}人目）`,
      kind: 'saving',
      monthly: plan.householdMonthly,
      from: plan.from,
      to: plan.useMonth,
    }),
  )
  return bands
}

/**
 * 老後資金のカード → 帯（SPEC §3.2 の `retirement`・「大学資金・老後資金のカードの細部」）。
 *
 * - 「老後資金の積立」`saving`：起点の月から `byYear` の 1 月の前まで（`byYear` の前年末まで）。
 *   目標額から、貯まっている額を使う月の価値に直して引いた残りを、利回り（NISA は前提の利回り、預金は 0）で積む月額にして解く
 *   （大学資金と同じ `bands/fund.ts`。児童手当は無い）。届いていれば 0 円の帯
 *
 * 期限が起点の月以前（`byYear` が起点の年以前で、積み立てる月が無い）なら帯を出さない（知らせ `fundDeadlinePast` は `evaluate` の役目）。
 * 帯は「ずっと」の終わりで切り詰めない（年下の大人が後で退職するなど、階段より先まで積むことがある。要る手取りは階段の年だけ数える）。
 */

import type { Band, BandContext, FundPlan, RetirementGoal, YearMonth } from '../types'
import { monthsBetween, startOfYear } from '../yearMonth'
import { assertNonNegativeYen, makeBand } from './band'
import { fundReached, monthlyRateOf, solveHouseholdMonthly } from './fund'

/** 帯の名前 */
export const RETIREMENT_BAND_LABEL = '老後資金の積立'

const VEHICLES: readonly RetirementGoal['vehicle'][] = ['nisa', 'deposit']

/** 老後資金を使う月（`byYear` の 1 月）。積立はこの月の前まで */
export function retirementUseMonth(goal: Pick<RetirementGoal, 'byYear'>): YearMonth {
  return startOfYear(goal.byYear)
}

/** 老後資金のカードの入力が契約どおりかを確かめる。違えば投げる */
export function assertRetirementGoal(goal: RetirementGoal): void {
  assertNonNegativeYen(goal.targetAmount, '老後資金の目標額')
  assertNonNegativeYen(goal.saved, '老後資金の貯まっている額')
  if (!Number.isInteger(goal.byYear)) {
    throw new RangeError(`老後資金の期限の年は整数で指定してください: ${goal.byYear}`)
  }
  if (!VEHICLES.includes(goal.vehicle)) {
    throw new RangeError(`老後資金の置き場は nisa か deposit で指定してください: ${goal.vehicle}`)
  }
}

/** 老後資金のカードの積立の答え。期限が起点の月以前なら null（積み立てる月が無い） */
export function retirementFundPlan(goal: RetirementGoal, ctx: BandContext): FundPlan | null {
  assertRetirementGoal(goal)
  const useMonth = retirementUseMonth(goal)
  const months = monthsBetween(ctx.base, useMonth)
  if (months <= 0) return null
  const monthlyRate =
    goal.vehicle === 'deposit' ? 0 : monthlyRateOf(ctx.assumptions.investmentReturnRate)
  const terms = { months, monthlyRate, saved: goal.saved, allowanceMonthly: [] }
  const householdMonthly = solveHouseholdMonthly(terms, goal.targetAmount)
  return {
    goalId: goal.id,
    from: ctx.base,
    useMonth,
    monthlyRate,
    householdMonthly,
    allowanceMonthly: [],
    reached: fundReached(terms, householdMonthly),
  }
}

/** 老後資金のカード 1 枚を帯に直す。オン・オフは呼び出し側（`expandGoal`）が見る */
export function retirementBands(goal: RetirementGoal, ctx: BandContext): Band[] {
  const plan = retirementFundPlan(goal, ctx)
  if (plan === null) return []
  return [
    makeBand({
      goalId: goal.id,
      label: RETIREMENT_BAND_LABEL,
      kind: 'saving',
      monthly: plan.householdMonthly,
      from: plan.from,
      to: plan.useMonth,
    }),
  ]
}

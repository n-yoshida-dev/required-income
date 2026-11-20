/**
 * 目標カードに出す帯と「毎月いくら」（SPEC §4.2「閉じたままで毎月いくらが読める。開くとそのカードの帯」）。
 *
 * 帯は domain の `expandGoal` が作った物をそのまま使い、ここでは計算しない（並べ方と、閉じたカードに出す 1 つの月額を選ぶだけ）。
 * オフのカードも、オンにしたらどうなるかが読めるよう、オンとして帯を出す。
 */

import {
  bandContext,
  expandGoal,
  fundPlanOf,
  type BandDefaults,
} from '../../domain/plan/bands/index'
import type {
  Band,
  ChildCostTables,
  FundPlan,
  Goal,
  LifePlan,
  YearMonth,
  Yen,
} from '../../domain/plan/types'
import { compareYearMonth, laterOf } from '../../domain/plan/yearMonth'

/** カードの帯。入力が契約に反していて帯にできないときは理由 */
export type GoalBandsResult = { ok: true; bands: Band[] } | { ok: false; message: string }

/**
 * カード 1 枚の帯を出す。入力の契約違反（`RangeError`）は理由として返し、カードに出す。
 * それ以外の例外はプログラムの不具合なので投げ直す
 *
 * @param tables 子の費用のカードが読む制度データ（`masterTables` をそのまま渡してよい）
 */
export function goalBands(
  plan: LifePlan,
  goal: Goal,
  defaults: BandDefaults,
  tables: ChildCostTables,
): GoalBandsResult {
  try {
    return {
      ok: true,
      bands: expandGoal({ ...goal, enabled: true }, bandContext(plan, defaults, tables)),
    }
  } catch (error) {
    if (error instanceof RangeError) {
      return { ok: false, message: error.message }
    }
    throw error
  }
}

/**
 * 大学資金・老後資金のカードの積立の答え（到達額とその内訳）。domain の `fundPlanOf` をそのまま返す（ここでは計算しない）。
 * 期限が過ぎている（積み立てる月が無い）・入力が契約に反するときは null（理由は帯の所に出る）
 *
 * @param tables 子の費用・大学資金のカードが読む制度データ（`masterTables` をそのまま渡してよい）
 */
export function goalFund(
  plan: LifePlan,
  goal: Extract<Goal, { kind: 'university' | 'retirement' }>,
  defaults: BandDefaults,
  tables: ChildCostTables,
): FundPlan | null {
  try {
    return fundPlanOf(goal, bandContext(plan, defaults, tables))
  } catch (error) {
    if (error instanceof RangeError) return null
    throw error
  }
}

/**
 * 閉じたカードに出す月額：いちばん重い月の、同時に掛かる帯の合計。
 * 家なら「頭金と諸費用の積立」の月と「返済 ＋ 修繕と税」の月のうち大きい方になる（T7）。
 * 起点の月より前の月は数えない（起点より前に終わった帯は除き、起点より前に始まった帯は起点から数える）。
 * もう買った家で返済が終わっていれば、返済は入らない（PR #86 の Codex の指摘）。
 * 数える月ごと（起点と、起点より後の帯の始まり）に、その月に掛かる帯を足し（収入は引く）、絶対値のいちばん大きい月を選ぶ。
 * 合計が負なら収入の印を付ける。帯が無い（使う月が過ぎた一度きりなど）ときは null
 *
 * @param base 計算の起点（`LifePlan.baseYearMonth`）
 */
export function cardMonthly(
  bands: readonly Band[],
  base: YearMonth,
): { monthly: Yen; income: boolean } | null {
  const counted = bands.filter(
    (band) =>
      band.kind !== 'earmarked' &&
      compareYearMonth(band.from, band.to) < 0 &&
      compareYearMonth(band.to, base) > 0,
  )
  let top: number | null = null
  for (const start of counted) {
    const point = laterOf(start.from, base)
    let net = 0
    for (const band of counted) {
      if (compareYearMonth(band.from, point) <= 0 && compareYearMonth(point, band.to) < 0) {
        net += band.kind === 'income' ? -band.monthly : band.monthly
      }
    }
    if (top === null || Math.abs(net) > Math.abs(top)) top = net
  }
  return top === null ? null : { monthly: Math.abs(top), income: top < 0 }
}

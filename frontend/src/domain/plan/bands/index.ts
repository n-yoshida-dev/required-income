/**
 * 目標カード → 帯の入口（SPEC §1 `bands/index.ts`）。
 *
 * 暮らし・自由入力（T2）と家（T7）と車（T8）と子の費用（T9）と大学資金・老後資金（T10）を帯にする。
 */

import { lastNeedYear } from '../need'
import type {
  AppDefaults,
  Band,
  BandContext,
  ChildCostTables,
  FundPlan,
  Goal,
  LifePlan,
  YearMonth,
} from '../types'
import { LIVING_GOAL_ID } from '../types'
import { assertYearMonth, compareYearMonth, laterOf, startOfYear } from '../yearMonth'
import { carBands } from './car'
import { earmarkedChildren } from './childAllowance'
import { childCostBands } from './childCost'
import { customBands } from './custom'
import { homeBands, homePurchaseMonth } from './home'
import { livingBands } from './living'
import { retirementBands, retirementFundPlan } from './retirementFund'
import { universityBands, universityFundPlan } from './universityFund'

/**
 * 計画から帯の展開に渡す物を作る。
 * 「ずっと」の帯は、要る手取りを数える最後の年の翌年 1 月の前まで。もう数える年が無ければ起点で止める。
 *
 * @param defaults アプリの既定値。家の諸費用の率、車の下取りの率とローンの金利を読む
 * @param tables 子の費用・大学資金のカードが読む制度データ（`MasterTables` をそのまま渡してよい）
 */
export function bandContext(
  plan: Pick<LifePlan, 'baseYearMonth' | 'adults' | 'children' | 'assumptions' | 'goals'>,
  defaults: BandDefaults,
  tables: ChildCostTables,
): BandContext {
  assertYearMonth(plan.baseYearMonth, '起点')
  const until = startOfYear(lastNeedYear(plan) + 1)
  return {
    base: plan.baseYearMonth,
    until: laterOf(until, plan.baseYearMonth),
    assumptions: {
      inflationRate: plan.assumptions.inflationRate,
      mortgageRate: plan.assumptions.mortgageRate,
      investmentReturnRate: plan.assumptions.investmentReturnRate,
    },
    settings: {
      homeClosingCostRate: defaults.home.closingCostRate.value,
      carResaleRate: defaults.car.resaleRate.value,
      carLoanRate: defaults.car.loanRate.value,
    },
    children: plan.children,
    tables,
    allowanceEarmarked: earmarkedChildren(plan.goals),
  }
}

/** 帯の展開が読むアプリの既定値 */
export type BandDefaults = Pick<AppDefaults, 'home' | 'car'>

/** 目標カード 1 枚を帯に直す。オフのカードは帯を出さない */
export function expandGoal(goal: Goal, ctx: BandContext): Band[] {
  if (!goal.enabled) {
    return []
  }
  switch (goal.kind) {
    case 'custom':
      return customBands(goal, ctx)
    case 'home':
      return homeBands(goal, ctx)
    case 'car':
      return carBands(goal, ctx)
    case 'childCost':
      return childCostBands(goal, ctx)
    case 'university':
      return universityBands(goal, ctx)
    case 'retirement':
      return retirementBands(goal, ctx)
  }
}

/**
 * 大学資金・老後資金のカードの積立の答え（月額・到達額）。期限が起点の月以前なら null。
 * オン・オフは見ない（カードの画面がオフでも読めるように）
 */
export function fundPlanOf(
  goal: Extract<Goal, { kind: 'university' | 'retirement' }>,
  ctx: BandContext,
): FundPlan | null {
  return goal.kind === 'university' ? universityFundPlan(goal, ctx) : retirementFundPlan(goal, ctx)
}

/**
 * 家賃が終わる月（この月の前まで）。オンの家のカードのうち、いちばん早い買う月。
 * 家のカードが無い・どれもオフなら「ずっと」の終わり。「ずっと」の終わりより後に買うときも、そこで止める
 */
export function rentUntil(goals: readonly Goal[], ctx: Pick<BandContext, 'until'>): YearMonth {
  let end = ctx.until
  for (const goal of goals) {
    if (goal.kind !== 'home' || !goal.enabled) continue
    const purchase = homePurchaseMonth(goal)
    if (compareYearMonth(purchase, end) < 0) end = purchase
  }
  return end
}

/**
 * 計画の帯をすべて出す（暮らし → 目標カードの順）。
 * カードの id が重なる、`'living'` と同じ、のときは内訳が混ざるので契約違反として投げる。
 * 子の費用のカード・大学資金のカードが同じ子に 2 枚あるときも、費用や児童手当を二重に数えるので投げる（子ごとに 1 枚。SPEC §2.1）。
 *
 * @param defaults アプリの既定値（`bandContext` に渡す）
 * @param tables 子の費用・大学資金のカードが読む制度データ（`bandContext` に渡す）
 */
export function expandPlan(
  plan: LifePlan,
  defaults: BandDefaults,
  tables: ChildCostTables,
): Band[] {
  const ids = new Set<string>()
  const perChild = { childCost: new Set<string>(), university: new Set<string>() }
  for (const goal of plan.goals) {
    if (goal.id === LIVING_GOAL_ID || ids.has(goal.id)) {
      throw new RangeError(`目標カードの id が重なっています: ${goal.id}`)
    }
    ids.add(goal.id)
    if (goal.kind === 'childCost' || goal.kind === 'university') {
      const seen = perChild[goal.kind]
      if (seen.has(goal.childId)) {
        const name = goal.kind === 'childCost' ? '子の費用' : '大学資金'
        throw new RangeError(`同じ子に${name}のカードが 2 枚あります: ${goal.childId}`)
      }
      seen.add(goal.childId)
    }
  }

  const ctx = bandContext(plan, defaults, tables)
  return [
    ...livingBands(plan.living, plan.assumptions.inflationRate, ctx, rentUntil(plan.goals, ctx)),
    ...plan.goals.flatMap((goal) => expandGoal(goal, ctx)),
  ]
}

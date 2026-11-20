/**
 * 入口（SPEC §3.9）。計画を 1 つ受け取り、帯・年ごとの要る手取り・段・要る世帯年収・埋め方の換算・知らせを返す。
 *
 * 順番（SPEC §3.4）：
 *
 * ```
 * 帯 → 年ごとの要る手取り（その年の円）→ 今のお金の価値に割り戻す → 段にまとめる
 *    → 段の値になった年の「その年の円」の要る手取りで額面に直す → 出た額面をその年から割り戻す
 * ```
 *
 * 物価が 0 のあいだは、割り戻しても同じ数字になる。
 * 画面が操作のたびに呼ぶので、税の計算は段ごと・換算ごとにだけ回す（年ごとには回さない）。
 */

import { roundYen } from '../money'
import { carPurchaseMonth } from './bands/car'
import { bandContext, expandPlan, fundPlanOf } from './bands/index'
import { homeLoanNotices, homeSavingSoonNotices } from './homeLoan'
import { fundNotices } from './nisa'
import { lastNeedYear, yearlyNeeds } from './need'
import {
  incomeConversions,
  householdTaxAt,
  requiredHouseholdGross,
  type GrossSolver,
} from './requiredIncome'
import { bandAnnualsInYear, groupSteps, stepCauses } from './steps'
import { expectedLevels, householdGross, householdTaxInput } from './taxBridge'
import type {
  AppDefaults,
  BandAnnual,
  Evaluation,
  IncomeConversion,
  LifePlan,
  Notice,
  PlanTables,
  Rate,
  SolveContext,
  Step,
  StepConversions,
  StepGross,
  Year,
  YearNeed,
  Yen,
} from './types'
import { monthsBetween } from './yearMonth'

/**
 * 計画を評価する。
 *
 * @param tables 税・社会保険の表と、子の費用・大学資金のカードの制度データ（`MasterTables`）に、NISA の上限を足した物（`data/appData.ts` の `planTables`）
 * @param defaults アプリの既定値（`data/app/defaults.json` の `values`）。段のしきい値・橋渡しの既定値・知らせの月数を読む
 * @throws {RangeError} 計画が契約に反しているとき（年が逆、金額が負など）
 */
export function evaluate(plan: LifePlan, tables: PlanTables, defaults: AppDefaults): Evaluation {
  const { real, bands, years, realNeedOf, groups, contextOf, nominalNeedOf } = prepareSteps(
    plan,
    tables,
    defaults,
  )
  const baseYear = plan.baseYearMonth.year
  // 大学資金・老後資金のカードの知らせ（NISA の上限など）に使う。帯と同じ材料で積立の答えを出し直す
  const fundContext = bandContext(plan, defaults, tables)
  const annualsOf = (year: Year): BandAnnual[] =>
    bandAnnualsInYear(bands, plan.baseYearMonth, year).map((entry) => ({
      ...entry,
      annual: real(entry.annual, year),
    }))

  const lastYear = years[years.length - 1]?.year ?? baseYear

  let approximated = false
  const steps: Step[] = []
  const conversions: StepConversions[] = []
  groups.forEach((group, index) => {
    const ctx = contextOf(group.peakYear)
    const nominalNeed = nominalNeedOf.get(group.peakYear) ?? 0
    const expectedTax = householdTaxAt(ctx, ctx.expected)
    const required = requiredHouseholdGross(ctx, nominalNeed)
    approximated ||=
      isApproximated(expectedTax) || (required !== null && isApproximated(required.taxYear))

    // 1 つの段の中の数字（要る手取り・要る世帯年収・見込みの世帯年収・見込みの手取り・換算）は、すべて段の値になった年の値にする
    // （2026-11-17 の呼び出し側の設計の決定。年をまたぐと、昇給のある計画で「見込みとの差」と換算の有無が食い違う）
    const previous = groups[index - 1]
    const step: Step = {
      fromYear: group.fromYear,
      toYear: group.toYear,
      peakYear: group.peakYear,
      requiredNet: group.requiredNet,
      requiredGross: required === null ? null : real(required.gross, group.peakYear),
      expectedGross: real(householdGross(ctx.expected), group.peakYear),
      causes:
        previous === undefined
          ? []
          : stepCauses(
              annualsOf(previous.peakYear),
              annualsOf(group.peakYear),
              defaults.steps.maxCauses.value,
              // 次の年に無い帯は、この段の年の途中で終わる（「終わる」の組に入れる。W18）。
              // 最後の年の次は帯を切ってあり、どの帯も無いので渡さない（減った帯を「終わる」と取り違えない）
              group.peakYear < lastYear ? annualsOf(group.peakYear + 1) : null,
            ),
      byGoal: realNeedOf.get(group.peakYear)?.byGoal ?? [],
    }
    steps.push(step)

    // 換算は、見込みの世帯年収では届かない段だけ（段に出す数字と同じ比べ方にして、食い違いを起こさない）。
    // 要る世帯年収が見込みを上回るなら、見込みの収入では要る手取りに届いていないので、不足の手取りは必ず正になる
    if (step.requiredGross === null || step.requiredGross > step.expectedGross) {
      const set = incomeConversions(ctx, nominalNeed, required)
      const deflate = (entry: IncomeConversion | null): IncomeConversion | null =>
        entry === null ? null : deflateConversion(entry, (amount) => real(amount, group.peakYear))
      conversions.push({
        fromYear: group.fromYear,
        shortfallNet: real(nominalNeed - expectedTax.netIncome, group.peakYear),
        mainJob: deflate(set.mainJob),
        sideJob: deflate(set.sideJob),
        otherAdult: deflate(set.otherAdult),
      })
    }
  })

  const currentGross = householdGross(expectedLevels(plan, baseYear))
  const nextStep =
    steps.find((step) => step.requiredGross === null || step.requiredGross > currentGross) ?? null

  return {
    bands,
    years,
    steps,
    currentGross,
    nextStep,
    conversions,
    notices: [
      ...collectNotices(plan, defaults, steps, years, approximated),
      ...fundNotices(
        plan,
        (goal) =>
          goal.kind === 'university' || goal.kind === 'retirement'
            ? fundPlanOf(goal, fundContext)
            : null,
        tables.nisa,
      ),
    ],
  }
}

/**
 * 段ごとの要る世帯年収だけを出す（SPEC §3.8 の目標の重さが使う）。`evaluate` の `steps[].requiredGross` と同じ値になる：
 * 帯 → 年ごとの要る手取り → 段 → 段の値になった年の額面、までを `evaluate` と同じ `prepareSteps` で通し、
 * 換算・理由・知らせは出さない（換算の探索は段ごとに 3 回あり、要る世帯年収だけなら 1 回で済む）。
 *
 * @param solve 段 1 つを解く関数。既定は `evaluate` と同じ `requiredHouseholdGross`。
 *   重さの計算は、換算の入力が同じ段の答えを使い回す関数を渡す（`impact.ts`）
 * @throws {RangeError} 計画が契約に反しているとき（`evaluate` と同じ）
 */
export function stepRequiredGross(
  plan: LifePlan,
  tables: PlanTables,
  defaults: AppDefaults,
  solve: GrossSolver = requiredHouseholdGross,
): StepGross[] {
  const { real, groups, contextOf, nominalNeedOf } = prepareSteps(plan, tables, defaults)
  return groups.map((group) => {
    const required = solve(contextOf(group.peakYear), nominalNeedOf.get(group.peakYear) ?? 0)
    return {
      fromYear: group.fromYear,
      toYear: group.toYear,
      peakYear: group.peakYear,
      requiredGross: required === null ? null : real(required.gross, group.peakYear),
    }
  })
}

/**
 * 段にまとめて、段ごとに額面を解く前までの材料（`evaluate` と `stepRequiredGross` が同じ道筋を通るために 1 つにした）。
 * 帯・年ごとの要る手取り（その年の円と、今のお金の価値）・段のまとまり・段の値の年の解く材料を返す
 */
function prepareSteps(plan: LifePlan, tables: PlanTables, defaults: AppDefaults) {
  const inflationRate = plan.assumptions.inflationRate
  if (!Number.isFinite(inflationRate) || inflationRate <= -1) {
    throw new RangeError(`物価の上がり方が正しくありません: ${inflationRate}`)
  }
  const baseYear = plan.baseYearMonth.year
  const real = (amount: Yen, year: Year): Yen => toTodayValue(amount, inflationRate, baseYear, year)

  const bands = expandPlan(plan, defaults, tables)
  const nominalYears = yearlyNeeds(bands, plan.baseYearMonth, lastNeedYear(plan))
  const years = nominalYears.map((entry) => deflateYearNeed(entry, real))
  const nominalNeedOf = new Map(nominalYears.map((entry) => [entry.year, entry.requiredNet]))
  const realNeedOf = new Map(years.map((entry) => [entry.year, entry]))

  const groups = groupSteps(years, {
    changeRatio: defaults.steps.changeRatio.value,
    changeYen: defaults.steps.changeYen.value,
    maxCauses: defaults.steps.maxCauses.value,
  })

  const taxInput = householdTaxInput(plan, defaults.taxBridge)
  const contextOf = (year: Year): SolveContext => ({
    plan,
    year,
    expected: expectedLevels(plan, year),
    taxInput,
    settings: defaults.taxBridge,
    sideMonthlyStep: defaults.search.sideMonthlyStep.value,
    tables,
  })
  return { real, bands, years, realNeedOf, groups, contextOf, nominalNeedOf }
}

/**
 * その年の円を、起点の年の価値（今のお金の価値）に割り戻す。円に四捨五入する。
 * 物価が 0 なら金額をそのまま返す
 */
export function toTodayValue(amount: Yen, inflationRate: Rate, baseYear: Year, year: Year): Yen {
  if (inflationRate === 0 || year === baseYear) {
    return amount
  }
  return roundYen(amount / Math.pow(1 + inflationRate, year - baseYear))
}

/** 年ごとの要る手取りを割り戻す。内訳を目標ごとに割り戻し、合計は割り戻した内訳の和にする（内訳と合計が合う） */
function deflateYearNeed(entry: YearNeed, real: (amount: Yen, year: Year) => Yen): YearNeed {
  const byGoal = entry.byGoal.map((goal) => ({ ...goal, annual: real(goal.annual, entry.year) }))
  return {
    year: entry.year,
    requiredNet: byGoal.reduce((total, goal) => total + goal.annual, 0),
    byGoal,
  }
}

/** 換算 1 つを割り戻す。差は割り戻した後の差にする */
function deflateConversion(entry: IncomeConversion, real: (amount: Yen) => Yen): IncomeConversion {
  const current = real(entry.current)
  const required = real(entry.required)
  return { personId: entry.personId, current, required, increase: required - current }
}

/** 国保の料率を別の自治体で概算したか */
function isApproximated(taxYear: ReturnType<typeof householdTaxAt>): boolean {
  return taxYear.nationalHealthInsurance?.approximated ?? false
}

/** 知らせを集める（SPEC §3.9。大学資金・老後資金のカードの知らせは `nisa.ts` の `fundNotices`） */
function collectNotices(
  plan: LifePlan,
  defaults: AppDefaults,
  steps: readonly Step[],
  years: readonly YearNeed[],
  approximated: boolean,
): Notice[] {
  const notices: Notice[] = []
  if (approximated) {
    notices.push({ kind: 'municipalityApproximated', municipality: plan.municipality })
  }
  for (const step of steps) {
    if (step.requiredGross === null) {
      notices.push({ kind: 'unsolvableStep', fromYear: step.fromYear, toYear: step.toYear })
    }
  }

  const soonMonths = defaults.notices.onceSoonMonths.value
  for (const goal of plan.goals) {
    if (!goal.enabled || goal.kind !== 'custom' || goal.amountType !== 'once') continue
    const monthsLeft = monthsBetween(plan.baseYearMonth, goal.at)
    if (monthsLeft <= 0) {
      notices.push({ kind: 'onceGoalPast', goalId: goal.id, name: goal.name })
    } else if (monthsLeft < soonMonths && goal.amount > goal.saved) {
      notices.push({ kind: 'onceGoalSoon', goalId: goal.id, name: goal.name, monthsLeft })
    }
  }

  notices.push(
    ...homeSavingSoonNotices(plan, defaults.home.closingCostRate.value, soonMonths),
    ...homeLoanNotices(plan, defaults.home.loanToIncomeLimit.value),
  )

  // 車を現金で買う月まで 12 か月を切り、代金が貯まり切っていない（家の homeSavingSoon と同じ考え方）。
  // ローンで買う車ともう持っている車は、買う前の積立が無いので見ない
  for (const goal of plan.goals) {
    if (!goal.enabled || goal.kind !== 'car' || goal.payment.type !== 'cash') continue
    const monthsLeft = monthsBetween(plan.baseYearMonth, carPurchaseMonth(goal))
    if (monthsLeft > 0 && monthsLeft < soonMonths && goal.price > goal.saved) {
      notices.push({ kind: 'carSavingSoon', goalId: goal.id, monthsLeft })
    }
  }

  const negativeYears = years.filter((entry) => entry.requiredNet < 0).map((entry) => entry.year)
  if (negativeYears.length > 0) {
    notices.push({ kind: 'negativeNeed', years: negativeYears })
  }
  return notices
}

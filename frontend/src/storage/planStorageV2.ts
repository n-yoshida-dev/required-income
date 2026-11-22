/**
 * 計画の保存と読み込み（SPEC §5）。
 *
 * - キーは `life-plan-simulator.plan.v2`。中身は `{ app, version: 2, plan, touched }`
 * - 起点の年月（`baseYearMonth`）は保存しない。開くたびに画面が今日から作る
 * - `touched` は利用者が直した項目の印（既定値のままの欄と見分けるため。中身の書き方は「計画」の画面（T6）が決める）
 * - 読むときに Zod で形を確かめる。壊れていたら理由を返し、見本の世帯で開くかは呼び出し側が決める
 * - 前の版の保存（`…plan.v1`・`…scenarios.v1`）は読まないし、消さない（D35）
 *
 * 保存先は引数で受け取る（テストで差し替えるため。ブラウザでは `localStorage`）。入力はどこにも送らない。
 */

import { z } from 'zod'
import type { Goal, LifePlan, Month } from '../domain/plan/types'

/** localStorage のキー。形を変えて古い保存を読めなくなるときは末尾の版を上げる */
export const PLAN_STORAGE_V2_KEY = 'life-plan-simulator.plan.v2'

/** 入れ物の `app` の値。ほかのアプリの保存と取り違えないため */
const APP_NAME = 'life-plan-simulator'

/** 入れ物の形の版 */
const FORMAT_VERSION = 2

/** 保存先の最小限の契約。ブラウザの `localStorage` がこれを満たす */
export type PlanStorageV2 = Pick<Storage, 'getItem' | 'setItem'>

/** 保存を消すときに要る保存先の契約（見本の世帯に戻すとき。SPEC §4.2）。ブラウザの `localStorage` がこれを満たす */
export type PlanStorageV2Remover = Pick<Storage, 'removeItem'>

/** 保存する計画。起点の年月を除いた `LifePlan` */
export type StoredPlan = Omit<LifePlan, 'baseYearMonth'>

/** 読んだ結果。無い・読めた・壊れていた、を分けて返す */
export type LoadPlanResult =
  | { kind: 'empty' }
  | { kind: 'loaded'; plan: StoredPlan; touched: string[] }
  | { kind: 'broken'; reason: string }

// ---------------------------------------------------------------------------
// 形（Zod）。domain の型に合わない保存は、ここで止める
// ---------------------------------------------------------------------------

const yen = z.number().int().nonnegative()
const rate = z.number().finite()
const year = z.number().int()
const month = z
  .number()
  .int()
  .min(1)
  .max(12)
  .transform((value) => value as Month)
const yearMonth = z.object({ year, month })

const adult = z.object({
  id: z.string().min(1),
  birthYear: year,
  workStyle: z.enum(['employee', 'selfEmployed', 'notWorking']),
  annualIncome: yen,
  raiseRate: rate,
  outlookSteps: z.array(z.object({ year, annualIncome: yen })),
  sideMonthlyProfit: yen,
  retirementAge: z.number().int().nonnegative(),
})

const child = z.object({ id: z.string().min(1), birthYear: year, birthMonth: month })

const goalBase = { id: z.string().min(1), enabled: z.boolean() }
const savingGoalBase = { ...goalBase, saved: yen }
const schoolType = z.enum(['public', 'private'])

const universityGoal = z.object({
  ...savingGoalBase,
  kind: z.literal('university'),
  childId: z.string().min(1),
  // 進路（D37）。T10 のころの保存には無いので任意。無ければ「選んでいない」で開き、目標額は保存のまま
  course: z.enum(['privateScience', 'privateHumanities', 'nationalPublic']).optional(),
  targetAmount: yen,
  allocateChildAllowance: z.boolean(),
  vehicle: z.enum(['childNisa', 'deposit']),
})

const retirementGoal = z.object({
  ...savingGoalBase,
  kind: z.literal('retirement'),
  targetAmount: yen,
  byYear: year,
  vehicle: z.enum(['nisa', 'deposit']),
})

const homeGoal = z.object({
  ...savingGoalBase,
  kind: z.literal('home'),
  purchaseYear: year,
  price: yen,
  downPayment: yen,
  loanYears: z.number().int().nonnegative(),
  monthlyUpkeep: yen,
})

const carGoal = z.object({
  ...savingGoalBase,
  kind: z.literal('car'),
  purchaseYear: year,
  price: yen,
  payment: z.union([
    z.object({ type: z.literal('cash') }),
    z.object({ type: z.literal('loan'), years: z.number().int().positive() }),
  ]),
  monthlyUpkeep: yen,
  replaceEveryYears: z.number().int().positive().nullable(),
})

const childCostGoal = z.object({
  ...goalBase,
  kind: z.literal('childCost'),
  childId: z.string().min(1),
  schools: z.object({ elementary: schoolType, juniorHigh: schoolType, highSchool: schoolType }),
  cramSchools: z.array(
    z.object({ fromGrade: z.number().int(), toGrade: z.number().int(), monthly: yen }),
  ),
  lessonsMonthly: yen.nullable(),
  childcareMonthly: yen.nullable(),
})

const customBase = { ...goalBase, kind: z.literal('custom'), name: z.string() }

const customMonthlyGoal = z.object({
  ...customBase,
  amountType: z.literal('monthly'),
  direction: z.enum(['expense', 'income']),
  amount: yen,
  from: yearMonth,
  to: yearMonth,
})

const customOnceGoal = z.object({
  ...customBase,
  amountType: z.literal('once'),
  direction: z.literal('expense'),
  amount: yen,
  at: yearMonth,
  saved: yen,
})

const goal: z.ZodType<Goal> = z.union([
  universityGoal,
  retirementGoal,
  homeGoal,
  carGoal,
  childCostGoal,
  customMonthlyGoal,
  customOnceGoal,
])

const storedPlan: z.ZodType<StoredPlan> = z.object({
  adults: z.array(adult).min(1).max(2),
  children: z.array(child),
  municipality: z.string().min(1),
  living: z.object({ monthlyLivingCost: yen, monthlyRent: yen }),
  goals: z.array(goal),
  assumptions: z.object({
    investmentReturnRate: rate,
    inflationRate: rate,
    mortgageRate: rate,
  }),
})

const planFile = z.object({
  app: z.literal(APP_NAME),
  version: z.literal(FORMAT_VERSION),
  plan: storedPlan,
  touched: z.array(z.string()),
})

// ---------------------------------------------------------------------------
// 読み書き
// ---------------------------------------------------------------------------

/**
 * 計画を保存する。`LifePlan` をそのまま渡してよく、起点の年月は書かない（保存する項目だけを選んで書く）。
 * 直した項目の印は重ねずに並べ替えて持つ。容量超過などで書けなければ false（呼び出し側が利用者に知らせる）
 */
export function savePlanV2(
  plan: StoredPlan,
  touched: readonly string[],
  storage: PlanStorageV2,
): boolean {
  const stored: StoredPlan = {
    adults: plan.adults,
    children: plan.children,
    municipality: plan.municipality,
    living: plan.living,
    goals: plan.goals,
    assumptions: plan.assumptions,
  }
  const file = {
    app: APP_NAME,
    version: FORMAT_VERSION,
    plan: stored,
    touched: [...new Set(touched)].sort(),
  }
  try {
    storage.setItem(PLAN_STORAGE_V2_KEY, JSON.stringify(file))
    return true
  } catch (error) {
    console.error('計画をブラウザに保存できませんでした', error)
    return false
  }
}

/**
 * 保存した計画を消す（見本の世帯に戻すとき）。このキーだけを消し、前の版の保存（`…v1`）には触らない（D35）。
 * 保存先が投げて消せなければ false（呼び出し側が利用者に知らせる。`savePlanV2` と同じ返し方）
 */
export function clearPlanV2(storage: PlanStorageV2Remover): boolean {
  try {
    storage.removeItem(PLAN_STORAGE_V2_KEY)
    return true
  } catch (error) {
    console.error('ブラウザに保存した計画を消せませんでした', error)
    return false
  }
}

/** 保存した計画を読む。無ければ empty、形が合わなければ broken と理由を返す */
export function loadPlanV2(storage: PlanStorageV2): LoadPlanResult {
  let raw: string | null
  try {
    raw = storage.getItem(PLAN_STORAGE_V2_KEY)
  } catch (error) {
    console.error('保存した計画を読めませんでした', error)
    return { kind: 'broken', reason: 'ブラウザの保存を読めませんでした' }
  }
  if (raw === null) return { kind: 'empty' }

  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return { kind: 'broken', reason: '保存の中身を JSON として読めませんでした' }
  }

  const parsed = planFile.safeParse(json)
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const where = first && first.path.length > 0 ? `（${first.path.join('.')}）` : ''
    return { kind: 'broken', reason: `保存の形が合いません${where}` }
  }
  return { kind: 'loaded', plan: parsed.data.plan, touched: parsed.data.touched }
}

/**
 * 目標の重さ（SPEC §3.8）。カードのオン・オフを 1 枚ずつ入れ替えて計算し直し、**いちばん高い段の要る世帯年収がいくら変わるか**を出す。
 *
 * - オンのカードは外したとき（`remove`）、オフのカードは入れたとき（`add`）の差を出す（「外すと −◯万円」と「入れると +◯万円」が対になる）
 * - 計算し直しは `evaluate` と同じ道筋（`stepRequiredGross`）。カードを外すのは `enabled: false` にするだけで、ほかは何も変えない。
 *   回していた児童手当が子の費用のカードに戻る・大学資金のカードの有無で子の扶養の期間が変わる、なども計算し直せば自然に入る
 * - いちばん高い段が解けない・段が無いときは、差を数字にせず `unavailable` を返す（例外にしない）
 *
 * **使い回し**：額面への換算（段 1 つを解く `requiredHouseholdGross`）の答えは、換算の入力が全部同じときだけ使い回す。
 * 鍵は換算の入力そのもの（段の値の年・その年の円の要る手取り・人ごとの見込みの収入・大人・税の入口に渡す世帯の設定（子の進路と大学の有無・自治体を含む））。
 * 段の番号は鍵にしない（目標を外すと段の切れ目が動くため）。表と既定値は 1 つの計算の中で同じ物を使うので鍵に入れない。
 */

import { stepRequiredGross } from './evaluate'
import {
  requiredHouseholdGross,
  type GrossSolver,
  type RequiredGrossResult,
} from './requiredIncome'
import type {
  AppDefaults,
  GoalId,
  GoalImpact,
  LifePlan,
  PeakGross,
  PlanTables,
  SolveContext,
  StepGross,
  Yen,
} from './types'

/** 重さの計算の使い回しの設定 */
export type ImpactOptions = {
  /** 換算の答えを使い回すか（既定 true）。false にすると毎回解き直す（使い回しが答えを変えないことを確かめるテスト用） */
  reuse?: boolean
}

/** 目標の重さを 1 枚ずつ出す計算機。同じ計画の中では換算の答えを使い回す */
export type ImpactCalculator = {
  /** 今の計画のいちばん高い段 */
  base: () => PeakGross
  /**
   * カード 1 枚の重さ。
   * @throws {RangeError} 計画に無いカード、またはオン・オフを入れ替えた計画が契約に反するとき
   */
  impactOf: (goalId: GoalId) => GoalImpact
}

/**
 * 計画 1 つに対する重さの計算機を作る。今の計画は最初に `base` か `impactOf` を呼んだときに 1 回だけ解く。
 * 画面は、カードごとに `impactOf` を分けて呼べる（入力の反応を止めないため、間で手を離せる）
 */
export function impactCalculator(
  plan: LifePlan,
  tables: PlanTables,
  defaults: AppDefaults,
  options: ImpactOptions = {},
): ImpactCalculator {
  const solve = options.reuse === false ? requiredHouseholdGross : reusingSolver()
  let base: PeakGross | null = null
  const baseOf = (): PeakGross => {
    base ??= peakGross(stepRequiredGross(plan, tables, defaults, solve))
    return base
  }
  return {
    base: baseOf,
    impactOf: (goalId) => {
      const goal = plan.goals.find((entry) => entry.id === goalId)
      if (goal === undefined) {
        throw new RangeError(`計画にカードがありません: ${goalId}`)
      }
      const current = baseOf()
      const toggledPlan: LifePlan = {
        ...plan,
        goals: plan.goals.map((entry) =>
          entry.id === goalId ? { ...entry, enabled: !entry.enabled } : entry,
        ),
      }
      const toggled = peakGross(stepRequiredGross(toggledPlan, tables, defaults, solve))
      return {
        goalId,
        action: goal.enabled ? 'remove' : 'add',
        current,
        toggled,
        outcome: outcomeOf(current, toggled),
      }
    },
  }
}

/** 計画のすべてのカードの重さ（カードの並び順）。まとめて出すとき・テスト用 */
export function goalImpacts(
  plan: LifePlan,
  tables: PlanTables,
  defaults: AppDefaults,
  options: ImpactOptions = {},
): GoalImpact[] {
  const calculator = impactCalculator(plan, tables, defaults, options)
  return plan.goals.map((goal) => calculator.impactOf(goal.id))
}

/**
 * いちばん高い段の要る世帯年収。段が無ければ `noSteps`、どれかの段が解けなければ `unsolvable`
 * （解けない段はどの金額より高いとみなす。`evaluate` の「次の段」と同じ扱い）
 */
export function peakGross(steps: readonly Pick<StepGross, 'requiredGross'>[]): PeakGross {
  if (steps.length === 0) return { kind: 'noSteps' }
  let top = -Infinity
  for (const step of steps) {
    if (step.requiredGross === null) return { kind: 'unsolvable' }
    top = Math.max(top, step.requiredGross)
  }
  return { kind: 'solved', gross: top }
}

/** 差の向き。両方解けたときだけ数字にする */
function outcomeOf(current: PeakGross, toggled: PeakGross): GoalImpact['outcome'] {
  if (current.kind !== 'solved' || toggled.kind !== 'solved') return { kind: 'unavailable' }
  const change: Yen = toggled.gross - current.gross
  return {
    kind: 'change',
    change,
    direction: change < 0 ? 'down' : change > 0 ? 'up' : 'same',
  }
}

/**
 * 換算の入力が全部同じ段の答えを使い回す `requiredHouseholdGross`（SPEC §3.8）。
 * 答えは `requiredHouseholdGross` を呼んだときと同じ（鍵が同じなら、解く関数が読む物が全部同じため）
 */
function reusingSolver(): GrossSolver {
  const cache = new Map<string, RequiredGrossResult | null>()
  return (ctx, targetNet) => {
    const key = solveKey(ctx, targetNet)
    if (cache.has(key)) {
      return cache.get(key) ?? null
    }
    const answer = requiredHouseholdGross(ctx, targetNet)
    cache.set(key, answer)
    return answer
  }
}

/**
 * 使い回しの鍵。`requiredHouseholdGross` が読む物のうち、計画で変わりうる物を全部入れる：
 * 段の値の年・その年の円の要る手取り・人ごとの見込みの収入（本業と副業）・大人（働き方・生まれ年・退職の年齢。動かす人を決める）・
 * 税の入口に渡す世帯の設定（子の進路と大学の有無・自治体・扶養など）。既定値と表は同じ計算機の中で変わらない
 */
function solveKey(ctx: SolveContext, targetNet: Yen): string {
  return JSON.stringify([
    ctx.year,
    targetNet,
    [...ctx.expected.entries()],
    ctx.plan.adults,
    ctx.taxInput,
  ])
}

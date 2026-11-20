/**
 * 開いたときの計画を決めて、計算する（SPEC §4.1・§5）。React に依存しない形にして、単体テストで確かめる。
 *
 * - 保存があれば、その計画に今日の年月を起点として足す（起点は保存しない）。直していない住宅ローン金利は今の既定値に合わせる
 * - 保存が無ければ見本の世帯。壊れていても、今の版で計算できなくても、保存を消さずに見本の世帯で開き、そのことを知らせる
 * - `evaluate` が契約違反で投げる `RangeError` は受け止めて、画面に出す理由にする。ほかの例外は投げ直す
 */

import { appDefaults, planTables, sampleHousehold } from '../data/appData'
import { sampleLifePlan, syncChildCostGoals } from '../domain/plan/defaults'
import { evaluate } from '../domain/plan/evaluate'
import type { Evaluation, LifePlan, YearMonth } from '../domain/plan/types'
import { yearMonth } from '../domain/plan/yearMonth'
import { loadPlanV2, savePlanV2, type PlanStorageV2 } from '../storage/planStorageV2'

/** 開いた計画。どこから来たかと、保存を読めなかった理由（あれば）を持つ */
export type PlanSession = {
  plan: LifePlan
  /**
   * `sample`：見本の世帯のまま／`saved`：利用者の計画（保存から開いた、または「自分の数字にする」で始めた）。
   * 端末に書けなかったときも `saved` のままにし、書けなかったことは画面が別に知らせる
   */
  origin: 'sample' | 'saved'
  /** 直した項目の印（保存から読んだ物。見本なら空） */
  touched: string[]
  /** 保存があったのに見本で開いたときの訳。それ以外は null */
  storageProblem: StorageProblem | null
}

/**
 * 保存があったのに見本で開いた訳。
 * `unreadable`：保存を読めなかった（壊れている・形が合わない）／`unsupported`：読めたが今の版で計算できなかった
 */
export type StorageProblem = { kind: 'unreadable' | 'unsupported'; reason: string }

/** 計算の結果。契約違反で計算できなかったときは理由を持つ */
export type EvaluationResult = { ok: true; evaluation: Evaluation } | { ok: false; message: string }

/**
 * 「見直す」の案を今の計画にした結果（SPEC §4.3「この案にする」）。
 * 今の計画にできたら、端末に保存できたか（`saved`）。できなかったら理由（欄をまたぐ問題・計算できない）
 */
export type AdoptResult = { ok: true; saved: boolean } | { ok: false; message: string }

/** 端末の今日の日付から、計算の起点の年月を作る（domain は現在時刻を読まないため、画面がここで作る） */
export function todayYearMonth(now: Date): YearMonth {
  return yearMonth(now.getFullYear(), now.getMonth() + 1)
}

/**
 * ブラウザの保存先。`localStorage` に触るだけで投げるブラウザ（保存を禁じた設定など）では、
 * 読むたびにその例外を投げる保存先を返し、`loadPlanV2` が「読めなかった」として扱う（握りつぶさない）
 */
export function browserStorage(): PlanStorageV2 {
  try {
    return window.localStorage
  } catch (error) {
    const fail = (): never => {
      throw error
    }
    return { getItem: fail, setItem: fail }
  }
}

/** 保存を読んで、開く計画を決める */
export function openPlanSession(storage: PlanStorageV2, today: YearMonth): PlanSession {
  const loaded = loadPlanV2(storage)
  if (loaded.kind === 'loaded') {
    const plan = withChildCostGoals(
      withCurrentMortgageDefault({ ...loaded.plan, baseYearMonth: today }, loaded.touched),
    )
    return {
      plan,
      origin: 'saved',
      touched: loaded.touched,
      storageProblem: null,
    }
  }
  return sampleSession(
    today,
    loaded.kind === 'broken' ? { kind: 'unreadable', reason: loaded.reason } : null,
  )
}

/** 住宅ローン金利の欄の直した印（`features/plan/touched.ts` の書き方） */
const MORTGAGE_RATE_KEY = 'assumptions.mortgageRate'

/**
 * 直していない（印の無い）住宅ローン金利を、今の既定値に合わせる。
 * 既定値はフラット35 の金利で毎月変わる（`data/housing/flat35-rate.json`）。保存は値そのものを持つので、
 * 合わせないと前の月の既定値が「既定値のまま」の見た目で残り、欄の下の「既定：…」と食い違う。
 * 印があれば本人が入れた値なので、保存の値のまま。毎月変わる既定はこの欄だけなので、ほかの欄には広げない
 */
export function withCurrentMortgageDefault(plan: LifePlan, touched: readonly string[]): LifePlan {
  if (touched.includes(MORTGAGE_RATE_KEY)) return plan
  return {
    ...plan,
    assumptions: {
      ...plan.assumptions,
      mortgageRate: appDefaults.assumptions.mortgageRate.value,
    },
  }
}

/**
 * 子の費用のカードを子と揃える（子ごとに 1 枚。SPEC §2.1）。
 * T9 より前の保存には子の費用のカードが無いので、開いたときに子の数だけ雛形のカードを足す（保存は次に直したときに書く）
 */
export function withChildCostGoals(plan: LifePlan): LifePlan {
  const goals = syncChildCostGoals(plan, appDefaults)
  return goals === plan.goals ? plan : { ...plan, goals }
}

/**
 * 保存を読んで開き、計算まで済ませる。画面の入口が使う。
 *
 * 保存から開いた計画が計算できないとき（契約違反、まだ帯にできない種類のカードなど。例外の種類を問わない）は、
 * 保存を消さずに見本の世帯で開き直し、「今の版で開けなかった」ことと理由を持たせる（握りつぶさず画面に出す）。
 * 見本そのものの計算は `evaluatePlan` のまま（RangeError でない例外は投げる。開発中に気づくため）
 */
export function openAndEvaluate(
  storage: PlanStorageV2,
  today: YearMonth,
): { session: PlanSession; result: EvaluationResult } {
  const session = openPlanSession(storage, today)
  if (session.origin === 'saved') {
    try {
      return {
        session,
        result: { ok: true, evaluation: evaluate(session.plan, planTables, appDefaults) },
      }
    } catch (error) {
      console.error('保存した計画を今の版で計算できませんでした', error)
      const reason = error instanceof Error ? error.message : String(error)
      const fallback = sampleSession(today, { kind: 'unsupported', reason })
      return { session: fallback, result: evaluatePlan(fallback.plan) }
    }
  }
  return { session, result: evaluatePlan(session.plan) }
}

/** 見本の世帯で開く */
function sampleSession(today: YearMonth, storageProblem: StorageProblem | null): PlanSession {
  return {
    plan: sampleLifePlan(appDefaults, sampleHousehold, today),
    origin: 'sample',
    touched: [],
    storageProblem,
  }
}

/**
 * 見本の世帯から、自分の計画を始める（SPEC §4.1「自分の数字にする」）。
 *
 * 目標カードは空にして始める（見本のカードを持ち込まない。見本の数字と自分の数字が混ざらないように。
 * 見本に家・車などのカードが増えても外し漏れないよう、見本のカードを選り分けずに全部外す）。
 * ただし子の費用のカードは子ごとに付く物なので、家族に子がいれば、その子の雛形のカード（すべて公立・塾なし）を付ける。
 * 家族・暮らし・前提は見本の値を残し、直した欄の印は空（すべて既定値のまま）にする
 */
export function startOwnPlan(session: PlanSession): PlanSession {
  // 子の費用のカードは子ごとに付く（SPEC §2.1）ので、見本のカードを外したあと、子の数だけ雛形のカードを付け直す
  const children = session.plan.children
  return {
    plan: { ...session.plan, goals: syncChildCostGoals({ children, goals: [] }, appDefaults) },
    origin: 'saved',
    touched: [],
    storageProblem: null,
  }
}

/**
 * 直した計画を、確かめて・計算して・保存する（SPEC §4.2「直すたびに保存し、階段を計算し直す」）。
 *
 * - 計算できない（契約違反）ときは保存しない。理由を返し、画面が出す（保存の前に止める）
 * - 計算できたら保存する。端末に書けなかったら `saved: false`（画面が知らせる。計算の結果は使う）
 *
 * 欄をまたぐ問題（`features/plan/planIssues.ts`）は、呼ぶ前に画面が確かめる
 */
export function commitPlan(
  plan: LifePlan,
  touched: readonly string[],
  storage: PlanStorageV2,
): { ok: true; evaluation: Evaluation; saved: boolean } | { ok: false; message: string } {
  const result = evaluatePlan(plan)
  if (!result.ok) return result
  return { ok: true, evaluation: result.evaluation, saved: savePlanV2(plan, touched, storage) }
}

/**
 * 計画を計算する。入力が契約に反している（年が逆、金額が負など）ときは、投げずに理由を返す。
 * 利用者が直せるように画面に出すため。それ以外の例外はプログラムの不具合なので投げ直す
 */
export function evaluatePlan(plan: LifePlan): EvaluationResult {
  try {
    return { ok: true, evaluation: evaluate(plan, planTables, appDefaults) }
  } catch (error) {
    if (error instanceof RangeError) {
      console.error('計画を計算できませんでした', error)
      return { ok: false, message: error.message }
    }
    throw error
  }
}

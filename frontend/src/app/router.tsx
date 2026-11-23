/**
 * 画面の切り替え（SPEC §1・§4）。HashRouter で 3 つの画面を持ち、下に 3 つのタブを置く。
 *
 * - `/#/` ながめる（開いたら最初に出る）／`/#/plan/<区分>` 計画（家族・収入・暮らし・目標。T21）／`/#/review` 見直す
 * - `/#/plan` は「再開する区分」（案内の途中なら済んでいない最初の区分、それ以外は家族）へ置き換える。知らない区分名は家族へ
 * - HashRouter にするのは、vite の `base` が `'./'` で GitHub Pages に置くため（パスのルーターだと再読み込みで 404 になる）
 * - 計画はここで持つ。開いたときに保存から読んで計算し、「計画」で直すたびに確かめて・計算して・保存する（SPEC §4.2）。
 *   「ながめる」は最後に計算できた計画を出す。案内の進み具合（`guide`）も計画と一緒に持ち、保存する（SPEC §5）
 */

import { useState, type ReactNode } from 'react'
import {
  HashRouter,
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from 'react-router'
import { peakGross } from '../domain/plan/impact'
import type { LifePlan } from '../domain/plan/types'
import { HomePage } from '../features/home/HomePage'
import {
  isPlanSection,
  markDone,
  resumeSection,
  type Guide,
  type PlanSectionId,
} from '../features/plan/guide'
import { PlanPage } from '../features/plan/PlanPage'
import { planIssues } from '../features/plan/planIssues'
import { ReviewPage } from '../features/review/ReviewPage'
import {
  browserStorage,
  type AdoptResult,
  commitPlan,
  openAndEvaluate,
  returnToSample,
  saveGuide,
  startOwnPlan,
  todayYearMonth,
  type EvaluationResult,
  type PlanSession,
} from './planSession'

/** 下のタブ。並びは SPEC §4 の 3 画面の順。絵は線だけ（色は字と同じ。DESIGN.md「下のタブ」） */
const TABS = [
  { to: '/', label: 'ながめる', icon: <path d="M3 19h5v-5h5V9h5V4h3" /> },
  { to: '/plan', label: '計画', icon: <path d="M4 5h16v5H4zM4 14h16v5H4z" /> },
  {
    to: '/review',
    label: '見直す',
    icon: (
      <>
        <path d="M4 8h3m5 0h8M4 16h9m5 0h2" />
        <circle cx="9.5" cy="8" r="2.5" />
        <circle cx="15.5" cy="16" r="2.5" />
      </>
    ),
  },
] as const

/** 画面が持つ計画の状態 */
type AppState = {
  /** 最後に計算できた計画（「ながめる」が出す。保存した物と同じ） */
  session: PlanSession
  result: EvaluationResult
  /** 「計画」に出している入力（問題があれば session より新しい） */
  draft: { plan: LifePlan; touched: string[] }
  /** 入力を計算できなかった理由（保存していない） */
  commitError: string | null
  /** 最後に保存しようとして端末に書けなかった */
  saveFailed: boolean
}

/** アプリの入口。保存を読み、計算して、画面を切り替える */
export function AppRouter() {
  const [storage] = useState(browserStorage)
  const [state, setState] = useState<AppState>(() => {
    const { session, result } = openAndEvaluate(storage, todayYearMonth(new Date()))
    return {
      session,
      result,
      draft: { plan: session.plan, touched: session.touched },
      commitError: null,
      saveFailed: false,
    }
  })

  /**
   * 直した計画を受け取る。欄をまたぐ問題があれば入力だけを持ち、保存も計算もしない。
   * 無ければ計算し、計算できたら保存する（`commitPlan`）
   */
  const edit = (plan: LifePlan, touched: string[], base: PlanSession = state.session) => {
    const draft = { plan, touched }
    if (planIssues(plan).size > 0) {
      setState((current) => ({ ...current, draft, commitError: null }))
      return
    }
    const committed = commitPlan(plan, touched, storage, base.guide)
    if (!committed.ok) {
      setState((current) => ({ ...current, draft, commitError: committed.message }))
      return
    }
    setState({
      session: { ...base, plan, touched, origin: 'saved', storageProblem: null },
      result: { ok: true, evaluation: committed.evaluation },
      draft,
      commitError: null,
      saveFailed: !committed.saved,
    })
  }

  /**
   * 「見直す」の案を今の計画にする（SPEC §4.3「この案にする」）。「計画」で直したときと同じく、確かめて・計算して・保存する。
   * 欄をまたぐ問題がある・計算できない案は今の計画にせず、理由を返す（「見直す」が出す）
   */
  const adopt = (plan: LifePlan, touched: string[]): AdoptResult => {
    const [issue] = planIssues(plan).values()
    if (issue !== undefined) return { ok: false, message: issue }
    const committed = commitPlan(plan, touched, storage, state.session.guide)
    if (!committed.ok) return committed
    setState((current) => ({
      session: { ...current.session, plan, touched, origin: 'saved', storageProblem: null },
      result: { ok: true, evaluation: committed.evaluation },
      draft: { plan, touched },
      commitError: null,
      saveFailed: !committed.saved,
    }))
    return { ok: true, saved: committed.saved }
  }

  /** 見本の世帯から自分の計画を始め、すぐ保存する（保存できたら「見本」の印が消える） */
  const startOwn = () => {
    const own = startOwnPlan(state.session)
    edit(own.plan, own.touched, own)
  }

  /**
   * 自分の計画の保存を消して、はじめて開いたときと同じ見本の世帯に戻す（SPEC §4.2「見本の世帯に戻す」）。
   * 保存を消せなかったら何も変えずに false を返す（「計画」が知らせる）
   */
  const backToSample = (): boolean => {
    const returned = returnToSample(storage, todayYearMonth(new Date()))
    if (!returned.ok) return false
    setState({
      session: returned.session,
      result: returned.result,
      draft: { plan: returned.session.plan, touched: returned.session.touched },
      commitError: null,
      saveFailed: false,
    })
    return true
  }

  /**
   * 案内の進み具合を変えて保存する（T21）。計画と印は最後に保存した物のまま書き直す。
   * 案内のあいだでなければ何もしない。端末に書けなければ、ほかの保存と同じく知らせる
   */
  const changeGuide = (next: (guide: Guide) => Guide | null) => {
    const guide = state.session.guide
    if (guide === null) return
    const changed = next(guide)
    const saved = saveGuide(state.session, changed, storage)
    setState((current) => ({
      ...current,
      session: { ...current.session, guide: changed },
      saveFailed: !saved,
    }))
  }

  const issues = planIssues(state.draft.plan)

  /** 計画の 1 つの区分のページ。知らない区分名は家族へ置き換える */
  const planPage = (section: PlanSectionId): ReactNode => (
    <PlanPage
      section={section}
      guide={state.session.guide}
      plan={state.draft.plan}
      evaluatedPlan={state.session.plan}
      peak={state.result.ok ? peakGross(state.result.evaluation.steps) : null}
      touched={state.draft.touched}
      issues={issues}
      origin={state.session.origin}
      storageProblem={state.session.storageProblem}
      notices={state.result.ok ? state.result.evaluation.notices : []}
      commitError={state.commitError}
      saveFailed={state.saveFailed}
      onEdit={(plan, touched) => edit(plan, touched)}
      onStartOwn={startOwn}
      onBackToSample={backToSample}
      onAdvance={(done) => changeGuide((guide) => markDone(guide, done))}
      onFinish={() => changeGuide(() => null)}
    />
  )

  return (
    <HashRouter>
      <div className="app">
        <main className="app__main">
          <Routes>
            <Route
              path="/"
              element={
                <HomePage session={state.session} result={state.result} onStartOwn={startOwn} />
              }
            />
            <Route path="/plan" element={<PlanResume guide={state.session.guide} />} />
            <Route path="/plan/:section" element={<PlanSectionRoute render={planPage} />} />
            <Route
              path="/review"
              element={
                <ReviewPage
                  session={state.session}
                  result={state.result}
                  onAdopt={adopt}
                  onStartOwn={startOwn}
                />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <nav className="tabs" aria-label="画面">
          {/* 「計画」は /plan/... のどこにいても「今いる」にする（end は「ながめる」だけ） */}
          {TABS.map((tab) => (
            <NavLink key={tab.to} to={tab.to} end={tab.to === '/'} className="tabs__link">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {tab.icon}
              </svg>
              {tab.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </HashRouter>
  )
}

/**
 * `/#/plan` を開いたとき、再開する区分へ置き換える（ブラウザの戻るで `/#/plan` に戻らないよう replace）。
 * 前の版のリンク（`/plan?goal=<id>`）は目標の区分へ、`?goal` を付けたまま送る
 */
function PlanResume({ guide }: { guide: Guide | null }) {
  const [searchParams] = useSearchParams()
  const search = searchParams.toString()
  const section = searchParams.has('goal') ? 'goals' : resumeSection(guide)
  return (
    <Navigate
      to={{ pathname: `/plan/${section}`, search: search === '' ? '' : `?${search}` }}
      replace
    />
  )
}

/** `/#/plan/<区分>` の区分の名前を読み、知っている名前ならそのページを描く。知らない名前は家族へ置き換える */
function PlanSectionRoute({ render }: { render: (section: PlanSectionId) => ReactNode }) {
  const { section } = useParams()
  if (section === undefined || !isPlanSection(section)) {
    return <Navigate to="/plan/family" replace />
  }
  return render(section)
}

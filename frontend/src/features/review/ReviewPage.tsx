/**
 * 見直す（`/#/review`。SPEC §4.3）。今の計画の写し（案）を作り、その上で目標を外す・ずらす・副業を足す、を試す。
 *
 * - 案はこの画面の中だけで持つ。「この案にする」を押すまで保存しない。ほかのタブへ移る・再読み込みすると、画面ごと消えて捨てられる
 * - 動かすたびに案を計算し直し（`evaluate`）、階段と数字がその場で変わる。計算は `useDeferredValue` で後に回し、押す操作の反応を止めない
 * - 上に留める所：数字 2 つ（次の段・いちばん高い段）・階段（今の計画の薄い線と案）・「元に戻す」「この案にする」。
 *   下の欄を動かしている間も見える。高さは状態で伸び縮みしない（押した欄の位置が動かない）。段の内訳・知らせ・結果の知らせは流れる所に出す
 * - 見本の世帯のままなら、動かして試せるが保存はできないので、「この案にする」の代わりに「自分の数字にする」を出す
 * - 自分の計画で、入力の途中か、自分で足した目標がまだ無いときは、案を作らず「ながめる」と同じ 1 文とボタン 1 つだけ（`homeStart.ts`）
 * - アプリはどれかを勧めない（D31）。動かした結果を見せるだけ
 */

import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import {
  evaluatePlan,
  type AdoptResult,
  type EvaluationResult,
  type PlanSession,
} from '../../app/planSession'
import type { LifePlan } from '../../domain/plan/types'
import { homeStart } from '../home/homeStart'
import { HomeStartPanel } from '../home/HomeStartPanel'
import { StepBreakdown } from '../home/StepBreakdown'
import { noticeLines } from '../home/noticeText'
import { manNumber } from '../shared/format'
import { ownerNames } from '../shared/goalNames'
import { StairsChart } from '../shared/StairsChart'
import { StartOwnButton, StorageProblemAlert } from '../shared/StartOwn'
import { ReviewControls } from './ReviewControls'
import { reviewChanges, reviewTouched } from './reviewDraft'
import { reviewSummary, type SummaryRow, type StepView } from './reviewSummary'

type Props = {
  /** 今の計画（最後に計算できて保存した物） */
  session: PlanSession
  /** 今の計画の計算の結果 */
  result: EvaluationResult
  /** 案を今の計画にする（確かめて・計算して・保存する） */
  onAdopt: (plan: LifePlan, touched: string[]) => AdoptResult
  /** 見本の世帯から自分の計画を始める（押したら「計画」へ移る） */
  onStartOwn: () => void
}

/**
 * 見直すの画面。自分の計画で、入力の途中か、自分で足した目標がまだ無いときは、案を作らずに今やること 1 つだけを出す
 * （「ながめる」と同じ決め方。見本の値が残った途中の計画の数字を、答えのように見せないため。D49 と同じ理由）
 */
export function ReviewPage(props: Props) {
  const { session, result } = props
  // 計算できない計画は、先に誤りを知らせる（「ながめる」と同じ）
  const start = result.ok ? homeStart(session.origin, session.plan.goals, session.guide) : null
  if (start === null) return <ReviewBoard {...props} />
  return (
    <div className="review">
      <h1 className="visually-hidden">見直す</h1>
      <StorageProblemAlert className="review__alert" storageProblem={session.storageProblem} />
      <HomeStartPanel start={start} />
    </div>
  )
}

/** 案を動かして試す所（数字・階段・動かす欄） */
function ReviewBoard({ session, result, onAdopt, onStartOwn }: Props) {
  const navigate = useNavigate()
  const base = session.plan
  const [draft, setDraft] = useState<LifePlan>(base)
  // 「この案にする」を押した結果。案を動かしたら消す
  const [outcome, setOutcome] = useState<AdoptResult | null>(null)
  // 内訳を出している段（段の始まりの年で覚える。案を動かして段が変わったら閉じる）
  const [selectedYear, setSelectedYear] = useState<number | null>(null)
  const headRef = usePinnedHead()

  // 計算は後に回す（押した直後は前の案の階段のまま描き、計算が済んだら描き直す）
  const deferred = useDeferredValue(draft)
  const draftResult = useMemo(
    () => (deferred === base ? result : evaluateDraft(deferred)),
    [deferred, base, result],
  )
  const names = useMemo(() => ownerNames(draft), [draft])
  const changed = reviewChanges(base, draft).length > 0
  const isSample = session.origin === 'sample'
  // 今の計画にした直後（案が今の計画と同じあいだ）は、押したボタンの所に結果を出す（留めた所の高さを変えない）
  const adopted = outcome?.ok === true && !changed

  /** 案を動かす */
  const update = (next: LifePlan) => {
    setDraft(next)
    setOutcome(null)
  }

  /** 案を今の計画に戻す */
  const reset = () => {
    setDraft(base)
    setOutcome(null)
  }

  /** 案を今の計画にする（動かした欄に直した印を付けて渡す） */
  const adopt = () => {
    setOutcome(onAdopt(draft, reviewTouched(base, draft, session.touched)))
  }

  const steps = draftResult.ok ? draftResult.evaluation.steps : []
  const selectedIndex = steps.findIndex((step) => step.fromYear === selectedYear)
  const selectedStep = steps[selectedIndex]
  // 図の場所に出す理由（計算できない・段が無いときも、図と同じ高さの場所に出す）
  const plotMessage = !result.ok
    ? `今の計画を計算できません：${result.message}`
    : !draftResult.ok
      ? `この案は計算できません：${draftResult.message}`
      : steps.length === 0
        ? '階段に出す年が無い'
        : null

  return (
    <div className="review">
      <h1 className="visually-hidden">見直す</h1>

      <StorageProblemAlert className="review__alert" storageProblem={session.storageProblem} />

      <div className="review__head" ref={headRef}>
        {result.ok && draftResult.ok ? (
          <Summary {...reviewSummary(result.evaluation, draftResult.evaluation)} />
        ) : (
          <div className="review__summary" aria-hidden="true" />
        )}

        {plotMessage === null ? (
          <section className="review__plot" aria-label="階段">
            <StairsChart
              steps={steps}
              compare={result.ok ? result.evaluation.steps : []}
              selectedIndex={selectedStep === undefined ? null : selectedIndex}
              onSelect={(index) => {
                const year = steps[index]?.fromYear ?? null
                setSelectedYear((current) => (current === year ? null : year))
              }}
            />
          </section>
        ) : (
          <p className="review__plot review__plot--message" role="alert">
            {plotMessage}
            {result.ok ? null : (
              <>
                {' '}
                <Link to="/plan">計画を直す</Link>
              </>
            )}
          </p>
        )}

        <div className="review__actions">
          {isSample ? <span className="tag">見本</span> : null}
          <button type="button" className="review__reset" disabled={!changed} onClick={reset}>
            元に戻す
          </button>
          {isSample ? (
            <StartOwnButton
              className="review__adopt"
              storageProblem={session.storageProblem}
              onStart={() => {
                // 「ながめる」と同じく、計画の切り替えと移動を同じ transition で描く
                startTransition(() => {
                  onStartOwn()
                  void navigate('/plan')
                })
              }}
            />
          ) : (
            <button
              type="button"
              className="review__adopt"
              disabled={!changed || !draftResult.ok}
              onClick={adopt}
            >
              {adopted ? '今の計画にしました' : 'この案にする'}
            </button>
          )}
        </div>
      </div>

      {/* 結果の知らせ（読み上げ用。見た目はボタンの言葉が「今の計画にしました」に替わる） */}
      <p className="visually-hidden" role="status">
        {adopted ? '今の計画にしました' : ''}
      </p>
      {outcome?.ok === true && !outcome.saved ? (
        <p className="review__alert" role="alert">
          この端末に保存できませんでした。閉じると消えます
        </p>
      ) : null}
      {outcome?.ok === false ? (
        <p className="review__alert" role="alert">
          今の計画にできませんでした：{outcome.message}
        </p>
      ) : null}

      {draftResult.ok && selectedStep !== undefined ? (
        <StepBreakdown
          step={selectedStep}
          conversions={
            draftResult.evaluation.conversions.find(
              (entry) => entry.fromYear === selectedStep.fromYear,
            ) ?? null
          }
          names={names}
        />
      ) : null}

      {draftResult.ok && draftResult.evaluation.notices.length > 0 ? (
        <ul className="review__notices">
          {noticeLines(draftResult.evaluation.notices, names).map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}

      <ReviewControls base={base} draft={draft} onChange={update} />
    </div>
  )
}

/**
 * 留める所の高さを、ページの `scroll-padding-top` に写す（キーボードで欄へ戻ったとき、欄が留めた所の裏に隠れないように）。
 * 画面を離れたら元に戻す。高さを測れないブラウザ（`ResizeObserver` が無い）では何もしない
 */
function usePinnedHead() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const head = ref.current
    if (head === null || typeof ResizeObserver === 'undefined') return
    const root = document.documentElement
    const observer = new ResizeObserver(() => {
      root.style.scrollPaddingTop = `${head.getBoundingClientRect().height}px`
    })
    observer.observe(head)
    return () => {
      observer.disconnect()
      root.style.scrollPaddingTop = ''
    }
  }, [])
  return ref
}

/**
 * 案を計算する。契約違反（`RangeError`）は理由を返す（`evaluatePlan`）。
 * それ以外の例外も、案を動かしただけで画面が真っ白にならないよう、記録して理由として返す（案は保存しないので、元の計画は壊れない）
 */
function evaluateDraft(plan: LifePlan): EvaluationResult {
  try {
    return evaluatePlan(plan)
  } catch (error) {
    console.error('見直しの案を計算できませんでした', error)
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

/** 次の段といちばん高い段の、今の計画からの変わり方 */
function Summary({ next, highest }: { next: SummaryRow; highest: SummaryRow }) {
  return (
    <dl className="review__summary">
      <SummaryItem name="次の段" row={next} />
      <SummaryItem name="いちばん高い段" row={highest} />
    </dl>
  )
}

/**
 * 1 つの段：案の金額 → 案の年 → 差（「−61万円」）か、差を出せないときの今の計画の値（「前は 2029年から 948万円」）。
 * 差は、今の計画と同じ年から始まる段どうしで、どちらも解けているときだけ（`reviewSummary.ts`）
 */
function SummaryItem({ name, row }: { name: string; row: SummaryRow }) {
  const { after, delta, previous } = row
  return (
    <div className="review__figure">
      <dt>{name}</dt>
      <dd>
        <span className="review__amount">
          <AmountText view={after} />
        </span>
        <span className="review__when">{after.kind === 'step' ? after.years : null}</span>
        {/* 差と「前は …」はどちらか一方だけ。同じ場所（2 行ぶんの高さを先に取ってある）に出す */}
        {delta !== null && delta !== 0 ? (
          <span className="review__delta">
            <span className="visually-hidden">今の計画より</span>
            <span className="num">{manNumber(delta, { signed: true })}</span>万円
          </span>
        ) : (
          <span className="review__was">
            {previous === null
              ? null
              : previous.map((piece, index) => (
                  <span key={index} className="review__piece">
                    {piece}
                  </span>
                ))}
          </span>
        )}
      </dd>
    </div>
  )
}

/** 段の金額（解けない段は「届かない」、次の段が無ければ「今の年収で足りている」） */
function AmountText({ view }: { view: StepView }) {
  if (view.kind === 'none') return <span className="review__plain">階段に出す年が無い</span>
  if (view.kind === 'enough') return <span className="review__plain">今の年収で足りている</span>
  if (view.gross === null) return <span className="review__value">届かない</span>
  return (
    <span className="review__value">
      <span className="num">{manNumber(view.gross)}</span>万円
    </span>
  )
}

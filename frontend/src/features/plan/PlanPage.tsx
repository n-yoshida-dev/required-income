/**
 * 計画（`/#/plan/<区分>`。SPEC §4.2。T21）。家族・収入・暮らし・目標の 4 つの区分のページに分け、直すたびに保存して計算し直す。
 *
 * - 上に区分の帯、題（h1）と注、区分の中身、下に「戻る」「次へ：◯◯」（目標では最後のボタン）。案内のあいだでなくても同じ 4 ページ
 * - 「次へ」は、欄の誤り・欄をまたぐ問題・計算できない理由があれば進めず、誤りのある最初の欄へフォーカスを移す
 * - 区分が変わったら、画面の先頭へ送り、題へフォーカスを移す（読み上げが新しい題を読む）
 * - 案内のあいだ（`guide` がある）だけ、仮の値の注・保存の注・済みの印を出す
 *
 * 計画を持つのは呼び出し側（`app/router.tsx`）。ここは入力を並べ、直した計画の次の形を `onEdit` で渡すだけ。
 * 見本の世帯のままのときは入力を止め、「自分の数字にする」を 1 つだけ出す（押すと目標カードの無い自分の計画が始まり、家族へ移る）。
 * 自分の計画のあいだは、目標のページのいちばん下に「見本の世帯に戻す」を出す（2 回押し。押すと保存を消して「ながめる」へ移る）。
 * 「ながめる」の目標の一覧から `/plan/goals?goal=<id>` で来たら、そのカードを開いて見える所まで送る。
 */

import { startTransition, useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { StorageProblem } from '../../app/planSession'
import type { LifePlan, Notice, PeakGross } from '../../domain/plan/types'
import { ConfirmButton } from '../shared/ConfirmButton'
import { StartOwnButton, StorageProblemAlert } from '../shared/StartOwn'
import { FamilySection } from './FamilySection'
import { GoalCards } from './GoalCards'
import { nextSection, previousSection, type Guide, type PlanSectionId } from './guide'
import { IncomeSection } from './IncomeSection'
import { LivingSection } from './LivingSection'
import type { PlanEditor } from './planEditor'
import type { PlanIssues } from './planIssues'
import { PlanSectionNav } from './PlanSectionNav'
import {
  BACK_LABEL,
  FINISH_WITH_GOALS,
  FINISH_WITHOUT_GOALS,
  GUIDE_DEFAULT_NOTE,
  GUIDE_PRIVACY_NOTE,
  nextLabel,
  SECTION_NOTES,
  SECTION_TITLES,
} from './sectionWords'
import { withTouched, withoutTouchedUnder } from './touched'
import { useGoalImpacts } from './useGoalImpacts'

type Props = {
  /** 今いる区分（URL から） */
  section: PlanSectionId
  /** 案内の進み具合（案内のあいだでなければ null） */
  guide: Guide | null
  /** 画面に出す計画（直している途中の物。問題があれば、まだ保存も計算もしていない） */
  plan: LifePlan
  /** 最後に計算できた計画（「ながめる」が出している物）。カードの重さはこれで出す */
  evaluatedPlan: LifePlan
  /** 最後に計算できた計画のいちばん高い段（重さの基準。計算できていなければ null） */
  peak: PeakGross | null
  touched: readonly string[]
  issues: PlanIssues
  /** `sample` なら見本の世帯のまま */
  origin: 'sample' | 'saved'
  /** 保存があったのに見本で開いた訳（あれば「自分の数字にする」を 2 回押しにする） */
  storageProblem: StorageProblem | null
  /** 最後に計算できた結果の知らせ */
  notices: readonly Notice[]
  /** 直した計画が計算できなかった理由（保存していない） */
  commitError: string | null
  /** 端末に保存できなかった */
  saveFailed: boolean
  /** 直した計画と印を渡す */
  onEdit: (plan: LifePlan, touched: string[]) => void
  /** 見本の世帯から自分の計画を始める */
  onStartOwn: () => void
  /** 自分の計画の保存を消して見本の世帯に戻す。保存を消せず、戻せなかったら false */
  onBackToSample: () => boolean
  /** 「次へ」でその区分を済みにする（案内のあいだだけ保存に残る） */
  onAdvance: (section: PlanSectionId) => void
  /** 最後のボタンで案内を終える */
  onFinish: () => void
}

/** 誤りを探す欄の印（入力の部品が付ける `aria-invalid` と、欄をまたぐ問題の理由の行） */
const INVALID_SELECTOR = '[aria-invalid="true"], .field__error'

/** フォーカスを移せる入力 */
const INPUT_SELECTOR = 'input, select, textarea'

/**
 * 画面の先頭へ送る。標準モードのページでは、送られるのは文書の根の要素（`<html>`）なので、その位置を直す
 * （jsdom の `window.scrollTo` は未実装で、呼ぶとテストに「未実装」を出すため使わない）
 */
function scrollToTop(): void {
  document.documentElement.scrollTop = 0
}

/** 計画の画面 */
export function PlanPage({
  section,
  guide,
  plan,
  evaluatedPlan,
  peak,
  touched,
  issues,
  origin,
  storageProblem,
  notices,
  commitError,
  saveFailed,
  onEdit,
  onStartOwn,
  onBackToSample,
  onAdvance,
  onFinish,
}: Props) {
  const navigate = useNavigate()
  // 見本の世帯に戻そうとして、保存を消せなかった（自分の計画のまま）
  const [backFailed, setBackFailed] = useState(false)
  // カードの重さ（「外すと −◯万円」）は、階段の計算と保存のあとから出す（入力の反応を止めない。useGoalImpacts.ts）
  const impacts = useGoalImpacts(evaluatedPlan)
  const [searchParams] = useSearchParams()
  const linkedGoal = searchParams.get('goal')
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(
    () => new Set(linkedGoal === null ? [] : [linkedGoal]),
  )
  const titleRef = useRef<HTMLHeadingElement>(null)
  const alertsRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLElement>(null)

  // 区分が変わったら、先頭へ送って題へフォーカスを移す。目標の一覧から来たら、そのカードを見える所まで送る
  useEffect(() => {
    if (linkedGoal !== null) {
      const card = document.getElementById(`goal-${linkedGoal}`)
      // jsdom には scrollIntoView が無い
      if (card !== null && typeof card.scrollIntoView === 'function') card.scrollIntoView()
      return
    }
    scrollToTop()
    titleRef.current?.focus({ preventScroll: true })
  }, [section, linkedGoal])

  const editor: PlanEditor = {
    plan,
    touched,
    issues,
    set: (key, next, reset = []) =>
      onEdit(
        next,
        withTouched(
          touched.filter((other) => !reset.includes(other)),
          key,
        ),
      ),
    add: (next) => onEdit(next, [...touched]),
    remove: (prefix, next) =>
      onEdit(
        next,
        (typeof prefix === 'string' ? [prefix] : prefix).reduce<string[]>(
          (rest, one) => withoutTouchedUnder(rest, one),
          [...touched],
        ),
      ),
  }
  const isSample = origin === 'sample'
  const previous = previousSection(section)
  const next = nextSection(section)
  // 自分で足した目標（子の費用のカードは子ごとに付くので数えない）
  const ownGoals = plan.goals.filter((goal) => goal.kind !== 'childCost').length
  const sectionNote = SECTION_NOTES[section]

  /** 区分へ移る（URL を替える。先頭へ送るのと題へのフォーカスは上の effect） */
  const goTo = (target: PlanSectionId) => {
    void navigate(`/plan/${target}`)
  }

  /**
   * 誤りがあれば、その最初の欄へフォーカスを移して true を返す（進めない）。
   * 畳みやカードの中の欄なら開く。この区分に誤りの欄が無ければ（ほかの区分の欄をまたぐ問題・計算できない理由）、上の知らせへ送る
   */
  const stopAtProblem = (): boolean => {
    const invalid = contentRef.current?.querySelector<HTMLElement>(INVALID_SELECTOR) ?? null
    if (invalid === null && issues.size === 0 && commitError === null) return false
    if (invalid === null) {
      const alerts = alertsRef.current
      if (alerts !== null) {
        if (typeof alerts.scrollIntoView === 'function') alerts.scrollIntoView()
        alerts.focus({ preventScroll: true })
      }
      return true
    }
    const fold = invalid.closest('details')
    if (fold !== null && !fold.open) fold.open = true
    const target = invalid.matches(INPUT_SELECTOR)
      ? invalid
      : invalid.parentElement?.querySelector<HTMLElement>(INPUT_SELECTOR)
    if (target !== null && target !== undefined) target.focus()
    else if (typeof invalid.scrollIntoView === 'function') invalid.scrollIntoView()
    return true
  }

  /** 「次へ」：誤りが無ければ、今の区分を済みにして次の区分へ */
  const advance = (target: PlanSectionId) => {
    if (stopAtProblem()) return
    onAdvance(section)
    goTo(target)
  }

  /** 最後のボタン：誤りが無ければ、案内を終えて「ながめる」の先頭へ */
  const finish = () => {
    if (stopAtProblem()) return
    onFinish()
    void navigate('/')
    scrollToTop()
  }

  /** 見本の世帯に戻して、「ながめる」の先頭へ移る。戻せなければここに留まって知らせる */
  const backToSample = () => {
    if (!onBackToSample()) {
      setBackFailed(true)
      return
    }
    void navigate('/')
    scrollToTop()
  }

  /** 見本から自分の計画を始めて、家族へ移る（計画の切り替えと移動を同じ transition で 1 回で描く） */
  const startOwn = () => {
    startTransition(() => {
      onStartOwn()
      goTo('family')
    })
  }

  return (
    <div className="plan">
      {isSample ? (
        <p className="plan__sample">
          <span className="tag">見本</span>
          <StartOwnButton
            className="plan__start"
            storageProblem={storageProblem}
            onStart={startOwn}
          />
        </p>
      ) : null}

      <PlanSectionNav current={section} guide={guide} />

      {/* 今ある知らせは今の文のまま、各ページの上に出す。「次へ」で止めたとき、欄の無い誤りはここへ送る */}
      <div className="plan__alerts" ref={alertsRef} tabIndex={-1}>
        <StorageProblemAlert className="plan__alert" storageProblem={storageProblem} />
        {saveFailed ? (
          <p className="plan__alert" role="alert">
            この端末に保存できませんでした。閉じると直した所は消えます
          </p>
        ) : null}
        {issues.size > 0 ? (
          <p className="plan__alert" role="status">
            直すまで保存しません
          </p>
        ) : null}
        {commitError === null ? null : (
          <p className="plan__alert" role="alert">
            計算できないので保存していません：{commitError}
          </p>
        )}
      </div>

      <section className="plan__page" aria-labelledby="plan-title" ref={contentRef}>
        <header className="plan__head">
          <h1 id="plan-title" className="plan__title" ref={titleRef} tabIndex={-1}>
            {SECTION_TITLES[section]}
          </h1>
          {sectionNote === null ? null : <p className="plan__note">{sectionNote}</p>}
          {guide !== null && section !== 'goals' ? (
            <p className="plan__note">{GUIDE_DEFAULT_NOTE}</p>
          ) : null}
        </header>

        {/* 見本のままなら入力を止める（見本の数字と自分の数字を混ぜない）。畳みとカードは開いて中を見られる */}
        <fieldset className="plan__form" disabled={isSample}>
          <legend className="visually-hidden">{SECTION_TITLES[section]}</legend>
          {section === 'family' ? (
            <FamilySection editor={editor} />
          ) : section === 'income' ? (
            <IncomeSection editor={editor} />
          ) : section === 'living' ? (
            <LivingSection editor={editor} />
          ) : (
            <GoalCards
              editor={editor}
              openIds={openIds}
              notices={notices}
              impacts={impacts}
              peak={peak}
              onToggle={(goalId, open) =>
                setOpenIds((current) => {
                  const nextIds = new Set(current)
                  if (open) nextIds.add(goalId)
                  else nextIds.delete(goalId)
                  return nextIds
                })
              }
            />
          )}
        </fieldset>
      </section>

      {/* 中身の下に 1 行：左に「戻る」、右に「次へ」（画面の下には留めない。キーボードが出たときに動かないため） */}
      <div className="plan__steps">
        <div className="plan__step-buttons">
          {previous === null ? null : (
            <button type="button" className="plan__prev" onClick={() => goTo(previous)}>
              {BACK_LABEL}
            </button>
          )}
          {next !== null ? (
            <button type="button" className="plan__next" onClick={() => advance(next)}>
              {nextLabel(next)}
            </button>
          ) : ownGoals > 0 ? (
            <button type="button" className="plan__next" onClick={finish}>
              {FINISH_WITH_GOALS}
            </button>
          ) : (
            <button type="button" className="plan__next is-later" onClick={finish}>
              {FINISH_WITHOUT_GOALS}
            </button>
          )}
        </div>
        {guide === null ? null : <p className="plan__privacy">{GUIDE_PRIVACY_NOTE}</p>}
      </div>

      {/* 自分の計画のあいだだけ、目標のページのいちばん下に控えめに置く（T23・D46 の 1）。入れた数字が消えるので 2 回押し */}
      {isSample || section !== 'goals' ? null : (
        <div className="plan__back">
          {backFailed ? (
            <p className="plan__alert" role="alert">
              この端末の保存を消せなかったので、見本に戻していません
            </p>
          ) : null}
          <ConfirmButton
            className="plan__remove"
            label="見本の世帯に戻す"
            confirmLabel="入れた数字を消して戻す"
            onConfirm={backToSample}
          />
        </div>
      )}
    </div>
  )
}

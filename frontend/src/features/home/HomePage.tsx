/**
 * ながめる（`/#/`。SPEC §4.1）。開いたらボタンを押さずに、上から 概要の枠 → 階段の図 → 目標の一覧 を出す。
 * 文で読むのは先頭の概要の枠だけ。図は図だけで見せる（図の中や下に説明の文を混ぜない。D42）。
 *
 * 計算は呼び出し側（`app/router.tsx`）が済ませて渡す。ここは並べるだけ。
 * 計算できなかった（計画が契約に反している）ときは、理由を出して「計画」へ案内する。
 */

import { startTransition, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import type { EvaluationResult, PlanSession } from '../../app/planSession'
import { appDefaults } from '../../data/appData'
import { enoughUntilYear, stepOutlook } from '../../domain/plan/stepReading'
import { stairsTitle } from './nextStepText'
import { ownerNames } from '../shared/goalNames'
import { StairsChart } from '../shared/StairsChart'
import { StartOwnButton, StorageProblemAlert } from '../shared/StartOwn'
import { GoalList } from './GoalList'
import { goalSummaries } from './goalSummary'
import { noticeLines } from './noticeText'
import { StepBreakdown } from './StepBreakdown'
import { Summary } from './Summary'

type Props = {
  session: PlanSession
  result: EvaluationResult
  /** 見本の世帯から自分の計画を始める（「自分の数字にする」。押したら「計画」へ移る） */
  onStartOwn: () => void
}

/** ながめるの画面 */
export function HomePage({ session, result, onStartOwn }: Props) {
  const navigate = useNavigate()
  const [selected, setSelected] = useState<number | null>(null)
  const names = useMemo(() => ownerNames(session.plan), [session.plan])
  const goals = useMemo(() => goalSummaries(session.plan, appDefaults), [session.plan])
  // 押した段（内訳を出す段）。換算は `fromYear` で段と対応する（SPEC §3.9）
  const selectedStep =
    result.ok && selected !== null ? result.evaluation.steps[selected] : undefined
  const lastStep = result.ok ? result.evaluation.steps.at(-1) : undefined
  // 次の段より先の流れ（いちばん高い段と、最後に落ち着く段）。概要の 3 つ目の箇条書き
  const outlook = useMemo(
    () => (result.ok ? stepOutlook(result.evaluation.steps, result.evaluation.nextStep) : null),
    [result],
  )

  return (
    <div className="home">
      <h1 className="visually-hidden">ながめる</h1>

      {session.origin === 'sample' ? (
        <p className="home__sample">
          <span className="tag">見本</span>
          <StartOwnButton
            className="home__start"
            storageProblem={session.storageProblem}
            onStart={() => {
              // 画面の移動は react-router が transition で描くので、計画の切り替えも同じ transition に入れて 1 回で描く
              // （分けると、見本でなくなった「ながめる」が一瞬描かれてから「計画」に移る）
              startTransition(() => {
                onStartOwn()
                void navigate('/plan')
              })
            }}
          />
        </p>
      ) : null}

      <StorageProblemAlert className="home__alert" storageProblem={session.storageProblem} />

      {result.ok ? (
        <>
          <Summary
            step={result.evaluation.nextStep}
            stepCount={result.evaluation.steps.length}
            currentGross={result.evaluation.currentGross}
            base={session.plan.baseYearMonth}
            enoughUntil={enoughUntilYear(result.evaluation.steps, result.evaluation.nextStep)}
            outlook={outlook}
          />

          {lastStep === undefined ? null : (
            <section className="home__stairs" aria-labelledby="home-stairs-title">
              {/* 終わりの年までの全体の図だと題で言う（W18・W19）。図の中と下には説明の文を置かない（D42） */}
              <h2 id="home-stairs-title" className="home__stairs-title">
                {stairsTitle(lastStep.toYear)}
              </h2>
              <StairsChart
                steps={result.evaluation.steps}
                selectedIndex={selected}
                onSelect={(index) => setSelected((current) => (current === index ? null : index))}
              />
              {selectedStep === undefined ? null : (
                <StepBreakdown
                  step={selectedStep}
                  conversions={
                    result.evaluation.conversions.find(
                      (entry) => entry.fromYear === selectedStep.fromYear,
                    ) ?? null
                  }
                  names={names}
                />
              )}
            </section>
          )}

          {result.evaluation.notices.length === 0 ? null : (
            <ul className="home__notices">
              {noticeLines(result.evaluation.notices, names).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="home__alert" role="alert">
          計算できませんでした：{result.message} <Link to="/plan">計画を直す</Link>
        </p>
      )}

      <GoalList goals={goals} />
    </div>
  )
}

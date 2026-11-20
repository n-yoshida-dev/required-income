/**
 * 計画（`/#/plan`。SPEC §4.2）。家族 → 暮らし → 目標カード → 前提 の順に並べ、直すたびに保存して計算し直す。
 *
 * 計画を持つのは呼び出し側（`app/router.tsx`）。ここは入力を並べ、直した計画の次の形を `onEdit` で渡すだけ。
 * 見本の世帯のままのときは入力を止め、「自分の数字にする」を 1 つだけ出す（押すと目標カードの無い自分の計画が始まる）。
 * 「ながめる」の目標の一覧から `?goal=<id>` で来たら、そのカードを開いて見える所まで送る。
 */

import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import type { StorageProblem } from '../../app/planSession'
import { appDefaults, mortgageRateLabel } from '../../data/appData'
import { formatPercent } from '../shared/format'
import type { LifePlan, Notice, PeakGross } from '../../domain/plan/types'
import { MoneyField, RateField } from '../shared/fields/Fields'
import { StartOwnButton, StorageProblemAlert } from '../shared/StartOwn'
import { FamilySection } from './FamilySection'
import { GoalCards } from './GoalCards'
import { fieldState, type PlanEditor } from './planEditor'
import type { PlanIssues } from './planIssues'
import { withTouched, withoutTouchedUnder } from './touched'
import { useGoalImpacts } from './useGoalImpacts'

type Props = {
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
}

/** 計画の画面 */
export function PlanPage({
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
}: Props) {
  // カードの重さ（「外すと −◯万円」）は、階段の計算と保存のあとから出す（入力の反応を止めない。useGoalImpacts.ts）
  const impacts = useGoalImpacts(evaluatedPlan)
  const [searchParams] = useSearchParams()
  const linkedGoal = searchParams.get('goal')
  const [openIds, setOpenIds] = useState<ReadonlySet<string>>(
    () => new Set(linkedGoal === null ? [] : [linkedGoal]),
  )

  // 目標の一覧から来たら、そのカードを見える所まで送る（jsdom には scrollIntoView が無い）
  useEffect(() => {
    if (linkedGoal === null) return
    const card = document.getElementById(`goal-${linkedGoal}`)
    if (card !== null && typeof card.scrollIntoView === 'function') card.scrollIntoView()
  }, [linkedGoal])

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

  return (
    <div className="plan">
      <h1 className="visually-hidden">計画</h1>

      {isSample ? (
        <p className="plan__sample">
          <span className="tag">見本</span>
          <StartOwnButton
            className="plan__start"
            storageProblem={storageProblem}
            onStart={onStartOwn}
          />
        </p>
      ) : null}
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

      {/* 見本のままなら入力を止める（見本の数字と自分の数字を混ぜない）。カードは開いて中を見られる */}
      <fieldset className="plan__form" disabled={isSample}>
        <legend className="visually-hidden">計画の入力</legend>

        <FamilySection editor={editor} />

        <section className="plan__section" aria-labelledby="plan-living">
          <h2 id="plan-living">暮らし</h2>
          <MoneyField
            label="生活費"
            perMonth
            {...fieldState(editor, 'living.monthlyLivingCost')}
            value={plan.living.monthlyLivingCost}
            onChange={(monthlyLivingCost) =>
              editor.set('living.monthlyLivingCost', {
                ...plan,
                living: { ...plan.living, monthlyLivingCost },
              })
            }
          />
          <MoneyField
            label="家賃"
            perMonth
            {...fieldState(editor, 'living.monthlyRent')}
            value={plan.living.monthlyRent}
            onChange={(monthlyRent) =>
              editor.set('living.monthlyRent', { ...plan, living: { ...plan.living, monthlyRent } })
            }
          />
        </section>

        <GoalCards
          editor={editor}
          openIds={openIds}
          notices={notices}
          impacts={impacts}
          peak={peak}
          onToggle={(goalId, open) =>
            setOpenIds((current) => {
              const next = new Set(current)
              if (open) next.add(goalId)
              else next.delete(goalId)
              return next
            })
          }
        />

        <section className="plan__section" aria-labelledby="plan-assumptions">
          <h2 id="plan-assumptions">前提</h2>
          <RateField
            label="積立の利回り"
            unit="%/年"
            {...fieldState(editor, 'assumptions.investmentReturnRate')}
            value={plan.assumptions.investmentReturnRate}
            onChange={(investmentReturnRate) =>
              editor.set('assumptions.investmentReturnRate', {
                ...plan,
                assumptions: { ...plan.assumptions, investmentReturnRate },
              })
            }
          />
          <RateField
            label="物価の上がり方"
            unit="%/年"
            {...fieldState(editor, 'assumptions.inflationRate')}
            value={plan.assumptions.inflationRate}
            onChange={(inflationRate) =>
              editor.set('assumptions.inflationRate', {
                ...plan,
                assumptions: { ...plan.assumptions, inflationRate },
              })
            }
          />
          {/* 既定値は毎月変わる値なので、どの月の何の金利かを欄の下に出す */}
          <RateField
            label="住宅ローンの金利"
            unit="%/年"
            note={`既定：${mortgageRateLabel}（${formatPercent(appDefaults.assumptions.mortgageRate.value)}）`}
            {...fieldState(editor, 'assumptions.mortgageRate')}
            value={plan.assumptions.mortgageRate}
            onChange={(mortgageRate) =>
              editor.set('assumptions.mortgageRate', {
                ...plan,
                assumptions: { ...plan.assumptions, mortgageRate },
              })
            }
          />
        </section>
      </fieldset>
    </div>
  )
}

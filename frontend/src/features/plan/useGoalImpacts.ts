/**
 * 目標カードの重さ（SPEC §3.8・§4.2）を、入力の反応を止めずに出す。
 *
 * 重さはカード 1 枚ごとに計画を計算し直す（見本の世帯で 1 枚 20 ミリ秒ほど、8 枚で 0.2 秒ほど。KNOWLEDGE.md 2026-11-17 T11）。
 * 直すたびに同じ処理の中で回すと、1 文字打つごとに画面が 0.2 秒止まる。そこで：
 *
 * - 階段の計算と保存は今までどおり先に済ませ（`app/router.tsx` の `edit`）、重さはそのあとで出す
 * - 計画が変わったら、今の計画を 1 回、カードを 1 枚ずつ、それぞれ別の `setTimeout` で計算する（間に入力を受け付ける）。
 *   計算の途中で計画がまた変わったら、残りは捨てて新しい計画で始め直す
 * - 全部のカードが出そろってから 1 回で差し替える（カードどうしで古い数字と新しい数字を混ぜない）。
 *   出そろうまでは前の計画の数字を残す（数字が消えて見出しの幅が揺れないように）。
 *   返す物に計算の元にした計画を添え、画面は、元のカードと中身が同じカードにだけ出す（`impactText.ts` の `impactForCard`）。
 *   直したカード・オン・オフを入れ替えたカード・消したカードの id を使い回した別のカードには、前の数字を出さない
 */

import { useEffect, useState } from 'react'
import { appDefaults, planTables } from '../../data/appData'
import { impactCalculator } from '../../domain/plan/impact'
import type { GoalId, GoalImpact, LifePlan } from '../../domain/plan/types'
import type { ComputedImpacts } from './impactText'

const EMPTY: ComputedImpacts = { source: null, impacts: new Map() }

/**
 * 計画のカードの重さと、その元にした計画。計画は、計算できて保存した物（「計画」の画面の入力の途中の物ではなく、「ながめる」が出している物）を渡す。
 * 入力が契約に反していて計算できないカードは、そのカードだけ出さない（理由はカードの帯の所に出ている）
 */
export function useGoalImpacts(plan: LifePlan): ComputedImpacts {
  const [impacts, setImpacts] = useState<ComputedImpacts>(EMPTY)

  useEffect(() => {
    const calculator = impactCalculator(plan, planTables, appDefaults)
    const goalIds = plan.goals.map((goal) => goal.id)
    const next = new Map<GoalId, GoalImpact>()
    // -1 は今の計画、0 から先はカードの並びの番号
    let index = -1
    let timer: ReturnType<typeof setTimeout> | undefined

    const runOne = () => {
      try {
        if (index < 0) {
          calculator.base()
        } else {
          const goalId = goalIds[index]
          if (goalId !== undefined) next.set(goalId, calculator.impactOf(goalId))
        }
      } catch (error) {
        // 契約違反（オフのカードの入力が帯にできないなど）は、そのカードの数字を出さないだけにする。ほかの例外は不具合なので投げる
        if (!(error instanceof RangeError)) throw error
        console.error('目標の重さを計算できませんでした', error)
        if (index < 0) {
          setImpacts(EMPTY)
          return
        }
      }
      index += 1
      if (index < goalIds.length) {
        timer = setTimeout(runOne, 0)
      } else {
        setImpacts({ source: plan, impacts: next })
      }
    }

    timer = setTimeout(runOne, 0)
    return () => clearTimeout(timer)
  }, [plan])

  return impacts
}

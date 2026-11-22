// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluatePlan, openPlanSession } from '../../../src/app/planSession'
import { sampleHousehold } from '../../../src/data/appData'
import type { Evaluation, Step } from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { HomePage } from '../../../src/features/home/HomePage'
import { roundMan } from '../../../src/features/shared/displayMan'
import { manNumber } from '../../../src/features/shared/format'

// 見本の世帯を画面ごと描くので、初回の evaluate を背負う（router.test.tsx と同じ扱い）
vi.setConfig({ testTimeout: 30000 })

/**
 * 見本の世帯の概要の枠の文を、丸ごと固定する（PR #99 の受け入れレビューの指摘）。
 * 文の形（どの年に何が起きるか）はここで決めて書き、金額は手で書き写さずに見本の JSON と計算の結果から引く。
 * 「あと◯年◯か月」は開いた日で変わるので、計算の起点（今日の年月）を 2026 年 11 月に固定する
 */
describe('見本の世帯の概要の枠（文を丸ごと）', () => {
  /** 計算の起点（今日の年月）。「あと◯年◯か月」が変わらないように固定する */
  const today = yearMonth(2026, 11)

  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    cleanup()
  })

  /** 画面と同じ手順で、見本の世帯を開いて計算する（保存は無い） */
  function openSample() {
    const session = openPlanSession(localStorage, today)
    const result = evaluatePlan(session.plan)
    if (!result.ok) throw new Error(result.message)
    return { session, result, evaluation: result.evaluation }
  }

  /** その年から始まる段 */
  function stepFrom(evaluation: Evaluation, fromYear: number): Step {
    const found = evaluation.steps.find((s) => s.fromYear === fromYear)
    if (found === undefined) throw new Error(`${fromYear}年から始まる段が無い`)
    return found
  }

  /** 段の要る年収（届かない段は見本の世帯には無い前提） */
  function grossOf(step: Step): number {
    if (step.requiredGross === null) throw new Error(`${step.fromYear}年の段が解けない`)
    return step.requiredGross
  }

  /** 段の理由の月額（画面と同じく 0.1 万円の桁で） */
  function monthlyOf(step: Step, label: string): string {
    const found = step.causes.find((c) => c.label === label)
    if (found === undefined) throw new Error(`${step.fromYear}年の段に「${label}」が無い`)
    return manNumber(found.monthly, { digits: 1 })
  }

  it('見出しの文・注・箇条書き 3 つが、見本の JSON と計算から組んだ文と一字も違わない', () => {
    const { session, result, evaluation } = openSample()
    const [car] = sampleHousehold.carGoals ?? []
    const [home] = sampleHousehold.homeGoals ?? []
    if (car === undefined || home === undefined) throw new Error('見本の世帯に車・家のカードが無い')
    if (car.payment !== 'loan' || car.loanYears === undefined)
      throw new Error('見本の世帯の車がローンでない')

    // 文の形：車を買う年が次の段、家を買う年がいちばん高い段、車のローンを返し終える年が最後の段
    const nextYear = today.year + car.purchaseYearsLater
    const peakYear = today.year + home.purchaseYearsLater
    const lastYear = nextYear + car.loanYears
    const next = stepFrom(evaluation, nextYear)
    const peak = stepFrom(evaluation, peakYear)
    const last = stepFrom(evaluation, lastYear)
    expect(evaluation.nextStep?.fromYear).toBe(nextYear)
    expect(evaluation.steps.at(-1)?.fromYear).toBe(lastYear)

    // 今の年収は見本の大人の年収の合計
    const current = sampleHousehold.adults.reduce((sum, adult) => sum + adult.annualIncome, 0)
    expect(evaluation.currentGross).toBe(current)
    const gap = roundMan(grossOf(next)) - roundMan(current)

    render(
      <MemoryRouter>
        <HomePage session={session} result={result} onStartOwn={() => undefined} />
      </MemoryRouter>,
    )
    const summary = screen.getByRole('region', { name: '概要' })
    const points = [...summary.querySelectorAll('.summary__points > li')].map(
      (li) => li.textContent,
    )

    expect(points).toEqual([
      `今の年収 ${manNumber(current)}万円より ${manNumber(gap)}万円多い金額です。` +
        `${nextYear - 1}年までは今の年収で足ります`,
      `${nextYear}年に変わること` +
        `車のローンの返済が始まる月${monthlyOf(next, '車のローンの返済')}万円` +
        `次の車の積立が始まる月${monthlyOf(next, '次の車の積立')}万円` +
        `学校（1人目）の費用が終わる月${monthlyOf(next, '学校（1人目）')}万円`,
      `いちばん高いのは ${peakYear}年からの ${manNumber(grossOf(peak))}万円。` +
        `${lastYear}年からは、車のローンの返済が終わるので ${manNumber(grossOf(last))}万円に下がります`,
    ])

    // 枠の字を丸ごと（読み上げ用の「。」を含む）。起点が 2026 年 11 月なので、次の段の 1 月まで 2 年 2 か月
    expect(summary.textContent).toBe(
      `やりたいことを全部やるには、${nextYear}年から年収${manNumber(grossOf(next))}万円が要ります` +
        '。あと2年2か月' +
        '年収：家族の年収の合計。税金と社会保険を引かれる前の金額' +
        points.join(''),
    )
  })
})

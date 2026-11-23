// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluatePlan, openPlanSession, todayYearMonth } from '../../src/app/planSession'
import { AppRouter } from '../../src/app/router'
import { manNumber } from '../../src/features/shared/format'
import { PLAN_STORAGE_V2_KEY, savePlanV2 } from '../../src/storage/planStorageV2'

// 画面ごと描くテストは、最初の 1 件が jsdom・React・ルーターの初回と見本の世帯の evaluate の初回をまとめて背負う。
// 全体を並列で回すと既定の 5 秒を超えることがあるので、このファイルだけ延ばす（前の版の goalSeek.test.ts と同じ扱い。タグ `v1-final` にある）
vi.setConfig({ testTimeout: 30000 })

/**
 * 画面の切り替えと「ながめる」の煙テスト（TODO の T4 の完了条件）。
 * 開くと、ボタンを押さずに見本の世帯の「次の段」と階段が出ることを確かめる。
 */
describe('AppRouter', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    cleanup()
  })

  /** 画面と同じ手順で、見本の世帯の答えを作る */
  function expectedSample() {
    const session = openPlanSession(localStorage, todayYearMonth(new Date()))
    const result = evaluatePlan(session.plan)
    if (!result.ok) throw new Error(result.message)
    return result.evaluation
  }

  it('保存が無ければ、開いただけで見本の世帯の概要の枠（次の段）と階段が出る', () => {
    const evaluation = expectedSample()
    render(<AppRouter />)

    const next = screen.getByRole('region', { name: '概要' })
    const gross = evaluation.nextStep?.requiredGross
    if (gross === undefined || gross === null) throw new Error('見本の世帯に次の段が無い')
    expect(next.textContent).toContain(manNumber(gross))
    expect(next.textContent).toContain(`${evaluation.nextStep?.fromYear}年から`)

    const stairs = screen.getByRole('group', { name: '階段' })
    expect(within(stairs).getAllByRole('button')).toHaveLength(evaluation.steps.length)
    expect(screen.getByText('見本')).toBeTruthy()
  })

  it('文は先頭の概要の枠にまとめ、図は図だけ（D42）：箇条書き 3 つ、図の題に終わりの年、図の下に説明の文を置かない', () => {
    const evaluation = expectedSample()
    render(<AppRouter />)
    const last = evaluation.steps.at(-1)
    if (last === undefined) throw new Error('段が無い')

    // 概要の枠：今の年収との差／その年に変わること／その先の流れ（見本の世帯はいちばん高い段と、下がって落ち着く最後の段がある）
    const summary = screen.getByRole('region', { name: '概要' })
    const points = [...summary.querySelectorAll('.summary__points > li')].map(
      (li) => li.textContent,
    )
    expect(points).toHaveLength(3)
    expect(points[0]).toMatch(/^今の年収 /)
    expect(points[1]).toContain(`${evaluation.nextStep?.fromYear}年に変わること`)
    const reachable = evaluation.steps.flatMap((step) =>
      step.requiredGross === null ? [] : [step.requiredGross],
    )
    const peak = Math.max(...reachable)
    expect(points[2]).toContain(`いちばん高いのは `)
    expect(points[2]).toContain(`${manNumber(peak)}万円`)
    expect(points[2]).toContain(`${last.fromYear}年からは`)
    if (last.requiredGross === null) throw new Error('見本の世帯の最後の段が解けない')
    expect(points[2]).toMatch(new RegExp(`ので ${manNumber(last.requiredGross)}万円に下がります$`))

    // 図：題だけ。図の下に「…ので、要る年収が下がります」などの文を置かない（上の 1 段ぶんの形も無い）
    const section = screen.getByRole('region', {
      name: `この先、年収がいくら要るか（${last.toYear}年まで）`,
    })
    expect(section.textContent).not.toMatch(/ので|下がります|変わること/)
    expect(document.querySelector('.next, .next__stair, .home__falls')).toBeNull()
    // 画面のどこにも「世帯年収」の字を出さない（W19。「年収」と注にする）
    expect(document.body.textContent).not.toContain('世帯年収')
  })

  it('段を押すと、その段の内訳が出る。もう一度押すと閉じる', () => {
    const evaluation = expectedSample()
    render(<AppRouter />)
    const last = evaluation.steps[evaluation.steps.length - 1]
    if (last === undefined) throw new Error('段が無い')

    const buttons = within(screen.getByRole('group', { name: '階段' })).getAllByRole('button')
    const button = buttons[buttons.length - 1]
    if (button === undefined) throw new Error('段のボタンが無い')
    fireEvent.click(button)
    const name = `${last.fromYear}〜${last.toYear}年の内訳`
    expect(screen.getByRole('region', { name })).toBeTruthy()
    fireEvent.click(button)
    expect(screen.queryByRole('region', { name })).toBeNull()
  })

  it('見込みで届かない段を押すと換算の行が出て、届いている段では出ない（押した段と換算を fromYear でつなぐ）', () => {
    const evaluation = expectedSample()
    render(<AppRouter />)
    const shortIndex = evaluation.steps.findIndex(
      (step) => step.requiredGross === null || step.requiredGross > step.expectedGross,
    )
    const reachedIndex = evaluation.steps.findIndex(
      (step) => step.requiredGross !== null && step.requiredGross <= step.expectedGross,
    )
    if (shortIndex < 0 || reachedIndex < 0) throw new Error('見本の世帯に届かない段と届く段が無い')
    const buttons = within(screen.getByRole('group', { name: '階段' })).getAllByRole('button')

    const shortButton = buttons[shortIndex]
    if (shortButton === undefined) throw new Error('届かない段のボタンが無い')
    fireEvent.click(shortButton)
    const fills = within(screen.getByRole('list', { name: '埋め方の換算' })).getAllByRole(
      'listitem',
    )
    expect(fills.map((item) => item.textContent ?? '').join(' ')).toContain('本業を上げるなら')
    expect(screen.getByText('個人事業税は含まない')).toBeTruthy()

    const reachedButton = buttons[reachedIndex]
    if (reachedButton === undefined) throw new Error('届く段のボタンが無い')
    fireEvent.click(reachedButton)
    expect(screen.queryByRole('list', { name: '埋め方の換算' })).toBeNull()
  })

  it('タブで計画・見直すへ移れる', () => {
    render(<AppRouter />)
    // 「計画」は 4 つの区分のページ。案内の無い見本では家族から開き、題（h1）は区分の題（T21）
    fireEvent.click(screen.getByRole('link', { name: '計画' }))
    expect(window.location.hash).toBe('#/plan/family')
    expect(
      screen.getByRole('heading', { level: 1, name: '家族の生まれ年を入れましょう' }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '見直す' }))
    expect(screen.getByRole('heading', { name: '見直す' })).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    expect(screen.getByRole('region', { name: '概要' })).toBeTruthy()
  })

  it('保存が壊れていれば、見本で開いたことを知らせる', () => {
    localStorage.setItem(PLAN_STORAGE_V2_KEY, '{壊れた')
    render(<AppRouter />)
    expect(screen.getByRole('alert').textContent).toContain('見本で開いています')
    expect(screen.getByRole('region', { name: '概要' })).toBeTruthy()
  })

  it('保存が今の版で計算できなければ、真っ白にせず見本で開き、理由を出す', () => {
    const session = openPlanSession(localStorage, todayYearMonth(new Date()))
    savePlanV2(
      {
        ...session.plan,
        goals: [
          ...session.plan.goals,
          // 形は正しいが計算できないカード（頭金が価格を超える家。帯にするとき投げる）。金額はダミー
          {
            id: 'goal-overpaid',
            enabled: true,
            kind: 'home',
            saved: 0,
            purchaseYear: 2033,
            price: 30000000,
            downPayment: 31000000,
            loanYears: 35,
            monthlyUpkeep: 20000,
          },
        ],
      },
      [],
      localStorage,
    )
    render(<AppRouter />)
    const alert = screen.getByRole('alert').textContent ?? ''
    expect(alert).toContain('保存を今の版で開けなかった')
    expect(alert).toContain('頭金')
    expect(screen.getByText('見本')).toBeTruthy()
    expect(screen.getByRole('region', { name: '概要' })).toBeTruthy()
  })
})

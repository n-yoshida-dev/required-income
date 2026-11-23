// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluatePlan, openPlanSession, todayYearMonth } from '../../../src/app/planSession'
import { AppRouter } from '../../../src/app/router'
import type { LifePlan } from '../../../src/domain/plan/types'
import { ReviewPage } from '../../../src/features/review/ReviewPage'
import { PLAN_STORAGE_V2_KEY } from '../../../src/storage/planStorageV2'

// 画面ごと描くテスト（router.test.tsx と同じ扱い）。1 回の操作ごとに見本の大きさの計画を計算し直すので延ばす
vi.setConfig({ testTimeout: 30000 })

/** 保存の中身 */
function stored(): { plan: { goals: { kind: string; enabled: boolean }[] } } {
  const raw = localStorage.getItem(PLAN_STORAGE_V2_KEY)
  if (raw === null) throw new Error('保存が無い')
  return JSON.parse(raw) as { plan: { goals: { kind: string; enabled: boolean }[] } }
}

/** 階段の段の読み上げ名（年と金額）。階段が変わったかを比べる */
function stairLabels(): string[] {
  return within(screen.getByRole('group', { name: '階段' }))
    .getAllByRole('button')
    .map((button) => button.getAttribute('aria-label') ?? '')
}

/** 「見直す」の数字の 1 つ（「次の段」「いちばん高い段」）の文字 */
function figure(name: string): string {
  const term = screen.getByText(name, { selector: 'dt' })
  return term.parentElement?.textContent ?? ''
}

/** 「見直す」の目標のオン・オフ */
function toggle(name: string): HTMLInputElement {
  return screen.getByRole<HTMLInputElement>('checkbox', { name })
}

/** タブで移る */
function goTo(tab: 'ながめる' | '計画' | '見直す') {
  fireEvent.click(screen.getByRole('link', { name: tab }))
}

describe('見直す（T12）', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    cleanup()
  })

  it('自分の数字にする → 家と車 → 家をオフにすると階段と数字がその場で変わり、離れると元のまま。「この案にする」で残る', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    // 「自分の数字にする」で家族の区分へ移る。目標カードは目標の区分（T21）
    fireEvent.click(screen.getByRole('link', { name: /^4 目標/ }))
    fireEvent.click(screen.getByRole('button', { name: '家を足す' }))
    fireEvent.click(screen.getByRole('button', { name: '車を足す' }))

    goTo('ながめる')
    const homeStairsBefore = stairLabels()

    goTo('見直す')
    const stairsBefore = stairLabels()
    const highestBefore = figure('いちばん高い段')
    expect(stairsBefore).toEqual(homeStairsBefore)
    expect(screen.getByRole('button', { name: 'この案にする' })).toHaveProperty('disabled', true)

    // 家をオフにすると、階段といちばん高い段の数字がその場で変わる
    fireEvent.click(toggle('家'))
    expect(stairLabels()).not.toEqual(stairsBefore)
    expect(figure('いちばん高い段')).not.toBe(highestBefore)
    // 今の計画の薄い線が、案の線と別の形で重なる
    const compare = document.querySelector('.stairs__compare')?.getAttribute('d')
    const profile = document.querySelector('.stairs__profile')?.getAttribute('d')
    expect(compare).toBeTruthy()
    expect(compare).not.toBe(profile)
    // まだ保存していない
    expect(stored().plan.goals.find((goal) => goal.kind === 'home')?.enabled).toBe(true)

    // ほかのタブへ移って戻ると、元の計画のまま
    goTo('ながめる')
    expect(stairLabels()).toEqual(homeStairsBefore)
    goTo('見直す')
    expect(toggle('家').checked).toBe(true)
    expect(stairLabels()).toEqual(stairsBefore)
    expect(screen.getByRole('button', { name: '元に戻す' })).toHaveProperty('disabled', true)

    // もう一度オフにして「この案にする」
    fireEvent.click(toggle('家'))
    const stairsAdopted = stairLabels()
    fireEvent.click(screen.getByRole('button', { name: 'この案にする' }))
    // 押したボタンの言葉が結果に替わり、案が今の計画になったので押せない
    expect(screen.getByRole('button', { name: '今の計画にしました' })).toHaveProperty(
      'disabled',
      true,
    )
    expect(screen.getByText('今の計画にしました', { selector: 'p' })).toBeTruthy()
    expect(stored().plan.goals.find((goal) => goal.kind === 'home')?.enabled).toBe(false)

    // 「ながめる」の階段が変わっている
    goTo('ながめる')
    expect(stairLabels()).toEqual(stairsAdopted)
    expect(stairLabels()).not.toEqual(homeStairsBefore)

    // 開き直しても残る
    cleanup()
    window.location.hash = ''
    render(<AppRouter />)
    expect(stairLabels()).toEqual(stairsAdopted)
    goTo('見直す')
    expect(toggle('家').checked).toBe(false)
  })

  it('案内の途中で「この案にする」を押しても、案内の進み具合（guide）は保存に残る（T21）', () => {
    /** 保存の中の案内の進み具合（無ければ undefined） */
    const storedGuide = (): unknown =>
      (JSON.parse(localStorage.getItem(PLAN_STORAGE_V2_KEY) ?? '{}') as { guide?: unknown }).guide

    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    // 家族だけ済ませて、目標の区分で家を足す（案内はまだ終えていない）
    fireEvent.click(screen.getByRole('button', { name: '次へ：収入' }))
    fireEvent.click(screen.getByRole('link', { name: /^4 目標/ }))
    fireEvent.click(screen.getByRole('button', { name: '家を足す' }))
    expect(storedGuide()).toEqual({ done: ['family'] })

    goTo('見直す')
    fireEvent.click(toggle('家'))
    fireEvent.click(screen.getByRole('button', { name: 'この案にする' }))
    expect(stored().plan.goals.find((goal) => goal.kind === 'home')?.enabled).toBe(false)
    // 案を今の計画にしても、案内は続いている（「計画」を開くと、済んでいない最初の区分＝収入から）
    expect(storedGuide()).toEqual({ done: ['family'] })
    goTo('計画')
    expect(window.location.hash).toBe('#/plan/income')
  })

  it('家を 2 年ずらす・元に戻す。動かした値は今の計画と見分けられる', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    // 「自分の数字にする」で家族の区分へ移る。目標カードは目標の区分（T21）
    fireEvent.click(screen.getByRole('link', { name: /^4 目標/ }))
    fireEvent.click(screen.getByRole('button', { name: '家を足す' }))
    goTo('見直す')

    const knob = screen.getByRole('group', { name: '家の買う年' })
    const year = () => within(knob).getByRole('status')
    const before = year().textContent
    fireEvent.click(screen.getByRole('button', { name: '家の買う年を遅らせる' }))
    fireEvent.click(screen.getByRole('button', { name: '家の買う年を遅らせる' }))
    expect(year().textContent).toBe(`${Number.parseInt(before ?? '', 10) + 2}年`)
    expect(year().className).toContain('is-changed')

    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(year().textContent).toBe(before)
    expect(year().className).not.toContain('is-changed')
  })

  it('見本のままでも動かして試せる。保存はせず、「この案にする」の代わりに「自分の数字にする」を出す', () => {
    render(<AppRouter />)
    goTo('見直す')
    expect(screen.getByText('見本')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'この案にする' })).toBeNull()

    const before = stairLabels()
    fireEvent.click(toggle('家'))
    expect(stairLabels()).not.toEqual(before)
    expect(localStorage.getItem(PLAN_STORAGE_V2_KEY)).toBeNull()

    // 自分の数字にすると「計画」へ移る（見本のカードは持ち込まない）
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    expect(
      screen.getByRole('heading', { level: 1, name: '家族の生まれ年を入れましょう' }),
    ).toBeTruthy()
    expect(stored().plan.goals.some((goal) => goal.kind === 'home')).toBe(false)
  })

  it('家の価格は頭金より下へ押せない（押すだけで計算できない案を作らない）', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    // 「自分の数字にする」で家族の区分へ移る。目標カードは目標の区分（T21）
    fireEvent.click(screen.getByRole('link', { name: /^4 目標/ }))
    fireEvent.click(screen.getByRole('button', { name: '家を足す' }))
    goTo('見直す')

    // 雛形の家（4,000万円・頭金 400万円）の価格を 100万円ずつ、頭金まで下げる
    const down = screen.getByRole('button', { name: '家の価格を減らす' })
    for (let i = 0; i < 36; i++) fireEvent.click(down)
    expect(down).toHaveProperty('disabled', true)
    expect(
      within(screen.getByRole('group', { name: '家の価格' })).getByRole('status').textContent,
    ).toBe('400万円')
    expect(screen.getByRole('group', { name: '階段' })).toBeTruthy()
  })

  it('それでも計算できない案になったら（オフにしてあった契約違反のカードをオンにする）、図の場所に理由を出し、「この案にする」を止める', () => {
    const session = openPlanSession(localStorage, todayYearMonth(new Date()))
    const plan: LifePlan = {
      ...session.plan,
      goals: session.plan.goals.map((goal) =>
        // オフのカードは帯にしないので確かめられない。頭金が価格を超える家（金額はダミー）
        goal.kind === 'home'
          ? { ...goal, enabled: false, price: 3_000_000, downPayment: 3_900_000 }
          : goal,
      ),
    }
    const result = evaluatePlan(plan)
    if (!result.ok) throw new Error(result.message)
    render(
      <MemoryRouter>
        <ReviewPage
          session={{ plan, origin: 'saved', touched: [], storageProblem: null, guide: null }}
          result={result}
          onAdopt={() => ({ ok: true, saved: true })}
          onStartOwn={() => undefined}
        />
      </MemoryRouter>,
    )
    expect(screen.getByRole('group', { name: '階段' })).toBeTruthy()

    fireEvent.click(toggle('家'))
    expect(screen.getByRole('alert').textContent).toContain('この案は計算できません')
    expect(screen.queryByRole('group', { name: '階段' })).toBeNull()
    expect(screen.getByRole('button', { name: 'この案にする' })).toHaveProperty('disabled', true)
    // 動かす欄と「元に戻す」はそのまま使え、戻すと階段が戻る
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(screen.getByRole('group', { name: '階段' })).toBeTruthy()
  })
})

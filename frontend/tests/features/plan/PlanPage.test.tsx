// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { evaluatePlan, openPlanSession, todayYearMonth } from '../../../src/app/planSession'
import { AppRouter } from '../../../src/app/router'
import { appDefaults, masterTables, planTables } from '../../../src/data/appData'
import { universityCourseTarget } from '../../../src/domain/plan/defaults'
import { goalImpacts } from '../../../src/domain/plan/impact'
import { impactText } from '../../../src/features/plan/impactText'
import { manNumber } from '../../../src/features/shared/format'
import { PLAN_STORAGE_V2_KEY } from '../../../src/storage/planStorageV2'

// 画面ごと描くテストは、最初の 1 件が jsdom・React・ルーターの初回と見本の世帯の evaluate の初回をまとめて背負う。
// 全体を並列で回すと既定の 5 秒を超えることがある（手元で 6.5 秒）ので、このファイルだけ延ばす（前の版の goalSeek.test.ts と同じ扱い。タグ `v1-final` にある）
vi.setConfig({ testTimeout: 30000 })

/**
 * 「計画」の画面のテスト（TODO の T6 の完了条件：直すとその場で保存され、「ながめる」の階段が変わる）。
 * 画面の入口（`AppRouter`）ごと描き、見本 → 自分の数字にする → 直す → ながめる → 開き直す、を通す。
 */

/** 保存の中身を読む */
function stored(): {
  plan: { living: { monthlyLivingCost: number }; goals: unknown[] }
  touched: string[]
} {
  const raw = localStorage.getItem(PLAN_STORAGE_V2_KEY)
  if (raw === null) throw new Error('保存が無い')
  return JSON.parse(raw) as ReturnType<typeof stored>
}

/** ラベルの書き出しで入力欄を探す（既定値のままの欄は「（既定値のまま）」が読み上げに付く） */
function field(label: string): HTMLInputElement {
  return screen.getByLabelText<HTMLInputElement>(new RegExp(`^${label}(（既定値のまま）)?$`))
}

/** 保存したカードの種類の並び */
function goalKinds(): string[] {
  return (stored().plan.goals as { kind: string }[]).map((goal) => goal.kind)
}

/** 開いているカード（足したカードは開いた状態で入る）。1 枚だけのはず */
function openCard(): HTMLElement {
  const cards = document.querySelectorAll<HTMLElement>('details[open]')
  if (cards.length !== 1 || cards[0] === undefined) {
    throw new Error(`開いているカードが 1 枚ではない: ${cards.length}`)
  }
  return cards[0]
}

/** その入力欄の行が「直した欄」か */
function isTouchedRow(input: HTMLElement): boolean {
  return input.closest('[data-touched]')?.getAttribute('data-touched') === 'true'
}

describe('計画（T6）', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    cleanup()
  })

  it('見本のままでは入力が止まっていて、「自分の数字にする」だけを押せる', () => {
    window.location.hash = '#/plan'
    render(<AppRouter />)
    // 見本のままは入力の束（fieldset）ごと止める（jsdom では disabled の属性でなく :disabled で見る）
    expect(field('生活費').matches(':disabled')).toBe(true)
    expect(screen.getByRole('button', { name: '自分の数字にする' })).toBeTruthy()
    expect(localStorage.getItem(PLAN_STORAGE_V2_KEY)).toBeNull()
  })

  it('ながめる → 自分の数字にする → 生活費を直す → カードを足す → ながめるが変わり、開き直しても残る', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))

    // 見本のカードは持ち込まず、すぐ保存される。家族と暮らしは既定値のまま。
    // 子の費用のカードだけは子ごとに付く（見本の子 2 人ぶん。T9）
    expect(screen.queryByText('見本')).toBeNull()
    expect(goalKinds()).toEqual(['childCost', 'childCost'])
    expect(stored().touched).toEqual([])
    const living = field('生活費')
    expect(living.matches(':disabled')).toBe(false)
    expect(isTouchedRow(living)).toBe(false)

    fireEvent.change(living, { target: { value: '31' } })
    expect(stored().plan.living.monthlyLivingCost).toBe(310000)
    expect(stored().touched).toEqual(['living.monthlyLivingCost'])
    expect(isTouchedRow(field('生活費'))).toBe(true)
    expect(isTouchedRow(field('家賃'))).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: '毎月の支出を足す' }))
    expect(goalKinds()).toEqual(['childCost', 'childCost', 'custom'])
    const amount = field('月額')
    fireEvent.change(amount, { target: { value: '25' } })
    expect(stored().touched).toContain('goals.goal-1.amount')
    // 閉じたままでも読める見出しに、毎月いくらが出る
    const summary = document.querySelector('details[open] summary')
    expect(summary?.textContent).toContain('月 25万円')

    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    const expected = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!expected.ok) throw new Error(expected.message)
    const next = expected.evaluation.nextStep
    if (next?.requiredGross == null) throw new Error('直した計画に次の段が無い')
    expect(screen.getByRole('region', { name: '概要' }).textContent).toContain(
      manNumber(next.requiredGross),
    )

    // 開き直しても、直した計画と印が残る
    cleanup()
    window.location.hash = '#/plan'
    render(<AppRouter />)
    expect(screen.queryByText('見本')).toBeNull()
    expect(field('生活費').value).toBe('31')
    expect(isTouchedRow(field('生活費'))).toBe(true)
    expect(isTouchedRow(field('家賃'))).toBe(false)
  })

  it('読めない・負の金額は、欄に理由を出して保存しない', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    const before = localStorage.getItem(PLAN_STORAGE_V2_KEY)

    fireEvent.change(field('生活費'), { target: { value: '-5' } })
    expect(screen.getByRole('alert').textContent).toContain('0 以上')
    fireEvent.change(field('生活費'), { target: { value: 'あ' } })
    expect(screen.getByRole('alert').textContent).toContain('数を入れて')
    expect(localStorage.getItem(PLAN_STORAGE_V2_KEY)).toBe(before)
  })

  it('毎月のカードの終わりを始まりより前にすると、保存を止めて理由を出す。直すと保存する', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '毎月の支出を足す' }))
    const before = localStorage.getItem(PLAN_STORAGE_V2_KEY)
    const from = Number(field('から').value)

    fireEvent.change(field('まで'), { target: { value: String(from - 1) } })
    expect(screen.getByRole('status').textContent).toContain('直すまで保存しません')
    expect(localStorage.getItem(PLAN_STORAGE_V2_KEY)).toBe(before)

    fireEvent.change(field('まで'), { target: { value: String(from + 2) } })
    expect(screen.queryByRole('status')).toBeNull()
    expect(stored().touched).toContain('goals.goal-1.to')
  })

  it('カードの型を一度きりに替え、オフにし、2 回押して消す', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '毎月の支出を足す' }))

    fireEvent.click(screen.getByRole('radio', { name: '一度きり' }))
    expect(field('使う月')).toBeTruthy()
    expect(stored().touched).toContain('goals.goal-1.variant')

    // 足したカードは子の費用のカード（子ごとに付く。T9）の後ろに入り、開いている
    const card = openCard()
    fireEvent.click(within(card).getByRole('checkbox', { name: '計算に入れる' }))
    expect((stored().plan.goals[2] as { enabled: boolean }).enabled).toBe(false)

    const remove = within(card).getByRole('button', { name: '消す' })
    fireEvent.click(remove)
    expect(stored().plan.goals).toHaveLength(3)
    fireEvent.click(within(card).getByRole('button', { name: '本当に消す' }))
    expect(goalKinds()).toEqual(['childCost', 'childCost'])
    expect(stored().touched.some((key) => key.startsWith('goals.goal-1'))).toBe(false)
  })

  it('型を毎月 ⇄ 一度きりで替えると、雛形に戻った金額・時期の印も外れる', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '毎月の支出を足す' }))
    fireEvent.change(field('月額'), { target: { value: '3' } })
    fireEvent.change(field('から'), { target: { value: String(Number(field('から').value) + 1) } })
    expect(stored().touched).toEqual(
      expect.arrayContaining(['goals.goal-1.amount', 'goals.goal-1.from']),
    )

    fireEvent.click(screen.getByRole('radio', { name: '一度きり' }))
    expect(stored().touched).toContain('goals.goal-1.variant')
    for (const field of ['amount', 'from', 'to', 'at', 'saved']) {
      expect(stored().touched).not.toContain(`goals.goal-1.${field}`)
    }
    expect(isTouchedRow(within(openCard()).getByLabelText(/^金額/))).toBe(false)

    // 支出 ⇄ 収入（同じ毎月）は金額と期間が残るので、印も残す
    fireEvent.click(screen.getByRole('radio', { name: '毎月の支出' }))
    fireEvent.change(field('月額'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('radio', { name: '毎月の収入' }))
    expect(stored().touched).toContain('goals.goal-1.amount')
  })

  it('子ともう 1 人の「外す」は 2 回押し。外すとその行の印も外れる', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    const family = screen.getByRole('region', { name: '家族' })
    fireEvent.change(field('1 人目'), { target: { value: '2011' } })
    const childKey = stored().touched.find((key) => key.startsWith('children.'))
    expect(childKey).toBeTruthy()

    fireEvent.click(within(family).getByRole('button', { name: '1 人目の子を外す' }))
    // 1 回目では外さない
    expect((stored().plan as unknown as { children: unknown[] }).children).toHaveLength(2)
    expect(within(family).getByRole('button', { name: '2 人目の子を外す' })).toBeTruthy()
    fireEvent.click(within(family).getByRole('button', { name: '1 人目の子を本当に外す' }))
    expect(within(family).queryByRole('button', { name: '2 人目の子を外す' })).toBeNull()
    expect(stored().touched).not.toContain(childKey)

    fireEvent.click(within(family).getByRole('button', { name: '子を足す' }))
    expect(within(family).getByRole('button', { name: '2 人目の子を外す' })).toBeTruthy()

    fireEvent.click(within(family).getByRole('button', { name: 'もう 1 人を外す' }))
    expect(within(family).queryByRole('button', { name: 'もう 1 人を足す' })).toBeNull()
    fireEvent.click(within(family).getByRole('button', { name: 'もう 1 人を本当に外す' }))
    expect(within(family).getByRole('button', { name: 'もう 1 人を足す' })).toBeTruthy()
  })

  it('2 回押しの確かめは、数秒で元に戻る（フォーカスが動かないブラウザでも）', () => {
    vi.useFakeTimers()
    try {
      render(<AppRouter />)
      fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
      const family = screen.getByRole('region', { name: '家族' })
      fireEvent.click(within(family).getByRole('button', { name: '1 人目の子を外す' }))
      expect(within(family).getByRole('button', { name: '1 人目の子を本当に外す' })).toBeTruthy()
      act(() => {
        vi.advanceTimersByTime(5000)
      })
      expect(within(family).getByRole('button', { name: '1 人目の子を外す' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('壊れた保存があるときは、「計画」にも知らせを出し、「自分の数字にする」は 2 回押しで前の保存を消す', () => {
    localStorage.setItem(PLAN_STORAGE_V2_KEY, '{壊れた')
    window.location.hash = '#/plan'
    render(<AppRouter />)
    expect(screen.getByRole('alert').textContent).toContain('見本で開いています')

    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    expect(localStorage.getItem(PLAN_STORAGE_V2_KEY)).toBe('{壊れた')
    fireEvent.click(screen.getByRole('button', { name: '前の保存を消して始める' }))
    expect(goalKinds()).toEqual(['childCost', 'childCost'])
    expect(screen.queryByText('見本')).toBeNull()
  })

  it('市区町村は、名前が 1 件にだけ合えばコードで保存し、合わなければ保存せずに候補を選ぶよう出す', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    const before = localStorage.getItem(PLAN_STORAGE_V2_KEY)

    fireEvent.change(field('市区町村'), { target: { value: '府中市' } })
    expect(screen.getByRole('alert').textContent).toContain('候補から選んで')
    expect(localStorage.getItem(PLAN_STORAGE_V2_KEY)).toBe(before)

    fireEvent.change(field('市区町村'), { target: { value: '横浜市' } })
    expect((stored().plan as unknown as { municipality: string }).municipality).toBe('14100')
    fireEvent.blur(field('市区町村'))
    expect(field('市区町村').value).toBe('14100')

    fireEvent.change(field('市区町村'), { target: { value: '99002' } })
    expect((stored().plan as unknown as { municipality: string }).municipality).toBe('99002')
  })

  it('ながめるの目標の一覧から来たら、そのカードが開いている', () => {
    render(<AppRouter />)
    const goals = screen.getByRole('list', { name: '目標' })
    const first = within(goals).getAllByRole('link')[0]
    if (first === undefined) throw new Error('見本に目標が無い')
    fireEvent.click(first)
    const card = document.querySelector('details[open]')
    expect(card).not.toBeNull()
  })
})

describe('家のカード（T7）', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    cleanup()
  })

  /** 保存した家のカード */
  const storedHome = () =>
    (stored().plan.goals as { kind: string; downPayment: number }[]).find((g) => g.kind === 'home')

  it('自分の数字にする → 家を足す → 頭金を変える → 毎月いくらと「ながめる」が変わり、開き直しても残る', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '家を足す' }))
    expect(storedHome()).toBeDefined()

    // 開いた状態で入り、借りる額の目安が出る
    const card = document.querySelector('details[open]')
    if (card === null) throw new Error('家のカードが開いていない')
    expect(card.textContent).toContain('借りる額')
    expect(card.textContent).toContain('返済')
    const summary = () => card.querySelector('summary')?.textContent ?? ''
    const before = summary()

    // 頭金を 2 倍にすると、借りる額が減って返済（＝閉じた見出しの毎月いくら）が下がる
    const down = field('頭金')
    fireEvent.change(down, { target: { value: '800' } })
    expect(storedHome()?.downPayment).toBe(8000000)
    expect(stored().touched).toContain('goals.goal-1.downPayment')
    expect(summary()).not.toBe(before)

    // 頭金が価格を超えると、欄の下に理由を出して保存しない
    fireEvent.change(field('頭金'), { target: { value: '99999' } })
    expect(screen.getByText('価格以下にしてください')).toBeTruthy()
    expect(storedHome()?.downPayment).toBe(8000000)
    fireEvent.change(field('頭金'), { target: { value: '800' } })

    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    const expected = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!expected.ok) throw new Error(expected.message)
    expect(expected.evaluation.bands.some((b) => b.label === '返済')).toBe(true)
    const goals = screen.getByRole('list', { name: '目標' })
    expect(within(goals).getByText('家')).toBeTruthy()

    cleanup()
    window.location.hash = '#/plan'
    render(<AppRouter />)
    expect(storedHome()?.downPayment).toBe(8000000)
    expect(screen.getByText('家')).toBeTruthy()
  })
})

describe('車のカード（T8）', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    cleanup()
  })

  /** 保存した車のカード */
  const storedCar = () =>
    (
      stored().plan.goals as {
        kind: string
        payment: { type: string; years?: number }
        replaceEveryYears: number | null
      }[]
    ).find((g) => g.kind === 'car')

  it('自分の数字にする → 車を足す → 現金からローンに替える → 帯が積立から返済に変わり、「ながめる」が変わり、開き直しても残る', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    const before = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!before.ok) throw new Error(before.message)
    fireEvent.click(screen.getByRole('link', { name: '計画' }))

    fireEvent.click(screen.getByRole('button', { name: '車を足す' }))
    expect(storedCar()?.payment).toEqual({ type: 'cash' })
    const card = document.querySelector('details[open]')
    if (!(card instanceof HTMLElement)) throw new Error('車のカードが開いていない')
    // 帯の名前の一覧（「次の車の積立」が「車の積立」を含むので、文字列ではなく名前の配列で比べる）
    const bands = () =>
      within(within(card).getByRole('list', { name: '車の帯' }))
        .getAllByRole('listitem')
        .map((item) => item.firstElementChild?.textContent ?? '')
    expect(bands()).toContain('車の積立')
    expect(bands()).not.toContain('車のローンの返済')
    // 現金のときは貯まっている額を聞き、ローンの年数は聞かない
    expect(within(card).queryByLabelText(/^貯まっている額/)).not.toBeNull()
    expect(within(card).queryByLabelText(/^ローンの年数/)).toBeNull()

    fireEvent.click(within(card).getByRole('radio', { name: 'ローン' }))
    expect(storedCar()?.payment).toEqual({ type: 'loan', years: 5 })
    expect(stored().touched).toContain('goals.goal-1.payment')
    expect(bands()).toContain('車のローンの返済')
    expect(bands()).not.toContain('車の積立')
    expect(within(card).queryByLabelText(/^貯まっている額/)).toBeNull()
    fireEvent.change(within(card).getByLabelText(/^ローンの年数/), { target: { value: '4' } })
    expect(storedCar()?.payment).toEqual({ type: 'loan', years: 4 })

    // 買い替えないにすると、次の車の積立が消える
    expect(bands()).toContain('次の車の積立')
    fireEvent.click(within(card).getByRole('radio', { name: '買い替えない' }))
    expect(storedCar()?.replaceEveryYears).toBeNull()
    expect(bands()).not.toContain('次の車の積立')

    // 「ながめる」の階段が変わる（車の帯が要る手取りに入る）
    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    const after = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!after.ok) throw new Error(after.message)
    expect(after.evaluation.steps).not.toEqual(before.evaluation.steps)
    expect(after.evaluation.bands.some((b) => b.label === '車のローンの返済')).toBe(true)
    const goals = screen.getByRole('list', { name: '目標' })
    expect(within(goals).getByText('車')).toBeTruthy()

    cleanup()
    window.location.hash = '#/plan'
    render(<AppRouter />)
    expect(storedCar()?.payment).toEqual({ type: 'loan', years: 4 })
    expect(screen.getByText('車')).toBeTruthy()
  })
})

describe('子の費用のカード（T9）', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    cleanup()
  })

  /** 保存した子の費用のカード */
  const storedChildCosts = () =>
    (
      stored().plan.goals as {
        kind: string
        childId: string
        schools: { highSchool: string }
        cramSchools: unknown[]
      }[]
    ).filter((g) => g.kind === 'childCost')

  /** 名前でカードを探して開く */
  const openByName = (name: string): HTMLElement => {
    const summary = screen.getByText(name).closest('summary')
    const card = summary?.closest('details')
    if (summary === null || summary === undefined || !(card instanceof HTMLElement)) {
      throw new Error(`カードが無い: ${name}`)
    }
    if (!card.hasAttribute('open')) fireEvent.click(summary)
    return card
  }

  /** カードの帯の「名前 月額」の一覧 */
  const bandTexts = (card: HTMLElement, name: string) =>
    within(within(card).getByRole('list', { name: `${name}の帯` }))
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')

  it('自分の数字にする → 子の数だけカードがある → 高校を私立にすると帯と「ながめる」が変わる → 子を足すとカードが増え、外すと消える → 開き直しても残る', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    expect(storedChildCosts().map((g) => g.childId)).toEqual(['child-1', 'child-2'])
    const before = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!before.ok) throw new Error(before.message)

    const name = '子の費用（2人目）'
    const card = openByName(name)
    // 消すボタンは無い（子を外すと消える）。オン・オフはある
    expect(within(card).queryByRole('button', { name: '消す' })).toBeNull()
    expect(within(card).getByRole('checkbox', { name: '計算に入れる' })).toBeTruthy()
    const publicBands = bandTexts(card, name)
    // カードの中の帯の名前には「（2人目）」を付けない（カードの名前に出ている）
    expect(publicBands.some((text) => text.startsWith('学校月'))).toBe(true)
    expect(publicBands.some((text) => text.includes('人目'))).toBe(false)

    fireEvent.click(
      within(within(card).getByRole('radiogroup', { name: /^高校/ })).getByRole('radio', {
        name: '私立',
      }),
    )
    const [, second] = storedChildCosts()
    expect(second?.schools.highSchool).toBe('private')
    expect(stored().touched).toContain('goals.childcost-child-2.highSchool')
    expect(bandTexts(card, name)).not.toEqual(publicBands)

    // 塾の行を足して、学年を逆にすると保存を止める
    fireEvent.click(within(card).getByRole('button', { name: '塾を足す' }))
    expect(storedChildCosts()[1]?.cramSchools).toHaveLength(1)
    const from = within(card).getByLabelText('塾の 1 行目の始まりの学年')
    const to = within(card).getByLabelText('塾の 1 行目の終わりの学年')
    fireEvent.change(from, { target: { value: '12' } })
    fireEvent.change(to, { target: { value: '7' } })
    // 理由は、その行の学年の下に 1 つだけ（帯の所に同じ誤りを重ねない）
    const row = within(card).getByRole('group', { name: '塾の 1 行目' })
    expect(within(row).getByText('始まりの学年以降にしてください')).toBeTruthy()
    expect(screen.getAllByText('始まりの学年以降にしてください')).toHaveLength(1)
    expect(within(card).queryAllByRole('alert')).toHaveLength(1)
    fireEvent.change(to, { target: { value: '12' } })
    expect(screen.queryByText('始まりの学年以降にしてください')).toBeNull()
    expect(bandTexts(card, name).some((text) => text.startsWith('塾月'))).toBe(true)

    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    const after = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!after.ok) throw new Error(after.message)
    expect(after.evaluation.years).not.toEqual(before.evaluation.years)
    const goals = screen.getByRole('list', { name: '目標' })
    expect(within(goals).getByText(name)).toBeTruthy()
    fireEvent.click(screen.getByRole('link', { name: '計画' }))

    const family = screen.getByRole('region', { name: '家族' })
    fireEvent.click(within(family).getByRole('button', { name: '子を足す' }))
    expect(storedChildCosts().map((g) => g.childId)).toEqual(['child-1', 'child-2', 'child-3'])
    expect(screen.getByText('子の費用（3人目）')).toBeTruthy()

    fireEvent.click(within(family).getByRole('button', { name: '1 人目の子を外す' }))
    fireEvent.click(within(family).getByRole('button', { name: '1 人目の子を本当に外す' }))
    expect(storedChildCosts().map((g) => g.childId)).toEqual(['child-2', 'child-3'])
    // 外した子のカードの印は残らない。残った子のカードの印は残る
    expect(stored().touched.some((key) => key.startsWith('goals.childcost-child-1'))).toBe(false)
    expect(stored().touched).toContain('goals.childcost-child-2.highSchool')

    cleanup()
    window.location.hash = '#/plan'
    render(<AppRouter />)
    expect(storedChildCosts().map((g) => g.childId)).toEqual(['child-2', 'child-3'])
    expect(storedChildCosts()[0]?.schools.highSchool).toBe('private')
    expect(screen.getByText('子の費用（1人目）')).toBeTruthy()
    expect(screen.getByText('子の費用（2人目）')).toBeTruthy()
  })
})

describe('目標の重さ（T11）', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    cleanup()
  })

  /** 空いている 2 行目（重さが出る前の高さを取っておく空白 1 字） */
  const BLANK = ' '

  /** カードの重さの文字。まだ出ていない・出さないカードは空白 1 字 */
  const weightIn = (card: Element): string => card.querySelector('.card__impact')?.textContent ?? ''

  /** カードの見出しの重さの文字（名前 → 文字）。まだ出ていないカードは無い */
  const weights = (): Map<string, string> =>
    new Map(
      [...document.querySelectorAll<HTMLElement>('details.card')].flatMap((card) => {
        const name = card.querySelector('.card__name')?.textContent ?? ''
        const weight = weightIn(card)
        return weight === BLANK ? [] : [[name, weight] as const]
      }),
    )

  /** 名前でカードを探す */
  const cardNamed = (name: string): HTMLElement => {
    const card = screen.getByText(name, { selector: '.card__name' }).closest('details')
    if (!(card instanceof HTMLElement)) throw new Error(`カードが無い: ${name}`)
    return card
  }

  /** 「ながめる」の階段の段の金額（押す所の読み上げ名「2032〜2034年 998万円」から、画面の万円を読む）のいちばん大きい物 */
  const highestStepOnScreen = (): number => {
    const amounts = screen
      .getAllByRole('button')
      .map((button) => /年 ([\d,]+)万円$/.exec(button.getAttribute('aria-label') ?? '')?.[1])
      .filter((text): text is string => text !== undefined)
      .map((text) => Number(text.replace(/,/g, '')))
    if (amounts.length === 0) throw new Error('階段の段が無い')
    return Math.max(...amounts)
  }

  it('見本のまま（入力が止まっている）でも、全部のカードの見出しに重さが出て、外して計算し直した差と同じ言葉になる', async () => {
    window.location.hash = '#/plan'
    render(<AppRouter />)
    const plan = openPlanSession(localStorage, todayYearMonth(new Date())).plan
    await waitFor(() => expect(weights().size).toBe(plan.goals.length), { timeout: 20000 })

    const expected = goalImpacts(plan, planTables, appDefaults).map((impact) => {
      const text = impactText(impact)
      return text === null ? null : `${text.lead} ${text.amount ?? ''}${text.tail}`
    })
    expect([...weights().values()]).toEqual(expected)
    // 外すと上がるカード（大学資金は扶養に効く）と、いちばん高い段に関わらないカードがある
    expect([...weights().values()].some((text) => text.endsWith('上がる'))).toBe(true)
    expect([...weights().values()].some((text) => text.includes('変わらない'))).toBe(true)

    // 基準は節の頭に 1 回だけ。「ながめる」のいちばん高い段と同じ数字
    const peak = screen.getByText(/^いちばん高い段/, { selector: '.plan__peak' }).textContent ?? ''
    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    expect(peak).toBe(`いちばん高い段 ${manNumber(highestStepOnScreen() * 10000)}万円`)
  })

  it('自分の数字にする → 家を足す → 見出しに重さが出る → オフにすると「ながめる」のいちばん高い段が、出ていた数字のぶんだけ下がる → 開き直しても同じ', async () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '家を足す' }))
    const card = openCard()
    await waitFor(() => expect(weightIn(card)).toMatch(/^外すと [\d,]+万円下がる$/), {
      timeout: 20000,
    })
    const shown = Number(/([\d,]+)万円/.exec(weightIn(card))?.[1]?.replace(/,/g, ''))

    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    const withHome = highestStepOnScreen()
    fireEvent.click(screen.getByRole('link', { name: '計画' }))

    const homeCard = cardNamed('家')
    if (!homeCard.hasAttribute('open'))
      fireEvent.click(homeCard.querySelector('summary') as Element)
    fireEvent.click(within(homeCard).getByRole('checkbox', { name: '計算に入れる' }))
    // オフにしたカードは「入れると」で、同じ数字の逆向きが出る
    await waitFor(
      () => expect(weightIn(homeCard)).toBe(`入れると ${manNumber(shown * 10000)}万円上がる`),
      { timeout: 20000 },
    )

    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    expect(highestStepOnScreen()).toBe(withHome - shown)

    cleanup()
    render(<AppRouter />)
    expect(highestStepOnScreen()).toBe(withHome - shown)
  })

  it('保存が止まっているあいだは、直したカードと、消したカードの id を使い回した別のカードに前の重さを出さない', async () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '家を足す' }))
    await waitFor(() => expect(weightIn(cardNamed('家'))).toMatch(/下がる$/), { timeout: 20000 })

    // ほかのカードに欄をまたぐ問題を作って保存を止める（毎月のカードの終わりを始まりより前にする）
    fireEvent.click(screen.getByRole('button', { name: '毎月の支出を足す' }))
    const from = Number(field('から').value)
    fireEvent.change(field('まで'), { target: { value: String(from - 1) } })
    expect(screen.getByRole('status').textContent).toContain('直すまで保存しません')

    // 直した家のカードには、直す前の重さを出さない
    fireEvent.change(within(cardNamed('家')).getByLabelText(/^価格/), { target: { value: '5000' } })
    expect(weightIn(cardNamed('家'))).toBe(BLANK)

    // 家（goal-1）を消して車を足すと、車も goal-1 になる。車に家の重さを出さない
    const homeCard = cardNamed('家')
    fireEvent.click(within(homeCard).getByRole('button', { name: '消す' }))
    fireEvent.click(within(homeCard).getByRole('button', { name: '本当に消す' }))
    fireEvent.click(screen.getByRole('button', { name: '車を足す' }))
    expect(weightIn(cardNamed('車'))).toBe(BLANK)

    // 問題を直すと保存され、車の重さが出る
    fireEvent.change(field('まで'), { target: { value: String(from + 2) } })
    expect(screen.queryByRole('status')).toBeNull()
    await waitFor(() => expect(weightIn(cardNamed('車'))).toMatch(/^外す/), { timeout: 20000 })
  })
})

describe('大学資金・老後資金のカード（T10）', () => {
  beforeEach(() => {
    localStorage.clear()
    window.location.hash = ''
  })
  afterEach(() => {
    cleanup()
  })

  /** 保存した大学資金のカード */
  const storedUniversity = () =>
    (
      stored().plan.goals as {
        kind: string
        childId: string
        targetAmount: number
        allocateChildAllowance: boolean
      }[]
    ).filter((g) => g.kind === 'university')

  /** 保存を開いて計算した帯のうち、名前の合う物 */
  const bandsNamed = (label: string) => {
    const result = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!result.ok) throw new Error(result.message)
    return result.evaluation.bands.filter((band) => band.label === label)
  }

  it('自分の数字にする → 大学資金を足す → 目標額を変えると月額と到達額が変わる → 児童手当を回さないと子の費用に児童手当が出て月額が増える → 「ながめる」が変わり、開き直しても残る', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    const before = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!before.ok) throw new Error(before.message)
    // 回す前は、子の費用のカードが児童手当を収入の帯で出している
    expect(bandsNamed('児童手当（2人目）').map((band) => band.kind)).toEqual(['income'])

    fireEvent.click(screen.getByRole('button', { name: '大学資金（2人目）を足す' }))
    expect(storedUniversity().map((g) => g.childId)).toEqual(['child-2'])
    // 足したら、ボタンはその子の分が消える（子ごとに 1 枚）
    expect(screen.queryByRole('button', { name: '大学資金（2人目）を足す' })).toBeNull()
    expect(screen.getByRole('button', { name: '大学資金（1人目）を足す' })).toBeTruthy()

    const card = openCard()
    const summary = () => card.querySelector('summary')?.textContent ?? ''
    // 到達額の足し算（児童手当 ＋ 家計から足す → 使う月の到達額）
    const reach = () => within(card).getByLabelText(/の到達額$/).textContent ?? ''
    // 回すので、児童手当は子の費用の収入から外れ、大学資金のカードの earmarked になる（同じ月に両方は出ない）
    expect(bandsNamed('児童手当（2人目）').map((band) => band.kind)).toEqual(['earmarked'])
    expect(card.textContent).toContain('児童手当')
    const summaryBefore = summary()
    const reachBefore = reach()

    fireEvent.change(field('目標額'), { target: { value: '600' } })
    expect(storedUniversity()[0]?.targetAmount).toBe(6000000)
    expect(stored().touched).toContain('goals.goal-1.targetAmount')
    expect(summary()).not.toBe(summaryBefore)
    expect(reach()).not.toBe(reachBefore)
    const allocated = bandsNamed('大学資金の積立（2人目）')[0]?.monthly ?? 0

    fireEvent.click(
      within(within(card).getByRole('radiogroup', { name: /^児童手当/ })).getByRole('radio', {
        name: '回さない',
      }),
    )
    expect(storedUniversity()[0]?.allocateChildAllowance).toBe(false)
    expect(bandsNamed('児童手当（2人目）').map((band) => band.kind)).toEqual(['income'])
    expect(bandsNamed('大学資金の積立（2人目）')[0]?.monthly ?? 0).toBeGreaterThan(allocated)

    fireEvent.click(screen.getByRole('link', { name: 'ながめる' }))
    const after = evaluatePlan(openPlanSession(localStorage, todayYearMonth(new Date())).plan)
    if (!after.ok) throw new Error(after.message)
    expect(after.evaluation.years).not.toEqual(before.evaluation.years)
    const goals = screen.getByRole('list', { name: '目標' })
    expect(within(goals).getByText('大学資金（2人目）')).toBeTruthy()

    cleanup()
    window.location.hash = '#/plan'
    render(<AppRouter />)
    expect(storedUniversity()).toEqual([
      expect.objectContaining({
        childId: 'child-2',
        targetAmount: 6000000,
        allocateChildAllowance: false,
      }),
    ])
    expect(screen.getByText('大学資金（2人目）')).toBeTruthy()

    // 子を外すと、その子の大学資金のカードも消える
    const family = screen.getByRole('region', { name: '家族' })
    fireEvent.click(within(family).getByRole('button', { name: '2 人目の子を外す' }))
    fireEvent.click(within(family).getByRole('button', { name: '2 人目の子を本当に外す' }))
    expect(storedUniversity()).toEqual([])
    expect(stored().touched.some((key) => key.startsWith('goals.goal-1'))).toBe(false)
  })

  /** 進路の選択肢（名前のあとに額が続く） */
  const courseRadio = (card: HTMLElement, name: string) =>
    within(within(card).getByRole('radiogroup', { name: /^進路/ })).getByRole<HTMLInputElement>(
      'radio',
      { name: new RegExp(`^${name}`) },
    )
  /** その進路の 4 年ぶん（表から出した額。数値を直書きしない） */
  const courseTarget = (course: 'privateScience' | 'privateHumanities' | 'nationalPublic') =>
    universityCourseTarget(appDefaults, masterTables.universityCost, course)

  it('大学資金を足すと私立理系で入る → 私立文系・国立を選ぶと目標額と月の積立が替わり、保存される（D37）', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '大学資金（2人目）を足す' }))
    const card = openCard()

    // 足した直後は私立理系。選択肢に額が添えてある
    expect(courseRadio(card, '私立理系').checked).toBe(true)
    expect(courseRadio(card, '私立理系').closest('label')?.textContent).toContain(
      `${manNumber(courseTarget('privateScience'))}万円`,
    )
    expect(field('目標額').value).toBe(manNumber(courseTarget('privateScience')))
    expect(storedUniversity()[0]).toEqual(
      expect.objectContaining({
        course: 'privateScience',
        targetAmount: courseTarget('privateScience'),
      }),
    )
    const scienceMonthly = bandsNamed('大学資金の積立（2人目）')[0]?.monthly ?? NaN

    fireEvent.click(courseRadio(card, '私立文系'))
    expect(field('目標額').value).toBe(manNumber(courseTarget('privateHumanities')))
    expect(storedUniversity()[0]).toEqual(
      expect.objectContaining({
        course: 'privateHumanities',
        targetAmount: courseTarget('privateHumanities'),
      }),
    )
    expect(stored().touched).toContain('goals.goal-1.course')
    const humanitiesMonthly = bandsNamed('大学資金の積立（2人目）')[0]?.monthly ?? NaN
    expect(humanitiesMonthly).toBeLessThan(scienceMonthly)

    // 目標額を手で直すと、その欄に印が付く。進路を選び直すと進路の額で上書きされ、目標額の印は外れる
    fireEvent.change(field('目標額'), { target: { value: '500' } })
    expect(stored().touched).toContain('goals.goal-1.targetAmount')
    expect(isTouchedRow(field('目標額'))).toBe(true)
    fireEvent.click(courseRadio(card, '国立'))
    expect(field('目標額').value).toBe(manNumber(courseTarget('nationalPublic')))
    expect(storedUniversity()[0]).toEqual(
      expect.objectContaining({
        course: 'nationalPublic',
        targetAmount: courseTarget('nationalPublic'),
      }),
    )
    expect(stored().touched).not.toContain('goals.goal-1.targetAmount')
    expect(isTouchedRow(field('目標額'))).toBe(false)
    expect(bandsNamed('大学資金の積立（2人目）')[0]?.monthly ?? NaN).toBeLessThan(humanitiesMonthly)
  })

  it('進路を持たない前の保存の大学資金のカードは、どれも選ばずに開き、目標額はそのまま。選んだときに初めて替わる', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '大学資金（2人目）を足す' }))
    // 保存を T10 のころの形（進路なし・目標額 418 万円）に書き換えて、開き直す
    const raw = JSON.parse(localStorage.getItem(PLAN_STORAGE_V2_KEY) ?? '{}') as {
      plan: { goals: { kind: string; course?: string; targetAmount: number }[] }
    }
    raw.plan.goals = raw.plan.goals.map((goal) => {
      if (goal.kind !== 'university') return goal
      const { course: _course, ...old } = goal
      return { ...old, targetAmount: 4180000 }
    })
    localStorage.setItem(PLAN_STORAGE_V2_KEY, JSON.stringify(raw))
    cleanup()
    window.location.hash = '#/plan'
    render(<AppRouter />)
    const summary = screen.getByText('大学資金（2人目）').closest('summary')
    if (summary === null) throw new Error('大学資金のカードが無い')
    fireEvent.click(summary)
    const card = openCard()

    expect(field('目標額').value).toBe('418')
    for (const name of ['私立理系', '私立文系', '国立']) {
      expect(courseRadio(card, name).checked).toBe(false)
    }
    // 読み上げは「既定値のまま」でなく「選んでいない」
    expect(within(card).getByRole('radiogroup', { name: '進路（選んでいない）' })).toBeTruthy()
    // 開いただけでは保存の額は変わらない
    expect(storedUniversity()[0]).toEqual(expect.objectContaining({ targetAmount: 4180000 }))
    expect(storedUniversity()[0]).not.toHaveProperty('course')

    fireEvent.click(courseRadio(card, '私立文系'))
    expect(storedUniversity()[0]).toEqual(
      expect.objectContaining({
        course: 'privateHumanities',
        targetAmount: courseTarget('privateHumanities'),
      }),
    )
  })

  it('老後資金を足すと、期限は年上の大人の退職の年で入り、足すボタンは消える', () => {
    render(<AppRouter />)
    fireEvent.click(screen.getByRole('button', { name: '自分の数字にする' }))
    fireEvent.click(screen.getByRole('button', { name: '老後資金を足す' }))
    expect(screen.queryByRole('button', { name: '老後資金を足す' })).toBeNull()
    const card = openCard()
    expect(card.textContent).toContain('老後資金の積立')
    expect(card.textContent).toContain('家計から足す')
    expect(bandsNamed('老後資金の積立')).toHaveLength(1)
  })
})

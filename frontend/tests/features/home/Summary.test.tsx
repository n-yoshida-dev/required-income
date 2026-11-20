// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import type { StepOutlook } from '../../../src/domain/plan/stepReading'
import type { Step } from '../../../src/domain/plan/types'
import { Summary } from '../../../src/features/home/Summary'

/** 段を 1 つ作る（金額はダミー） */
const step = (overrides: Partial<Step> = {}): Step => ({
  fromYear: 2030,
  toYear: 2035,
  peakYear: 2030,
  requiredNet: 7000000,
  requiredGross: 10500000,
  expectedGross: 9000000,
  causes: [
    { goalId: 'g-car', label: '車の積立', monthlyDelta: 68000, change: 'start', monthly: 68000 },
  ],
  byGoal: [],
  ...overrides,
})

/** その先の流れ（金額はダミー） */
const flow: StepOutlook = {
  peak: { fromYear: 2033, toYear: 2036, requiredGross: 11200000 },
  peakIsLast: false,
  last: {
    fromYear: 2037,
    toYear: 2044,
    requiredGross: 9800000,
    fall: {
      index: 3,
      fromYear: 2037,
      cause: {
        goalId: 'g-car',
        label: '車のローンの返済',
        monthlyDelta: -40000,
        change: 'end',
        monthly: 40000,
      },
      others: 0,
    },
  },
}

const base = { year: 2026, month: 11 } as const

/** 既定の引数で描く（変えたい所だけ渡す） */
const renderSummary = (props: Partial<ComponentProps<typeof Summary>> = {}) =>
  render(
    <Summary
      step={step()}
      stepCount={4}
      currentGross={9000000}
      base={base}
      enoughUntil={2029}
      outlook={flow}
      {...props}
    />,
  )

/** 概要の枠 */
const region = () => screen.getByRole('region', { name: '概要' })

/** 読み上げにだけ残す字を除いた、見える字 */
const visibleText = (el: Element | null | undefined): string => {
  if (el === null || el === undefined) return ''
  const copy = el.cloneNode(true) as Element
  copy.querySelectorAll('.visually-hidden').forEach((hidden) => hidden.remove())
  return copy.textContent ?? ''
}

/** 箇条書き（外側の li だけ）の字 */
const points = () =>
  [...region().querySelectorAll('.summary__points > li')].map((li) => li.textContent)

describe('Summary（概要の枠）', () => {
  afterEach(() => {
    cleanup()
  })

  it('見出しの文：「やりたいことを全部やるには、2030年から年収 1,050万円 が要ります」と、あと何年何か月', () => {
    renderSummary()
    expect(visibleText(region().querySelector('.summary__sentence'))).toBe(
      'やりたいことを全部やるには、2030年から年収1,050万円が要りますあと3年2か月',
    )
  })

  it('「年収」の注を 1 回だけ出す。「世帯年収」の字は出さない', () => {
    renderSummary()
    expect(region().querySelectorAll('.summary__note')).toHaveLength(1)
    expect(region().querySelector('.summary__note')?.textContent).toBe(
      '年収：家族の年収の合計。税金と社会保険を引かれる前の金額',
    )
    expect(region().textContent).not.toContain('世帯年収')
  })

  it('箇条書き 3 つ：今の年収との差と足りる年／その年に変わること／その先の流れ', () => {
    renderSummary()
    expect(points()).toEqual([
      '今の年収 900万円より 150万円多い金額です。2029年までは今の年収で足ります',
      '2030年に変わること車の積立が始まる月6.8万円',
      'いちばん高いのは 2033年からの 1,120万円。2037年からは、車のローンの返済が終わるので 980万円に下がります',
    ])
  })

  it('次の段が最初の段なら「足ります」を言わない。理由が無ければ 2 つ目、流れが無ければ 3 つ目を出さない', () => {
    renderSummary({ step: step({ causes: [] }), enoughUntil: null, outlook: null })
    expect(points()).toEqual(['今の年収 900万円より 150万円多い金額です'])
  })

  it('理由は「2030年に変わること」の下に、名前と動きの 1 つの言い回しと月額。記号は付けない', () => {
    renderSummary({
      step: step({
        causes: [
          {
            goalId: 'g-home',
            label: '返済',
            monthlyDelta: 150000,
            change: 'start',
            monthly: 150000,
          },
          { goalId: 'living', label: '家賃', monthlyDelta: -90000, change: 'end', monthly: 90000 },
          {
            goalId: 'g-child',
            label: '学校（1人目）',
            monthlyDelta: -20000,
            change: 'end',
            monthly: 30000,
          },
          {
            goalId: 'g-child',
            label: '児童手当（2人目）',
            monthlyDelta: 10000,
            change: 'end',
            monthly: 10000,
          },
        ],
      }),
    })
    expect(region().querySelector('.summary__cause-head')?.textContent).toBe('2030年に変わること')
    const rows = [...region().querySelectorAll('.summary__causes li')].map((row) => row.textContent)
    // 終わる帯は終わる前の月額（差ではない）。収入の帯は「受け取り」
    expect(rows).toEqual([
      '返済が始まる月15万円',
      '家賃が終わる月9万円',
      '学校（1人目）の費用が終わる月3万円',
      '児童手当（2人目）の受け取りが終わる月1万円',
    ])
    expect(region().querySelector('.summary__causes')?.textContent).not.toMatch(/[+−↓]/)
  })

  it('3 桁の金額は大きい字、4 桁の金額と「届かない」は 1 段小さい字（幅に収める）', () => {
    const { rerender } = renderSummary({ step: step({ requiredGross: 9980000 }) })
    expect(region().classList.contains('is-long')).toBe(false)
    rerender(
      <Summary
        step={step()}
        stepCount={4}
        currentGross={9000000}
        base={base}
        enoughUntil={2029}
        outlook={flow}
      />,
    )
    expect(region().classList.contains('is-long')).toBe(true)
    rerender(
      <Summary
        step={step({ requiredGross: null })}
        stepCount={4}
        currentGross={9000000}
        base={base}
        enoughUntil={2029}
        outlook={flow}
      />,
    )
    expect(region().classList.contains('is-long')).toBe(true)
  })

  it('起点の年に始まる段は、文の「2026年から」と重なるので「あと◯年◯か月」も「今から」も出さない', () => {
    renderSummary({ step: step({ fromYear: 2026 }), enoughUntil: null })
    expect(visibleText(region().querySelector('.summary__sentence'))).toBe(
      'やりたいことを全部やるには、2026年から年収1,050万円が要ります',
    )
    expect(region().querySelector('.summary__left')).toBeNull()
    expect(region().textContent).not.toContain('今から')
  })

  it('解けない段が起点の年に始まるときは、「届かない」の下に 1 語だけ浮く行を出さない', () => {
    renderSummary({ step: step({ fromYear: 2026, requiredGross: null }), enoughUntil: null })
    expect(visibleText(region().querySelector('.summary__sentence'))).toBe(
      'やりたいことを全部やると、2026年からは、年収をいくら上げても届かない',
    )
    expect(region().querySelector('.summary__verb')).toBeNull()
  })

  it('解けない段は「…年収をいくら上げても 届かない」。1 つ目の箇条書きは今の年収だけと足りる年', () => {
    renderSummary({ step: step({ requiredGross: null }) })
    expect(visibleText(region().querySelector('.summary__sentence'))).toBe(
      'やりたいことを全部やると、2030年からは、年収をいくら上げても届かないあと3年2か月',
    )
    expect(points()[0]).toBe('今の年収は 900万円です。2029年までは今の年収で足ります')
  })

  it('次の段が無ければ「やりたいことを全部やっても、今の年収 900万円で足ります」と注だけ', () => {
    renderSummary({ step: null, enoughUntil: null, outlook: null })
    expect(region().querySelector('.summary__headline')?.textContent).toBe(
      'やりたいことを全部やっても、今の年収 900万円で足ります',
    )
    expect(region().querySelectorAll('.summary__note')).toHaveLength(1)
    expect(region().querySelector('.summary__points')).toBeNull()
  })

  it('段が 1 つも無ければ「足ります」とは出さず、要る年収を出す年が無いことだけを文で出す', () => {
    renderSummary({ step: null, stepCount: 0, currentGross: 0, enoughUntil: null, outlook: null })
    expect(region().textContent).toBe(
      '大人がみな退職の年齢を過ぎているので、要る年収を出す年がありません',
    )
  })
})

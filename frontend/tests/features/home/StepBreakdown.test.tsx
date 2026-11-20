// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { Step, StepConversions } from '../../../src/domain/plan/types'
import { StepBreakdown } from '../../../src/features/home/StepBreakdown'

/** 段を 1 つ作る（金額はダミー） */
const step = (overrides: Partial<Step> = {}): Step => ({
  fromYear: 2031,
  toYear: 2033,
  peakYear: 2031,
  requiredNet: 8000000,
  requiredGross: 11000000,
  expectedGross: 9000000,
  causes: [],
  byGoal: [
    { goalId: 'living', annual: 3000000 },
    { goalId: 'g-home', annual: 5000000 },
  ],
  ...overrides,
})

/** 換算 3 つ（金額はダミー） */
const conversions = (overrides: Partial<StepConversions> = {}): StepConversions => ({
  fromYear: 2031,
  shortfallNet: 1500000,
  mainJob: { personId: 'a', current: 6000000, required: 8000000, increase: 2000000 },
  sideJob: { personId: 'a', current: 0, required: 150000, increase: 150000 },
  otherAdult: { personId: 'b', current: 3000000, required: 5500000, increase: 2500000 },
  ...overrides,
})

const names = new Map([
  ['living', '暮らし'],
  ['g-home', '家'],
])

/** 内訳の面の文字 */
const regionText = () =>
  screen.getByRole('region', { name: '2031〜2033年の内訳' }).textContent ?? ''

describe('StepBreakdown', () => {
  afterEach(() => {
    cleanup()
  })

  it('1 年だけの段の見出しは「2031年」（「2031〜2031年」と出さない）', () => {
    render(
      <StepBreakdown
        step={step({ fromYear: 2031, toYear: 2031 })}
        conversions={null}
        names={names}
      />,
    )
    const region = screen.getByRole('region', { name: '2031年の内訳' })
    expect(region.querySelector('.breakdown__years')?.textContent).toBe('2031年')
  })

  it('目標ごとの年額（大きい順）→ 1年にかかるお金 → ＋ 引かれる税金・社会保険 → 要る年収 を出す。税は 要る年収 − かかるお金', () => {
    render(<StepBreakdown step={step()} conversions={conversions()} names={names} />)
    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
    expect(items.slice(0, 5)).toEqual([
      '家500万円',
      '暮らし300万円',
      '1年にかかるお金800万円',
      '＋ 引かれる税金・社会保険300万円',
      '要る年収いちばん稼ぐ人の収入を上げた場合1,100万円',
    ])
    expect(regionText()).not.toContain('世帯年収')
    expect(regionText()).not.toContain('手取り')
  })

  it('見込みで届かない段：見込みの年収と足りない額、換算 3 つ、断り書き 2 つを出す', () => {
    render(<StepBreakdown step={step()} conversions={conversions()} names={names} />)
    const text = regionText()
    expect(text).toContain('見込みの年収900万円')
    expect(text).toContain('200万円足りない')
    expect(text).toContain('いちばん稼ぐ人の収入を上げた場合')

    const fills = within(screen.getByRole('list', { name: '埋め方の換算' }))
      .getAllByRole('listitem')
      .map((item) => item.textContent ?? '')
    expect(fills).toEqual([
      '本業を上げるなら年 +200万円600万円 → 800万円',
      // 今の副業が 0 なので + を付けず、範囲も出さない。断り書きは副業の行のそば
      '副業なら月 15万円個人事業税は含まない',
      'もう 1 人の収入を上げるなら年 +250万円300万円 → 550万円',
    ])
  })

  it('画面の万円どうしで足し引きが合う（行の和 ＝ かかるお金、かかるお金 ＋ 税 ＝ 要る年収、換算の差 ＝ 範囲の差）', () => {
    // 行を四捨五入すると 312・264・159（和 735）だが、手取りは 735.9 → 736。端数のいちばん大きい 312 の行に 1 万円配る
    render(
      <StepBreakdown
        step={step({
          byGoal: [
            { goalId: 'living', annual: 3124000 },
            { goalId: 'g-home', annual: 2643000 },
            { goalId: 'g-car', annual: 1592000 },
          ],
          requiredNet: 7359000,
          requiredGross: 10004000,
          expectedGross: 8996000,
        })}
        conversions={conversions({
          // 増える額は 372.2 万円だが、画面の範囲は 530 → 903 なので +373 と出す
          mainJob: { personId: 'a', current: 5304000, required: 9026000, increase: 3722000 },
        })}
        names={new Map([...names, ['g-car', '車']])}
      />,
    )
    const items = screen.getAllByRole('listitem').map((item) => item.textContent ?? '')
    expect(items.slice(0, 6)).toEqual([
      '暮らし313万円',
      '家264万円',
      '車159万円',
      '1年にかかるお金736万円',
      '＋ 引かれる税金・社会保険264万円',
      '要る年収いちばん稼ぐ人の収入を上げた場合1,000万円',
    ])
    const text = regionText()
    expect(text).toContain('見込みの年収900万円')
    expect(text).toContain('100万円足りない')
    expect(items).toContain('本業を上げるなら年 +373万円530万円 → 903万円')
  })

  it('見込みで届いている段：換算と足りない額を出さない', () => {
    render(
      <StepBreakdown
        step={step({ requiredGross: 8500000, requiredNet: 6500000 })}
        conversions={null}
        names={names}
      />,
    )
    expect(screen.queryByRole('list', { name: '埋め方の換算' })).toBeNull()
    const text = regionText()
    expect(text).toContain('見込みの年収900万円')
    expect(text).not.toContain('足りない')
    expect(text).not.toContain('個人事業税は含まない')
  })

  it('換算が null の埋め方（もう 1 人が働いていないなど）は行を出さない', () => {
    render(
      <StepBreakdown
        step={step()}
        conversions={conversions({ otherAdult: null, sideJob: null })}
        names={names}
      />,
    )
    const fills = within(screen.getByRole('list', { name: '埋め方の換算' })).getAllByRole(
      'listitem',
    )
    expect(fills).toHaveLength(1)
    expect(fills[0]?.textContent).toContain('本業を上げるなら')
    expect(regionText()).not.toContain('個人事業税は含まない')
  })

  it('解けない段：要る年収は「届かない」、税金・社会保険の行は出さない', () => {
    render(
      <StepBreakdown
        step={step({ requiredGross: null })}
        conversions={conversions({ mainJob: null })}
        names={names}
      />,
    )
    const text = regionText()
    expect(text).toContain('届かない')
    expect(text).not.toContain('社会保険')
    expect(text).not.toContain('足りない')
    expect(text).toContain('副業なら')
    expect(text).not.toContain('本業を上げるなら')
  })
})

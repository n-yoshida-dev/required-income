import { describe, expect, it } from 'vitest'
import type { FallingStep, StepOutlook } from '../../../src/domain/plan/stepReading'
import type { StepCause } from '../../../src/domain/plan/types'
import {
  BREAKDOWN_WORDS,
  enoughLines,
  enoughUntilText as enoughUntilChunks,
  gapPoint as gapPointSentences,
  gapText as gapChunks,
  INCOME_NOTE,
  NO_STEPS_TEXT,
  outlookText as outlookSentences,
  REQUIRED_VERB,
  requiredLead,
  sentenceText,
  stairsTitle,
} from '../../../src/features/home/nextStepText'

// 文はかたまりの並びで返る。ここでは、つないだ字で比べる（かたまりの切れ目は下の 1 本で確かめる）
const gapPoint = (...args: Parameters<typeof gapPointSentences>) =>
  sentenceText(gapPointSentences(...args))
const gapText = (...args: Parameters<typeof gapChunks>) => gapChunks(...args).join('')
const enoughUntilText = (year: number) => enoughUntilChunks(year).join('')
const outlookText = (...args: Parameters<typeof outlookSentences>) => {
  const said = outlookSentences(...args)
  return said === null ? null : sentenceText(said)
}

/** 下げる理由を持つ下がり方（金額はダミー） */
const fallBy = (label: string, fromYear: number, others = 0): FallingStep => {
  const cause: StepCause = {
    goalId: `g-${label}`,
    label,
    monthlyDelta: -43000,
    change: 'end',
    monthly: 43000,
  }
  return { index: 4, fromYear, cause, others }
}

/** 流れを作る（金額はダミー） */
const outlook = (overrides: Partial<StepOutlook> = {}): StepOutlook => ({
  peak: { fromYear: 2032, toYear: 2034, requiredGross: 9980000 },
  peakIsLast: false,
  last: {
    fromYear: 2035,
    toYear: 2044,
    requiredGross: 9380000,
    fall: fallBy('車のローンの返済', 2035),
  },
  ...overrides,
})

describe('nextStepText（概要の枠と図の題の言葉。金額はダミー）', () => {
  it('見出しの文：「やりたいことを全部やるには、2029年から年収 ◯万円 が要ります」', () => {
    expect(requiredLead(2029, true)).toEqual(['やりたいことを全部やるには、', '2029年から年収'])
    expect(REQUIRED_VERB).toBe('が要ります')
  })

  it('解けない段は「年収をいくら上げても」（そのあとに「届かない」）', () => {
    expect(requiredLead(2031, false)).toEqual([
      'やりたいことを全部やると、',
      '2031年からは、',
      '年収をいくら上げても',
    ])
  })

  it('1 つ目の箇条書き：「今の年収 900万円より 48万円多い金額です。2028年までは今の年収で足ります」', () => {
    expect(gapPoint(9000000, 9480000, 2028)).toBe(
      '今の年収 900万円より 48万円多い金額です。2028年までは今の年収で足ります',
    )
    // 次の段が最初の段なら後半を出さない
    expect(gapPoint(9000000, 9480000, null)).toBe('今の年収 900万円より 48万円多い金額です')
  })

  it('4 桁の金額はカンマを付ける', () => {
    expect(gapText(11100000, 15010000)).toBe('今の年収 1,110万円より 391万円多い金額です')
  })

  it('差が 0 以下（四捨五入で同じ万円）なら「ほぼ同じ金額です」、解けない段は今の年収だけ', () => {
    expect(gapText(9000000, 9000000)).toBe('今の年収 900万円とほぼ同じ金額です')
    expect(gapText(9000000, null)).toBe('今の年収は 900万円です')
    expect(gapPoint(9000000, null, 2028)).toBe(
      '今の年収は 900万円です。2028年までは今の年収で足ります',
    )
  })

  it('「2028年までは今の年収で足ります」', () => {
    expect(enoughUntilText(2028)).toBe('2028年までは今の年収で足ります')
  })

  it('足りている・段が無いときも同じ調子の文', () => {
    expect(enoughLines(9000000).join('')).toBe(
      'やりたいことを全部やっても、今の年収 900万円で足ります',
    )
    expect(NO_STEPS_TEXT).toMatch(/ありません$/)
  })

  it('3 つ目の箇条書き：いちばん高い段と、最後に落ち着く段（見本の世帯の形）', () => {
    expect(outlookText(outlook())).toBe(
      'いちばん高いのは 2032年からの 998万円。2035年からは、車のローンの返済が終わるので 938万円に下がります',
    )
  })

  it('次の段がいちばん高いなら、最後の段だけを言う', () => {
    expect(outlookText(outlook({ peak: null }))).toBe(
      '2035年からは、車のローンの返済が終わるので 938万円に下がります',
    )
  })

  it('いちばん高い段が最後の段なら「◯年まで続きます」', () => {
    expect(
      outlookText(
        outlook({
          peak: { fromYear: 2032, toYear: 2044, requiredGross: 9980000 },
          peakIsLast: true,
          last: null,
        }),
      ),
    ).toBe('いちばん高いのは 2032年からの 998万円で、2044年まで続きます')
  })

  it('最後の段が下がらない（前の段より高い）なら「◯年からは ◯万円です」、下げる理由が無ければ金額だけ', () => {
    const last = { fromYear: 2040, toYear: 2044, requiredGross: 9600000 }
    expect(outlookText(outlook({ last: { ...last, fall: null } }))).toBe(
      'いちばん高いのは 2032年からの 998万円。2040年からは 960万円です',
    )
    expect(
      outlookText(outlook({ last: { ...last, fall: { ...fallBy('塾', 2040), cause: null } } })),
    ).toBe('いちばん高いのは 2032年からの 998万円。2040年からは 960万円に下がります')
  })

  it('ほかにも下げる理由があれば「など」', () => {
    expect(
      outlookText(
        outlook({
          peak: null,
          last: {
            fromYear: 2031,
            toYear: 2044,
            requiredGross: 8300000,
            fall: fallBy('学校（2人目）', 2031, 2),
          },
        }),
      ),
    ).toBe('2031年からは、学校（2人目）の費用などが終わるので 830万円に下がります')
  })

  it('解けない段は「年収をいくら上げても届きません」', () => {
    expect(
      outlookText(
        outlook({ peak: { fromYear: 2032, toYear: 2034, requiredGross: null }, last: null }),
      ),
    ).toBe('2032年からは、年収をいくら上げても届きません')
    expect(
      outlookText(
        outlook({
          peak: null,
          last: { fromYear: 2040, toYear: 2044, requiredGross: null, fall: null },
        }),
      ),
    ).toBe('2040年からは、年収をいくら上げても届きません')
  })

  it('文ごとに分け、文の中は文節のかたまりで返す（画面はかたまりの間だけで折り返す。数字と単位は同じかたまり。T22）', () => {
    expect(gapPointSentences(9000000, 9480000, 2028)).toEqual([
      ['今の年収 ', '900万円より ', '48万円', '多い', '金額です。'],
      ['2028年までは', '今の年収で', '足ります'],
    ])
    expect(outlookSentences(outlook())).toEqual([
      ['いちばん', '高いのは ', '2032年からの ', '998万円。'],
      ['2035年からは、', '車のローンの返済が', '終わるので ', '938万円に', '下がります'],
    ])
    // 数字は単位と離れない（数字で終わるかたまり・数字で始まって単位が無いかたまりを作らない）
    const chunks = [
      ...gapPointSentences(9000000, 9480000, 2028),
      ...gapPointSentences(9000000, 9000000, 2028),
      ...gapPointSentences(9000000, null, 2028),
      ...(outlookSentences(outlook()) ?? []),
    ].flat()
    expect(chunks.filter((chunk) => /[0-9]\s*$/.test(chunk))).toEqual([])
  })

  it('流れが無ければ null（箇条書きを出さない）', () => {
    expect(outlookText(null)).toBeNull()
    expect(outlookText(outlook({ peak: null, last: null }))).toBeNull()
  })

  it('「年収」の注と図の題。画面の言葉に「世帯年収」を使わない', () => {
    expect(INCOME_NOTE.join('')).toBe('年収：家族の年収の合計。税金と社会保険を引かれる前の金額')
    expect(stairsTitle(2044)).toBe('この先、年収がいくら要るか（2044年まで）')
    const all = [
      ...requiredLead(2029, true),
      ...requiredLead(2029, false),
      REQUIRED_VERB,
      gapPoint(9000000, 9480000, 2028),
      outlookText(outlook()) ?? '',
      ...enoughLines(9000000),
      NO_STEPS_TEXT,
      ...INCOME_NOTE,
      stairsTitle(2044),
      ...Object.values(BREAKDOWN_WORDS),
    ].join('\n')
    expect(all).not.toContain('世帯年収')
    expect(all).not.toContain('手取り')
  })
})

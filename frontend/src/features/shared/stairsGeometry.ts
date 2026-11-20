/**
 * 階段の図の形を計算する（SPEC §4.1 の 2）。横が年、縦が世帯年収（0 円から）。
 *
 * 描くのは `StairsChart.tsx`。面と線は SVG を枠いっぱいに伸ばして描き（`viewBox` は `FRAME_SIZE` の正方形）、
 * 金額・年・押す所は HTML で上に重ねる（幅が変わっても字の大きさが変わらない。DESIGN.md「階段の図」）。
 * そのため座標は「枠に対する割合（0〜1）」で返し、SVG の線だけ `FRAME_SIZE` を掛けた値の文字列で返す。
 * 色・線の太さ・字の大きさは CSS が持ち、ここは座標と、字を書くかどうかだけを持つ。
 */

import type { Step } from '../../domain/plan/types'
import { manNumber } from './format'

/** SVG の `viewBox` の 1 辺（縦横とも。`preserveAspectRatio="none"` で枠に合わせて伸ばす） */
export const FRAME_SIZE = 1000

/**
 * 金額の書き方 1 つぶんに要る段の幅。字の大きさ（普通か 1 段小さいか）と、押せる印（v）を添えるか
 */
export type LabelFit = { width: number; small: boolean; caret: boolean }

/** 図の決まり（割合はどれも図の幅に対する値） */
export type StairsRules = {
  /**
   * 3 桁までの金額の書き方。上から順に、入る幅の物を使う（どれも入らない段は書かず、押して内訳で見る）。
   * 普通の字と印 → 1 段小さい字と印 → 1 段小さい字だけ
   */
  shortLabelFits: readonly LabelFit[]
  /** 4 桁（1,000万円以上）の金額の書き方。いつも 1 段小さい字（印あり → 印なし） */
  longLabelFits: readonly LabelFit[]
  /** 段の下に始まりの年（「2031」）を書くのに要る段の幅 */
  minYearLabelWidth: number
  /**
   * 押す所の最低の幅。線と面は年数に比例のまま、押す所だけこの幅まで広げ、足りない分は両隣の段の押す所から譲る。
   * 段が多すぎて全部に取れないときは、押す所を等分にする
   */
  minHitWidth: number
  /** 右下に最後の年（「〜2044」）を書くのに要る、最後の段の幅（最後の段の始まりの年と重ならないため） */
  minEndLabelWidth: number
  /** 「見込み ◯万円」の札を置くのに要る段の幅 */
  minExpectedLabelWidth: number
  /**
   * 解けない段があるとき、縦の目盛りの最大に足す割合。解けない段は枠の上端まで伸ばすので、
   * 見込みがいちばん高い値でも、見込みの線より上に足りない分の色が必ず出るようにする
   */
  unsolvedHeadroom: number
  /**
   * 比べる相手（「見直す」の今の計画）の線を描くのに要る、案の線との高さの差（図の高さに対する割合）。
   * これより近い所は描かない（同じ太さの線が少しずれて重なると、太い 1 本に見える）
   */
  minCompareGap: number
  /**
   * 比べる相手の線を避けて「見込み ◯万円」の札を置くときの、札の高さの帯（図の高さに対する割合）。
   * 札の字（1.25rem）と線からの間（0.25rem）を、いちばん低い図（「見直す」のスマホの 5.5rem）で割った値に余裕を足した
   */
  expectedLabelBand: number
}

/**
 * 既定の決まり。いちばん狭く見る幅 360px のスマホ（図の幅 328px）で、本文の字の数字（幅の広い方。DESIGN.md「Typography」）の
 * 実際の字の幅を測り、左右に 2px ずつの余白を足した（2026-11-17。「936」普通の字と印 39.3px・小さい字と印 33.8px・小さい字だけ 24.8px、
 * 「1,016」小さい字と印 46.6px・小さい字だけ 37.6px、「2031」30.9px）。
 * 0.135 は約 44px、0.118 は約 39px、0.09 は約 30px、0.157 は約 51px、0.13 は約 43px、0.105 は約 34px、押す所の 0.075 は約 25px（24px 以上）
 */
export const STAIRS_RULES: StairsRules = {
  shortLabelFits: [
    { width: 0.135, small: false, caret: true },
    { width: 0.118, small: true, caret: true },
    { width: 0.09, small: true, caret: false },
  ],
  longLabelFits: [
    { width: 0.157, small: true, caret: true },
    { width: 0.13, small: true, caret: false },
  ],
  minYearLabelWidth: 0.105,
  minHitWidth: 0.075,
  minEndLabelWidth: 0.25,
  minExpectedLabelWidth: 0.33,
  unsolvedHeadroom: 0.15,
  // 「見直す」のスマホの図（5.5rem ＝ 88px）で約 3px
  minCompareGap: 0.035,
  // 1.5rem（24px）÷ 88px ≒ 0.27 に余裕を足した
  expectedLabelBand: 0.3,
}

/** 段 1 つぶんの形。位置と高さは枠に対する割合 */
export type StairBar = {
  /** `steps` の中の位置 */
  index: number
  /** 左端（0〜1。図の幅に対する割合）。線と面を描く位置（年数に比例） */
  x: number
  /** 幅（0〜1） */
  width: number
  /** 押す所の左端（0〜1）。狭い段は両隣から譲ってもらって広げるので、描く位置とずれることがある */
  hitX: number
  /** 押す所の幅（0〜1）。`minHitWidth` 以上（段が多すぎるときは等分） */
  hitWidth: number
  /** 要る世帯年収の高さ（0〜1。0 円が 0、枠の上端が 1）。解けない段は 1 */
  top: number
  /** 見込みの世帯年収の高さ（0〜1） */
  expected: number
  /** 見込みでも届かないとき true（足りない所に色を付け、金額を段の上に書く） */
  short: boolean
  /** 解けない段（上限まで上げても届かない） */
  unsolved: boolean
  /** 金額（万円の数字）。狭い段は null */
  valueLabel: string | null
  /** 金額を 1 段小さい字で書く（4 桁、または狭い段の 3 桁） */
  smallLabel: boolean
  /** 金額に押せる印（v）を添えるか。印だけを出すことはしない（どの段の印か読みにくいため） */
  caret: boolean
  /** 段の下に書く年。狭い段は null */
  yearLabel: string | null
}

/** 足りない所の四角（SVG の座標） */
export type GapRect = { x: number; y: number; width: number; height: number }

/** 「見込み ◯万円」の札 */
export type ExpectedLabel = {
  /** どの段に置くか（`bars` の位置）。札はその段の右端に揃える */
  index: number
  /** 見込みの金額（万円の数字） */
  value: string
  /** 見込みの線の上に置くか、下に置くか（届かない段では、上は足りない色の面なので下） */
  placement: 'above' | 'below'
}

/** 図の全体 */
export type StairsGeometry = {
  bars: StairBar[]
  /** 要る世帯年収の階段の線（SVG の path の d） */
  profilePath: string
  /** 階段の面（線の下から 0 円まで） */
  massPath: string
  /** 見込みでも届かない所 */
  gapRects: GapRect[]
  /** 見込みの世帯年収の線。段ごとの値を階段状につなぐ */
  expectedPath: string
  /** 右下に書く最後の年（「〜2044」）。最後の段が狭ければ null */
  endYearLabel: string | null
  /** 見込みの札。置ける段が無ければ null */
  expectedLabel: ExpectedLabel | null
  /**
   * 比べる相手（「見直す」の今の計画）の要る世帯年収の線。`steps` と同じ目盛り（横の年・縦の 0 円から）で描く。
   * 比べる相手が無ければ空文字
   */
  comparePath: string
}

/** 線を描くのに要る段の形（横の位置・幅・高さ） */
type StairOutline = Pick<StairBar, 'x' | 'width' | 'top'>

/** 解けない段の金額の代わりに書く記号 */
const UNSOLVED_LABEL = '—'

/**
 * 段の並びから図の形を作る。段が無ければ棒も線も無い形を返す。
 *
 * `compare`（「見直す」の今の計画）を渡すと、その要る世帯年収の線（`comparePath`）も返す。
 * 目盛りは 2 つに共通にする（横は 2 つの年を合わせた幅、縦は 0 円から 2 つのいちばん高い所まで）。押す所・字・札は `steps` だけから決める
 */
export function stairsGeometry(
  steps: readonly Step[],
  rules = STAIRS_RULES,
  compare: readonly Step[] = [],
): StairsGeometry {
  const first = steps[0]
  const last = steps[steps.length - 1]
  if (first === undefined || last === undefined) {
    return {
      bars: [],
      profilePath: '',
      massPath: '',
      gapRects: [],
      expectedPath: '',
      endYearLabel: null,
      expectedLabel: null,
      comparePath: '',
    }
  }

  // 比べる相手と合わせた目盛り（比べる相手が無ければ steps だけ）
  const all = [...steps, ...compare]
  const startYear = Math.min(...all.map((step) => step.fromYear))
  const yearSpan = Math.max(...all.map((step) => step.toYear)) + 1 - startYear
  const xOf = (year: number): number => (year - startYear) / yearSpan

  const highest = Math.max(
    1,
    ...all.map((step) => Math.max(step.requiredGross ?? 0, step.expectedGross)),
  )
  // 解けない段は上端まで伸ばす。見込みが上端に並ばないよう、目盛りの最大に余白を足す
  const hasUnsolved = all.some((step) => step.requiredGross === null)
  const maxValue = hasUnsolved ? highest * (1 + rules.unsolvedHeadroom) : highest
  const heightOf = (yen: number): number => Math.max(0, yen) / maxValue

  const spans = steps.map((step) => {
    const x = xOf(step.fromYear)
    return { x, width: xOf(step.toYear + 1) - x }
  })
  const hits = hitAreas(
    spans.map((span) => span.width),
    rules.minHitWidth,
  )

  const bars = steps.map((step, index): StairBar => {
    const { x, width } = spans[index] ?? { x: 0, width: 0 }
    const hit = hits[index] ?? { x, width }
    const unsolved = step.requiredGross === null
    const text = step.requiredGross === null ? UNSOLVED_LABEL : manNumber(step.requiredGross)
    // 4 桁（カンマを除いて 4 文字以上）は 4 桁の書き方の中から、入る幅の物を選ぶ
    const longLabel = text.replace(/,/g, '').length >= 4
    const fit = (longLabel ? rules.longLabelFits : rules.shortLabelFits).find(
      (candidate) => width >= candidate.width,
    )
    return {
      index,
      x,
      width,
      hitX: hit.x,
      hitWidth: hit.width,
      top: step.requiredGross === null ? 1 : heightOf(step.requiredGross),
      expected: heightOf(step.expectedGross),
      short: step.requiredGross === null || step.requiredGross > step.expectedGross,
      unsolved,
      valueLabel: fit === undefined ? null : text,
      smallLabel: fit?.small ?? false,
      caret: fit?.caret ?? false,
      yearLabel: width >= rules.minYearLabelWidth ? String(step.fromYear) : null,
    }
  })

  const lastBar = bars[bars.length - 1]
  // 比べる相手の段の形（案と同じ目盛り）
  const compareOutlines: StairOutline[] = compare.map((step) => {
    const x = xOf(step.fromYear)
    return {
      x,
      width: xOf(step.toYear + 1) - x,
      top: step.requiredGross === null ? 1 : heightOf(step.requiredGross),
    }
  })
  return {
    bars,
    profilePath: profile(bars),
    massPath: `${profile(bars)} V${FRAME_SIZE} H0 Z`,
    gapRects: bars
      .filter((bar) => bar.short && bar.expected < bar.top)
      .map((bar) => ({
        x: sx(bar.x),
        y: sy(bar.top),
        width: round(bar.width * FRAME_SIZE),
        height: round((bar.top - bar.expected) * FRAME_SIZE),
      })),
    expectedPath: bars
      .map((bar, index) => {
        const head = index === 0 ? 'M' : 'L'
        return `${head}${sx(bar.x)} ${sy(bar.expected)} H${sx(bar.x + bar.width)}`
      })
      .join(' '),
    endYearLabel:
      lastBar !== undefined && lastBar.width >= rules.minEndLabelWidth ? `〜${last.toYear}` : null,
    expectedLabel: expectedLabelOf(bars, steps, rules, compareOutlines),
    comparePath: compareLine(bars, compareOutlines, rules.minCompareGap),
  }
}

/**
 * 比べる相手の線（SVG の path）。案の線とほとんど同じ高さの所（差が `minGap` に満たない）は描かない
 * （同じ太さの線が少しずれて重なると、太い 1 本に見えるため）。描く所だけを、年の切れ目ごとに横線でつなぐ
 */
function compareLine(
  bars: readonly StairOutline[],
  compare: readonly StairOutline[],
  minGap: number,
): string {
  if (compare.length === 0) return ''
  // 2 つの段の切れ目をすべて集め、その間ごとに描くかを決める
  const edges = [...bars, ...compare]
    .flatMap((outline) => [outline.x, outline.x + outline.width])
    .map((edge) => round(edge * FRAME_SIZE))
  const cuts = [...new Set(edges)].sort((a, b) => a - b)
  const topAt = (outlines: readonly StairOutline[], at: number): number | undefined =>
    outlines.find(
      (outline) => outline.x * FRAME_SIZE <= at && at < (outline.x + outline.width) * FRAME_SIZE,
    )?.top
  const parts: string[] = []
  let drawing = false
  for (let i = 0; i + 1 < cuts.length; i++) {
    const from = cuts[i] ?? 0
    const to = cuts[i + 1] ?? 0
    const middle = (from + to) / 2
    const top = topAt(compare, middle)
    const own = topAt(bars, middle)
    const visible = top !== undefined && (own === undefined || Math.abs(top - own) >= minGap)
    if (!visible) {
      drawing = false
      continue
    }
    parts.push(drawing ? `V${sy(top)} H${to}` : `M${from} ${sy(top)} H${to}`)
    drawing = true
  }
  return parts.join(' ')
}

/**
 * 「見込み ◯万円」の札を置く段を選ぶ。線にも足りない色にも、比べる相手の線にも重ならない所にする（置ける所が無ければ出さない）。
 * 届いている広い段の、見込みの線の上（後ろの段ほど先に選ぶ。右端に札があると線の終わりと読める）。
 * 届いている広い段に置けなければ、届かない広い段の線の下（線の上は足りない色の面のため）
 */
function expectedLabelOf(
  bars: readonly StairBar[],
  steps: readonly Step[],
  rules: StairsRules,
  compare: readonly StairOutline[],
): ExpectedLabel | null {
  const wide = [...bars].reverse().filter((bar) => bar.width >= rules.minExpectedLabelWidth)
  const candidates = [...wide.filter((bar) => !bar.short), ...wide.filter((bar) => bar.short)]
  const chosen = candidates.find((bar) => !compareCrossesLabel(bar, compare, rules))
  if (chosen === undefined) return null
  const step = steps[chosen.index]
  if (step === undefined) return null
  return {
    index: chosen.index,
    value: manNumber(step.expectedGross),
    placement: chosen.short ? 'below' : 'above',
  }
}

/**
 * その段に札を置くと、比べる相手の線が札の高さの帯を通るか。札の帯は、見込みの線から上（届く段）か下（届かない段）へ `expectedLabelBand`。
 * 段の幅の中にある比べる相手の横線が帯の中にあるか、段の中の段差が帯をまたぐと通る（線を描かない所も、念のため通るとみなす）
 */
function compareCrossesLabel(
  bar: StairBar,
  compare: readonly StairOutline[],
  rules: StairsRules,
): boolean {
  const low = bar.short ? bar.expected - rules.expectedLabelBand : bar.expected
  const high = bar.short ? bar.expected : bar.expected + rules.expectedLabelBand
  const inside = compare.filter(
    (outline) => outline.x < bar.x + bar.width && outline.x + outline.width > bar.x,
  )
  if (inside.some((outline) => outline.top >= low && outline.top <= high)) return true
  return inside.some((outline, i) => {
    const next = inside[i + 1]
    if (next === undefined) return false
    return Math.min(outline.top, next.top) < low && Math.max(outline.top, next.top) > high
  })
}

/**
 * 押す所の位置と幅を決める。描く幅（年数に比例。和が 1）を受け取り、どの押す所も `minWidth` 以上にして、
 * 左から右へすき間なく並べる（和は 1 のまま）。足りない段は、隣の段の押す所との境目を動かして広げる。
 *
 * 境目の動きがいちばん小さくなる形にする：境目 b_i を、i 番目の境目から `i × minWidth` を引いた値が単調に増えるように直す
 * （単調回帰。隣り合う違反をまとめて平均する）。狭い段が端にあれば片側だけ、真ん中なら両側の境目が動く。
 * 狭い段が続くときは、その両側の広い段からまとめて譲る。段が多すぎて全部に `minWidth` を取れないときは等分にする。
 */
export function hitAreas(
  widths: readonly number[],
  minWidth: number,
): { x: number; width: number }[] {
  const count = widths.length
  if (count === 0) return []
  const min = Math.min(minWidth, 1 / count)
  // 内側の境目（1〜count−1 番目）を、i × min を引いた値にして単調に直す
  const targets: number[] = []
  let edge = 0
  for (let i = 1; i < count; i++) {
    edge += widths[i - 1] ?? 0
    targets.push(edge - i * min)
  }
  const shifted = isotonic(targets).map((value) => Math.min(Math.max(value, 0), 1 - count * min))
  const edges = [0, ...shifted.map((value, i) => value + (i + 1) * min), 1]
  return widths.map((_, i) => {
    const from = edges[i] ?? 0
    const to = edges[i + 1] ?? 1
    return { x: from, width: to - from }
  })
}

/** 単調に増える列に直す（二乗の誤差がいちばん小さい物。隣り合う違反の塊を平均でまとめる） */
function isotonic(values: readonly number[]): number[] {
  const blocks: { sum: number; size: number }[] = []
  for (const value of values) {
    blocks.push({ sum: value, size: 1 })
    while (blocks.length >= 2) {
      const last = blocks[blocks.length - 1]
      const before = blocks[blocks.length - 2]
      if (last === undefined || before === undefined) break
      if (before.sum / before.size <= last.sum / last.size) break
      blocks.splice(blocks.length - 2, 2, {
        sum: before.sum + last.sum,
        size: before.size + last.size,
      })
    }
  }
  return blocks.flatMap((block) => Array<number>(block.size).fill(block.sum / block.size))
}

/** 要る世帯年収の線（左上から右へ、段ごとに縦に動いて横へ）。段が無ければ空文字 */
function profile(bars: readonly StairOutline[]): string {
  return bars
    .map((bar, index) => {
      const head = index === 0 ? `M${sx(bar.x)} ${sy(bar.top)}` : `V${sy(bar.top)}`
      return `${head} H${sx(bar.x + bar.width)}`
    })
    .join(' ')
}

/** 横の割合 → SVG の x */
function sx(ratio: number): number {
  return round(ratio * FRAME_SIZE)
}

/** 高さの割合 → SVG の y（上が 0） */
function sy(ratio: number): number {
  return round((1 - ratio) * FRAME_SIZE)
}

/** 座標を小数 1 桁にする（SVG の文字列を短く、テストで比べやすくする） */
function round(value: number): number {
  return Math.round(value * 10) / 10
}

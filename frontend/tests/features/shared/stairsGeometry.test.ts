import { describe, expect, it } from 'vitest'
import type { Step } from '../../../src/domain/plan/types'
import {
  FRAME_SIZE,
  STAIRS_RULES,
  hitAreas,
  stairsGeometry,
} from '../../../src/features/shared/stairsGeometry'

/** 段を 1 つ作る（金額はダミー） */
const step = (
  fromYear: number,
  toYear: number,
  requiredGross: number | null,
  expectedGross: number,
): Step => ({
  fromYear,
  toYear,
  peakYear: fromYear,
  requiredNet: 0,
  requiredGross,
  expectedGross,
  causes: [],
  byGoal: [],
})

describe('stairsGeometry', () => {
  it('段が無ければ棒も線も札も無い', () => {
    const geometry = stairsGeometry([])
    expect(geometry.bars).toEqual([])
    expect(geometry.profilePath).toBe('')
    expect(geometry.expectedPath).toBe('')
    expect(geometry.gapRects).toEqual([])
    expect(geometry.endYearLabel).toBeNull()
    expect(geometry.expectedLabel).toBeNull()
  })

  it('比べる相手が無ければ、比べる線は空（「ながめる」の描き方は変わらない）', () => {
    const steps = [step(2026, 2030, 5000000, 5000000), step(2031, 2035, 10000000, 5000000)]
    const alone = stairsGeometry(steps)
    expect(alone.comparePath).toBe('')
    expect(stairsGeometry(steps, STAIRS_RULES, [])).toEqual(alone)
  })

  it('比べる相手（見直すの今の計画）は、2 つに共通の目盛りで線にする。縦は 0 円から 2 つのいちばん高い所まで', () => {
    // 案：家を外して 2031 年からの段が下がった。今の計画：2031 年から 1,000万円
    const draft = [step(2026, 2030, 5000000, 5000000), step(2031, 2035, 6000000, 5000000)]
    const current = [step(2026, 2030, 5000000, 5000000), step(2031, 2035, 10000000, 5000000)]
    const geometry = stairsGeometry(draft, STAIRS_RULES, current)
    // 目盛りの最大は今の計画の 1,000万円。案の 600万円は 0.6 の高さ
    expect(geometry.bars[1]?.top).toBeCloseTo(0.6)
    expect(geometry.profilePath).toBe('M0 500 H500 V400 H1000')
    // 案と同じ高さの 2026〜2030 年は描かず、違う 2031 年からだけ描く
    expect(geometry.comparePath).toBe('M500 0 H1000')
    // 札・押す所は案だけから決める
    expect(geometry.bars).toHaveLength(2)
  })

  it('比べる相手の年が案より長くても、横は 2 つを合わせた年の幅にする。解けない段は上端', () => {
    const draft = [step(2026, 2030, 5000000, 5000000)]
    const current = [step(2026, 2030, 5000000, 5000000), step(2031, 2035, null, 5000000)]
    const geometry = stairsGeometry(draft, STAIRS_RULES, current)
    expect(geometry.bars[0]?.width).toBeCloseTo(0.5)
    // 解けない段があるので目盛りの最大は 500万円 × 1.15。案の無い 2031 年からは描く
    expect(geometry.comparePath).toBe('M500 0 H1000')
  })

  it('比べる相手の線は、案の線との差が `minCompareGap`（図の高さの 3.5%）に満たない所を描かない（太い 1 本に見えないように）。段差は続く所だけつなぐ', () => {
    const draft = [
      step(2026, 2030, 10000000, 10000000),
      step(2031, 2035, 8000000, 10000000),
      step(2036, 2040, 6000000, 10000000),
    ]
    const current = [
      step(2026, 2030, 9800000, 10000000),
      step(2031, 2035, 9000000, 10000000),
      step(2036, 2040, 8000000, 10000000),
    ]
    const { comparePath } = stairsGeometry(draft, STAIRS_RULES, current)
    // 2026〜2030 年は差 2%（描かない）。2031 年から 2 つの段は描き、段差でつなぐ
    expect(comparePath).toBe('M333.3 100 H666.7 V200 H1000')
  })

  it('「見込み」の札は、比べる相手の線が札の高さを通る段を避け、置けなければ出さない', () => {
    // 届く広い段が 2 つ。後ろの段の札の高さ（見込みの線の上）を今の計画の線が通るので、前の段に置く
    const draft = [step(2026, 2032, 7000000, 8000000), step(2033, 2040, 7000000, 8000000)]
    const crossing = [step(2026, 2032, 7000000, 8000000), step(2033, 2040, 8800000, 8000000)]
    expect(stairsGeometry(draft, STAIRS_RULES, crossing).expectedLabel?.index).toBe(0)
    // 比べる相手が無ければ、今までどおり後ろの段
    expect(stairsGeometry(draft).expectedLabel?.index).toBe(1)
    // どちらの段も通るなら出さない
    const both = [step(2026, 2032, 8800000, 8000000), step(2033, 2040, 8800000, 8000000)]
    expect(stairsGeometry(draft, STAIRS_RULES, both).expectedLabel).toBeNull()
  })

  it('年の長さに比例した幅で、枠の幅いっぱいに並べる', () => {
    const { bars } = stairsGeometry([
      step(2026, 2028, 9000000, 9000000),
      step(2029, 2035, 10000000, 9000000),
    ])
    // 2026〜2035 の 10 年。最初の段は 3 年
    expect(bars[0]?.x).toBe(0)
    expect(bars[0]?.width).toBeCloseTo(0.3)
    expect((bars[1]?.x ?? 0) + (bars[1]?.width ?? 0)).toBeCloseTo(1)
  })

  it('縦は 0 円から。いちばん高い値が枠の上端（1）', () => {
    const { bars } = stairsGeometry([step(2026, 2030, 5000000, 10000000)])
    expect(bars[0]?.expected).toBe(1)
    expect(bars[0]?.top).toBeCloseTo(0.5)
  })

  it('面は階段の線から 0 円の底まで、線は段ごとに縦へ動いて横へ', () => {
    const { profilePath, massPath } = stairsGeometry([
      step(2026, 2030, 5000000, 5000000),
      step(2031, 2035, 10000000, 5000000),
    ])
    expect(profilePath).toBe('M0 500 H500 V0 H1000')
    expect(massPath).toBe(`M0 500 H500 V0 H1000 V${FRAME_SIZE} H0 Z`)
  })

  it('見込みでも届かない段だけ short で、見込みの線から要る年収までを足りない所にする', () => {
    const { bars, gapRects } = stairsGeometry([
      step(2026, 2030, 9000000, 9000000),
      step(2031, 2040, 12000000, 9000000),
    ])
    expect(bars.map((bar) => bar.short)).toEqual([false, true])
    // 2 つ目の段：上端が 1（1,200万円）、見込みが 0.75（900万円）
    expect(gapRects).toEqual([{ x: 333.3, y: 0, width: 666.7, height: 250 }])
  })

  it('解けない段は枠の上端まで伸ばし、金額の代わりに記号を書く', () => {
    const { bars } = stairsGeometry([step(2026, 2040, null, 9000000)])
    expect(bars[0]?.unsolved).toBe(true)
    expect(bars[0]?.short).toBe(true)
    expect(bars[0]?.top).toBe(1)
    expect(bars[0]?.valueLabel).toBe('—')
  })

  it('見込みがいちばん高くても、解けない段は見込みの線より上まで伸びる（足りない色が出る）', () => {
    const { bars } = stairsGeometry([
      step(2026, 2030, 9000000, 9000000),
      step(2031, 2040, null, 12000000),
    ])
    const unsolved = bars[1]
    expect(unsolved?.top).toBe(1)
    // 目盛りの最大は、いちばん高い値に余白の割合を足した物
    expect(unsolved?.expected).toBeCloseTo(1 / (1 + STAIRS_RULES.unsolvedHeadroom))
  })

  it('狭い段には金額と年を書かない。4 桁はカンマで区切る', () => {
    const { bars } = stairsGeometry([
      step(2026, 2026, 9000000, 9000000),
      step(2027, 2060, 12500000, 9000000),
    ])
    expect(bars[0]?.valueLabel).toBeNull()
    expect(bars[0]?.yearLabel).toBeNull()
    expect(bars[1]?.valueLabel).toBe('1,250')
    expect(bars[1]?.yearLabel).toBe('2027')
  })

  it('3 桁の金額は、幅に応じて「普通の字と印」→「小さい字と印」→「小さい字だけ」→ 書かない', () => {
    // 20 年の図：3 年の段は 0.15、2 年は 0.1、1 年は 0.05
    const { bars } = stairsGeometry([
      step(2026, 2028, 9800000, 9000000),
      step(2029, 2030, 9360000, 9000000),
      step(2031, 2031, 8420000, 9000000),
      step(2032, 2045, 9000000, 9000000),
    ])
    expect(bars[0]).toMatchObject({ valueLabel: '980', smallLabel: false, caret: true })
    // 2 年の段（見本の「936」）は、印を省いて小さい字だけ（幅 360px の図で約 33px。小さい字と印は約 38px 要る）
    expect(bars[1]).toMatchObject({ valueLabel: '936', smallLabel: true, caret: false })
    // 1 年の段は何も書かない。印だけを浮かせない
    expect(bars[2]).toMatchObject({ valueLabel: null, caret: false, yearLabel: null })
    // 年（「2029」）は幅 0.105 から（20 年の図の 2 年の段 0.1 には書かない。19 年の図なら 0.105 で書く）
    expect(bars[1]?.yearLabel).toBeNull()
    const nineteen = stairsGeometry([
      step(2026, 2028, 9800000, 9000000),
      step(2029, 2030, 9360000, 9000000),
      step(2031, 2044, 9000000, 9000000),
    ])
    expect(nineteen.bars[1]?.yearLabel).toBe('2029')
  })

  it('3 桁の「小さい字と印」は、その幅のしきい値から', () => {
    // 25 年の図：3 年の段は 0.12
    const { bars } = stairsGeometry([
      step(2026, 2028, 9800000, 9000000),
      step(2029, 2050, 9000000, 9000000),
    ])
    expect(bars[0]).toMatchObject({ valueLabel: '980', smallLabel: true, caret: true })
  })

  it('4 桁の金額はいつも小さい字。広い段は印を添え、少し狭い段は字だけ、2 年の段には書かない', () => {
    // 20 年の図：2 年の段は 0.1、3 年の段は 0.15、4 年の段は 0.2
    const { bars } = stairsGeometry([
      step(2026, 2027, 10340000, 9000000),
      step(2028, 2030, 11500000, 9000000),
      step(2031, 2034, 12730000, 9000000),
      step(2035, 2045, 9000000, 9000000),
    ])
    expect(bars[0]).toMatchObject({ valueLabel: null, caret: false })
    expect(bars[1]).toMatchObject({ valueLabel: '1,150', smallLabel: true, caret: false })
    expect(bars[2]).toMatchObject({ valueLabel: '1,273', smallLabel: true, caret: true })
  })

  it('字の幅のしきい値は、上から狭くなる順に並ぶ', () => {
    const widths = (fits: readonly { width: number }[]) => fits.map((fit) => fit.width)
    expect(widths(STAIRS_RULES.shortLabelFits)).toEqual(
      [...widths(STAIRS_RULES.shortLabelFits)].sort((a, b) => b - a),
    )
    expect(widths(STAIRS_RULES.longLabelFits)).toEqual(
      [...widths(STAIRS_RULES.longLabelFits)].sort((a, b) => b - a),
    )
  })

  it('見込みの線は段ごとの見込みを階段状につなぐ', () => {
    const { expectedPath } = stairsGeometry([
      step(2026, 2030, 10000000, 10000000),
      step(2031, 2035, 10000000, 5000000),
    ])
    expect(expectedPath).toBe('M0 0 H500 L500 500 H1000')
  })

  it('右下の最後の年は、最後の段が広いときだけ書く', () => {
    const wide = stairsGeometry([
      step(2026, 2028, 9000000, 9000000),
      step(2029, 2044, 9000000, 9000000),
    ])
    expect(wide.endYearLabel).toBe('〜2044')
    const narrow = stairsGeometry([
      step(2026, 2040, 9000000, 9000000),
      step(2041, 2042, 9000000, 9000000),
    ])
    expect(narrow.endYearLabel).toBeNull()
  })

  it('見込みの札は、届いている広い段の線の上に置く（後ろの段から選ぶ）', () => {
    const { expectedLabel } = stairsGeometry([
      step(2026, 2031, 8000000, 9000000),
      step(2032, 2034, 12000000, 9000000),
      step(2035, 2044, 8500000, 9000000),
    ])
    expect(expectedLabel).toEqual({ index: 2, value: '900', placement: 'above' })
  })

  it('届いている広い段が無ければ、届かない段の線の下に置く。広い段が無ければ札を出さない', () => {
    const allShort = stairsGeometry([
      step(2026, 2030, 9500000, 9000000),
      step(2031, 2040, 11000000, 9000000),
    ])
    expect(allShort.expectedLabel).toEqual({ index: 1, value: '900', placement: 'below' })

    // 届いている段は狭い（1 年／15 年）ので、届かない広い段に置く
    const narrowReached = stairsGeometry([
      step(2026, 2026, 8000000, 9000000),
      step(2027, 2040, 11000000, 9000000),
    ])
    expect(narrowReached.expectedLabel?.placement).toBe('below')

    // どの段も札の幅に足りない
    const narrow = stairsGeometry([
      step(2026, 2028, 8000000, 9000000),
      step(2029, 2031, 8000000, 9000000),
      step(2032, 2034, 8000000, 9000000),
      step(2035, 2037, 8000000, 9000000),
    ])
    expect(narrow.expectedLabel).toBeNull()
  })
})

describe('押す所（hitAreas）：線と面は年数に比例のまま、押す所だけ最低の幅に広げる', () => {
  const MIN = STAIRS_RULES.minHitWidth
  const EPS = 1e-9

  /** 押す所が 0 から 1 まですき間なく並び、どれも最低の幅以上か */
  const expectTiled = (areas: { x: number; width: number }[], min: number) => {
    let edge = 0
    for (const area of areas) {
      expect(area.x).toBeCloseTo(edge, 9)
      expect(area.width).toBeGreaterThanOrEqual(min - EPS)
      edge = area.x + area.width
    }
    expect(edge).toBeCloseTo(1, 9)
  }

  it('どの段も広ければ、描く位置と同じ', () => {
    const widths = [0.3, 0.2, 0.5]
    const areas = hitAreas(widths, MIN)
    areas.forEach((area, i) => expect(area.width).toBeCloseTo(widths[i] ?? 0, 9))
    expectTiled(areas, MIN)
  })

  it('真ん中の狭い段は、両隣から半分ずつ譲ってもらう（見本の 1 年の段）', () => {
    // 見本の世帯：3・2・1・3・10 年の 19 年
    const widths = [3, 2, 1, 3, 10].map((years) => years / 19)
    const areas = hitAreas(widths, MIN)
    expectTiled(areas, MIN)
    expect(areas[2]?.width).toBeCloseTo(MIN, 9)
    const given = MIN - 1 / 19
    // 左の段（2 年）と右の段（3 年）が同じだけ縮み、ほかの段は描く幅のまま
    expect(areas[1]?.width).toBeCloseTo(2 / 19 - given / 2, 9)
    expect(areas[3]?.width).toBeCloseTo(3 / 19 - given / 2, 9)
    expect(areas[0]?.width).toBeCloseTo(3 / 19, 9)
    expect(areas[4]?.width).toBeCloseTo(10 / 19, 9)
  })

  it('端の狭い段は、片側の隣だけから譲ってもらう', () => {
    const areas = hitAreas([0.02, 0.48, 0.5], MIN)
    expectTiled(areas, MIN)
    expect(areas[0]?.x).toBe(0)
    expect(areas[0]?.width).toBeCloseTo(MIN, 9)
    expect(areas[1]?.width).toBeCloseTo(0.48 - (MIN - 0.02), 9)
    expect(areas[2]?.width).toBeCloseTo(0.5, 9)
    const last = hitAreas([0.5, 0.48, 0.02], MIN)
    expectTiled(last, MIN)
    expect(last[2]?.width).toBeCloseTo(MIN, 9)
  })

  it('狭い段が続いても、どれも最低の幅になる（両側の広い段から譲る）', () => {
    const areas = hitAreas([0.4, 0.03, 0.03, 0.03, 0.51], MIN)
    expectTiled(areas, MIN)
    for (const area of areas.slice(1, 4)) expect(area.width).toBeCloseTo(MIN, 9)
  })

  it('段が多すぎて全部に最低の幅が取れないときは等分', () => {
    const widths = Array.from({ length: 20 }, (_, i) => (i === 0 ? 0.81 : 0.01))
    const areas = hitAreas(widths, MIN)
    expectTiled(areas, 1 / 20)
    for (const area of areas) expect(area.width).toBeCloseTo(1 / 20, 9)
  })

  it('段が 1 つなら全部、段が無ければ空', () => {
    expect(hitAreas([1], MIN)).toEqual([{ x: 0, width: 1 }])
    expect(hitAreas([], MIN)).toEqual([])
  })

  it('図の棒は、描く位置（x・width）と押す所（hitX・hitWidth）を別に持つ', () => {
    const { bars } = stairsGeometry([
      step(2026, 2028, 8650000, 9000000),
      step(2029, 2030, 9360000, 9000000),
      step(2031, 2031, 8420000, 9000000),
      step(2032, 2034, 10160000, 9000000),
      step(2035, 2044, 9430000, 9000000),
    ])
    expect(bars[2]?.width).toBeCloseTo(1 / 19, 9)
    expect(bars[2]?.hitWidth).toBeCloseTo(MIN, 9)
    // 狭い段の押す所は描く段を含む。譲った隣の段も、段の真ん中は自分の押す所に残る
    const narrow = bars[2]
    expect(narrow?.hitX).toBeLessThanOrEqual((narrow?.x ?? 0) + EPS)
    expect((narrow?.hitX ?? 0) + (narrow?.hitWidth ?? 0)).toBeGreaterThanOrEqual(
      (narrow?.x ?? 0) + (narrow?.width ?? 0) - EPS,
    )
    for (const bar of bars) {
      const center = bar.x + bar.width / 2
      expect(bar.hitX).toBeLessThan(center)
      expect(bar.hitX + bar.hitWidth).toBeGreaterThan(center)
    }
    // 360px の図（328px）で 24px 以上
    expect(MIN * 328).toBeGreaterThanOrEqual(24)
  })
})

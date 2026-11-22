import { describe, expect, it } from 'vitest'
import {
  causeGroups,
  causeIsIncome,
  enoughUntilYear,
  fallingSteps,
  stepOutlook,
} from '../../../src/domain/plan/stepReading'
import type { CauseChange, Step, StepCause } from '../../../src/domain/plan/types'

/** 理由を 1 つ作る（金額はダミー） */
const cause = (label: string, monthlyDelta: number, change: CauseChange): StepCause => ({
  goalId: `g-${label}`,
  label,
  monthlyDelta,
  change,
  monthly: Math.abs(monthlyDelta),
})

/** 段の読み方に要る所だけの段 */
type ReadStep = Pick<Step, 'fromYear' | 'requiredGross' | 'causes'>
const stepOf = (fromYear: number, requiredGross: number | null, causes: StepCause[] = []) =>
  ({ fromYear, requiredGross, causes }) satisfies ReadStep

describe('enoughUntilYear（今の年収で足りる最後の年）', () => {
  const steps = [stepOf(2026, 8000000), stepOf(2029, 9500000), stepOf(2032, 9000000)]

  it('次の段の前の年', () => {
    expect(enoughUntilYear(steps, steps[1] ?? null)).toBe(2028)
    expect(enoughUntilYear(steps, steps[2] ?? null)).toBe(2031)
  })

  it('次の段が最初の段なら、足りる年は無い（null）', () => {
    expect(enoughUntilYear(steps, steps[0] ?? null)).toBeNull()
  })

  it('次の段が無い・段が無いときは null', () => {
    expect(enoughUntilYear(steps, null)).toBeNull()
    expect(enoughUntilYear([], null)).toBeNull()
  })
})

describe('causeGroups（始まる・終わる・増える・減るの組）', () => {
  it('組は 始まる → 終わる → 増える → 減る の順、組の中は元の順。空の組は出さない', () => {
    const causes = [
      cause('返済', 190000, 'start'),
      cause('家賃', -95000, 'end'),
      cause('塾', 8000, 'more'),
      cause('修繕', 27000, 'start'),
    ]
    expect(causeGroups(causes).map((g) => [g.change, g.causes.map((c) => c.label)])).toEqual([
      ['start', ['返済', '修繕']],
      ['end', ['家賃']],
      ['more', ['塾']],
    ])
  })

  it('理由が無ければ組も無い', () => {
    expect(causeGroups([])).toEqual([])
  })
})

describe('causeIsIncome（収入の帯か）', () => {
  it('支払いの帯：始まる・増えるは正、終わる・減るは負なので、収入の帯ではない', () => {
    expect(causeIsIncome(cause('返済', 43000, 'start'))).toBe(false)
    expect(causeIsIncome(cause('塾', 8000, 'more'))).toBe(false)
    expect(causeIsIncome(cause('学校', -27000, 'end'))).toBe(false)
    expect(causeIsIncome(cause('塾', -8000, 'less'))).toBe(false)
  })

  it('収入の帯：始まる・増えるは負、終わる・減るは正（要る手取りを押し上げる向きが正のため）', () => {
    expect(causeIsIncome(cause('児童手当', -10000, 'start'))).toBe(true)
    expect(causeIsIncome(cause('児童手当', -5000, 'more'))).toBe(true)
    expect(causeIsIncome(cause('児童手当', 10000, 'end'))).toBe(true)
    expect(causeIsIncome(cause('就学支援金', 3000, 'less'))).toBe(true)
  })
})

describe('fallingSteps（前の段より下がる段と、下がった理由）', () => {
  it('要る世帯年収が前の段より下がる段だけ。理由は下げる向き（差が負）でいちばん大きい物と、ほかの数', () => {
    const steps = [
      stepOf(2026, 8700000),
      stepOf(2029, 9500000, [cause('車の返済', 43000, 'start'), cause('学校', -27000, 'end')]),
      stepOf(2031, 8300000, [
        cause('学校', -27000, 'end'),
        cause('塾', -19000, 'end'),
        cause('大学資金の積立', -11000, 'end'),
      ]),
      stepOf(2032, 10000000, [cause('返済', 190000, 'start'), cause('家賃', -95000, 'end')]),
      stepOf(2035, 9400000, [cause('車の返済', -43000, 'end')]),
    ]
    const falls = fallingSteps(steps)
    expect(falls.map((f) => [f.index, f.fromYear, f.cause?.label, f.others])).toEqual([
      [2, 2031, '学校', 2],
      [4, 2035, '車の返済', 0],
    ])
  })

  it('同じ額は下がらない。最初の段は比べる相手が無いので出さない', () => {
    expect(fallingSteps([stepOf(2026, 9000000), stepOf(2030, 9000000)])).toEqual([])
    expect(fallingSteps([stepOf(2026, 9000000)])).toEqual([])
  })

  it('解けない段（null）はいちばん高いとみなす：解けない段の次の解ける段は下がる、解けない段どうしは下がらない', () => {
    const steps = [
      stepOf(2026, 9000000),
      stepOf(2030, null),
      stepOf(2033, null),
      stepOf(2036, 9500000, [cause('返済', -100000, 'end')]),
    ]
    expect(fallingSteps(steps).map((f) => f.fromYear)).toEqual([2036])
  })

  it('下げる向きの理由が無い（上限で切れた）ときは理由を null にする', () => {
    const steps = [stepOf(2026, 9000000), stepOf(2030, 8000000, [cause('塾', 5000, 'more')])]
    expect(fallingSteps(steps)).toEqual([{ index: 1, fromYear: 2030, cause: null, others: 0 }])
  })
})

describe('stepOutlook（次の段より先の流れ：いちばん高い段と、最後に落ち着く段）', () => {
  /** 終わりの年を次の段の前の年にした段（最後は 2044 年まで） */
  const flow = (rows: [number, number | null, StepCause[]?][]) =>
    rows.map(([fromYear, gross, causes = []], index) => ({
      ...stepOf(fromYear, gross, causes),
      toYear: (rows[index + 1]?.[0] ?? 2045) - 1,
    }))

  it('見本の世帯の形：次の段 2029 → いちばん高い 2032 → 最後の 2035 は車の返済が終わって下がる', () => {
    const steps = flow([
      [2026, 8670000],
      [2029, 9480000],
      [2031, 8300000, [cause('学校', -27000, 'end')]],
      [2032, 9980000, [cause('返済', 190000, 'start')]],
      [2035, 9380000, [cause('車の返済', -43000, 'end')]],
    ])
    const outlook = stepOutlook(steps, { fromYear: 2029 })
    expect(outlook?.peak).toEqual({ fromYear: 2032, toYear: 2034, requiredGross: 9980000 })
    expect(outlook?.peakIsLast).toBe(false)
    expect(outlook?.last?.fromYear).toBe(2035)
    expect(outlook?.last?.requiredGross).toBe(9380000)
    expect(outlook?.last?.fall?.cause?.label).toBe('車の返済')
  })

  it('次の段がいちばん高いなら peak は null（最後の段だけ）', () => {
    const steps = flow([
      [2026, 8000000],
      [2029, 9900000],
      [2033, 9200000, [cause('車の返済', -43000, 'end')]],
    ])
    const outlook = stepOutlook(steps, { fromYear: 2029 })
    expect(outlook?.peak).toBeNull()
    expect(outlook?.last?.fromYear).toBe(2033)
  })

  it('いちばん高い段が最後の段なら last は null、peakIsLast は true', () => {
    const steps = flow([
      [2026, 9500000],
      [2030, 9800000],
    ])
    const outlook = stepOutlook(steps, { fromYear: 2026 })
    expect(outlook).toEqual({
      peak: { fromYear: 2030, toYear: 2044, requiredGross: 9800000 },
      peakIsLast: true,
      last: null,
    })
  })

  it('同じ高さなら早い段をいちばん高いとする。最後の段が前の段より上がるなら fall は null', () => {
    const steps = flow([
      [2026, 9500000],
      [2030, 9900000],
      [2034, 9200000],
      [2038, 9900000],
      [2041, 9600000],
    ])
    const outlook = stepOutlook(steps, { fromYear: 2026 })
    expect(outlook?.peak?.fromYear).toBe(2030)
    expect(outlook?.last?.fromYear).toBe(2041)
    expect(outlook?.last?.fall?.fromYear).toBe(2041)
    const rising = flow([
      [2026, 9500000],
      [2030, 9900000],
      [2034, 9200000],
      [2038, 9600000],
    ])
    expect(stepOutlook(rising, { fromYear: 2026 })?.last?.fall).toBeNull()
  })

  it('解けない段（null）はいちばん高いとみなす。解けない次の段のあとに解ける段が来れば、最後の段だけ', () => {
    const later = flow([
      [2026, 9000000],
      [2029, null],
      [2031, 9400000, [cause('塾', -20000, 'end')]],
    ])
    const outlook = stepOutlook(later, { fromYear: 2029 })
    expect(outlook?.peak).toBeNull()
    expect(outlook?.last?.requiredGross).toBe(9400000)
    const peakUnsolved = flow([
      [2026, 9500000],
      [2030, null],
      [2034, 9200000, [cause('返済', -100000, 'end')]],
    ])
    expect(stepOutlook(peakUnsolved, { fromYear: 2026 })?.peak?.requiredGross).toBeNull()
  })

  it('最後の段がいちばん高い段と同じ高さなら、早い段をいちばん高いとし、最後の段も別に出す（前の段より上がるので fall は null）', () => {
    const steps = flow([
      [2026, 8520000],
      [2029, 9310000],
      [2032, 9870000, [cause('返済', 176000, 'start')]],
      [2035, 9140000, [cause('車の返済', -41000, 'end')]],
      [2038, 9870000, [cause('介護', 52000, 'start')]],
    ])
    expect(stepOutlook(steps, { fromYear: 2029 })).toEqual({
      peak: { fromYear: 2032, toYear: 2034, requiredGross: 9870000 },
      peakIsLast: false,
      last: { fromYear: 2038, toYear: 2044, requiredGross: 9870000, fall: null },
    })
  })

  it('届かない段（null）が 2 つあれば、早いほうをいちばん高いとし、遅いほうを最後の段として出す（届かない段どうしは下がらない）', () => {
    const steps = flow([
      [2026, 8520000],
      [2029, 9310000],
      [2032, null, [cause('返済', 176000, 'start')]],
      [2036, null, [cause('介護', 52000, 'start')]],
    ])
    expect(stepOutlook(steps, { fromYear: 2029 })).toEqual({
      peak: { fromYear: 2032, toYear: 2035, requiredGross: null },
      peakIsLast: false,
      last: { fromYear: 2036, toYear: 2044, requiredGross: null, fall: null },
    })
    // 次の段が届かない段なら、次の段がいちばん高い（peak は null）。最後の届かない段だけを出す
    const nextUnsolved = flow([
      [2026, 8520000],
      [2029, null],
      [2033, 9640000, [cause('塾', -23000, 'end')]],
      [2037, null, [cause('介護', 52000, 'start')]],
    ])
    expect(stepOutlook(nextUnsolved, { fromYear: 2029 })).toEqual({
      peak: null,
      peakIsLast: false,
      last: { fromYear: 2037, toYear: 2044, requiredGross: null, fall: null },
    })
  })

  it('次の段が無い・次の段が最後の段・見つからないときは null（箇条書きを出さない）', () => {
    const steps = flow([
      [2026, 9000000],
      [2029, 9500000],
    ])
    expect(stepOutlook(steps, null)).toBeNull()
    expect(stepOutlook(steps, { fromYear: 2029 })).toBeNull()
    expect(stepOutlook(steps, { fromYear: 2050 })).toBeNull()
    expect(stepOutlook([], null)).toBeNull()
  })
})

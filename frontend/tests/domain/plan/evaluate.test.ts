import { describe, expect, it } from 'vitest'
import sampleJson from '../../../src/data/app/sample-household.json'
import { expandPlan } from '../../../src/domain/plan/bands/index'
import { sampleLifePlan } from '../../../src/domain/plan/defaults'
import { evaluate, toTodayValue } from '../../../src/domain/plan/evaluate'
import { lastNeedYear, yearlyNeeds } from '../../../src/domain/plan/need'
import { householdTaxAt, requiredHouseholdGross } from '../../../src/domain/plan/requiredIncome'
import {
  expectedLevels,
  householdGross,
  householdTaxInput,
} from '../../../src/domain/plan/taxBridge'
import type {
  CarGoal,
  CustomGoal,
  IncomeLevel,
  LifePlan,
  SampleHouseholdSource,
  SolveContext,
} from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { DEFAULT_REQUIRED_GROSS_OPTIONS } from '../../../src/domain/tax/requiredGross'
import { monthlyLoanPayment } from '../../../src/domain/expense/loan'
import { adult, defaults, makePlan, monthly, tables } from './planFixtures'

const sample: SampleHouseholdSource = sampleJson.values
const STEP = DEFAULT_REQUIRED_GROSS_OPTIONS.step

const contextOf = (plan: LifePlan, year: number): SolveContext => ({
  plan,
  year,
  expected: expectedLevels(plan, year),
  taxInput: householdTaxInput(plan, defaults.taxBridge),
  settings: defaults.taxBridge,
  sideMonthlyStep: defaults.search.sideMonthlyStep.value,
  tables,
})

const once = (id: string, amount: number, at: [number, number], saved = 0): CustomGoal => ({
  id,
  enabled: true,
  kind: 'custom',
  name: id,
  amountType: 'once',
  direction: 'expense',
  amount,
  at: yearMonth(...at),
  saved,
})

/**
 * 見本の世帯の金利をテストの中で固定する。既定値はフラット35 の最頻金利で毎月 JSON を直すので、
 * 段の形を確かめるテストがその値に引きずられないようにする（JSON から入ることは defaults.test.ts が確かめる）
 */
const SAMPLE_TEST_RATE = 0.0381

/** 見本の世帯（金利だけテストの値） */
const samplePlan = (base: ReturnType<typeof yearMonth>): LifePlan => {
  const plan = sampleLifePlan(defaults, sample, base)
  return { ...plan, assumptions: { ...plan.assumptions, mortgageRate: SAMPLE_TEST_RATE } }
}

describe('evaluate：見本の世帯', () => {
  const base = yearMonth(2026, 11)
  const plan = samplePlan(base)
  const result = evaluate(plan, tables, defaults)

  it('段が 3 つ以上でき、次の段がある（今の世帯年収を上回る段がある）', () => {
    expect(result.currentGross).toBe(9000000)
    expect(result.steps.length).toBeGreaterThanOrEqual(3)
    expect(result.steps.every((s) => s.requiredGross !== null)).toBe(true)
    expect(result.nextStep).not.toBeNull()
    const first = result.steps.find((s) => (s.requiredGross ?? Infinity) > result.currentGross)
    expect(result.nextStep).toBe(first)
    // 最初の段は今の年収で足りている（見本は「次の段」が先にある形）
    expect(result.steps[0]?.requiredGross).toBeLessThanOrEqual(result.currentGross)
  })

  it('段は年を隙間なく覆い、段の値は段の中の最大の年、内訳は値になった年の物', () => {
    const years = new Map(result.years.map((y) => [y.year, y]))
    expect(result.steps[0]?.fromYear).toBe(2026)
    expect(result.steps.at(-1)?.toYear).toBe(lastNeedYear(plan))
    result.steps.forEach((step, i) => {
      const next = result.steps[i + 1]
      if (next !== undefined) expect(next.fromYear).toBe(step.toYear + 1)
      const inStep = result.years.filter((y) => y.year >= step.fromYear && y.year <= step.toYear)
      expect(step.requiredNet).toBe(Math.max(...inStep.map((y) => y.requiredNet)))
      expect(years.get(step.peakYear)?.requiredNet).toBe(step.requiredNet)
      expect(step.byGoal).toEqual(years.get(step.peakYear)?.byGoal)
      expect(step.expectedGross).toBe(9000000)
    })
  })

  it('完了条件：解いた年収を税の計算に通すと要る手取りに届き、1 万円下げると届かない', () => {
    for (const step of result.steps) {
      const ctx = contextOf(plan, step.peakYear)
      const others = 3700000
      const top = (step.requiredGross ?? 0) - others
      const levels = new Map<string, IncomeLevel>(ctx.expected).set('adult-1', {
        main: top,
        sideMonthly: 0,
      })
      expect(householdTaxAt(ctx, levels).netIncome).toBeGreaterThanOrEqual(step.requiredNet)
      const lower = new Map<string, IncomeLevel>(ctx.expected).set('adult-1', {
        main: top - STEP,
        sideMonthly: 0,
      })
      expect(householdTaxAt(ctx, lower).netIncome).toBeLessThan(step.requiredNet)
    }
  })

  it('段の理由：車を買い 1 人目が高校を出る段・家を買う段（返済と修繕と税が始まり、家賃と頭金の積立が終わる）・車のローンが終わる段', () => {
    const labels = result.steps.map((s) => s.causes.map((c) => [c.label, c.monthlyDelta]))
    expect(labels[0]).toEqual([])
    // 車（T8）：ローンの返済（価格の全部・車のローンの金利・ローンの年数）、維持費、次の車の積立（価格 × (1 − 下取りの率) ÷ 周期の月数）
    const [car] = sample.carGoals
    if (car === undefined || car.loanYears === undefined || car.replaceEveryYears === null) {
      throw new Error('見本の車がローン・買い替えありになっていない')
    }
    const carRepayment = monthlyLoanPayment({
      principal: car.price,
      years: car.loanYears,
      annualRate: defaults.car.loanRate.value,
    })
    const nextCar = Math.ceil(
      (car.price - Math.round(car.price * defaults.car.resaleRate.value)) /
        (car.replaceEveryYears * 12),
    )
    // 車を買う年（2029 年）は、1 人目が 3 月で高校を出る年でもある（子の費用のカード。T9）。
    // 理由は金額の大きい順に 3 つまで：車のローンの返済が始まり、1 人目の学校が減り、次の車の積立が始まる
    expect(labels[1]?.map(([label]) => label)).toEqual([
      '車のローンの返済',
      '学校（1人目）',
      '次の車の積立',
    ])
    expect(labels[1]).toContainEqual(['車のローンの返済', carRepayment])
    expect(labels[1]).toContainEqual(['次の車の積立', nextCar])
    // 維持費も、車を買う月から帯になっている（理由の 4 つ目以降で出ない）
    const carBandsOf = (label: string) =>
      result.bands.filter((b) => b.goalId === 'goal-car' && b.label === label)
    expect(carBandsOf('次の車の積立').map((b) => [b.monthly, b.from])).toEqual([
      [nextCar, yearMonth(2029, 1)],
    ])
    expect(carBandsOf('車の維持費').map((b) => [b.monthly, b.from])).toEqual([
      [car.monthlyUpkeep, yearMonth(2029, 1)],
    ])
    // 返済：借りる額（価格 − 頭金）・テストの金利・35 年の元利均等（monthlyLoanPayment）。
    // 理由は金額の大きい順に 3 つまで（頭金と諸費用の積立の −8,000 は 4 つ目で出ない）
    const [home] = sample.homeGoals
    if (home === undefined) throw new Error('見本に家のカードが無い')
    const repayment = monthlyLoanPayment({
      principal: home.price - home.downPayment,
      years: home.loanYears,
      annualRate: SAMPLE_TEST_RATE,
    })
    expect(labels).toContainEqual([
      ['返済', repayment],
      ['家賃', -95000],
      ['修繕と税', 27300],
    ])
    // ローンが終わっても、維持費と次の車の積立は続く（次の車は積立で買い、ローンを組み直さない）
    expect(labels.at(-1)).toEqual([['車のローンの返済', -carRepayment]])
    // 2 人目が 3 月で高校を出る年（2031 年）は段が下がる（学校・塾が終わる）
    expect(result.steps[2]?.fromYear).toBe(2031)
    expect(labels[2]?.slice(0, 2).map(([label]) => label)).toEqual(['学校（2人目）', '塾（2人目）'])
  })

  it('段の理由の変わり方（W18）：3 月で高校を出る年は「終わる」、家を買う年は返済が始まり家賃が終わる', () => {
    const changes = result.steps.map((s) => s.causes.map((c) => [c.label, c.change]))
    expect(changes[1]).toEqual([
      ['車のローンの返済', 'start'],
      ['学校（1人目）', 'end'],
      ['次の車の積立', 'start'],
    ])
    // 年の途中（3 月）で終わる帯は、差（残る 3 か月ぶん小さい）でなく終わる前の月額を出す
    const school = result.steps[1]?.causes.find((c) => c.label === '学校（1人目）')
    expect(school?.monthly).toBeGreaterThan(Math.abs(school?.monthlyDelta ?? 0))
    expect(changes[2]?.every(([, change]) => change === 'end')).toBe(true)
    expect(changes).toContainEqual([
      ['返済', 'start'],
      ['家賃', 'end'],
      ['修繕と税', 'start'],
    ])
    expect(changes.at(-1)).toEqual([['車のローンの返済', 'end']])
  })

  it('埋め方の換算は、要る世帯年収が見込みを上回る段だけにあり、どれも届く', () => {
    const short = result.steps.filter((s) => (s.requiredGross ?? Infinity) > s.expectedGross)
    expect(result.conversions.map((c) => c.fromYear)).toEqual(short.map((s) => s.fromYear))
    for (const conversion of result.conversions) {
      expect(conversion.shortfallNet).toBeGreaterThan(0)
      expect(conversion.mainJob?.personId).toBe('adult-1')
      expect(conversion.sideJob?.increase).toBeGreaterThan(0)
      expect(conversion.otherAdult?.personId).toBe('adult-2')
    }
  })

  it('知らせは無い（旅行の使う月は 2 年以上先）', () => {
    expect(result.notices).toEqual([])
  })

  it('起点の月を変えても、同じ形の階段が出る（年月は起点からの相対）', () => {
    const later = evaluate(samplePlan(yearMonth(2029, 4)), tables, defaults)
    expect(later.steps.map((s) => s.fromYear - 3)).toEqual(result.steps.map((s) => s.fromYear))
    // 家を買う前の段は、頭金と諸費用の積立の月額が「買う月までの残りの月数」で変わるので少し動く（T7）。
    // 大学資金・老後資金の積立（T10）も「使う月までの残りの月数」で月額が変わる（老後は 2026-11 → 2045-01 の 218 か月と
    // 2029-04 → 2048-01 の 225 か月。大学は 2026-11 → 2031-04 の 53 か月と 2029-04 → 2034-04 の 60 か月。
    // 年は起点の年からの相対だが、起点の月は 11 月と 4 月で違うため）。
    // その 2 枚を外せば、買った後の段は同じ
    const withoutFunds = (plan: LifePlan): LifePlan => ({
      ...plan,
      goals: plan.goals.filter((g) => g.kind !== 'university' && g.kind !== 'retirement'),
    })
    const earlyNoFund = evaluate(withoutFunds(samplePlan(yearMonth(2026, 11))), tables, defaults)
    const laterNoFund = evaluate(withoutFunds(samplePlan(yearMonth(2029, 4))), tables, defaults)
    expect(laterNoFund.steps.slice(3).map((s) => s.requiredGross)).toEqual(
      earlyNoFund.steps.slice(3).map((s) => s.requiredGross),
    )
  })

  it('階段の形：段は 5 つで、次の段は 2 つ目（車を買う段）。家を買う段がいちばん高い', () => {
    expect(result.steps.map((s) => [s.fromYear, s.toYear])).toEqual([
      [2026, 2028],
      [2029, 2030],
      [2031, 2031],
      [2032, 2034],
      [2035, 2044],
    ])
    expect(result.nextStep).toBe(result.steps[1])
    const highest = Math.max(...result.steps.map((s) => s.requiredGross ?? Infinity))
    expect(result.steps[3]?.requiredGross).toBe(highest)
  })
})

describe('evaluate：段の中の数字は段の値になった年に揃える', () => {
  it('昇給のある計画で、見込みの世帯年収はその年の見込みで、換算の有無は「要る世帯年収 ＞ 見込み」と一致する', () => {
    // 2034 年からの月 8,000 円は段を分けない（年 9.6 万円）が、段の値になる年を 2034 年にずらす
    const plan = makePlan({
      adults: [adult({ raiseRate: 0.03 })],
      goals: [
        monthly('g-small', 8000, [2034, 1], [2044, 1]),
        monthly('g-big', 150000, [2038, 1], [2044, 1]),
      ],
    })
    const result = evaluate(plan, tables, defaults)
    // 段の最初の年と値になった年が違う段がある（この形でないと確かめにならない）
    expect(result.steps.some((s) => s.fromYear !== s.peakYear)).toBe(true)
    for (const step of result.steps) {
      expect(step.expectedGross).toBe(householdGross(expectedLevels(plan, step.peakYear)))
      const short = step.requiredGross === null || step.requiredGross > step.expectedGross
      const conversion = result.conversions.find((c) => c.fromYear === step.fromYear)
      expect(conversion !== undefined).toBe(short)
      if (conversion !== undefined) expect(conversion.shortfallNet).toBeGreaterThan(0)
    }
    // 換算のある段と無い段の両方が出る
    expect(result.conversions.length).toBeGreaterThan(0)
    expect(result.conversions.length).toBeLessThan(result.steps.length)
  })
})

describe('evaluate：次の段', () => {
  it('どの段も今の世帯年収で足りれば null', () => {
    const result = evaluate(makePlan(), tables, defaults)
    expect(result.steps).toHaveLength(1)
    expect(result.steps[0]?.requiredGross).toBeLessThan(result.currentGross)
    expect(result.nextStep).toBeNull()
    expect(result.conversions).toEqual([])
  })

  it('解けない段は今の世帯年収を上回るとみなし、知らせる', () => {
    const plan = makePlan({ goals: [monthly('g-huge', 9000000, [2034, 1], [2036, 1])] })
    const result = evaluate(plan, tables, defaults)
    const unsolved = result.steps.find((s) => s.requiredGross === null)
    expect(unsolved).toMatchObject({ fromYear: 2034, toYear: 2035 })
    expect(result.nextStep).toBe(unsolved)
    expect(result.notices).toContainEqual({ kind: 'unsolvableStep', fromYear: 2034, toYear: 2035 })
  })

  it('もう退職していれば、段も次の段も無い', () => {
    const plan = makePlan({ adults: [adult({ birthYear: 1960 })] })
    const result = evaluate(plan, tables, defaults)
    expect(result.years).toEqual([])
    expect(result.steps).toEqual([])
    expect(result.nextStep).toBeNull()
  })
})

describe('evaluate：知らせ', () => {
  it('一度きりの出費：使う月が過ぎた／12 か月を切った（貯まっていれば知らせない）', () => {
    const plan = makePlan({
      baseYearMonth: yearMonth(2031, 6),
      goals: [
        once('g-past', 210000, [2031, 6]),
        once('g-soon', 210000, [2032, 5]),
        once('g-edge', 210000, [2032, 6]),
        once('g-saved', 210000, [2031, 9], 210000),
        { ...once('g-off', 210000, [2031, 1]), enabled: false },
      ],
    })
    const { notices } = evaluate(plan, tables, defaults)
    expect(notices).toContainEqual({ kind: 'onceGoalPast', goalId: 'g-past', name: 'g-past' })
    expect(notices).toContainEqual({
      kind: 'onceGoalSoon',
      goalId: 'g-soon',
      name: 'g-soon',
      monthsLeft: 11,
    })
    const ids = notices.flatMap((n) => ('goalId' in n ? [n.goalId] : []))
    expect(ids).not.toContain('g-edge')
    expect(ids).not.toContain('g-saved')
    expect(ids).not.toContain('g-off')
  })

  it('車：現金で買う月まで 12 か月を切り、代金が残っていれば知らせる（貯まっている・ローン・もう持っている・オフは知らせない。T8）', () => {
    const car = (id: string, overrides: Partial<CarGoal> = {}): CarGoal => ({
      id,
      enabled: true,
      kind: 'car',
      saved: 0,
      purchaseYear: 2032,
      price: 2640000,
      payment: { type: 'cash' },
      monthlyUpkeep: 18000,
      replaceEveryYears: null,
      ...overrides,
    })
    const plan = makePlan({
      baseYearMonth: yearMonth(2031, 3),
      goals: [
        car('c-soon'),
        car('c-far', { purchaseYear: 2033 }),
        car('c-saved', { saved: 2640000 }),
        car('c-loan', { payment: { type: 'loan', years: 5 } }),
        car('c-owned', { purchaseYear: 2031 }),
        car('c-off', { enabled: false }),
      ],
    })
    const cars = evaluate(plan, tables, defaults).notices.filter((n) => n.kind === 'carSavingSoon')
    expect(cars).toEqual([{ kind: 'carSavingSoon', goalId: 'c-soon', monthsLeft: 10 }])
  })

  it('要る手取りが負の年', () => {
    const plan = makePlan({
      goals: [monthly('g-rent-income', 400000, [2033, 1], [2035, 1], { direction: 'income' })],
    })
    const { notices } = evaluate(plan, tables, defaults)
    expect(notices).toContainEqual({ kind: 'negativeNeed', years: [2033, 2034] })
  })

  it('国保の料率が無い自治体で国保の加入者がいれば、概算を知らせる', () => {
    const plan = makePlan({ adults: [adult({ workStyle: 'selfEmployed', annualIncome: 3900000 })] })
    expect(evaluate(plan, tables, defaults).notices).toContainEqual({
      kind: 'municipalityApproximated',
      municipality: '99001',
    })
    // 会社員だけの世帯は国保に入らないので、知らせない
    expect(evaluate(makePlan(), tables, defaults).notices).toEqual([])
  })
})

describe('evaluate：物価（SPEC §3.4 の順番）', () => {
  const plan = makePlan({
    assumptions: { investmentReturnRate: 0.03, inflationRate: 0.02, mortgageRate: 0.01 },
    goals: [monthly('g-car', 61000, [2036, 1], [2041, 1])],
  })
  const result = evaluate(plan, tables, defaults)
  const nominal = yearlyNeeds(
    expandPlan(plan, defaults, tables),
    plan.baseYearMonth,
    lastNeedYear(plan),
  )

  it('年ごとの要る手取りは、内訳ごとに今のお金の価値に割り戻し、合計は内訳の和', () => {
    result.years.forEach((year, i) => {
      const source = nominal[i]
      if (source === undefined) throw new Error('年がずれている')
      expect(year.year).toBe(source.year)
      year.byGoal.forEach((goal, j) => {
        expect(goal.annual).toBe(toTodayValue(source.byGoal[j]?.annual ?? 0, 0.02, 2031, year.year))
      })
      expect(year.requiredNet).toBe(year.byGoal.reduce((t, g) => t + g.annual, 0))
    })
  })

  it('額面はその年の円の要る手取りで解き、その年から割り戻す', () => {
    for (const step of result.steps) {
      const nominalNeed = nominal.find((y) => y.year === step.peakYear)?.requiredNet ?? 0
      const solved = requiredHouseholdGross(contextOf(plan, step.peakYear), nominalNeed)
      expect(step.requiredGross).toBe(toTodayValue(solved?.gross ?? 0, 0.02, 2031, step.peakYear))
    }
  })

  it('物価が 0 なら、割り戻しても入れた金額どおり', () => {
    expect(toTodayValue(1234567, 0, 2031, 2050)).toBe(1234567)
    expect(toTodayValue(1020000, 0.02, 2031, 2032)).toBe(1000000)
  })
})

describe('evaluate：契約違反', () => {
  it('物価が -100% 以下・有限でない、帯の金額が負なら投げる', () => {
    const bad = (inflationRate: number) =>
      makePlan({ assumptions: { investmentReturnRate: 0, inflationRate, mortgageRate: 0 } })
    expect(() => evaluate(bad(-1), tables, defaults)).toThrow(RangeError)
    expect(() => evaluate(bad(Number.NaN), tables, defaults)).toThrow(RangeError)
    const negative = makePlan({ goals: [monthly('g', -1, [2032, 1], [2033, 1])] })
    expect(() => evaluate(negative, tables, defaults)).toThrow(RangeError)
  })
})

describe('evaluate：「計画」の画面で入れられる端の家族（T6）', () => {
  it('大人の生まれ年が起点の年（0 歳）でも、投げずに結果を返す', () => {
    const plan = makePlan({
      adults: [adult(), adult({ id: 'adult-2', birthYear: 2031, workStyle: 'notWorking' })],
    })
    const result = evaluate(plan, tables, defaults)
    expect(result.steps.length).toBeGreaterThan(0)
    // 本人が起点の年生まれで働いている形でも投げない（入力では止めない。生まれ年は今年まで受け付ける）
    const alone = evaluate(makePlan({ adults: [adult({ birthYear: 2031 })] }), tables, defaults)
    expect(alone.steps.length).toBeGreaterThan(0)
  })

  it('生まれる予定の子（起点の年より後の生まれ年）がいても、投げずに結果を返す', () => {
    const plan = makePlan({ children: [{ id: 'child-later', birthYear: 2033, birthMonth: 4 }] })
    const result = evaluate(plan, tables, defaults)
    expect(result.steps.length).toBeGreaterThan(0)
    expect(result.steps.every((step) => step.requiredGross !== null)).toBe(true)
  })
})

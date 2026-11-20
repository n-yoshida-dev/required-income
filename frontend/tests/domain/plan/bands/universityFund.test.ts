/**
 * 大学資金のカード → 帯（`bands/universityFund.ts`）と、児童手当を回す・回さないの切り替え（子の費用のカードとの受け渡し）のテスト。
 * 完了条件（T10）は、積立の到達額を閉じた式（年金終価係数）で手計算して突き合わせる。
 * 金額は児童手当・大学の学費の制度データ（data/benefit/child-allowance.json・data/education/university-cost.json）と架空の値。
 */

import { describe, expect, it } from 'vitest'
import { lastEligibleMonth } from '../../../../src/domain/benefit/childAllowance'
import { legacyChildOf, universityUseMonth } from '../../../../src/domain/plan/bands/childAllowance'
import { fundReached } from '../../../../src/domain/plan/bands/fund'
import { bandContext, expandGoal, expandPlan } from '../../../../src/domain/plan/bands/index'
import {
  universityBands,
  universityFundPlan,
} from '../../../../src/domain/plan/bands/universityFund'
import {
  changeUniversityCourse,
  childCostGoalTemplate,
  universityCourseTarget,
  universityTargetDefault,
} from '../../../../src/domain/plan/defaults'
import { evaluate } from '../../../../src/domain/plan/evaluate'
import { yearlyNeeds } from '../../../../src/domain/plan/need'
import type {
  Band,
  ChildCostGoal,
  ChildProfile,
  Goal,
  LifePlan,
  UniversityGoal,
} from '../../../../src/domain/plan/types'
import { addMonths, monthIndex, yearMonth } from '../../../../src/domain/plan/yearMonth'
import { adult, defaults, makePlan, tables } from '../planFixtures'

/** 児童手当の月額（child-allowance.json）：3 歳未満 15,000、3 歳以上 10,000、第 3 子以降 30,000 */
const tierOf = (fromAge: number) => {
  const tier = tables.childAllowance.tiers.find((t) => t.fromAge === fromAge)
  if (tier === undefined) throw new Error(`児童手当の表に ${fromAge} 歳からの区分が無い`)
  return tier
}
const UNDER_3 = tierOf(0).monthlyAmount
const FROM_3 = tierOf(3).monthlyAmount
const THIRD = tierOf(3).monthlyAmountThirdOrLater

// 架空の計画：起点 2031-04。大人は 1993 年生まれ・65 歳で退職 → 「ずっと」の終わりは 2058-01（子の帯が切れない）
const BASE = yearMonth(2031, 4)
const LATE_ADULT = adult({ birthYear: 1993 })
const RETURN_RATE = 0.04

/** 2031 年 3 月生まれ（起点の前の月に生まれた子）。児童手当は 2031-04 から 2049-03 まで、大学は 2049-04 から */
const child = (overrides: Partial<ChildProfile> = {}): ChildProfile => ({
  id: 'child-a',
  birthYear: 2031,
  birthMonth: 3,
  ...overrides,
})

/** 大学資金のカード（既定：児童手当を回す・子の名義の NISA・貯まっている額 0） */
const card = (overrides: Partial<UniversityGoal> = {}): UniversityGoal => ({
  id: 'goal-uni',
  enabled: true,
  kind: 'university',
  childId: 'child-a',
  targetAmount: 4000000,
  allocateChildAllowance: true,
  vehicle: 'childNisa',
  saved: 0,
  ...overrides,
})

/** 子の費用のカード（雛形：すべて公立） */
const childCostCard = (overrides: Partial<ChildCostGoal> = {}): ChildCostGoal => ({
  ...childCostGoalTemplate(defaults, 'child-a'),
  id: 'goal-kid',
  ...overrides,
})

const planWith = (goals: Goal[], overrides: Partial<LifePlan> = {}): LifePlan =>
  makePlan({
    baseYearMonth: BASE,
    adults: [LATE_ADULT],
    children: [child()],
    goals,
    assumptions: { investmentReturnRate: RETURN_RATE, inflationRate: 0, mortgageRate: 0.01 },
    ...overrides,
  })

const contextOf = (goals: Goal[], overrides: Partial<LifePlan> = {}) => {
  const plan = planWith(goals, overrides)
  return bandContext(plan, defaults, tables)
}

/** 帯の「[月額, から, まで]」の一覧（名前と種類で絞る） */
const byLabel = (bands: readonly Band[], label: string, kind?: Band['kind']) =>
  bands
    .filter((b) => b.label === label && (kind === undefined || b.kind === kind))
    .map((b) => [b.monthly, b.from, b.to])

// ---- 手計算（閉じた式。コードの式を使わずに書く） ----
/** 月の利率 i = 1.04^(1/12) − 1 */
const I = Math.pow(1 + RETURN_RATE, 1 / 12) - 1
/** 毎月末に 1 を n か月積んだ到達額 S(n) = ((1 + i)^n − 1) / i */
const S = (n: number) => (Math.pow(1 + I, n) - 1) / I
/** 児童手当の到達額：15,000 を 36 か月積み、残り 180 か月育つ ＋ 10,000 を 180 か月積む */
const ALLOWANCE_FV = UNDER_3 * S(36) * Math.pow(1 + I, 180) + FROM_3 * S(180)
/** 家計から月 15,000 を 216 か月積んだ到達額 */
const HOUSEHOLD_15000_FV = 15000 * S(216)

describe('完了条件（T10）', () => {
  it('前提：起点 2031-04・2031 年 3 月生まれ → 児童手当は 216 か月（15,000 × 36 か月 → 10,000 × 180 か月）、使う月は 2049-04', () => {
    expect([UNDER_3, FROM_3]).toEqual([15000, 10000])
    expect(universityUseMonth(child())).toEqual(yearMonth(2049, 4))
    const plan = universityFundPlan(card(), contextOf([card()]))
    expect(plan?.from).toEqual(BASE)
    expect(plan?.useMonth).toEqual(yearMonth(2049, 4))
    expect(plan?.allowanceMonthly).toEqual([
      ...Array.from({ length: 36 }, () => 15000),
      ...Array.from({ length: 180 }, () => 10000),
    ])
    expect(plan?.monthlyRate).toBeCloseTo(I, 15)
  })

  it('(a) 前向き：家計から月 15,000 を積むと、到達額は手計算（児童手当 ＋ 家計）と円まで一致する', () => {
    // 目標額を手計算の到達額の円未満切り捨てにすると、解く月額はちょうど 15,000 になる
    // （切り上げなので、四捨五入で 1 円でも上に丸めると 15,001 になる）
    const target = Math.floor(ALLOWANCE_FV + HOUSEHOLD_15000_FV)
    const plan = universityFundPlan(card({ targetAmount: target }), contextOf([card()]))
    if (plan === null) throw new Error('積立の答えが出ない')
    expect(plan.householdMonthly).toBe(15000)
    expect(plan.reached).toEqual({
      saved: 0,
      allowance: Math.round(ALLOWANCE_FV),
      household: Math.round(HOUSEHOLD_15000_FV),
      total: Math.round(ALLOWANCE_FV) + Math.round(HOUSEHOLD_15000_FV),
    })
    // 同じ前提を fundReached に直接渡しても同じ
    const terms = {
      months: 216,
      monthlyRate: plan.monthlyRate,
      saved: 0,
      allowanceMonthly: plan.allowanceMonthly,
    }
    expect(fundReached(terms, 15000)).toEqual(plan.reached)
  })

  it('(b) 逆向き：私立文系 4 年ぶんの目標額に、解いた月額で届き、1 円少ないと届かない', () => {
    const target = universityTargetDefault(tables.universityCost, 'privateHumanities')
    expect(target).toBe(4542391)
    const plan = universityFundPlan(card({ targetAmount: target }), contextOf([card()]))
    if (plan === null) throw new Error('積立の答えが出ない')
    const monthly = plan.householdMonthly
    expect(monthly).toBeGreaterThan(0)
    // 丸める前の手計算で比べる
    expect(ALLOWANCE_FV + monthly * S(216)).toBeGreaterThanOrEqual(target)
    expect(ALLOWANCE_FV + (monthly - 1) * S(216)).toBeLessThan(target)
    expect(plan.reached.total).toBeGreaterThanOrEqual(target)
  })

  it('(c) 帯：児童手当は earmarked で 15,000（2031-04 → 2034-04）と 10,000（→ 2049-04）、家計の積立は起点から 2049-04 の前まで', () => {
    const goal = card({ targetAmount: 4542391 })
    const ctx = contextOf([goal])
    const bands = universityBands(goal, ctx)
    const plan = universityFundPlan(goal, ctx)
    expect(bands).toEqual([
      {
        goalId: 'goal-uni',
        label: '児童手当（1人目）',
        kind: 'earmarked',
        monthly: 15000,
        from: yearMonth(2031, 4),
        to: yearMonth(2034, 4),
      },
      {
        goalId: 'goal-uni',
        label: '児童手当（1人目）',
        kind: 'earmarked',
        monthly: 10000,
        from: yearMonth(2034, 4),
        to: yearMonth(2049, 4),
      },
      {
        goalId: 'goal-uni',
        label: '大学資金の積立（1人目）',
        kind: 'saving',
        monthly: plan?.householdMonthly,
        from: BASE,
        to: yearMonth(2049, 4),
      },
    ])
  })
})

describe('進路（D37）', () => {
  it('進路を替えると、目標額がその進路の額に替わり、家計から足す月額も替わる（重い進路ほど多い）', () => {
    const monthlyOf = (goal: UniversityGoal) => {
      const plan = universityFundPlan(goal, contextOf([goal]))
      if (plan === null) throw new Error('積立の答えが出ない')
      return plan.householdMonthly
    }
    const science = changeUniversityCourse(
      card(),
      'privateScience',
      defaults,
      tables.universityCost,
    )
    const humanities = changeUniversityCourse(
      science,
      'privateHumanities',
      defaults,
      tables.universityCost,
    )
    const national = changeUniversityCourse(
      humanities,
      'nationalPublic',
      defaults,
      tables.universityCost,
    )
    expect(science.targetAmount).toBe(
      universityCourseTarget(defaults, tables.universityCost, 'privateScience'),
    )
    expect(national.targetAmount).toBe(
      universityCourseTarget(defaults, tables.universityCost, 'nationalPublic'),
    )
    expect(monthlyOf(science)).toBeGreaterThan(monthlyOf(humanities))
    expect(monthlyOf(humanities)).toBeGreaterThan(monthlyOf(national))
    // 帯の家計の積立も同じ月額で替わる
    const saving = (goal: UniversityGoal) =>
      universityBands(goal, contextOf([goal])).find((b) => b.label === '大学資金の積立（1人目）')
        ?.monthly
    expect(saving(science)).toBe(monthlyOf(science))
    expect(saving(national)).toBe(monthlyOf(national))
  })

  it('進路は計算に使わない：進路の無いカード（前の保存）は、保存した目標額のまま計算する', () => {
    const old = card({ targetAmount: 3000000 })
    expect(old.course).toBeUndefined()
    const withCourse = card({ targetAmount: 3000000, course: 'privateScience' })
    expect(universityFundPlan(old, contextOf([old]))).toEqual(
      universityFundPlan(withCourse, contextOf([withCourse])),
    )
  })
})

describe('置き場と利率', () => {
  it('預金なら利率 0：到達額は単純な和', () => {
    const goal = card({ vehicle: 'deposit', targetAmount: 5000000, saved: 280000 })
    const plan = universityFundPlan(goal, contextOf([goal]))
    expect(plan?.monthlyRate).toBe(0)
    // 児童手当の和：15,000 × 36 ＋ 10,000 × 180 = 2,340,000
    expect(plan?.reached.allowance).toBe(2340000)
    expect(plan?.reached.saved).toBe(280000)
    // (5,000,000 − 280,000 − 2,340,000) ÷ 216 = 11,018.5… → 11,019
    expect(plan?.householdMonthly).toBe(11019)
  })

  it('子の名義の NISA は前提の利回りを使う（前提を変えると月の利率が変わる）', () => {
    const goal = card()
    const at3 = universityFundPlan(
      goal,
      contextOf([goal], {
        assumptions: { investmentReturnRate: 0.03, inflationRate: 0, mortgageRate: 0.01 },
      }),
    )
    expect(Math.pow(1 + (at3?.monthlyRate ?? 0), 12)).toBeCloseTo(1.03, 12)
  })
})

describe('児童手当を回す・回さない（子の費用のカードとの受け渡し）', () => {
  /** 2 枚のカードを帯にする */
  const bandsOf = (goals: Goal[]) => expandPlan(planWith(goals), defaults, tables)

  it('回さない：大学資金のカードは earmarked を出さず、子の費用のカードが収入の帯で出す', () => {
    const bands = bandsOf([childCostCard(), card({ allocateChildAllowance: false })])
    expect(bands.filter((b) => b.kind === 'earmarked')).toEqual([])
    expect(bands.filter((b) => b.label === '児童手当（1人目）').map((b) => b.goalId)).toEqual([
      'goal-kid',
      'goal-kid',
    ])
    expect(byLabel(bands, '児童手当（1人目）', 'income')).toEqual([
      [15000, BASE, yearMonth(2034, 4)],
      [10000, yearMonth(2034, 4), yearMonth(2049, 4)],
    ])
    const plan = universityFundPlan(card({ allocateChildAllowance: false }), contextOf([]))
    expect(plan?.allowanceMonthly).toEqual([])
    expect(plan?.reached.allowance).toBe(0)
  })

  it('回す：子の費用のカードは児童手当の帯を出さず、どの月も収入と earmarked が重ならない', () => {
    const bands = bandsOf([childCostCard(), card()])
    expect(bands.filter((b) => b.goalId === 'goal-kid' && b.label.startsWith('児童手当'))).toEqual(
      [],
    )
    const allowance = bands.filter((b) => b.label === '児童手当（1人目）')
    expect(allowance.every((b) => b.kind === 'earmarked' && b.goalId === 'goal-uni')).toBe(true)
    // 月ごとに数えて、収入と earmarked が同じ月に両方あることは無い
    const covered = (kind: Band['kind']) =>
      new Set(
        allowance
          .filter((b) => b.kind === kind)
          .flatMap((b) =>
            Array.from(
              { length: monthIndex(b.to) - monthIndex(b.from) },
              (_, k) => monthIndex(b.from) + k,
            ),
          ),
      )
    const income = covered('income')
    expect([...covered('earmarked')].filter((m) => income.has(m))).toEqual([])
    expect(covered('earmarked').size).toBe(216)
  })

  it('大学資金のカードをオフにすると、回す設定のままでも子の費用のカードの収入の帯が戻る', () => {
    const bands = bandsOf([childCostCard(), card({ enabled: false })])
    expect(bands.filter((b) => b.kind === 'earmarked')).toEqual([])
    expect(byLabel(bands, '児童手当（1人目）', 'income')).toEqual([
      [15000, BASE, yearMonth(2034, 4)],
      [10000, yearMonth(2034, 4), yearMonth(2049, 4)],
    ])
  })

  it('子の費用のカードをオフにして回すなら、児童手当は earmarked だけ', () => {
    const bands = bandsOf([childCostCard({ enabled: false }), card()])
    const allowance = bands.filter((b) => b.label === '児童手当（1人目）')
    expect(allowance.map((b) => b.kind)).toEqual(['earmarked', 'earmarked'])
  })

  it('要件：回す／回さないで、要る手取りへの入り方が変わる（子の費用はちょうど児童手当の分、大学資金の積立も変わる）', () => {
    const needIn = (goals: Goal[], year: number) => {
      const need = yearlyNeeds(bandsOf(goals), BASE, year).find((y) => y.year === year)
      const of = (goalId: string) => need?.byGoal.find((g) => g.goalId === goalId)?.annual ?? 0
      return {
        living: of('living'),
        kid: of('goal-kid'),
        uni: of('goal-uni'),
        total: need?.requiredNet ?? NaN,
      }
    }
    const year = 2036
    const on = needIn([childCostCard(), card()], year)
    const off = needIn([childCostCard(), card({ allocateChildAllowance: false })], year)
    // 2036 年は 3 歳以上：月 10,000 × 12 = 120,000。回さなければ子の費用の要る額が 120,000 減る（収入の帯）
    expect(on.kid - off.kid).toBe(FROM_3 * 12)
    // 回すと earmarked は要る手取りに入らないかわりに、家計から足す積立が減る
    const monthly = (goal: UniversityGoal) =>
      universityFundPlan(goal, contextOf([goal]))?.householdMonthly ?? NaN
    expect(on.uni).toBe(monthly(card()) * 12)
    expect(off.uni).toBe(monthly(card({ allocateChildAllowance: false })) * 12)
    expect(off.uni).toBeGreaterThan(on.uni)
    // 合計は内訳の和（暮らしは同じ）
    expect(on.living).toBe(off.living)
    expect(on.total).toBe(on.living + on.kid + on.uni)
    expect(off.total).toBe(off.living + off.kid + off.uni)
    // 合計の差 ＝ 児童手当の分 − 積立の差
    expect(on.total - off.total).toBe(FROM_3 * 12 - (off.uni - on.uni))
  })
})

describe('第 3 子の加算', () => {
  it('3 人目のカードは 30,000 を回す。いちばん上が 22 歳の年度末（2035 年 3 月）を過ぎると 10,000', () => {
    const children = [
      child({ id: 'child-1', birthYear: 2012, birthMonth: 5 }),
      child({ id: 'child-2', birthYear: 2030, birthMonth: 8 }),
      child({ id: 'child-3' }),
    ]
    const goal = card({ childId: 'child-3' })
    const bands = expandGoal(goal, contextOf([goal], { children }))
    expect(THIRD).toBe(30000)
    expect(byLabel(bands, '児童手当（3人目）', 'earmarked')).toEqual([
      [THIRD, BASE, yearMonth(2035, 4)],
      [FROM_3, yearMonth(2035, 4), yearMonth(2049, 4)],
    ])
    expect(byLabel(bands, '大学資金の積立（3人目）')).toHaveLength(1)
  })
})

describe('届いている・期限が過ぎた（知らせ）', () => {
  const noticesOf = (goals: Goal[], overrides: Partial<LifePlan> = {}) =>
    evaluate(planWith(goals, overrides), tables, defaults).notices

  it('貯まっている額だけで目標額を超えていれば、家計の月額は 0 で 0 円の帯を出し、知らせは withSaved: true', () => {
    const goal = card({ targetAmount: 3600000, saved: 3900000 })
    const plan = universityFundPlan(goal, contextOf([goal]))
    expect(plan?.householdMonthly).toBe(0)
    expect(plan?.reached.household).toBe(0)
    expect(byLabel(universityBands(goal, contextOf([goal])), '大学資金の積立（1人目）')).toEqual([
      [0, BASE, yearMonth(2049, 4)],
    ])
    expect(noticesOf([goal]).filter((n) => n.kind === 'allowanceCovers')).toEqual([
      { kind: 'allowanceCovers', goalId: 'goal-uni', withSaved: true },
    ])
  })

  it('児童手当だけで届けば、知らせは withSaved: false', () => {
    // 児童手当の到達額（約 348 万円）より小さい目標
    const goal = card({ targetAmount: 2900000 })
    expect(ALLOWANCE_FV).toBeGreaterThan(2900000)
    expect(universityFundPlan(goal, contextOf([goal]))?.householdMonthly).toBe(0)
    expect(noticesOf([goal]).filter((n) => n.kind === 'allowanceCovers')).toEqual([
      { kind: 'allowanceCovers', goalId: 'goal-uni', withSaved: false },
    ])
  })

  it('回さないカード・家計から足すカードには「児童手当で届く」を出さない', () => {
    const small = card({ targetAmount: 2900000, allocateChildAllowance: false, saved: 3000000 })
    expect(noticesOf([small]).some((n) => n.kind === 'allowanceCovers')).toBe(false)
    expect(noticesOf([card()]).some((n) => n.kind === 'allowanceCovers')).toBe(false)
  })

  it('もう高校を出た子（2012 年 6 月生まれ・起点で 18〜19 歳）は帯を出さず、知らせは fundDeadlinePast', () => {
    const goal = card()
    const overrides = { children: [child({ birthYear: 2012, birthMonth: 6 })] }
    // 使う月は 2031-04 ＝ 起点。積み立てる月が無い
    expect(universityUseMonth(child({ birthYear: 2012, birthMonth: 6 }))).toEqual(BASE)
    expect(universityFundPlan(goal, contextOf([goal], overrides))).toBeNull()
    expect(universityBands(goal, contextOf([goal], overrides))).toEqual([])
    expect(noticesOf([goal], overrides).filter((n) => n.kind === 'fundDeadlinePast')).toEqual([
      { kind: 'fundDeadlinePast', goalId: 'goal-uni' },
    ])
    // もっと前に出た子（2010 年 9 月生まれ）も同じ
    const older = { children: [child({ birthYear: 2010, birthMonth: 9 })] }
    expect(universityBands(goal, contextOf([goal], older))).toEqual([])
  })

  it('使う月が起点の翌月なら 1 か月だけ積む（高校 3 年の 3 月が起点）', () => {
    // 2013 年 7 月生まれ・起点 2032-03 → 使う月は 2032-04
    const goal = card({ vehicle: 'deposit', targetAmount: 300000 })
    const overrides = {
      baseYearMonth: yearMonth(2032, 3),
      children: [child({ birthYear: 2013, birthMonth: 7 })],
    }
    const plan = universityFundPlan(goal, contextOf([goal], overrides))
    expect(plan?.useMonth).toEqual(yearMonth(2032, 4))
    // 3 月分の児童手当 10,000 を回し、残り 290,000 を 1 か月で
    expect(plan?.allowanceMonthly).toEqual([10000])
    expect(plan?.householdMonthly).toBe(290000)
  })

  it('オフのカードは知らせも出さない', () => {
    const overrides = { children: [child({ birthYear: 2012, birthMonth: 6 })] }
    expect(
      noticesOf([card({ enabled: false })], overrides).some((n) => n.kind === 'fundDeadlinePast'),
    ).toBe(false)
  })
})

describe('使う月 ＝ 児童手当の支給の終わりの翌月', () => {
  it.each([
    [2030, 1],
    [2030, 3],
    [2030, 4],
    [2030, 12],
    [2033, 2],
    [2033, 7],
  ])('%i 年 %i 月生まれ', (birthYear, birthMonth) => {
    const profile = child({ birthYear, birthMonth: birthMonth as ChildProfile['birthMonth'] })
    const last = lastEligibleMonth(legacyChildOf(profile), tables.childAllowance)
    expect(universityUseMonth(profile)).toEqual(addMonths(last, 1))
  })

  it('1〜3 月生まれは 4 月生まれより 1 年早い', () => {
    expect(universityUseMonth(child({ birthYear: 2030, birthMonth: 3 }))).toEqual(
      yearMonth(2048, 4),
    )
    expect(universityUseMonth(child({ birthYear: 2030, birthMonth: 4 }))).toEqual(
      yearMonth(2049, 4),
    )
  })
})

describe('契約違反', () => {
  it('子が見つからない・金額が負・置き場が選択肢に無いなら投げる', () => {
    const ctx = contextOf([])
    expect(() => universityBands(card({ childId: 'child-x' }), ctx)).toThrow(RangeError)
    expect(() => universityBands(card({ targetAmount: -1 }), ctx)).toThrow(RangeError)
    expect(() => universityBands(card({ saved: 0.5 }), ctx)).toThrow(RangeError)
    expect(() =>
      universityBands(card({ vehicle: 'nisa' as UniversityGoal['vehicle'] }), ctx),
    ).toThrow(RangeError)
  })
})

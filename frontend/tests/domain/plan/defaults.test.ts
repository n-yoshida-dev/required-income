import { describe, expect, it } from 'vitest'
import { appDefaults } from '../../../src/data/appData'
import flat35Json from '../../../src/data/housing/flat35-rate.json'
import sampleJson from '../../../src/data/app/sample-household.json'
import universityCostJson from '../../../src/data/education/university-cost.json'
import { expandPlan } from '../../../src/domain/plan/bands/index'
import {
  adultTemplate,
  carGoalTemplate,
  changeCarPayment,
  changeCarReplacement,
  changeCustomVariant,
  changeUniversityCourse,
  childCostGoalId,
  childCostGoalTemplate,
  childTemplate,
  cramSchoolTemplate,
  customGoalTemplate,
  customVariantOf,
  homeGoalTemplate,
  retirementGoalTemplate,
  sampleLifePlan,
  syncChildCostGoals,
  UNIVERSITY_COURSES,
  universityCourseTarget,
  universityGoalTemplate,
  universityTargetDefault,
} from '../../../src/domain/plan/defaults'
import { lastNeedYear, yearlyNeeds } from '../../../src/domain/plan/need'
import type {
  AppDefaults,
  ChildProfile,
  SampleCarGoalSource,
  SampleCustomGoalSource,
  SampleHouseholdSource,
  SampleRetirementGoalSource,
} from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { tables } from './planFixtures'

// JSON がこの型に入ることも、このテストで確かめている（形が変われば型検査で落ちる）
const defaults: AppDefaults = appDefaults
const sample: SampleHouseholdSource = sampleJson.values
const base = yearMonth(2026, 11)

/** 見本の自由入力のカードだけを差し替えた見本 */
const withCustom = (goal: SampleCustomGoalSource): SampleHouseholdSource => ({
  ...sample,
  customGoals: [goal],
})

describe('sampleLifePlan', () => {
  it('JSON の見本と既定値から LifePlan を作る', () => {
    const plan = sampleLifePlan(defaults, sample, base)
    expect(plan.baseYearMonth).toEqual(base)
    expect(plan.adults).toHaveLength(2)
    for (const adult of plan.adults) {
      expect(adult.retirementAge).toBe(defaults.adult.retirementAge.value)
      expect(adult.raiseRate).toBe(defaults.adult.raiseRate.value)
      expect(adult.sideMonthlyProfit).toBe(0)
      expect(adult.outlookSteps).toEqual([])
    }
    // PLAN.md の見本（今 900 万）と合わせている
    expect(plan.adults.reduce((sum, a) => sum + a.annualIncome, 0)).toBe(9000000)
    expect(plan.assumptions.inflationRate).toBe(0)
    expect(plan.goals.every((g) => g.enabled)).toBe(true)
    // 見本のカードは自由入力と家（T7）と車（T8）と子の費用（T9。子ごとに 1 枚）と大学資金・老後資金（T10）。
    // 家は「起点の年から 6 年後」、車は 3 年後に買う
    expect(plan.goals.map((g) => g.kind)).toEqual([
      'custom',
      'custom',
      'home',
      'car',
      'childCost',
      'childCost',
      'university',
      'retirement',
    ])
    // 大学資金は 2 人目に 1 枚（児童手当を回す・子の名義の NISA）、老後資金は起点の年から 19 年後の前年末まで（NISA）
    expect(plan.goals.find((g) => g.kind === 'university')).toEqual({
      id: 'goal-university-2',
      enabled: true,
      kind: 'university',
      childId: 'child-2',
      targetAmount: 4180000,
      allocateChildAllowance: true,
      vehicle: 'childNisa',
      saved: 2460000,
    })
    expect(plan.goals.find((g) => g.kind === 'retirement')).toEqual({
      id: 'goal-retirement',
      enabled: true,
      kind: 'retirement',
      targetAmount: 26400000,
      byYear: 2045,
      vehicle: 'nisa',
      saved: 3460000,
    })
    expect(plan.goals.flatMap((g) => (g.kind === 'childCost' ? [g.childId] : []))).toEqual(
      plan.children.map((c) => c.id),
    )
    expect(plan.goals.find((g) => g.kind === 'home')).toMatchObject({ purchaseYear: 2032 })
    expect(plan.goals.find((g) => g.kind === 'car')).toMatchObject({
      purchaseYear: 2029,
      payment: { type: 'loan', years: 6 },
      replaceEveryYears: 7,
    })
    // 前提の住宅ローン金利は、フラット35 の最頻金利（data/housing/flat35-rate.json）
    expect(plan.assumptions.mortgageRate).toBe(flat35Json.values.flat35.mostCommonRate)
  })

  it('見本の家を買う年は起点の年からの相対。年数が負・整数でないなら投げる', () => {
    const later = sampleLifePlan(defaults, sample, yearMonth(2031, 4))
    expect(later.goals.find((g) => g.kind === 'home')).toMatchObject({ purchaseYear: 2037 })
    const withHome = (purchaseYearsLater: number): SampleHouseholdSource => ({
      ...sample,
      homeGoals: sample.homeGoals.map((home) => ({ ...home, purchaseYearsLater })),
    })
    expect(() => sampleLifePlan(defaults, withHome(-1), base)).toThrow(/年数/)
    expect(() => sampleLifePlan(defaults, withHome(1.5), base)).toThrow(/年数/)
  })

  it('見本の車：払い方が現金なら cash、選択肢に無い・ローンなのに年数が無いなら投げる（T8）', () => {
    const withCar = (change: Partial<SampleCarGoalSource>): SampleHouseholdSource => ({
      ...sample,
      carGoals: sample.carGoals.map((car) => ({ ...car, ...change })),
    })
    const cash = sampleLifePlan(defaults, withCar({ payment: 'cash' }), base)
    expect(cash.goals.find((g) => g.kind === 'car')).toMatchObject({ payment: { type: 'cash' } })
    expect(() => sampleLifePlan(defaults, withCar({ payment: 'lease' }), base)).toThrow(/払い方/)
    expect(() =>
      sampleLifePlan(defaults, withCar({ payment: 'loan', loanYears: undefined }), base),
    ).toThrow(/loanYears/)
    expect(() => sampleLifePlan(defaults, withCar({ purchaseYearsLater: -1 }), base)).toThrow(
      /年数/,
    )
  })

  it('自治体は実在しないコード（ダミー）', () => {
    expect(sampleLifePlan(defaults, sample, base).municipality).toBe('99001')
  })

  it('見本の世帯の年ごとの要る手取り（11 月起点）', () => {
    const plan = sampleLifePlan(defaults, sample, base)
    const years = yearlyNeeds(expandPlan(plan, defaults, tables), base, lastNeedYear(plan))
    // 先に退職するのは起点の年で 46 歳の大人（1980 年生まれ・65 歳 → 2045 年）→ 2044 年まで
    expect(years.map((y) => y.year)).toEqual(Array.from({ length: 19 }, (_, i) => 2026 + i))
    // 暮らし (260,000 + 95,000) × 12、ペット 7,500 × 12、
    // 旅行 186,000 ÷ 26 か月（2026-11 → 2029-01）= 7,153.8… → 切り上げて 7,154 × 12 = 85,848
    // 家の頭金と諸費用：（頭金 3,900,000 ＋ 諸費用 48,600,000 × 6% = 2,916,000 − 貯まっている 6,320,000）
    //   = 496,000 ÷ 62 か月（2026-11 → 2032-01）= 8,000 × 12 = 96,000
    // 子の費用（school-cost.json と high-school-support.json の値から）：
    //   1 人目（2010 年 6 月生まれ・高 1・公立）：学校 (351,523 − 調査の授業料 45,272 ＋ 授業料の標準額 118,800) ÷ 12 = 35,420.9 → 35,421、
    //     習い事（統計）44,437 ÷ 12 = 3,703.1 → 3,703、塾 33,800、就学支援金 −min(118,800 ÷ 12, 9,900) = −9,900、
    //     児童手当 −10,000（T10。大学資金のカードが無いので収入の帯）→ 月 53,024 × 12 = 636,288
    //   2 人目（2012 年 11 月生まれ・中 2・公立）：学校 (150,761 + 35,671) ÷ 12 = 15,536、習い事 8,600、塾 27,300 → 月 51,436 × 12 = 617,232
    //     （児童手当は大学資金のカードに回すので、子の費用のカードには入らない。回す分 earmarked は要る手取りに入らない）
    // 大学資金（2 人目）：家計から足す月 14,351 × 12 = 172,212（解いた月額。式は bands/universityFund.test.ts で固定）
    // 老後資金：家計から足す月 71,058 × 12 = 852,696（式は bands/retirementFund.test.ts で固定）
    expect(years[0]).toEqual({
      year: 2026,
      requiredNet: 6810276,
      byGoal: [
        { goalId: 'living', annual: 4260000 },
        { goalId: 'goal-pet', annual: 90000 },
        { goalId: 'goal-trip', annual: 85848 },
        { goalId: 'goal-home', annual: 96000 },
        { goalId: 'goal-child-1', annual: 636288 },
        { goalId: 'goal-child-2', annual: 617232 },
        { goalId: 'goal-university-2', annual: 172212 },
        { goalId: 'goal-retirement', annual: 852696 },
      ],
    })
    // 合計は内訳の和
    expect(years[0]?.byGoal.reduce((sum, g) => sum + g.annual, 0)).toBe(years[0]?.requiredNet)
  })

  it('年月は起点からの相対：起点を何年ずらしても、生まれ年とカードの年が同じだけずれる', () => {
    const early = sampleLifePlan(defaults, sample, yearMonth(2026, 11))
    const late = sampleLifePlan(defaults, sample, yearMonth(2031, 4))
    expect(late.adults.map((a) => a.birthYear - 5)).toEqual(early.adults.map((a) => a.birthYear))
    expect(late.children.map((c) => c.birthYear - 5)).toEqual(
      early.children.map((c) => c.birthYear),
    )
    // カードは「起点の年から何年後の 1 月」。起点の月によらず年の頭から始まる
    const pet = (plan: typeof early) => plan.goals.find((g) => g.id === 'goal-pet')
    expect(pet(early)).toMatchObject({
      from: { year: 2026, month: 1 },
      to: { year: 2038, month: 1 },
    })
    expect(pet(late)).toMatchObject({
      from: { year: 2031, month: 1 },
      to: { year: 2043, month: 1 },
    })
    const car = (plan: typeof early) => plan.goals.find((g) => g.id === 'goal-car')
    expect(car(early)).toMatchObject({ purchaseYear: 2029 })
    expect(car(late)).toMatchObject({ purchaseYear: 2034 })
    expect(late.goals.find((g) => g.id === 'goal-trip')).toMatchObject({
      at: { year: 2034, month: 1 },
    })
    // 老後資金の期限も起点の年から 19 年後（T10）
    const retirement = (plan: typeof early) => plan.goals.find((g) => g.id === 'goal-retirement')
    expect(retirement(early)).toMatchObject({ byYear: 2045 })
    expect(retirement(late)).toMatchObject({ byYear: 2050 })
  })

  it('見本の大学資金・老後資金：置き場が選択肢に無い・期限の年数が負なら投げる（T10）', () => {
    const withUniversity = (vehicle: string): SampleHouseholdSource => ({
      ...sample,
      universityGoals: sample.universityGoals.map((goal) => ({ ...goal, vehicle })),
    })
    const withRetirement = (
      change: Partial<SampleRetirementGoalSource>,
    ): SampleHouseholdSource => ({
      ...sample,
      retirementGoals: sample.retirementGoals.map((goal) => ({ ...goal, ...change })),
    })
    expect(() => sampleLifePlan(defaults, withUniversity('nisa'), base)).toThrow(/置き場/)
    expect(() => sampleLifePlan(defaults, withRetirement({ vehicle: 'childNisa' }), base)).toThrow(
      /置き場/,
    )
    expect(() => sampleLifePlan(defaults, withRetirement({ byYearsLater: -1 }), base)).toThrow(
      /年数/,
    )
    // 預金にもできる
    const deposit = sampleLifePlan(defaults, withUniversity('deposit'), base)
    expect(deposit.goals.find((g) => g.kind === 'university')).toMatchObject({ vehicle: 'deposit' })
  })

  it('起点が壊れていれば投げる', () => {
    expect(() => sampleLifePlan(defaults, sample, { year: 2026, month: 0 as 1 })).toThrow(
      RangeError,
    )
  })

  it('働き方・向き・金額の型が選択肢に無い、年月が欠けている、なら投げる', () => {
    const badAdult: SampleHouseholdSource = {
      ...sample,
      adults: [{ id: 'x', ageAtBase: 46, workStyle: 'freelance', annualIncome: 0 }],
    }
    expect(() => sampleLifePlan(defaults, badAdult, base)).toThrow(/働き方/)
    const badAge: SampleHouseholdSource = {
      ...sample,
      adults: [{ id: 'x', ageAtBase: -1, workStyle: 'employee', annualIncome: 0 }],
    }
    expect(() => sampleLifePlan(defaults, badAge, base)).toThrow(/年齢/)

    const monthly = {
      id: 'g',
      name: 'G',
      direction: 'expense',
      amountType: 'monthly',
      amount: 1000,
      fromYearsLater: 1,
      toYearsLater: 2,
    }
    const run = (goal: SampleCustomGoalSource) => () =>
      sampleLifePlan(defaults, withCustom(goal), base)
    expect(run({ ...monthly, direction: 'both' })).toThrow(/向き/)
    expect(run({ ...monthly, amountType: 'yearly' })).toThrow(/金額の型/)
    expect(run({ ...monthly, toYearsLater: undefined })).toThrow(/toYearsLater/)
    expect(run({ ...monthly, fromYearsLater: -1 })).toThrow(/年数/)
    expect(run({ ...monthly, fromYearsLater: 0.5 })).toThrow(/年数/)
    expect(run({ ...monthly, amountType: 'once', direction: 'income', atYearsLater: 2 })).toThrow(
      /支出だけ/,
    )
  })
})

describe('足すときの雛形（T6）', () => {
  const templates = defaults.templates

  it('もう 1 人の大人は、雛形の年齢・働き方・年収と大人の既定値で入る', () => {
    const adult = adultTemplate(defaults, base, 'adult-x')
    expect(adult).toEqual({
      id: 'adult-x',
      birthYear: base.year - templates.adult.value.ageAtBase,
      workStyle: templates.adult.value.workStyle,
      annualIncome: templates.adult.value.annualIncome,
      raiseRate: defaults.adult.raiseRate.value,
      outlookSteps: [],
      sideMonthlyProfit: defaults.adult.sideMonthlyProfit.value,
      retirementAge: defaults.adult.retirementAge.value,
    })
  })

  it('家は雛形の価格・頭金・ローンの年数（35 年）・維持費で、雛形の年数後に買う。貯まっている額は 0（T7）', () => {
    const home = templates.home.value
    expect(homeGoalTemplate(defaults, base, 'goal-9')).toEqual({
      id: 'goal-9',
      enabled: true,
      kind: 'home',
      purchaseYear: base.year + home.purchaseYearsLater,
      price: home.price,
      downPayment: home.downPayment,
      loanYears: 35,
      monthlyUpkeep: home.monthlyUpkeep,
      saved: 0,
    })
  })

  it('車は雛形の価格・維持費・買い替えの周期で、雛形の年数後に現金で買う。貯まっている額は 0（T8）', () => {
    const car = templates.car.value
    expect(carGoalTemplate(defaults, base, 'goal-8')).toEqual({
      id: 'goal-8',
      enabled: true,
      kind: 'car',
      purchaseYear: base.year + car.purchaseYearsLater,
      price: car.price,
      payment: { type: 'cash' },
      monthlyUpkeep: car.monthlyUpkeep,
      replaceEveryYears: 7,
      saved: 0,
    })
  })

  it('車の払い方を替える：ローンは雛形の年数で入り、現金に戻すと年数は消える。同じなら元のまま（T8）', () => {
    const cash = carGoalTemplate(defaults, base, 'goal-8')
    const loan = changeCarPayment(cash, 'loan', defaults)
    expect(loan.payment).toEqual({ type: 'loan', years: templates.car.value.loanYears })
    expect(changeCarPayment(loan, 'cash', defaults).payment).toEqual({ type: 'cash' })
    expect(changeCarPayment(cash, 'cash', defaults)).toBe(cash)
  })

  it('車の買い替えを替える：買い替えないは null、買い替えるに戻すと雛形の周期（T8）', () => {
    const car = { ...carGoalTemplate(defaults, base, 'goal-8'), replaceEveryYears: 10 }
    const keep = changeCarReplacement(car, false, defaults)
    expect(keep.replaceEveryYears).toBeNull()
    expect(changeCarReplacement(keep, true, defaults).replaceEveryYears).toBe(
      templates.car.value.replaceEveryYears,
    )
    expect(changeCarReplacement(car, true, defaults)).toBe(car)
  })

  it('子は雛形の年齢で、生まれ月は起点の月', () => {
    expect(childTemplate(defaults, base, 'child-x')).toEqual({
      id: 'child-x',
      birthYear: base.year - templates.child.value.ageAtBase,
      birthMonth: base.month,
    })
  })

  it('毎月の支出・収入は起点の月から、雛形の年数後の 1 月の前まで', () => {
    const expense = customGoalTemplate(defaults, base, 'g1', 'monthlyExpense')
    expect(expense).toEqual({
      id: 'g1',
      enabled: true,
      kind: 'custom',
      name: templates.customMonthly.value.expenseName,
      amountType: 'monthly',
      direction: 'expense',
      amount: templates.customMonthly.value.amount,
      from: base,
      to: yearMonth(base.year + templates.customMonthly.value.years, 1),
    })
    const income = customGoalTemplate(defaults, base, 'g2', 'monthlyIncome')
    expect(income).toMatchObject({
      direction: 'income',
      name: templates.customMonthly.value.incomeName,
    })
    expect(customVariantOf(expense)).toBe('monthlyExpense')
    expect(customVariantOf(income)).toBe('monthlyIncome')
  })

  it('一度きりは支出で、雛形の年数後の 1 月に使う。貯まっている額は 0', () => {
    const once = customGoalTemplate(defaults, base, 'g3', 'onceExpense')
    expect(once).toEqual({
      id: 'g3',
      enabled: true,
      kind: 'custom',
      name: templates.customOnce.value.name,
      amountType: 'once',
      direction: 'expense',
      amount: templates.customOnce.value.amount,
      at: yearMonth(base.year + templates.customOnce.value.atYearsLater, 1),
      saved: 0,
    })
    expect(customVariantOf(once)).toBe('onceExpense')
  })

  it('型を替える：支出 ⇄ 収入は向きだけ、毎月 ⇄ 一度きりは金額と時期を雛形にする', () => {
    const named = {
      ...customGoalTemplate(defaults, base, 'g', 'monthlyExpense'),
      name: '奨学金の返済',
      amount: 15000,
      enabled: false,
    }
    const income = changeCustomVariant(named, 'monthlyIncome', defaults, base)
    expect(income).toEqual({ ...named, direction: 'income' })

    const once = changeCustomVariant(named, 'onceExpense', defaults, base)
    expect(once).toMatchObject({
      id: 'g',
      name: '奨学金の返済',
      enabled: false,
      amountType: 'once',
      amount: templates.customOnce.value.amount,
      saved: 0,
    })
    expect(changeCustomVariant(named, 'monthlyExpense', defaults, base)).toBe(named)
  })

  it('型を替える：雛形の名前のままなら、名前も新しい型の雛形にする', () => {
    const plain = customGoalTemplate(defaults, base, 'g', 'monthlyExpense')
    expect(changeCustomVariant(plain, 'monthlyIncome', defaults, base).name).toBe(
      templates.customMonthly.value.incomeName,
    )
    expect(changeCustomVariant(plain, 'onceExpense', defaults, base).name).toBe(
      templates.customOnce.value.name,
    )
  })
})

describe('大学資金・老後資金のカードの雛形（T10）', () => {
  const university = universityCostJson.values

  it('大学資金の目標額の既定は、学部の初年度 ＋ 2 年目からの年額 ×（年限 − 1）。私立文系は 4,542,391', () => {
    const humanities = university.privateHumanities
    // 1,300,561 ＋ 1,080,610 × 3 = 4,542,391
    expect(universityTargetDefault(tables.universityCost, 'privateHumanities')).toBe(
      humanities.initialYear + humanities.annual * (humanities.years - 1),
    )
    expect(universityTargetDefault(tables.universityCost, 'privateHumanities')).toBe(4542391)
    // 医歯系は 6 年
    const medical = university.privateMedical
    expect(universityTargetDefault(tables.universityCost, 'privateMedical')).toBe(
      medical.initialYear + medical.annual * 5,
    )
    expect(() => universityTargetDefault(tables.universityCost, 'privateArts')).toThrow(RangeError)
  })

  it('大学資金のカードの雛形：進路は私立理系（D37）・その進路の目標額（1 万円単位に四捨五入）・児童手当を回す・子の名義の NISA・貯まっている額 0・オン', () => {
    const template = defaults.templates.university.value
    expect(template).toEqual({
      // 既定は重い方（私立理系）に倒す（D37。本人の決定）
      course: 'privateScience',
      allocateChildAllowance: true,
      vehicle: 'childNisa',
      targetRoundTo: 10000,
    })
    const science = university.privateScience
    // 表から同じ式で出す（初年度 ＋ 2 年目からの年額 × 3 を 1 万円に四捨五入）。数値を直書きしない
    const expected =
      Math.round((science.initialYear + science.annual * (science.years - 1)) / 10000) * 10000
    expect(universityGoalTemplate(defaults, tables.universityCost, 'child-3', 'goal-u')).toEqual({
      id: 'goal-u',
      enabled: true,
      kind: 'university',
      childId: 'child-3',
      course: 'privateScience',
      targetAmount: expected,
      allocateChildAllowance: true,
      vehicle: 'childNisa',
      saved: 0,
    })
    // 入れる欄は万円なので、小数が出ない
    expect(expected % 10000).toBe(0)
  })

  it('進路ごとの目標額は、表の初年度 ＋ 2 年目からの年額 ×（年限 − 1）を 1 万円に四捨五入した額。選べる進路は私立理系・私立文系・国立の順', () => {
    expect(UNIVERSITY_COURSES).toEqual(['privateScience', 'privateHumanities', 'nationalPublic'])
    for (const course of UNIVERSITY_COURSES) {
      const entry = university[course]
      expect(universityCourseTarget(defaults, tables.universityCost, course)).toBe(
        Math.round((entry.initialYear + entry.annual * (entry.years - 1)) / 10000) * 10000,
      )
    }
    // 重い順に並んでいる（画面の選択肢の並び）
    const amounts = UNIVERSITY_COURSES.map((course) =>
      universityCourseTarget(defaults, tables.universityCost, course),
    )
    expect([...amounts].sort((a, b) => b - a)).toEqual(amounts)
  })

  it('進路を替えると、目標額だけがその進路の額に替わる（手で直した額も上書き）。ほかの欄は変えない', () => {
    const mine = {
      ...universityGoalTemplate(defaults, tables.universityCost, 'child-3', 'goal-u'),
      targetAmount: 5550000,
      allocateChildAllowance: false,
      vehicle: 'deposit' as const,
      saved: 1200000,
    }
    expect(changeUniversityCourse(mine, 'nationalPublic', defaults, tables.universityCost)).toEqual(
      {
        ...mine,
        course: 'nationalPublic',
        targetAmount: universityCourseTarget(defaults, tables.universityCost, 'nationalPublic'),
      },
    )
    // 進路の無いカード（前の保存）も、選んだときに初めて額が替わる
    const { course: _course, ...old } = mine
    expect(
      changeUniversityCourse(old, 'privateHumanities', defaults, tables.universityCost),
    ).toEqual({
      ...old,
      course: 'privateHumanities',
      targetAmount: universityCourseTarget(defaults, tables.universityCost, 'privateHumanities'),
    })
  })

  it('既定値の進路が選べる進路に無ければ投げる', () => {
    const broken = {
      ...defaults,
      templates: {
        ...defaults.templates,
        university: {
          ...defaults.templates.university,
          value: { ...defaults.templates.university.value, course: 'privateMedical' },
        },
      },
    }
    expect(() =>
      universityGoalTemplate(broken, tables.universityCost, 'child-3', 'goal-u'),
    ).toThrow(RangeError)
  })

  it('大学資金の雛形の丸めの単位が 1 以上の整数でなければ投げる', () => {
    const broken = {
      ...defaults,
      templates: {
        ...defaults.templates,
        university: {
          ...defaults.templates.university,
          value: { ...defaults.templates.university.value, targetRoundTo: 0 },
        },
      },
    }
    expect(() =>
      universityGoalTemplate(broken, tables.universityCost, 'child-3', 'goal-u'),
    ).toThrow(RangeError)
  })

  it('老後資金のカードの雛形：期限は年上の大人の退職の年。目標額と置き場は既定値。貯まっている額 0・オン', () => {
    const template = defaults.templates.retirement.value
    const adults = [
      { birthYear: 1986, retirementAge: 60 },
      { birthYear: 1983, retirementAge: 67 },
    ]
    expect(retirementGoalTemplate(defaults, adults, 'goal-r')).toEqual({
      id: 'goal-r',
      enabled: true,
      kind: 'retirement',
      targetAmount: template.targetAmount,
      // 年上は 1983 年生まれ（67 歳で退職）→ 2050 年（年下の方が早く退職する年 2046 ではない）
      byYear: 2050,
      vehicle: 'nisa',
      saved: 0,
    })
    expect(() => retirementGoalTemplate(defaults, [], 'goal-r')).toThrow(RangeError)
  })
})

describe('子の費用のカード（T9）', () => {
  const child = (id: string): ChildProfile => ({ id, birthYear: 2034, birthMonth: 7 })
  const custom = customGoalTemplate(defaults, base, 'goal-1', 'monthlyExpense')

  it('雛形はすべて公立・塾なし・習い事は平均（null）・保育なし（SPEC §2.1）。id は子の id から決まる', () => {
    expect(childCostGoalTemplate(defaults, 'child-3')).toEqual({
      id: 'childcost-child-3',
      enabled: true,
      kind: 'childCost',
      childId: 'child-3',
      schools: { elementary: 'public', juniorHigh: 'public', highSchool: 'public' },
      cramSchools: [],
      lessonsMonthly: null,
      childcareMonthly: null,
    })
    expect(childCostGoalId('child-3')).toBe('childcost-child-3')
    expect(cramSchoolTemplate(defaults)).toEqual(defaults.templates.childCost.value.cramSchool)
  })

  it('子を足すとカードが末尾に付き、子を外すとそのカードが消える。ほかのカードと順は残す', () => {
    const one = syncChildCostGoals({ children: [child('child-1')], goals: [custom] }, defaults)
    expect(one.map((g) => g.id)).toEqual(['goal-1', 'childcost-child-1'])

    const two = syncChildCostGoals(
      { children: [child('child-1'), child('child-2')], goals: one },
      defaults,
    )
    expect(two.map((g) => g.id)).toEqual(['goal-1', 'childcost-child-1', 'childcost-child-2'])

    const removed = syncChildCostGoals({ children: [child('child-2')], goals: two }, defaults)
    expect(removed.map((g) => g.id)).toEqual(['goal-1', 'childcost-child-2'])
  })

  it('直したカードはそのまま残し、揃っていれば同じ配列を返す。同じ子に 2 枚あれば先の 1 枚だけ残す', () => {
    const mine = {
      ...childCostGoalTemplate(defaults, 'child-1'),
      id: 'goal-7',
      lessonsMonthly: 6400,
    }
    const goals = [mine]
    expect(syncChildCostGoals({ children: [child('child-1')], goals }, defaults)).toBe(goals)
    const doubled = [mine, childCostGoalTemplate(defaults, 'child-1')]
    expect(syncChildCostGoals({ children: [child('child-1')], goals: doubled }, defaults)).toEqual([
      mine,
    ])
  })

  it('子を外すと、その子の大学資金のカードも消える。子がいれば残し、同じ子に 2 枚あれば先の 1 枚だけ残す（T10）', () => {
    const university = universityGoalTemplate(
      defaults,
      tables.universityCost,
      'child-2',
      'goal-university-2',
    )
    const goals = syncChildCostGoals(
      { children: [child('child-1'), child('child-2')], goals: [custom, university] },
      defaults,
    )
    expect(goals.map((g) => g.id)).toEqual([
      'goal-1',
      'goal-university-2',
      'childcost-child-1',
      'childcost-child-2',
    ])
    const removed = syncChildCostGoals({ children: [child('child-1')], goals }, defaults)
    expect(removed.map((g) => g.id)).toEqual(['goal-1', 'childcost-child-1'])
    // 大学資金のカードは自動では付かない（子を足しても子の費用のカードだけ）
    expect(
      syncChildCostGoals({ children: [child('child-1')], goals: [custom] }, defaults).some(
        (g) => g.kind === 'university',
      ),
    ).toBe(false)
    const doubled = [university, { ...university, id: 'goal-university-x' }]
    expect(
      syncChildCostGoals({ children: [child('child-2')], goals: doubled }, defaults)
        .filter((g) => g.kind === 'university')
        .map((g) => g.id),
    ).toEqual(['goal-university-2'])
  })

  it('見本の子の費用のカード：進路が選択肢に無ければ投げる', () => {
    const withSchools = (highSchool: string): SampleHouseholdSource => ({
      ...sample,
      childCostGoals: sample.childCostGoals.map((goal) => ({
        ...goal,
        schools: { ...goal.schools, highSchool },
      })),
    })
    expect(() => sampleLifePlan(defaults, withSchools('national'), base)).toThrow(/進路/)
  })
})

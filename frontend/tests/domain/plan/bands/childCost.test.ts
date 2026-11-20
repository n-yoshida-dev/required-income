import { describe, expect, it } from 'vitest'
import { childCostBands } from '../../../../src/domain/plan/bands/childCost'
import { bandContext, expandGoal, expandPlan } from '../../../../src/domain/plan/bands/index'
import { yearlyNeeds } from '../../../../src/domain/plan/need'
import type { Band, ChildCostGoal, ChildProfile, LifePlan } from '../../../../src/domain/plan/types'
import { yearMonth } from '../../../../src/domain/plan/yearMonth'
import { adult, defaults, makePlan, tables } from '../planFixtures'

/*
 * 金額は制度データ（data/education/school-cost.json・data/benefit/high-school-support.json・data/childcare/free-education.json）の値から
 * 手で計算した額と突き合わせる。月額は年額 ÷ 12 を円に四捨五入（コメントは 2026-11-17 時点の値）。
 */
const school = tables.schoolCost
const support = tables.highSchoolSupport
const perMonth = (annual: number) => Math.round(annual / 12)
const schoolFee = (entry: { schoolEducation: number; schoolLunch: number }) =>
  perMonth(entry.schoolEducation + entry.schoolLunch)

/** 小学校（公立）：(74,336 + 35,774) ÷ 12 = 9,175.8… → 9,176 */
const ELEMENTARY_PUBLIC = schoolFee(school.elementary.public)
/** 中学校（公立）：(150,761 + 35,671) ÷ 12 = 15,536 */
const JUNIOR_PUBLIC = schoolFee(school.juniorHigh.public)
/**
 * 高校の学校の年額：統計の学校教育費 − 統計の授業料（就学支援金を引いた後に払った額）＋ 授業料の標準額。
 * 公立：351,523 − 45,272 ＋ 118,800 = 425,051 → ÷ 12 = 35,420.9 → 35,421
 * 私立：832,650 − 279,170 ＋ 457,331 = 1,010,811 → ÷ 12 = 84,234.25 → 84,234
 */
const highAnnual = (type: 'public' | 'private') => {
  const entry = school.highSchool[type]
  const paid = entry.tuitionPaid
  if (paid === undefined) throw new Error('学習費の表に高校の授業料が無い')
  return (
    entry.schoolEducation + entry.schoolLunch - paid.amount + support.standardAnnualTuition[type]
  )
}
const HIGH_PUBLIC = perMonth(highAnnual('public'))
const HIGH_PRIVATE = perMonth(highAnnual('private'))
/** 習い事（統計の平均。公立）：小 144,004 ÷ 12 → 12,000、中 84,444 ÷ 12 → 7,037、高 44,437 ÷ 12 → 3,703 */
const LESSON = {
  elementary: perMonth(school.elementary.public.otherOutsideActivity),
  juniorHigh: perMonth(school.juniorHigh.public.otherOutsideActivity),
  highSchool: perMonth(school.highSchool.public.otherOutsideActivity),
}
/** 就学支援金：公立は min(118,800 ÷ 12, 9,900) = 9,900、私立は min(457,331 ÷ 12, 38,100) = 38,100 */
const SUPPORT_PUBLIC = Math.min(
  support.standardAnnualTuition.public / 12,
  support.monthlyLimit.public,
)
const SUPPORT_PRIVATE = Math.min(
  support.standardAnnualTuition.private / 12,
  support.monthlyLimit.private,
)

/**
 * 無償化の後の保育園の給食費（月）：副食費の目安（free-education.json）4,500 ＋ 主食費の既定値（mealFee.json）2,000 = 6,500。
 * 無償化の前の園の実費は聞かないので 0 で、その上に足す（D24）
 */
const MEAL =
  tables.childcare.standardMonthlySideDishCost + tables.childcare.standardMonthlyStapleFoodCost

/** 児童手当の月額（child-allowance.json）：3 歳未満 15,000、3 歳以上 10,000、第 3 子以降 30,000 */
const tierOf = (fromAge: number) => {
  const tier = tables.childAllowance.tiers.find((t) => t.fromAge === fromAge)
  if (tier === undefined) throw new Error(`児童手当の表に ${fromAge} 歳からの区分が無い`)
  return tier
}
const ALLOWANCE_UNDER_3 = tierOf(0).monthlyAmount
const ALLOWANCE_3_PLUS = tierOf(3).monthlyAmount
const ALLOWANCE_THIRD = tierOf(3).monthlyAmountThirdOrLater

// 架空の計画：起点 2036-01。大人は 1995 年生まれ・65 歳で退職 → 「ずっと」の終わりは 2060-01（子の帯が切れない）
const BASE = yearMonth(2036, 1)
const LATE_ADULT = adult({ birthYear: 1995 })

const child = (overrides: Partial<ChildProfile> = {}): ChildProfile => ({
  id: 'child-a',
  birthYear: 2030,
  birthMonth: 6,
  ...overrides,
})

/** 子の費用のカード（既定：すべて公立・塾なし・習い事は平均・保育なし） */
const card = (overrides: Partial<ChildCostGoal> = {}): ChildCostGoal => ({
  id: 'goal-kid',
  enabled: true,
  kind: 'childCost',
  childId: 'child-a',
  schools: { elementary: 'public', juniorHigh: 'public', highSchool: 'public' },
  cramSchools: [],
  lessonsMonthly: null,
  childcareMonthly: null,
  ...overrides,
})

const planWith = (goal: ChildCostGoal, overrides: Partial<LifePlan> = {}): LifePlan =>
  makePlan({
    baseYearMonth: BASE,
    adults: [LATE_ADULT],
    children: [child()],
    goals: [goal],
    ...overrides,
  })

const bandsOf = (goal: ChildCostGoal, overrides: Partial<LifePlan> = {}): Band[] =>
  childCostBands(goal, bandContext(planWith(goal, overrides), defaults, tables))

/** 帯の「名前 → [月額, から, まで]」の一覧（名前で絞る） */
const byLabel = (bands: readonly Band[], label: string) =>
  bands.filter((b) => b.label === label).map((b) => [b.monthly, b.from, b.to])

describe('高校の学校の費用と就学支援金を二重に引かない', () => {
  it('高校の 1 年の実質の負担 ＝ 学校教育費 − 調査の授業料 ＋ max(0, 授業料 − 支援金の限度額)', () => {
    // 公立：351,523 − 45,272 ＋ max(0, 118,800 − 118,800) = 306,251
    expect(school.highSchool.public.tuitionPaid?.amount).toBe(45272)
    expect(school.highSchool.private.tuitionPaid?.amount).toBe(279170)
    const yearly = (type: 'public' | 'private') => {
      const bands = bandsOf(
        card({ schools: { elementary: 'public', juniorHigh: 'public', highSchool: type } }),
      )
      // 高 2 の年度（2047 年 4 月〜2048 年 3 月）の、学校 − 就学支援金
      const inYear = (label: string) =>
        bands.find(
          (b) =>
            b.label === label &&
            b.from.year * 12 + b.from.month <= 2047 * 12 + 4 &&
            b.to.year * 12 + b.to.month > 2047 * 12 + 4,
        )?.monthly ?? 0
      return (inYear('学校（1人目）') - inYear('就学支援金（1人目）')) * 12
    }
    const expected = (type: 'public' | 'private') => {
      const entry = school.highSchool[type]
      const tuition = support.standardAnnualTuition[type]
      return (
        entry.schoolEducation -
        (entry.tuitionPaid?.amount ?? 0) +
        Math.max(0, tuition - support.monthlyLimit[type] * 12)
      )
    }
    expect(expected('public')).toBe(306251)
    // 私立：832,650 − 279,170 ＋ max(0, 457,331 − 457,200) = 553,611
    expect(expected('private')).toBe(553611)
    // 帯は月額を円に丸めるので、年で数円まで（公立 306,252、私立 553,608）
    expect(Math.abs(yearly('public') - expected('public'))).toBeLessThanOrEqual(6)
    expect(Math.abs(yearly('private') - expected('private'))).toBeLessThanOrEqual(6)
  })
})

describe('完了条件（T9）：生まれ年月と進路だけで帯が出る', () => {
  it('2030 年 6 月生まれ・すべて公立：学校・習い事は年度（4 月）の切れ目で変わり、就学支援金は高校の 3 年間だけ入る', () => {
    const bands = bandsOf(card())
    // 6 月生まれ → 小学校に入るのは 2037 年 4 月（満 6 歳の翌年度）。高校を出るのは 2049 年 3 月
    expect(byLabel(bands, '学校（1人目）')).toEqual([
      [ELEMENTARY_PUBLIC, yearMonth(2037, 4), yearMonth(2043, 4)],
      [JUNIOR_PUBLIC, yearMonth(2043, 4), yearMonth(2046, 4)],
      [HIGH_PUBLIC, yearMonth(2046, 4), yearMonth(2049, 4)],
    ])
    expect(byLabel(bands, '習い事（1人目）')).toEqual([
      [LESSON.elementary, yearMonth(2037, 4), yearMonth(2043, 4)],
      [LESSON.juniorHigh, yearMonth(2043, 4), yearMonth(2046, 4)],
      [LESSON.highSchool, yearMonth(2046, 4), yearMonth(2049, 4)],
    ])
    expect(bands.filter((b) => b.kind === 'income')).toEqual([
      {
        goalId: 'goal-kid',
        label: '就学支援金（1人目）',
        kind: 'income',
        monthly: SUPPORT_PUBLIC,
        from: yearMonth(2046, 4),
        to: yearMonth(2049, 4),
      },
      // 児童手当（T10）：起点の 2036 年 1 月はもう 3 歳以上 → 1 万円。18 歳の後の最初の 3 月（2049 年 3 月）まで
      {
        goalId: 'goal-kid',
        label: '児童手当（1人目）',
        kind: 'income',
        monthly: ALLOWANCE_3_PLUS,
        from: BASE,
        to: yearMonth(2049, 4),
      },
    ])
    // 塾なし・保育なし・大学の費用は入れない（大学資金のカードが受し持つ）
    expect(new Set(bands.map((b) => b.label))).toEqual(
      new Set(['学校（1人目）', '習い事（1人目）', '就学支援金（1人目）', '児童手当（1人目）']),
    )
    expect(bands.every((b) => b.goalId === 'goal-kid')).toBe(true)
  })

  it('入学の年は 4 月から、卒業の年は 3 月まで：その暦年の年額は月数の按分になる', () => {
    const years = new Map(
      yearlyNeeds(bandsOf(card()), BASE, 2050).map((y) => [y.year, y.requiredNet]),
    )
    // 児童手当（T10）は 2036 年 1 月から 2049 年 3 月まで毎月 1 万円を引く
    const allowanceYear = ALLOWANCE_3_PLUS * 12
    // 2036 年はまだ未就学（費用の帯が無く、児童手当だけ）
    expect(years.get(2036)).toBe(-allowanceYear)
    // 2037 年：小 1 の 4〜12 月の 9 か月
    expect(years.get(2037)).toBe((ELEMENTARY_PUBLIC + LESSON.elementary) * 9 - allowanceYear)
    // 2043 年：小 6 の 1〜3 月 ＋ 中 1 の 4〜12 月
    expect(years.get(2043)).toBe(
      (ELEMENTARY_PUBLIC + LESSON.elementary) * 3 +
        (JUNIOR_PUBLIC + LESSON.juniorHigh) * 9 -
        allowanceYear,
    )
    // 2049 年：高 3 の 1〜3 月だけ（就学支援金・児童手当も 3 か月）
    expect(years.get(2049)).toBe(
      (HIGH_PUBLIC + LESSON.highSchool - SUPPORT_PUBLIC - ALLOWANCE_3_PLUS) * 3,
    )
    expect(years.get(2050)).toBe(0)
  })
})

describe('早生まれ（1〜3 月生まれ）は 1 年早い学年', () => {
  it('2030 年 3 月生まれは 2036 年 4 月に小学校、4 月生まれは 2037 年 4 月', () => {
    const march = bandsOf(card(), { children: [child({ birthMonth: 3 })] })
    const april = bandsOf(card(), { children: [child({ birthMonth: 4 })] })
    const firstSchool = (bands: Band[]) => bands.find((b) => b.label === '学校（1人目）')?.from
    expect(firstSchool(march)).toEqual(yearMonth(2036, 4))
    expect(firstSchool(april)).toEqual(yearMonth(2037, 4))
    // 1 月生まれも 3 月生まれと同じ学年
    expect(firstSchool(bandsOf(card(), { children: [child({ birthMonth: 1 })] }))).toEqual(
      yearMonth(2036, 4),
    )
  })
})

describe('公立と私立', () => {
  it('高校を私立にすると、学校の帯と就学支援金が私立の額になる（ほかの段階は公立のまま）', () => {
    const priv = bandsOf(
      card({ schools: { elementary: 'public', juniorHigh: 'public', highSchool: 'private' } }),
    )
    expect(byLabel(priv, '学校（1人目）').at(-1)).toEqual([
      HIGH_PRIVATE,
      yearMonth(2046, 4),
      yearMonth(2049, 4),
    ])
    expect(byLabel(priv, '学校（1人目）')[0]).toEqual([
      ELEMENTARY_PUBLIC,
      yearMonth(2037, 4),
      yearMonth(2043, 4),
    ])
    expect(byLabel(priv, '就学支援金（1人目）')).toEqual([
      [SUPPORT_PRIVATE, yearMonth(2046, 4), yearMonth(2049, 4)],
    ])
    // 習い事の平均も私立の統計（108,189 ÷ 12 → 9,016）
    expect(byLabel(priv, '習い事（1人目）').at(-1)?.[0]).toBe(
      perMonth(school.highSchool.private.otherOutsideActivity),
    )
  })

  it('習い事を入れれば、小学校から高校まで同じ月額の 1 本', () => {
    expect(byLabel(bandsOf(card({ lessonsMonthly: 8300 })), '習い事（1人目）')).toEqual([
      [8300, yearMonth(2037, 4), yearMonth(2049, 4)],
    ])
  })
})

describe('塾（本人の入力。入れた金額どおり）', () => {
  it('学年の範囲の 4 月から次の学年の 4 月の前まで。行が重なる学年は足す', () => {
    const bands = bandsOf(
      card({
        cramSchools: [
          { fromGrade: 7, toGrade: 9, monthly: 21700 },
          { fromGrade: 9, toGrade: 12, monthly: 34600 },
        ],
      }),
    )
    // 中 1 = 2043 年度、中 3 = 2045 年度、高 3 = 2048 年度
    expect(byLabel(bands, '塾（1人目）')).toEqual([
      [21700, yearMonth(2043, 4), yearMonth(2045, 4)],
      [21700 + 34600, yearMonth(2045, 4), yearMonth(2046, 4)],
      [34600, yearMonth(2046, 4), yearMonth(2049, 4)],
    ])
  })

  it('学年が逆・1〜12 の外・月額が負や整数でないのは契約違反', () => {
    const bad = (cram: ChildCostGoal['cramSchools'][number]) => () =>
      bandsOf(card({ cramSchools: [cram] }))
    expect(bad({ fromGrade: 10, toGrade: 9, monthly: 10000 })).toThrow(RangeError)
    expect(bad({ fromGrade: 0, toGrade: 3, monthly: 10000 })).toThrow(RangeError)
    expect(bad({ fromGrade: 10, toGrade: 13, monthly: 10000 })).toThrow(RangeError)
    expect(bad({ fromGrade: 10, toGrade: 12, monthly: -1 })).toThrow(RangeError)
    expect(bad({ fromGrade: 10, toGrade: 12, monthly: 0.5 })).toThrow(RangeError)
  })
})

describe('完了条件（T9）：無償化の年に保育料の帯が終わる', () => {
  it('2035 年 6 月生まれ：0 歳児クラス（2036 年 4 月）から、3 歳児クラスになる 2039 年 4 月の前まで', () => {
    const bands = bandsOf(card({ childcareMonthly: 41300 }), {
      children: [child({ birthYear: 2035, birthMonth: 6 })],
    })
    // 3 歳児クラスから無償（free-education.json の freeFromClassAge）
    expect(tables.childcare.freeFromClassAge).toBe(3)
    expect(byLabel(bands, '保育料（1人目）')).toEqual([
      [41300, yearMonth(2036, 4), yearMonth(2039, 4)],
    ])
    // 無償化の後は、小学校に上がるまで給食費の目安（D24）が別の帯で入る
    expect(byLabel(bands, '保育園の給食費（1人目）')).toEqual([
      [MEAL, yearMonth(2039, 4), yearMonth(2042, 4)],
    ])
    // 小学校は 2042 年 4 月から
    expect(bands.find((b) => b.label === '学校（1人目）')?.from).toEqual(yearMonth(2042, 4))
  })

  it('早生まれ（2035 年 2 月生まれ）は 1 年早く、起点から始まり 2038 年 4 月で終わる', () => {
    const bands = bandsOf(card({ childcareMonthly: 41300 }), {
      children: [child({ birthYear: 2035, birthMonth: 2 })],
    })
    expect(byLabel(bands, '保育料（1人目）')).toEqual([[41300, BASE, yearMonth(2038, 4)]])
    expect(byLabel(bands, '保育園の給食費（1人目）')).toEqual([
      [MEAL, yearMonth(2038, 4), yearMonth(2041, 4)],
    ])
  })

  it('起点の年度にもう 3 歳児クラスなら保育料の帯は出ない（給食費だけ）。2 歳児クラスなら 3 月まで出る。保育が null なら出さない', () => {
    // 2031 年 6 月生まれ：2035 年度（起点の 1〜3 月）は 3 歳児クラス、2038 年 4 月に小学校
    const older = bandsOf(card({ childcareMonthly: 41300 }), {
      children: [child({ birthYear: 2031, birthMonth: 6 })],
    })
    expect(byLabel(older, '保育料（1人目）')).toEqual([])
    expect(byLabel(older, '保育園の給食費（1人目）')).toEqual([[MEAL, BASE, yearMonth(2038, 4)]])
    // 2032 年 6 月生まれ：2035 年度は 2 歳児クラス → 起点から 2036 年 3 月まで
    const twoYearClass = bandsOf(card({ childcareMonthly: 41300 }), {
      children: [child({ birthYear: 2032, birthMonth: 6 })],
    })
    expect(byLabel(twoYearClass, '保育料（1人目）')).toEqual([[41300, BASE, yearMonth(2036, 4)]])
    const none = bandsOf(card(), { children: [child({ birthYear: 2035, birthMonth: 6 })] })
    expect(none.filter((b) => b.label.startsWith('保育'))).toEqual([])
  })
})

describe('起点の年より前に生まれた子・これから生まれる子', () => {
  it('起点より前の年度は帯にせず、起点から始める（起点が 1〜3 月なら前の年度の残りから）', () => {
    // 2021 年 5 月生まれ → 2035 年度は中 2、2037 年度から高校
    const bands = bandsOf(card(), { children: [child({ birthYear: 2021, birthMonth: 5 })] })
    expect(byLabel(bands, '学校（1人目）')).toEqual([
      [JUNIOR_PUBLIC, BASE, yearMonth(2037, 4)],
      [HIGH_PUBLIC, yearMonth(2037, 4), yearMonth(2040, 4)],
    ])
  })

  it('もう高校を出た子のカードは帯を出さない', () => {
    expect(bandsOf(card(), { children: [child({ birthYear: 2013, birthMonth: 5 })] })).toEqual([])
  })

  it('これから生まれる子（2038 年 9 月生まれ）は 2045 年 4 月の小学校から。児童手当は生まれた翌月から', () => {
    const bands = bandsOf(card(), { children: [child({ birthYear: 2038, birthMonth: 9 })] })
    const payments = bands.filter((b) => b.kind === 'payment')
    expect(Math.min(...payments.map((b) => b.from.year * 12 + b.from.month))).toBe(2045 * 12 + 4)
    // 費用より先に出るのは児童手当だけ（2038 年 10 月から）
    expect(Math.min(...bands.map((b) => b.from.year * 12 + b.from.month))).toBe(2038 * 12 + 10)
    expect(new Set(bands.filter((b) => b.from.year < 2045).map((b) => b.label))).toEqual(
      new Set(['児童手当（1人目）']),
    )
  })

  it('「ずっと」の終わり（最初に退職する大人の退職の年の 1 月）で帯を切る', () => {
    // 1984 年生まれ・65 歳 → 2049-01 で切る。高 3 の 1〜3 月は入らない
    const bands = bandsOf(card(), { adults: [adult({ birthYear: 1984 })] })
    expect(byLabel(bands, '学校（1人目）').at(-1)).toEqual([
      HIGH_PUBLIC,
      yearMonth(2046, 4),
      yearMonth(2049, 1),
    ])
  })
})

describe('物価（SPEC §3.4：教育費・習い事に掛け、塾と保育は入れた金額どおり）', () => {
  it('物価 2%：学校と習い事は年度ごとに起点の年からの物価を掛け、塾は掛けない。就学支援金は限度額で頭打ち', () => {
    // 2021 年 5 月生まれ（小学校は 2028 年 4 月から）：2035 年度（起点の 2036 年 1〜3 月）は中 2、2036 年度は中 3、2037〜2039 年度は高校
    const plan = planWith(card({ cramSchools: [{ fromGrade: 8, toGrade: 12, monthly: 18900 }] }), {
      children: [child({ birthYear: 2021, birthMonth: 5 })],
      assumptions: { investmentReturnRate: 0.03, inflationRate: 0.02, mortgageRate: 0.01 },
    })
    const bands = childCostBands(
      plan.goals[0] as ChildCostGoal,
      bandContext(plan, defaults, tables),
    )
    const junior = school.juniorHigh.public.schoolEducation + school.juniorHigh.public.schoolLunch
    const inflated = (annual: number, years: number) => perMonth(Math.round(annual * 1.02 ** years))
    // 高校：学校教育費と「授業料の標準額 − 調査の授業料」に、それぞれ物価を掛けて円に丸めてから足す
    const highPublic = school.highSchool.public
    const tuitionGap = support.standardAnnualTuition.public - (highPublic.tuitionPaid?.amount ?? 0)
    const inflatedHigh = (years: number) =>
      perMonth(
        Math.round((highPublic.schoolEducation + highPublic.schoolLunch) * 1.02 ** years) +
          Math.round(tuitionGap * 1.02 ** years),
      )
    // 年度 Y の物価は「Y − 起点の年」年ぶん。起点より前の年度（2035 年度。起点の 2036 年 1〜3 月）と
    // 起点の年の年度（2036 年度）は 0 年ぶん（掛けない）なので、同じ額の 1 本にまとまる
    expect(byLabel(bands, '学校（1人目）')).toEqual([
      [perMonth(junior), BASE, yearMonth(2037, 4)],
      [inflatedHigh(1), yearMonth(2037, 4), yearMonth(2038, 4)],
      [inflatedHigh(2), yearMonth(2038, 4), yearMonth(2039, 4)],
      [inflatedHigh(3), yearMonth(2039, 4), yearMonth(2040, 4)],
    ])
    // 習い事（統計の平均）も同じ物価を掛ける
    expect(byLabel(bands, '習い事（1人目）').at(-1)?.[0]).toBe(
      inflated(school.highSchool.public.otherOutsideActivity, 3),
    )
    expect(byLabel(bands, '塾（1人目）')).toEqual([[18900, BASE, yearMonth(2040, 4)]])
    // 公立の授業料は物価で上がるが、支援金は限度額（9,900）で頭打ち（名目のまま）
    expect(byLabel(bands, '就学支援金（1人目）')).toEqual([
      [support.monthlyLimit.public, yearMonth(2037, 4), yearMonth(2040, 4)],
    ])
  })

  it('保育料は物価を掛けない（入れた金額どおり）。無償化の後の給食費の目安には掛ける', () => {
    const plan = planWith(card({ childcareMonthly: 41300 }), {
      children: [child({ birthYear: 2035, birthMonth: 6 })],
      assumptions: { investmentReturnRate: 0.03, inflationRate: 0.02, mortgageRate: 0.01 },
    })
    const bands = childCostBands(
      plan.goals[0] as ChildCostGoal,
      bandContext(plan, defaults, tables),
    )
    expect(byLabel(bands, '保育料（1人目）')).toEqual([
      [41300, yearMonth(2036, 4), yearMonth(2039, 4)],
    ])
    expect(byLabel(bands, '保育園の給食費（1人目）')).toEqual(
      [2039, 2040, 2041].map((year) => [
        perMonth(Math.round(MEAL * 12 * 1.02 ** (year - 2036))),
        yearMonth(year, 4),
        yearMonth(year + 1, 4),
      ]),
    )
  })
})

describe('児童手当の収入の帯（T10）', () => {
  it('2035 年 6 月生まれ：3 歳の誕生月（2038 年 6 月）までは 15,000、翌月から 10,000。高校 3 年の 3 月まで', () => {
    const bands = bandsOf(card(), { children: [child({ birthYear: 2035, birthMonth: 6 })] })
    expect(byLabel(bands, '児童手当（1人目）')).toEqual([
      [ALLOWANCE_UNDER_3, BASE, yearMonth(2038, 7)],
      [ALLOWANCE_3_PLUS, yearMonth(2038, 7), yearMonth(2054, 4)],
    ])
  })

  it('3 人目の子は 30,000。いちばん上の子が数える年齢（22 歳の年度末）を過ぎると 2 人目に繰り上がり、10,000 に下がる', () => {
    // 上から 2014 年 5 月・2017 年 8 月・2032 年 10 月生まれ。いちばん上は 2037 年 3 月で数えなくなる
    const children = [
      child({ id: 'child-a', birthYear: 2014, birthMonth: 5 }),
      child({ id: 'child-b', birthYear: 2017, birthMonth: 8 }),
      child({ id: 'child-c', birthYear: 2032, birthMonth: 10 }),
    ]
    const plan = makePlan({
      baseYearMonth: BASE,
      adults: [LATE_ADULT],
      children,
      goals: [card({ id: 'goal-kid-c', childId: 'child-c' })],
    })
    const bands = expandPlan(plan, defaults, tables)
    expect(byLabel(bands, '児童手当（3人目）')).toEqual([
      [ALLOWANCE_THIRD, BASE, yearMonth(2037, 4)],
      [ALLOWANCE_3_PLUS, yearMonth(2037, 4), yearMonth(2051, 4)],
    ])
  })

  it('もう高校を出た子は児童手当の帯も出ない', () => {
    const bands = bandsOf(card(), { children: [child({ birthYear: 2017, birthMonth: 2 })] })
    // 2017 年 2 月生まれ：支給は 2035 年 3 月まで（起点の 2036 年 1 月より前）
    expect(byLabel(bands, '児童手当（1人目）')).toEqual([])
  })
})

describe('子ごとのカードと入口', () => {
  it('帯の名前に子の順を添える（兄弟の帯を見分ける）', () => {
    const second: ChildCostGoal = card({ id: 'goal-kid-2', childId: 'child-b' })
    const plan = makePlan({
      baseYearMonth: BASE,
      adults: [LATE_ADULT],
      children: [child(), child({ id: 'child-b', birthYear: 2032 })],
      goals: [card(), second],
    })
    const labels = new Set(expandPlan(plan, defaults, tables).map((b) => `${b.goalId}:${b.label}`))
    expect(labels).toContain('goal-kid:学校（1人目）')
    expect(labels).toContain('goal-kid-2:学校（2人目）')
  })

  it('オフのカードは帯を出さない。子が見つからない・同じ子に 2 枚は契約違反', () => {
    const plan = planWith(card())
    const ctx = bandContext(plan, defaults, tables)
    expect(expandGoal({ ...card(), enabled: false }, ctx)).toEqual([])
    expect(() => expandGoal(card({ childId: 'child-x' }), ctx)).toThrow(RangeError)
    expect(() =>
      expandPlan({ ...plan, goals: [card(), card({ id: 'goal-kid-2' })] }, defaults, tables),
    ).toThrow(/2 枚/)
  })

  it('進路が選択肢に無いのは契約違反', () => {
    const bad = card({
      schools: { elementary: 'public', juniorHigh: 'national' as 'public', highSchool: 'public' },
    })
    expect(() => bandsOf(bad)).toThrow(RangeError)
  })
})

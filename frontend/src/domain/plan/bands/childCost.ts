/**
 * 子の費用のカード → 帯（SPEC §3.2 の `childCost`）。
 *
 * 前の版の計算を中身を変えずに呼び、年度（4 月始まり）ごとの年額を `bandsFromYearly` で帯にまとめる：
 *
 * - 「学校」`payment`：学校教育費 ＋ 給食費（`educationCostInYear` の `schoolFee`。小・中・高の公立 / 私立。物価を掛ける）。
 *   高校だけは、統計の授業料（就学支援金を引いた後に払った額）を授業料の標準額に置き換える（支援金を二重に引かないため）
 * - 「習い事」`payment`：小学校から高校まで。入力が無ければ統計の平均（同じく `lesson`。物価を掛ける）
 * - 「塾」`payment`：本人が入れた学年と月額（同じく `cramSchool`。入れた金額どおり。行が重なる学年は足す）
 * - 「保育料」`payment`：本人が入れた月額（`childcareCostInYear` の `fee`。入れた金額どおり）。無償化が始まる年度（3 歳児クラス）の 4 月で終わる
 * - 「保育園の給食費」`payment`：無償化の後、小学校に上がるまで（同じく `extraCost`。副食費の目安 ＋ 主食費の既定値。物価を掛ける。D24）
 * - 「就学支援金」`income`：高校の 3 年間（`highSchoolSupportInYear`。min（授業料の月額, 支給限度額）。所得の制限は 2026 年 4 月に無くなった）
 * - 「児童手当」`income`：支給が終わる高校 3 年の 3 月まで、月ごとの額（`bands/childAllowance.ts`。T10）。
 *   その子の児童手当を大学資金に回しているあいだは出さない（大学資金のカードが `earmarked` で出す）
 *
 * 大学の費用は入れない（大学資金のカードが受け持つ）。
 * 学年は生まれ年月から出す（1〜3 月生まれは 1 年早い。`expense/education.ts` の `schoolEntryYear`）。
 *
 * 帯の名前に子の順を添える（「学校（1人目）」）。「ながめる」の段の理由は帯の名前だけを出すので、兄弟の帯を見分けるため。
 */

import { highSchoolSupportInYear } from '../../benefit/highSchoolSupport'
import { childcareCostInYear, type ChildcareCost } from '../../childcare/childcareFee'
import { educationCostInYear, type EducationCost } from '../../expense/education'
import { roundYen } from '../../money'
import type { Child, ChildcareEnrollment, EducationPlan } from '../../types'
import type {
  Band,
  BandContext,
  BandKind,
  ChildCostGoal,
  ChildProfile,
  Month,
  SchoolType,
  Year,
  Yen,
} from '../types'
import { compareYearMonth } from '../yearMonth'
import { assertNonNegativeYen } from './band'
import {
  CHILD_ALLOWANCE_LABEL,
  bandsFromMonthly,
  childAllowanceMonthly,
  universityUseMonth,
} from './childAllowance'
import { bandsFromYearly } from './fromYearly'

/** 帯の名前（子の順を添える前） */
export const CHILD_COST_BAND_LABELS: Record<
  'school' | 'lessons' | 'cram' | 'childcare' | 'childcareMeal' | 'support' | 'allowance',
  string
> = {
  school: '学校',
  lessons: '習い事',
  cram: '塾',
  childcare: '保育料',
  childcareMeal: '保育園の給食費',
  support: '就学支援金',
  allowance: CHILD_ALLOWANCE_LABEL,
} as const

/** 塾に入れられる学年（小 1 = 1 〜 高 3 = 12） */
export const CRAM_GRADE_RANGE = { min: 1, max: 12 } as const

/** 学校と保育の 1 年が始まる月（年度） */
export const SCHOOL_YEAR_START_MONTH: Month = 4

const SCHOOL_TYPES: readonly SchoolType[] = ['public', 'private']

/** 帯の名前に子の順を添える（「学校（1人目）」） */
export function childCostBandLabel(
  kind: keyof typeof CHILD_COST_BAND_LABELS,
  childOrder: number,
): string {
  return `${CHILD_COST_BAND_LABELS[kind]}（${childOrder}人目）`
}

/**
 * 帯の名前から子の順（「（1人目）」）を外す（`childCostBandLabel` の逆）。
 * 子の費用のカードの中では、カードの名前に子の順が出ているので、帯ごとにくり返さない
 */
export function withoutChildOrder(label: string): string {
  return label.replace(/（\d+人目）$/, '')
}

/**
 * 子の費用のカードの入力が契約どおりかを確かめる。違えば投げる。
 * 進路は公立か私立、塾の学年は 1〜12 の整数で始まりが終わり以下、金額は 0 以上の円の整数（習い事・保育は null も可）
 */
export function assertChildCostGoal(goal: ChildCostGoal): void {
  for (const [stage, type] of Object.entries(goal.schools)) {
    if (!SCHOOL_TYPES.includes(type)) {
      throw new RangeError(`進路（${stage}）は public か private で指定してください: ${type}`)
    }
  }
  for (const cram of goal.cramSchools) {
    for (const grade of [cram.fromGrade, cram.toGrade]) {
      if (
        !Number.isInteger(grade) ||
        grade < CRAM_GRADE_RANGE.min ||
        grade > CRAM_GRADE_RANGE.max
      ) {
        throw new RangeError(
          `塾の学年は ${CRAM_GRADE_RANGE.min}〜${CRAM_GRADE_RANGE.max} の整数で指定してください: ${grade}`,
        )
      }
    }
    if (cram.fromGrade > cram.toGrade) {
      throw new RangeError(
        `塾の始まりの学年が終わりの学年より後です: ${cram.fromGrade} → ${cram.toGrade}`,
      )
    }
    assertNonNegativeYen(cram.monthly, '塾の月額')
  }
  if (goal.lessonsMonthly !== null) assertNonNegativeYen(goal.lessonsMonthly, '習い事の月額')
  if (goal.childcareMonthly !== null) assertNonNegativeYen(goal.childcareMonthly, '保育料の月額')
}

/**
 * 子と子の費用のカードを、前の版の計算が読む子の形に直す。
 * 大学は行かない（大学の費用はこのカードに入れない）、高校の授業料は統計の標準額（null）
 */
export function toLegacyChild(child: ChildProfile, goal: ChildCostGoal): Child {
  return {
    id: child.id,
    birthYear: child.birthYear,
    birthMonth: child.birthMonth,
    elementarySchoolType: goal.schools.elementary,
    juniorHighType: goal.schools.juniorHigh,
    highSchoolType: goal.schools.highSchool,
    universityType: 'none',
    annualHighSchoolTuition: null,
    cramSchoolPeriods: goal.cramSchools.map((cram) => ({
      fromGrade: cram.fromGrade,
      toGrade: cram.toGrade,
      monthlyFee: cram.monthly,
    })),
  }
}

/** 子の費用のカード 1 枚を帯に直す。オン・オフは呼び出し側（`expandGoal`）が見る */
export function childCostBands(goal: ChildCostGoal, ctx: BandContext): Band[] {
  assertChildCostGoal(goal)
  const index = ctx.children.findIndex((entry) => entry.id === goal.childId)
  const child = ctx.children[index]
  if (child === undefined) {
    throw new RangeError(`子の費用のカードの子が見つかりません: ${goal.childId}`)
  }
  const order = index + 1
  const legacy = toLegacyChild(child, goal)
  const { inflationRate } = ctx.assumptions
  const baseYear = ctx.base.year
  const range = { from: ctx.base, to: ctx.until }

  // 前の版の計算は起点より前の年を受け付けない。起点が 1〜3 月なら、前の年の年度（起点の年の 3 月まで）を
  // その年を起点として（物価を掛けずに）数える
  const priceBaseOf = (year: Year): Year => Math.min(year, baseYear)

  const educationPlan: EducationPlan = {
    universityLiving: 'fromHome',
    annualLessonCost: goal.lessonsMonthly === null ? null : goal.lessonsMonthly * 12,
    annualAllowanceAwayFromHome: 0,
  }
  const education = new Map<Year, EducationCost>()
  const educationIn = (year: Year): EducationCost => {
    let cost = education.get(year)
    if (cost === undefined) {
      cost = educationCostInYear(
        legacy,
        educationPlan,
        ctx.tables.schoolCost,
        ctx.tables.universityCost,
        inflationRate,
        priceBaseOf(year),
        year,
      )
      education.set(year, cost)
    }
    return cost
  }

  const make = (
    kind: keyof typeof CHILD_COST_BAND_LABELS,
    bandKind: BandKind,
    annualInYear: (year: Year) => Yen,
  ): Band[] =>
    bandsFromYearly(
      { goalId: goal.id, label: childCostBandLabel(kind, order), kind: bandKind },
      annualInYear,
      range,
      SCHOOL_YEAR_START_MONTH,
    )

  const bands: Band[] = []
  if (goal.childcareMonthly !== null) {
    // 保育：入れてもらうのは保育料（自治体に払う額）だけ。無償化の前の園の実費は聞かず 0 とする。
    // 無償化の後の実費は null で渡し、前の版の計算が「今の実費（0）＋ 副食費の目安 ＋ 主食費の既定値」で置く（D24）。
    // 保育料と給食費は別の帯にする（保育料の帯が無償化の年度の 4 月で終わることが読めるように）
    const enrollment: ChildcareEnrollment = {
      childId: child.id,
      fromYear: child.birthYear,
      monthlyFee: goal.childcareMonthly,
      monthlyExtraCost: 0,
      monthlyExtraCostAfterFree: null,
    }
    const childcare = new Map<Year, ChildcareCost>()
    const childcareIn = (year: Year): ChildcareCost => {
      let cost = childcare.get(year)
      if (cost === undefined) {
        cost = childcareCostInYear(
          legacy,
          enrollment,
          ctx.tables.childcare,
          inflationRate,
          priceBaseOf(year),
          year,
        )
        childcare.set(year, cost)
      }
      return cost
    }
    bands.push(
      ...make('childcare', 'payment', (year) => childcareIn(year).fee),
      ...make('childcareMeal', 'payment', (year) => childcareIn(year).extraCost),
    )
  }

  // 高校の学校教育費（統計）の授業料は、就学支援金を引いた後に保護者が払った額の平均なので、授業料（標準額）に置き換えてから
  // 支援金を収入の帯で引く（そのままだと支援金を二重に引く）。物価は学校の費用の一部として同じように掛ける
  const schoolIn = (year: Year): Yen => {
    const cost = educationIn(year)
    if (cost.stage !== 'highSchool') return cost.schoolFee
    const type = goal.schools.highSchool
    const paid = ctx.tables.schoolCost.highSchool[type].tuitionPaid
    if (paid === undefined) {
      throw new RangeError(`学習費の表に高校（${type}）の授業料（tuitionPaid）がありません`)
    }
    const tuition = ctx.tables.highSchoolSupport.standardAnnualTuition[type]
    const priceIndex = Math.pow(1 + inflationRate, year - priceBaseOf(year))
    return cost.schoolFee + roundYen((tuition - paid.amount) * priceIndex)
  }

  bands.push(
    ...make('school', 'payment', schoolIn),
    ...make('lessons', 'payment', (year) => educationIn(year).lesson),
    ...make('cram', 'payment', (year) => educationIn(year).cramSchool),
    ...make(
      'support',
      'income',
      (year) =>
        highSchoolSupportInYear(
          legacy,
          ctx.tables.highSchoolSupport,
          inflationRate,
          priceBaseOf(year),
          year,
        ).annualAmount,
    ),
    ...allowanceBands(goal, child, order, ctx),
  )
  return bands
}

/**
 * 児童手当の収入の帯（T10）。起点の月から支給が終わる月（高校 3 年の 3 月）まで、月ごとの額を同じ額の続く区間にまとめる。
 * その子の児童手当を大学資金に回している（大学資金のカードがオンで「回す」）ときは出さない（大学資金のカードが `earmarked` で出す。二重に数えない）
 */
function allowanceBands(
  goal: ChildCostGoal,
  child: ChildProfile,
  order: number,
  ctx: BandContext,
): Band[] {
  if (ctx.allowanceEarmarked.has(child.id)) return []
  // ほかの子の費用の帯と同じく「ずっと」の終わりで切る（退職の後まで児童手当が続いて見えないように）
  const useMonth = universityUseMonth(child)
  const end = compareYearMonth(useMonth, ctx.until) < 0 ? useMonth : ctx.until
  const amounts = childAllowanceMonthly(ctx, child.id, ctx.base, end)
  return bandsFromMonthly(
    { goalId: goal.id, label: childCostBandLabel('allowance', order), kind: 'income' },
    amounts,
    ctx.base,
  )
}

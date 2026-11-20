/**
 * 教育費の年次展開。
 *
 * **文部科学省の「学習費総額」をそのまま使わない。**
 * 総額には塾代（補助学習費）が含まれており、このアプリは塾を利用者の入力として
 * 別に受け取るため、そのまま足すと二重計上になる。
 * マスタデータからは学校教育費・給食費・習い事だけを使う。
 *
 * 保育園・幼稚園の費用はここでは扱わない。保育料は自治体の階層表で決まり、
 * 前年の住民税に連動するため別モジュールの担当（SPEC §2.5）。
 */

import { roundYen, sumYen } from '../money'
import type {
  Child,
  CramSchoolPeriod,
  EducationPlan,
  Rate,
  SchoolCostEntry,
  SchoolCostTable,
  UniversityCostTable,
  Year,
  Yen,
} from '../types'

/** 就学の段階。学年から導く */
export type SchoolStage =
  /** 未就学（保育園・幼稚園）。費用は保育料モジュールの担当 */
  | 'preschool'
  | 'elementary'
  | 'juniorHigh'
  | 'highSchool'
  | 'university'
  /** 卒業後、または進学しない */
  | 'graduated'

/** ある年の教育費の内訳 */
export type EducationCost = {
  year: Year
  stage: SchoolStage
  /** 学年（小1 = 1、中1 = 7、高1 = 10、大1 = 13）。未就学は 0 以下 */
  grade: number
  /** 学校教育費 + 給食費 */
  schoolFee: Yen
  /** 習い事・スポーツ・文化活動 */
  lesson: Yen
  /** 塾（利用者の入力） */
  cramSchool: Yen
  /** 大学の納付金と仕送り */
  university: Yen
  /** 上記の合計 */
  total: Yen
}

/**
 * 小学校に入学する年（＝小1の4月がある暦年）。
 *
 * 日本の学年は「4月2日〜翌4月1日生まれ」が同じ学年になる。
 * **1〜3月生まれ（早生まれ）は1年早く入学する。**
 *
 * @throws {RangeError} 生月が 1〜12 の整数でないとき
 */
export function schoolEntryYear(child: Child): Year {
  if (!Number.isInteger(child.birthMonth) || child.birthMonth < 1 || child.birthMonth > 12) {
    throw new RangeError(`生月は 1〜12 で指定してください: ${child.birthMonth}`)
  }
  // 4月〜12月生まれは満6歳の翌年度、1月〜3月生まれは満6歳になる年度に入学する
  return child.birthYear + 6 + (child.birthMonth <= 3 ? 0 : 1)
}

/**
 * 各段階の最初の学年（小1 = 1、中1 = 7、高1 = 10、大1 = 13）。
 * 学年の通し番号を段階に切り分ける境目はここだけで持つ（ゴールシークの区間分割からも使う）。
 */
export const FIRST_GRADE = {
  elementary: 1,
  juniorHigh: 7,
  highSchool: 10,
  university: 13,
} as const

/**
 * その年の学年。小1 = 1、中1 = 7、高1 = 10、大1 = 13。
 *
 * 0 以下は未就学、17 以上は大学卒業後（4年制の場合）。
 *
 * **暦年を年度として扱う。** 実際には1〜3月は前年度にあたるが、
 * 年次モデルなので暦年で切る（フェーズ1の簡略化）。
 */
export function gradeInYear(child: Child, year: Year): number {
  return year - schoolEntryYear(child) + 1
}

/** その学年になる年（＝その学年の4月がある暦年）。`gradeInYear` の逆 */
export function yearOfGrade(child: Child, grade: number): Year {
  if (!Number.isInteger(grade)) {
    throw new RangeError(`学年は整数で指定してください: ${grade}`)
  }
  return schoolEntryYear(child) + grade - 1
}

/** その年の就学段階 */
export function stageInYear(child: Child, year: Year): SchoolStage {
  const grade = gradeInYear(child, year)

  if (grade < FIRST_GRADE.elementary) return 'preschool'
  if (grade < FIRST_GRADE.juniorHigh) return 'elementary'
  if (grade < FIRST_GRADE.highSchool) return 'juniorHigh'
  if (grade < FIRST_GRADE.university) return 'highSchool'

  if (child.universityType === 'none') return 'graduated'

  const universityGrade = grade - FIRST_GRADE.university + 1
  return universityGrade <= universityYears(child) ? 'university' : 'graduated'
}

/** 大学の修業年限。医歯系は6年 */
function universityYears(child: Child): number {
  return child.universityType === 'privateMedical' ? 6 : 4
}

/**
 * その学年で通う塾の年額。区間が重なっていれば合算する。
 *
 * 「小4〜小6の受験塾」と「高2〜高3の受験塾」のように、
 * 離れた区間を複数持てる。
 *
 * @throws {RangeError} 区間の開始学年が終了学年より後、または月謝が負のとき
 */
export function cramSchoolCostInGrade(periods: readonly CramSchoolPeriod[], grade: number): Yen {
  const fees: Yen[] = []

  for (const period of periods) {
    if (period.fromGrade > period.toGrade) {
      throw new RangeError(
        `塾の期間の開始学年が終了学年より後です: ${period.fromGrade} → ${period.toGrade}`,
      )
    }
    if (!Number.isFinite(period.monthlyFee) || period.monthlyFee < 0) {
      throw new RangeError(`塾の月謝は 0 以上の有限の数値で指定してください: ${period.monthlyFee}`)
    }
    if (grade >= period.fromGrade && grade <= period.toGrade) {
      fees.push(period.monthlyFee * 12)
    }
  }

  return sumYen(fees)
}

/** その段階・公私に対応する学習費のエントリを引く。未就学と卒業後は null */
function resolveSchoolCost(
  child: Child,
  stage: SchoolStage,
  table: SchoolCostTable,
): SchoolCostEntry | null {
  switch (stage) {
    case 'elementary':
      return table.elementary[child.elementarySchoolType]
    case 'juniorHigh':
      return table.juniorHigh[child.juniorHighType]
    case 'highSchool':
      return table.highSchool[child.highSchoolType]
    default:
      return null
  }
}

/**
 * ある年の教育費。
 *
 * 学校教育費・給食費・習い事はインフレで逓増させる。
 * 大学の納付金も同様に扱う（実際に授業料は年々上がっている）。
 * **塾の月謝はインフレさせない。** 利用者が「その学年でいくら払うつもりか」を
 * 直接入力する値なので、こちらで動かすと入力の意味が変わってしまう。
 *
 * 就学支援金（高校）と児童手当は収入側で扱うため、ここでは引かない。
 *
 * @param baseYear 計算の起点となる年。マスタデータの金額はこの年の水準として扱う
 * @throws {RangeError} `year` が `baseYear` より前、またはインフレ率が不正なとき
 */
export function educationCostInYear(
  child: Child,
  plan: EducationPlan,
  schoolCost: SchoolCostTable,
  universityCost: UniversityCostTable,
  inflationRate: Rate,
  baseYear: Year,
  year: Year,
): EducationCost {
  if (!Number.isInteger(baseYear) || !Number.isInteger(year)) {
    throw new RangeError(`年は整数で指定してください: baseYear=${baseYear}, year=${year}`)
  }
  if (year < baseYear) {
    throw new RangeError(`起点より前の年は計算できません: baseYear=${baseYear}, year=${year}`)
  }
  if (!Number.isFinite(inflationRate) || inflationRate <= -1) {
    throw new RangeError(`インフレ率が不正です: ${inflationRate}`)
  }

  const priceIndex = Math.pow(1 + inflationRate, year - baseYear)
  const grade = gradeInYear(child, year)
  const stage = stageInYear(child, year)

  const entry = resolveSchoolCost(child, stage, schoolCost)

  // 学校教育費と給食費。学校外活動費は含めない（塾と習い事で別に数える）
  const schoolFee =
    entry === null ? 0 : roundYen((entry.schoolEducation + entry.schoolLunch) * priceIndex)

  // 習い事。入力があればそれを、無ければ統計の平均（その他の学校外活動費）を使う
  const lessonBase = plan.annualLessonCost ?? entry?.otherOutsideActivity ?? 0
  const lesson = entry === null ? 0 : roundYen(lessonBase * priceIndex)

  // 塾はインフレさせない
  const cramSchool = cramSchoolCostInGrade(child.cramSchoolPeriods, grade)

  const university =
    stage === 'university'
      ? universityCostInYear(child, plan, universityCost, priceIndex, grade)
      : 0

  return {
    year,
    stage,
    grade,
    schoolFee,
    lesson,
    cramSchool,
    university,
    total: sumYen([schoolFee, lesson, cramSchool, university]),
  }
}

/**
 * 大学に在学している年の費用。
 *
 * 入学年は入学料を含む初年度納付金、2年目以降は年額。
 * 自宅外通学なら仕送りを上乗せする。
 */
function universityCostInYear(
  child: Child,
  plan: EducationPlan,
  table: UniversityCostTable,
  priceIndex: number,
  grade: number,
): Yen {
  if (child.universityType === 'none') {
    return 0
  }

  const entry = table[child.universityType]
  const universityGrade = grade - 12
  const tuition = universityGrade === 1 ? entry.initialYear : entry.annual

  const allowance = plan.universityLiving === 'awayFromHome' ? plan.annualAllowanceAwayFromHome : 0
  if (!Number.isFinite(allowance) || allowance < 0) {
    throw new RangeError(`仕送りは 0 以上の有限の数値で指定してください: ${allowance}`)
  }

  return roundYen((tuition + allowance) * priceIndex)
}

/**
 * 世帯の子ども全員ぶんの教育費を合計する。
 *
 * **子が複数いる年は費用が重なる。** 上の子の大学入学と下の子の高校入学が
 * 同じ年に来るような山を、平らに均さずそのまま出すのがこのアプリの目的。
 */
export function householdEducationCostInYear(
  children: readonly Child[],
  plan: EducationPlan,
  schoolCost: SchoolCostTable,
  universityCost: UniversityCostTable,
  inflationRate: Rate,
  baseYear: Year,
  year: Year,
): Yen {
  return sumYen(
    children.map(
      (child) =>
        educationCostInYear(child, plan, schoolCost, universityCost, inflationRate, baseYear, year)
          .total,
    ),
  )
}

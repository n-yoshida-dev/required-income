import { describe, expect, it } from 'vitest'
import {
  FIRST_GRADE,
  cramSchoolCostInGrade,
  educationCostInYear,
  gradeInYear,
  householdEducationCostInYear,
  schoolEntryYear,
  stageInYear,
  yearOfGrade,
} from '../../../src/domain/expense/education'
import type { Child, EducationPlan } from '../../../src/domain/types'
import { sampleInput, schoolCost, universityCost } from '../fixtures'

const BASE_YEAR = 2025

/** 中学受験して私立中・私立高へ進み、私立文系の大学に自宅から通う子 */
const privatePathChild = sampleInput.children[0]!
/** 公立中・公立高から国公立大へ進む子 */
const publicPathChild = sampleInput.children[1]!

const plan: EducationPlan = sampleInput.education

/** 引数を並べるのが長いので、テストの意図が読めるように包む */
function costOf(
  child: Child,
  year: number,
  inflationRate = 0,
  educationPlan: EducationPlan = plan,
) {
  return educationCostInYear(
    child,
    educationPlan,
    schoolCost,
    universityCost,
    inflationRate,
    BASE_YEAR,
    year,
  )
}

describe('schoolEntryYear', () => {
  it('4月〜12月生まれは満6歳の翌年度に入学する', () => {
    // 2018年4月生まれ → 2025年4月に小1
    expect(schoolEntryYear(privatePathChild)).toBe(2025)
  })

  it('1月〜3月生まれ（早生まれ）は1年早く入学する', () => {
    const earlyBorn: Child = { ...privatePathChild, birthMonth: 3 }
    expect(schoolEntryYear(earlyBorn)).toBe(2024)
  })

  it('4月1日生まれと4月2日生まれの境界は月では表せないため、4月は遅い側に倒す', () => {
    // 学年の境界は4月1日と4月2日の間にあるが、入力が月までなので4月生まれは
    // すべて「遅い側」として扱う。ここが仕様であることをテストで固定する
    const april: Child = { ...privatePathChild, birthMonth: 4 }
    const march: Child = { ...privatePathChild, birthMonth: 3 }
    expect(schoolEntryYear(april) - schoolEntryYear(march)).toBe(1)
  })

  it('生月が 1〜12 の整数でなければ例外を投げる', () => {
    // 型では Month に絞っているが、外部入力（JSON 読み込み）で壊れた値が
    // 入りうるので実行時にも検査する
    const broken = { ...privatePathChild, birthMonth: 13 } as unknown as Child
    expect(() => schoolEntryYear(broken)).toThrow(RangeError)
  })
})

describe('gradeInYear / stageInYear', () => {
  it('入学前は 0 以下の学年で未就学になる', () => {
    expect(gradeInYear(privatePathChild, 2024)).toBe(0)
    expect(stageInYear(privatePathChild, 2024)).toBe('preschool')
  })

  it('小学校は1〜6学年', () => {
    expect(stageInYear(privatePathChild, 2025)).toBe('elementary')
    expect(gradeInYear(privatePathChild, 2030)).toBe(6)
    expect(stageInYear(privatePathChild, 2030)).toBe('elementary')
  })

  it('中学校は7〜9学年', () => {
    expect(gradeInYear(privatePathChild, 2031)).toBe(7)
    expect(stageInYear(privatePathChild, 2031)).toBe('juniorHigh')
    expect(stageInYear(privatePathChild, 2033)).toBe('juniorHigh')
  })

  it('高校は10〜12学年', () => {
    expect(stageInYear(privatePathChild, 2034)).toBe('highSchool')
    expect(stageInYear(privatePathChild, 2036)).toBe('highSchool')
  })

  it('大学は13学年から修業年限まで', () => {
    expect(stageInYear(privatePathChild, 2037)).toBe('university')
    expect(stageInYear(privatePathChild, 2040)).toBe('university')
    expect(stageInYear(privatePathChild, 2041)).toBe('graduated')
  })

  it('医歯系は6年間なので卒業が2年遅い', () => {
    const medical: Child = { ...privatePathChild, universityType: 'privateMedical' }
    expect(stageInYear(medical, 2042)).toBe('university')
    expect(stageInYear(medical, 2043)).toBe('graduated')
  })

  it('進学しないなら高校卒業後は卒業扱い', () => {
    const noUniversity: Child = { ...privatePathChild, universityType: 'none' }
    expect(stageInYear(noUniversity, 2037)).toBe('graduated')
  })
})

describe('cramSchoolCostInGrade', () => {
  const periods = [
    { fromGrade: 4, toGrade: 6, monthlyFee: 55000 },
    { fromGrade: 11, toGrade: 12, monthlyFee: 48000 },
  ]

  it('区間の中の学年は月謝の12か月ぶん', () => {
    expect(cramSchoolCostInGrade(periods, 4)).toBe(660000)
    expect(cramSchoolCostInGrade(periods, 11)).toBe(576000)
  })

  it('区間の外は 0', () => {
    expect(cramSchoolCostInGrade(periods, 3)).toBe(0)
    expect(cramSchoolCostInGrade(periods, 7)).toBe(0)
    expect(cramSchoolCostInGrade(periods, 13)).toBe(0)
  })

  it('区間が重なっていれば合算する', () => {
    const overlapping = [
      { fromGrade: 7, toGrade: 9, monthlyFee: 30000 },
      { fromGrade: 9, toGrade: 9, monthlyFee: 20000 },
    ]
    // 中3だけ夏期講習を上乗せするようなケース
    expect(cramSchoolCostInGrade(overlapping, 9)).toBe(600000)
  })

  it('区間が空なら 0', () => {
    expect(cramSchoolCostInGrade([], 5)).toBe(0)
  })

  it('開始学年が終了学年より後なら例外を投げる', () => {
    expect(() =>
      cramSchoolCostInGrade([{ fromGrade: 9, toGrade: 7, monthlyFee: 30000 }], 8),
    ).toThrow(RangeError)
  })

  it('月謝が負なら例外を投げる', () => {
    expect(() => cramSchoolCostInGrade([{ fromGrade: 7, toGrade: 9, monthlyFee: -1 }], 8)).toThrow(
      RangeError,
    )
  })
})

describe('educationCostInYear', () => {
  it('未就学の年は 0（保育料は別モジュールの担当）', () => {
    // 下の子は2028年に小1。起点の2025年時点ではまだ未就学
    const cost = costOf(publicPathChild, 2025)

    expect(cost.stage).toBe('preschool')
    expect(cost.total).toBe(0)
  })

  it('小学校は学校教育費と給食費、習い事を計上する', () => {
    const cost = costOf(privatePathChild, 2025)

    // 74,336（学校教育費）+ 35,774（給食費）
    expect(cost.schoolFee).toBe(110110)
    // 統計の「その他の学校外活動費」を習い事として使う
    expect(cost.lesson).toBe(144004)
    expect(cost.cramSchool).toBe(0)
    expect(cost.total).toBe(254114)
  })

  it('学習費総額をそのまま使っていない（塾代を二重に数えない）', () => {
    const cost = costOf(privatePathChild, 2025)
    const entry = schoolCost.elementary.public

    // 総額には補助学習費（塾代）が含まれるので、必ず総額より小さくなる
    expect(cost.total).toBeLessThan(entry.total)
    expect(cost.total).toBe(entry.total - entry.supplementaryStudy)
  })

  it('中学受験の塾代が小4から乗る', () => {
    const beforeCram = costOf(privatePathChild, 2027)
    const withCram = costOf(privatePathChild, 2028)

    expect(beforeCram.cramSchool).toBe(0)
    // 月55,000 × 12
    expect(withCram.cramSchool).toBe(660000)
    expect(withCram.total - beforeCram.total).toBe(660000)
  })

  it('私立中は学校に払う額が跳ね上がる', () => {
    const publicJuniorHigh = costOf(publicPathChild, 2035)
    const privateJuniorHigh = costOf(privatePathChild, 2031)

    expect(publicJuniorHigh.stage).toBe('juniorHigh')
    expect(privateJuniorHigh.stage).toBe('juniorHigh')
    // 1,128,061 + 9,317
    expect(privateJuniorHigh.schoolFee).toBe(1137378)
    // 150,761 + 35,671
    expect(publicJuniorHigh.schoolFee).toBe(186432)
  })

  it('大学は入学年だけ入学料を含む初年度納付金になる', () => {
    const firstYear = costOf(privatePathChild, 2037)
    const secondYear = costOf(privatePathChild, 2038)

    expect(firstYear.university).toBe(1300561)
    expect(secondYear.university).toBe(1080610)
    // 差は入学料 219,951 ぶん
    expect(firstYear.university - secondYear.university).toBe(219951)
  })

  it('大学在学中は学校教育費と習い事を計上しない', () => {
    const cost = costOf(privatePathChild, 2037)

    expect(cost.schoolFee).toBe(0)
    expect(cost.lesson).toBe(0)
    expect(cost.total).toBe(cost.university)
  })

  it('自宅外通学なら仕送りが上乗せされる', () => {
    const awayPlan: EducationPlan = { ...plan, universityLiving: 'awayFromHome' }
    const fromHome = costOf(privatePathChild, 2038)
    const awayFromHome = costOf(privatePathChild, 2038, 0, awayPlan)

    expect(awayFromHome.university - fromHome.university).toBe(1200000)
  })

  it('卒業後は 0', () => {
    expect(costOf(privatePathChild, 2041).total).toBe(0)
  })

  it('習い事は入力で上書きできる', () => {
    const customPlan: EducationPlan = { ...plan, annualLessonCost: 60000 }
    expect(costOf(privatePathChild, 2025, 0, customPlan).lesson).toBe(60000)
  })

  it('習い事を 0 にもできる', () => {
    const noLessonPlan: EducationPlan = { ...plan, annualLessonCost: 0 }
    expect(costOf(privatePathChild, 2025, 0, noLessonPlan).lesson).toBe(0)
  })

  it('学校教育費と習い事はインフレで逓増するが、塾の月謝はしない', () => {
    const cost = costOf(privatePathChild, 2026, 0.02)

    expect(cost.schoolFee).toBe(112312)
    expect(cost.lesson).toBe(146884)

    // 塾は利用者が「その学年でいくら払うつもりか」を入力する値なので動かさない
    const withCram = costOf(privatePathChild, 2028, 0.02)
    expect(withCram.cramSchool).toBe(660000)
  })

  it('起点より前の年は例外を投げる', () => {
    expect(() => costOf(privatePathChild, BASE_YEAR, 0.02)).not.toThrow()
    expect(() => costOf(privatePathChild, BASE_YEAR - 1, 0.02)).toThrow(RangeError)
  })

  it('インフレ率が -100% 以下なら例外を投げる', () => {
    expect(() => costOf(privatePathChild, 2030, -1)).toThrow(RangeError)
  })
})

describe('householdEducationCostInYear', () => {
  it('子ども全員ぶんを合計する', () => {
    const total = householdEducationCostInYear(
      sampleInput.children,
      plan,
      schoolCost,
      universityCost,
      0,
      BASE_YEAR,
      2037,
    )

    // 上の子は大学1年、下の子は高校1年。同じ年に費用が重なる
    const first = costOf(privatePathChild, 2037)
    const second = costOf(publicPathChild, 2037)

    expect(first.stage).toBe('university')
    expect(second.stage).toBe('highSchool')
    expect(total).toBe(first.total + second.total)
  })

  it('子がいなければ 0', () => {
    expect(
      householdEducationCostInYear([], plan, schoolCost, universityCost, 0, BASE_YEAR, 2030),
    ).toBe(0)
  })
})

describe('yearOfGrade', () => {
  const child: Child = {
    id: 'c',
    birthYear: 2020,
    birthMonth: 4,
    elementarySchoolType: 'public',
    juniorHighType: 'public',
    highSchoolType: 'public',
    universityType: 'privateHumanities',
    annualHighSchoolTuition: null,
    cramSchoolPeriods: [],
  }

  it('gradeInYear の逆で、各段階の最初の学年が入学年になる', () => {
    expect(yearOfGrade(child, FIRST_GRADE.elementary)).toBe(schoolEntryYear(child))
    expect(yearOfGrade(child, FIRST_GRADE.juniorHigh)).toBe(2033)
    expect(yearOfGrade(child, FIRST_GRADE.highSchool)).toBe(2036)
    expect(yearOfGrade(child, FIRST_GRADE.university)).toBe(2039)
    expect(gradeInYear(child, yearOfGrade(child, FIRST_GRADE.highSchool))).toBe(
      FIRST_GRADE.highSchool,
    )
  })

  it('学年が整数でなければ例外', () => {
    expect(() => yearOfGrade(child, 7.5)).toThrow(RangeError)
  })
})

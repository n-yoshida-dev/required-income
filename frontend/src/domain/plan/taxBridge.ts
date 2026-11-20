/**
 * 税の計算への橋渡し（SPEC §3.6 の後半）。`LifePlan` から、税の入口（`tax/household.ts`）が読む
 * `HouseholdTaxInput` と、年ごとの `HouseholdTaxIncome` を作る。
 *
 * - 大人：寿命はアプリの既定値（`taxBridge.lifeExpectancy`）。階段は退職の前年で切れるので、答えには効かない
 * - 子：進路は子の費用のカードから、大学は大学資金のカードがオンなら私立文系（SPEC §2.1 の目標額の既定と同じ）、無ければ大学に行かない。
 *   税に効くのは「いつ学校を出て扶養から外れるか」だけ
 * - 住まい：自治体 1 つ。家賃は税に効かないので持たない
 * - 保険：働いていない大人を扶養に入れる。国保の世帯主は指定なし（先頭の大人）
 * - 年金：空（階段は退職の前年までなので、年金を受け取る年は無い）
 * - 人ごとの収入：会社員は給与、自営業は事業所得、副業は雑所得（SPEC §8 の 7 ★）。`income/household.ts` は通さない
 *
 * 収入の水準（本業と副業の月額）は `IncomeLevels` で受け取り、見込みからも、探索で動かした値からも同じ形で作れるようにする。
 */

import { compound } from '../money'
import type { HouseholdTaxIncome, HouseholdTaxInput } from '../tax/household'
import type { Child, FilingType } from '../types'
import { assertNonNegativeYen } from './bands/band'
import type { Adult, IncomeLevels, LifePlan, TaxBridgeSettings, Year, Yen } from './types'

const FILING_TYPES: readonly FilingType[] = ['blue65', 'blue55', 'blue10', 'white']

/** その年に大人が退職しているか（退職の年齢に達した年から退職とみなす。`lastNeedYear` と同じ数え方） */
export function isRetiredIn(adult: Adult, year: Year): boolean {
  return year >= adult.birthYear + adult.retirementAge
}

/** その年に本業の収入を動かせる大人か（働いていて、まだ退職していない） */
export function canEarnIn(adult: Adult, year: Year): boolean {
  return adult.workStyle !== 'notWorking' && !isRetiredIn(adult, year)
}

/**
 * 見込みの本業の収入（SPEC §2 の見込み）。
 *
 * 起点の年は入れた年収。`outlookSteps` のうち、起点の年より後でその年以下のいちばん新しい段があれば、その年収を基準にする。
 * 基準の年から毎年 `raiseRate` で上がる。起点の年以前の段は使わない（今の年収は `annualIncome` が持つ）。
 * 働いていない・退職した年は 0。
 */
export function expectedMainIncome(adult: Adult, baseYear: Year, year: Year): Yen {
  assertAdultIncome(adult)
  if (!canEarnIn(adult, year)) {
    return 0
  }
  let anchor = { year: baseYear, annualIncome: adult.annualIncome }
  for (const step of adult.outlookSteps) {
    if (step.year > baseYear && step.year <= year && step.year >= anchor.year) {
      anchor = step
    }
  }
  return compound(anchor.annualIncome, adult.raiseRate, Math.max(0, year - anchor.year))
}

/** その年の見込みの収入の水準（全員ぶん） */
export function expectedLevels(plan: LifePlan, year: Year): IncomeLevels {
  return new Map(
    plan.adults.map((adult) => [
      adult.id,
      {
        main: expectedMainIncome(adult, plan.baseYearMonth.year, year),
        sideMonthly: isRetiredIn(adult, year) ? 0 : adult.sideMonthlyProfit,
      },
    ]),
  )
}

/** 世帯年収（本業 ＋ 副業の所得の年額）。会社員は額面、自営業は所得のまま足す */
export function householdGross(levels: IncomeLevels): Yen {
  let total = 0
  for (const level of levels.values()) {
    total += level.main + level.sideMonthly * 12
  }
  return total
}

/** `LifePlan` から税の入口が読む世帯の設定を作る。既定値が契約に反していれば投げる */
export function householdTaxInput(plan: LifePlan, settings: TaxBridgeSettings): HouseholdTaxInput {
  const lifeExpectancy = settings.lifeExpectancy.value
  if (!Number.isInteger(lifeExpectancy) || lifeExpectancy <= 0) {
    throw new RangeError(`寿命の既定値は正の整数で指定してください: ${lifeExpectancy}`)
  }
  return {
    baseYear: plan.baseYearMonth.year,
    adults: plan.adults.map((adult) => ({
      id: adult.id,
      birthYear: adult.birthYear,
      retirementAge: adult.retirementAge,
      // 退職の年齢が既定の寿命を超えても、階段の年に「生きていない」とならないようにする
      lifeExpectancy: Math.max(lifeExpectancy, adult.retirementAge),
    })),
    children: plan.children.map((child) => toTaxChild(plan, child.id)),
    residence: [
      {
        fromYear: plan.baseYearMonth.year,
        municipality: plan.municipality,
        monthlyRent: null,
        moveInCost: 0,
      },
    ],
    insurance: {
      dependentAdultIds: plan.adults
        .filter((adult) => adult.workStyle === 'notWorking')
        .map((adult) => adult.id),
      nationalHealthInsuranceHouseholderId: null,
    },
    retirement: { byPerson: [] },
    // 年金を持たないので改定率は使われない。0（名目固定）を渡す
    assumptions: { pensionIndexationRate: 0 },
  }
}

/**
 * 収入の水準から、税の入口が読むその年の収入を作る。
 * `levels` に大人が欠けている、金額が負・整数でない、既定値が契約に反しているときは投げる
 */
export function householdTaxIncome(
  plan: LifePlan,
  year: Year,
  levels: IncomeLevels,
  settings: TaxBridgeSettings,
): HouseholdTaxIncome {
  const bonusShare = settings.bonusShare.value
  if (!Number.isFinite(bonusShare) || bonusShare < 0 || bonusShare > 1) {
    throw new RangeError(`賞与の割合の既定値は 0〜1 で指定してください: ${bonusShare}`)
  }
  const filingType = toFilingType(settings.selfEmployedFilingType.value)

  return {
    year,
    byPerson: plan.adults.map((adult) => {
      const level = levels.get(adult.id)
      if (level === undefined) {
        throw new RangeError(`収入の水準に大人がいません: ${adult.id}`)
      }
      assertNonNegativeYen(level.main, `大人 ${adult.id} の本業の収入`)
      assertNonNegativeYen(level.sideMonthly, `大人 ${adult.id} の副業の所得（月）`)

      const isEmployee = adult.workStyle === 'employee' && level.main > 0
      const isSelfEmployed = adult.workStyle === 'selfEmployed' && level.main > 0
      const annualBonus = isEmployee ? Math.round(level.main * bonusShare) : 0
      return {
        personId: adult.id,
        // 額面が 0 の年は会社の社会保険に入っていない（`PersonIncomeInYear` と同じ決め事）
        employment: isEmployee
          ? {
              pay: { annualGross: level.main - annualBonus, annualBonus },
              bonusPaymentCount: settings.bonusPaymentCount.value,
            }
          : null,
        businessProfit: isSelfEmployed ? level.main : 0,
        filingType: isSelfEmployed ? filingType : null,
        realEstateProfit: 0,
        miscellaneousProfit: level.sideMonthly * 12,
      }
    }),
  }
}

/** 子 1 人を税の計算の形に直す。進路は子の費用のカード、大学は大学資金のカードから */
function toTaxChild(plan: LifePlan, childId: string): Child {
  const child = plan.children.find((entry) => entry.id === childId)
  if (child === undefined) {
    throw new RangeError(`子が見つかりません: ${childId}`)
  }
  const cost = plan.goals.find((goal) => goal.kind === 'childCost' && goal.childId === childId)
  const goesToUniversity = plan.goals.some(
    (goal) => goal.kind === 'university' && goal.childId === childId && goal.enabled,
  )
  const schools = cost?.kind === 'childCost' ? cost.schools : undefined
  return {
    id: child.id,
    birthYear: child.birthYear,
    birthMonth: child.birthMonth,
    elementarySchoolType: schools?.elementary ?? 'public',
    juniorHighType: schools?.juniorHigh ?? 'public',
    highSchoolType: schools?.highSchool ?? 'public',
    universityType: goesToUniversity ? 'privateHumanities' : 'none',
    annualHighSchoolTuition: null,
    cramSchoolPeriods:
      cost?.kind === 'childCost'
        ? cost.cramSchools.map((cram) => ({
            fromGrade: cram.fromGrade,
            toGrade: cram.toGrade,
            monthlyFee: cram.monthly,
          }))
        : [],
  }
}

/** 文字列を申告方式に直す。選択肢に無ければ投げる */
function toFilingType(value: string): FilingType {
  const found = FILING_TYPES.find((type) => type === value)
  if (found === undefined) {
    throw new RangeError(`自営業の申告方式の既定値が選択肢にありません: ${value}`)
  }
  return found
}

/** 大人の収入の入力が契約どおりかを確かめる */
function assertAdultIncome(adult: Adult): void {
  assertNonNegativeYen(adult.annualIncome, `大人 ${adult.id} の年収`)
  assertNonNegativeYen(adult.sideMonthlyProfit, `大人 ${adult.id} の副業の所得（月）`)
  if (!Number.isFinite(adult.raiseRate) || adult.raiseRate <= -1) {
    throw new RangeError(`大人 ${adult.id} の上がり方が正しくありません: ${adult.raiseRate}`)
  }
  for (const step of adult.outlookSteps) {
    if (!Number.isInteger(step.year)) {
      throw new RangeError(`大人 ${adult.id} の見込みの年は整数で指定してください: ${step.year}`)
    }
    assertNonNegativeYen(step.annualIncome, `大人 ${adult.id} の見込みの年収`)
  }
}

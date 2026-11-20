/**
 * 所得税（国税）。総合課税の所得に対する税額を求める。
 *
 * 流れは「収入 → 所得（給与なら給与所得控除を引く）→ 合計所得金額 → 所得控除を引いて課税所得 →
 * 速算表 → 付加税（復興特別所得税・防衛特別所得税）」。このモジュールは「合計所得金額から先」を担い、
 * 給与所得の計算だけ入口の関数として持つ。事業・不動産の所得は `income/gross.ts` が出す。
 *
 * 所得控除のうち扱うのは社会保険料控除・基礎控除・配偶者（特別）控除・扶養控除・特定親族特別控除。
 * 生命保険料控除・iDeCo（小規模企業共済等掛金控除）・医療費控除は利用者の入力が要るため扱わない
 * （その分だけ税を多めに見積もる。安全側）。
 *
 * **記憶で式を補わない。** 表・境界・丸めの単位はすべて `IncomeTaxTable`（JSON）から読む。
 * JSON に無い丸め（給与所得控除の 4,000 円単位の丸めなど）は入れず、円単位で計算する
 * （差は数百円。KNOWLEDGE.md 2026-09-15）。
 */

import { roundYen } from '../money'
import type {
  DependentRelative,
  IncomeTaxTable,
  PersonalDeductionContext,
  Rate,
  Year,
  Yen,
} from '../types'
import {
  assertNonNegativeYen,
  assertYear,
  findForYear,
  pickBand,
  pickForYear,
  pickRange,
  roundDownTo,
} from './schedule'

/** 所得税を求める入力 */
export type IncomeTaxInput = {
  year: Year
  /** 合計所得金額（給与所得 + 事業所得 + 不動産所得 + 雑所得。損失があれば差し引き後） */
  totalIncome: Yen
  /** その年に支払った社会保険料（本人負担ぶんの合計） */
  socialInsurancePaid: Yen
  personal: PersonalDeductionContext
}

/** 所得税の計算結果。内訳は表示と検算のために持つ */
export type IncomeTaxResult = {
  totalIncome: Yen
  deductions: {
    socialInsurance: Yen
    basic: Yen
    spouse: Yen
    dependents: Yen
    specifiedRelative: Yen
    total: Yen
  }
  /** 課税所得（1,000 円未満切捨て後） */
  taxableIncome: Yen
  /** 付加税を掛ける前の所得税額（基準所得税額） */
  baseTax: Yen
  /** その年に効く付加税の率の合計 */
  surtaxRate: Rate
  /** 納める所得税（付加税込み） */
  tax: Yen
}

/**
 * 給与所得の金額（給与等の収入金額 − 給与所得控除額）。
 *
 * 控除額は「収入金額 × rate + deduction」と最低保障額の大きい方。2026〜2027 年分は低所得層に
 * 「給与所得の金額そのもの」を決める特例があり、その範囲に入る収入はそちらを使う。
 * 所得が負になることは無い（控除額は収入を超えない）。
 *
 * @param revenue 給与等の収入金額（月給 + 賞与の額面）
 * @throws {RangeError} 収入が負、その年分の表が無いとき
 */
export function employmentIncomeAmount(revenue: Yen, year: Year, table: IncomeTaxTable): Yen {
  assertNonNegativeYen(revenue, '給与の収入金額')
  const schedule = pickForYear(table.employmentIncomeDeduction.schedule, year, '給与所得控除')

  const special = schedule.specialRulesForLowIncome?.rows.find(
    (row) => row.incomeFrom <= revenue && revenue < row.incomeBelow,
  )
  if (special !== undefined) {
    return special.employmentIncome ?? roundYen(revenue - schedule.minimum)
  }

  const band = pickBand(schedule.table, revenue, (row) => row.upTo, '給与所得控除')
  const deduction = Math.max(Math.floor(revenue * band.rate + band.deduction), schedule.minimum)
  return Math.max(0, roundYen(revenue - deduction))
}

/**
 * 基礎控除。納税者本人の合計所得金額とその年分の表で決まる。
 *
 * @throws {RangeError} その年分の表が無いとき
 */
export function incomeTaxBasicDeduction(totalIncome: Yen, year: Year, table: IncomeTaxTable): Yen {
  const schedule = pickForYear(table.basicDeduction.schedule, year, '基礎控除')
  return pickBand(schedule.table, totalIncome, (row) => row.totalIncomeUpTo, '基礎控除').amount
}

/**
 * 配偶者控除または配偶者特別控除。どちらか一方しか受けられない。
 *
 * - 納税者本人の合計所得が表の上限（1,000 万円）を超えると 0
 * - 配偶者の合計所得が所得要件以下なら配偶者控除（70 歳以上は老人控除対象配偶者の額）
 * - 所得要件を超え特別控除の上限（133 万円）以下なら配偶者特別控除
 * - それより上は 0
 *
 * @throws {RangeError} その年分の表が無いとき
 */
export function incomeTaxSpouseDeduction(
  taxpayerTotalIncome: Yen,
  spouse: PersonalDeductionContext['spouse'],
  year: Year,
  table: IncomeTaxTable,
): Yen {
  if (spouse === null) {
    return 0
  }
  const { ordinary, special } = table.spouseDeduction
  const requirement = pickForYear(
    ordinary.spouseIncomeRequirement.schedule,
    year,
    '配偶者控除の所得要件',
  ).totalIncomeUpTo

  if (spouse.totalIncome <= requirement) {
    const row = ordinary.table.find(
      (candidate) => taxpayerTotalIncome <= candidate.taxpayerTotalIncomeUpTo,
    )
    if (row === undefined) {
      return 0
    }
    return spouse.age >= ordinary.elderlyFromAge ? row.elderly : row.general
  }

  const schedule = pickForYear(special.schedule, year, '配偶者特別控除')
  const band = pickRange(schedule.table, spouse.totalIncome, (row) => ({
    over: row.spouseTotalIncomeOver,
    upTo: row.spouseTotalIncomeUpTo,
  }))
  if (band === null) {
    return 0
  }
  const cell = band.amountsByTaxpayerIncome.find(
    (candidate) => taxpayerTotalIncome <= candidate.taxpayerTotalIncomeUpTo,
  )
  return cell?.amount ?? 0
}

/**
 * 扶養控除と特定親族特別控除の合計を、内訳つきで返す。
 *
 * 扶養親族（所得要件以下）は年齢で額が決まる：16 歳未満は 0、16〜18 歳と 23〜69 歳は一般、
 * 19〜22 歳は特定、70 歳以上は老人（同居の直系尊属なら同居老親等）。
 * 19〜22 歳で所得要件を超えた人は、特定親族特別控除（2025 年分から）に移る。
 *
 * @throws {RangeError} その年分の所得要件の表が無いとき
 */
export function incomeTaxDependentDeductions(
  dependents: readonly DependentRelative[],
  year: Year,
  table: IncomeTaxTable,
): { dependents: Yen; specifiedRelative: Yen } {
  const { amounts, ages, dependentIncomeRequirement } = table.dependentDeduction
  const requirement = pickForYear(
    dependentIncomeRequirement.schedule,
    year,
    '扶養控除の所得要件',
  ).totalIncomeUpTo
  const specifiedRelativeSchedule = findForYear(
    table.specifiedRelativeSpecialDeduction.schedule,
    year,
  )

  let dependentTotal = 0
  let specifiedRelativeTotal = 0
  for (const relative of dependents) {
    assertDependent(relative)
    const isSpecificAge =
      ages.specificFromAge <= relative.age && relative.age < ages.specificBelowAge

    if (relative.totalIncome <= requirement) {
      if (relative.age >= ages.elderlyFromAge) {
        dependentTotal +=
          relative.cohabitingLinealAscendant === true
            ? amounts.elderlyCohabitingParent
            : amounts.elderly
      } else if (isSpecificAge) {
        dependentTotal += amounts.specific
      } else if (relative.age >= ages.controlledDependentFromAge) {
        dependentTotal += amounts.general
      }
      continue
    }

    if (isSpecificAge && specifiedRelativeSchedule !== null) {
      const band = pickRange(specifiedRelativeSchedule.table, relative.totalIncome, (row) => ({
        over: row.totalIncomeOver,
        upTo: row.totalIncomeUpTo,
      }))
      specifiedRelativeTotal += band?.amount ?? 0
    }
  }
  return { dependents: dependentTotal, specifiedRelative: specifiedRelativeTotal }
}

/**
 * 所得税を求める。
 *
 * 合計所得金額が負（事業の損失）でも例外にせず、課税所得を 0 として扱う（損失に税は掛からない）。
 *
 * @throws {RangeError} 年・金額が不正なとき、その年分の表が無いとき
 */
export function incomeTax(input: IncomeTaxInput, table: IncomeTaxTable): IncomeTaxResult {
  const { year, totalIncome, socialInsurancePaid, personal } = input
  assertYear(year)
  if (!Number.isFinite(totalIncome)) {
    throw new RangeError(`合計所得金額が有限の数値ではありません: ${totalIncome}`)
  }
  assertNonNegativeYen(socialInsurancePaid, '社会保険料')

  const socialInsurance = roundYen(
    socialInsurancePaid * table.socialInsuranceDeduction.deductibleRatio,
  )
  const basic = incomeTaxBasicDeduction(totalIncome, year, table)
  const spouse = incomeTaxSpouseDeduction(totalIncome, personal.spouse, year, table)
  const dependents = incomeTaxDependentDeductions(personal.dependents, year, table)
  const deductionTotal =
    socialInsurance + basic + spouse + dependents.dependents + dependents.specifiedRelative

  const taxableIncome = roundDownTo(
    Math.max(0, totalIncome - deductionTotal),
    table.bracketsMeta.taxableIncomeRoundDownTo,
  )
  const bracket = pickBand(table.brackets, taxableIncome, (row) => row.upTo, '所得税の速算表')
  const baseTax = Math.max(0, roundYen(taxableIncome * bracket.rate - bracket.deduction))
  const surtaxRate = applicableSurtaxRate(table, year)
  const tax = roundYen(baseTax * (1 + surtaxRate))

  return {
    totalIncome,
    deductions: {
      socialInsurance,
      basic,
      spouse,
      dependents: dependents.dependents,
      specifiedRelative: dependents.specifiedRelative,
      total: deductionTotal,
    },
    taxableIncome,
    baseTax,
    surtaxRate,
    tax,
  }
}

/**
 * その年に効く付加税の率の合計。期限の異なる付加税が並走する期間は合算する
 * （前の版の `asset/property.ts` の譲渡所得税と同じ規則。タグ `v1-final` にある）。
 */
export function applicableSurtaxRate(table: IncomeTaxTable, year: Year): Rate {
  return table.surtaxes
    .filter(
      (surtax) =>
        surtax.fromYear <= year && (surtax.untilYear === null || year <= surtax.untilYear),
    )
    .reduce((sum, surtax) => sum + surtax.rate, 0)
}

/**
 * 扶養親族の候補の入力を検証する。
 *
 * @throws {RangeError} 年齢が負の整数でない、所得が有限でないとき
 */
function assertDependent(relative: DependentRelative): void {
  if (!Number.isInteger(relative.age) || relative.age < 0) {
    throw new RangeError(`扶養親族の年齢は 0 以上の整数で指定してください: ${relative.age}`)
  }
  if (!Number.isFinite(relative.totalIncome)) {
    throw new RangeError(`扶養親族の所得が有限の数値ではありません: ${relative.totalIncome}`)
  }
}

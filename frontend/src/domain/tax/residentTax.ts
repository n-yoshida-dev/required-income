/**
 * 個人住民税（市町村民税 + 道府県民税）。前年の所得に対して翌年度に課される。
 *
 * 所得割は「（総所得金額等 − 所得控除）× 税率 − 調整控除」、均等割は定額（森林環境税を併せて徴収）。
 * どちらも非課税限度額以下なら掛からない。控除額は所得税と別の表（基礎控除 43 万円など）。
 *
 * **1 年のずれ**：この関数は「所得の年」を受け取り、その翌年度の税額を返す。年次モデルでは
 * 前年の所得から当年の住民税を出す持ち回りになる（SPEC §2.4）。
 *
 * **保育料用の所得割**：指定都市（市民税 8%）でも保育料の階層判定は 6% で計算し直した額を使い、
 * 調整控除は引いた後、税額控除（住宅ローン控除・ふるさと納税）は適用前。`childcareMunicipalIncomeLevy` に別で返す
 * （KNOWLEDGE.md 2026-09-14 の発見 4 点目）。
 *
 * **JSON に無い前提（計算側の判断。KNOWLEDGE.md 2026-09-15）：**
 * - 社会保険料控除は所得税と同じく支払額の全額（地方税法第 314 条の 2 第 1 項第 3 号）
 * - 裏取り済みでない自治体は標準税率（6% + 4%、均等割 4,000 円 + 森林環境税）で計算し、超過課税は無いものとする
 * - 年度の値が無い将来年度は最新の年度を延ばす。県・市の超過課税の終期（`resident-tax.json` の
 *   `prefectureSurcharges`・`municipalitySurcharges` の `untilFiscalYear`）も延長される前提で、
 *   `municipalities` に織り込み済みの率と額をそのまま使う
 * - 所得割の非課税限度額をわずかに超える人向けの「調整措置」（附則第 3 条の 3）は入れない
 * - 所得割の 100 円未満切捨てなど、JSON に無い端数処理は入れず円単位で計算する
 */

import { roundYen } from '../money'
import type {
  DependentRelative,
  MunicipalityCode,
  PersonalDeductionContext,
  ResidentTaxSplit,
  ResidentTaxTable,
  Year,
  Yen,
} from '../types'
import { assertNonNegativeYen, assertYear, pickBand, pickRange, roundDownTo } from './schedule'

/** 住民税を求める入力 */
export type ResidentTaxInput = {
  /** 所得の年。税額はこの翌年度のもの */
  incomeYear: Year
  /** 1 月 1 日時点の住所地の自治体コード */
  municipalityCode: MunicipalityCode
  /** 総所得金額等（合計所得金額と同じ扱い。分離課税は扱わない） */
  totalIncome: Yen
  /** その年に支払った社会保険料（本人負担ぶんの合計） */
  socialInsurancePaid: Yen
  personal: PersonalDeductionContext
}

/** 住民税の計算結果。市民税と県民税は分けて持つ（保育料は市民税の所得割で決まるため） */
export type ResidentTaxResult = {
  /** 課税年度（所得の年 + 1） */
  fiscalYear: Year
  /** 自治体の率と額が裏取り済みか。false なら標準税率で計算した */
  municipalityKnown: boolean
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
  exemptFromIncomeLevy: boolean
  exemptFromPerCapitaLevy: boolean
  /** 調整控除を引く前の所得割 */
  incomeLevyBeforeCredit: ResidentTaxSplit
  adjustmentCredit: ResidentTaxSplit
  /** 調整控除を引いた後の所得割（非課税なら 0） */
  incomeLevy: ResidentTaxSplit
  /** 均等割（非課税なら 0）。森林環境税は国税だが均等割と併せて徴収される */
  perCapitaLevy: ResidentTaxSplit & { forestEnvironmentTax: Yen }
  /** 納める住民税の合計（森林環境税を含む） */
  total: Yen
  /** 保育料の階層判定に使う市町村民税所得割額（6% 換算・調整控除後・税額控除前） */
  childcareMunicipalIncomeLevy: Yen
}

/**
 * 住民税を求める。
 *
 * @throws {RangeError} 年・金額が不正なとき、課税年度が表の対応範囲より前のとき
 */
export function residentTax(input: ResidentTaxInput, table: ResidentTaxTable): ResidentTaxResult {
  const { incomeYear, municipalityCode, totalIncome, socialInsurancePaid, personal } = input
  assertYear(incomeYear)
  if (!Number.isFinite(totalIncome)) {
    throw new RangeError(`総所得金額等が有限の数値ではありません: ${totalIncome}`)
  }
  assertNonNegativeYen(socialInsurancePaid, '社会保険料')
  for (const relative of personal.dependents) {
    assertDependent(relative)
  }

  const fiscalYear = incomeYear + 1
  if (fiscalYear < table.incomeRequirements.fromFiscalYear) {
    throw new RangeError(
      `住民税の表は ${table.incomeRequirements.fromFiscalYear} 年度からしかありません: ${fiscalYear} 年度`,
    )
  }

  const municipality = resolveMunicipality(municipalityCode, table)

  // --- 非課税判定（人数は同一生計配偶者 + 扶養親族。16 歳未満も数える） ---
  const familyCount = countSameHouseholdFamily(personal, table)
  const exemptFromPerCapitaLevy = totalIncome <= perCapitaNonTaxableThreshold(familyCount, table)
  const exemptFromIncomeLevy = totalIncome <= incomeLevyNonTaxableThreshold(familyCount, table)

  // --- 所得控除 ---
  const socialInsurance = roundYen(socialInsurancePaid)
  const basic = pickBand(
    table.basicDeduction.table,
    totalIncome,
    (row) => row.totalIncomeUpTo,
    '住民税の基礎控除',
  ).amount
  const spouse = residentTaxSpouseDeduction(totalIncome, personal.spouse, table)
  const dependents = residentTaxDependentDeductions(personal.dependents, fiscalYear, table)
  const deductionTotal =
    socialInsurance + basic + spouse + dependents.dependents + dependents.specifiedRelative

  // --- 所得割 ---
  const taxableIncome = roundDownTo(
    Math.max(0, totalIncome - deductionTotal),
    table.taxation.taxableIncomeRoundDownTo,
  )
  const incomeLevyBeforeCredit: ResidentTaxSplit = {
    municipal: roundYen(taxableIncome * municipality.incomeLevyRate.municipal),
    prefectural: roundYen(taxableIncome * municipality.incomeLevyRate.prefectural),
  }
  const creditBase = adjustmentCreditBase(totalIncome, taxableIncome, personal, table)
  const creditRates = municipality.designatedCity
    ? table.adjustmentCredit.rates.designatedCity
    : table.adjustmentCredit.rates.standard
  const adjustmentCredit: ResidentTaxSplit = {
    municipal: Math.min(
      roundYen(creditBase * creditRates.municipal),
      incomeLevyBeforeCredit.municipal,
    ),
    prefectural: Math.min(
      roundYen(creditBase * creditRates.prefectural),
      incomeLevyBeforeCredit.prefectural,
    ),
  }
  const incomeLevy: ResidentTaxSplit = exemptFromIncomeLevy
    ? { municipal: 0, prefectural: 0 }
    : {
        municipal: incomeLevyBeforeCredit.municipal - adjustmentCredit.municipal,
        prefectural: incomeLevyBeforeCredit.prefectural - adjustmentCredit.prefectural,
      }

  // --- 均等割 ---
  const perCapitaLevy = exemptFromPerCapitaLevy
    ? { municipal: 0, prefectural: 0, forestEnvironmentTax: 0 }
    : municipality.perCapitaLevy

  // --- 保育料用（6% 換算。調整控除は標準税率の市町村ぶん 3% で引く） ---
  const childcareBasis = table.childcareLevyBasis
  const childcareMunicipalIncomeLevy = exemptFromIncomeLevy
    ? 0
    : Math.max(
        0,
        roundYen(taxableIncome * childcareBasis.rate) -
          (childcareBasis.afterAdjustmentCredit
            ? roundYen(creditBase * table.adjustmentCredit.rates.standard.municipal)
            : 0),
      )

  const total =
    incomeLevy.municipal +
    incomeLevy.prefectural +
    perCapitaLevy.municipal +
    perCapitaLevy.prefectural +
    perCapitaLevy.forestEnvironmentTax

  return {
    fiscalYear,
    municipalityKnown: municipality.known,
    deductions: {
      socialInsurance,
      basic,
      spouse,
      dependents: dependents.dependents,
      specifiedRelative: dependents.specifiedRelative,
      total: deductionTotal,
    },
    taxableIncome,
    exemptFromIncomeLevy,
    exemptFromPerCapitaLevy,
    incomeLevyBeforeCredit,
    adjustmentCredit,
    incomeLevy,
    perCapitaLevy,
    total,
    childcareMunicipalIncomeLevy,
  }
}

/** 自治体ごとの率と額。裏取り済みでなければ標準税率 */
type ResolvedMunicipality = {
  known: boolean
  designatedCity: boolean
  incomeLevyRate: ResidentTaxSplit
  perCapitaLevy: ResidentTaxSplit & { forestEnvironmentTax: Yen }
}

/** 自治体コードから率と額を引く。無ければ標準税率・超過課税なし */
function resolveMunicipality(
  code: MunicipalityCode,
  table: ResidentTaxTable,
): ResolvedMunicipality {
  // JSON のオブジェクトをそのまま返さず、使う項目だけ組み立てる（JSON の補助項目を結果に混ぜない）
  const entry = table.municipalities[code]
  if (entry !== undefined) {
    return {
      known: true,
      designatedCity: entry.designatedCity,
      incomeLevyRate: {
        municipal: entry.incomeLevyRate.municipal,
        prefectural: entry.incomeLevyRate.prefectural,
      },
      perCapitaLevy: {
        municipal: entry.perCapitaLevy.municipal,
        prefectural: entry.perCapitaLevy.prefectural,
        forestEnvironmentTax: entry.perCapitaLevy.forestEnvironmentTax,
      },
    }
  }
  return {
    known: false,
    designatedCity: false,
    incomeLevyRate: {
      municipal: table.incomeLevy.standard.municipal,
      prefectural: table.incomeLevy.standard.prefectural,
    },
    perCapitaLevy: {
      municipal: table.perCapitaLevy.standard.municipal,
      prefectural: table.perCapitaLevy.standard.prefectural,
      forestEnvironmentTax: table.perCapitaLevy.forestEnvironmentTax.amount,
    },
  }
}

/** 非課税限度額の人数（同一生計配偶者と扶養親族。年齢は問わない） */
function countSameHouseholdFamily(
  personal: PersonalDeductionContext,
  table: ResidentTaxTable,
): number {
  const { incomeRequirements } = table
  const spouseCount =
    personal.spouse !== null &&
    personal.spouse.totalIncome <= incomeRequirements.sameHouseholdSpouseTotalIncomeUpTo
      ? 1
      : 0
  const dependentCount = personal.dependents.filter(
    (relative) => relative.totalIncome <= incomeRequirements.dependentTotalIncomeUpTo,
  ).length
  return spouseCount + dependentCount
}

/** 均等割の非課税限度額。基本額と加算額に級地の率を掛ける（1 級地は 1.0） */
function perCapitaNonTaxableThreshold(familyCount: number, table: ResidentTaxTable): Yen {
  const { perCapita, levelClassCoefficient } = table.nonTaxableThreshold
  const base = perCapita.base * levelClassCoefficient
  if (familyCount === 0) {
    return roundYen(base + perCapita.flatAddition)
  }
  return roundYen(
    base * (familyCount + 1) +
      perCapita.flatAddition +
      perCapita.dependentAddition * levelClassCoefficient,
  )
}

/** 所得割の非課税限度額。全国一律（級地の率は掛からない） */
function incomeLevyNonTaxableThreshold(familyCount: number, table: ResidentTaxTable): Yen {
  const { incomeLevy } = table.nonTaxableThreshold
  if (familyCount === 0) {
    return incomeLevy.base + incomeLevy.flatAddition
  }
  return (
    incomeLevy.base * (familyCount + 1) + incomeLevy.flatAddition + incomeLevy.dependentAddition
  )
}

/**
 * 納税者本人の合計所得が入る帯の添字（900 万円以下 / 950 万円以下 / 1,000 万円以下）。
 * 上限を超えるなら null（配偶者控除・配偶者特別控除とも適用なし）。
 */
function payerBracketIndex(payerTotalIncome: Yen, table: ResidentTaxTable): number | null {
  const index = table.spouseSpecialDeduction.payerBrackets.findIndex(
    (upTo) => payerTotalIncome <= upTo,
  )
  return index === -1 ? null : index
}

/** 配偶者控除または配偶者特別控除（住民税の額） */
function residentTaxSpouseDeduction(
  payerTotalIncome: Yen,
  spouse: PersonalDeductionContext['spouse'],
  table: ResidentTaxTable,
): Yen {
  if (spouse === null) {
    return 0
  }
  const { spouseDeduction, spouseSpecialDeduction } = table
  const bracket = payerBracketIndex(payerTotalIncome, table)
  if (bracket === null) {
    return 0
  }

  if (spouse.totalIncome <= spouseDeduction.spouseTotalIncomeUpTo) {
    const row = spouseDeduction.table[bracket]
    if (row === undefined) {
      throw new RangeError(`住民税の配偶者控除の表に ${bracket + 1} 番目の帯がありません`)
    }
    return spouse.age >= spouseDeduction.elderlyAgeFrom ? row.elderlyAmount : row.amount
  }

  const band = pickRange(spouseSpecialDeduction.table, spouse.totalIncome, (row) => ({
    over: row.spouseTotalIncomeOver,
    upTo: row.spouseTotalIncomeUpTo,
  }))
  return band?.amounts[bracket] ?? 0
}

/** 扶養控除と特定親族特別控除（住民税の額） */
function residentTaxDependentDeductions(
  dependents: readonly DependentRelative[],
  fiscalYear: Year,
  table: ResidentTaxTable,
): { dependents: Yen; specifiedRelative: Yen } {
  const { dependentDeduction, specifiedRelativeSpecialDeduction } = table
  const { ages } = dependentDeduction
  // 特定親族の年齢区分と適用開始年度は、扶養控除の表ではなく特定親族特別控除の項目から読む
  // （今は同じ 19〜22 歳だが、片方だけ改正されたときに黙ってずれないようにする）
  const specifiedRelativeApplies = fiscalYear >= specifiedRelativeSpecialDeduction.fromFiscalYear

  let dependentTotal = 0
  let specifiedRelativeTotal = 0
  for (const relative of dependents) {
    const isSpecificAge =
      ages.specificFromAge <= relative.age && relative.age < ages.specificBelowAge
    const isSpecifiedRelativeAge =
      specifiedRelativeSpecialDeduction.relativeAgeFrom <= relative.age &&
      relative.age < specifiedRelativeSpecialDeduction.relativeAgeUnder

    if (relative.totalIncome <= dependentDeduction.dependentTotalIncomeUpTo) {
      if (relative.age >= ages.elderlyFromAge) {
        dependentTotal +=
          relative.cohabitingLinealAscendant === true
            ? dependentDeduction.elderlyCohabitingLinealAscendant
            : dependentDeduction.elderly
      } else if (isSpecificAge) {
        dependentTotal += dependentDeduction.specific
      } else if (relative.age >= ages.controlledDependentFromAge) {
        dependentTotal += dependentDeduction.general
      }
      continue
    }

    if (isSpecifiedRelativeAge && specifiedRelativeApplies) {
      const band = pickRange(
        specifiedRelativeSpecialDeduction.table,
        relative.totalIncome,
        (row) => ({
          over: row.relativeTotalIncomeOver,
          upTo: row.relativeTotalIncomeUpTo,
        }),
      )
      specifiedRelativeTotal += band?.amount ?? 0
    }
  }
  return { dependents: dependentTotal, specifiedRelative: specifiedRelativeTotal }
}

/**
 * 調整控除の基礎額（これに市民税・県民税の率を掛ける）。
 *
 * 人的控除の差の合計（基礎控除の 5 万円は常に入る）を、課税所得 200 万円以下なら課税所得との小さい方、
 * 200 万円超なら「差の合計 − (課税所得 − 200 万円)」と 5 万円の大きい方にする。合計所得 2,500 万円超は 0。
 *
 * 配偶者特別控除ぶんの差は、2026 年度以降の所得要件（58 万円超）では JSON の帯（55 万円未満）に入る配偶者が
 * 存在しないため 0 として扱う。特定親族特別控除ぶんの差は JSON に無いので 0。
 */
function adjustmentCreditBase(
  totalIncome: Yen,
  taxableIncome: Yen,
  personal: PersonalDeductionContext,
  table: ResidentTaxTable,
): Yen {
  const { adjustmentCredit, spouseDeduction, dependentDeduction } = table
  if (totalIncome > adjustmentCredit.applicableTotalIncomeUpTo) {
    return 0
  }
  const diff = adjustmentCredit.personalDeductionDifference
  let difference = diff.basic

  const bracket = payerBracketIndex(totalIncome, table)
  if (
    personal.spouse !== null &&
    bracket !== null &&
    personal.spouse.totalIncome <= spouseDeduction.spouseTotalIncomeUpTo
  ) {
    const byPayer =
      personal.spouse.age >= spouseDeduction.elderlyAgeFrom
        ? diff.elderlyDeductibleSpouse
        : diff.deductibleSpouse
    const amounts = [
      byPayer.payerIncomeUpTo9000000,
      byPayer.payerIncomeUpTo9500000,
      byPayer.payerIncomeUpTo10000000,
    ]
    difference += amounts[bracket] ?? 0
  }

  const { ages } = dependentDeduction
  for (const relative of personal.dependents) {
    if (relative.totalIncome > dependentDeduction.dependentTotalIncomeUpTo) {
      continue
    }
    if (relative.age >= ages.elderlyFromAge) {
      difference +=
        relative.cohabitingLinealAscendant === true
          ? diff.dependentElderlyCohabitingLinealAscendant
          : diff.dependentElderly
    } else if (ages.specificFromAge <= relative.age && relative.age < ages.specificBelowAge) {
      difference += diff.dependentSpecific
    } else if (relative.age >= ages.controlledDependentFromAge) {
      difference += diff.dependentGeneral
    }
  }

  if (taxableIncome <= adjustmentCredit.taxableIncomeThreshold) {
    return Math.min(difference, taxableIncome)
  }
  return Math.max(
    difference - (taxableIncome - adjustmentCredit.taxableIncomeThreshold),
    adjustmentCredit.minimumBaseAboveThreshold,
  )
}

/**
 * 扶養親族の候補の入力を検証する（所得税側と同じ基準）。
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

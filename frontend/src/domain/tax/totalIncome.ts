/**
 * 1 人ぶんの所得を種類ごとに整えて合算し、合計所得金額を出す（所得税・住民税・国保に共通の入口）。
 *
 * 流れは「青色申告特別控除を引く → 雑所得の赤字を切り捨てる → 損益通算（赤字の事業・不動産を他の所得と相殺）」。
 *
 * - **青色申告特別控除**は不動産所得 → 事業所得の順に、黒字の範囲まで引く。赤字を膨らませることはできない
 * - **副業を雑所得で申告する場合**は特別控除が無く、赤字は他の所得と相殺できない（0 として扱う）
 * - 事業所得・不動産所得の赤字は、給与所得など他の所得から引ける（損益通算）
 *
 * **JSON に無い前提（計算側の判断。KNOWLEDGE.md 2026-09-18）：**
 * - 65 万円・55 万円の控除の要件（事業的規模・複式簿記・e-Tax）は判定しない。申告方式の入力を信じる
 * - 不動産所得の赤字のうち土地の借入金利子ぶんは損益通算できない特例（措法 41 条の 4）は入れない
 * - 通算しきれない赤字（純損失）の翌年以降への繰越控除は入れない。合計所得金額は 0 で止め、赤字の額を別に返す
 *   （翌年以降の税を多めに見積もる安全側）
 */

import type { FilingType, IncomeTaxTable, Yen } from '../types'

/** 1 人ぶんの所得の材料。金額はすべて「収入 − 必要経費」（給与だけは給与所得控除後） */
export type IncomeComponents = {
  /** 給与所得（給与所得控除後）。給与が無ければ 0 */
  employmentIncome: Yen
  /** 事業所得（青色申告特別控除前）。赤字は負。事業として申告する副業はここに足してから渡す */
  businessProfit: Yen
  /** 不動産所得（青色申告特別控除前）。赤字は負 */
  realEstateProfit: Yen
  /** 雑所得として申告する副業（収入 − 経費）。赤字は負で渡してよい（0 として扱う） */
  miscellaneousProfit: Yen
  /** 申告方式。事業をしていない人は null（白色と同じく控除なし） */
  filingType: FilingType | null
}

/** 合算の結果。内訳は表示と検算のために持つ */
export type TotalIncomeResult = {
  employmentIncome: Yen
  /** 青色申告特別控除後の事業所得（赤字は負のまま） */
  businessIncome: Yen
  /** 青色申告特別控除後の不動産所得（赤字は負のまま） */
  realEstateIncome: Yen
  /** 雑所得（赤字は 0） */
  miscellaneousIncome: Yen
  blueReturnDeduction: { realEstate: Yen; business: Yen; total: Yen }
  /** 合計所得金額（損益通算後。0 未満にはならない） */
  totalIncome: Yen
  /** 損益通算しても残った赤字（純損失）。無ければ 0 */
  netLoss: Yen
}

/**
 * 合計所得金額を求める。
 *
 * @throws {RangeError} 金額が有限でない、給与所得が負のとき
 */
export function totalIncomeOf(
  components: IncomeComponents,
  table: IncomeTaxTable,
): TotalIncomeResult {
  const { employmentIncome, businessProfit, realEstateProfit, miscellaneousProfit, filingType } =
    components
  for (const [label, amount] of [
    ['給与所得', employmentIncome],
    ['事業所得', businessProfit],
    ['不動産所得', realEstateProfit],
    ['雑所得', miscellaneousProfit],
  ] as const) {
    if (!Number.isFinite(amount)) {
      throw new RangeError(`${label}が有限の数値ではありません: ${amount}`)
    }
  }
  if (employmentIncome < 0) {
    throw new RangeError(`給与所得は 0 以上で指定してください: ${employmentIncome}`)
  }

  // 青色申告特別控除：不動産所得 → 事業所得の順に、黒字の範囲まで
  if (!table.blueReturnDeduction.limitedToIncome) {
    // 「所得が限度」でない表は、赤字のときの引き方が決まらないので黙って計算しない
    throw new RangeError('青色申告特別控除が所得を限度としない表には未対応です')
  }
  const limit = blueReturnDeductionLimit(filingType, table)
  const realEstateDeduction = Math.min(limit, Math.max(0, realEstateProfit))
  const businessDeduction = Math.min(limit - realEstateDeduction, Math.max(0, businessProfit))

  const businessIncome = businessProfit - businessDeduction
  const realEstateIncome = realEstateProfit - realEstateDeduction
  const miscellaneousIncome = Math.max(0, miscellaneousProfit)

  const combined = employmentIncome + businessIncome + realEstateIncome + miscellaneousIncome

  return {
    employmentIncome,
    businessIncome,
    realEstateIncome,
    miscellaneousIncome,
    blueReturnDeduction: {
      realEstate: realEstateDeduction,
      business: businessDeduction,
      total: realEstateDeduction + businessDeduction,
    },
    totalIncome: Math.max(0, combined),
    netLoss: Math.max(0, -combined),
  }
}

/** 申告方式に対応する青色申告特別控除の上限額。白色・事業なしは 0 */
function blueReturnDeductionLimit(filingType: FilingType | null, table: IncomeTaxTable): Yen {
  switch (filingType) {
    case 'blue65':
      return table.blueReturnDeduction.blue65
    case 'blue55':
      return table.blueReturnDeduction.blue55
    case 'blue10':
      return table.blueReturnDeduction.blue10
    case 'white':
    case null:
      return 0
  }
}

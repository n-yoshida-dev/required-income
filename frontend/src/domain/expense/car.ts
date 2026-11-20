/**
 * 車の費用の年次展開。**買い替えの周期で大型支出が繰り返し発生する。**
 *
 * 住宅と違って一度きりではないため、周期の山が他のライフイベント
 * （住宅購入・大学入学）と重なった年が資金繰りの谷になる。
 * 平らに均さず、購入年に立てたまま返す。
 *
 * 購入に関わる金額（車両価格・頭金・借入額・下取り額）は名目で固定し、
 * 維持費と購入前の移動費だけインフレで逓増させる。
 * 「次も同じくらいの価格帯の車に乗り替える」という入力の意図に合わせるため。
 * 価格だけ上げると、名目で固定される頭金・借入額と辻褄が合わなくなる。
 */

import { roundYen, sumYen } from '../money'
import type { Car, Rate, Year, Yen } from '../types'
import { annualLoanRepayment } from './loan'

/** ある年の車の費用の内訳 */
export type CarCost = {
  year: Year
  /** 維持費（税・保険・車検・燃料・駐車場）。購入前はカーシェア等の移動費 */
  upkeep: Yen
  /** 車のローン返済。買い替えでローンが重なれば合算する */
  loanRepayment: Yen
  /** 頭金（買い替え時は下取り額を差し引いたあと）。購入年だけ計上する */
  lumpSum: Yen
  /** 上記の合計 */
  total: Yen
}

/**
 * 入力の検査。
 *
 * @throws {RangeError} 買い替え周期が正の整数でない、下取り率が 0〜1 の外のとき
 */
function assertValidCar(car: Car): void {
  if (!Number.isInteger(car.firstPurchaseYear)) {
    throw new RangeError(`最初の購入年は整数で指定してください: ${car.firstPurchaseYear}`)
  }
  if (!Number.isInteger(car.replacementCycleYears) || car.replacementCycleYears <= 0) {
    throw new RangeError(
      `買い替え周期は 1 以上の整数で指定してください: ${car.replacementCycleYears}`,
    )
  }
  if (!Number.isFinite(car.resaleRate) || car.resaleRate < 0 || car.resaleRate > 1) {
    throw new RangeError(`下取り率は 0〜1 で指定してください: ${car.resaleRate}`)
  }
  if (!Number.isFinite(car.price) || car.price < 0) {
    throw new RangeError(`車両価格は 0 以上の有限の数値で指定してください: ${car.price}`)
  }
  if (!Number.isFinite(car.downPayment) || car.downPayment < 0) {
    throw new RangeError(`頭金は 0 以上の有限の数値で指定してください: ${car.downPayment}`)
  }
}

/** その年が購入（または買い替え）の年か */
export function isPurchaseYear(car: Car, year: Year): boolean {
  assertValidCar(car)

  if (year < car.firstPurchaseYear) {
    return false
  }
  return (year - car.firstPurchaseYear) % car.replacementCycleYears === 0
}

/**
 * その年までに行った購入の年を古い順に返す。
 *
 * **起点年より前の購入も含める。** 既に保有している車のローンが
 * まだ残っていることがあるため（`firstPurchaseYear` に過去の年を入れる運用）。
 */
export function purchaseYearsUpTo(car: Car, year: Year): readonly Year[] {
  assertValidCar(car)

  const years: Year[] = []
  for (
    let purchaseYear = car.firstPurchaseYear;
    purchaseYear <= year;
    purchaseYear += car.replacementCycleYears
  ) {
    years.push(purchaseYear)
  }
  return years
}

/**
 * 買い替え時に実際に出ていく額。
 *
 * ```
 * 頭金 − 下取り額（＝車両価格 × 下取り率）
 * ```
 *
 * **最初の購入では下取りが無いので頭金の全額。**
 * 下取り額が頭金を上回っても、その差額を収入にはせず 0 で止める。
 * 実務では超過分がローン残債の相殺に回り、現金で戻ることは稀なため。
 */
export function carPurchaseLumpSum(car: Car, purchaseYear: Year): Yen {
  assertValidCar(car)

  if (purchaseYear === car.firstPurchaseYear) {
    return roundYen(car.downPayment)
  }
  return roundYen(Math.max(car.downPayment - car.price * car.resaleRate, 0))
}

/**
 * 買い替えに備えて毎年いくら積み立てておけばよいか。
 *
 * ```
 * （頭金 − 下取り額）÷ 買い替え周期
 * ```
 *
 * **これは入力ではなく出力である。** 積立は資産の置き場所を分けているだけで、
 * 世帯の外へ出ていくお金ではない。支出として計上すると、
 * 買い替えの持ち出しと二重に数えることになる。
 *
 * 資金繰りの上では「買い替えの年までに資産がこの額ぶん増えているか」を見れば足り、
 * それは資産残高の推移で判定できる（`GoalKind` の `carDownPayment`）。
 * この関数が返すのは、利用者に見せる目安の額。
 */
export function requiredAnnualReplacementSaving(car: Car): Yen {
  assertValidCar(car)

  const nextPurchaseCost = Math.max(car.downPayment - car.price * car.resaleRate, 0)
  return roundYen(nextPurchaseCost / car.replacementCycleYears)
}

/**
 * ある年の車の費用。
 *
 * 購入前はカーシェア・レンタカー等の移動費を計上する。
 * **購入すると移動費が維持費に置き換わる。** 車を持つことの追加負担は
 * 維持費の全額ではなく差額なので、両方を同じ枠で扱う。
 *
 * @param baseYear 計算の起点となる年。維持費・移動費はこの年の金額
 * @throws {RangeError} `year` が `baseYear` より前、またはインフレ率が不正なとき
 */
export function carCostInYear(car: Car, inflationRate: Rate, baseYear: Year, year: Year): CarCost {
  assertValidCar(car)

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
  const owned = year >= car.firstPurchaseYear

  const upkeep = roundYen(
    (owned ? car.annualUpkeep : car.annualPrePurchaseMobilityCost) * priceIndex,
  )

  // 買い替え周期がローンの返済年数より短いと返済が重なる。合算する
  const { loan } = car
  const loanRepayment =
    loan === null
      ? 0
      : sumYen(
          purchaseYearsUpTo(car, year).map((purchaseYear) =>
            annualLoanRepayment(loan, purchaseYear, year),
          ),
        )

  const lumpSum = isPurchaseYear(car, year) ? carPurchaseLumpSum(car, year) : 0

  return {
    year,
    upkeep,
    loanRepayment,
    lumpSum,
    total: sumYen([upkeep, loanRepayment, lumpSum]),
  }
}

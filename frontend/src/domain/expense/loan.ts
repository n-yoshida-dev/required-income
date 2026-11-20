/**
 * 元利均等返済のローン計算。
 *
 * 住宅ローンと車のローンで同じ式を使うため、`housing.ts` / `car.ts` から共通で参照する。
 *
 * **返済額は名目で固定される。** 生活費と違ってインフレで増えないため、
 * 物価が上がるほど実質的な負担は軽くなる。この非対称が年次モデルの肝になるので、
 * 呼び出し側で返済額にインフレ率を掛けないこと。
 */

import { roundYen } from '../money'
import type { LoanTerms, Year, Yen } from '../types'

/** 返済の総回数（月数） */
function totalPayments(loan: LoanTerms): number {
  return loan.years * 12
}

/**
 * 入力の検査。契約違反（呼び出し側のバグ）なので例外を投げる。
 *
 * @throws {RangeError} 借入額が負、返済年数が正の整数でない、金利が負のとき
 */
function assertValidLoan(loan: LoanTerms): void {
  if (!Number.isFinite(loan.principal) || loan.principal < 0) {
    throw new RangeError(`借入額は 0 以上の有限の数値で指定してください: ${loan.principal}`)
  }
  if (!Number.isInteger(loan.years) || loan.years <= 0) {
    throw new RangeError(`返済年数は 1 以上の整数で指定してください: ${loan.years}`)
  }
  if (!Number.isFinite(loan.annualRate) || loan.annualRate < 0) {
    throw new RangeError(`金利は 0 以上の有限の数値で指定してください: ${loan.annualRate}`)
  }
}

/**
 * 毎月の返済額（元利均等）。
 *
 * ```
 * 月額 = 借入額 × 月利 × (1 + 月利)^回数 / ((1 + 月利)^回数 − 1)
 * ```
 *
 * 金利 0 なら単純に借入額 ÷ 回数。
 *
 * **円単位に丸めた額を返す。** 実際に口座から出るのが丸めた額であり、
 * 残高計算もこの額を前提にする（丸めない額と混ぜると残高がずれる）。
 * 実務では端数を最終回で調整するが、フェーズ1では毎月同額として扱う。
 */
export function monthlyLoanPayment(loan: LoanTerms): Yen {
  assertValidLoan(loan)

  const count = totalPayments(loan)
  if (loan.annualRate === 0) {
    return roundYen(loan.principal / count)
  }

  const monthlyRate = loan.annualRate / 12
  const growth = Math.pow(1 + monthlyRate, count)

  return roundYen((loan.principal * monthlyRate * growth) / (growth - 1))
}

/**
 * ある年の返済額。返済期間の外は 0。
 *
 * 返済は `startYear` から `loan.years` 年間続く。
 * 借入年と完済年を月割りしないのはフェーズ1の簡略化で、
 * 借入月を入力に持たないため（`HomePurchase` は年しか持たない）。
 *
 * @param startYear 返済を開始する年（＝購入年）
 */
export function annualLoanRepayment(loan: LoanTerms, startYear: Year, year: Year): Yen {
  assertValidLoan(loan)

  if (year < startYear || year >= startYear + loan.years) {
    return 0
  }
  return roundYen(monthlyLoanPayment(loan) * 12)
}

/**
 * 年末時点のローン残高。
 *
 * ```
 * 残高 = 借入額 × (1 + 月利)^経過月数 − 月額 × ((1 + 月利)^経過月数 − 1) / 月利
 * ```
 *
 * 純資産（保有不動産の評価額 − 残債）を出すのに使う。
 *
 * 月額を円単位に丸めている都合で、完済時点の残高がちょうど 0 にならず
 * わずかな端数が残ることがある。**負にはせず 0 で止める。**
 */
export function remainingLoanBalance(loan: LoanTerms, startYear: Year, year: Year): Yen {
  assertValidLoan(loan)

  if (year < startYear) {
    return roundYen(loan.principal)
  }

  const count = totalPayments(loan)
  // 借入年の年末で1年ぶん（12回）返済が済んでいるものとして数える
  const paidMonths = Math.min((year - startYear + 1) * 12, count)
  const payment = monthlyLoanPayment(loan)

  if (loan.annualRate === 0) {
    return roundYen(Math.max(loan.principal - payment * paidMonths, 0))
  }

  const monthlyRate = loan.annualRate / 12
  const growth = Math.pow(1 + monthlyRate, paidMonths)
  const balance = loan.principal * growth - (payment * (growth - 1)) / monthlyRate

  return roundYen(Math.max(balance, 0))
}

/**
 * 返済の総額（元金 + 利息）。
 *
 * 「借入額いくらに対して総額いくら払うのか」を利用者に見せるために使う。
 * 期間の途中で繰上げ返済することは、フェーズ1では扱わない。
 */
export function totalLoanRepayment(loan: LoanTerms): Yen {
  assertValidLoan(loan)
  return roundYen(monthlyLoanPayment(loan) * totalPayments(loan))
}

/**
 * 大学資金・老後資金のカードの積立の式（SPEC §3.2「使い回す関数」の「積立の月額」）。
 *
 * 前の版の `goal/savings.ts` の `annuityFactor`（期末に 1 を積む年金終価係数）を、年を月に読み替えて使う：
 *
 * ```
 * 月の利率 i = (1 + 年の利回り)^(1/12) − 1         預金は 0
 * 月数 n     = 起点の月から使う月の前まで
 * 到達額     = 貯まっている額 × (1 + i)^n                         … 今ある額が使う月まで育つ
 *            + Σ 児童手当の月額(m) × (1 + i)^(n − 1 − m)          … m 月目の末に積む（m = 0 … n − 1）
 *            + 家計から足す月額 × annuityFactor(i, n)              … 毎月末に同じ額を積む
 * 家計から足す月額 = ⌈（目標額 − 貯まっている額と児童手当の到達額）÷ annuityFactor(i, n)⌉   届いていれば 0
 * ```
 *
 * 児童手当と貯まっている額は先に使う月の価値に直して目標額から引く（`solveHouseholdContribution` と同じ考え方。段階積立は使わない）。
 * 月額を切り上げるので、解いた月額で積めば目標額に必ず届き、1 円少なければ届かない。
 * 毎月末に積む（`annuityFactor` と同じ期末の積み方）。前の版の年単位の積立線（年末に 1 年分）より月の分だけ早く育つ。
 */

import { annuityFactor } from '../../goal/savings'
import { roundYen, sumYen } from '../../money'
import type { FundPlan, Rate, Yen } from '../types'

/** 年の利回りを月の利率に直す（`(1 + r)^(1/12) − 1`）。−100% 以下は契約違反 */
export function monthlyRateOf(annualRate: Rate): number {
  if (!Number.isFinite(annualRate) || annualRate <= -1) {
    throw new RangeError(`利回りが正しくありません: ${annualRate}`)
  }
  return annualRate === 0 ? 0 : Math.pow(1 + annualRate, 1 / 12) - 1
}

/** 積立の前提（月の単位） */
export type FundTerms = {
  /** 月数（起点の月から使う月の前まで）。1 以上 */
  months: number
  /** 月の利率 */
  monthlyRate: number
  /** すでに貯まっている額 */
  saved: Yen
  /** 児童手当から回す月額の並び（0 月目から。長さは `months` 以下。足りない月は 0） */
  allowanceMonthly: readonly Yen[]
}

/** 使う月の時点の到達額の内訳を、家計から足す月額から出す（円に四捨五入。合計は内訳の和） */
export function fundReached(terms: FundTerms, householdMonthly: Yen): FundPlan['reached'] {
  assertTerms(terms)
  if (!Number.isInteger(householdMonthly) || householdMonthly < 0) {
    throw new RangeError(
      `家計から足す月額は 0 以上の円の整数で指定してください: ${householdMonthly}`,
    )
  }
  const saved = roundYen(savedValue(terms))
  const allowance = roundYen(allowanceValue(terms))
  const household = roundYen(householdMonthly * annuityFactor(terms.monthlyRate, terms.months))
  return { saved, allowance, household, total: sumYen([saved, allowance, household]) }
}

/**
 * 目標額に届く家計から足す月額を解く。貯まっている額と児童手当だけで届くなら 0。
 * 1 円未満は切り上げる（使う月に数円届かない、を起こさない）
 */
export function solveHouseholdMonthly(terms: FundTerms, target: Yen): Yen {
  assertTerms(terms)
  if (!Number.isInteger(target) || target < 0) {
    throw new RangeError(`目標額は 0 以上の円の整数で指定してください: ${target}`)
  }
  const remaining = target - savedValue(terms) - allowanceValue(terms)
  if (remaining <= 0) return 0
  return Math.ceil(remaining / annuityFactor(terms.monthlyRate, terms.months))
}

/** 貯まっている額の、使う月の時点の価値（丸める前） */
function savedValue(terms: FundTerms): number {
  return terms.saved * Math.pow(1 + terms.monthlyRate, terms.months)
}

/** 児童手当から回す分の、使う月の時点の価値（丸める前）。m 月目の末に積むので n − 1 − m か月育つ */
function allowanceValue(terms: FundTerms): number {
  let total = 0
  terms.allowanceMonthly.forEach((amount, month) => {
    total += amount * Math.pow(1 + terms.monthlyRate, terms.months - 1 - month)
  })
  return total
}

/** 前提が契約どおりかを確かめる */
function assertTerms(terms: FundTerms): void {
  if (!Number.isInteger(terms.months) || terms.months < 1) {
    throw new RangeError(`積み立てる月数は 1 以上の整数で指定してください: ${terms.months}`)
  }
  if (!Number.isFinite(terms.monthlyRate) || terms.monthlyRate <= -1) {
    throw new RangeError(`月の利率が正しくありません: ${terms.monthlyRate}`)
  }
  if (!Number.isInteger(terms.saved) || terms.saved < 0) {
    throw new RangeError(`貯まっている額は 0 以上の円の整数で指定してください: ${terms.saved}`)
  }
  if (terms.allowanceMonthly.length > terms.months) {
    throw new RangeError(
      `児童手当の月の並び（${terms.allowanceMonthly.length}）が積み立てる月数（${terms.months}）より長いです`,
    )
  }
  for (const amount of terms.allowanceMonthly) {
    if (!Number.isInteger(amount) || amount < 0) {
      throw new RangeError(`児童手当の月額は 0 以上の円の整数で指定してください: ${amount}`)
    }
  }
}

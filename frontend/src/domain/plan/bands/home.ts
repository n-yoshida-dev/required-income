/**
 * 家のカード → 帯（SPEC §3.2 の `home`）。
 *
 * 買う月は `purchaseYear` の 1 月とみなす（SPEC §2.1）。
 *
 * - 「頭金と諸費用の積立」`saving`：起点から買う月の前まで（預金。利回りなし）。
 *   （頭金 ＋ 諸費用 − すでに貯まっている額）を残りの月で割り、1 円未満は切り上げる（自由入力の一度きりと同じ）
 * - 「返済」`payment`：買う月から `loanYears` 年のあいだ。借りる額は 価格 − 頭金。月額は `monthlyLoanPayment`（物価を掛けない。D11・D12）
 * - 「修繕と税」`payment`：買う月から「ずっと」の終わりまで。物価を掛ける（SPEC §3.4 の維持費）
 *
 * 買う月が起点の月以前（もう買った・起点の年の 1 月に買う）なら、積立の帯は出さない。返済の帯は買う月から数え
 * （起点より前の月は `yearlyNeeds` が数えないので、残りの返済だけが要る手取りに入る）、修繕と税は起点から出す。
 */

import { monthlyLoanPayment } from '../../expense/loan'
import { roundYen } from '../../money'
import type { Band, BandContext, HomeGoal, Rate, Yen, YearMonth } from '../types'
import { addMonths, compareYearMonth, laterOf, monthsBetween, startOfYear } from '../yearMonth'
import { assertNonNegativeYen, makeBand } from './band'
import { inflatedBands } from './inflation'

/** 帯の名前（画面にそのまま出る） */
export const HOME_BAND_LABELS = {
  saving: '頭金と諸費用の積立',
  repayment: '返済',
  upkeep: '修繕と税',
} as const

/** 買う月（`purchaseYear` の 1 月） */
export function homePurchaseMonth(goal: Pick<HomeGoal, 'purchaseYear'>): YearMonth {
  return startOfYear(goal.purchaseYear)
}

/** 借りる額（価格 − 頭金） */
export function homeLoanPrincipal(goal: Pick<HomeGoal, 'price' | 'downPayment'>): Yen {
  return goal.price - goal.downPayment
}

/** 頭金と諸費用（買う月の前までに用意する額）。諸費用は 価格 × 率 を円に四捨五入 */
export function homeUpfrontCost(
  goal: Pick<HomeGoal, 'price' | 'downPayment'>,
  closingCostRate: Rate,
): Yen {
  return goal.downPayment + roundYen(goal.price * closingCostRate)
}

/**
 * 家のカードの入力が契約どおりかを確かめる。違えば投げる。
 * 金額は 0 以上の整数、頭金は価格以下、ローンの年数は 1 以上の整数、買う年は整数
 */
export function assertHomeGoal(goal: HomeGoal): void {
  assertNonNegativeYen(goal.price, '家の価格')
  assertNonNegativeYen(goal.downPayment, '家の頭金')
  assertNonNegativeYen(goal.monthlyUpkeep, '家の毎月の維持費')
  assertNonNegativeYen(goal.saved, '家の貯まっている額')
  if (goal.downPayment > goal.price) {
    throw new RangeError(`家の頭金（${goal.downPayment}）が価格（${goal.price}）を超えています`)
  }
  if (!Number.isInteger(goal.loanYears) || goal.loanYears < 1) {
    throw new RangeError(`ローンの年数は 1 以上の整数で指定してください: ${goal.loanYears}`)
  }
  if (!Number.isInteger(goal.purchaseYear)) {
    throw new RangeError(`家を買う年は整数で指定してください: ${goal.purchaseYear}`)
  }
}

/** 家のカード 1 枚を帯に直す。オン・オフは呼び出し側（`expandGoal`）が見る */
export function homeBands(goal: HomeGoal, ctx: BandContext): Band[] {
  assertHomeGoal(goal)
  const closingCostRate = ctx.settings.homeClosingCostRate
  if (!Number.isFinite(closingCostRate) || closingCostRate < 0) {
    throw new RangeError(`家の諸費用の率は 0 以上の数で指定してください: ${closingCostRate}`)
  }
  const purchase = homePurchaseMonth(goal)
  const bands: Band[] = []

  // 頭金と諸費用の積立：買う月まで月がある時だけ。貯まっている額で足りていれば 0 円の帯（足りていることが読める）
  const months = monthsBetween(ctx.base, purchase)
  if (months > 0) {
    const shortfall = Math.max(0, homeUpfrontCost(goal, closingCostRate) - goal.saved)
    bands.push(
      makeBand({
        goalId: goal.id,
        label: HOME_BAND_LABELS.saving,
        kind: 'saving',
        monthly: Math.ceil(shortfall / months),
        from: ctx.base,
        to: purchase,
      }),
    )
  }

  // 返済：借りる額が 0（頭金で全額払う）なら出さない。金利は前提の値で、物価は掛けない
  const principal = homeLoanPrincipal(goal)
  if (principal > 0) {
    bands.push(
      makeBand({
        goalId: goal.id,
        label: HOME_BAND_LABELS.repayment,
        kind: 'payment',
        monthly: monthlyLoanPayment({
          principal,
          years: goal.loanYears,
          annualRate: ctx.assumptions.mortgageRate,
        }),
        from: purchase,
        to: addMonths(purchase, goal.loanYears * 12),
      }),
    )
  }

  // 修繕と税：買う月（もう買っていれば起点）から「ずっと」の終わりまで。物価を掛ける
  const upkeepFrom = laterOf(purchase, ctx.base)
  if (compareYearMonth(upkeepFrom, ctx.until) < 0) {
    bands.push(
      ...inflatedBands(
        { goalId: goal.id, label: HOME_BAND_LABELS.upkeep, kind: 'payment' },
        goal.monthlyUpkeep,
        ctx.assumptions.inflationRate,
        upkeepFrom,
        ctx.until,
        ctx.base.year,
      ),
    )
  }
  return bands
}

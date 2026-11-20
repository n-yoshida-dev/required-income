/**
 * 車のカード → 帯（SPEC §3.2 の `car`）。
 *
 * 買う月は `purchaseYear` の 1 月とみなす（SPEC §2.1）。
 *
 * - 現金：「車の積立」`saving`。起点から買う月の前まで（預金。利回りなし）。（価格 − すでに貯まっている額）を残りの月で割り、1 円未満は切り上げる
 * - ローン：「返済」`payment`。買う月から `payment.years` 年のあいだ。借りる額は価格の全部、金利はアプリの既定値の車のローンの金利、
 *   月額は `monthlyLoanPayment`（住宅ローンと同じ式。物価を掛けない。D11・D12）。`saved` は使わない
 * - 「維持費」`payment`：買う月から「ずっと」の終わりまで。物価を掛ける（SPEC §3.4）
 * - 「次の車の積立」`saving`：買い替えるときだけ。買う月から「ずっと」の終わりまで、
 *   （価格 − 下取りの額）÷ 買い替えまでの月数（1 円未満は切り上げ）。物価は掛けない（車の代金は名目で固定。前の版の `expense/car.ts` と同じ考え方）
 *
 * **車の代金は二重に数えない。** 最初の車は「車の積立」か「返済」のどちらか一方にだけ入る。
 * 2 台目からの車は「次の車の積立」で貯めた額で買うので、買い替えの年に代金を足さず、ローンも組み直さない。
 * 前の版の `requiredAnnualReplacementSaving` は「積立は支出ではない（買い替えの持ち出しで数える）」としたが、
 * 新しい計算は一度きりの出費を積立の帯に直す（D34・SPEC §3.1）ので、持ち出しの方を数えず積立の方を数える。
 *
 * 買う月が起点の月以前（もう持っている）なら、車の積立は出さない（代金は払い終えている）。返済は買う月から数え
 * （起点より前の月は `yearlyNeeds` が数えないので、残りの返済だけが入る）、維持費と次の車の積立は起点から出す
 * （次の車の積立は、買ったときから同じ額を積んできた前提。家の「もう買った」と同じ考え方）。
 */

import { monthlyLoanPayment } from '../../expense/loan'
import { roundYen } from '../../money'
import type { Band, BandContext, CarGoal, Rate, YearMonth, Yen } from '../types'
import { addMonths, compareYearMonth, laterOf, monthsBetween, startOfYear } from '../yearMonth'
import { assertNonNegativeYen, makeBand } from './band'
import { inflatedBands } from './inflation'

/**
 * 帯の名前（画面にそのまま出る）。「ながめる」の段の理由は帯の名前だけを出すので、
 * 家の「返済」と見分けられるよう「車の」を付ける
 */
export const CAR_BAND_LABELS = {
  saving: '車の積立',
  repayment: '車のローンの返済',
  upkeep: '車の維持費',
  nextCar: '次の車の積立',
} as const

/** 買う月（`purchaseYear` の 1 月） */
export function carPurchaseMonth(goal: Pick<CarGoal, 'purchaseYear'>): YearMonth {
  return startOfYear(goal.purchaseYear)
}

/** 買う月が起点の月以前か（もう持っている） */
export function carAlreadyOwned(goal: Pick<CarGoal, 'purchaseYear'>, base: YearMonth): boolean {
  return compareYearMonth(carPurchaseMonth(goal), base) <= 0
}

/**
 * 次の車を買うときに出ていく額：価格 − 下取りの額（価格 × 率を円に四捨五入）。
 * 次の車も同じ価格とみなす（名目で固定）
 */
export function carReplacementCost(goal: Pick<CarGoal, 'price'>, resaleRate: Rate): Yen {
  return goal.price - roundYen(goal.price * resaleRate)
}

/**
 * 車のカードの入力が契約どおりかを確かめる。違えば投げる。
 * 金額は 0 以上の整数、買う年は整数、ローンの年数と買い替えの周期は 1 以上の整数（買い替えの周期は null も可）
 */
export function assertCarGoal(goal: CarGoal): void {
  assertNonNegativeYen(goal.price, '車の価格')
  assertNonNegativeYen(goal.monthlyUpkeep, '車の毎月の維持費')
  assertNonNegativeYen(goal.saved, '車の貯まっている額')
  if (!Number.isInteger(goal.purchaseYear)) {
    throw new RangeError(`車を買う年は整数で指定してください: ${goal.purchaseYear}`)
  }
  if (
    goal.payment.type === 'loan' &&
    (!Number.isInteger(goal.payment.years) || goal.payment.years < 1)
  ) {
    throw new RangeError(`車のローンの年数は 1 以上の整数で指定してください: ${goal.payment.years}`)
  }
  if (
    goal.replaceEveryYears !== null &&
    (!Number.isInteger(goal.replaceEveryYears) || goal.replaceEveryYears < 1)
  ) {
    throw new RangeError(
      `買い替えの周期は 1 以上の整数の年で指定してください: ${goal.replaceEveryYears}`,
    )
  }
}

/** 率が 0〜1 の有限の数かを確かめる */
function assertRate(rate: Rate, label: string, max: number): void {
  if (!Number.isFinite(rate) || rate < 0 || rate > max) {
    throw new RangeError(`${label}は 0〜${max} の数で指定してください: ${rate}`)
  }
}

/** 車のカード 1 枚を帯に直す。オン・オフは呼び出し側（`expandGoal`）が見る */
export function carBands(goal: CarGoal, ctx: BandContext): Band[] {
  assertCarGoal(goal)
  const { carResaleRate, carLoanRate } = ctx.settings
  assertRate(carResaleRate, '車の下取りの率', 1)
  if (!Number.isFinite(carLoanRate) || carLoanRate < 0) {
    throw new RangeError(`車のローンの金利は 0 以上の数で指定してください: ${carLoanRate}`)
  }
  const purchase = carPurchaseMonth(goal)
  const bands: Band[] = []

  if (goal.payment.type === 'cash') {
    // 車の積立：買う月まで月がある時だけ。貯まっている額で足りていれば 0 円の帯（足りていることが読める）
    const months = monthsBetween(ctx.base, purchase)
    if (months > 0) {
      const shortfall = Math.max(0, goal.price - goal.saved)
      bands.push(
        makeBand({
          goalId: goal.id,
          label: CAR_BAND_LABELS.saving,
          kind: 'saving',
          monthly: Math.ceil(shortfall / months),
          from: ctx.base,
          to: purchase,
        }),
      )
    }
  } else if (goal.price > 0) {
    // 返済：最初の車だけ。価格の全部を借りる。物価は掛けない
    bands.push(
      makeBand({
        goalId: goal.id,
        label: CAR_BAND_LABELS.repayment,
        kind: 'payment',
        monthly: monthlyLoanPayment({
          principal: goal.price,
          years: goal.payment.years,
          annualRate: carLoanRate,
        }),
        from: purchase,
        to: addMonths(purchase, goal.payment.years * 12),
      }),
    )
  }

  // 維持費と次の車の積立：買う月（もう持っていれば起点）から「ずっと」の終わりまで
  const ownedFrom = laterOf(purchase, ctx.base)
  if (compareYearMonth(ownedFrom, ctx.until) < 0) {
    bands.push(
      ...inflatedBands(
        { goalId: goal.id, label: CAR_BAND_LABELS.upkeep, kind: 'payment' },
        goal.monthlyUpkeep,
        ctx.assumptions.inflationRate,
        ownedFrom,
        ctx.until,
        ctx.base.year,
      ),
    )
    if (goal.replaceEveryYears !== null) {
      bands.push(
        makeBand({
          goalId: goal.id,
          label: CAR_BAND_LABELS.nextCar,
          kind: 'saving',
          monthly: Math.ceil(
            carReplacementCost(goal, carResaleRate) / (goal.replaceEveryYears * 12),
          ),
          from: ownedFrom,
          to: ctx.until,
        }),
      )
    }
  }
  return bands
}

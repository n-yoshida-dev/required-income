/**
 * 暮らし → 帯（SPEC §3.2 の「暮らし」、goalId は `'living'`）。
 *
 * - 生活費：今からずっと（`ctx.until` の前まで）。物価が 0 でなければ年ごとに物価を掛けた帯に分ける（SPEC §3.4）
 * - 家賃：今から `rentUntil` の前まで。家のカードが無ければずっと。物価は掛けない
 */

import type { Band, BandContext, Living, Rate, YearMonth } from '../types'
import { LIVING_GOAL_ID } from '../types'
import { compareYearMonth } from '../yearMonth'
import { assertNonNegativeYen, makeBand } from './band'
import { inflatedBands } from './inflation'

/**
 * 暮らしの帯を作る。
 *
 * @param rentUntil 家賃が終わる月（この月の前まで）。オンの家のカードがあれば、いちばん早い買う月（`expandPlan` が渡す）。
 *   無ければ `ctx.until`
 */
export function livingBands(
  living: Living,
  inflationRate: Rate,
  ctx: BandContext,
  rentUntil: YearMonth = ctx.until,
): Band[] {
  assertNonNegativeYen(living.monthlyLivingCost, '生活費')
  assertNonNegativeYen(living.monthlyRent, '家賃')
  if (!Number.isFinite(inflationRate)) {
    throw new RangeError(`物価の上がり方が有限の数値ではありません: ${inflationRate}`)
  }

  // 家賃は起点より前に終わることがある（すでに家を持っている）。そのときは長さ 0 の帯にせず出さない
  const rent =
    compareYearMonth(rentUntil, ctx.base) > 0
      ? [
          makeBand({
            goalId: LIVING_GOAL_ID,
            label: '家賃',
            kind: 'payment',
            monthly: living.monthlyRent,
            from: ctx.base,
            to: rentUntil,
          }),
        ]
      : []

  return [...livingCostBands(living.monthlyLivingCost, inflationRate, ctx), ...rent]
}

/**
 * 生活費の帯。物価が 0 なら 1 本。0 でなければ暦年ごとに分け、起点の年からの年数ぶん物価を掛ける（`inflatedBands`）。
 * 数える期間が無い（最後まで働く大人がもう退職している）ときは帯を出さない
 */
function livingCostBands(monthly: number, inflationRate: Rate, ctx: BandContext): Band[] {
  return inflatedBands(
    { goalId: LIVING_GOAL_ID, label: '生活費', kind: 'payment' },
    monthly,
    inflationRate,
    ctx.base,
    ctx.until,
    ctx.base.year,
  )
}

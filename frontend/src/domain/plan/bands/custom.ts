/**
 * 自由入力のカード → 帯（SPEC §3.2 の `custom`）。
 *
 * - 毎月：そのままの帯。支出は `payment`、収入は `income`
 * - 一度きり：今から使う月の前までの積立 `saving`（預金。利回りなし）
 */

import type { Band, BandContext, CustomGoal } from '../types'
import { assertYearMonth, monthsBetween } from '../yearMonth'
import { assertNonNegativeYen, makeBand } from './band'

/** 自由入力のカード 1 枚を帯に直す。オン・オフは呼び出し側（`expandGoal`）が見る */
export function customBands(goal: CustomGoal, ctx: BandContext): Band[] {
  assertNonNegativeYen(goal.amount, `「${goal.name}」の金額`)

  if (goal.amountType === 'monthly') {
    return [
      makeBand({
        goalId: goal.id,
        label: goal.name,
        kind: goal.direction === 'income' ? 'income' : 'payment',
        monthly: goal.amount,
        from: goal.from,
        to: goal.to,
      }),
    ]
  }

  // 一度きりは支出だけ（SPEC §2.1）。型で防いでいるが、保存から読んだ値もここを通るので確かめる
  if ((goal.direction as string) !== 'expense') {
    throw new RangeError(`一度きりのカード「${goal.name}」は支出だけです: ${goal.direction}`)
  }
  assertNonNegativeYen(goal.saved, `「${goal.name}」の貯まっている額`)
  assertYearMonth(goal.at, `「${goal.name}」の使う月`)

  // 使う月が今月か過ぎていれば、積み立てる月が無い。帯は出さない（知らせは evaluate の役目）
  const months = monthsBetween(ctx.base, goal.at)
  if (months <= 0) {
    return []
  }

  // 足りない分を残りの月で割る。1 円未満は切り上げ、使う月までに必ず届くようにする
  const shortfall = Math.max(0, goal.amount - goal.saved)
  const monthly = Math.ceil(shortfall / months)
  return [
    makeBand({
      goalId: goal.id,
      label: `${goal.name}の積立`,
      kind: 'saving',
      monthly,
      from: ctx.base,
      to: goal.at,
    }),
  ]
}

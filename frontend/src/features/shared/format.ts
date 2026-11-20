/**
 * 金額・期間の見せ方（SPEC §2「画面では万円で見せる」）。計算はせず、文字にするだけ。
 *
 * 前の版の `features/result/format.ts` は前の版の型に結びついていたので T13 で消した（タグ `v1-final` にある）。
 * 新しい画面はここだけを使う。
 */

import type { YearMonth, Yen } from '../../domain/plan/types'
import { addMonths } from '../../domain/plan/yearMonth'

/** 円 → 万円の換算に使う割り算の数 */
const YEN_PER_MAN = 10000

/** 負の数の記号。ハイフンより幅が数字に揃う */
const MINUS_SIGN = '−'

type ManOptions = {
  /** 小数の桁数（既定 0）。月額など 1 万円未満が意味を持つ物は 1 */
  digits?: number
  /** 正の数にも + を付ける（差を見せるとき） */
  signed?: boolean
  /** 小数の桁を `digits` 桁にそろえる（"418.0"。足し算として縦に並べるとき） */
  fixed?: boolean
}

/** 円を万円の数字だけにする（"1,050"）。単位は呼び出し側が付ける */
export function manNumber(yen: Yen, options: ManOptions = {}): string {
  const digits = options.digits ?? 0
  const man = Math.abs(yen) / YEN_PER_MAN
  const text = man.toLocaleString('ja-JP', {
    minimumFractionDigits: options.fixed === true ? digits : 0,
    maximumFractionDigits: digits,
  })
  // 丸めて 0 になる数には記号を付けない（"+0" や "−0" を出さない）
  const rounded = Number(man.toFixed(digits))
  if (rounded === 0) return text
  if (yen < 0) return `${MINUS_SIGN}${text}`
  return options.signed ? `+${text}` : text
}

/** 円を万円の文字にする（"1,050万円"） */
export function formatMan(yen: Yen, options: ManOptions = {}): string {
  return `${manNumber(yen, options)}万円`
}

/** 割合を「3.81%」にする（小数 2 桁まで。0.0381 → "3.81%"） */
export function formatPercent(rate: number): string {
  return `${Number((rate * 100).toFixed(2)).toLocaleString('ja-JP', { maximumFractionDigits: 2 })}%`
}

/** 年月を「2030年4月」にする */
export function formatYearMonth(value: YearMonth): string {
  return `${value.year}年${value.month}月`
}

/** 年の範囲を「2031〜2035年」にする。1 年だけなら「2031年」（「2031〜2031年」と出さない） */
export function formatYearRange(fromYear: number, toYear: number): string {
  return fromYear === toYear ? `${fromYear}年` : `${fromYear}〜${toYear}年`
}

/** 帯と同じ「この月の前まで」の終わりを、最後に掛かる月の文字にする（"2034年12月"） */
export function formatEndExclusive(to: YearMonth): string {
  return formatYearMonth(addMonths(to, -1))
}

/** 月数を「6年2か月」にする。0 以下は空文字（呼び出し側が「今」などに言い換える） */
export function formatDuration(months: number): string {
  if (months <= 0) return ''
  const years = Math.floor(months / 12)
  const rest = months % 12
  return `${years > 0 ? `${years}年` : ''}${rest > 0 ? `${rest}か月` : ''}`
}

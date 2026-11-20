/**
 * 段の理由の言葉（W18・W19・W20。SPEC §4.1）。概要の「◯年に変わること」の行と、段が下がる理由を、暮らしの言葉の文にする。
 * どの帯がどう変わったか・どの段が下がるかは `domain/plan/stepReading.ts` が決め、ここは言葉に直すだけ。
 * 名前と動きを 1 つの言い回しにする（「学校（1人目）の費用が終わる」）。「始まる」「終わる」だけの見出しで組にしない（W19）
 */

import { causeIsIncome, type FallingStep } from '../../domain/plan/stepReading'
import type { CauseChange, StepCause, Year } from '../../domain/plan/types'

/** 変わり方の言葉（動詞） */
export const CHANGE_WORDS: Record<CauseChange, string> = {
  start: '始まる',
  end: '終わる',
  more: '増える',
  less: '減る',
}

/**
 * 名前だけでお金の話だと読める帯の名前の終わり（「車の積立」「車のローンの返済」「保育料」「家賃」など）。
 * これで終わらない名前（「学校（1人目）」「塾」「家族旅行」）は「の費用」を添える。「学校が終わる」だと下校に読めるため（W19）
 */
const MONEY_ENDINGS = [
  '積立',
  '返済',
  '費用',
  '費',
  '料',
  '税',
  '家賃',
  '代',
  '金',
  '手当',
] as const

/** 子の順（「（1人目）」）を除いた名前（終わりの言葉を見るため） */
function baseName(label: string): string {
  return label.replace(/（\d+人目）$/, '')
}

/**
 * 理由の帯を、文の主語にする。収入の帯（児童手当など）は「◯◯の受け取り」（「費用が終わる」にしない）、
 * 名前だけでお金と読めない支払いの帯は「◯◯の費用」、ほかは名前のまま
 */
export function causeSubject(cause: Pick<StepCause, 'label' | 'change' | 'monthlyDelta'>): string {
  if (causeIsIncome(cause)) return `${cause.label}の受け取り`
  const base = baseName(cause.label)
  const money = MONEY_ENDINGS.some((ending) => base.endsWith(ending))
  return money ? cause.label : `${cause.label}の費用`
}

/** 理由 1 つの言い回し（「車のローンの返済が始まる」「学校（1人目）の費用が終わる」）。月額は画面が横に添える */
export function causePhrase(cause: Pick<StepCause, 'label' | 'change' | 'monthlyDelta'>): string {
  return `${causeSubject(cause)}が${CHANGE_WORDS[cause.change]}`
}

/** 次の段の理由の見出し（「2029年に変わること」） */
export function causeHeading(year: Year): string {
  return `${year}年に変わること`
}

/**
 * 段が下がる理由（「車のローンの返済が」「終わるので」）。概要の 3 つ目の箇条書きで、最後の段が下がるときに使う（D42）。
 * 主語と動きの 2 つのかたまりで返す（画面はかたまりの間だけで折り返す）。
 * ほかにも下げる理由があれば主語に「など」を添える。理由が無い（上限で切れた）ときは null（金額だけ言う）
 */
export function fallReason(fall: FallingStep): [string, string] | null {
  if (fall.cause === null) return null
  const more = fall.others > 0 ? 'など' : ''
  return [`${causeSubject(fall.cause)}${more}が`, `${CHANGE_WORDS[fall.cause.change]}ので`]
}

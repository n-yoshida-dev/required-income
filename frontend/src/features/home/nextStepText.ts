/**
 * 「ながめる」の概要の枠と図の題の言葉（W19・W20。SPEC §4.1）。切り詰めた単語の札でなく、暮らしの言葉の文にする。
 * 画面では「世帯年収」と書かず「年収」と書き、意味は注（`INCOME_NOTE`）で 1 回だけ言う（D41）。
 *
 * 金額は「画面に出す万円」（`roundMan` でそろえた値）を受け、ここは文に組むだけ（流れの金額は `manNumber` が万円に丸める）。
 * 数字の字にするのは画面（`NumText`）。どの段が高い・下がるかは `domain/plan/stepReading.ts` が決める
 */

import type { StepOutlook } from '../../domain/plan/stepReading'
import type { Year, Yen } from '../../domain/plan/types'
import { manNumber } from '../shared/format'
import { fallReason } from './causeText'

/**
 * 「年収」の注。いちばん上の文の近くに 1 回だけ出す。
 * 2 つの文に分けて返し、画面は文の間だけで折り返す（「金額」だけが次の行に落ちないように）
 */
export const INCOME_NOTE: readonly string[] = [
  '年収：家族の年収の合計。',
  '税金と社会保険を引かれる前の金額',
]

/** いちばん上の文の、金額のあと（「…年収 948万円 が要ります」） */
export const REQUIRED_VERB = 'が要ります'

/** 解けない段で、金額の代わりに大きく出す言葉（「…年収をいくら上げても 届かない」） */
export const UNREACHABLE_WORD = '届かない'

/**
 * いちばん上の文の、金額の前の部分（文節のかたまりの並び。`Sentence` と同じく、画面は入りきる幅では 1 行で出し、
 * 入りきらないときだけかたまりの間で折り返す。T22）。
 * 届く段：「やりたいことを全部やるには、」「2029年から年収」。解けない段：「やりたいことを全部やると、」「2029年からは、」「年収をいくら上げても」
 */
export function requiredLead(fromYear: Year, reachable: boolean): string[] {
  return reachable
    ? ['やりたいことを全部やるには、', `${fromYear}年から年収`]
    : ['やりたいことを全部やると、', `${fromYear}年からは、`, '年収をいくら上げても']
}

/**
 * 箇条書きの文 1 つ。文節のかたまりの並びで、画面はかたまりの間だけで折り返す（かたまりの中では割らない。
 * 数字と単位「48万円」は同じかたまりに入れる）。入りきる幅では 1 行に詰めて出す（T22）。
 * かたまりの終わりの空白は、次のかたまりとの間の空白（行の頭に来たら消える）。つなぐと文になる
 */
export type Sentence = readonly string[]

/** 文を並べ、最後の文のほかは「。」で結ぶ（画面は文ごとに行を改める） */
function sentences(...parts: Sentence[]): Sentence[] {
  return parts.map((part, index) => {
    if (index === parts.length - 1) return part
    const head = part.slice(0, -1)
    const tail = part.at(-1) ?? ''
    return [...head, `${tail}。`]
  })
}

/** 文をつないだ字（テストと読み上げの確かめ用） */
export function sentenceText(said: readonly Sentence[]): string {
  return said.map((sentence) => sentence.join('')).join('')
}

/**
 * 概要の 1 つ目の箇条書きの前半（「今の年収 900万円より 48万円多い金額です」）。
 * 差が 0 以下（四捨五入で同じ万円）なら「ほぼ同じ金額です」、解けない段（`required` が null）は今の年収だけを言う
 *
 * @param current 今の年収（画面に出す万円にそろえた円）
 * @param required 次の段の要る年収（同じくそろえた円）。解けない段は null
 */
export function gapText(current: Yen, required: Yen | null): Sentence {
  const now = manNumber(current)
  if (required === null) return ['今の年収は ', `${now}万円です`]
  const gap = required - current
  if (gap <= 0) return ['今の年収 ', `${now}万円と`, 'ほぼ同じ', '金額です']
  return ['今の年収 ', `${now}万円より `, `${manNumber(gap)}万円`, '多い', '金額です']
}

/** 概要の 1 つ目の箇条書きの後半（「2028年までは今の年収で足ります」）。次の段の前の年 */
export function enoughUntilText(year: Year): Sentence {
  return [`${year}年までは`, '今の年収で', '足ります']
}

/**
 * 概要の 1 つ目の箇条書き（「今の年収 900万円より 48万円多い金額です。」「2028年までは今の年収で足ります」）。
 * 次の段が最初の段（`enoughUntil` が null）なら後半を出さない
 */
export function gapPoint(current: Yen, required: Yen | null, enoughUntil: Year | null): Sentence[] {
  const gap = gapText(current, required)
  return enoughUntil === null ? sentences(gap) : sentences(gap, enoughUntilText(enoughUntil))
}

/** 流れの中の段の金額（「998万円」） */
function amountOf(gross: Yen): string {
  return `${manNumber(gross)}万円`
}

/** 最後の段の文（「2035年からは、」「車のローンの返済が」「終わるので 」「938万円に下がります」） */
function lastSentence(last: NonNullable<StepOutlook['last']>): Sentence {
  const from = `${last.fromYear}年からは`
  if (last.requiredGross === null) return [`${from}、`, '年収を', 'いくら上げても', '届きません']
  const amount = amountOf(last.requiredGross)
  if (last.fall === null) return [`${from} `, `${amount}です`]
  const reason = fallReason(last.fall)
  if (reason === null) return [`${from} `, `${amount}に`, '下がります']
  const [subject, verb] = reason
  return [`${from}、`, subject, `${verb} `, `${amount}に`, '下がります']
}

/**
 * 概要の 3 つ目の箇条書き（その先の流れ。D42）。いちばん高い段と、最後に落ち着く段を文で言う：
 * 「いちばん高いのは 2032年からの 998万円。」「2035年からは、車のローンの返済が終わるので 938万円に下がります」。
 * 次の段がいちばん高いなら前半を言わず、いちばん高い段が最後の段なら「◯年まで続きます」で結ぶ。
 * 流れが無い（`stepOutlook` が null）ときは null（箇条書きを出さない）
 */
export function outlookText(outlook: StepOutlook | null): Sentence[] | null {
  if (outlook === null) return null
  const { peak, peakIsLast, last } = outlook
  const parts: Sentence[] = []
  if (peak !== null) {
    if (peak.requiredGross === null) {
      parts.push([`${peak.fromYear}年からは、`, '年収を', 'いくら上げても', '届きません'])
    } else {
      const from = `${peak.fromYear}年からの `
      const amount = amountOf(peak.requiredGross)
      parts.push(
        peakIsLast
          ? ['いちばん', '高いのは ', from, `${amount}で、`, `${peak.toYear}年まで`, '続きます']
          : ['いちばん', '高いのは ', from, amount],
      )
    }
  }
  if (last !== null) parts.push(lastSentence(last))
  return parts.length === 0 ? null : sentences(...parts)
}

/** 次の段が無い（どの段も今の年収で足りる）ときの文。2 行目の金額は大きい字にする */
export function enoughLines(current: Yen): [string, string] {
  return ['やりたいことを全部やっても、', `今の年収 ${manNumber(current)}万円で足ります`]
}

/** 段が 1 つも無い（働く大人が全員もう退職の年齢）ときの文 */
export const NO_STEPS_TEXT = '大人がみな退職の年齢を過ぎているので、要る年収を出す年がありません'

/**
 * 段の内訳（足し算）の行の言葉。初めての人が読んで分かる言い方にする：手取り → 1 年にかかるお金、
 * 税・社会保険 → 稼ぐときに引かれる物、要る世帯年収 → 要る年収、見込み → 見込みの年収（図の中の札は短いまま）
 */
export const BREAKDOWN_WORDS = {
  net: '1年にかかるお金',
  tax: '＋ 引かれる税金・社会保険',
  gross: '要る年収',
  unreachable: '届かない',
  expected: '見込みの年収',
  /** 見込みの年収で届かない額のあと（「48万円足りない」） */
  lack: '万円足りない',
} as const

/** 階段の図の題（「この先、年収がいくら要るか（2044年まで）」）。◯ は最後の段の終わりの年 */
export function stairsTitle(lastYear: Year): string {
  return `この先、年収がいくら要るか（${lastYear}年まで）`
}

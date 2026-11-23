/**
 * 画面での大人の呼び方（T21。SPEC §0）。言葉はここ 1 か所にまとめ、あとで替えやすくする。
 *
 * 2 人目の大人は、画面ではどこでも「パートナー」と呼ぶ（前は「もう 1 人」。伝わりにくいとの指摘で替えた。2026-11-23）。
 * 「パートナー」は Claude の仮置きで、ほかの候補は「配偶者」「家計をともにする人」。本人が前と後のページを見て選び直せる。
 * コードの名前と SPEC の用語（大人の 2 人目）は変えない
 */

/** 先頭の大人の呼び方 */
export const SELF_NAME = '本人'

/** 2 人目の大人の呼び方 */
export const PARTNER_NAME = 'パートナー'

/** 大人の並び（先頭が本人）の呼び方 */
export const ADULT_NAMES = [SELF_NAME, PARTNER_NAME] as const

/** 大人の並びの番号から呼び方を出す（先頭は本人、それ以外はパートナー。大人は 2 人まで） */
export function adultName(index: number): string {
  return index === 0 ? SELF_NAME : PARTNER_NAME
}

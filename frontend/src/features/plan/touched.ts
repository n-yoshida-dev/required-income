/**
 * 直した欄の印（`touched`。SPEC §2「直した欄と既定値のままの欄を見分ける」・§5 の保存の `touched`）の書き方。
 *
 * 印は「どの欄か」を表す文字列で、点でつないだパスにする。行のある所は配列の番号ではなく id を使う
 * （行を外しても、ほかの行の印がずれないため）。
 *
 * | 欄 | 印 |
 * |---|---|
 * | 大人の項目 | `adults.<大人の id>.<項目>`（見込みの段は全体で 1 つ：`adults.<id>.outlookSteps`） |
 * | 子の生まれ年月 | `children.<子の id>.birth` |
 * | 市区町村 | `municipality` |
 * | 暮らし | `living.monthlyLivingCost`・`living.monthlyRent` |
 * | 前提 | `assumptions.<項目>` |
 * | 目標カード | `goals.<カードの id>.<項目>`（年月は 1 つ：`from`・`to`・`at`。型の選択は `variant`、オンオフは `enabled`。車の払い方は `payment`・ローンの年数は `loanYears`、買い替えるかは `replace`・周期は `replaceEveryYears`。子の費用の進路は `elementary`・`juniorHigh`・`highSchool`、塾の行は全体で 1 つ `cramSchools`、習い事は `lessonsMonthly`、保育は `childcareMonthly`。大学資金・老後資金は `targetAmount`・`allocateChildAllowance`・`vehicle`・`byYear`・`saved`、大学資金の進路は `course`（進路を選ぶと目標額の印は外れる。D37）） |
 *
 * 印に載らない欄は既定値のまま。見本から自分の計画を始めたときは、すべての欄が既定値のまま（印が空）になる。
 */

/** 印を作る（点でつなぐ） */
export function touchedKey(...parts: string[]): string {
  return parts.join('.')
}

/** 印を足す（重ねない） */
export function withTouched(touched: readonly string[], key: string): string[] {
  return touched.includes(key) ? [...touched] : [...touched, key]
}

/** ある行（大人・子・カード）の印をまとめて外す。行を消したときに使う */
export function withoutTouchedUnder(touched: readonly string[], prefix: string): string[] {
  return touched.filter((key) => key !== prefix && !key.startsWith(`${prefix}.`))
}

/** その欄を直したか */
export function isTouched(touched: readonly string[], key: string): boolean {
  return touched.includes(key)
}

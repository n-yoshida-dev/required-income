/**
 * 自治体コード（全国地方公共団体コード）と名前の対応。画面表示にだけ使う。
 *
 * 入力と計算はコード（5 桁）で持ち、名前は `data/municipality/codes.json`（総務省の一覧）から引く。
 * フェーズ 2 で保育料の階層表や国保の料率を自治体ごとに切り替えるときも、キーはこのコードになる。
 */

import codesJson from '../../data/municipality/codes.json'

/** 自治体 1 つ */
export type Municipality = {
  code: string
  name: string
  prefecture: string
}

const table: Readonly<Record<string, { name: string; prefecture: string }>> = codesJson.values

/** コードから自治体を引く。一覧に無ければ null（架空のサンプル値もここに落ちる） */
export function lookupMunicipality(code: string): Municipality | null {
  const key = code.trim()
  const found = table[key]
  return found ? { code: key, ...found } : null
}

/** コードを人が読める形にする（"神奈川県 横浜市"）。一覧に無ければ null */
export function describeMunicipality(code: string): string | null {
  const found = lookupMunicipality(code)
  if (!found) return null
  // 都道府県そのもの（下 3 桁が 000）は名前と都道府県名が同じなので繰り返さない
  return found.name === found.prefecture ? found.name : `${found.prefecture} ${found.name}`
}

/** 自治体コードの形（5 桁の数字） */
const CODE_PATTERN = /^\d{5}$/

/**
 * 入力欄に打った文字を自治体コードに直す。直せなければ null（呼び出し側は保存せず、候補から選ぶよう出す）。
 *
 * - 5 桁の数字はそのままコードにする（一覧に無いコードも通す。国保の料率は概算になる。SPEC §2）
 * - 名前は、一覧の名前（「横浜市」）か「都道府県 名前」（「神奈川県 横浜市」。候補の見せ方と同じ）か、
 *   空白なしでつないだ形（「神奈川県横浜市」）に 1 件だけ合えば、そのコードにする。同じ名前が複数（「府中市」など）なら null
 */
export function resolveMunicipality(text: string): string | null {
  const typed = text.trim()
  if (CODE_PATTERN.test(typed)) return typed
  if (typed === '') return null
  const matched = municipalityOptions().filter(
    (item) =>
      item.name === typed ||
      `${item.prefecture} ${item.name}` === typed ||
      `${item.prefecture}${item.name}` === typed,
  )
  return matched.length === 1 && matched[0] !== undefined ? matched[0].code : null
}

let cachedOptions: readonly Municipality[] | null = null

/**
 * 入力候補（datalist 用）。コード順。初回だけ組み立てて使い回す。
 * JS のオブジェクトは "10000" のような整数に見えるキーを "01000" より先に並べるので、明示的に並べ直す
 */
export function municipalityOptions(): readonly Municipality[] {
  if (cachedOptions === null) {
    cachedOptions = Object.entries(table)
      .map(([code, item]) => ({ code, ...item }))
      .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
  }
  return cachedOptions
}

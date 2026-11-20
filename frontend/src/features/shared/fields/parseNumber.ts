/**
 * 入力欄の文字列を数値にする。"1,200" の桁区切りや全角の数字・小数点・マイナスも受け付ける。
 * 読めなければ null（空欄と同じ扱い）。
 */
export function parseNumber(text: string): number | null {
  const normalized = text
    .replace(/[０-９．－]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xfee0))
    .replace(/[,\s]/g, '')
  if (normalized === '' || normalized === '-') return null
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

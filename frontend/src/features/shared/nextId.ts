/**
 * 足した行（大人・子・目標カード）の id を作る。`<prefix>-<番号>` のうち、まだ使われていない最小の番号にする。
 *
 * 乱数（`crypto.randomUUID`）は https でない開き方（スマホから LAN の IP で開くなど）では使えないので、
 * 今ある id と重ならないことだけで決める。表示には使わない
 */
export function nextId(prefix: string, existing: Iterable<string>): string {
  const used = new Set(existing)
  let number = 1
  while (used.has(`${prefix}-${number}`)) number += 1
  return `${prefix}-${number}`
}

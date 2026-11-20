/**
 * 見本の世帯から自分の計画を始める入口（「ながめる」と「計画」の両方に出す）と、保存を開けなかったときの知らせ。
 *
 * 壊れた保存・今の版で開けない保存があって見本で開いているときは、始めると前の保存を上書きする。
 * そのときだけ 2 回押しにして、「前の保存を消して始める」と分かる言葉で確かめる（SPEC §5「保存は消さない」）
 */

import type { StorageProblem } from '../../app/planSession'
import { ConfirmButton } from './ConfirmButton'

/** 保存があったのに見本で開いた訳の、知らせの書き出し */
const STORAGE_PROBLEM_LEAD: Record<StorageProblem['kind'], string> = {
  unreadable: '保存を読めなかったので',
  unsupported: '保存を今の版で開けなかったので',
}

/** 「自分の数字にする」のボタン。前の保存があれば 2 回押し */
export function StartOwnButton({
  storageProblem,
  className,
  onStart,
}: {
  storageProblem: StorageProblem | null
  className?: string
  onStart: () => void
}) {
  if (storageProblem !== null) {
    return (
      <ConfirmButton
        className={className}
        label="自分の数字にする"
        confirmLabel="前の保存を消して始める"
        onConfirm={onStart}
      />
    )
  }
  return (
    <button type="button" className={className} onClick={onStart}>
      自分の数字にする
    </button>
  )
}

/** 保存を開けなかったので見本で開いている、という知らせ。問題が無ければ何も出さない */
export function StorageProblemAlert({
  storageProblem,
  className,
}: {
  storageProblem: StorageProblem | null
  className?: string
}) {
  if (storageProblem === null) return null
  return (
    <p className={className} role="alert">
      {STORAGE_PROBLEM_LEAD[storageProblem.kind]}、見本で開いています（{storageProblem.reason}）
    </p>
  )
}

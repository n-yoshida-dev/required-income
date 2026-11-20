/**
 * 2 回押すボタン。1 回目で確かめの言葉（「本当に消す」など）に変わり、2 回目で実行する。
 * 消す・外す・前の保存を上書きする、のように戻せない操作を、スマホで誤って触れても実行しないため。
 *
 * 確かめの状態は、決まった秒数がたつと元に戻る。フォーカスが外れたときだけで戻すと、
 * iPhone の Safari はボタンを押してもフォーカスが移らないことがあり、戻らないため
 */

import { useEffect, useState } from 'react'

/** 確かめの状態が元に戻るまでの時間（ミリ秒） */
const CONFIRM_RESET_MS = 4000

type Props = {
  /** 1 回目の言葉 */
  label: string
  /** 2 回目（確かめ）の言葉 */
  confirmLabel: string
  /** 読み上げの名前（見た目の言葉だけでは対象が分からないとき） */
  ariaLabel?: string
  /** 確かめのときの読み上げの名前 */
  confirmAriaLabel?: string
  className?: string
  /** 2 回目に押したとき */
  onConfirm: () => void
}

/** 2 回押すボタン */
export function ConfirmButton({
  label,
  confirmLabel,
  ariaLabel,
  confirmAriaLabel,
  className,
  onConfirm,
}: Props) {
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), CONFIRM_RESET_MS)
    return () => window.clearTimeout(timer)
  }, [confirming])

  return (
    <button
      type="button"
      className={className}
      aria-label={confirming ? (confirmAriaLabel ?? confirmLabel) : (ariaLabel ?? label)}
      onClick={() => {
        if (!confirming) {
          setConfirming(true)
          return
        }
        setConfirming(false)
        onConfirm()
      }}
      onBlur={() => setConfirming(false)}
    >
      {confirming ? confirmLabel : label}
    </button>
  )
}

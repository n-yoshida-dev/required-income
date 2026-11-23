/**
 * 区分の中の畳み（「この先の収入・副業・退職」「前提を確かめる」。T21。DESIGN.md「畳み」）。
 *
 * - はじめは閉じている。中の欄に誤りがあれば（`forceOpen`）開く
 * - 開閉の印は目標カードと同じ「▸」「▾」。線・枠は足さない
 * - 見本の世帯のあいだ（入力の束が止まっている）も開け閉めできる（`summary` は止まらない）
 */

import { useState, type ReactNode } from 'react'

type Props = {
  /** 畳みの名前（`summary` の字） */
  summary: string
  /** 中の欄に誤りがあるか。true になったら開く */
  forceOpen: boolean
  children: ReactNode
}

/** 畳み */
export function Fold({ summary, forceOpen, children }: Props) {
  const [open, setOpen] = useState(forceOpen)
  // 誤りが出たときに開く（描画の途中で前回と比べる。effect で setState すると描画が二重になる）
  const [lastForce, setLastForce] = useState(forceOpen)
  if (forceOpen !== lastForce) {
    setLastForce(forceOpen)
    if (forceOpen) setOpen(true)
  }

  return (
    <details
      className="fold"
      open={open}
      onToggle={(event) => {
        // 開閉の状態を揃える（「次へ」が誤りの欄を開いたときも、ここで受ける）
        if (event.currentTarget.open !== open) setOpen(event.currentTarget.open)
      }}
    >
      <summary className="fold__summary">{summary}</summary>
      <div className="fold__body">{children}</div>
    </details>
  )
}

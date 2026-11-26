/**
 * 結果の代わりに出す「今やること」1 文とボタン 1 つ（T25・D49）。
 * 自分の計画で、入力の途中か、自分で足した目標がまだ無いときに、「ながめる」と「見直す」が同じ物を出す。
 * 何を出すかは `homeStart.ts` が決める。ここは並べるだけ。見た目は DESIGN.md「概要の枠」の最後の項目
 */

import { Link } from 'react-router'
import type { HomeStart } from './homeStart'

type Props = {
  start: HomeStart
}

/** 今やること 1 つ（1 文とボタン） */
export function HomeStartPanel({ start }: Props) {
  return (
    <section className="summary home__empty" aria-labelledby="home-empty-sentence">
      <p id="home-empty-sentence" className="home__empty-sentence">
        {start.sentence}
      </p>
      <Link className="home__go" to={start.to}>
        {start.action}
      </Link>
    </section>
  )
}

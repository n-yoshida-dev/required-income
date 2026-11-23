/**
 * 目標の一覧（SPEC §4.1 の 3）。目標・金額・期限・貯まり具合を並べ、押すと「計画」のそのカードへ移る（`?goal=<id>`）。
 *
 * 1 行の形（DESIGN.md「目標の一覧」）：名前と金額を 1 行目、期限と貯まり具合を 2 行目。右端の「>」が押せる合図。
 * 年でまとめず、区切り線も引かない。
 */

import type { CSSProperties } from 'react'
import { Link } from 'react-router'
import type { GoalSummary } from './goalSummary'

type Props = {
  goals: readonly GoalSummary[]
}

/** 目標の一覧 */
export function GoalList({ goals }: Props) {
  if (goals.length === 0) return null
  return (
    <ul className="goals" aria-label="目標">
      {goals.map((goal) => (
        <li key={goal.id} className={goal.enabled ? undefined : 'is-off'}>
          <Link
            className="goals__row"
            to={{ pathname: '/plan/goals', search: `?goal=${encodeURIComponent(goal.id)}` }}
          >
            <span className="goals__name">{goal.name}</span>
            {goal.amount === null ? null : (
              <span className="goals__amount">
                {goal.amount.monthly ? '月 ' : null}
                <span className="num">{goal.amount.man}</span>万円
              </span>
            )}
            <span className="goals__go" aria-hidden="true" />
            {goal.period === null && goal.progress === null ? null : (
              <span className="goals__meta">
                {goal.period === null ? null : <span className="goals__period">{goal.period}</span>}
                {goal.progress === null ? null : (
                  <span className="goals__progress">
                    <span
                      className="goals__track"
                      role="img"
                      aria-label={`${goal.name}の貯まり具合 ${Math.round(goal.progress * 100)}%`}
                    >
                      <i style={{ '--p': goal.progress } as CSSProperties} />
                    </span>
                    <span className="goals__pct" aria-hidden="true">
                      <span className="num">{Math.round(goal.progress * 100)}</span>%
                    </span>
                  </span>
                )}
              </span>
            )}
          </Link>
        </li>
      ))}
    </ul>
  )
}

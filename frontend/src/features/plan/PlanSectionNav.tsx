/**
 * 「計画」の区分の帯（T21。DESIGN.md「区分の帯」）。上に「1 家族」「2 収入」「3 暮らし」「4 目標」を並べる。
 *
 * - 今いる区分は `aria-current="step"`、墨の太字と上の墨の線（下のタブの「今いる」と同じ合図）
 * - 案内のあいだだけ、済んだ区分に「✓」と読み上げ用の「済み」
 * - どの区分へもいつでも飛べる（順番を強いない）
 */

import { Link } from 'react-router'
import { PLAN_SECTIONS, type Guide, type PlanSectionId } from './guide'
import { SECTION_LABELS } from './sectionWords'

type Props = {
  current: PlanSectionId
  /** 案内の進み具合（案内のあいだでなければ null。そのときは済みの印を出さない） */
  guide: Guide | null
}

/** 区分の帯 */
export function PlanSectionNav({ current, guide }: Props) {
  return (
    <nav className="plan-nav" aria-label="計画の区分">
      <ol className="plan-nav__list">
        {PLAN_SECTIONS.map((section, index) => {
          const done = guide !== null && guide.done.includes(section)
          return (
            <li key={section}>
              <Link
                to={`/plan/${section}`}
                className="plan-nav__link"
                aria-current={section === current ? 'step' : undefined}
              >
                <span className="num">{index + 1}</span> {SECTION_LABELS[section]}
                {done ? (
                  <>
                    <span className="plan-nav__done" aria-hidden="true">
                      ✓
                    </span>
                    <span className="visually-hidden">済み</span>
                  </>
                ) : null}
              </Link>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

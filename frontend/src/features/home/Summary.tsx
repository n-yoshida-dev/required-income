/**
 * 概要の枠（SPEC §4.1 の 1。D42）。「ながめる」の先頭に、ここだけを「文で読む所」として置き、下の図は図だけで見せる。
 *
 * - 見出しの文：「やりたいことを全部やるには、」「2029年から年収」→ いちばん大きい字の「948万円」→「が要ります」。同じ行の右に「あと2年2か月」
 * - 「年収」の注を 1 回だけ
 * - 箇条書き 3 つ：今の年収との差と「◯年までは今の年収で足ります」／「◯年に変わること」と理由の行／その先の流れ（いちばん高い段と最後の段）
 *
 * 次の段が無い（どの段も今の年収で足りる）ときは「やりたいことを全部やっても、今の年収 ◯万円で足ります」と注だけ。
 * 段が 1 つも無い（働く大人が全員もう退職の年齢）ときは、要る年収を出す年が無いことだけを出す。
 * 言葉は `nextStepText.ts` と `causeText.ts`、流れの判定は `domain/plan/stepReading.ts`（画面のファイルと分けて単体テストする）
 */

import { Fragment } from 'react'
import { causeGroups, type StepOutlook } from '../../domain/plan/stepReading'
import type { Step, Year, YearMonth, Yen } from '../../domain/plan/types'
import { monthsBetween, startOfYear } from '../../domain/plan/yearMonth'
import { formatDuration, manNumber } from '../shared/format'
import { roundMan } from '../shared/displayMan'
import { NumText } from '../shared/NumText'
import { causeHeading, causePhrase } from './causeText'
import {
  enoughLines,
  gapPoint,
  INCOME_NOTE,
  NO_STEPS_TEXT,
  outlookText,
  REQUIRED_VERB,
  requiredLead,
  type Sentence,
  UNREACHABLE_WORD,
} from './nextStepText'

type Props = {
  step: Step | null
  /** 段の数。0 なら階段に出す年が無い */
  stepCount: number
  currentGross: Yen
  /** 計算の起点（今日の年月）。「あと何年何か月」の基準 */
  base: YearMonth
  /** 今の年収で足りる最後の年（次の段の前の年。`enoughUntilYear`）。次の段が最初の段なら null */
  enoughUntil: Year | null
  /** 次の段より先の流れ（`stepOutlook`）。その先に段が無ければ null */
  outlook: StepOutlook | null
}

/** 「年収」の注（小さい字）。文ごとのかたまりにして、かたまりの間だけで折り返す */
function IncomeNote() {
  return (
    <p className="summary__note">
      {INCOME_NOTE.map((sentence) => (
        <span key={sentence} className="summary__note-phrase">
          {sentence}
        </span>
      ))}
    </p>
  )
}

/**
 * 箇条書きの文を描く。文ごとに行を改め、文の中は文節のかたまり（`inline-block`）の間だけで折り返す。
 * かたまりの終わりの空白はかたまりの外に出す（行の頭に来たら消える）
 */
function Said({ sentences }: { sentences: readonly Sentence[] }) {
  return sentences.map((sentence, index) => (
    <span key={index} className="summary__said">
      {sentence.map((chunk, at) => (
        <Fragment key={at}>
          <span className="summary__chunk">
            <NumText text={chunk.trimEnd()} />
          </span>
          {chunk.endsWith(' ') ? ' ' : null}
        </Fragment>
      ))}
    </span>
  ))
}

/** これより長い（4 桁以上の金額・「届かない」）ときは、字を 1 段小さくして幅に収める */
const LONG_AMOUNT_LENGTH = 4

/** 概要の枠 */
export function Summary({ step, stepCount, currentGross, base, enoughUntil, outlook }: Props) {
  if (stepCount === 0) {
    return (
      <section className="summary" aria-label="概要">
        <p className="summary__headline">{NO_STEPS_TEXT}</p>
      </section>
    )
  }

  if (step === null) {
    const [first, second] = enoughLines(roundMan(currentGross))
    return (
      <section className="summary" aria-label="概要">
        <p className="summary__headline">
          <span className="summary__line">{first}</span>
          <span className="summary__line summary__enough-amount">
            <NumText text={second} />
          </span>
        </p>
        <IncomeNote />
      </section>
    )
  }

  const monthsLeft = monthsBetween(base, startOfYear(step.fromYear))
  // 今年から始まる段は、文の「2026年から」と同じことを言うので、右の「あと◯年◯か月」は出さない（PR #99 の見た目の点検）
  const when = monthsLeft > 0 ? `あと${formatDuration(monthsLeft)}` : null
  const reachable = step.requiredGross !== null
  const amount = step.requiredGross === null ? UNREACHABLE_WORD : manNumber(step.requiredGross)
  const long = amount.replace(/,/g, '').length >= LONG_AMOUNT_LENGTH
  const causes = causeGroups(step.causes).flatMap((group) => group.causes)
  const gap = gapPoint(
    roundMan(currentGross),
    step.requiredGross === null ? null : roundMan(step.requiredGross),
    enoughUntil,
  )
  const flow = outlookText(outlook)

  return (
    <section className={long ? 'summary is-long' : 'summary'} aria-label="概要">
      {/* 見出しの文：前の行 → 大きい金額 → 「が要ります」で 1 つの文として読む（W19） */}
      <p className="summary__sentence">
        {requiredLead(step.fromYear, reachable).map((line) => (
          <span key={line} className="summary__line">
            {line}
          </span>
        ))}
        {step.requiredGross === null ? (
          <span className="summary__amount">{amount}</span>
        ) : (
          <span className="summary__amount num">
            {amount}
            <span className="summary__unit">万円</span>
          </span>
        )}
        {/* 「が要ります」の行。解けない段で今年から始まるときは、どちらも無いので行ごと出さない */}
        {!reachable && when === null ? null : (
          <span className="summary__verb">
            {reachable ? <span>{REQUIRED_VERB}</span> : null}
            {when === null ? null : (
              <>
                {/* 文の後ろに置く（文の邪魔をしない）。読み上げでは文と切る */}
                <span className="visually-hidden">。</span>
                <span className="summary__left">{when}</span>
              </>
            )}
          </span>
        )}
      </p>
      <IncomeNote />
      <ul className="summary__points">
        <li>
          <Said sentences={gap} />
        </li>
        {causes.length === 0 ? null : (
          <li>
            <p className="summary__cause-head">{causeHeading(step.fromYear)}</p>
            <ul className="summary__causes">
              {causes.map((cause) => (
                <li key={`${cause.goalId}:${cause.label}`}>
                  <span className="summary__cause-name">{causePhrase(cause)}</span>
                  <span className="summary__cause-amt">
                    月<span className="num">{manNumber(cause.monthly, { digits: 1 })}</span>
                    万円
                  </span>
                </li>
              ))}
            </ul>
          </li>
        )}
        {flow === null ? null : (
          <li>
            <Said sentences={flow} />
          </li>
        )}
      </ul>
    </section>
  )
}

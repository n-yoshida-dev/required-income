/**
 * 概要の枠（SPEC §4.1 の 1。D42）。「ながめる」の先頭に、ここだけを「文で読む所」として置き、下の図は図だけで見せる。
 *
 * - 見出しの文：「やりたいことを全部やるには、2029年から年収」→ いちばん大きい字の「948万円」に続けて「が要ります」。右に「あと2年2か月」
 *   （前の部分は入りきる幅では 1 行、入りきらないときだけ文節の切れ目で折り返す。T22）
 * - 「年収」の注を 1 回だけ
 * - 箇条書き 3 つ：今の年収との差と「◯年までは今の年収で足ります」／「◯年に変わること」と、その下に字下げした印付きの理由の行／その先の流れ（いちばん高い段と最後の段）
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
import { causeHeading, causePhraseChunks } from './causeText'
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
 * 文節のかたまりを 1 つの流れの字として描き、かたまりの間にだけ折り返してよい所（`<wbr>`）を置く（T22）。
 * 包む側の CSS（`word-break: keep-all`）が、空白と `<wbr>` のほかでは折り返さないので、入りきる幅では 1 行で出て、
 * 入りきらない幅ではかたまりの間（文節の切れ目）で折り返す。「48万円」のように数字と単位は同じかたまりにあるので割れない。
 * `<wbr>` は字を持たないので、読み上げとテストの字は文のまま。
 * `plain` のときは数字も本文の字のまま出す（見出しの文の前の部分。年を数字の字にしない）
 */
function Phrases({ chunks, plain = false }: { chunks: Sentence; plain?: boolean }) {
  return chunks.map((chunk, at) => (
    <Fragment key={at}>
      {at === 0 ? null : <wbr />}
      {plain ? chunk : <NumText text={chunk} />}
    </Fragment>
  ))
}

/** 箇条書きの文を描く。文ごとに行を改め、文の中は文節のかたまりの間だけで折り返す（`Phrases`） */
function Said({ sentences }: { sentences: readonly Sentence[] }) {
  return sentences.map((sentence, index) => (
    <span key={index} className="summary__said">
      <Phrases chunks={sentence} />
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
      {/* 見出しの文：前の部分 → 大きい金額 → 「が要ります」で 1 つの文として読む（W19）。
          前の部分は入りきる幅では 1 行、入りきらないときだけ文節の切れ目で折り返す（T22） */}
      <p className="summary__sentence">
        <span className="summary__lead">
          <Phrases chunks={requiredLead(step.fromYear, reachable)} plain />
        </span>
        <span className="summary__main">
          {/* 金額と「が要ります」は同じ行に続けて読む。入りきらないときだけ「が要ります」が次の行に落ちる */}
          <span className="summary__claim">
            {step.requiredGross === null ? (
              <span className="summary__amount">{amount}</span>
            ) : (
              <span className="summary__amount num">
                {amount}
                <span className="summary__unit">万円</span>
              </span>
            )}
            {reachable ? <span className="summary__verb">{REQUIRED_VERB}</span> : null}
          </span>
          {when === null ? null : (
            <>
              {/* 文の後ろに置く（文の邪魔をしない）。読み上げでは文と切る */}
              <span className="visually-hidden">。</span>
              <span className="summary__left">{when}</span>
            </>
          )}
        </span>
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
                  {/* 行の印（::marker）を残すため、li は list-item のままにし、言い回しと月額の左右の並びは中の span で組む（T22） */}
                  <span className="summary__cause">
                    <span className="summary__cause-name">
                      <Phrases chunks={causePhraseChunks(cause)} plain />
                    </span>
                    <span className="summary__cause-amt">
                      月<span className="num">{manNumber(cause.monthly, { digits: 1 })}</span>
                      万円
                    </span>
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

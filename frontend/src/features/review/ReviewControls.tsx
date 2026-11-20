/**
 * 「見直す」で動かす物の並び（SPEC §4.3）：目標（オン・オフと、時期・金額）→ 収入（副業・もう 1 人の年収）→ 前提（積立の利回り）。
 *
 * スマホで片手で動かせるよう、どの欄も押して 1 つずつ動かす（打つ欄は置かない。細かい直しは「計画」）。
 * 欄の名前は出さず値だけを出し（「2032年」「4,860万円」）、今の計画から動かした値だけを墨の太字にする。
 * どの目標を外すとよい、のような並べ替え・強調はしない（D31）。並びは「計画」と同じ
 */

import type { LifePlan } from '../../domain/plan/types'
import { goalName } from '../shared/goalNames'
import {
  annualIncomeView,
  goalAmount,
  goalTime,
  returnRateView,
  reviewAdults,
  shiftGoalTime,
  sideMonthlyView,
  stepAnnualIncome,
  stepGoalAmount,
  stepReturnRate,
  stepSideMonthly,
  withGoal,
  withGoalEnabled,
  type Direction,
  type KnobView,
} from './reviewDraft'

type Props = {
  /** 今の計画（動かした値を見分ける元） */
  base: LifePlan
  /** 案 */
  draft: LifePlan
  /** 動かした案を渡す */
  onChange: (next: LifePlan) => void
}

/** 動かす物の並び */
export function ReviewControls({ base, draft, onChange }: Props) {
  const adults = reviewAdults(draft)
  // 動かした値を見分けるため、今の計画の同じ欄と比べる
  const baseGoal = (id: string) => base.goals.find((goal) => goal.id === id)
  const baseAdult = (id: string) => base.adults.find((adult) => adult.id === id)

  return (
    <>
      {draft.goals.length === 0 ? null : (
        <section className="review__section" aria-labelledby="review-goals">
          <h2 id="review-goals">目標</h2>
          <ul className="review__goals">
            {draft.goals.map((goal) => {
              const name = goalName(goal, draft)
              const before = baseGoal(goal.id)
              const time = goalTime(goal)
              const amount = goalAmount(goal)
              return (
                <li key={goal.id} className={goal.enabled ? 'review__goal' : 'review__goal is-off'}>
                  <label className="review__toggle">
                    <input
                      type="checkbox"
                      checked={goal.enabled}
                      onChange={(event) =>
                        onChange(withGoalEnabled(draft, goal.id, event.target.checked))
                      }
                    />
                    <span className="review__name">{name}</span>
                  </label>
                  {/* オフの目標は計算に入らないので、時期と金額は出さない */}
                  {goal.enabled && (time !== null || amount !== null) ? (
                    <div className="review__knobs">
                      {time === null ? null : (
                        <Knob
                          className="knob knob--time"
                          label={`${name}の${time.name}`}
                          words={['早める', '遅らせる']}
                          glyphs={['‹', '›']}
                          view={time}
                          baseValue={
                            before === undefined ? null : (goalTime(before)?.value ?? null)
                          }
                          next={(direction) => {
                            const moved = shiftGoalTime(goal, direction, draft.baseYearMonth)
                            return moved === goal ? null : withGoal(draft, moved)
                          }}
                          onChange={onChange}
                        />
                      )}
                      {amount === null ? null : (
                        <Knob
                          className="knob knob--amount"
                          label={`${name}の${amount.name}`}
                          words={['減らす', '増やす']}
                          glyphs={['−', '+']}
                          view={amount}
                          baseValue={
                            before === undefined ? null : (goalAmount(before)?.value ?? null)
                          }
                          next={(direction) => {
                            const moved = stepGoalAmount(goal, direction)
                            return goalAmount(moved)?.value === amount.value
                              ? null
                              : withGoal(draft, moved)
                          }}
                          onChange={onChange}
                        />
                      )}
                    </div>
                  ) : null}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {adults.length === 0 ? null : (
        <section className="review__section" aria-labelledby="review-income">
          <h2 id="review-income">収入</h2>
          {adults.flatMap((adult) => {
            const current = draft.adults.find((other) => other.id === adult.id)
            if (current === undefined) return []
            const before = baseAdult(adult.id)
            const whose = adult.title === null ? '' : `（${adult.title}）`
            const sideLabel = `副業${whose}`
            const incomeLabel = `${adult.selfEmployed ? '所得' : '年収'}${whose}`
            const side = sideMonthlyView(current.sideMonthlyProfit)
            const income = annualIncomeView(current.annualIncome)
            return [
              <div key={`${adult.id}-side`} className="review__row">
                <span className="review__label">{sideLabel}</span>
                <Knob
                  className="knob knob--amount"
                  label={sideLabel}
                  words={['減らす', '増やす']}
                  glyphs={['−', '+']}
                  view={side}
                  baseValue={before?.sideMonthlyProfit ?? null}
                  next={(direction) => {
                    const moved = stepSideMonthly(draft, adult.id, direction)
                    return moved.adults.find((other) => other.id === adult.id)
                      ?.sideMonthlyProfit === side.value
                      ? null
                      : moved
                  }}
                  onChange={onChange}
                />
              </div>,
              adult.showsIncome ? (
                <div key={`${adult.id}-income`} className="review__row">
                  <span className="review__label">{incomeLabel}</span>
                  <Knob
                    className="knob knob--amount"
                    label={incomeLabel}
                    words={['減らす', '増やす']}
                    glyphs={['−', '+']}
                    view={income}
                    baseValue={before?.annualIncome ?? null}
                    next={(direction) => {
                      const moved = stepAnnualIncome(draft, adult.id, direction)
                      return moved.adults.find((other) => other.id === adult.id)?.annualIncome ===
                        income.value
                        ? null
                        : moved
                    }}
                    onChange={onChange}
                  />
                </div>
              ) : null,
            ]
          })}
        </section>
      )}

      <section className="review__section" aria-labelledby="review-assumptions">
        <h2 id="review-assumptions">前提</h2>
        <div className="review__row">
          <span className="review__label">積立の利回り</span>
          <Knob
            className="knob knob--amount"
            label="積立の利回り"
            words={['下げる', '上げる']}
            glyphs={['−', '+']}
            view={returnRateView(draft.assumptions.investmentReturnRate)}
            baseValue={base.assumptions.investmentReturnRate}
            next={(direction) => {
              const moved = stepReturnRate(draft, direction)
              return moved.assumptions.investmentReturnRate ===
                draft.assumptions.investmentReturnRate
                ? null
                : moved
            }}
            onChange={onChange}
          />
        </div>
      </section>
    </>
  )
}

/**
 * 押して 1 つずつ動かす欄（[−] 値 [+]）。値が今の計画と違えば墨の太字。端まで来た側のボタンは押せない
 */
function Knob({
  className,
  label,
  words,
  glyphs,
  view,
  baseValue,
  next,
  onChange,
}: {
  className: string
  /** 何の欄か（読み上げ。「家の買う年」） */
  label: string
  /** 減らす側・増やす側の動きの言葉（読み上げ。「早める」「遅らせる」） */
  words: readonly [string, string]
  /** ボタンの字 */
  glyphs: readonly [string, string]
  view: KnobView
  /** 今の計画の値。違えば「動かした」と見せる（今の計画に無い欄なら null） */
  baseValue: number | null
  /** その向きに動かした案。動かせなければ null */
  next: (direction: Direction) => LifePlan | null
  onChange: (next: LifePlan) => void
}) {
  const down = next(-1)
  const up = next(1)
  const changed = baseValue !== null && baseValue !== view.value
  return (
    <div className={className} role="group" aria-label={label}>
      <button
        type="button"
        className="knob__step"
        aria-label={`${label}を${words[0]}`}
        disabled={down === null}
        onClick={() => {
          if (down !== null) onChange(down)
        }}
      >
        {glyphs[0]}
      </button>
      {/* 数字と単位を分ける（単位は本文の字で小さく。DESIGN.md「Typography」） */}
      <output className={changed ? 'knob__value is-changed' : 'knob__value'}>
        {view.parts.map((part, index) =>
          part.unit ? (
            <span key={index} className="knob__unit">
              {part.text}
            </span>
          ) : (
            <span key={index} className="num">
              {part.text}
            </span>
          ),
        )}
      </output>
      <button
        type="button"
        className="knob__step"
        aria-label={`${label}を${words[1]}`}
        disabled={up === null}
        onClick={() => {
          if (up !== null) onChange(up)
        }}
      >
        {glyphs[1]}
      </button>
    </div>
  )
}

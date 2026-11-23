/**
 * 「計画」の家族の区分（SPEC §4.2。T21）：大人（1〜2 人）と子の生まれ年。1 人 1 行。
 *
 * - 「本人 [1980] 年」「パートナー [1982] 年 [外す]」「1 人目 [2010] 年 [6] 月 [外す]」。「外す」はその人の行の右端に置く
 * - 欄の読み上げの名前は「本人の生まれ年」のようにする（見える字は「本人」「パートナー」だけ）
 * - 大人が 1 人のときは、本人の行の下に「パートナーを足す」。子は小見出し「子」の下に行を並べ、最後に「子を足す」
 * - 働き方・年収などは収入の区分（`IncomeSection.tsx`）、市区町村は暮らしの区分（`LivingSection.tsx`）
 */

import { appDefaults } from '../../data/appData'
import { adultTemplate, childTemplate, syncChildCostGoals } from '../../domain/plan/defaults'
import { adultName, PARTNER_NAME } from '../shared/adultNames'
import { ConfirmButton } from '../shared/ConfirmButton'
import { IntegerField, YearMonthField } from '../shared/fields/Fields'
import { nextId } from '../shared/nextId'
import { INPUT_LIMITS } from './inputLimits'
import { fieldState, type PlanEditor } from './planEditor'
import { touchedKey } from './touched'

type Props = { editor: PlanEditor }

/** 家族の区分の中身 */
export function FamilySection({ editor }: Props) {
  const { plan } = editor
  const base = plan.baseYearMonth

  return (
    <>
      <div className="plan__people">
        {plan.adults.map((adult, index) => {
          const name = adultName(index)
          const key = touchedKey('adults', adult.id, 'birthYear')
          return (
            <div key={adult.id} className="plan__person">
              <IntegerField
                label={name}
                labelHidden="の生まれ年"
                {...fieldState(editor, key)}
                unit="年"
                value={adult.birthYear}
                min={base.year - INPUT_LIMITS.adultBirth.yearsBeforeMax}
                max={base.year - INPUT_LIMITS.adultBirth.yearsBeforeMin}
                onChange={(birthYear) =>
                  editor.set(key, {
                    ...plan,
                    adults: plan.adults.map((other) =>
                      other.id === adult.id ? { ...other, birthYear } : other,
                    ),
                  })
                }
              />
              {/* 本人は外せない。パートナーの「外す」は同じ行の右端（どの人に掛かるかを行で分かるように） */}
              {index === 0 ? null : (
                <ConfirmButton
                  className="plan__remove"
                  label="外す"
                  confirmLabel="本当に外す"
                  ariaLabel={`${name}を外す`}
                  confirmAriaLabel={`${name}を本当に外す`}
                  onConfirm={() =>
                    editor.remove(touchedKey('adults', adult.id), {
                      ...plan,
                      adults: plan.adults.filter((other) => other.id !== adult.id),
                    })
                  }
                />
              )}
            </div>
          )
        })}
        {plan.adults.length < 2 ? (
          <button
            type="button"
            className="plan__add"
            onClick={() =>
              editor.add({
                ...plan,
                adults: [
                  ...plan.adults,
                  adultTemplate(
                    appDefaults,
                    base,
                    nextId(
                      'adult',
                      plan.adults.map((adult) => adult.id),
                    ),
                  ),
                ],
              })
            }
          >
            {PARTNER_NAME}を足す
          </button>
        ) : null}
      </div>

      <div className="plan__block">
        <h2 className="plan__subhead">子</h2>
        <div className="plan__people">
          {plan.children.map((child, index) => {
            const key = touchedKey('children', child.id, 'birth')
            const order = `${index + 1} 人目`
            return (
              <div key={child.id} className="plan__person">
                <YearMonthField
                  label={order}
                  labelHidden="の子の生まれ年"
                  monthLabel={`${order}の子の生まれ月`}
                  {...fieldState(editor, key)}
                  value={{ year: child.birthYear, month: child.birthMonth }}
                  minYear={base.year - INPUT_LIMITS.childBirth.yearsBefore}
                  maxYear={base.year + INPUT_LIMITS.childBirth.yearsAfter}
                  onChange={(birth) =>
                    editor.set(key, {
                      ...plan,
                      children: plan.children.map((other) =>
                        other.id === child.id
                          ? { ...other, birthYear: birth.year, birthMonth: birth.month }
                          : other,
                      ),
                    })
                  }
                />
                <ConfirmButton
                  className="plan__remove"
                  label="外す"
                  confirmLabel="本当に外す"
                  ariaLabel={`${order}の子を外す`}
                  confirmAriaLabel={`${order}の子を本当に外す`}
                  onConfirm={() => {
                    // 子を外すと、その子の子の費用のカードも消える（SPEC §2.1）。カードの印もまとめて外す
                    const children = plan.children.filter((other) => other.id !== child.id)
                    const goals = syncChildCostGoals({ children, goals: plan.goals }, appDefaults)
                    const removedGoals = plan.goals
                      .filter((goal) => !goals.includes(goal))
                      .map((goal) => touchedKey('goals', goal.id))
                    editor.remove([touchedKey('children', child.id), ...removedGoals], {
                      ...plan,
                      children,
                      goals,
                    })
                  }}
                />
              </div>
            )
          })}
          <button
            type="button"
            className="plan__add"
            onClick={() => {
              // 子を足すと、その子の子の費用のカード（雛形）も付く（SPEC §2.1）
              const children = [
                ...plan.children,
                childTemplate(
                  appDefaults,
                  base,
                  nextId(
                    'child',
                    plan.children.map((child) => child.id),
                  ),
                ),
              ]
              editor.add({
                ...plan,
                children,
                goals: syncChildCostGoals({ children, goals: plan.goals }, appDefaults),
              })
            }}
          >
            子を足す
          </button>
        </div>
      </div>
    </>
  )
}

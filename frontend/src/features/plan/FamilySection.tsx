/**
 * 「計画」の家族（SPEC §4.2 の 1 番目）：大人（1〜2 人）・子・住んでいる市区町村。
 *
 * 大人は生まれ年・働き方・今の年収・見込み（上がり方と「この年からこの年収」）・副業・退職の年齢。
 * 働いていない大人には、年収と見込みの欄を出さない（入れても使われないため。値は残す）。
 */

import { appDefaults } from '../../data/appData'
import { adultTemplate, childTemplate, syncChildCostGoals } from '../../domain/plan/defaults'
import type { Adult, LifePlan, OutlookStep, WorkStyle } from '../../domain/plan/types'
import {
  ChoiceField,
  IntegerField,
  MoneyField,
  MunicipalityField,
  RateField,
  YearMonthField,
} from '../shared/fields/Fields'
import { ConfirmButton } from '../shared/ConfirmButton'
import { nextId } from '../shared/nextId'
import { INPUT_LIMITS } from './inputLimits'
import { fieldState, type PlanEditor } from './planEditor'
import { touchedKey } from './touched'

/** 働き方の選択肢 */
const WORK_STYLES: readonly { value: WorkStyle; label: string }[] = [
  { value: 'employee', label: '会社員' },
  { value: 'selfEmployed', label: '自営業' },
  { value: 'notWorking', label: '働いていない' },
]

/** 大人の見出し（先頭が本人） */
const ADULT_TITLES = ['本人', 'もう 1 人'] as const

type Props = { editor: PlanEditor }

/** 家族のかたまり */
export function FamilySection({ editor }: Props) {
  const { plan } = editor
  const base = plan.baseYearMonth

  /** 大人 1 人を差し替えた計画 */
  const withAdult = (next: Adult): LifePlan => ({
    ...plan,
    adults: plan.adults.map((adult) => (adult.id === next.id ? next : adult)),
  })

  return (
    <section className="plan__section" aria-labelledby="plan-family">
      <h2 id="plan-family">家族</h2>

      {plan.adults.map((adult, index) => (
        <AdultBlock
          key={adult.id}
          title={ADULT_TITLES[index] ?? `${index + 1} 人目`}
          adult={adult}
          editor={editor}
          onChange={(key, next) => editor.set(touchedKey('adults', adult.id, key), withAdult(next))}
          onRemove={
            index === 0
              ? null
              : () =>
                  editor.remove(touchedKey('adults', adult.id), {
                    ...plan,
                    adults: plan.adults.filter((other) => other.id !== adult.id),
                  })
          }
        />
      ))}
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
          もう 1 人を足す
        </button>
      ) : null}

      <div className="plan__block">
        <h3>子</h3>
        {plan.children.map((child, index) => {
          const key = touchedKey('children', child.id, 'birth')
          return (
            <div key={child.id} className="plan__row">
              <YearMonthField
                label={`${index + 1} 人目`}
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
                ariaLabel={`${index + 1} 人目の子を外す`}
                confirmAriaLabel={`${index + 1} 人目の子を本当に外す`}
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

      <MunicipalityField
        label="市区町村"
        {...fieldState(editor, 'municipality')}
        value={plan.municipality}
        onChange={(code) => editor.set('municipality', { ...plan, municipality: code })}
      />
    </section>
  )
}

/** 大人 1 人の欄 */
function AdultBlock({
  title,
  adult,
  editor,
  onChange,
  onRemove,
}: {
  title: string
  adult: Adult
  editor: PlanEditor
  /** 項目 1 つを直した大人を渡す */
  onChange: (key: keyof Adult, next: Adult) => void
  /** 外すとき。本人は外せないので null */
  onRemove: (() => void) | null
}) {
  const base = editor.plan.baseYearMonth
  const state = (key: keyof Adult) => fieldState(editor, touchedKey('adults', adult.id, key))
  const working = adult.workStyle !== 'notWorking'

  return (
    <div className="plan__block">
      <div className="plan__block-head">
        <h3>{title}</h3>
        {onRemove === null ? null : (
          <ConfirmButton
            className="plan__remove"
            label="外す"
            confirmLabel="本当に外す"
            ariaLabel={`${title}を外す`}
            confirmAriaLabel={`${title}を本当に外す`}
            onConfirm={onRemove}
          />
        )}
      </div>
      <IntegerField
        label="生まれ年"
        {...state('birthYear')}
        unit="年"
        value={adult.birthYear}
        min={base.year - INPUT_LIMITS.adultBirth.yearsBeforeMax}
        max={base.year - INPUT_LIMITS.adultBirth.yearsBeforeMin}
        onChange={(birthYear) => onChange('birthYear', { ...adult, birthYear })}
      />
      <ChoiceField
        label="働き方"
        touched={state('workStyle').touched}
        value={adult.workStyle}
        options={WORK_STYLES}
        onChange={(workStyle) => onChange('workStyle', { ...adult, workStyle })}
      />
      {working ? (
        <>
          <MoneyField
            label={adult.workStyle === 'selfEmployed' ? '所得（年）' : '年収（額面）'}
            {...state('annualIncome')}
            value={adult.annualIncome}
            onChange={(annualIncome) => onChange('annualIncome', { ...adult, annualIncome })}
          />
          <RateField
            label="毎年の上がり方"
            {...state('raiseRate')}
            unit="%/年"
            value={adult.raiseRate}
            onChange={(raiseRate) => onChange('raiseRate', { ...adult, raiseRate })}
          />
          <OutlookSteps
            adult={adult}
            editor={editor}
            onChange={(outlookSteps) => onChange('outlookSteps', { ...adult, outlookSteps })}
          />
        </>
      ) : null}
      <MoneyField
        label="副業の所得"
        perMonth
        {...state('sideMonthlyProfit')}
        value={adult.sideMonthlyProfit}
        onChange={(sideMonthlyProfit) =>
          onChange('sideMonthlyProfit', { ...adult, sideMonthlyProfit })
        }
      />
      <IntegerField
        label="退職の年齢"
        {...state('retirementAge')}
        unit="歳"
        value={adult.retirementAge}
        min={INPUT_LIMITS.retirementAge.min}
        max={INPUT_LIMITS.retirementAge.max}
        onChange={(retirementAge) => onChange('retirementAge', { ...adult, retirementAge })}
      />
    </div>
  )
}

/**
 * 見込みの「この年からこの年収」の行。足す・外す。
 * 行の印は全体で 1 つ（`adults.<id>.outlookSteps`）。問題（同じ年が 2 つ）も全体に出す
 */
function OutlookSteps({
  adult,
  editor,
  onChange,
}: {
  adult: Adult
  editor: PlanEditor
  onChange: (steps: OutlookStep[]) => void
}) {
  const base = editor.plan.baseYearMonth
  const { touched, issue } = fieldState(editor, touchedKey('adults', adult.id, 'outlookSteps'))
  const replace = (index: number, step: OutlookStep) =>
    onChange(adult.outlookSteps.map((other, i) => (i === index ? step : other)))
  const last = adult.outlookSteps[adult.outlookSteps.length - 1]

  return (
    <div className="plan__outlook">
      {adult.outlookSteps.map((step, index) => (
        // 今年以前の段は計算に使われない（今の年収は年収の欄が持つ）。消さずに薄く出す
        <div key={index} className={step.year <= base.year ? 'plan__row is-past' : 'plan__row'}>
          <IntegerField
            label="この年から"
            touched={touched}
            unit="年"
            value={step.year}
            min={base.year - INPUT_LIMITS.planYear.yearsBefore}
            max={base.year + INPUT_LIMITS.planYear.yearsAfter}
            onChange={(year) => replace(index, { ...step, year })}
          />
          <MoneyField
            label="この年収"
            touched={touched}
            value={step.annualIncome}
            onChange={(annualIncome) => replace(index, { ...step, annualIncome })}
          />
          {step.year <= base.year ? <span className="plan__past">計算に使わない</span> : null}
          <button
            type="button"
            className="plan__remove"
            aria-label={`${step.year}年からの見込みを外す`}
            onClick={() => onChange(adult.outlookSteps.filter((_, i) => i !== index))}
          >
            外す
          </button>
        </div>
      ))}
      {issue === null ? null : (
        <p className="field__error" role="alert">
          {issue}
        </p>
      )}
      <button
        type="button"
        className="plan__add"
        onClick={() =>
          onChange([
            ...adult.outlookSteps,
            // 最後の段の翌年（無い・過ぎていれば来年）から、今の年収のまま。本人が年と年収を直す
            {
              year: Math.max(last?.year ?? base.year, base.year) + 1,
              annualIncome: last?.annualIncome ?? adult.annualIncome,
            },
          ])
        }
      >
        見込みを足す
      </button>
    </div>
  )
}

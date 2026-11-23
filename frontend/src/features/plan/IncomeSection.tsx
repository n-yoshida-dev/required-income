/**
 * 「計画」の収入の区分（SPEC §4.2。T21）：大人ごとに 働き方・年収（自営業は所得）。
 * 畳み「この先の収入・副業・退職」に 毎年の上がり方・見込み（「この年からこの年収」）・副業の所得・退職の年齢。
 *
 * 大人の小見出しは「本人」「パートナー」。ここには「外す」を置かない（外すのは家族の区分だけ）。
 * 働いていない大人には、年収・上がり方・見込みの欄を出さない（入れても使われないため。値は残す）。
 */

import type { Adult, LifePlan, OutlookStep, WorkStyle } from '../../domain/plan/types'
import { adultName } from '../shared/adultNames'
import { ChoiceField, IntegerField, MoneyField, RateField } from '../shared/fields/Fields'
import { Fold } from './Fold'
import { INPUT_LIMITS } from './inputLimits'
import { fieldState, type PlanEditor } from './planEditor'
import { touchedKey } from './touched'

/** 働き方の選択肢 */
const WORK_STYLES: readonly { value: WorkStyle; label: string }[] = [
  { value: 'employee', label: '会社員' },
  { value: 'selfEmployed', label: '自営業' },
  { value: 'notWorking', label: '働いていない' },
]

/** 畳みの中に置く大人の項目（誤りがあれば畳みを開く） */
const FOLDED_KEYS: readonly (keyof Adult)[] = [
  'raiseRate',
  'outlookSteps',
  'sideMonthlyProfit',
  'retirementAge',
]

type Props = { editor: PlanEditor }

/** 収入の区分の中身 */
export function IncomeSection({ editor }: Props) {
  const { plan } = editor

  /** 大人 1 人を差し替えた計画 */
  const withAdult = (next: Adult): LifePlan => ({
    ...plan,
    adults: plan.adults.map((adult) => (adult.id === next.id ? next : adult)),
  })

  return (
    <>
      {plan.adults.map((adult, index) => (
        <AdultIncome
          key={adult.id}
          title={adultName(index)}
          adult={adult}
          editor={editor}
          onChange={(key, next) => editor.set(touchedKey('adults', adult.id, key), withAdult(next))}
        />
      ))}
    </>
  )
}

/** 大人 1 人の収入の欄 */
function AdultIncome({
  title,
  adult,
  editor,
  onChange,
}: {
  title: string
  adult: Adult
  editor: PlanEditor
  /** 項目 1 つを直した大人を渡す */
  onChange: (key: keyof Adult, next: Adult) => void
}) {
  const state = (key: keyof Adult) => fieldState(editor, touchedKey('adults', adult.id, key))
  const working = adult.workStyle !== 'notWorking'
  const foldHasIssue = FOLDED_KEYS.some((key) =>
    editor.issues.has(touchedKey('adults', adult.id, key)),
  )

  return (
    <div className="plan__block">
      <h2 className="plan__subhead">{title}</h2>
      <ChoiceField
        label="働き方"
        touched={state('workStyle').touched}
        value={adult.workStyle}
        options={WORK_STYLES}
        onChange={(workStyle) => onChange('workStyle', { ...adult, workStyle })}
      />
      {working ? (
        <MoneyField
          label={adult.workStyle === 'selfEmployed' ? '所得（年）' : '年収（額面）'}
          {...state('annualIncome')}
          value={adult.annualIncome}
          onChange={(annualIncome) => onChange('annualIncome', { ...adult, annualIncome })}
        />
      ) : null}
      <Fold summary="この先の収入・副業・退職" forceOpen={foldHasIssue}>
        {working ? (
          <>
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
      </Fold>
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

/**
 * 「計画」の目標カード（SPEC §4.2）。自由入力（T6）・家（T7）・車（T8）・子の費用（T9）・大学資金と老後資金（T10）のカード。
 *
 * - 閉じたまま「毎月いくら」が読める。開くと入力とそのカードの帯（`expandGoal` の帯をそのまま並べる。児童手当を回す帯は除く）
 * - 足す：種類（大学資金（子ごと）・老後資金・家・車・毎月の支出・毎月の収入・一度きり）を選ぶと、雛形（`domain/plan/defaults.ts`）の値で開いた状態で入る
 * - 消す：2 回押す（1 回目で「本当に消す」に変わる）。誤って押しても消えないように
 * - 家のカードは、開くと借りる額の目安（借りる額 ÷ 買う年の見込みの世帯年収。SPEC §3.7）も出す
 * - 大学資金・老後資金のカードは、開くと使う月の到達額とその内訳（児童手当・家計から足す・貯まっている額）を出す
 * - 閉じた見出しの 2 行目に重さ（「外すと 61万円下がる」。オフのカードは「入れると」。基準の「いちばん高い段 998万円」は節の頭に 1 回だけ。SPEC §3.8・§4.2・T11）。
 *   計算は `useGoalImpacts` が後から出す。数字は呼び出し側から受け取るだけ
 */

import type { ReactNode } from 'react'
import { appDefaults, masterTables } from '../../data/appData'
import { FIRST_GRADE } from '../../domain/expense/education'
import { CRAM_GRADE_RANGE, withoutChildOrder } from '../../domain/plan/bands/childCost'
import { homeUpfrontCost } from '../../domain/plan/bands/home'
import {
  carGoalTemplate,
  changeCarPayment,
  changeCarReplacement,
  changeCustomVariant,
  cramSchoolTemplate,
  customGoalTemplate,
  customVariantOf,
  homeGoalTemplate,
  changeUniversityCourse,
  retirementGoalTemplate,
  UNIVERSITY_COURSES,
  universityCourseTarget,
  universityGoalTemplate,
} from '../../domain/plan/defaults'
import { homeLoanCheck } from '../../domain/plan/homeLoan'
import type {
  Band,
  CarGoal,
  CarPayment,
  ChildCostGoal,
  CramSchool,
  CustomGoal,
  CustomVariant,
  Goal,
  GoalImpact,
  HomeGoal,
  LifePlan,
  Notice,
  PeakGross,
  RetirementGoal,
  SchoolType,
  SchoolTypes,
  UniversityCourse,
  UniversityGoal,
} from '../../domain/plan/types'
import { addMonths } from '../../domain/plan/yearMonth'
import { noticeLines } from '../home/noticeText'
import { ConfirmButton } from '../shared/ConfirmButton'
import {
  ChoiceField,
  IntegerField,
  MoneyField,
  TextField,
  YearMonthField,
} from '../shared/fields/Fields'
import { formatEndExclusive, formatMan, formatYearMonth, manNumber } from '../shared/format'
import { goalName } from '../shared/goalNames'
import { nextId } from '../shared/nextId'
import { FUND_DIGITS, fundRows } from './fundRows'
import { cardMonthly, goalBands, goalFund } from './goalCard'
import { impactForCard, impactText, peakText, type ComputedImpacts } from './impactText'
import { INPUT_LIMITS } from './inputLimits'
import { fieldState, type PlanEditor } from './planEditor'
import { cramRowIssueKey } from './planIssues'
import { touchedKey } from './touched'

/** 自由入力のカードの型の選択肢。並びは足すボタンと同じ */
const VARIANTS: readonly { value: CustomVariant; label: string }[] = [
  { value: 'monthlyExpense', label: '毎月の支出' },
  { value: 'monthlyIncome', label: '毎月の収入' },
  { value: 'onceExpense', label: '一度きり' },
]

/** 毎月 ⇄ 一度きりの切り替えで雛形に戻る欄（金額の意味と時期の持ち方が変わる） */
const SHAPE_FIELDS = ['amount', 'from', 'to', 'at', 'saved'] as const

/** カードに出す知らせ（そのカードに関わる物） */
const CARD_NOTICE_KINDS: readonly Notice['kind'][] = [
  'onceGoalPast',
  'onceGoalSoon',
  'homeSavingSoon',
  'homeLoanHeavy',
  'carSavingSoon',
  'nisaLimit',
  'allowanceCovers',
  'fundDeadlinePast',
]

/** 大学資金の児童手当の選択肢 */
const ALLOWANCE_CHOICES: readonly { value: 'allocate' | 'keep'; label: string }[] = [
  { value: 'allocate', label: '回す' },
  { value: 'keep', label: '回さない' },
]

/** 大学資金の進路の名前（D37） */
const UNIVERSITY_COURSE_NAMES: Readonly<Record<UniversityCourse, string>> = {
  privateScience: '私立理系',
  privateHumanities: '私立文系',
  nationalPublic: '国立',
}

/**
 * 大学資金の進路の選択肢。名前の横に、選ぶと入る目標額（4 年ぶん）を添える（説明の文で読ませず、額で読ませる）。
 * 額は `university-cost.json` から組み立てる（`universityCourseTarget`）
 */
const UNIVERSITY_COURSE_OPTIONS: readonly { value: UniversityCourse; label: ReactNode }[] =
  UNIVERSITY_COURSES.map((course) => ({
    value: course,
    label: (
      <>
        <span className="choice__name">{UNIVERSITY_COURSE_NAMES[course]}</span>
        <span className="choice__amount">
          <span className="num">
            {manNumber(universityCourseTarget(appDefaults, masterTables.universityCost, course))}
          </span>
          <span className="field__unit">万円</span>
        </span>
      </>
    ),
  }))

/** 大学資金の置き場の選択肢 */
const UNIVERSITY_VEHICLES: readonly { value: UniversityGoal['vehicle']; label: string }[] = [
  { value: 'childNisa', label: 'NISA' },
  { value: 'deposit', label: '預金' },
]

/** 老後資金の置き場の選択肢 */
const RETIREMENT_VEHICLES: readonly { value: RetirementGoal['vehicle']; label: string }[] = [
  { value: 'nisa', label: 'NISA' },
  { value: 'deposit', label: '預金' },
]

/** 子の費用のカードの進路（小・中・高） */
const SCHOOL_STAGES: readonly { key: keyof SchoolTypes; label: string }[] = [
  { key: 'elementary', label: '小学校' },
  { key: 'juniorHigh', label: '中学校' },
  { key: 'highSchool', label: '高校' },
]

/** 公立・私立の選択肢 */
const SCHOOL_TYPE_OPTIONS: readonly { value: SchoolType; label: string }[] = [
  { value: 'public', label: '公立' },
  { value: 'private', label: '私立' },
]

/** 塾の学年の選択肢（小 1 = 1 〜 高 3 = 12）。値は select に載せるため文字列 */
const GRADE_OPTIONS: readonly { value: string; label: string }[] = Array.from(
  { length: CRAM_GRADE_RANGE.max - CRAM_GRADE_RANGE.min + 1 },
  (_, i) => {
    const grade = CRAM_GRADE_RANGE.min + i
    return { value: String(grade), label: gradeLabel(grade) }
  },
)

/** 学年の数（小 1 = 1、中 1 = 7、高 1 = 10）を「中2」のような呼び方にする */
function gradeLabel(grade: number): string {
  if (grade >= FIRST_GRADE.highSchool) return `高${grade - FIRST_GRADE.highSchool + 1}`
  if (grade >= FIRST_GRADE.juniorHigh) return `中${grade - FIRST_GRADE.juniorHigh + 1}`
  return `小${grade - FIRST_GRADE.elementary + 1}`
}

/** 習い事の選択肢。平均は統計の平均（null） */
const LESSON_CHOICES: readonly { value: 'average' | 'amount'; label: string }[] = [
  { value: 'average', label: '平均' },
  { value: 'amount', label: '金額を入れる' },
]

/** 保育園の選択肢。通わないなら null */
const CHILDCARE_CHOICES: readonly { value: 'none' | 'attend'; label: string }[] = [
  { value: 'none', label: '通わない' },
  { value: 'attend', label: '通う' },
]

/** 車の払い方の選択肢 */
const CAR_PAYMENTS: readonly { value: CarPayment['type']; label: string }[] = [
  { value: 'cash', label: '現金' },
  { value: 'loan', label: 'ローン' },
]

/** 車の買い替えの選択肢 */
const CAR_REPLACEMENTS: readonly { value: 'replace' | 'keep'; label: string }[] = [
  { value: 'replace', label: '買い替える' },
  { value: 'keep', label: '買い替えない' },
]

type Props = {
  editor: PlanEditor
  /** 開いているカードの id */
  openIds: ReadonlySet<string>
  /** カードを開く・閉じる */
  onToggle: (goalId: string, open: boolean) => void
  /** 計算の知らせ（カードに関わる物だけをそのカードに出す） */
  notices: readonly Notice[]
  /** カードの重さと、その元にした計画（`useGoalImpacts`） */
  impacts: ComputedImpacts
  /** 最後に計算できた計画のいちばん高い段（節の頭に基準として 1 回だけ出す）。計算できていなければ null */
  peak: PeakGross | null
}

/** 目標カードのかたまり */
export function GoalCards({ editor, openIds, onToggle, notices, impacts, peak }: Props) {
  const peakLabel = peak === null ? null : peakText(peak)
  const { plan } = editor

  /** カードを足し、開く */
  const add = (make: (id: string) => Goal) => {
    const id = nextId(
      'goal',
      plan.goals.map((goal) => goal.id),
    )
    editor.add({ ...plan, goals: [...plan.goals, make(id)] })
    onToggle(id, true)
  }

  return (
    <section className="plan__section" aria-labelledby="plan-goals">
      {/* 重さの基準は節の頭に 1 回だけ。「ながめる」と同じ計算の結果から同時に出るので、後から出て下を動かすことはない */}
      <div className="plan__goals-head">
        <h2 id="plan-goals">目標</h2>
        {peakLabel === null ? null : (
          <p className="plan__peak">
            いちばん高い段{' '}
            <span className={peakLabel.solved ? 'plan__peak-value num' : undefined}>
              {peakLabel.amount}
            </span>
          </p>
        )}
      </div>
      <ul className="cards">
        {plan.goals.map((goal) => (
          <li key={goal.id} id={`goal-${goal.id}`}>
            <GoalCard
              goal={goal}
              editor={editor}
              open={openIds.has(goal.id)}
              onToggle={(open) => onToggle(goal.id, open)}
              impact={impactForCard(impacts, goal)}
              notices={notices.filter(
                (notice) =>
                  CARD_NOTICE_KINDS.includes(notice.kind) &&
                  'goalId' in notice &&
                  notice.goalId === goal.id,
              )}
            />
          </li>
        ))}
      </ul>
      <div className="plan__adds" role="group" aria-label="カードを足す">
        {/* 大学資金は子ごとに 1 枚まで。まだカードの無い子の分だけ出す */}
        {plan.children
          .filter(
            (child) =>
              !plan.goals.some((goal) => goal.kind === 'university' && goal.childId === child.id),
          )
          .map((child) => {
            const template = universityGoalTemplate(
              appDefaults,
              masterTables.universityCost,
              child.id,
              '',
            )
            return (
              <button
                key={child.id}
                type="button"
                className="plan__add"
                onClick={() => add((id) => ({ ...template, id }))}
              >
                {goalName(template, plan)}を足す
              </button>
            )
          })}
        {/* 老後資金は世帯で 1 枚（NISA の上限を世帯で数えるため） */}
        {plan.goals.some((goal) => goal.kind === 'retirement') ? null : (
          <button
            type="button"
            className="plan__add"
            onClick={() => add((id) => retirementGoalTemplate(appDefaults, plan.adults, id))}
          >
            老後資金を足す
          </button>
        )}
        <button
          type="button"
          className="plan__add"
          onClick={() => add((id) => homeGoalTemplate(appDefaults, plan.baseYearMonth, id))}
        >
          家を足す
        </button>
        <button
          type="button"
          className="plan__add"
          onClick={() => add((id) => carGoalTemplate(appDefaults, plan.baseYearMonth, id))}
        >
          車を足す
        </button>
        {VARIANTS.map((variant) => (
          <button
            key={variant.value}
            type="button"
            className="plan__add"
            onClick={() =>
              add((id) => customGoalTemplate(appDefaults, plan.baseYearMonth, id, variant.value))
            }
          >
            {variant.label}を足す
          </button>
        ))}
      </div>
    </section>
  )
}

/** カード 1 枚。閉じた見出しに名前と毎月いくら、その下に重さ。開くと入力と帯 */
function GoalCard({
  goal,
  editor,
  open,
  onToggle,
  impact,
  notices,
}: {
  goal: Goal
  editor: PlanEditor
  open: boolean
  onToggle: (open: boolean) => void
  impact: GoalImpact | null
  notices: readonly Notice[]
}) {
  const { plan } = editor
  const bands = goalBands(plan, goal, appDefaults, masterTables)
  const monthly = bands.ok ? cardMonthly(bands.bands, plan.baseYearMonth) : null
  const name = goalName(goal, plan)
  // 重さは、計算の元にしたカードと中身が同じときだけ渡ってくる（`impactForCard`）
  const weight = impact === null ? null : impactText(impact)

  return (
    <details
      className={goal.enabled ? 'card' : 'card is-off'}
      open={open}
      onToggle={(event) => {
        // 開閉の状態を親と揃える（親から開いたとき＝カードを足したときも同じ値なら何もしない）
        if (event.currentTarget.open !== open) onToggle(event.currentTarget.open)
      }}
    >
      <summary className="card__summary">
        <span className="card__name">{name === '' ? '（名前なし）' : name}</span>
        <span className="card__monthly num">
          {monthly === null
            ? '—'
            : `${monthly.income ? '収入 ' : ''}月 ${formatMan(monthly.monthly, { digits: 1 })}`}
        </span>
        {/* 2 行目はいつも置く。重さは後から出るので、出る前も空の 1 行で高さを取っておく（下の物を動かさない） */}
        <span className="card__sub">
          {goal.enabled ? null : <span className="card__off">オフ</span>}
          <span className="card__impact">
            {weight === null ? (
              ' '
            ) : (
              <>
                {weight.lead}{' '}
                {weight.amount === null ? null : (
                  <span className="card__impact-value num">{weight.amount}</span>
                )}
                {weight.tail}
              </>
            )}
          </span>
        </span>
      </summary>

      <div className="card__body">
        {goal.kind === 'custom' ? (
          <CustomGoalInputs goal={goal} editor={editor} />
        ) : goal.kind === 'home' ? (
          <HomeGoalInputs goal={goal} editor={editor} />
        ) : goal.kind === 'car' ? (
          <CarGoalInputs goal={goal} editor={editor} />
        ) : goal.kind === 'childCost' ? (
          <ChildCostGoalInputs goal={goal} editor={editor} />
        ) : goal.kind === 'university' ? (
          <UniversityGoalInputs goal={goal} editor={editor} />
        ) : (
          <RetirementGoalInputs goal={goal} editor={editor} />
        )}

        {bands.ok ? (
          <ul className="card__bands" aria-label={`${name}の帯`}>
            {/* 児童手当を回す分（earmarked）は要る年収に入らないので、帯の並びに入れず、下の到達額の中に置く */}
            {bands.bands
              .filter((band) => band.kind !== 'earmarked')
              .map((band, index) => (
                <li key={`${band.label}-${index}`}>
                  {/* 子ごとのカードの中では、帯の名前の「（◯人目）」を省く（カードの名前に出ている） */}
                  <span>
                    {goal.kind === 'childCost' || goal.kind === 'university'
                      ? withoutChildOrder(band.label)
                      : band.label}
                  </span>
                  <span className="num">
                    {band.kind === 'income' ? '収入 ' : ''}月{' '}
                    {formatMan(band.monthly, { digits: 1 })}
                  </span>
                  <span className="card__period">
                    {formatYearMonth(band.from)}〜{formatEndExclusive(band.to)}
                  </span>
                </li>
              ))}
          </ul>
        ) : hasFieldIssue(editor, goal) ? null : (
          // 欄の下に理由が出ている（学年が逆など）ときは、同じ誤りを帯の所に重ねて出さない
          <p className="field__error" role="alert">
            {bands.message}
          </p>
        )}

        {goal.kind === 'home' && bands.ok ? <HomeLoanFacts goal={goal} plan={plan} /> : null}
        {(goal.kind === 'university' || goal.kind === 'retirement') && bands.ok ? (
          <FundFacts goal={goal} plan={plan} bands={bands.bands} />
        ) : null}

        {notices.length === 0 ? null : (
          <ul className="card__notices">
            {noticeLines(notices).map((line, index) => (
              <li key={index}>{line}</li>
            ))}
          </ul>
        )}

        <CardActions goal={goal} editor={editor} />
      </div>
    </details>
  )
}

/** そのカードの欄に、欄をまたぐ契約違反の理由が出ているか（`planIssues`） */
function hasFieldIssue(editor: PlanEditor, goal: Goal): boolean {
  const prefix = `${touchedKey('goals', goal.id)}.`
  return [...editor.issues.keys()].some((key) => key.startsWith(prefix))
}

/** カードを差し替えた計画 */
function withGoal(plan: LifePlan, next: Goal): LifePlan {
  return { ...plan, goals: plan.goals.map((other) => (other.id === next.id ? next : other)) }
}

/** 自由入力のカードの入力（型・名前・金額・期間か使う月・貯まっている額） */
function CustomGoalInputs({ goal, editor }: { goal: CustomGoal; editor: PlanEditor }) {
  const { plan } = editor
  const base = plan.baseYearMonth
  const key = (field: string) => touchedKey('goals', goal.id, field)
  const state = (field: string) => fieldState(editor, key(field))
  const set = (field: string, next: CustomGoal) => editor.set(key(field), withGoal(plan, next))
  const years = {
    minYear: base.year - INPUT_LIMITS.planYear.yearsBefore,
    maxYear: base.year + INPUT_LIMITS.planYear.yearsAfter,
  }

  return (
    <div className="card__inputs">
      <ChoiceField
        label="型"
        touched={state('variant').touched}
        value={customVariantOf(goal)}
        options={VARIANTS}
        onChange={(variant) => {
          const next = changeCustomVariant(goal, variant, appDefaults, plan.baseYearMonth)
          // 毎月 ⇄ 一度きりでは金額と時期が雛形に戻るので、その欄の印も外す（既定値のままに戻った欄として見せる）
          const reset =
            next.amountType === goal.amountType ? [] : SHAPE_FIELDS.map((field) => key(field))
          editor.set(key('variant'), withGoal(plan, next), reset)
        }}
      />
      <TextField
        label="名前"
        {...state('name')}
        value={goal.name}
        onChange={(name) => set('name', { ...goal, name })}
      />
      {goal.amountType === 'monthly' ? (
        <>
          <MoneyField
            label="月額"
            perMonth
            {...state('amount')}
            value={goal.amount}
            onChange={(amount) => set('amount', { ...goal, amount })}
          />
          <YearMonthField
            label="から"
            {...state('from')}
            {...years}
            value={goal.from}
            onChange={(from) => set('from', { ...goal, from })}
          />
          {/* 帯は「この月の前まで」で持つが、画面では最後に掛かる月を入れてもらう */}
          <YearMonthField
            label="まで"
            {...state('to')}
            {...years}
            value={addMonths(goal.to, -1)}
            onChange={(last) => set('to', { ...goal, to: addMonths(last, 1) })}
          />
        </>
      ) : (
        <>
          <MoneyField
            label="金額"
            {...state('amount')}
            value={goal.amount}
            onChange={(amount) => set('amount', { ...goal, amount })}
          />
          <YearMonthField
            label="使う月"
            {...state('at')}
            {...years}
            value={goal.at}
            onChange={(at) => set('at', { ...goal, at })}
          />
          <MoneyField
            label="貯まっている額"
            {...state('saved')}
            value={goal.saved}
            onChange={(saved) => set('saved', { ...goal, saved })}
          />
        </>
      )}
    </div>
  )
}

/** 家のカードの入力（買う年・価格・頭金・ローンの年数・毎月の維持費・貯まっている額。SPEC §2.1） */
function HomeGoalInputs({ goal, editor }: { goal: HomeGoal; editor: PlanEditor }) {
  const { plan } = editor
  const base = plan.baseYearMonth
  const key = (field: string) => touchedKey('goals', goal.id, field)
  const state = (field: string) => fieldState(editor, key(field))
  const set = (field: string, next: HomeGoal) => editor.set(key(field), withGoal(plan, next))

  return (
    <div className="card__inputs">
      {/* 買う月は買う年の 1 月とみなす（SPEC §2.1）。月は聞かない */}
      <IntegerField
        label="買う年"
        unit="年"
        min={base.year - INPUT_LIMITS.planYear.yearsBefore}
        max={base.year + INPUT_LIMITS.planYear.yearsAfter}
        {...state('purchaseYear')}
        value={goal.purchaseYear}
        onChange={(purchaseYear) => set('purchaseYear', { ...goal, purchaseYear })}
      />
      <MoneyField
        label="価格"
        {...state('price')}
        value={goal.price}
        onChange={(price) => set('price', { ...goal, price })}
      />
      <MoneyField
        label="頭金"
        {...state('downPayment')}
        value={goal.downPayment}
        onChange={(downPayment) => set('downPayment', { ...goal, downPayment })}
      />
      <IntegerField
        label="ローンの年数"
        unit="年"
        min={INPUT_LIMITS.loanYears.min}
        max={INPUT_LIMITS.loanYears.max}
        {...state('loanYears')}
        value={goal.loanYears}
        onChange={(loanYears) => set('loanYears', { ...goal, loanYears })}
      />
      <MoneyField
        label="毎月の維持費"
        perMonth
        {...state('monthlyUpkeep')}
        value={goal.monthlyUpkeep}
        onChange={(monthlyUpkeep) => set('monthlyUpkeep', { ...goal, monthlyUpkeep })}
      />
      <MoneyField
        label="貯まっている額"
        {...state('saved')}
        value={goal.saved}
        onChange={(saved) => set('saved', { ...goal, saved })}
      />
    </div>
  )
}

/**
 * 車のカードの入力（買う年・価格・払い方（ローンなら年数）・毎月の維持費・買い替え（するなら周期）・貯まっている額。SPEC §2.1）。
 * ローンの年数は払い方がローンのときだけ、周期は買い替えるときだけ、貯まっている額は現金のときだけ出す（ほかのときは計算に使わない）
 */
function CarGoalInputs({ goal, editor }: { goal: CarGoal; editor: PlanEditor }) {
  const { plan } = editor
  const base = plan.baseYearMonth
  const key = (field: string) => touchedKey('goals', goal.id, field)
  const state = (field: string) => fieldState(editor, key(field))
  const set = (field: string, next: CarGoal) => editor.set(key(field), withGoal(plan, next))
  const { payment, replaceEveryYears } = goal

  return (
    <div className="card__inputs">
      {/* 買う月は買う年の 1 月とみなす（SPEC §2.1）。月は聞かない */}
      <IntegerField
        label="買う年"
        unit="年"
        min={base.year - INPUT_LIMITS.planYear.yearsBefore}
        max={base.year + INPUT_LIMITS.planYear.yearsAfter}
        {...state('purchaseYear')}
        value={goal.purchaseYear}
        onChange={(purchaseYear) => set('purchaseYear', { ...goal, purchaseYear })}
      />
      <MoneyField
        label="価格"
        {...state('price')}
        value={goal.price}
        onChange={(price) => set('price', { ...goal, price })}
      />
      <ChoiceField
        label="払い方"
        touched={state('payment').touched}
        value={payment.type}
        options={CAR_PAYMENTS}
        onChange={(type) =>
          // 現金に戻すとローンの年数は使わなくなるので、その欄の印も外す
          editor.set(
            key('payment'),
            withGoal(plan, changeCarPayment(goal, type, appDefaults)),
            type === 'cash' ? [key('loanYears')] : [],
          )
        }
      />
      {payment.type === 'loan' ? (
        <IntegerField
          label="ローンの年数"
          unit="年"
          min={INPUT_LIMITS.carLoanYears.min}
          max={INPUT_LIMITS.carLoanYears.max}
          {...state('loanYears')}
          value={payment.years}
          onChange={(years) => set('loanYears', { ...goal, payment: { type: 'loan', years } })}
        />
      ) : null}
      <MoneyField
        label="毎月の維持費"
        perMonth
        {...state('monthlyUpkeep')}
        value={goal.monthlyUpkeep}
        onChange={(monthlyUpkeep) => set('monthlyUpkeep', { ...goal, monthlyUpkeep })}
      />
      <ChoiceField
        label="買い替え"
        touched={state('replace').touched}
        value={replaceEveryYears === null ? 'keep' : 'replace'}
        options={CAR_REPLACEMENTS}
        onChange={(choice) =>
          editor.set(
            key('replace'),
            withGoal(plan, changeCarReplacement(goal, choice === 'replace', appDefaults)),
            choice === 'keep' ? [key('replaceEveryYears')] : [],
          )
        }
      />
      {replaceEveryYears === null ? null : (
        <IntegerField
          label="何年ごと"
          unit="年"
          min={INPUT_LIMITS.carReplaceEveryYears.min}
          max={INPUT_LIMITS.carReplaceEveryYears.max}
          {...state('replaceEveryYears')}
          value={replaceEveryYears}
          onChange={(years) => set('replaceEveryYears', { ...goal, replaceEveryYears: years })}
        />
      )}
      {payment.type === 'cash' ? (
        <MoneyField
          label="貯まっている額"
          {...state('saved')}
          value={goal.saved}
          onChange={(saved) => set('saved', { ...goal, saved })}
        />
      ) : null}
    </div>
  )
}

/**
 * 子の費用のカードの入力（進路 3 つ・塾の行・習い事・保育。SPEC §2.1）。
 * 習い事は「平均」（統計の平均。null）か金額、保育は「通わない」（null）か保育料の月額（自治体に払う額。無償化の後の給食費は目安で足す）。
 * 金額を選んだときだけ金額の欄を出す。
 * 塾の行は足す・外す（外すのは 1 回押し。見込みの行と同じ）。印は行全体で 1 つ（`cramSchools`）
 */
function ChildCostGoalInputs({ goal, editor }: { goal: ChildCostGoal; editor: PlanEditor }) {
  const { plan } = editor
  const key = (field: string) => touchedKey('goals', goal.id, field)
  const state = (field: string) => fieldState(editor, key(field))
  const set = (field: string, next: ChildCostGoal) => editor.set(key(field), withGoal(plan, next))
  const cram = state('cramSchools')
  const setCram = (cramSchools: CramSchool[]) => set('cramSchools', { ...goal, cramSchools })

  return (
    <div className="card__inputs">
      {SCHOOL_STAGES.map((stage) => (
        <ChoiceField
          key={stage.key}
          label={stage.label}
          touched={state(stage.key).touched}
          value={goal.schools[stage.key]}
          options={SCHOOL_TYPE_OPTIONS}
          onChange={(type) =>
            set(stage.key, { ...goal, schools: { ...goal.schools, [stage.key]: type } })
          }
        />
      ))}

      <div className="card__rows" role="group" aria-label="塾">
        <span className="field__label">塾</span>
        {goal.cramSchools.map((row, index) => {
          const rowIssue = editor.issues.get(cramRowIssueKey(goal.id, index)) ?? null
          return (
            <div
              key={index}
              className="card__cram"
              role="group"
              aria-label={`塾の ${index + 1} 行目`}
            >
              {/* 「[高1] から [高3] まで」と日本語の順に 1 行で読ませる */}
              <div className={cram.touched ? 'card__grades is-touched' : 'card__grades is-default'}>
                <GradeSelect
                  label={`塾の ${index + 1} 行目の始まりの学年`}
                  value={row.fromGrade}
                  invalid={rowIssue !== null}
                  onChange={(fromGrade) =>
                    setCram(
                      goal.cramSchools.map((other, i) =>
                        i === index ? { ...other, fromGrade } : other,
                      ),
                    )
                  }
                />
                <span>から</span>
                <GradeSelect
                  label={`塾の ${index + 1} 行目の終わりの学年`}
                  value={row.toGrade}
                  invalid={rowIssue !== null}
                  onChange={(toGrade) =>
                    setCram(
                      goal.cramSchools.map((other, i) =>
                        i === index ? { ...other, toGrade } : other,
                      ),
                    )
                  }
                />
                <span>まで</span>
              </div>
              {rowIssue === null ? null : (
                <p className="field__error" role="alert">
                  {rowIssue}
                </p>
              )}
              <div className="plan__row">
                <MoneyField
                  label="月額"
                  perMonth
                  touched={cram.touched}
                  value={row.monthly}
                  onChange={(monthly) =>
                    setCram(
                      goal.cramSchools.map((other, i) =>
                        i === index ? { ...other, monthly } : other,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="plan__remove"
                  aria-label={`塾の ${index + 1} 行目を外す`}
                  onClick={() => setCram(goal.cramSchools.filter((_, i) => i !== index))}
                >
                  外す
                </button>
              </div>
            </div>
          )
        })}
        <button
          type="button"
          className="plan__add"
          onClick={() => setCram([...goal.cramSchools, cramSchoolTemplate(appDefaults)])}
        >
          塾を足す
        </button>
      </div>

      <ChoiceField
        label="習い事"
        touched={state('lessonsMonthly').touched}
        value={goal.lessonsMonthly === null ? 'average' : 'amount'}
        options={LESSON_CHOICES}
        onChange={(choice) =>
          set('lessonsMonthly', { ...goal, lessonsMonthly: choice === 'average' ? null : 0 })
        }
      />
      {goal.lessonsMonthly === null ? null : (
        <MoneyField
          label="習い事の月額"
          perMonth
          {...state('lessonsMonthly')}
          value={goal.lessonsMonthly}
          onChange={(lessonsMonthly) => set('lessonsMonthly', { ...goal, lessonsMonthly })}
        />
      )}

      <ChoiceField
        label="保育園"
        touched={state('childcareMonthly').touched}
        value={goal.childcareMonthly === null ? 'none' : 'attend'}
        options={CHILDCARE_CHOICES}
        onChange={(choice) =>
          set('childcareMonthly', { ...goal, childcareMonthly: choice === 'none' ? null : 0 })
        }
      />
      {goal.childcareMonthly === null ? null : (
        <MoneyField
          label="保育料"
          perMonth
          {...state('childcareMonthly')}
          value={goal.childcareMonthly}
          onChange={(childcareMonthly) => set('childcareMonthly', { ...goal, childcareMonthly })}
        />
      )}
    </div>
  )
}

/**
 * 塾の学年を選ぶ欄（小1〜高3。選択肢が 4 個以上なので select）。名前は読み上げにだけ渡し、画面では「から」「まで」を後ろに添える
 */
function GradeSelect({
  label,
  value,
  invalid,
  onChange,
}: {
  label: string
  value: number
  invalid: boolean
  onChange: (grade: number) => void
}) {
  return (
    <select
      className="field__input field__input--select"
      aria-label={label}
      aria-invalid={invalid}
      value={String(value)}
      onChange={(event) => {
        const found = GRADE_OPTIONS.find((option) => option.value === event.target.value)
        if (found === undefined) {
          throw new RangeError(`学年の選択肢にない値です: ${event.target.value}`)
        }
        onChange(Number(found.value))
      }}
    >
      {GRADE_OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}

/**
 * 家のカードの数字：頭金＋諸費用、借りる額、借りる額が買う年の見込みの世帯年収の何倍か（SPEC §3.7）。
 * 目安の倍率を超えたら印を付ける。もう買った・借りないときは倍率を出さない
 */
function HomeLoanFacts({ goal, plan }: { goal: HomeGoal; plan: LifePlan }) {
  const limit = appDefaults.home.loanToIncomeLimit.value
  const check = homeLoanCheck(plan, goal, limit)
  const upfront = homeUpfrontCost(goal, appDefaults.home.closingCostRate.value)
  return (
    <dl className="card__facts">
      <div>
        <dt>頭金＋諸費用</dt>
        <dd className="num">{formatMan(upfront, { digits: 1 })}</dd>
      </div>
      <div>
        <dt>借りる額</dt>
        <dd className="num">{formatMan(Math.max(0, goal.price - goal.downPayment))}</dd>
      </div>
      {check === null ? null : (
        <div className={check.over ? 'is-over' : undefined}>
          <dt>{goal.purchaseYear}年の年収の</dt>
          <dd className="num">
            {check.ratio === null ? '—' : `${check.ratio.toFixed(1)}倍`}
            <span className="card__limit">目安 {limit}倍まで</span>
          </dd>
        </div>
      )}
    </dl>
  )
}

/**
 * 大学資金のカードの入力（進路・目標額・児童手当を回すか・置き場・貯まっている額。SPEC §2.1）。
 * 子はカードを足すときに決まる（カードの名前に子の順が出る）ので、ここでは選ばせない
 */
function UniversityGoalInputs({ goal, editor }: { goal: UniversityGoal; editor: PlanEditor }) {
  const { plan } = editor
  const key = (field: string) => touchedKey('goals', goal.id, field)
  const state = (field: string) => fieldState(editor, key(field))
  const set = (field: string, next: UniversityGoal) => editor.set(key(field), withGoal(plan, next))

  return (
    <div className="card__inputs">
      {/* 進路（D37）。選ぶと目標額がその進路の額に替わり、目標額の印は外れる（進路の額＝既定値のまま）。
          進路を持たない前の保存は、どれも選んでいない形で出し、目標額はそのまま */}
      <ChoiceField
        label="進路"
        touched={state('course').touched}
        value={goal.course ?? null}
        options={UNIVERSITY_COURSE_OPTIONS}
        stacked
        onChange={(course) =>
          editor.set(
            key('course'),
            withGoal(
              plan,
              changeUniversityCourse(goal, course, appDefaults, masterTables.universityCost),
            ),
            [key('targetAmount')],
          )
        }
      />
      <MoneyField
        label="目標額"
        {...state('targetAmount')}
        value={goal.targetAmount}
        onChange={(targetAmount) => set('targetAmount', { ...goal, targetAmount })}
      />
      <ChoiceField
        label="児童手当"
        touched={state('allocateChildAllowance').touched}
        value={goal.allocateChildAllowance ? 'allocate' : 'keep'}
        options={ALLOWANCE_CHOICES}
        onChange={(choice) =>
          set('allocateChildAllowance', {
            ...goal,
            allocateChildAllowance: choice === 'allocate',
          })
        }
      />
      <ChoiceField
        label="置き場"
        touched={state('vehicle').touched}
        value={goal.vehicle}
        options={UNIVERSITY_VEHICLES}
        onChange={(vehicle) => set('vehicle', { ...goal, vehicle })}
      />
      <MoneyField
        label="貯まっている額"
        {...state('saved')}
        value={goal.saved}
        onChange={(saved) => set('saved', { ...goal, saved })}
      />
    </div>
  )
}

/** 老後資金のカードの入力（目標額・いつまでに・置き場・貯まっている額。SPEC §2.1） */
function RetirementGoalInputs({ goal, editor }: { goal: RetirementGoal; editor: PlanEditor }) {
  const { plan } = editor
  const base = plan.baseYearMonth
  const key = (field: string) => touchedKey('goals', goal.id, field)
  const state = (field: string) => fieldState(editor, key(field))
  const set = (field: string, next: RetirementGoal) => editor.set(key(field), withGoal(plan, next))

  return (
    <div className="card__inputs">
      <MoneyField
        label="目標額"
        {...state('targetAmount')}
        value={goal.targetAmount}
        onChange={(targetAmount) => set('targetAmount', { ...goal, targetAmount })}
      />
      {/* この年の 1 月の前まで（前の年の 12 月まで）積み立てる */}
      <IntegerField
        label="使い始める年"
        unit="年"
        min={base.year - INPUT_LIMITS.planYear.yearsBefore}
        max={base.year + INPUT_LIMITS.planYear.yearsAfter}
        {...state('byYear')}
        value={goal.byYear}
        onChange={(byYear) => set('byYear', { ...goal, byYear })}
      />
      <ChoiceField
        label="置き場"
        touched={state('vehicle').touched}
        value={goal.vehicle}
        options={RETIREMENT_VEHICLES}
        onChange={(vehicle) => set('vehicle', { ...goal, vehicle })}
      />
      <MoneyField
        label="貯まっている額"
        {...state('saved')}
        value={goal.saved}
        onChange={(saved) => set('saved', { ...goal, saved })}
      />
    </div>
  )
}

/**
 * 大学資金・老後資金のカードの到達額（使う月の時点）。足し算として読む：児童手当 ＋ 家計から足す ＋ 貯まっている額 → 線 → 到達額。
 * 児童手当を回す帯（earmarked）は要る年収に入らないので、上の帯の並びに入れず、ここの「児童手当」の行の下に添える。
 * 数字は domain の `fundPlanOf` の答えを、画面の数字どうしの足し算が合うように見せる桁へ配るだけ（`fundRows`。ここでは計算しない）
 */
function FundFacts({
  goal,
  plan,
  bands,
}: {
  goal: UniversityGoal | RetirementGoal
  plan: LifePlan
  bands: readonly Band[]
}) {
  const fund = goalFund(plan, goal, appDefaults, masterTables)
  if (fund === null) return null
  const earmarked = bands.filter((band) => band.kind === 'earmarked')
  const allocate = goal.kind === 'university' && goal.allocateChildAllowance
  // 画面に出ている数字どうしで足し算が合うように配る（`fundRows`）。小数 1 桁にそろえる
  const { rows, total } = fundRows(fund.reached, allocate, goal.saved)
  const man = (yen: number) => formatMan(yen, { digits: FUND_DIGITS, fixed: true })
  return (
    <dl
      className="card__facts card__reach"
      aria-label={`${formatEndExclusive(fund.useMonth)}の到達額`}
    >
      {rows.map((row) => (
        <div key={row.key}>
          <dt>{row.label}</dt>
          <dd className="num">
            {/* 貯まっている額は、今の額から使う月の額へ増えることを並びで見せる */}
            {row.fromYen === null ? null : (
              <span className="card__from">{formatMan(row.fromYen, { digits: 1 })} → </span>
            )}
            {man(row.yen)}
            {row.key === 'allowance'
              ? earmarked.map((band, index) => (
                  <span key={index} className="card__limit">
                    月 {formatMan(band.monthly, { digits: 1 })} {formatYearMonth(band.from)}〜
                    {formatEndExclusive(band.to)}
                  </span>
                ))
              : null}
          </dd>
        </div>
      ))}
      <div className="card__total">
        <dt>{formatEndExclusive(fund.useMonth)}に</dt>
        <dd className="num">{man(total)}</dd>
      </div>
    </dl>
  )
}

/** オン・オフと消す */
function CardActions({ goal, editor }: { goal: Goal; editor: PlanEditor }) {
  const { plan } = editor
  const enabledKey = touchedKey('goals', goal.id, 'enabled')

  return (
    <div className="card__actions">
      <label className="card__toggle">
        <input
          type="checkbox"
          checked={goal.enabled}
          onChange={(event) =>
            editor.set(enabledKey, {
              ...plan,
              goals: plan.goals.map((other) =>
                other.id === goal.id ? { ...other, enabled: event.target.checked } : other,
              ),
            })
          }
        />
        <span>計算に入れる</span>
      </label>
      {/* 子の費用のカードは子ごとに付く物なので消せない（子を外すと消える。SPEC §2.1） */}
      {goal.kind === 'childCost' ? null : (
        <ConfirmButton
          className="plan__remove"
          label="消す"
          confirmLabel="本当に消す"
          onConfirm={() =>
            editor.remove(touchedKey('goals', goal.id), {
              ...plan,
              goals: plan.goals.filter((other) => other.id !== goal.id),
            })
          }
        />
      )}
    </div>
  )
}

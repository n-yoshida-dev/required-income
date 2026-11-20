/**
 * 見本の世帯（SPEC §1 `defaults.ts`・§8 の 8）と、「計画」で足すときの雛形（大人・子・自由入力のカード）。
 *
 * 値は `data/app/defaults.json`（アプリの既定値）と `data/app/sample-household.json`（見本の世帯）を
 * 引数で受け取り、ここには数値を書かない。
 * JSON は文字列の選択肢を生の形で持ち、年月は起点からの相対（「起点の年で何歳」「起点の年から何年後の 1 月」）で持つ。
 * ここで確かめて、起点から実際の年月を出し、`LifePlan` に直す（いつ開いても同じ形の階段が出る）。
 * 見本のカードは自由入力と家（T7）と車（T8）と子の費用（T9）と大学資金・老後資金（T10）。
 */

import type {
  Adult,
  AppDefaults,
  Assumptions,
  CarGoal,
  CarPayment,
  ChildCostGoal,
  ChildProfile,
  CramSchool,
  CustomGoal,
  CustomVariant,
  Goal,
  HomeGoal,
  LifePlan,
  RetirementGoal,
  SampleCarGoalSource,
  SampleChildCostGoalSource,
  SampleCustomGoalSource,
  SampleHomeGoalSource,
  SampleHouseholdSource,
  SampleRetirementGoalSource,
  SampleUniversityGoalSource,
  SchoolType,
  SchoolTypes,
  UniversityCourse,
  UniversityGoal,
  WorkStyle,
  YearMonth,
  Yen,
} from './types'
import type { UniversityCostTable } from '../types'
import { assertYearMonth, startOfYear, yearMonth } from './yearMonth'

const WORK_STYLES: readonly WorkStyle[] = ['employee', 'selfEmployed', 'notWorking']

const SCHOOL_TYPES: readonly SchoolType[] = ['public', 'private']

/** 大学資金のカードで選べる進路。並びは画面の選択肢の並び（重い順。D37） */
export const UNIVERSITY_COURSES: readonly UniversityCourse[] = [
  'privateScience',
  'privateHumanities',
  'nationalPublic',
]

/**
 * 見本の世帯を作る。世帯ごとの値は `sample`、見本に書いていない項目は `defaults` で埋める。
 * 起点は画面が今日から作って渡す。JSON の形が契約に反していれば投げる
 */
export function sampleLifePlan(
  defaults: AppDefaults,
  sample: SampleHouseholdSource,
  baseYearMonth: YearMonth,
): LifePlan {
  assertYearMonth(baseYearMonth, '起点')
  return {
    baseYearMonth,
    adults: sample.adults.map((adult) => ({
      ...defaultAdult(defaults),
      id: adult.id,
      birthYear: birthYearOf(baseYearMonth, adult.ageAtBase),
      workStyle: toWorkStyle(adult.workStyle),
      annualIncome: adult.annualIncome,
    })),
    children: sample.children.map((child): ChildProfile => ({
      id: child.id,
      ...birthOf(birthYearOf(baseYearMonth, child.ageAtBase), child.birthMonth),
    })),
    municipality: sample.municipality,
    living: { ...sample.living },
    goals: [
      ...sample.customGoals.map((goal) => toCustomGoal(goal, baseYearMonth)),
      ...sample.homeGoals.map((goal) => toHomeGoal(goal, baseYearMonth)),
      ...sample.carGoals.map((goal) => toCarGoal(goal, baseYearMonth)),
      ...sample.childCostGoals.map(toChildCostGoal),
      ...sample.universityGoals.map(toUniversityGoal),
      ...sample.retirementGoals.map((goal) => toRetirementGoal(goal, baseYearMonth)),
    ],
    assumptions: defaultAssumptions(defaults),
  }
}

/** JSON の大学資金のカードを `UniversityGoal` に直す。置き場が選択肢に無ければ投げる。金額の契約は帯にするとき（`universityBands`）に確かめる */
function toUniversityGoal(source: SampleUniversityGoalSource): UniversityGoal {
  return {
    id: source.id,
    enabled: true,
    kind: 'university',
    childId: source.childId,
    targetAmount: source.targetAmount,
    allocateChildAllowance: source.allocateChildAllowance,
    vehicle: toUniversityVehicle(source.vehicle),
    saved: source.saved,
  }
}

/** JSON の老後資金のカードを `RetirementGoal` に直す。期限は起点の年からの相対。置き場が選択肢に無ければ投げる */
function toRetirementGoal(source: SampleRetirementGoalSource, origin: YearMonth): RetirementGoal {
  return {
    id: source.id,
    enabled: true,
    kind: 'retirement',
    targetAmount: source.targetAmount,
    byYear: afterBase(origin, source.byYearsLater, '見本の老後資金の期限').year,
    vehicle: toRetirementVehicle(source.vehicle),
    saved: source.saved,
  }
}

/** 文字列を大学資金の置き場に直す。選択肢に無ければ投げる */
function toUniversityVehicle(value: string): UniversityGoal['vehicle'] {
  if (value !== 'childNisa' && value !== 'deposit') {
    throw new RangeError(`大学資金の置き場が選択肢にありません: ${value}`)
  }
  return value
}

/** 文字列を老後資金の置き場に直す。選択肢に無ければ投げる */
function toRetirementVehicle(value: string): RetirementGoal['vehicle'] {
  if (value !== 'nisa' && value !== 'deposit') {
    throw new RangeError(`老後資金の置き場が選択肢にありません: ${value}`)
  }
  return value
}

/** JSON の子の費用のカードを `ChildCostGoal` に直す。進路が選択肢に無ければ投げる。金額と学年の契約は帯にするとき（`childCostBands`）に確かめる */
function toChildCostGoal(source: SampleChildCostGoalSource): ChildCostGoal {
  return {
    id: source.id,
    enabled: true,
    kind: 'childCost',
    childId: source.childId,
    schools: toSchoolTypes(source.schools),
    cramSchools: source.cramSchools.map((cram) => ({ ...cram })),
    lessonsMonthly: source.lessonsMonthly,
    childcareMonthly: source.childcareMonthly,
  }
}

/** 文字列の進路を `SchoolTypes` に直す。選択肢（public / private）に無ければ投げる */
function toSchoolTypes(source: {
  elementary: string
  juniorHigh: string
  highSchool: string
}): SchoolTypes {
  const toType = (value: string, stage: string): SchoolType => {
    const found = SCHOOL_TYPES.find((type) => type === value)
    if (found === undefined) {
      throw new RangeError(`進路（${stage}）が選択肢にありません: ${value}`)
    }
    return found
  }
  return {
    elementary: toType(source.elementary, '小学校'),
    juniorHigh: toType(source.juniorHigh, '中学校'),
    highSchool: toType(source.highSchool, '高校'),
  }
}

/** JSON の家のカードを `HomeGoal` に直す。買う年は起点の年からの相対。金額の契約は帯にするとき（`homeBands`）に確かめる */
function toHomeGoal(source: SampleHomeGoalSource, origin: YearMonth): HomeGoal {
  return {
    id: source.id,
    enabled: true,
    kind: 'home',
    purchaseYear: afterBase(origin, source.purchaseYearsLater, '見本の家を買う年').year,
    price: source.price,
    downPayment: source.downPayment,
    loanYears: source.loanYears,
    monthlyUpkeep: source.monthlyUpkeep,
    saved: source.saved,
  }
}

/**
 * JSON の車のカードを `CarGoal` に直す。買う年は起点の年からの相対。
 * 払い方が選択肢に無い・ローンなのに年数が無いなら投げる。金額の契約は帯にするとき（`carBands`）に確かめる
 */
function toCarGoal(source: SampleCarGoalSource, origin: YearMonth): CarGoal {
  let payment: CarPayment
  if (source.payment === 'cash') {
    payment = { type: 'cash' }
  } else if (source.payment === 'loan') {
    payment = {
      type: 'loan',
      years: required(source.loanYears, `見本の車「${source.id}」の loanYears`),
    }
  } else {
    throw new RangeError(`見本の車の払い方が選択肢にありません: ${source.payment}`)
  }
  return {
    id: source.id,
    enabled: true,
    kind: 'car',
    purchaseYear: afterBase(origin, source.purchaseYearsLater, '見本の車を買う年').year,
    price: source.price,
    payment,
    monthlyUpkeep: source.monthlyUpkeep,
    replaceEveryYears: source.replaceEveryYears,
    saved: source.saved,
  }
}

/** 「起点の年で何歳」から生まれ年を出す。年齢が 0 以上の整数でなければ投げる */
function birthYearOf(base: YearMonth, ageAtBase: number): number {
  if (!Number.isInteger(ageAtBase) || ageAtBase < 0) {
    throw new RangeError(`起点の年の年齢は 0 以上の整数で指定してください: ${ageAtBase}`)
  }
  return base.year - ageAtBase
}

/** 「起点の年から何年後の 1 月」を年月に直す。0 以上の整数でなければ投げる */
function afterBase(base: YearMonth, years: number, label: string): YearMonth {
  if (!Number.isInteger(years) || years < 0) {
    throw new RangeError(`${label}は起点の年から 0 以上の整数の年数で指定してください: ${years}`)
  }
  return startOfYear(base.year + years)
}

/** 大人の既定値（見込み・副業・退職の年齢）。人ごとの値（id・生まれ年・働き方・年収）は呼び出し側が上書きする */
export function defaultAdult(
  defaults: AppDefaults,
): Pick<Adult, 'raiseRate' | 'outlookSteps' | 'sideMonthlyProfit' | 'retirementAge'> {
  return {
    raiseRate: defaults.adult.raiseRate.value,
    outlookSteps: [],
    sideMonthlyProfit: defaults.adult.sideMonthlyProfit.value,
    retirementAge: defaults.adult.retirementAge.value,
  }
}

/** 前提の既定値 */
export function defaultAssumptions(defaults: AppDefaults): Assumptions {
  return {
    investmentReturnRate: defaults.assumptions.investmentReturnRate.value,
    inflationRate: defaults.assumptions.inflationRate.value,
    mortgageRate: defaults.assumptions.mortgageRate.value,
  }
}

/** 文字列を働き方に直す。選択肢に無ければ投げる */
function toWorkStyle(value: string): WorkStyle {
  const found = WORK_STYLES.find((style) => style === value)
  if (found === undefined) {
    throw new RangeError(`働き方が選択肢にありません: ${value}`)
  }
  return found
}

/** 生まれ年月を確かめて返す */
function birthOf(year: number, month: number): Pick<ChildProfile, 'birthYear' | 'birthMonth'> {
  const birth = yearMonth(year, month)
  return { birthYear: birth.year, birthMonth: birth.month }
}

/** JSON の自由入力のカードを `CustomGoal` に直す。足りない項目・選択肢に無い値は投げる */
function toCustomGoal(source: SampleCustomGoalSource, origin: YearMonth): CustomGoal {
  const base = { id: source.id, enabled: true, kind: 'custom' as const, name: source.name }
  if (source.amountType === 'monthly') {
    if (source.direction !== 'expense' && source.direction !== 'income') {
      throw new RangeError(`「${source.name}」の向きが選択肢にありません: ${source.direction}`)
    }
    return {
      ...base,
      amountType: 'monthly',
      direction: source.direction,
      amount: source.amount,
      from: afterBase(
        origin,
        required(source.fromYearsLater, `「${source.name}」の fromYearsLater`),
        `「${source.name}」の始まり`,
      ),
      to: afterBase(
        origin,
        required(source.toYearsLater, `「${source.name}」の toYearsLater`),
        `「${source.name}」の終わり`,
      ),
    }
  }
  if (source.amountType === 'once') {
    if (source.direction !== 'expense') {
      throw new RangeError(`一度きりのカード「${source.name}」は支出だけです: ${source.direction}`)
    }
    return {
      ...base,
      amountType: 'once',
      direction: 'expense',
      amount: source.amount,
      at: afterBase(
        origin,
        required(source.atYearsLater, `「${source.name}」の atYearsLater`),
        `「${source.name}」の使う月`,
      ),
      saved: source.saved ?? 0,
    }
  }
  throw new RangeError(`「${source.name}」の金額の型が選択肢にありません: ${source.amountType}`)
}

// ---------------------------------------------------------------------------
// 「計画」で足すときの雛形（SPEC §1・§4.2「種類を選ぶと既定値で入る」）
// 値は `defaults.templates` から読む。id は画面が作って渡す（domain は乱数を使わない）
// ---------------------------------------------------------------------------

/** もう 1 人の大人を足すときの雛形 */
export function adultTemplate(defaults: AppDefaults, base: YearMonth, id: string): Adult {
  const template = defaults.templates.adult.value
  return {
    ...defaultAdult(defaults),
    id,
    birthYear: birthYearOf(base, template.ageAtBase),
    workStyle: toWorkStyle(template.workStyle),
    annualIncome: template.annualIncome,
  }
}

/** 子を足すときの雛形。生まれ月は起点の月 */
export function childTemplate(defaults: AppDefaults, base: YearMonth, id: string): ChildProfile {
  return {
    id,
    ...birthOf(birthYearOf(base, defaults.templates.child.value.ageAtBase), base.month),
  }
}

/** 自由入力のカードを足すときの雛形。オンで入る */
export function customGoalTemplate(
  defaults: AppDefaults,
  base: YearMonth,
  id: string,
  variant: CustomVariant,
): CustomGoal {
  assertYearMonth(base, '起点')
  if (variant === 'onceExpense') {
    const once = defaults.templates.customOnce.value
    return {
      id,
      enabled: true,
      kind: 'custom',
      name: once.name,
      amountType: 'once',
      direction: 'expense',
      amount: once.amount,
      at: afterBase(base, once.atYearsLater, '雛形の使う月'),
      saved: 0,
    }
  }
  const monthly = defaults.templates.customMonthly.value
  const income = variant === 'monthlyIncome'
  return {
    id,
    enabled: true,
    kind: 'custom',
    name: income ? monthly.incomeName : monthly.expenseName,
    amountType: 'monthly',
    direction: income ? 'income' : 'expense',
    amount: monthly.amount,
    from: base,
    to: afterBase(base, monthly.years, '雛形の終わり'),
  }
}

/** 家のカードを足すときの雛形。オンで入り、貯まっている額は 0 */
export function homeGoalTemplate(defaults: AppDefaults, base: YearMonth, id: string): HomeGoal {
  const home = defaults.templates.home.value
  return {
    id,
    enabled: true,
    kind: 'home',
    purchaseYear: afterBase(base, home.purchaseYearsLater, '雛形の家を買う年').year,
    price: home.price,
    downPayment: home.downPayment,
    loanYears: home.loanYears,
    monthlyUpkeep: home.monthlyUpkeep,
    saved: 0,
  }
}

/** 車のカードを足すときの雛形。オンで入り、現金で買い、貯まっている額は 0 */
export function carGoalTemplate(defaults: AppDefaults, base: YearMonth, id: string): CarGoal {
  const car = defaults.templates.car.value
  return {
    id,
    enabled: true,
    kind: 'car',
    purchaseYear: afterBase(base, car.purchaseYearsLater, '雛形の車を買う年').year,
    price: car.price,
    payment: { type: 'cash' },
    monthlyUpkeep: car.monthlyUpkeep,
    replaceEveryYears: car.replaceEveryYears,
    saved: 0,
  }
}

/**
 * 車の払い方を替える。現金 → ローンは雛形のローンの年数で入る。同じ型なら元のまま
 */
export function changeCarPayment(
  goal: CarGoal,
  type: CarPayment['type'],
  defaults: AppDefaults,
): CarGoal {
  if (goal.payment.type === type) return goal
  const payment: CarPayment =
    type === 'cash'
      ? { type: 'cash' }
      : { type: 'loan', years: defaults.templates.car.value.loanYears }
  return { ...goal, payment }
}

/**
 * 車の買い替えを替える（買い替える ⇄ 買い替えない）。買い替えるに戻すと雛形の周期で入る
 */
export function changeCarReplacement(
  goal: CarGoal,
  replace: boolean,
  defaults: AppDefaults,
): CarGoal {
  if ((goal.replaceEveryYears !== null) === replace) return goal
  return {
    ...goal,
    replaceEveryYears: replace ? defaults.templates.car.value.replaceEveryYears : null,
  }
}

/**
 * 子の費用のカードの id。子の id から決める（子ごとに 1 枚なので重ならない。`goal-1` のような番号の id とも重ならない）。
 * domain は乱数も画面の番号付けも使わないので、保存を開いたときに足すカードもここで同じ id になる
 */
export function childCostGoalId(childId: string): string {
  return `childcost-${childId}`
}

/** 子の費用のカードの雛形（SPEC §2.1 の既定：すべて公立、塾なし、習い事は統計の平均、保育なし）。オンで入る */
export function childCostGoalTemplate(defaults: AppDefaults, childId: string): ChildCostGoal {
  const template = defaults.templates.childCost.value
  return {
    id: childCostGoalId(childId),
    enabled: true,
    kind: 'childCost',
    childId,
    schools: toSchoolTypes(template.schools),
    cramSchools: [],
    lessonsMonthly: template.lessonsMonthly,
    childcareMonthly: template.childcareMonthly,
  }
}

/** 塾の行を足すときの雛形 */
export function cramSchoolTemplate(defaults: AppDefaults): CramSchool {
  return { ...defaults.templates.childCost.value.cramSchool }
}

/**
 * 大学資金のカードの目標額の既定：`course`（私立文系など）の修業年限ぶん（初年度の納付金 ＋ 2 年目からの年額 ×（年限 − 1））。
 * 数値は `data/education/university-cost.json`（引数の表）から取り、既定値の JSON に写さない（SPEC §2.1・§8 の 4）。
 * `course` が表に無ければ投げる
 */
export function universityTargetDefault(table: UniversityCostTable, course: string): Yen {
  // 表の自前のキーだけを見る（"constructor" などの継いだ値を拾わない）
  if (!Object.hasOwn(table, course)) {
    throw new RangeError(`大学の学費の表に無い学部です: ${course}`)
  }
  const entry = table[course as keyof UniversityCostTable]
  return entry.initialYear + entry.annual * (entry.years - 1)
}

/**
 * 進路を選んだときに入る大学資金の目標額：その進路の 4 年ぶん（`universityTargetDefault`）を、
 * 既定値の丸めの単位（1 万円。入れる欄は万円なので、小数の付いた額で入らないように）に四捨五入した額（D37）。
 * 丸めの単位が 1 以上の整数でなければ投げる
 */
export function universityCourseTarget(
  defaults: AppDefaults,
  table: UniversityCostTable,
  course: UniversityCourse,
): Yen {
  const unit = defaults.templates.university.value.targetRoundTo
  if (!Number.isInteger(unit) || unit < 1) {
    throw new RangeError(`大学資金の目標額の丸めの単位は 1 以上の整数で指定してください: ${unit}`)
  }
  return Math.round(universityTargetDefault(table, course) / unit) * unit
}

/**
 * 大学資金のカードを足すときの雛形（SPEC §2.1 の既定：児童手当を回す、子の名義の NISA、
 * 進路は既定値の進路（私立理系。D37）で、目標額はその進路の 4 年ぶんを 1 万円単位に丸めた額）。
 * 子ごとに 1 枚まで（`expandPlan` が確かめる）。オンで入り、貯まっている額は 0
 */
export function universityGoalTemplate(
  defaults: AppDefaults,
  table: UniversityCostTable,
  childId: string,
  id: string,
): UniversityGoal {
  const template = defaults.templates.university.value
  const course = toUniversityCourse(template.course)
  return {
    id,
    enabled: true,
    kind: 'university',
    childId,
    course,
    targetAmount: universityCourseTarget(defaults, table, course),
    allocateChildAllowance: template.allocateChildAllowance,
    vehicle: toUniversityVehicle(template.vehicle),
    saved: 0,
  }
}

/**
 * 大学資金のカードの進路を替える（D37）。目標額はその進路の額で上書きする（手で直した額も上書きする。
 * 進路を選び直すのは「その進路の額にしたい」ときなので）。ほかの欄は変えない
 */
export function changeUniversityCourse(
  goal: UniversityGoal,
  course: UniversityCourse,
  defaults: AppDefaults,
  table: UniversityCostTable,
): UniversityGoal {
  return { ...goal, course, targetAmount: universityCourseTarget(defaults, table, course) }
}

/** 文字列を大学の進路に直す。選べる進路に無ければ投げる */
function toUniversityCourse(value: string): UniversityCourse {
  const found = UNIVERSITY_COURSES.find((course) => course === value)
  if (found === undefined) {
    throw new RangeError(`大学資金の進路の既定値が選択肢にありません: ${value}`)
  }
  return found
}

/**
 * 老後資金のカードを足すときの雛形（SPEC §2.1 の既定：期限は年上の大人が退職する年、NISA、目標額はアプリの既定値 ★）。
 * オンで入り、貯まっている額は 0
 */
export function retirementGoalTemplate(
  defaults: AppDefaults,
  adults: readonly Pick<Adult, 'birthYear' | 'retirementAge'>[],
  id: string,
): RetirementGoal {
  const template = defaults.templates.retirement.value
  const eldest = adults.reduce<Pick<Adult, 'birthYear' | 'retirementAge'> | undefined>(
    (older, adult) => (older === undefined || adult.birthYear < older.birthYear ? adult : older),
    undefined,
  )
  if (eldest === undefined) {
    throw new RangeError('大人がいないので、老後資金の期限を決められません')
  }
  return {
    id,
    enabled: true,
    kind: 'retirement',
    targetAmount: template.targetAmount,
    byYear: eldest.birthYear + eldest.retirementAge,
    vehicle: toRetirementVehicle(template.vehicle),
    saved: 0,
  }
}

/**
 * 子ごとのカードを子と揃える（SPEC §2.1「子ごと。子を足すと自動で付く」）。
 *
 * - 子の費用のカードの無い子には雛形のカードを末尾に足す（子の順）
 * - 子のいないカード（子を外した後）は外す。大学資金のカードも外す（T10。大学資金のカードは自動では付かない）
 * - 同じ子に 2 枚あれば、先の 1 枚だけを残す（子の費用・大学資金のどちらも）
 *
 * 揃っていれば同じ配列を返す（画面が「変わったか」を比べられるように）。
 * 子を足す・外すとき、「自分の数字にする」で始めるとき、保存を開くとき（T9 より前の保存には子の費用のカードが無い）に呼ぶ
 */
export function syncChildCostGoals(
  plan: Pick<LifePlan, 'children' | 'goals'>,
  defaults: AppDefaults,
): Goal[] {
  const childIds = new Set(plan.children.map((child) => child.id))
  const covered = new Set<string>()
  const funded = new Set<string>()
  const kept = plan.goals.filter((goal) => {
    if (goal.kind === 'university') {
      if (!childIds.has(goal.childId) || funded.has(goal.childId)) return false
      funded.add(goal.childId)
      return true
    }
    if (goal.kind !== 'childCost') return true
    if (!childIds.has(goal.childId) || covered.has(goal.childId)) return false
    covered.add(goal.childId)
    return true
  })
  const added = plan.children
    .filter((child) => !covered.has(child.id))
    .map((child) => childCostGoalTemplate(defaults, child.id))
  if (added.length === 0 && kept.length === plan.goals.length) return plan.goals
  return [...kept, ...added]
}

/** 自由入力のカードの型（毎月の支出・毎月の収入・一度きりの支出）を読む */
export function customVariantOf(goal: CustomGoal): CustomVariant {
  if (goal.amountType === 'once') return 'onceExpense'
  return goal.direction === 'income' ? 'monthlyIncome' : 'monthlyExpense'
}

/**
 * 自由入力のカードの型を替える。id・オンオフは残す。
 *
 * - 毎月の支出 ⇄ 収入：向きだけ替え、金額と期間は残す
 * - 毎月 ⇄ 一度きり：金額の意味（月額と総額）と期間の持ち方が変わるので、金額と時期は雛形の値にする
 * - 名前は、雛形の名前のままなら新しい型の雛形の名前にし、本人が付けた名前なら残す
 */
export function changeCustomVariant(
  goal: CustomGoal,
  variant: CustomVariant,
  defaults: AppDefaults,
  base: YearMonth,
): CustomGoal {
  const current = customVariantOf(goal)
  if (current === variant) return goal
  const template = customGoalTemplate(defaults, base, goal.id, variant)
  const name = templateNames(defaults).includes(goal.name) ? template.name : goal.name

  if (goal.amountType === 'monthly' && template.amountType === 'monthly') {
    return { ...goal, name, direction: template.direction }
  }
  return { ...template, name, enabled: goal.enabled }
}

/** 雛形の名前の一覧（型を替えたときに名前も替えるかの判定に使う） */
function templateNames(defaults: AppDefaults): string[] {
  const monthly = defaults.templates.customMonthly.value
  return [monthly.expenseName, monthly.incomeName, defaults.templates.customOnce.value.name]
}

/** 省略できない項目が無ければ投げる */
function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new RangeError(`${label}がありません`)
  }
  return value
}

/**
 * 新しい中核（`domain/plan/`）の入力と出力の型（SPEC 第 2 版 §2・§3.1・§3.3）。
 *
 * 金額は円の整数（`Yen`）。画面では万円で見せるが、domain は円のまま持つ。
 * 前の版から残した計算の型は `domain/types.ts` にあり、ここからは単位の型だけを借りる。
 */

import type { Rate, Yen } from '../money'
import type { HouseholdTaxInput, HouseholdTaxTables } from '../tax/household'
import type { MasterTables, MunicipalityCode, Month, PersonId, Year } from '../types'

export type { Month, MunicipalityCode, PersonId, Rate, Year, Yen }

// ---------------------------------------------------------------------------
// 単位
// ---------------------------------------------------------------------------

/** 年月。帯の始まりと終わり、計算の起点に使う。日は持たない */
export type YearMonth = { year: Year; month: Month }

/** 子の識別子 */
export type ChildId = string

/** 目標カードの識別子。`'living'`（暮らしの帯）とは重ならないこと */
export type GoalId = string

// ---------------------------------------------------------------------------
// 入力：LifePlan（SPEC §2）
// ---------------------------------------------------------------------------

/** 世帯の計画。画面の入力をこの 1 つにまとめて domain に渡す */
export type LifePlan = {
  /** 計算の起点。保存しない（開くたびに画面が今日から作る） */
  baseYearMonth: YearMonth
  /** 1〜2 人。先頭が本人 */
  adults: Adult[]
  children: ChildProfile[]
  /** 住民税・国保の料率に使う */
  municipality: MunicipalityCode
  living: Living
  goals: Goal[]
  assumptions: Assumptions
}

/** 大人 1 人 */
export type Adult = {
  id: PersonId
  birthYear: Year
  workStyle: WorkStyle
  /** 会社員は額面の年収（賞与込み）。自営業は所得（売上 − 経費） */
  annualIncome: Yen
  /** 見込み：毎年の上がり方 */
  raiseRate: Rate
  /** 見込み：「この年からこの年収」。空でよい */
  outlookSteps: OutlookStep[]
  /** 副業の所得（月）。既定 0 */
  sideMonthlyProfit: Yen
  /** 退職の年齢。既定 65 ★（SPEC §8 の 3） */
  retirementAge: number
}

export type WorkStyle = 'employee' | 'selfEmployed' | 'notWorking'

/** 見込みの年収の段（この年からこの年収） */
export type OutlookStep = { year: Year; annualIncome: Yen }

/** 子 1 人。進路や塾は子の費用のカード（`ChildCostGoal`）が持つ */
export type ChildProfile = { id: ChildId; birthYear: Year; birthMonth: Month }

/** 暮らし。生活費は家賃・保育料・教育費を除く */
export type Living = { monthlyLivingCost: Yen; monthlyRent: Yen }

/** 前提 */
export type Assumptions = {
  /** 積立の利回り（年） */
  investmentReturnRate: Rate
  /** 物価の上がり方（年）。既定 0 ★（SPEC §3.4） */
  inflationRate: Rate
  /** 住宅ローンの金利（年） */
  mortgageRate: Rate
}

// ---------------------------------------------------------------------------
// 目標カード（SPEC §2.1）
// ---------------------------------------------------------------------------

/** 目標カード 1 枚。`kind` で中身が決まる */
export type Goal = UniversityGoal | RetirementGoal | HomeGoal | CarGoal | ChildCostGoal | CustomGoal

export type GoalKind = Goal['kind']

/** どのカードにもある項目 */
type GoalBase = {
  id: GoalId
  /** 見直しでオン・オフする。オフのカードは帯を出さない */
  enabled: boolean
}

/** 積立の型のカードにある項目 */
type SavingGoalBase = GoalBase & {
  /** すでに貯まっている額 */
  saved: Yen
}

/**
 * 大学資金（子ごと。T10）。今から高校 3 年の 3 月まで積み立てる（SPEC §3.2「大学資金・老後資金のカードの細部」）。
 * 子ごとに 1 枚まで（児童手当を二重に回さないため）。子を外すと消える
 */
export type UniversityGoal = SavingGoalBase & {
  kind: 'university'
  childId: ChildId
  /**
   * 進路（D37）。選ぶと目標額がその進路の 4 年ぶんに替わる（`changeUniversityCourse`）。計算には使わず、目標額だけが帯に効く。
   * 無いのは進路を持たない前の保存（T10 のころのカード）。そのときは「選んでいない」で出し、目標額は保存のまま
   */
  course?: UniversityCourse
  targetAmount: Yen
  /** 児童手当を大学資金に回すか。回すあいだ、その子の児童手当は子の費用のカードの収入から外れる */
  allocateChildAllowance: boolean
  /** 置き場。`childNisa`（子の名義の NISA）は前提の利回り、`deposit`（預金）は利回り 0 */
  vehicle: 'childNisa' | 'deposit'
}

/**
 * 大学の進路（D37）。`data/education/university-cost.json` のキーのうち 4 年制の 3 つ（私立理系・私立文系・国立）。
 * 医歯系（6 年）は入れない（帯の期間は高校 3 年の 3 月までで同じだが、目標額の桁が大きく違い、選ぶ人が少ないため。Claude の判断）
 */
export type UniversityCourse = 'privateScience' | 'privateHumanities' | 'nationalPublic'

/** 老後資金（T10）。今から `byYear` の前年末まで積み立てる */
export type RetirementGoal = SavingGoalBase & {
  kind: 'retirement'
  targetAmount: Yen
  /** この年の前年末までに貯める */
  byYear: Year
  /** 置き場。`nisa` は前提の利回り、`deposit`（預金）は利回り 0 */
  vehicle: 'nisa' | 'deposit'
}

/** 家。帯にするのは T7。`saved` は頭金と諸費用のために貯まっている額 */
export type HomeGoal = SavingGoalBase & {
  kind: 'home'
  purchaseYear: Year
  price: Yen
  downPayment: Yen
  loanYears: number
  /** 修繕・固定資産税・保険（月） */
  monthlyUpkeep: Yen
}

/**
 * 車（T8）。`saved` は現金で買うときの最初の車の積立にだけ使う（ローンのとき・もう持っているときは使わない）。
 * 次の車からは「次の車の積立」で買うので、ローンを組むのは最初の車だけ（SPEC §3.2「車のカードの細部」）
 */
export type CarGoal = SavingGoalBase & {
  kind: 'car'
  purchaseYear: Year
  price: Yen
  payment: CarPayment
  monthlyUpkeep: Yen
  /** 何年ごとに買い替えるか。null なら買い替えない */
  replaceEveryYears: number | null
}

export type CarPayment = { type: 'cash' } | { type: 'loan'; years: number }

/**
 * 子の費用（子ごと。子を足すと自動で付き、子を外すと消える。T9）。
 * 大学の費用は入れない（大学資金のカードが受け持つ）。児童手当も扱わない（T10）
 */
export type ChildCostGoal = GoalBase & {
  kind: 'childCost'
  childId: ChildId
  schools: SchoolTypes
  cramSchools: CramSchool[]
  /**
   * 習い事の月額（小学校から高校まで）。null なら統計の平均
   * （`school-cost.json` の「その他の学校外活動費」。段階と公立・私立ごとに違う）
   */
  lessonsMonthly: Yen | null
  /**
   * 保育料の月額（自治体に払う額。園に払う給食費などの実費は含めない）。無償化が始まる年度（3 歳児クラス）の 4 月で終わり、
   * その後は小学校に上がるまで給食費の目安（制度データ）が入る（D24）。保育園に通わないなら null
   */
  childcareMonthly: Yen | null
}

export type SchoolType = 'public' | 'private'

/** 進路（小・中・高の公立 / 私立） */
export type SchoolTypes = { elementary: SchoolType; juniorHigh: SchoolType; highSchool: SchoolType }

/**
 * 塾に通う学年と月額。学年は小 1 = 1、中 1 = 7、高 1 = 10、高 3 = 12（前の版の `CramSchoolPeriod` と同じ数え方）。
 * `toGrade` の学年まで含む。行が重なる学年は足す
 */
export type CramSchool = { fromGrade: number; toGrade: number; monthly: Yen }

/**
 * 子の費用のカードと大学資金のカードが読む制度データ（学習費・大学の学費・保育の無償化・就学支援金・児童手当）。
 * `MasterTables` をそのまま渡せる
 */
export type ChildCostTables = Pick<
  MasterTables,
  'schoolCost' | 'universityCost' | 'childcare' | 'highSchoolSupport' | 'childAllowance'
>

/**
 * NISA の上限（`data/benefit/nisa.json` の裏取り済みの値だけ。`data/appData.ts` の `nisaLimitsFrom` が組み立てる）。
 * 年の上限と生涯の上限は、積んだ元本（簿価）で数える。知らせに使うだけで、計算は止めない（SPEC §3.2）
 */
export type NisaLimits = {
  /** 1 月 1 日に `minAgeOnJan1` 歳以上の人の NISA（1 人ずつ。世帯で合算しない） */
  adult: {
    fromYear: Year
    minAgeOnJan1: number
    /** つみたて投資枠の年の上限 */
    annualTsumitate: Yen
    /** 成長投資枠の年の上限 */
    annualGrowth: Yen
    /** 生涯の上限（つみたて投資枠と成長投資枠の合計） */
    lifetime: Yen
  }
  /** 未成年者のつみたて投資枠（`fromYear` から。1 月 1 日に `maxAgeOnJan1Exclusive` 歳未満の年と、生まれた年） */
  minor: {
    fromYear: Year
    maxAgeOnJan1Exclusive: number
    annual: Yen
    lifetime: Yen
  }
}

/** `evaluate` が読む表：税・社会保険の表と子の費用・大学資金のカードの制度データ（`MasterTables`）に、NISA の上限を足した物 */
export type PlanTables = HouseholdTaxTables & ChildCostTables & { nisa: NisaLimits }

/**
 * 自由入力のカード。
 *
 * 毎月の物は `from` から `to` の前まで（`Band` と同じ数え方）。
 * 一度きりの物は支出だけで、使う月 `at` までの積立の帯になる（SPEC §2.1・§3.2）。
 * 一度きりの収入は持たない（使い道のカードの `saved` に入れてもらう）。
 */
export type CustomGoal = GoalBase & { kind: 'custom'; name: string } & (CustomMonthly | CustomOnce)

export type CustomMonthly = {
  amountType: 'monthly'
  direction: 'expense' | 'income'
  /** 月額 */
  amount: Yen
  /** この月から */
  from: YearMonth
  /** この月の前まで */
  to: YearMonth
}

export type CustomOnce = {
  amountType: 'once'
  direction: 'expense'
  /** 使う額 */
  amount: Yen
  /** 使う月。この月の前まで積み立てる */
  at: YearMonth
  /** すでに貯まっている額 */
  saved: Yen
}

// ---------------------------------------------------------------------------
// 帯（SPEC §3.1）
// ---------------------------------------------------------------------------

/** 暮らしの帯の goalId */
export const LIVING_GOAL_ID = 'living'

/**
 * 帯が属する目標の id。暮らしの帯は `LIVING_GOAL_ID`（`'living'`）。
 * SPEC §3.1 の `GoalId | 'living'` は、`GoalId` が string なので型の上では string と同じになる
 */
export type BandOwner = GoalId

/**
 * 帯の種類。
 * - `saving`（積立）と `payment`（支払い）は要る手取りに足す
 * - `income`（給付・その他の収入）は引く
 * - `earmarked`（児童手当をこども NISA に回す分）は要る手取りに入れず、カードに見せるだけ
 */
export type BandKind = 'saving' | 'payment' | 'income' | 'earmarked'

/** 「いつからいつまで、毎月いくら」の 1 本 */
export type Band = {
  goalId: BandOwner
  /** 「頭金の積立」「返済」「塾」など。画面にそのまま出す */
  label: string
  kind: BandKind
  /** 月額。0 以上の円の整数 */
  monthly: Yen
  /** この月から */
  from: YearMonth
  /** この月の前まで */
  to: YearMonth
}

/** 目標カードを帯に直すときに渡す物 */
export type BandContext = {
  /** 計算の起点（`LifePlan.baseYearMonth`） */
  base: YearMonth
  /** 「ずっと」の帯の終わり（この月の前まで）。要る手取りを数える最後の年の翌年 1 月 */
  until: YearMonth
  /** 前提のうち、帯の額に効く物（維持費・教育費に掛ける物価・住宅ローンの金利・積立の利回り） */
  assumptions: Pick<Assumptions, 'inflationRate' | 'mortgageRate' | 'investmentReturnRate'>
  /** 帯に使うアプリの既定値（`defaults.json` から `bandContext` が取り出す） */
  settings: BandSettings
  /** 子（`LifePlan.children` の順）。子ごとのカードが生まれ年月と、帯の名前に添える子の順を読む */
  children: readonly ChildProfile[]
  /** 子の費用・大学資金のカードが読む制度データ */
  tables: ChildCostTables
  /**
   * 児童手当を大学資金に回している子（その子の大学資金のカードがオンで「回す」）。
   * この子の児童手当は大学資金のカードが `earmarked` で出し、子の費用のカードは収入の帯を出さない（二重に数えない）
   */
  allowanceEarmarked: ReadonlySet<ChildId>
}

/** 帯に使うアプリの既定値 */
export type BandSettings = {
  /** 家の諸費用の率（価格に掛ける）。頭金と一緒に、買う月の前までに積み立てる */
  homeClosingCostRate: Rate
  /** 車の下取りの率（価格に掛ける）。次の車の積立は 価格 −（価格 × 率）を買い替えまでの月数で割る */
  carResaleRate: Rate
  /** 車のローンの金利（年）。住宅ローンの金利とは別に持つ */
  carLoanRate: Rate
}

// ---------------------------------------------------------------------------
// 年ごとの要る手取り（SPEC §3.3）
// ---------------------------------------------------------------------------

/** 1 年ぶんの要る手取りと、目標ごとの内訳 */
export type YearNeed = {
  year: Year
  /** 要る手取り（年額）。内訳の合計と一致する */
  requiredNet: Yen
  /** 目標ごとの年額。その年に重なる帯がある目標だけ、帯が最初に出た順に並ぶ。収入の帯は負で入る */
  byGoal: { goalId: BandOwner; annual: Yen }[]
}

// ---------------------------------------------------------------------------
// アプリの既定値（`data/app/defaults.json`）と見本の世帯（`data/app/sample-household.json`）。SPEC §6
// ---------------------------------------------------------------------------

/** 既定値 1 つと、その根拠 1 行 */
export type DefaultValue<T> = { value: T; basis: string }

/** アプリの既定値。制度の数値ではない。★ の付いた物は SPEC §8 の仮置き */
export type AppDefaults = {
  adult: {
    raiseRate: DefaultValue<Rate>
    sideMonthlyProfit: DefaultValue<Yen>
    retirementAge: DefaultValue<number>
  }
  assumptions: {
    investmentReturnRate: DefaultValue<Rate>
    inflationRate: DefaultValue<Rate>
    mortgageRate: DefaultValue<Rate>
  }
  /** 段へのまとめ方（SPEC §3.5） */
  steps: {
    /** 今の段の基準からこの割合を超えて変わったら新しい段（金額の条件と両方を満たすとき） */
    changeRatio: DefaultValue<Rate>
    /** 今の段の基準からこの額（年）を超えて変わったら新しい段（割合の条件と両方を満たすとき） */
    changeYen: DefaultValue<Yen>
    /** 段の理由に出す帯の数の上限 */
    maxCauses: DefaultValue<number>
  }
  /** 税の計算への橋渡し（SPEC §3.6）。`LifePlan` に無い項目を埋める */
  taxBridge: {
    /** 会社員の年収のうち賞与の割合（0〜1） */
    bonusShare: DefaultValue<Rate>
    /** 賞与の支給回数（年）。賞与の割合が 0 なら使わない */
    bonusPaymentCount: DefaultValue<number>
    /** 自営業の申告方式（`FilingType` のどれか。JSON では文字列で持ち、橋渡しが確かめる） */
    selfEmployedFilingType: DefaultValue<string>
    /** 寿命の想定（税の計算が「その年に生きているか」を見るため。階段は退職の前年で切れる） */
    lifeExpectancy: DefaultValue<number>
  }
  /** 埋め方の換算の探索（SPEC §3.6） */
  search: {
    /** 副業の月額を探す刻み（月） */
    sideMonthlyStep: DefaultValue<Yen>
  }
  /** 知らせ（SPEC §3.9） */
  notices: {
    /** 一度きりの出費の使う月までがこの月数を切ったら知らせる（SPEC §3.7） */
    onceSoonMonths: DefaultValue<number>
  }
  /** 家のカード（SPEC §3.2 の `home`・§3.7） */
  home: {
    /** 諸費用の率（価格に掛ける） */
    closingCostRate: DefaultValue<Rate>
    /** 借りる額の目安の倍率（借りる額 ÷ 買う年の見込みの世帯年収）。超えたら知らせる */
    loanToIncomeLimit: DefaultValue<number>
  }
  /** 車のカード（SPEC §3.2 の `car`） */
  car: {
    /** 下取りの率（価格に掛ける） */
    resaleRate: DefaultValue<Rate>
    /** 車のローンの金利（年） */
    loanRate: DefaultValue<Rate>
  }
  /** 「計画」で足すときの雛形（SPEC §1 `defaults.ts`・§4.2「種類を選ぶと既定値で入る」） */
  templates: {
    /** もう 1 人の大人を足すとき。年齢は起点の年で何歳か */
    adult: DefaultValue<{ ageAtBase: number; workStyle: string; annualIncome: Yen }>
    /** 子を足すとき。起点の年で何歳か（生まれ月は起点の月） */
    child: DefaultValue<{ ageAtBase: number }>
    /** 自由入力の毎月の支出・収入。起点の月から `years` 年後の 1 月の前まで */
    customMonthly: DefaultValue<{
      expenseName: string
      incomeName: string
      amount: Yen
      years: number
    }>
    /** 自由入力の一度きりの支出。起点の年から `atYearsLater` 年後の 1 月に使う */
    customOnce: DefaultValue<{ name: string; amount: Yen; atYearsLater: number }>
    /** 家のカード。起点の年から `purchaseYearsLater` 年後に買う。貯まっている額は 0 で入る */
    home: DefaultValue<{
      purchaseYearsLater: number
      price: Yen
      downPayment: Yen
      loanYears: number
      monthlyUpkeep: Yen
    }>
    /**
     * 車のカード。起点の年から `purchaseYearsLater` 年後に現金で買う。貯まっている額は 0 で入る。
     * `loanYears` は払い方をローンに替えたときの年数、`replaceEveryYears` は「買い替える」に替えたときにも使う
     */
    car: DefaultValue<{
      purchaseYearsLater: number
      price: Yen
      monthlyUpkeep: Yen
      replaceEveryYears: number
      loanYears: number
    }>
    /**
     * 子の費用のカード（子を足すと自動で付く）。進路は `'public'` か `'private'`（JSON では文字列で持ち、`defaults.ts` が確かめる）。
     * 習い事・保育は null（統計の平均・保育園に通わない）で入る。`cramSchool` は塾の行を足すときの雛形
     */
    childCost: DefaultValue<{
      schools: { elementary: string; juniorHigh: string; highSchool: string }
      lessonsMonthly: Yen | null
      childcareMonthly: Yen | null
      cramSchool: CramSchool
    }>
    /**
     * 大学資金のカード。目標額は `course`（`UniversityCostTable` の私立文系などのキー）の 4 年ぶんを
     * `data/education/university-cost.json` から組み立てる（数値をここに写さない）。置き場は `'childNisa'` か `'deposit'`
     */
    university: DefaultValue<{
      course: string
      allocateChildAllowance: boolean
      vehicle: string
      /** 雛形の目標額をこの円の単位に四捨五入する（入れる欄は万円なので 1 万円） */
      targetRoundTo: Yen
    }>
    /** 老後資金のカード。期限は年上の大人が退職する年。置き場は `'nisa'` か `'deposit'` */
    retirement: DefaultValue<{ targetAmount: Yen; vehicle: string }>
  }
}

/**
 * 自由入力のカードの型（向きと金額の型の組み合わせ）。画面ではこの 3 つから選ぶ。
 * 一度きりは支出だけ（SPEC §2.1）なので、組み合わせは 3 つになる
 */
export type CustomVariant = 'monthlyExpense' | 'monthlyIncome' | 'onceExpense'

/**
 * 見本の世帯の生の形（`data/app/sample-household.json`）。
 *
 * 年月は起点からの相対で持つ（いつ開いても同じ形の階段が出るように。SPEC §6）：
 * 大人と子は「起点の年で何歳」、自由入力のカードは「起点の年から何年後の 1 月」。
 * カードを月単位でずらすと、起点の月しだいで帯が暦年の途中で切り替わり、段の分かれ方が変わるため、年の頭にそろえる。
 * JSON から読むので、文字列の選択肢は生の形で持ち、`defaults.ts` が確かめて `LifePlan` に直す。
 */
export type SampleHouseholdSource = {
  basis: string
  adults: { id: string; ageAtBase: number; workStyle: string; annualIncome: number }[]
  children: { id: string; ageAtBase: number; birthMonth: number }[]
  municipality: string
  living: { monthlyLivingCost: number; monthlyRent: number }
  customGoals: SampleCustomGoalSource[]
  homeGoals: SampleHomeGoalSource[]
  carGoals: SampleCarGoalSource[]
  childCostGoals: SampleChildCostGoalSource[]
  universityGoals: SampleUniversityGoalSource[]
  retirementGoals: SampleRetirementGoalSource[]
}

/** 見本の大学資金のカード。`childId` は見本の子の id。置き場は `'childNisa'` か `'deposit'` */
export type SampleUniversityGoalSource = {
  id: string
  childId: string
  targetAmount: number
  allocateChildAllowance: boolean
  vehicle: string
  saved: number
}

/** 見本の老後資金のカード。`byYearsLater` は起点の年から何年後の年の前年末までに貯めるか。置き場は `'nisa'` か `'deposit'` */
export type SampleRetirementGoalSource = {
  id: string
  targetAmount: number
  byYearsLater: number
  vehicle: string
  saved: number
}

/**
 * 見本の子の費用のカード。`childId` は見本の子の id。進路は `'public'` か `'private'`。
 * 塾の学年は小 1 = 1 〜 高 3 = 12（起点の年月に依らない）
 */
export type SampleChildCostGoalSource = {
  id: string
  childId: string
  schools: { elementary: string; juniorHigh: string; highSchool: string }
  cramSchools: CramSchool[]
  lessonsMonthly: number | null
  childcareMonthly: number | null
}

/**
 * 見本の車のカード。`purchaseYearsLater` は起点の年から何年後に買うか（買う月はその年の 1 月）。
 * `payment` は `'cash'` か `'loan'`（ローンなら `loanYears` が要る）。`replaceEveryYears` は null で買い替えない
 */
export type SampleCarGoalSource = {
  id: string
  purchaseYearsLater: number
  price: number
  payment: string
  loanYears?: number
  monthlyUpkeep: number
  replaceEveryYears: number | null
  saved: number
}

/** 見本の家のカード。`purchaseYearsLater` は起点の年から何年後に買うか（買う月はその年の 1 月。SPEC §2.1） */
export type SampleHomeGoalSource = {
  id: string
  purchaseYearsLater: number
  price: number
  downPayment: number
  loanYears: number
  monthlyUpkeep: number
  saved: number
}

/** 見本の自由入力のカード。`*YearsLater` は起点の年から何年後の 1 月か（0 なら起点の年の 1 月） */
export type SampleCustomGoalSource = {
  id: string
  name: string
  direction: string
  amountType: string
  amount: number
  fromYearsLater?: number
  toYearsLater?: number
  atYearsLater?: number
  saved?: number
}

// ---------------------------------------------------------------------------
// 段・税への橋渡し・換算で、複数のファイルが使う型（SPEC §3.5・§3.6）
// ---------------------------------------------------------------------------

/** 段のしきい値と理由の数（`defaults.json` の `steps` の値） */
export type StepThresholds = {
  changeRatio: Rate
  changeYen: Yen
  maxCauses: number
}

/** 帯 1 本ぶんの、ある年の年額。帯は目標と名前で見分ける */
export type BandAnnual = { goalId: BandOwner; label: string; annual: Yen }

/** 税への橋渡しに使う既定値（`defaults.json` の `taxBridge`） */
export type TaxBridgeSettings = AppDefaults['taxBridge']

/** ある年の大人 1 人の収入の水準 */
export type IncomeLevel = {
  /** 本業。会社員は額面（賞与込み）、自営業は所得。働いていない・退職した年は 0 */
  main: Yen
  /** 副業の所得（月）。退職した年からは 0 */
  sideMonthly: Yen
}

/** 大人ごとの収入の水準。`plan.adults` の順で、全員ぶん持つ */
export type IncomeLevels = ReadonlyMap<PersonId, IncomeLevel>

/** ある年の要る世帯年収と換算に要る物。`evaluate` が段ごとに作る */
export type SolveContext = {
  plan: LifePlan
  year: Year
  /** その年の見込みの収入の水準 */
  expected: IncomeLevels
  taxInput: HouseholdTaxInput
  settings: TaxBridgeSettings
  /** 副業の月額を探す刻み */
  sideMonthlyStep: Yen
  tables: HouseholdTaxTables
}

// ---------------------------------------------------------------------------
// 段と入口の結果（SPEC §3.5・§3.6・§3.9）
// ---------------------------------------------------------------------------

/**
 * 段の理由の帯が、前の段からどう変わったか（W18。画面は ± の記号でなく、この言葉の組で並べる）。
 * start：前の段の年に無く、この段の年にある（始まる）／end：前の段の年にあり、この段の年に無いか、この段の年の途中で終わる（終わる）／
 * more・less：どちらの年にもあり、額の大きさが増えた・減った（増える・減る）。収入の帯も額の大きさで見る（児童手当が増えるは more）
 */
export type CauseChange = 'start' | 'end' | 'more' | 'less'

/** 段の理由 1 つ。前の段と比べて始まった・増えた帯（正）と、終わった・減った帯（負） */
export type StepCause = {
  goalId: BandOwner
  label: string
  /** 月額の差（今のお金の価値）。要る手取りを押し上げる向きが正（収入の帯が終わると正） */
  monthlyDelta: Yen
  /** 前の段からどう変わったか */
  change: CauseChange
  /**
   * 画面に出す月額（0 以上。今のお金の価値）。始まる帯はこの段の年の月額、終わる帯は前の段の年の月額、
   * 増える・減る帯は差の大きさ。年の途中で終わる帯の差（`monthlyDelta`）は残る月のぶん小さいので、終わる前の額を出す
   */
  monthly: Yen
}

/**
 * 段。要る手取りがほぼ同じ年の集まり。金額はすべて今のお金の価値（物価が 0 なら入れた金額どおり）
 */
export type Step = {
  fromYear: Year
  toYear: Year
  /** 段の値になった年（段の中で要る手取りがいちばん大きい年。同じなら早い年） */
  peakYear: Year
  /** 要る手取り（年）。段の中の最大 */
  requiredNet: Yen
  /** 要る世帯年収（額面）。いちばん稼ぐ大人の収入を動かしても届かないとき null */
  requiredGross: Yen | null
  /** 見込みの世帯年収（段の値になった年。段の中の数字はすべてこの年に揃える） */
  expectedGross: Yen
  /** 前の段と比べた理由。金額の大きい順に上限まで。最初の段は空 */
  causes: StepCause[]
  /** 段の値になった年の、目標ごとの内訳 */
  byGoal: { goalId: BandOwner; annual: Yen }[]
}

/** 埋め方 1 つの換算。今と、要る手取りに届く額と、その差 */
export type IncomeConversion = {
  /** 収入を動かす大人 */
  personId: PersonId
  /** 今の見込み */
  current: Yen
  /** 要る手取りに届く最小の額 */
  required: Yen
  /** 差（`required − current`） */
  increase: Yen
}

/**
 * 段 1 つぶんの埋め方の換算（SPEC §3.6）。要る世帯年収が見込みの世帯年収を上回る（解けない段を含む）段だけに作る。
 * アプリはどれかを勧めない（D31）。届かない・動かせる人がいない換算は null
 */
export type StepConversions = {
  /** どの段の換算か（`Step.fromYear`） */
  fromYear: Year
  /** 要る手取り − 見込みの手取り（年。今のお金の価値） */
  shortfallNet: Yen
  /** いちばん稼ぐ大人の本業を上げるなら（年額。会社員は額面、自営業は所得） */
  mainJob: IncomeConversion | null
  /** いちばん稼ぐ大人の副業なら（月額の所得） */
  sideJob: IncomeConversion | null
  /** もう 1 人の大人の本業を上げるなら（年額）。大人が 1 人、もう 1 人が働いていない・退職したときは null */
  otherAdult: IncomeConversion | null
}

/**
 * 大学資金・老後資金のカードの積立の答え（SPEC §3.2「大学資金・老後資金のカードの細部」）。
 * 到達額は使う月（大学資金は高校 3 年の次の 4 月、老後資金は `byYear` の 1 月）の時点の額。金額は入れた金額どおり（物価で割り戻さない）
 */
export type FundPlan = {
  goalId: GoalId
  /** 積み立て始める月（起点） */
  from: YearMonth
  /** 使う月（この月の前まで積み立てる） */
  useMonth: YearMonth
  /** 月の利率（前提の利回り（年）を `(1 + r)^(1/12) − 1` に直した物。預金は 0） */
  monthlyRate: number
  /** 家計から足す月額（1 円未満は切り上げ。児童手当と貯まっている額で届けば 0） */
  householdMonthly: Yen
  /** 児童手当から回す月額の並び（`from` の月から 1 か月ずつ。回さないカードは空） */
  allowanceMonthly: readonly Yen[]
  /** 使う月の時点の到達額と、その内訳（それぞれ円に四捨五入。合計は内訳の和） */
  reached: { saved: Yen; allowance: Yen; household: Yen; total: Yen }
}

/** NISA の口座の種類（上限の知らせに使う） */
export type NisaAccount = 'minor' | 'adult'

/**
 * 知らせ（SPEC §3.9）。計算は止めずに、利用者に見せる結果として返す
 */
export type Notice =
  /** 住んでいる自治体の国保の料率が表に無く、ほかの自治体の料率で概算した */
  | { kind: 'municipalityApproximated'; municipality: MunicipalityCode }
  /** いちばん稼ぐ大人の収入を探索の上限まで上げても、要る手取りに届かない段 */
  | { kind: 'unsolvableStep'; fromYear: Year; toYear: Year }
  /** 使う月が起点の月か過ぎている一度きりの出費（帯が出ない） */
  | { kind: 'onceGoalPast'; goalId: GoalId; name: string }
  /** 使う月まで少ししかない一度きりの出費（積立の月額が大きくなり、今の段を押し上げる） */
  | { kind: 'onceGoalSoon'; goalId: GoalId; name: string; monthsLeft: number }
  /** 要る手取りが負の年（収入の帯が支出を上回る） */
  | { kind: 'negativeNeed'; years: Year[] }
  /** 家の借りる額が、買う年の見込みの世帯年収の目安の倍率を超える（SPEC §3.7）。年収が 0 なら ratio は null */
  | { kind: 'homeLoanHeavy'; goalId: GoalId; ratio: number | null; limit: number }
  /**
   * 家を買う月まで少ししかないのに、頭金と諸費用がまだ貯まり切っていない
   * （短い期間で積むので積立の月額が大きくなり、今の段を押し上げる。`onceGoalSoon` と同じ考え方）
   */
  | { kind: 'homeSavingSoon'; goalId: GoalId; monthsLeft: number }
  /** 車を現金で買う月まで少ししかないのに、代金がまだ貯まり切っていない（`homeSavingSoon` と同じ考え方） */
  | { kind: 'carSavingSoon'; goalId: GoalId; monthsLeft: number }
  /**
   * NISA の積立の元本が上限を超える（大学資金・老後資金のカードで置き場が NISA のとき。SPEC §3.2）。
   * `limit` が `annual` なら `year` の 1 年の元本 `amount` が年の上限 `cap` を、`lifetime` なら `year` までの元本の累計 `amount` が生涯の上限 `cap` を超える。
   * `holders` は上限を何人ぶんで数えたか（老後資金は大人の人数。大学資金は 1）。カードごとに、年・生涯それぞれ最初に超える年だけ出す
   */
  | {
      kind: 'nisaLimit'
      goalId: GoalId
      /** 誰の名義の NISA か（大学資金は子、老後資金は世帯の大人） */
      owner: 'child' | 'household'
      account: NisaAccount
      limit: 'annual' | 'lifetime'
      year: Year
      amount: Yen
      cap: Yen
      holders: number
    }
  /** 大学資金のカードで、児童手当（と貯まっている額）だけで目標額に届く（家計から足す額は 0） */
  | { kind: 'allowanceCovers'; goalId: GoalId; withSaved: boolean }
  /** 大学資金・老後資金のカードの期限（使う月）が起点の月か過ぎている（帯が出ない） */
  | { kind: 'fundDeadlinePast'; goalId: GoalId }

/** `evaluate` の結果（SPEC §3.9）。金額は今のお金の価値（帯だけは入れた金額どおり） */
export type Evaluation = {
  bands: Band[]
  /** 年ごとの要る手取り（今のお金の価値に割り戻した物） */
  years: YearNeed[]
  steps: Step[]
  /** 今の世帯年収（起点の年の見込み。本業 ＋ 副業の所得） */
  currentGross: Yen
  /** 要る世帯年収が今の世帯年収を初めて上回る段。解けない段も上回るとみなす。無ければ null */
  nextStep: Step | null
  /** 段ごとの埋め方の換算（要る世帯年収が見込みの世帯年収を上回る段だけ） */
  conversions: StepConversions[]
  notices: Notice[]
}

// ---------------------------------------------------------------------------
// 目標の重さ（SPEC §3.8）
// ---------------------------------------------------------------------------

/** 段 1 つの要る世帯年収だけ（`evaluate` の `Step` と同じ値。重さの計算は換算・理由・知らせを出さない） */
export type StepGross = Pick<Step, 'fromYear' | 'toYear' | 'peakYear' | 'requiredGross'>

/**
 * いちばん高い段の要る世帯年収（今のお金の価値）。
 * `unsolvable`：どこかの段が解けない（解けない段はどの金額より高いとみなす。SPEC §3.9 の「次の段」と同じ扱い）／
 * `noSteps`：階段に出す年が無い（働く大人が全員すでに退職の年齢）
 */
export type PeakGross =
  { kind: 'solved'; gross: Yen } | { kind: 'unsolvable' } | { kind: 'noSteps' }

/**
 * 目標 1 つの重さ（SPEC §3.8）。そのカードのオン・オフを入れ替えて計算し直した、いちばん高い段の要る世帯年収の差。
 * `action` が `remove` ならオンのカードを外したとき、`add` ならオフのカードを入れたとき
 */
export type GoalImpact = {
  goalId: GoalId
  action: 'remove' | 'add'
  /** 今の計画のいちばん高い段 */
  current: PeakGross
  /** オン・オフを入れ替えた計画のいちばん高い段 */
  toggled: PeakGross
  /**
   * 差（`toggled − current`）。両方とも解けたときだけ数字にする。
   * `down`：下がる／`same`：変わらない／`up`：上がる（収入のカード、扶養に効く大学資金のカードなど）。
   * どちらかが解けない・段が無いときは `unavailable`（例外にしない）
   */
  outcome:
    { kind: 'change'; change: Yen; direction: 'down' | 'same' | 'up' } | { kind: 'unavailable' }
}

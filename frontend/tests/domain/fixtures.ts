/**
 * テスト用のサンプル入力。
 *
 * **ここに書く値はすべて架空のものにする。**
 * このリポジトリは一般公開するため、サンプルの生年月・金額・組み合わせは、特定の世帯を思わせない値にする。
 *
 * 値を書くときの規則は `.claude/rules/dummy-values.md` を参照。
 *
 * このファイルは、残した計算（税・社会保険・世帯収入の集計・教育費）の入力が実際に組み立てられることの型レベルの検証も兼ねる。
 * 型に必須フィールドを足したらここがコンパイルエラーになるので、追随漏れに気づける。
 *
 * 前の版の入力の型（`SimulationInput`）は T13 で消した。ここの入力は、残した計算が読む項目だけを持つ `TaxTestInput`。
 */

import type { HouseholdIncomeInput } from '../../src/domain/income/household'
import type { HouseholdTaxInput } from '../../src/domain/tax/household'
import childAllowanceJson from '../../src/data/benefit/child-allowance.json'
import childcareFreeJson from '../../src/data/childcare/free-education.json'
import childcareMealFeeJson from '../../src/data/childcare/mealFee.json'
import highSchoolSupportJson from '../../src/data/benefit/high-school-support.json'
import incomeTaxJson from '../../src/data/tax/income-tax.json'
import nationalInsuranceJson from '../../src/data/tax/national-insurance.json'
import residentTaxJson from '../../src/data/tax/resident-tax.json'
import schoolCostJson from '../../src/data/education/school-cost.json'
import socialInsuranceJson from '../../src/data/tax/social-insurance.json'
import universityCostJson from '../../src/data/education/university-cost.json'
import type {
  ChildAllowanceTable,
  ChildcareTable,
  EducationPlan,
  HighSchoolSupportTable,
  IncomeTaxTable,
  InsurancePlan,
  MasterTables,
  NationalInsuranceTable,
  ResidentTaxTable,
  SchoolCostTable,
  SocialInsuranceTable,
  UniversityCostTable,
} from '../../src/domain/types'

/**
 * テストの世帯の入力。税の入口（`householdTaxYear`）と世帯収入の集計（`householdIncome`）が読む項目に、
 * 教育費の計算（`educationCostInYear`）が読む `education` を足した物
 */
export type TaxTestInput = HouseholdTaxInput & HouseholdIncomeInput & { education: EducationPlan }

/**
 * 制度のマスタデータ。**これはダミーではなく実際の公的な数値。**
 *
 * 型を付けて公開することで、JSON の形が `SchoolCostTable` から外れたら
 * コンパイルエラーになる（マスタデータを更新したときの追随漏れに気づける）。
 */
export const schoolCost: SchoolCostTable = schoolCostJson.values
export const universityCost: UniversityCostTable = universityCostJson.values
export const childAllowance: ChildAllowanceTable = childAllowanceJson.values
export const highSchoolSupport: HighSchoolSupportTable = highSchoolSupportJson.values
export const childcareFree: ChildcareTable = {
  ...childcareFreeJson.values,
  standardMonthlyStapleFoodCost: childcareMealFeeJson.values.appDefault.stapleFoodMonthly,
}
export const incomeTax: IncomeTaxTable = incomeTaxJson.values
export const socialInsurance: SocialInsuranceTable = socialInsuranceJson.values
export const residentTax: ResidentTaxTable = residentTaxJson.values
export const nationalInsurance: NationalInsuranceTable = nationalInsuranceJson.values

/** 架空の自治体コード（実在しない値） */
export const DUMMY_CITY_FROM = '99001'
export const DUMMY_CITY_TO = '99002'

/** 保険の入り方の既定。扶養に入る大人なし・国保の世帯主は先頭の大人 */
export const defaultInsurance: InsurancePlan = {
  dependentAdultIds: [],
  nationalHealthInsuranceHouseholderId: null,
}

/**
 * 手計算で追える最小の世帯。**値はすべて架空**（`.claude/rules/dummy-values.md`）。
 *
 * - 大人1人（1970年生・58歳まで就労 → 最終就労年 2028・60歳想定 → 2030年まで）
 * - 給与 600万・賞与なし・昇給ゼロ。自治体は架空の 99001（住民税は標準税率、国保は表の代わりの自治体の料率で概算）
 * - 家賃 月8.5万（税には効かない）
 * - 退職金 500万（2028年）・年金 120万（59歳 = 2029年から）。年金の改定率 0
 *
 * 年ごとの税・社会保険と手取りは `minimalHouseholdByYear`（下）に、表からの手計算の内訳つきで置いてある。
 * 前の版（T13 で消した）は生活費・資産・目標も持ち、資産の推移まで手計算で追っていた（タグ `v1-final`）
 */
export function makeMinimalInput(overrides: Partial<TaxTestInput> = {}): TaxTestInput {
  return {
    baseYear: 2026,
    adults: [{ id: 'a1', birthYear: 1970, retirementAge: 58, lifeExpectancy: 60 }],
    children: [],
    incomes: [
      {
        kind: 'employment',
        personId: 'a1',
        annualGross: 6000000,
        annualBonus: 0,
        baseRaiseRate: 0,
        bonusPaymentCount: 2,
      },
    ],
    promotionScenario: null,
    sideBusinessSchedule: null,
    residence: [
      { fromYear: 2020, municipality: DUMMY_CITY_FROM, monthlyRent: 85000, moveInCost: 0 },
    ],
    investmentProperties: [],
    education: {
      universityLiving: 'fromHome',
      annualLessonCost: null,
      annualAllowanceAwayFromHome: 0,
    },
    retirement: {
      byPerson: [
        {
          personId: 'a1',
          severancePay: 5000000,
          severanceYear: null,
          pensionStartAge: 59,
          annualPension: 1200000,
        },
      ],
    },
    insurance: defaultInsurance,
    assumptions: { pensionIndexationRate: 0 },
    ...overrides,
  }
}

/**
 * `makeMinimalInput`（副業なし）の年ごとの税・社会保険・手取り・収支。
 *
 * **実装の出力の写しではなく、`data/tax/*.json` の表から Python の Decimal で独立に手計算した値**（KNOWLEDGE 2026-09-15）。
 * `.5` ちょうどの丸めが 1 つも出ない組み合わせであることを確かめてある。
 *
 * - 2026〜2028（56〜58 歳・会社員）
 *   - 社会保険料 932,100：標準報酬月額 50 万。健保 24,800 + 介護 4,050 + 支援金 575 + 厚年 45,750 = 月 75,175 × 12、雇用保険 600 万 × 0.5% = 30,000
 *   - 給与所得 600 万 − (600 万 × 20% + 44 万) = 436 万
 *   - 所得税 2026・2027：436 万 − 932,100 − 基礎控除 104 万 → 課税所得 2,387,000 × 10% − 97,500 = 141,200 × 1.021 = 144,165
 *     （2027 年は付加税が 1.1% + 1.0% に組み替わるが合計は同じ 2.1%）
 *   - 所得税 2028：基礎控除が 62 万に戻り、課税所得 2,807,000 → 183,200 × 1.021 = 187,047
 *   - 住民税（標準税率）：436 万 − 932,100 − 43 万 → 課税所得 2,997,000 × 10% − 調整控除 2,500 + 均等割 5,000 = 302,200。
 *     起点年は前年も同じ所得とみなすので 2026 年から同じ額を納める
 * - 2029（59 歳・退職の翌年）：給与は無いが、**前年の給与ぶんの住民税 302,200 と国保が乗る**（1 年ずれ）
 *   - 国保（99001 は表に無いので代わりの市〔national-insurance.json の appDefault.fallbackMunicipalityCode〕の料率）：賦課基準額 436 万 − 43 万 = 393 万。
 *     医療 327,369 + 40,870／支援 102,966 + 13,380／介護 111,612 + 16,200／子ども 13,362 + 1,770 = 627,529
 *   - 国民年金 18,290 × 12 = 219,480（60 歳未満。表の最新の 2027 年度の月額を延ばす）
 * - 2030（60 歳）：前年の所得が 0 なので住民税 0、国保は均等割だけの 7 割軽減
 *   （12,261 + 4,014 + 4,860 + 531 = 21,666）。国民年金は 60 歳で終わる
 *
 * 前の版（T13 で消した）は、ここに年ごとの手取り（`net`）と収支（`netCashFlow`）も持っていた（タグ `v1-final`）。
 */
export const minimalHouseholdByYear: Readonly<
  Record<2026 | 2027 | 2028 | 2029 | 2030, { taxes: number; socialInsurance: number }>
> = {
  2026: { taxes: 446365, socialInsurance: 932100 },
  2027: { taxes: 446365, socialInsurance: 932100 },
  2028: { taxes: 489247, socialInsurance: 932100 },
  2029: { taxes: 302200, socialInsurance: 847009 },
  2030: { taxes: 0, socialInsurance: 21666 },
}

/** 制度のマスタデータの束。`evaluate` の表（`PlanTables`）の土台にもなる */
export const masterTables: MasterTables = {
  childAllowance: childAllowanceJson.values,
  highSchoolSupport: highSchoolSupportJson.values,
  childcare: childcareFree,
  schoolCost: schoolCostJson.values,
  universityCost: universityCostJson.values,
  incomeTax,
  socialInsurance,
  residentTax,
  nationalInsurance,
}

/**
 * 架空の世帯。値はテストのために作った物で、どの世帯の形も写していない。
 * 残した計算（税・社会保険・世帯収入の集計・教育費）が扱う所得の種類と子の進路を、ひととおり通る組み合わせにしてある。
 * 前の版（T13 で消した）は住宅・車・保育・目標・資産なども持っていた（タグ `v1-final`）
 */
export const sampleInput: TaxTestInput = {
  baseYear: 2025,

  adults: [
    { id: 'adult-1', birthYear: 1985, retirementAge: 70, lifeExpectancy: 95 },
    { id: 'adult-2', birthYear: 1988, retirementAge: 70, lifeExpectancy: 95 },
  ],

  children: [
    {
      id: 'child-1',
      birthYear: 2018,
      birthMonth: 4,
      elementarySchoolType: 'public',
      // 中学受験する想定。小4から塾に通い、私立中では塾を続けない
      juniorHighType: 'private',
      highSchoolType: 'private',
      // 進学先が決まっている想定で授業料を直接入れる。支給限度額との小さい方が支援金になる
      annualHighSchoolTuition: 520000,
      universityType: 'privateHumanities',
      cramSchoolPeriods: [
        { fromGrade: 4, toGrade: 6, monthlyFee: 55000 },
        { fromGrade: 11, toGrade: 12, monthlyFee: 48000 },
      ],
    },
    {
      id: 'child-2',
      birthYear: 2021,
      birthMonth: 9,
      elementarySchoolType: 'public',
      // 公立中コース。高校受験と大学受験の前だけ塾に通う
      juniorHighType: 'public',
      highSchoolType: 'public',
      // null なら就学支援金のマスタデータにある標準的な授業料を使う
      annualHighSchoolTuition: null,
      universityType: 'nationalPublic',
      cramSchoolPeriods: [
        { fromGrade: 8, toGrade: 9, monthlyFee: 32000 },
        { fromGrade: 11, toGrade: 12, monthlyFee: 42000 },
      ],
    },
  ],

  incomes: [
    {
      kind: 'employment',
      personId: 'adult-1',
      annualGross: 4800000,
      annualBonus: 900000,
      baseRaiseRate: 0.015,
      bonusPaymentCount: 2,
    },
    {
      kind: 'business',
      personId: 'adult-2',
      startYear: 2025,
      startMonth: 4,
      annualRevenue: 1440000,
      annualExpenses: 240000,
      revenueGrowthRate: 0.1,
      revenueCeiling: 2880000,
      filingType: 'blue65',
    },
    {
      kind: 'realEstate',
      personId: 'adult-1',
      propertyId: 'prop-1',
      monthlyRent: 76000,
      occupancyRate: 0.9,
      ownershipShare: 0.5,
    },
    {
      kind: 'sideBusiness',
      personId: 'adult-1',
      annualRevenue: 0,
      annualExpenses: 0,
      taxCategory: 'miscellaneous',
      filingType: 'white',
    },
  ],

  promotionScenario: {
    id: 'promoted-twice',
    tracks: [
      {
        personId: 'adult-1',
        steps: [
          { year: 2028, annualGross: 6600000, annualBonus: 1300000 },
          { year: 2034, annualGross: 8400000, annualBonus: 1700000 },
        ],
      },
    ],
  },

  // 通常の順方向シミュレーションでは null。ゴールシークが解いた結果を差し込む口
  sideBusinessSchedule: null,

  residence: [
    // 起点の時点で住んでいる賃貸。入居済みなので入居時費用は 0
    { fromYear: 2025, municipality: DUMMY_CITY_FROM, monthlyRent: 128000, moveInCost: 0 },
    // 住宅購入と同じ年に転居する。持ち家なので家賃は発生しない
    { fromYear: 2030, municipality: DUMMY_CITY_TO, monthlyRent: null, moveInCost: 0 },
  ],

  investmentProperties: [
    {
      id: 'prop-1',
      currentValue: 9600000,
      remainingLoan: 0,
      annualPropertyTax: 77000,
      annualManagementCost: 31000,
      annualRepairCost: 53000,
      disposition: { kind: 'hold' },
    },
  ],

  education: {
    universityLiving: 'fromHome',
    // null なら学習費のマスタデータにある平均値を使う
    annualLessonCost: null,
    annualAllowanceAwayFromHome: 1200000,
  },

  retirement: {
    // 大人ごとに退職金の有無と受給開始年齢をずらしてある。
    // 世帯合計で持っていたら表せない形をサンプルに含めておく
    byPerson: [
      {
        personId: 'adult-1',
        severancePay: 12000000,
        severanceYear: null,
        pensionStartAge: 65,
        annualPension: 1720000,
      },
      {
        personId: 'adult-2',
        severancePay: 0,
        severanceYear: null,
        // 繰下げ受給を選んだ想定
        pensionStartAge: 70,
        annualPension: 800000,
      },
    ],
  },

  // 扶養に入る大人はいない（給与の無い大人は国保と国民年金）。国保の世帯主は先頭の大人（給与のある大人 = 擬制世帯主）
  insurance: defaultInsurance,

  assumptions: {
    // 年金は名目固定（旧来の扱い）。期待値を手計算で追えるようにするため
    pensionIndexationRate: 0,
  },
}

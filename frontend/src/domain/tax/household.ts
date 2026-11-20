/**
 * 世帯の 1 年ぶんの税・社会保険。全員を `personTaxYear` に通す。新しい計算は段ごとに `previous: null` で呼ぶ（SPEC §3.6）。
 * 前の版の年ループ（`simulate`。T13 で消した）は毎年 1 回呼んで、前年の持ち回りを渡していた。
 *
 * `person.ts` は 1 人ぶんの計算で、世帯のこと（誰が国保の加入者か、誰が配偶者控除を受けるか、前年の所得をどう持ち回るか）を
 * 知らない。ここがそれを世帯の設定（`HouseholdTaxInput`）から組み立てる。順は SPEC §2.4 のとおり：
 *
 * ```
 * 前年の持ち回り → 当年の国保料と納める住民税 → 全員の personTaxYear → 当年の持ち回り
 * ```
 *
 * **世帯の組み立ての決め事（2026-09-18。利用者の確認前の仮置きを含む。SPEC §2.4「接続」）：**
 *
 * - 健康保険と年金の入り方は年ごとに判定する。その年に給与がある大人は会社の保険。それ以外の大人は、
 *   `insurance.dependentAdultIds` にいて他に会社員の大人がいれば扶養、そうでなければ国保（表の年齢未満）と国民年金（20〜59 歳）
 * - 子は、会社員の大人がいる年はその扶養、いない年は国保の加入者。学校を出た年からは世帯の計算から外す（独立したとみなす）
 * - 国保料を納めて社会保険料控除を受けるのは、世帯主が加入者なら世帯主、違えば前年の所得が最も高い大人の加入者。
 *   国民年金は本人が納める
 * - 配偶者（特別）控除と子の扶養控除は、その年の合計所得金額が多い方の大人だけが受ける（同額なら先に並んでいる人）。
 *   大人がちょうど 2 人のときだけ互いを配偶者とみなす
 * - 起点年は「前年も同じ所得だった」とみなす（国保は当年の所得から、住民税は当年の所得が生む額をそのまま納める）
 * - 国保の料率が表に無い自治体は、表の `appDefault.fallbackMunicipalityCode` の料率で概算し、概算したことを結果に返す
 *   （`evaluate` が知らせにする）。代わりの自治体が null なら例外のまま（D23）
 * - 社会保険・国保・国民年金の表が始まる年より前の年は、表の最初の年度として計算する（年齢は実際の年で数える）。
 *   将来年に最新の表を延ばすのと対称の扱いで、起点年が表より前の入力（テストのサンプル）を落とさないため
 *
 * **入っていないもの：** 公的年金と退職金への課税（収入側で税を引かずに足している。`income/retirement.ts`）／個人事業税／
 * 後期高齢者医療の保険料（表の年齢以上の人は医療保険料 0 になる）／会社員の家族の扶養に入れるかの収入基準の判定。
 * 年金は「給与所得者等」の判定にだけ使う。
 */

import { stageInYear } from '../expense/education'
import type { HouseholdIncome, PersonIncomeInYear } from '../income/household'
import type { EmploymentPay } from '../income/promotion'
import { pensionInYear } from '../income/retirement'
import { resolveMunicipality } from '../residence'
import { steadyStateEmploymentNetPay } from './employment'
import { requiredEmploymentGross } from './requiredGross'
import { assertNonNegativeYen } from './schedule'
import type {
  Child,
  DependentRelative,
  InsurancePlan,
  MasterTables,
  MunicipalityCode,
  Person,
  PersonId,
  PersonalDeductionContext,
  Rate,
  ResidenceHistory,
  RetirementPlan,
  TaxBase,
  Year,
  Yen,
} from '../types'
import {
  hasNationalHealthInsuranceRates,
  isNationalPensionInsuredAge,
  nationalHealthInsurance,
  nationalPensionPremium,
  type NationalHealthInsuranceHouseholder,
  type NationalHealthInsuranceMember,
  type NationalHealthInsuranceResult,
} from './nationalInsurance'
import {
  householdTaxBase,
  personNetIncome,
  personTaxYear,
  personTotalIncome,
  type PersonTaxYear,
} from './person'

/** 世帯の税・社会保険に使う表 */
export type HouseholdTaxTables = Pick<
  MasterTables,
  'incomeTax' | 'socialInsurance' | 'residentTax' | 'nationalInsurance'
>

/**
 * 世帯の税・社会保険が読む世帯の設定。ここで実際に読む項目だけ。
 *
 * 新しい計算（`domain/plan/` の税への橋渡し）は、`LifePlan` からこの形を作って渡す（SPEC §3.6）。
 * T1 では前の版の入力の型（`SimulationInput`）の `Pick` だったが、T13 で前の版の型を消したときに、同じ項目・同じ型のまま書き下した
 */
export type HouseholdTaxInput = {
  /** 計算の起点となる年 */
  baseYear: Year
  /** 大人の世帯員 */
  adults: readonly Person[]
  children: readonly Child[]
  residence: ResidenceHistory
  /** 健康保険と年金の入り方のうち、収入からは決まらないもの（扶養に入る大人・国保の世帯主） */
  insurance: InsurancePlan
  retirement: RetirementPlan
  /** 年金の改定率だけを読む（「給与所得者等」の判定で、その年の年金額を出すため） */
  assumptions: { pensionIndexationRate: Rate }
}

/** 世帯の税・社会保険が読むその年の収入。`HouseholdIncome` のうち年と人ごとの内訳だけ */
export type HouseholdTaxIncome = Pick<HouseholdIncome, 'year' | 'byPerson'>

/**
 * その年の健康保険と年金の入り方。
 *
 * - `employee` 会社の健康保険と厚生年金
 * - `dependent` 会社員の家族の扶養（保険料なし）
 * - `national` 国民健康保険（と、20〜59 歳なら国民年金）
 * - `lateStageElderly` 後期高齢者医療（保険料は未実装で 0）
 * - `none` 寿命想定の年を過ぎていて、計算の対象でない
 */
export type InsuranceStatus = 'employee' | 'dependent' | 'national' | 'lateStageElderly' | 'none'

/** 年をまたいで持ち回るもの。前年の所得で決まる国保料と住民税の材料 */
export type HouseholdTaxCarry = {
  taxBase: TaxBase
  /** その年に国保の軽減判定の「給与所得者等」に当たった人 */
  salaryEarnerIds: ReadonlySet<PersonId>
}

/** ある年の大人 1 人ぶんの結果 */
export type HouseholdMemberTaxYear = {
  personId: PersonId
  insurance: InsuranceStatus
  taxYear: PersonTaxYear
  /**
   * この人の税に実際に効いた人的控除の家族（配偶者・扶養親族）。控除を受けない人は空。
   *
   * 世帯の規則（所得の多い方だけが受ける）を通した後の値を返すのは、**同じ条件で 1 人ぶんの税を
   * 解き直す呼び出し側のため**（`tax/requiredGross.ts` で「本業をいくらにすれば手取りが増えるか」を
   * 出すとき、世帯と違う控除で解くと答えがずれる）。
   */
  personal: PersonalDeductionContext
  /** その年に納める住民税（前年の所得ぶん） */
  residentTaxPaid: Yen
  /** 手取り（年金・退職金・給付は含まない） */
  netIncome: Yen
}

/** ある年の世帯の国保 */
export type HouseholdNationalHealthInsurance = {
  result: NationalHealthInsuranceResult
  /** 保険料を納めて社会保険料控除を受ける人 */
  payerId: PersonId
  /** 料率を引いた自治体 */
  ratesMunicipality: MunicipalityCode
  /** 住んでいる自治体の料率が表に無く、別の自治体の料率で概算したか */
  approximated: boolean
}

/** ある年の世帯の税・社会保険 */
export type HouseholdTaxYear = {
  year: Year
  /** その年の居住自治体 */
  municipality: MunicipalityCode
  /** 大人全員ぶん（`adults` の順） */
  members: readonly HouseholdMemberTaxYear[]
  /** 国保の加入者がいない年は null */
  nationalHealthInsurance: HouseholdNationalHealthInsurance | null
  /** 所得税と、その年に納める住民税の世帯合計 */
  taxes: Yen
  /** 社会保険料の世帯合計（会社の社会保険・国保・国民年金） */
  socialInsurance: Yen
  /** 手取りの世帯合計（年金・退職金・給付は含まない） */
  netIncome: Yen
  /** 翌年へ渡す持ち回り */
  carry: HouseholdTaxCarry
}

/**
 * ある年の世帯の税・社会保険を求める。
 *
 * @param income その年の世帯収入（`householdIncome` の結果）
 * @param previous 前年の持ち回り。起点年は null（前年も同じ所得だったとみなす）
 * @throws {RangeError} 世帯主や扶養の指定が世帯にいない人を指すとき、持ち回りの年が前年でないとき、
 *   国保の料率が表に無く代わりの自治体も無いとき、各計算の入力が不正なとき
 */
export function householdTaxYear(
  input: HouseholdTaxInput,
  income: HouseholdTaxIncome,
  previous: HouseholdTaxCarry | null,
  tables: HouseholdTaxTables,
): HouseholdTaxYear {
  const { year } = income
  assertInsurancePlan(input)
  if (previous !== null && previous.taxBase.year !== year - 1) {
    throw new RangeError(`持ち回りの年が前年ではありません: ${previous.taxBase.year} / ${year}`)
  }

  const municipality = resolveMunicipality(input.residence, year)
  const nhiRates = resolveNationalHealthInsuranceRates(municipality, tables)
  const tableYear = Math.max(year, firstTableYear(tables, nhiRates.code))

  const adults = input.adults.map((person, index) => {
    const personIncome = income.byPerson[index]
    if (personIncome === undefined || personIncome.personId !== person.id) {
      throw new RangeError(`世帯収入の内訳が大人の並びと合っていません: personId=${person.id}`)
    }
    return { person, income: personIncome, alive: isAlive(person, year) }
  })

  // --- 全員の合計所得金額（配偶者控除と、起点年の「前年も同じ所得」に使う） ---
  const totalIncomeById = new Map<PersonId, Yen>(
    adults.map(({ person, income: personIncome }) => [
      person.id,
      personTotalIncome({ year, ...personIncome }, tables).totalIncome,
    ]),
  )
  const salaryEarnerIds = new Set<PersonId>(
    adults
      .filter(({ person, income: personIncome }) =>
        isSalaryEarner(input, person, personIncome, year, tables),
      )
      .map(({ person }) => person.id),
  )
  const previousIncomeOf = (personId: PersonId): Yen =>
    (previous === null ? totalIncomeById : previous.taxBase.totalIncomeByPerson).get(personId) ?? 0
  const wasSalaryEarner = (personId: PersonId): boolean =>
    (previous === null ? salaryEarnerIds : previous.salaryEarnerIds).has(personId)

  // --- 健康保険と年金の入り方 ---
  const hasEmployee = adults.some(
    ({ alive, income: personIncome }) => alive && personIncome.employment !== null,
  )
  const statusById = new Map<PersonId, InsuranceStatus>(
    adults.map(({ person, income: personIncome, alive }) => [
      person.id,
      insuranceStatus(input, person, personIncome, alive, hasEmployee, year, tables),
    ]),
  )

  // --- 国保（世帯単位・前年の所得） ---
  const dependentChildren = input.children.filter((child) => isDependentChild(child, year))
  const nhi = householdNationalHealthInsurance({
    input,
    year,
    tableYear,
    nhiRates,
    nationalAdults: adults
      .filter(({ person }) => statusById.get(person.id) === 'national')
      .map(({ person }) => person),
    // 会社員の大人がいる年は、子はその扶養に入る
    childMembers: hasEmployee ? [] : dependentChildren,
    previousIncomeOf,
    wasSalaryEarner,
    tables,
  })

  // --- 人的控除：所得が多い方の大人だけが受ける ---
  const claimantId = deductionClaimantId(adults, totalIncomeById)

  const members: HouseholdMemberTaxYear[] = adults.map(
    ({ person, income: personIncome, alive }) => {
      const status = statusById.get(person.id) ?? 'none'
      const age = year - person.birthYear
      const pension =
        status === 'national' && isNationalPensionInsuredAge(age, tables.nationalInsurance)
          ? nationalPensionPremium(tableYear, 1, tables.nationalInsurance)
          : 0
      // 人的控除は所得の多い方の大人だけが受ける（世帯の規則）。結果にも返し、呼び出し側が同じ条件で解き直せるようにする
      const personal: PersonalDeductionContext =
        alive && person.id === claimantId
          ? deductionContext(adults, person.id, dependentChildren, totalIncomeById, year)
          : { spouse: null, dependents: [] }
      const taxYear = personTaxYear(
        {
          // 所得税と住民税は年分ごとの表があるので実際の年で引く。表の最初の年度に寄せるのは社会保険だけ
          year,
          socialInsuranceTableYear: tableYear,
          age,
          municipalityCode: municipality,
          personal,
          ...personIncome,
          nationalInsurancePaid: {
            healthInsurance: nhi !== null && nhi.payerId === person.id ? nhi.result.total : 0,
            pension,
          },
        },
        tables,
      )
      // 起点年は前年も同じ所得だったとみなし、当年の所得が生む住民税をそのまま納める
      const residentTaxPaid =
        previous === null
          ? taxYear.residentTaxNextFiscalYear.total
          : (previous.taxBase.residentTaxNextFiscalYearByPerson.get(person.id) ?? 0)
      return {
        personId: person.id,
        insurance: status,
        taxYear,
        personal,
        residentTaxPaid,
        netIncome: personNetIncome(taxYear, residentTaxPaid),
      }
    },
  )

  const sum = (pick: (member: HouseholdMemberTaxYear) => Yen): Yen =>
    members.reduce((total, member) => total + pick(member), 0)

  return {
    year,
    municipality,
    members,
    nationalHealthInsurance: nhi,
    taxes: sum((member) => member.taxYear.incomeTax.tax + member.residentTaxPaid),
    socialInsurance: sum((member) => member.taxYear.socialInsurance.total),
    netIncome: sum((member) => member.netIncome),
    carry: {
      taxBase: householdTaxBase(
        year,
        members.map(({ personId, taxYear }) => ({ personId, taxYear })),
      ),
      salaryEarnerIds,
    },
  }
}

/** その年にその人が計算の対象か（寿命想定の年まで。年金の受給と同じ境界） */
function isAlive(person: Person, year: Year): boolean {
  return year <= person.birthYear + person.lifeExpectancy
}

/**
 * その年に子が親の扶養にいるか。学校（大学に進むなら大学）を出た年からは独立したとみなす。
 * 卒業は 3 月で、その年の 4 月から働く前提。生まれる前の年は対象にしない。
 */
function isDependentChild(child: Child, year: Year): boolean {
  return year >= child.birthYear && stageInYear(child, year) !== 'graduated'
}

/** その年の健康保険と年金の入り方を決める */
function insuranceStatus(
  input: HouseholdTaxInput,
  person: Person,
  income: PersonIncomeInYear,
  alive: boolean,
  hasEmployee: boolean,
  year: Year,
  tables: HouseholdTaxTables,
): InsuranceStatus {
  if (!alive) {
    return 'none'
  }
  if (income.employment !== null) {
    return 'employee'
  }
  if (
    year - person.birthYear >=
    tables.nationalInsurance.nationalHealthInsurance.insuredAge.under
  ) {
    return 'lateStageElderly'
  }
  if (hasEmployee && input.insurance.dependentAdultIds.includes(person.id)) {
    return 'dependent'
  }
  return 'national'
}

/**
 * 国保の軽減判定の「給与所得者等」に当たるか。一定額を超える給与収入か公的年金収入がある人。
 * 年金の基準は年齢で違う。
 */
function isSalaryEarner(
  input: HouseholdTaxInput,
  person: Person,
  income: PersonIncomeInYear,
  year: Year,
  tables: HouseholdTaxTables,
): boolean {
  const thresholds =
    tables.nationalInsurance.nationalHealthInsurance.reduction.salaryEarnerThresholds
  const pay =
    income.employment === null
      ? 0
      : income.employment.pay.annualGross + income.employment.pay.annualBonus
  if (pay > thresholds.employmentRevenueOver) {
    return true
  }
  const retirement = input.retirement.byPerson.find((entry) => entry.personId === person.id)
  if (retirement === undefined) {
    return false
  }
  const pension = pensionInYear(person, retirement, year, {
    rate: input.assumptions.pensionIndexationRate,
    baseYear: input.baseYear,
  })
  const pensionThreshold =
    year - person.birthYear >= thresholds.pensionAgeBoundary
      ? thresholds.pensionRevenueOverAge65Plus
      : thresholds.pensionRevenueOverUnder65
  return pension > pensionThreshold
}

/** 国保の料率を引く自治体。住んでいる自治体が表に無ければ、表が指す代わりの自治体 */
function resolveNationalHealthInsuranceRates(
  municipality: MunicipalityCode,
  tables: HouseholdTaxTables,
): { code: MunicipalityCode; approximated: boolean } {
  if (hasNationalHealthInsuranceRates(municipality, tables.nationalInsurance)) {
    return { code: municipality, approximated: false }
  }
  const fallback =
    tables.nationalInsurance.nationalHealthInsurance.appDefault.fallbackMunicipalityCode
  // 代わりが無ければ、住んでいる自治体のまま渡して国保の計算に例外を投げさせる（黙って別の料率を当てない。D23）
  return fallback === null
    ? { code: municipality, approximated: false }
    : { code: fallback, approximated: true }
}

/** 社会保険・国保・国民年金の表がそろって使える最初の年 */
function firstTableYear(tables: HouseholdTaxTables, nhiMunicipality: MunicipalityCode): Year {
  const { nationalHealthInsurance: nhi, nationalPension } = tables.nationalInsurance
  const years = [tables.socialInsurance.healthInsurance.fiscalYear]
  if (nationalPension.schedule.length > 0) {
    years.push(Math.min(...nationalPension.schedule.map((entry) => entry.fiscalYear)))
  }
  const rates = nhi.byMunicipality[nhiMunicipality]
  if (rates !== undefined) {
    years.push(rates.fiscalYear)
  }
  return Math.max(...years)
}

/** 世帯の国保料を求める。加入者がいなければ null */
function householdNationalHealthInsurance(args: {
  input: HouseholdTaxInput
  year: Year
  tableYear: Year
  nhiRates: { code: MunicipalityCode; approximated: boolean }
  nationalAdults: readonly Person[]
  childMembers: readonly Child[]
  previousIncomeOf: (personId: PersonId) => Yen
  wasSalaryEarner: (personId: PersonId) => boolean
  tables: HouseholdTaxTables
}): HouseholdNationalHealthInsurance | null {
  const { input, year, tableYear, nhiRates, nationalAdults, childMembers, tables } = args
  if (nationalAdults.length === 0 && childMembers.length === 0) {
    return null
  }
  // 表の年で計算するときも年齢は実際の年で数えるよう、生年を同じだけずらす
  const shift = tableYear - year
  const members: NationalHealthInsuranceMember[] = [
    ...nationalAdults.map((person) => ({
      personId: person.id,
      birthYear: person.birthYear + shift,
      birthMonth: null,
      previousYearTotalIncome: args.previousIncomeOf(person.id),
      isSalaryEarner: args.wasSalaryEarner(person.id),
    })),
    ...childMembers.map((child) => ({
      personId: child.id,
      birthYear: child.birthYear + shift,
      birthMonth: child.birthMonth,
      previousYearTotalIncome: 0,
      isSalaryEarner: false,
    })),
  ]

  const householderId = householderIdOf(input)
  const householderIsMember = nationalAdults.some((person) => person.id === householderId)
  const householder: NationalHealthInsuranceHouseholder = householderIsMember
    ? { kind: 'member', personId: householderId }
    : {
        kind: 'nonMember',
        previousYearTotalIncome: args.previousIncomeOf(householderId),
        isSalaryEarner: args.wasSalaryEarner(householderId),
      }

  const result = nationalHealthInsurance(
    { fiscalYear: tableYear, municipalityCode: nhiRates.code, members, householder },
    tables.nationalInsurance,
  )

  // 納める人：世帯主が加入者なら世帯主。違えば前年の所得が最も高い大人の加入者。大人の加入者がいなければ世帯主
  const highestIncomeAdult = nationalAdults.reduce<Person | null>(
    (best, person) =>
      best === null || args.previousIncomeOf(person.id) > args.previousIncomeOf(best.id)
        ? person
        : best,
    null,
  )
  const payerId = householderIsMember ? householderId : (highestIncomeAdult?.id ?? householderId)

  return { result, payerId, ratesMunicipality: nhiRates.code, approximated: nhiRates.approximated }
}

/** 国保の世帯主。指定が無ければ先頭の大人 */
function householderIdOf(input: HouseholdTaxInput): PersonId {
  const specified = input.insurance.nationalHealthInsuranceHouseholderId
  if (specified !== null) {
    return specified
  }
  const first = input.adults[0]
  if (first === undefined) {
    throw new RangeError('大人の世帯員が1人もいません')
  }
  return first.id
}

/** 人的控除を受ける人。その年に計算の対象である大人のうち、合計所得金額が最も多い人（同額なら先に並んでいる人） */
function deductionClaimantId(
  adults: readonly { person: Person; alive: boolean }[],
  totalIncomeById: ReadonlyMap<PersonId, Yen>,
): PersonId | null {
  let best: Person | null = null
  for (const { person, alive } of adults) {
    if (!alive) {
      continue
    }
    if (
      best === null ||
      (totalIncomeById.get(person.id) ?? 0) > (totalIncomeById.get(best.id) ?? 0)
    ) {
      best = person
    }
  }
  return best?.id ?? null
}

/** 人的控除を受ける人から見た家族。配偶者は、大人がちょうど 2 人のときのもう 1 人（その年に計算の対象であること） */
function deductionContext(
  adults: readonly { person: Person; alive: boolean }[],
  claimantId: PersonId,
  dependentChildren: readonly Child[],
  totalIncomeById: ReadonlyMap<PersonId, Yen>,
  year: Year,
): PersonalDeductionContext {
  const others = adults.filter(({ person }) => person.id !== claimantId)
  const other = adults.length === 2 ? others[0] : undefined
  const spouse =
    other !== undefined && other.alive
      ? {
          totalIncome: totalIncomeById.get(other.person.id) ?? 0,
          age: year - other.person.birthYear,
        }
      : null
  const dependents: DependentRelative[] = dependentChildren.map((child) => ({
    age: year - child.birthYear,
    totalIncome: 0,
  }))
  return { spouse, dependents }
}

/**
 * 保険の入り方の指定が世帯の大人を指しているかを確かめる。
 *
 * @throws {RangeError} 扶養に入る人・世帯主が `adults` にいないとき
 */
function assertInsurancePlan(input: HouseholdTaxInput): void {
  const adultIds = new Set(input.adults.map((person) => person.id))
  for (const personId of input.insurance.dependentAdultIds) {
    if (!adultIds.has(personId)) {
      throw new RangeError(`扶養に入る大人が世帯にいません: personId=${personId}`)
    }
  }
  const householderId = input.insurance.nationalHealthInsuranceHouseholderId
  if (householderId !== null && !adultIds.has(householderId)) {
    throw new RangeError(`国保の世帯主が世帯にいません: personId=${householderId}`)
  }
}

/** 本業の給与を上げて手取りを増やすときの、額面の今と必要額 */
export type EmploymentRaise = {
  personId: PersonId
  /** 今の額面（月給ぶん + 賞与） */
  currentGross: Yen
  /** 必要な額面 */
  requiredGross: Yen
  /** 差 */
  increase: Yen
}

/**
 * ある年に、世帯の手取りを `targetNetIncrease` 円だけ増やすには本業の給与をいくらにするか（D31 の「本業を上げるなら」）。
 *
 * **給与がいちばん多い大人 1 人を上げる前提**で、`requiredEmploymentGross` を 1 回呼ぶ。
 * 同じ給与が毎年続く前提の換算（`steadyStateEmploymentNetPay`）で、昇給が一度上げたら続くものであることに合わせている。
 * 住民税と国保の 1 年ずれが落ち着いた後の関係になるので、上げた翌年だけは実際よりわずかに手取りが多い。
 *
 * 人的控除は**世帯の規則を通した後のもの**（`HouseholdMemberTaxYear.personal`）を使う。世帯では所得の多い方だけが
 * 配偶者控除・扶養控除を受けるので、1 人ぶんの関数に違う控除を渡すと答えがずれる。
 *
 * 給与のある大人がいない・額面が 0・上限まで上げても届かないときは null を返す（利用者に見せる結果であって異常ではない）。
 *
 * @throws {RangeError} 世帯収入の内訳が入力と合っていないとき（呼び出し側の組み立てミス）
 */
export function householdEmploymentRaise(
  input: HouseholdTaxInput,
  income: HouseholdTaxIncome,
  targetNetIncrease: Yen,
  tables: HouseholdTaxTables,
): EmploymentRaise | null {
  const { year } = income
  assertNonNegativeYen(targetNetIncrease, '増やしたい手取り')
  if (targetNetIncrease === 0) return null

  // 給与のある大人のうち、額面がいちばん大きい人を上げる前提にする
  let top: { personId: PersonId; pay: EmploymentPay; bonusPaymentCount: number } | null = null
  for (const candidate of income.byPerson) {
    if (candidate.employment === null) continue
    const { pay, bonusPaymentCount } = candidate.employment
    if (
      top !== null &&
      top.pay.annualGross + top.pay.annualBonus >= pay.annualGross + pay.annualBonus
    ) {
      continue
    }
    top = { personId: candidate.personId, pay, bonusPaymentCount }
  }
  if (top === null) return null

  const currentGross = top.pay.annualGross + top.pay.annualBonus
  if (currentGross <= 0) return null

  const person = input.adults.find((adult) => adult.id === top.personId)
  if (person === undefined) {
    throw new RangeError(`給与のある大人が世帯にいません: ${top.personId}`)
  }
  // 前年の持ち回りに null を渡してよいのは、使うのが personal だけで、人的控除がその年の所得だけで決まるため
  const member = householdTaxYear(input, income, null, tables).members.find(
    (entry) => entry.personId === top.personId,
  )
  if (member === undefined) {
    throw new RangeError(`世帯の税の結果に大人がいません: ${top.personId}`)
  }

  const base = {
    year,
    age: year - person.birthYear,
    bonusPaymentCount: top.bonusPaymentCount,
    municipalityCode: resolveMunicipality(input.residence, year),
    personal: member.personal,
    bonusShare: top.pay.annualBonus / currentGross,
  }
  const currentNet = steadyStateEmploymentNetPay({ ...base, pay: top.pay }, tables)
  const outcome = requiredEmploymentGross(
    { ...base, targetNetPay: currentNet + targetNetIncrease },
    tables,
  )
  if (outcome.status !== 'solved') return null

  return {
    personId: top.personId,
    currentGross,
    requiredGross: outcome.totalGross,
    increase: outcome.totalGross - currentGross,
  }
}

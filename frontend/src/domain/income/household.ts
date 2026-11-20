/**
 * 世帯の収入を年次で集計する。
 *
 * 種類ごとの内訳と、世帯員ごとの内訳の両方を返す。
 * 後者は税・社会保険の計算（`tax/household.ts`）の材料になる（SPEC §2.4）。
 * ここは**税を引く前**の額だけを扱う。手取りは `tax/household.ts` が求める。
 */

import { sumYen } from '../money'
import type {
  FilingType,
  IncomeSource,
  InvestmentProperty,
  Person,
  PersonId,
  PersonPrimaryIncome,
  PromotionScenario,
  SideBusinessSchedule,
  Year,
  Yen,
} from '../types'
import {
  businessProfitInYear,
  isWorking,
  realEstateProfitInYear,
  scheduledSideBusinessProfitInYear,
  sideBusinessProfitInYear,
} from './gross'
import { employmentPayInYear, type EmploymentPay } from './promotion'

/**
 * ある年の 1 人ぶんの収入を、税の掛かり方で分けたもの。`tax/person.ts` の入力にそのまま写せる形。
 *
 * 副業は申告の区分で行き先が変わる：事業として申告するなら `businessProfit` に、雑所得なら `miscellaneousProfit` に入る。
 */
export type PersonIncomeInYear = {
  personId: PersonId
  /** その年の給与。給与の収入源が無い、または退職後で額面が 0 の年は null（会社の社会保険に入っていない） */
  employment: { pay: EmploymentPay; bonusPaymentCount: number } | null
  /** 事業所得（本業の事業 + 事業として申告する副業。青色申告特別控除前。赤字は負） */
  businessProfit: Yen
  /** 事業の申告方式。事業の収入源（本業・事業として申告する副業）が無ければ null */
  filingType: FilingType | null
  /** 不動産所得（運営経費を引いたあと。赤字は負） */
  realEstateProfit: Yen
  /** 雑所得として申告する副業 */
  miscellaneousProfit: Yen
}

/**
 * ある年の世帯収入。
 *
 * 給与だけ「額面」、それ以外は「所得（収入 − 必要経費）」であることに注意。
 * 給与所得控除は税の計算（`tax/`）の側で引く。
 */
export type HouseholdIncome = {
  year: Year
  /** 給与の額面（賞与を除く）の世帯合計 */
  employmentGross: Yen
  /** 賞与の額面の世帯合計 */
  employmentBonus: Yen
  /** 事業所得の世帯合計（副業は含まない。事業として申告する副業も `sideBusinessProfit` の側） */
  businessProfit: Yen
  /** 不動産所得の世帯合計（物件の運営経費を引いたあと） */
  realEstateProfit: Yen
  /** 副業所得の世帯合計 */
  sideBusinessProfit: Yen
  /**
   * 世帯員ごとの収入の合計（給与は額面のまま）。**税法上の「総所得金額等」ではない。**
   * 税・国保・保育料の材料には `byPerson` を `tax/` に通した結果を使う。
   */
  grossByPerson: ReadonlyMap<PersonId, Yen>
  /**
   * 世帯員ごとの本業（副業を除く）を種類ごとに分けたもの：給与の額面 + 賞与／事業所得／不動産所得。
   *
   * 結果画面が「本業の見込みのうち誰の・どの収入がいくらか」を出すための内訳。
   * `grossByPerson` から副業を除いて種類で分けただけで、`amount` の合計は種類ごとの内訳の和と一致する。
   */
  primaryByPerson: ReadonlyMap<PersonId, PersonPrimaryIncome>
  /** 世帯員ごとの収入を税の掛かり方で分けたもの。**大人全員ぶんを `adults` の順で返す**（収入の無い人は全部 0） */
  byPerson: readonly PersonIncomeInYear[]
}

/**
 * 世帯収入の集計が読む世帯の設定。ここで実際に読む項目だけ。
 *
 * 前の版の入力の型（`SimulationInput`）を T13 で消したときに、読んでいた項目を同じ型のまま書き下した。
 * 新しい計算（`domain/plan/taxBridge.ts`）はこの関数を通さず人ごとの収入を直接作るので、今の呼び出し元は税のテストだけ
 */
export type HouseholdIncomeInput = {
  /** 計算の起点となる年 */
  baseYear: Year
  /** 大人の世帯員 */
  adults: readonly Person[]
  incomes: readonly IncomeSource[]
  /** 適用する昇進シナリオ。1回の計算につき1つ（世帯員ごとの道筋はその中に持つ） */
  promotionScenario: PromotionScenario | null
  /** 副業所得の年次スケジュール。指定すると `incomes` の `sideBusiness` の所得がこの額に置き換わる。通常は null */
  sideBusinessSchedule: SideBusinessSchedule | null
  investmentProperties: readonly InvestmentProperty[]
}

/** 本業の種類。`PersonPrimaryIncome` のどの欄に足すか */
type PrimaryKind = 'employment' | 'business' | 'realEstate'

/** 集計中の 1 人ぶん。給与は複数の収入源を足し込めるように分けて持つ */
type PersonAccumulator = {
  annualGross: Yen
  annualBonus: Yen
  /** 最初に出てきた給与の収入源の支給回数（同じ人に給与が 2 本あることは想定が薄いので、1 本目に合わせる） */
  bonusPaymentCount: number | null
  businessProfit: Yen
  realEstateProfit: Yen
  miscellaneousProfit: Yen
}

/**
 * ある年の世帯収入を求める。
 *
 * **`input.sideBusinessSchedule` があれば、`incomes` の `sideBusiness` は使わずスケジュールの額で置き換える。**
 * ゴールシークが「副業でいくら要るか」を探るための口で、上乗せではなく置き換えにしてある
 * （入力の見込み額を足すと、逆算の答えが入力に埋まってしまう）。
 * スケジュールの副業の申告の区分は、その人の `sideBusiness` の収入源に合わせる（無ければ雑所得）。
 *
 * @throws {RangeError} 収入やスケジュールが存在しない世帯員や物件を指しているとき（入力の組み立てミス）
 */
export function householdIncome(input: HouseholdIncomeInput, year: Year): HouseholdIncome {
  const personById = new Map<PersonId, Person>(input.adults.map((person) => [person.id, person]))
  const schedule = input.sideBusinessSchedule

  const employmentGross: Yen[] = []
  const employmentBonus: Yen[] = []
  const businessProfit: Yen[] = []
  const realEstateProfit: Yen[] = []
  const sideBusinessProfit: Yen[] = []
  const byPerson = new Map<PersonId, Yen>()
  const primaryByPerson = new Map<PersonId, PersonPrimaryIncome>()
  const accumulators = new Map<PersonId, PersonAccumulator>(
    input.adults.map((person) => [
      person.id,
      {
        annualGross: 0,
        annualBonus: 0,
        bonusPaymentCount: null,
        businessProfit: 0,
        realEstateProfit: 0,
        miscellaneousProfit: 0,
      },
    ]),
  )

  /** 集計中の 1 人ぶんを取る。`personById` で確かめた後にだけ呼ぶ */
  const accumulatorOf = (personId: PersonId): PersonAccumulator => {
    const accumulator = accumulators.get(personId)
    if (accumulator === undefined) {
      throw new RangeError(`収入が未登録の世帯員を指しています: personId=${personId}`)
    }
    return accumulator
  }

  /** 世帯員ごとの合計に足し込む。本業（副業以外）は種類を指定して `primaryByPerson` にも積む */
  const addToPerson = (personId: PersonId, amount: Yen, kind: PrimaryKind | null): void => {
    byPerson.set(personId, (byPerson.get(personId) ?? 0) + amount)
    if (kind !== null) {
      const current = primaryByPerson.get(personId) ?? {
        personId,
        employment: 0,
        business: 0,
        realEstate: 0,
        amount: 0,
      }
      primaryByPerson.set(personId, {
        ...current,
        [kind]: current[kind] + amount,
        amount: current.amount + amount,
      })
    }
  }

  /** 副業を申告の区分に応じて事業所得か雑所得に積む */
  const addSideBusiness = (
    personId: PersonId,
    profit: Yen,
    taxCategory: 'business' | 'miscellaneous',
  ): void => {
    sideBusinessProfit.push(profit)
    addToPerson(personId, profit, null)
    const accumulator = accumulatorOf(personId)
    if (taxCategory === 'business') {
      accumulator.businessProfit += profit
    } else {
      accumulator.miscellaneousProfit += profit
    }
  }

  for (const income of input.incomes) {
    const person = personById.get(income.personId)
    if (person === undefined) {
      throw new RangeError(`収入が未登録の世帯員を指しています: personId=${income.personId}`)
    }
    const accumulator = accumulatorOf(person.id)

    switch (income.kind) {
      case 'employment': {
        // 退職後は給与が無くなる。昇進シナリオは退職年を越えても展開されるので、ここで止める
        const pay = isWorking(person, year)
          ? employmentPayInYear(income, input.promotionScenario, input.baseYear, year)
          : { annualGross: 0, annualBonus: 0 }

        employmentGross.push(pay.annualGross)
        employmentBonus.push(pay.annualBonus)
        addToPerson(person.id, pay.annualGross + pay.annualBonus, 'employment')
        accumulator.annualGross += pay.annualGross
        accumulator.annualBonus += pay.annualBonus
        accumulator.bonusPaymentCount ??= income.bonusPaymentCount
        break
      }

      case 'business': {
        const profit = businessProfitInYear(income, person, year)
        businessProfit.push(profit)
        addToPerson(person.id, profit, 'business')
        accumulator.businessProfit += profit
        break
      }

      case 'realEstate': {
        const property = input.investmentProperties.find(
          (candidate) => candidate.id === income.propertyId,
        )
        if (property === undefined) {
          throw new RangeError(
            `不動産収入が未登録の物件を指しています: propertyId=${income.propertyId}`,
          )
        }
        const profit = realEstateProfitInYear(income, property, year)
        realEstateProfit.push(profit)
        addToPerson(person.id, profit, 'realEstate')
        accumulator.realEstateProfit += profit
        break
      }

      case 'sideBusiness': {
        // スケジュールがあるときは入力の見込み額を使わない（下でまとめて計上する）
        if (schedule !== null) {
          break
        }
        addSideBusiness(
          person.id,
          sideBusinessProfitInYear(income, person, year),
          income.taxCategory,
        )
        break
      }
    }
  }

  if (schedule !== null) {
    const earner = personById.get(schedule.personId)
    if (earner === undefined) {
      throw new RangeError(
        `副業スケジュールが未登録の世帯員を指しています: personId=${schedule.personId}`,
      )
    }
    addSideBusiness(
      earner.id,
      scheduledSideBusinessProfitInYear(schedule, earner, year),
      sideBusinessTaxCategory(input, earner.id),
    )
  }

  return {
    year,
    employmentGross: sumYen(employmentGross),
    employmentBonus: sumYen(employmentBonus),
    businessProfit: sumYen(businessProfit),
    realEstateProfit: sumYen(realEstateProfit),
    sideBusinessProfit: sumYen(sideBusinessProfit),
    grossByPerson: byPerson,
    primaryByPerson,
    byPerson: input.adults.map((person) => {
      const accumulator = accumulatorOf(person.id)
      const hasPay = accumulator.annualGross + accumulator.annualBonus > 0
      return {
        personId: person.id,
        employment: hasPay
          ? {
              pay: { annualGross: accumulator.annualGross, annualBonus: accumulator.annualBonus },
              // 賞与が 0 のときは使われない。給与があるのに回数が無いことは型の上で起きない
              bonusPaymentCount: accumulator.bonusPaymentCount ?? 1,
            }
          : null,
        businessProfit: accumulator.businessProfit,
        filingType: businessFilingType(input, person.id),
        realEstateProfit: accumulator.realEstateProfit,
        miscellaneousProfit: accumulator.miscellaneousProfit,
      }
    }),
  }
}

/** その人の副業の申告の区分。副業の収入源が無ければ雑所得（スケジュールだけがある人の既定） */
function sideBusinessTaxCategory(
  input: HouseholdIncomeInput,
  personId: PersonId,
): 'business' | 'miscellaneous' {
  for (const income of input.incomes) {
    if (income.kind === 'sideBusiness' && income.personId === personId) {
      return income.taxCategory
    }
  }
  return 'miscellaneous'
}

/**
 * その人の事業の申告方式。本業の事業があればその方式、無ければ事業として申告する副業の方式。
 * どちらも無ければ null（1 人の事業所得に申告方式は 1 つなので、本業を優先する）。
 */
function businessFilingType(input: HouseholdIncomeInput, personId: PersonId): FilingType | null {
  let fromSideBusiness: FilingType | null = null
  for (const income of input.incomes) {
    if (income.personId !== personId) {
      continue
    }
    if (income.kind === 'business') {
      return income.filingType
    }
    if (income.kind === 'sideBusiness' && income.taxCategory === 'business') {
      fromSideBusiness ??= income.filingType
    }
  }
  return fromSideBusiness
}

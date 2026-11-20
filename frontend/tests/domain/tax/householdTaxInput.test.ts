/**
 * 世帯の税の入口（`householdTaxYear`・`householdEmploymentRaise`）が、細くした型
 * （`HouseholdTaxInput`・`HouseholdTaxIncome`）だけで呼べることを固定する（T1。SPEC §3.6）。
 *
 * 新しい計算（`domain/plan/` の税への橋渡し）は、税が読む項目だけを作って渡す。
 * ここでは、その最小の形で呼んだ結果が、広い入力（テストの `TaxTestInput`。世帯収入の集計と教育費の項目も持つ）を丸ごと渡したときと一致することを確かめる。
 * T1 のときの広い入力は前の版の `SimulationInput`（約 20 項目）だったが、T13 で前の版の型を消したので、残した計算が読む項目だけの形に替えた。
 * 金額そのものの正しさは `household.test.ts` が固定しているので、ここでは比べるだけにする。
 *
 * 値はすべて架空（`.claude/rules/dummy-values.md`）。子の生年を架空にするため 2045 年で確かめる。
 * 国保の加入者・子・年金・年金の改定率がそれぞれ結果に効くように、会社員 1 人＋国保の大人 1 人＋子 1 人の世帯にする。
 */

import { describe, expect, it } from 'vitest'
import { householdIncome } from '../../../src/domain/income/household'
import {
  householdEmploymentRaise,
  householdTaxYear,
  type HouseholdTaxIncome,
  type HouseholdTaxInput,
} from '../../../src/domain/tax/household'
import {
  DUMMY_CITY_FROM,
  defaultInsurance,
  makeMinimalInput,
  masterTables,
  type TaxTestInput,
} from '../fixtures'

/** 広い入力（税の入口が読まない項目も持つ `TaxTestInput`） */
const fullInput: TaxTestInput = makeMinimalInput({
  baseYear: 2026,
  adults: [
    { id: 'a1', birthYear: 2000, retirementAge: 65, lifeExpectancy: 90 },
    { id: 'a2', birthYear: 1980, retirementAge: 60, lifeExpectancy: 90 },
  ],
  children: [
    {
      id: 'c1',
      birthYear: 2040,
      birthMonth: 5,
      elementarySchoolType: 'public',
      juniorHighType: 'public',
      highSchoolType: 'public',
      annualHighSchoolTuition: null,
      universityType: 'nationalPublic',
      cramSchoolPeriods: [],
    },
  ],
  incomes: [
    {
      kind: 'employment',
      personId: 'a1',
      annualGross: 5000000,
      annualBonus: 1000000,
      baseRaiseRate: 0,
      bonusPaymentCount: 2,
    },
  ],
  residence: [{ fromYear: 2000, municipality: DUMMY_CITY_FROM, monthlyRent: 85000, moveInCost: 0 }],
  insurance: defaultInsurance,
  retirement: {
    byPerson: [
      {
        personId: 'a2',
        severancePay: 0,
        severanceYear: null,
        pensionStartAge: 65,
        annualPension: 1000000,
      },
    ],
  },
  assumptions: { pensionIndexationRate: 0.01 },
})

/**
 * 税が読む項目だけを抜き出した入力。オブジェクトリテラルで書くので、
 * 型に無い項目を足すと型検査で落ちる（＝この 7 項目で足りることの確かめにもなる）
 */
const narrowInput: HouseholdTaxInput = {
  baseYear: fullInput.baseYear,
  adults: fullInput.adults,
  children: fullInput.children,
  residence: fullInput.residence,
  insurance: fullInput.insurance,
  retirement: fullInput.retirement,
  assumptions: { pensionIndexationRate: fullInput.assumptions.pensionIndexationRate },
}

/** その年の収入を、年と人ごとの内訳だけに絞る */
function narrowIncome(year: number): HouseholdTaxIncome {
  const { byPerson } = householdIncome(fullInput, year)
  return { year, byPerson }
}

describe('householdTaxYear：細くした型だけで呼べる', () => {
  it('起点年（持ち回りなし）と翌年（持ち回りあり）で、広い入力を丸ごと渡したときと同じ結果になる', () => {
    const fullFirst = householdTaxYear(
      fullInput,
      householdIncome(fullInput, 2045),
      null,
      masterTables,
    )
    const narrowFirst = householdTaxYear(narrowInput, narrowIncome(2045), null, masterTables)
    expect(narrowFirst).toEqual(fullFirst)
    // 比べる意味がある世帯になっていること：国保の加入者がいて、子が扶養に入っている
    expect(narrowFirst.nationalHealthInsurance).not.toBeNull()
    expect(narrowFirst.members.map((member) => member.insurance)).toEqual(['employee', 'national'])

    const fullNext = householdTaxYear(
      fullInput,
      householdIncome(fullInput, 2046),
      fullFirst.carry,
      masterTables,
    )
    const narrowNext = householdTaxYear(
      narrowInput,
      narrowIncome(2046),
      narrowFirst.carry,
      masterTables,
    )
    expect(narrowNext).toEqual(fullNext)
  })
})

describe('householdEmploymentRaise：細くした型だけで呼べる', () => {
  it('手取りを年 50 万円増やす額面が、広い入力を丸ごと渡したときと同じになる', () => {
    const full = householdEmploymentRaise(
      fullInput,
      householdIncome(fullInput, 2045),
      500000,
      masterTables,
    )
    const narrow = householdEmploymentRaise(narrowInput, narrowIncome(2045), 500000, masterTables)
    expect(full).not.toBeNull()
    expect(narrow).toEqual(full)
  })
})

/**
 * 世帯の 1 年ぶんの税・社会保険（`householdTaxYear`）。SPEC §2.4「接続」の世帯の組み立てを固定する。
 *
 * **期待額は実装の出力の写しではない。** `data/tax/*.json` の表だけを読む Python（Decimal）で、世帯の組み立て
 * （誰が国保の加入者か・誰が納めるか・誰が人的控除を受けるか・前年の所得の持ち回り）を SPEC の表から別に組み立てて求めた。
 * その計算機は、先に `employment.test.ts` / `person.test.ts` / `nationalInsurance.test.ts` で固定済みの値
 * （753,320・90,154・240,994・722,335 など）を再現することを確かめてある。
 * `.5` ちょうどの丸めが出る金額の組み合わせは機械的に避けた（KNOWLEDGE.md 2026-09-15）。未就学児の均等割 5 割だけは
 * 必ず `.5` になるが、2 進で正確に表せるので四捨五入が揺れない（`nationalInsurance.test.ts` と同じ）。
 *
 * 値はすべて架空（`.claude/rules/dummy-values.md`）。子のいる世帯は、子の生年が架空の値になるよう 2042〜2050 年で確かめる
 * （料率・税率は最新の表を延ばす前提なので、先の年でも表から手計算できる）。
 */

import { describe, expect, it } from 'vitest'
import { householdIncome } from '../../../src/domain/income/household'
import { steadyStateEmploymentNetPay } from '../../../src/domain/tax/employment'
import {
  householdTaxYear,
  type HouseholdTaxCarry,
  type HouseholdTaxTables,
  type HouseholdTaxYear,
} from '../../../src/domain/tax/household'
import type {
  BusinessIncome,
  Child,
  EmploymentIncome,
  IncomeSource,
  Person,
  PersonRetirement,
} from '../../../src/domain/types'
import {
  DUMMY_CITY_FROM,
  defaultInsurance,
  makeMinimalInput,
  masterTables,
  nationalInsurance,
  type TaxTestInput,
} from '../fixtures'

const KAWASAKI = '14130'
const YOKOHAMA = '14100'

/** 大人 1 人ぶんを作る。寿命想定は既定で 90 歳 */
function adult(id: string, birthYear: number, retirementAge = 65, lifeExpectancy = 90): Person {
  return { id, birthYear, retirementAge, lifeExpectancy }
}

/** 給与の収入源（昇給なし・賞与は年 2 回） */
function employment(personId: string, annualGross: number, annualBonus = 0): EmploymentIncome {
  return {
    kind: 'employment',
    personId,
    annualGross,
    annualBonus,
    baseRaiseRate: 0,
    bonusPaymentCount: 2,
  }
}

/** 事業の収入源（起点年より前に開業・売上は横ばい）。所得 = 売上 − 経費 50 万 */
function business(
  personId: string,
  profit: number,
  filingType: BusinessIncome['filingType'] = 'blue65',
): BusinessIncome {
  return {
    kind: 'business',
    personId,
    startYear: 2000,
    startMonth: 1,
    annualRevenue: profit + 500000,
    annualExpenses: 500000,
    revenueGrowthRate: 0,
    revenueCeiling: null,
    filingType,
  }
}

/** 子 1 人ぶん（すべて公立）。大学に進むかどうかだけを変える */
function child(
  id: string,
  birthYear: number,
  universityType: Child['universityType'] = 'nationalPublic',
): Child {
  return {
    id,
    birthYear,
    birthMonth: 5,
    elementarySchoolType: 'public',
    juniorHighType: 'public',
    highSchoolType: 'public',
    annualHighSchoolTuition: null,
    universityType,
    cramSchoolPeriods: [],
  }
}

/** 年金だけを持つ老後の設定（退職金なし） */
function pension(
  personId: string,
  pensionStartAge: number,
  annualPension: number,
): PersonRetirement {
  return { personId, severancePay: 0, severanceYear: null, pensionStartAge, annualPension }
}

/** テスト用の世帯。`makeMinimalInput` を土台に、税・社会保険に効く項目だけを差し替える */
function household(options: {
  baseYear?: number
  municipality?: string
  adults: readonly Person[]
  incomes: readonly IncomeSource[]
  children?: readonly Child[]
  insurance?: TaxTestInput['insurance']
  retirement?: readonly PersonRetirement[]
  promotionScenario?: TaxTestInput['promotionScenario']
}): TaxTestInput {
  return makeMinimalInput({
    baseYear: options.baseYear ?? 2026,
    adults: options.adults,
    children: options.children ?? [],
    incomes: options.incomes,
    promotionScenario: options.promotionScenario ?? null,
    residence: [
      {
        fromYear: 2000,
        municipality: options.municipality ?? DUMMY_CITY_FROM,
        monthlyRent: 85000,
        moveInCost: 0,
      },
    ],
    insurance: options.insurance ?? defaultInsurance,
    retirement: { byPerson: options.retirement ?? [] },
  })
}

/** 起点の年から順に回し、前年の持ち回りを翌年へ渡す（前の版の `simulate` の年ループと同じ順。タグ `v1-final` にある） */
function runYears(
  input: TaxTestInput,
  fromYear: number,
  toYear: number,
  tables: HouseholdTaxTables = masterTables,
): ReadonlyMap<number, HouseholdTaxYear> {
  const results = new Map<number, HouseholdTaxYear>()
  let carry: HouseholdTaxCarry | null = null
  for (let year = fromYear; year <= toYear; year += 1) {
    const result = householdTaxYear(input, householdIncome(input, year), carry, tables)
    results.set(year, result)
    carry = result.carry
  }
  return results
}

/** その年の結果を取り出す。無ければテストを落とす */
function at(results: ReadonlyMap<number, HouseholdTaxYear>, year: number): HouseholdTaxYear {
  const result = results.get(year)
  if (result === undefined) {
    throw new Error(`${year} 年の結果が無い`)
  }
  return result
}

/** 世帯員 1 人ぶんの結果を取り出す。無ければテストを落とす */
function memberOf(result: HouseholdTaxYear, personId: string) {
  const member = result.members.find((candidate) => candidate.personId === personId)
  if (member === undefined) {
    throw new Error(`${personId} の結果が無い`)
  }
  return member
}

/** 代わりの自治体を持たない表（料率が表に無い自治体は例外になる） */
const tablesWithoutFallback: HouseholdTaxTables = {
  ...masterTables,
  nationalInsurance: {
    ...nationalInsurance,
    nationalHealthInsurance: {
      ...nationalInsurance.nationalHealthInsurance,
      appDefault: { fallbackMunicipalityCode: null },
    },
  },
}

describe('householdTaxYear：会社員 1 人の世帯', () => {
  // `makeMinimalInput`：1970 年生・給与 600 万・99001。内訳は fixtures.ts の `minimalHouseholdByYear`
  const input = makeMinimalInput()

  it('起点年の手取りは「同じ給与が続く前提の手取り」（steadyStateEmploymentNetPay）と一致する', () => {
    const result = householdTaxYear(input, householdIncome(input, 2026), null, masterTables)

    const steady = steadyStateEmploymentNetPay(
      {
        year: 2026,
        pay: { annualGross: 6000000, annualBonus: 0 },
        age: 56,
        bonusPaymentCount: 2,
        municipalityCode: DUMMY_CITY_FROM,
        personal: { spouse: null, dependents: [] },
      },
      masterTables,
    )
    expect(result.netIncome).toBe(steady)
    // 600 万 − 社会保険料 932,100 − 所得税 144,165 − 住民税 302,200
    expect(result.netIncome).toBe(4621535)
    expect(result.taxes).toBe(144165 + 302200)
    expect(result.socialInsurance).toBe(932100)
  })

  it('会社の保険に入り、国保の加入者がいないので国保は null', () => {
    const result = householdTaxYear(input, householdIncome(input, 2026), null, masterTables)

    expect(result.year).toBe(2026)
    expect(result.municipality).toBe(DUMMY_CITY_FROM)
    expect(result.members.map((member) => [member.personId, member.insurance])).toEqual([
      ['a1', 'employee'],
    ])
    expect(result.nationalHealthInsurance).toBeNull()
    expect(memberOf(result, 'a1').taxYear.socialInsurance).toMatchObject({
      nationalHealthInsurance: 0,
      nationalPension: 0,
      total: 932100,
    })
  })

  it('世帯の合計は世帯員の合計と一致し、翌年への持ち回りに所得と翌年度の住民税を載せる', () => {
    const result = householdTaxYear(input, householdIncome(input, 2026), null, masterTables)
    const member = memberOf(result, 'a1')

    expect(result.netIncome).toBe(member.netIncome)
    expect(result.carry.taxBase.year).toBe(2026)
    expect(result.carry.taxBase.totalIncomeByPerson.get('a1')).toBe(4360000)
    expect(result.carry.taxBase.residentTaxNextFiscalYearByPerson.get('a1')).toBe(302200)
    // 給与収入 600 万は基準（55 万円）を超えるので「給与所得者等」
    expect([...result.carry.salaryEarnerIds]).toEqual(['a1'])
  })
})

describe('householdTaxYear：1 年ずれ（住民税と国保は前年の所得で決まる）', () => {
  /**
   * 1970 年生・58 歳（2028 年）まで就労。給与は 2026 年 600 万 → 2027 年から 660 万に上がる。99001（国保は代わりの市〔appDefault.fallbackMunicipalityCode〕の料率で概算）。
   *
   * - 2026：所得 436 万。翌年度の住民税 302,200
   * - 2027：所得 484 万。社会保険料 1,043,352、所得税 181,840、翌年度の住民税 339,100。納める住民税は前年ぶんの 302,200
   * - 2028：所得税 224,722（基礎控除が変わる）。納める住民税は 339,100
   * - 2029（59 歳・退職の翌年）：国保は前年の所得 484 万から (484 万 − 43 万) × 料率 + 均等割 = 695,353、国民年金 219,480
   * - 2030（60 歳）：前年の所得 0 → 国保は均等割の 7 割軽減 21,666。国民年金は 60 歳で終わる
   */
  const input = household({
    adults: [adult('a1', 1970, 58, 60)],
    incomes: [employment('a1', 6000000)],
    promotionScenario: {
      id: 'raise',
      tracks: [{ personId: 'a1', steps: [{ year: 2027, annualGross: 6600000, annualBonus: 0 }] }],
    },
    retirement: [pension('a1', 59, 1200000)],
  })
  const results = runYears(input, 2026, 2030)

  it('2 年目に納める住民税は、1 年目の所得が生んだ翌年度の住民税（当年の所得ぶんではない）', () => {
    const first = memberOf(at(results, 2026), 'a1')
    const second = memberOf(at(results, 2027), 'a1')

    expect(first.taxYear.residentTaxNextFiscalYear.total).toBe(302200)
    expect(second.residentTaxPaid).toBe(first.taxYear.residentTaxNextFiscalYear.total)
    // 昇給した 2027 年の所得が生む住民税（339,100）は、2028 年に納める
    expect(second.taxYear.residentTaxNextFiscalYear.total).toBe(339100)
    expect(memberOf(at(results, 2028), 'a1').residentTaxPaid).toBe(339100)
    // 2027：660 万 − 1,043,352 − 181,840 − 302,200
    expect(second.netIncome).toBe(5072608)
    // 2028：660 万 − 1,043,352 − 224,722 − 339,100
    expect(memberOf(at(results, 2028), 'a1').netIncome).toBe(4992826)
  })

  it('退職の翌年は国保になり、国保料は前年の所得から決まる。60 歳未満なら国民年金が乗る', () => {
    const retired = at(results, 2029)
    const member = memberOf(retired, 'a1')

    expect(member.insurance).toBe('national')
    expect(retired.nationalHealthInsurance?.payerId).toBe('a1')
    // 当年の所得は 0 だが、前年の所得 484 万に所得割が掛かる
    expect(member.taxYear.income.totalIncome).toBe(0)
    expect(retired.nationalHealthInsurance?.result.segments.medical.incomeLevy).toBe(367353)
    expect(retired.nationalHealthInsurance?.result.total).toBe(695353)
    expect(member.taxYear.socialInsurance).toEqual({
      employee: null,
      nationalHealthInsurance: 695353,
      nationalPension: 219480,
      total: 914833,
    })
    // 給与 0 でも前年ぶんの住民税 339,100 を納める。手取り = −914,833 − 339,100（年金は含まない）
    expect(member.residentTaxPaid).toBe(339100)
    expect(retired.netIncome).toBe(-1253933)
  })

  it('その翌年は前年の所得が 0 なので、住民税 0・国保は 7 割軽減。60 歳で国民年金が終わる', () => {
    const last = at(results, 2030)
    const member = memberOf(last, 'a1')

    expect(member.residentTaxPaid).toBe(0)
    expect(last.nationalHealthInsurance?.result.reductionRate).toBe(0.7)
    // 均等割 (40,870 + 13,380 + 16,200 + 1,770) × 0.3 を区分ごとに丸めて 12,261 + 4,014 + 4,860 + 531
    expect(last.nationalHealthInsurance?.result.total).toBe(21666)
    expect(member.taxYear.socialInsurance.nationalPension).toBe(0)
    expect(last.netIncome).toBe(-21666)
  })
})

describe('householdTaxYear：会社員 + 個人事業主（青色 65 万）+ 子', () => {
  /**
   * 2042 年・川崎市。a1（2000 年生・42 歳）会社員：月給ぶん 420 万 + 賞与 80 万。a2（2002 年生・40 歳）個人事業主：所得 300 万・青色 65 万。
   * 子は 2037 年生（5 歳）。世帯主は先頭の a1（会社員）= 擬制世帯主。
   *
   * - a1：社会保険料 794,792（介護分あり）、給与所得 356 万、所得税 119,457、住民税 236,884 → 手取り 3,848,867
   * - a2：合計所得 300 万 − 65 万 = 235 万。国保の賦課基準額 235 万 − 43 万 = 192 万
   *   - 医療 158,592 + 43,261／支援 55,488 + 15,306／介護 51,264 + 15,828／子ども 6,144 + 1,742 = 347,625
   *   - 国民年金 219,480。所得税 59,320、住民税 138,338 → 手取り 300 万 − 567,105 − 59,320 − 138,338 = 2,235,237
   */
  const input = household({
    baseYear: 2042,
    municipality: KAWASAKI,
    adults: [adult('a1', 2000), adult('a2', 2002)],
    incomes: [employment('a1', 4200000, 800000), business('a2', 3000000)],
    children: [child('c1', 2037)],
  })
  const result = at(runYears(input, 2042, 2042), 2042)

  it('個人事業主だけが国保の加入者で、国保料と国民年金は手計算と一致する', () => {
    expect(result.members.map((member) => member.insurance)).toEqual(['employee', 'national'])
    expect(result.nationalHealthInsurance).toMatchObject({
      payerId: 'a2',
      ratesMunicipality: KAWASAKI,
      approximated: false,
    })
    expect(result.nationalHealthInsurance?.result.segments).toMatchObject({
      medical: { incomeLevy: 158592, perCapitaLevy: 43261 },
      support: { incomeLevy: 55488, perCapitaLevy: 15306 },
      longTermCare: { incomeLevy: 51264, perCapitaLevy: 15828 },
      childcare: { incomeLevy: 6144, perCapitaLevy: 1742 },
    })
    expect(result.nationalHealthInsurance?.result.total).toBe(347625)
    expect(memberOf(result, 'a2').taxYear.socialInsurance).toEqual({
      employee: null,
      nationalHealthInsurance: 347625,
      nationalPension: 219480,
      total: 567105,
    })
  })

  it('世帯主の会社員は擬制世帯主で、軽減の判定の所得にだけ入る（所得割・均等割には入らない）', () => {
    // 判定所得 = 世帯主 356 万 + 加入者 235 万
    expect(result.nationalHealthInsurance?.result.reductionJudgmentIncome).toBe(5910000)
    expect(result.nationalHealthInsurance?.result.reductionRate).toBe(0)
    // 所得割は a2 の 192 万だけに掛かっている（上のテストの 158,592 = 192 万 × 8.26%）
    expect(memberOf(result, 'a1').taxYear.socialInsurance.nationalHealthInsurance).toBe(0)
  })

  it('子は会社員の扶養に入り、国保の加入者にならない（均等割も独自控除も付かない）', () => {
    // 加入者が a2 だけなので均等割は 1 人ぶん。子が加入者なら川崎市の独自控除（16 歳未満 33 万）が付くはず
    expect(result.nationalHealthInsurance?.result.municipalDeduction).toBe(0)
    expect(result.nationalHealthInsurance?.result.segments.medical.perCapitaLevy).toBe(43261)
  })

  it('国保を納めて社会保険料控除を受けるのは個人事業主（税率の高い会社員の側で控除しない）', () => {
    const employee = memberOf(result, 'a1')
    const owner = memberOf(result, 'a2')

    expect(employee.taxYear.incomeTax.deductions.socialInsurance).toBe(794792)
    expect(owner.taxYear.incomeTax.deductions.socialInsurance).toBe(567105)
    expect(employee.taxYear.incomeTax.tax).toBe(119457)
    expect(owner.taxYear.incomeTax.tax).toBe(59320)
    expect(employee.netIncome).toBe(3848867)
    expect(owner.netIncome).toBe(2235237)
    expect(result.netIncome).toBe(3848867 + 2235237)
    expect(result.taxes).toBe(119457 + 236884 + 59320 + 138338)
    expect(result.socialInsurance).toBe(794792 + 567105)
  })
})

describe('householdTaxYear：会社員の家族の扶養（dependentAdultIds）', () => {
  /**
   * 99001。a1（1970 年生）会社員 600 万・57 歳（2027 年）まで就労。a2（1972 年生）は扶養に入る申告だが、
   * 54 歳（2026 年）までは自分の給与 240 万がある。
   *
   * - 2026：a2 も給与があるので会社の保険（社会保険料 372,840）。a1 は配偶者控除なし（a2 の所得 160 万）
   * - 2027：a2 は扶養。a1 は配偶者控除（所得税 38 万・住民税 33 万）で所得税 105,367
   * - 2028：a1 が退職 → 2 人とも国保。国保は前年の所得（a1 436 万・a2 0）から、2 人ぶんの均等割で 699,749。国民年金は 2 人とも 219,480
   */
  const input = household({
    adults: [adult('a1', 1970, 57, 60), adult('a2', 1972, 54, 60)],
    incomes: [employment('a1', 6000000), employment('a2', 2400000)],
    insurance: { dependentAdultIds: ['a2'], nationalHealthInsuranceHouseholderId: null },
  })
  const results = runYears(input, 2026, 2028)

  it('本人に給与がある年は、扶養の申告があっても会社の保険が優先する', () => {
    const result = at(results, 2026)

    expect(memberOf(result, 'a2').insurance).toBe('employee')
    expect(memberOf(result, 'a2').taxYear.socialInsurance.total).toBe(372840)
    expect(result.nationalHealthInsurance).toBeNull()
  })

  it('扶養に入った年は国保が null・国民年金 0（保険料の負担なし）', () => {
    const result = at(results, 2027)
    const dependent = memberOf(result, 'a2')

    expect(dependent.insurance).toBe('dependent')
    expect(result.nationalHealthInsurance).toBeNull()
    expect(dependent.taxYear.socialInsurance.total).toBe(0)
    // 前年の給与ぶんの住民税 82,200 だけは納める（1 年ずれ）
    expect(dependent.residentTaxPaid).toBe(82200)
    expect(dependent.netIncome).toBe(-82200)
    // 会社員の側は配偶者控除を受ける
    expect(memberOf(result, 'a1').taxYear.incomeTax.deductions.spouse).toBe(380000)
    expect(memberOf(result, 'a1').taxYear.incomeTax.tax).toBe(105367)
  })

  it('会社員が退職した翌年からは、扶養の申告があっても国保と国民年金に戻る', () => {
    const result = at(results, 2028)

    expect(result.members.map((member) => member.insurance)).toEqual(['national', 'national'])
    // 世帯主（先頭の a1）が加入者なので a1 が納める
    expect(result.nationalHealthInsurance?.payerId).toBe('a1')
    // 医療 327,369 + 81,740／支援 102,966 + 26,760／介護 111,612 + 32,400／子ども 13,362 + 3,540
    expect(result.nationalHealthInsurance?.result.total).toBe(699749)
    expect(memberOf(result, 'a1').taxYear.socialInsurance.total).toBe(699749 + 219480)
    expect(memberOf(result, 'a2').taxYear.socialInsurance).toMatchObject({
      nationalHealthInsurance: 0,
      nationalPension: 219480,
    })
  })

  it('扶養の申告が無ければ、無収入の配偶者は会社員がいる年でも国保と国民年金', () => {
    const withoutDependent = runYears({ ...input, insurance: defaultInsurance }, 2026, 2027)
    const result = at(withoutDependent, 2027)

    expect(memberOf(result, 'a2').insurance).toBe('national')
    expect(result.nationalHealthInsurance?.payerId).toBe('a2')
    expect(memberOf(result, 'a2').taxYear.socialInsurance.nationalPension).toBe(219480)
  })
})

describe('householdTaxYear：会社員のいない世帯（個人事業主 2 人 + 子 2 人）', () => {
  /**
   * 2050 年。a1（2010 年生・40 歳）所得 550 万、a2（2012 年生・38 歳）所得 190 万。どちらも青色 65 万 → 合計所得 485 万・125 万。
   * 子は 2045 年生（5 歳・未就学児）と 2033 年生（17 歳）。会社員がいないので子も国保の加入者になる。
   *
   * 独自控除は 16 歳未満 33 万 + 16〜18 歳 12 万 = 45 万。
   * - 川崎市：最も賦課基準額が高い a1 から引く。均等割は大人 2 + 17 歳 1 + 未就学児 0.5 人ぶん（医療 43,261 × 3.5 = 151,413.5 → 151,414）。
   *   子ども分の均等割は、こども 2 人が全額軽減・大人 2 人が 1,742 ずつ。
   *   医療 395,654 + 151,414／支援 138,431 + 53,571／介護（a1 だけ）105,999 + 15,828／子ども 15,328 + 3,484 = 879,709
   * - 横浜市：加入者である世帯主から引く。世帯主が a1 なら介護分（40 歳以上の a1 だけ）の所得割も減って 863,154、
   *   世帯主を a2（38 歳）にすると介護分の所得割は減らず 875,934
   */
  function twoOwners(municipality: string, householderId: string | null): TaxTestInput {
    return household({
      baseYear: 2050,
      municipality,
      adults: [adult('a1', 2010), adult('a2', 2012)],
      incomes: [business('a1', 5500000), business('a2', 1900000)],
      children: [child('c1', 2045), child('c2', 2033)],
      insurance: { dependentAdultIds: [], nationalHealthInsuranceHouseholderId: householderId },
    })
  }
  const resultOf = (municipality: string, householderId: string | null): HouseholdTaxYear =>
    at(runYears(twoOwners(municipality, householderId), 2050, 2050), 2050)

  it('子が国保の加入者になり、未就学児の 5 割と 18 歳以下の子ども分の軽減・独自控除が効く', () => {
    const result = resultOf(KAWASAKI, null)
    const nhi = result.nationalHealthInsurance?.result

    expect(nhi?.municipalDeduction).toBe(450000)
    expect(nhi?.segments).toMatchObject({
      medical: { incomeLevy: 395654, perCapitaLevy: 151414 },
      support: { incomeLevy: 138431, perCapitaLevy: 53571 },
      longTermCare: { incomeLevy: 105999, perCapitaLevy: 15828 },
      childcare: { incomeLevy: 15328, perCapitaLevy: 3484 },
    })
    expect(nhi?.total).toBe(879709)
    // 判定所得は加入者の合計（485 万 + 125 万。子は 0）
    expect(nhi?.reductionJudgmentIncome).toBe(6100000)
  })

  it('世帯主が加入者なら世帯主が納めて控除を受ける', () => {
    const result = resultOf(KAWASAKI, null)

    expect(result.nationalHealthInsurance?.payerId).toBe('a1')
    expect(memberOf(result, 'a1').taxYear.socialInsurance.total).toBe(879709 + 219480)
    expect(memberOf(result, 'a2').taxYear.socialInsurance.total).toBe(219480)
    // a1：550 万 − 1,099,189 − 所得税 168,165 − 住民税 291,520
    expect(memberOf(result, 'a1').netIncome).toBe(3941126)
    expect(memberOf(result, 'a2').netIncome).toBe(1615550)
  })

  it('世帯主を指定すると、納める人が変わる（所得の低い人が納めると世帯の税が増える）', () => {
    const byFirst = resultOf(KAWASAKI, null)
    const bySecond = resultOf(KAWASAKI, 'a2')

    expect(bySecond.nationalHealthInsurance?.payerId).toBe('a2')
    // 川崎市は引き先が「最も賦課基準額が高い加入者」なので、世帯主が変わっても国保料は同じ
    expect(bySecond.nationalHealthInsurance?.result.total).toBe(879709)
    expect(byFirst.taxes).toBe(524655)
    expect(bySecond.taxes).toBe(664305)
    expect(bySecond.netIncome).toBe(5417026)
  })

  it('横浜市は独自控除の引き先が「加入者である世帯主」なので、世帯主の指定で国保料そのものが変わる', () => {
    const byFirst = resultOf(YOKOHAMA, null)
    const bySecond = resultOf(YOKOHAMA, 'a2')

    expect(byFirst.nationalHealthInsurance?.result.municipalDeduction).toBe(450000)
    expect(bySecond.nationalHealthInsurance?.result.municipalDeduction).toBe(450000)
    // 世帯主 a1（40 歳）から引くと介護分の所得割も減る。a2（38 歳）から引くと介護分は減らない
    expect(byFirst.nationalHealthInsurance?.result.segments.longTermCare.incomeLevy).toBe(112748)
    expect(bySecond.nationalHealthInsurance?.result.segments.longTermCare.incomeLevy).toBe(125528)
    expect(byFirst.nationalHealthInsurance?.result.total).toBe(863154)
    expect(bySecond.nationalHealthInsurance?.result.total).toBe(875934)
    expect(byFirst.netIncome).toBe(5568010)
    expect(bySecond.netIncome).toBe(5419001)
  })
})

describe('householdTaxYear：国保の料率が表に無い自治体', () => {
  // 1980 年生・個人事業主・所得 300 万・青色 65 万（合計所得 235 万）
  const owner = (municipality: string): TaxTestInput =>
    household({
      municipality,
      adults: [adult('a1', 1980)],
      incomes: [business('a1', 3000000)],
    })

  it('表の代わりの自治体の料率で概算し、概算したことを返す', () => {
    const result = at(runYears(owner(DUMMY_CITY_FROM), 2026, 2026), 2026)
    const fallback = nationalInsurance.nationalHealthInsurance.appDefault.fallbackMunicipalityCode

    expect(fallback).not.toBeNull()
    expect(result.nationalHealthInsurance).toMatchObject({
      approximated: true,
      ratesMunicipality: fallback,
    })
    // 代わりの市（appDefault.fallbackMunicipalityCode）の料率：192 万 × (8.33 + 2.62 + 2.84 + 0.34)% + 均等割 72,220 = 343,516
    expect(result.nationalHealthInsurance?.result.total).toBe(343516)
    // 住民税の課税地は住んでいる自治体のまま（標準税率）
    expect(result.municipality).toBe(DUMMY_CITY_FROM)
    expect(memberOf(result, 'a1').taxYear.residentTaxNextFiscalYear.municipalityKnown).toBe(false)
    expect(result.netIncome).toBe(2264505)
  })

  it('料率が表にある自治体（川崎市）なら概算にならない', () => {
    const result = at(runYears(owner(KAWASAKI), 2026, 2026), 2026)

    expect(result.nationalHealthInsurance).toMatchObject({
      approximated: false,
      ratesMunicipality: KAWASAKI,
    })
    expect(result.nationalHealthInsurance?.result.total).toBe(347625)
    expect(result.netIncome).toBe(2260362)
  })

  it('代わりの自治体が null の表では例外（黙って別の料率を当てない）', () => {
    expect(() => runYears(owner(DUMMY_CITY_FROM), 2026, 2026, tablesWithoutFallback)).toThrow(
      RangeError,
    )
    // 表にある自治体は、代わりの自治体が無くても計算できる
    expect(() => runYears(owner(KAWASAKI), 2026, 2026, tablesWithoutFallback)).not.toThrow()
  })

  it('国保の加入者がいない世帯は、代わりの自治体が null でも例外にならない', () => {
    expect(() => runYears(makeMinimalInput(), 2026, 2026, tablesWithoutFallback)).not.toThrow()
  })
})

describe('householdTaxYear：人的控除（配偶者・子の扶養）', () => {
  // 子は 2030 年 5 月生・大学に進まない → 2048 年は 18 歳（高 3）、2049 年（19 歳になる年度）から学校を出ている
  const teen = child('c1', 2030, 'none')

  /**
   * 2048〜2049 年・99001・共働き。a1（2005 年生）給与 150 万（所得 81 万）、a2（2008 年生）給与 680 万（所得 502 万）。
   * 所得の多い a2 だけが、配偶者特別控除（配偶者の所得 81 万 → 所得税 38 万・住民税 33 万）と子の扶養控除（同 38 万・33 万）を受ける。
   */
  const input = household({
    baseYear: 2048,
    adults: [adult('a1', 2005), adult('a2', 2008)],
    incomes: [employment('a1', 1500000), employment('a2', 6800000)],
    children: [teen],
  })
  const results = runYears(input, 2048, 2049)

  it('合計所得の多い方（2 人目）だけが配偶者特別控除と子の扶養控除を受け、もう 1 人は受けない', () => {
    const result = at(results, 2048)
    const lower = memberOf(result, 'a1')
    const higher = memberOf(result, 'a2')

    expect(higher.taxYear.incomeTax.deductions).toMatchObject({
      spouse: 380000,
      dependents: 380000,
    })
    expect(higher.taxYear.residentTaxNextFiscalYear.deductions).toMatchObject({
      spouse: 330000,
      dependents: 330000,
    })
    expect(lower.taxYear.incomeTax.deductions).toMatchObject({ spouse: 0, dependents: 0 })
    expect(lower.taxYear.residentTaxNextFiscalYear.deductions).toMatchObject({
      spouse: 0,
      dependents: 0,
    })
    // a2：680 万 − 1,044,352 − 所得税 163,620 − 住民税 291,000
    expect(higher.netIncome).toBe(5301028)
    // a1：150 万 − 234,840 − 所得税 0 − 住民税 17,000
    expect(lower.netIncome).toBe(1248160)
  })

  it('16〜18 歳の子には扶養控除が付き、学校を出た年（19 歳になる年度）からは扶養から外れる', () => {
    const inSchool = memberOf(at(results, 2048), 'a2')
    const graduated = memberOf(at(results, 2049), 'a2')

    expect(inSchool.taxYear.incomeTax.deductions.dependents).toBe(380000)
    expect(graduated.taxYear.incomeTax.deductions.dependents).toBe(0)
    expect(graduated.taxYear.residentTaxNextFiscalYear.deductions.dependents).toBe(0)
    // 配偶者特別控除は残る。所得税が 163,620 → 202,000 に増える
    expect(graduated.taxYear.incomeTax.deductions.spouse).toBe(380000)
    expect(graduated.taxYear.incomeTax.tax).toBe(202000)
    // 住民税は 1 年遅れ：2049 年に納めるのは扶養控除があった 2048 年の所得ぶん
    expect(graduated.residentTaxPaid).toBe(291000)
    expect(graduated.taxYear.residentTaxNextFiscalYear.total).toBe(324000)
  })

  it('大学に進む子は、在学中（19〜22 歳）は特定扶養親族として扶養に残る', () => {
    const withUniversity = household({
      baseYear: 2049,
      adults: [adult('a1', 2005), adult('a2', 2008)],
      incomes: [employment('a1', 1500000), employment('a2', 6800000)],
      children: [child('c1', 2030, 'nationalPublic')],
    })
    const result = at(runYears(withUniversity, 2049, 2049), 2049)

    expect(memberOf(result, 'a2').taxYear.incomeTax.deductions.dependents).toBe(630000)
    expect(memberOf(result, 'a2').taxYear.residentTaxNextFiscalYear.deductions.dependents).toBe(
      450000,
    )
  })

  it('合計所得が同額なら、先に並んでいる人が受ける', () => {
    const tie = household({
      baseYear: 2048,
      adults: [adult('a1', 2005), adult('a2', 2008)],
      incomes: [employment('a1', 5400000), employment('a2', 5400000)],
      children: [teen],
    })
    const result = at(runYears(tie, 2048, 2048), 2048)

    expect(memberOf(result, 'a1').taxYear.income.totalIncome).toBe(3880000)
    expect(memberOf(result, 'a2').taxYear.income.totalIncome).toBe(3880000)
    expect(memberOf(result, 'a1').taxYear.incomeTax.deductions.dependents).toBe(380000)
    expect(memberOf(result, 'a2').taxYear.incomeTax.deductions.dependents).toBe(0)
    // 相手の所得 388 万は配偶者特別控除の上限（133 万）を超えるので、どちらも配偶者の控除は 0
    expect(memberOf(result, 'a1').taxYear.incomeTax.deductions.spouse).toBe(0)
    // 同じ給与でも、扶養控除を受ける a1 の方が税が安い
    expect(memberOf(result, 'a1').taxYear.incomeTax.tax).toBe(109484)
    expect(memberOf(result, 'a2').taxYear.incomeTax.tax).toBe(147864)
    expect(memberOf(result, 'a1').netIncome).toBe(4237268)
    expect(memberOf(result, 'a2').netIncome).toBe(4165888)
  })
})

describe('householdTaxYear：国保の年齢の上限と寿命想定', () => {
  const insuredAgeUnder = nationalInsurance.nationalHealthInsurance.insuredAge.under

  it('表の年齢（75 歳）以上は後期高齢者医療で、国保の加入者にならない', () => {
    // 2026 年に a1 は 75 歳、a2 は 74 歳。どちらも無収入
    const input = household({
      adults: [
        adult('a1', 2026 - insuredAgeUnder, 60),
        adult('a2', 2026 - insuredAgeUnder + 1, 60),
      ],
      incomes: [],
    })
    const result = at(runYears(input, 2026, 2026), 2026)

    expect(result.members.map((member) => member.insurance)).toEqual([
      'lateStageElderly',
      'national',
    ])
    // 加入者は a2 だけ。世帯主の a1 は加入者でないので、加入者の a2 が納める
    expect(result.nationalHealthInsurance?.payerId).toBe('a2')
    // 均等割 1 人ぶんの 7 割軽減（74 歳は介護分なし）：12,261 + 4,014 + 531
    expect(result.nationalHealthInsurance?.result.segments.longTermCare.premium).toBe(0)
    expect(result.nationalHealthInsurance?.result.total).toBe(16806)
    // 後期高齢者医療の保険料は未実装で 0
    expect(memberOf(result, 'a1').taxYear.socialInsurance.total).toBe(0)
  })

  it('75 歳になった年から国保を外れ、加入者がいなくなれば国保は null', () => {
    const input = household({
      adults: [adult('a1', 2026 - insuredAgeUnder + 1, 60)],
      incomes: [],
    })
    const results = runYears(input, 2026, 2027)

    expect(memberOf(at(results, 2026), 'a1').insurance).toBe('national')
    expect(memberOf(at(results, 2027), 'a1').insurance).toBe('lateStageElderly')
    expect(at(results, 2027).nationalHealthInsurance).toBeNull()
  })

  it('寿命想定の年を過ぎた大人は none で、配偶者としても数えない', () => {
    // a2 は 1950 年生・寿命想定 70 歳（2020 年まで）
    const past = household({
      adults: [adult('a1', 1970, 60), adult('a2', 1950, 60, 70)],
      incomes: [employment('a1', 6000000)],
    })
    const result = at(runYears(past, 2026, 2026), 2026)

    expect(memberOf(result, 'a2').insurance).toBe('none')
    expect(memberOf(result, 'a2').netIncome).toBe(0)
    expect(result.nationalHealthInsurance).toBeNull()
    expect(memberOf(result, 'a1').taxYear.incomeTax.deductions.spouse).toBe(0)
    // 1 人世帯と同じ手取りになる
    expect(result.netIncome).toBe(4621535)
  })

  it('寿命想定の年までは配偶者として数える（76 歳・無収入なら老人控除対象配偶者）', () => {
    const alive = household({
      adults: [adult('a1', 1970, 60), adult('a2', 1950, 60, 80)],
      incomes: [employment('a1', 6000000)],
    })
    const result = at(runYears(alive, 2026, 2026), 2026)

    expect(memberOf(result, 'a2').insurance).toBe('lateStageElderly')
    expect(memberOf(result, 'a1').taxYear.incomeTax.deductions.spouse).toBe(480000)
    expect(memberOf(result, 'a1').taxYear.residentTaxNextFiscalYear.deductions.spouse).toBe(380000)
    // 600 万 − 932,100 − 所得税 97,352 − 住民税 264,200
    expect(result.netIncome).toBe(4706348)
  })
})

describe('householdTaxYear：給与所得者等の判定の境界（国保の軽減に効く）', () => {
  const thresholds = nationalInsurance.nationalHealthInsurance.reduction.salaryEarnerThresholds

  /**
   * 2026 年は 2 人とも少額の給与があり、2027 年は 2 人とも退職して国保（川崎市）。2027 年の軽減は 2026 年の所得と
   * 2026 年に「給与所得者等」だったかで決まる。判定所得は a1 の副業（雑所得）50 万だけ（給与所得は 2 人とも 0）。
   *
   * - 給与所得者等が 2 人：7 割軽減の基準は 43 万 + 10 万 × (2 − 1) = 53 万 ≥ 50 万 → 7 割（国保料 55,581）
   * - 1 人だけ：基準は 43 万 < 50 万。5 割の基準 43 万 + 31 万 × 2 = 105 万に収まる → 5 割（国保料 86,035）
   */
  function retiringCouple(firstPay: number): TaxTestInput {
    return household({
      municipality: KAWASAKI,
      adults: [adult('a1', 1970, 56, 60), adult('a2', 1972, 54, 60)],
      incomes: [
        employment('a1', firstPay),
        employment('a2', 600000),
        {
          kind: 'sideBusiness',
          personId: 'a1',
          annualRevenue: 500000,
          annualExpenses: 0,
          taxCategory: 'miscellaneous',
          filingType: 'white',
        },
      ],
    })
  }

  it('給与収入が基準ちょうどなら当たらず、1 円超えると当たる', () => {
    const atThreshold = runYears(retiringCouple(thresholds.employmentRevenueOver), 2026, 2027)
    const overThreshold = runYears(retiringCouple(thresholds.employmentRevenueOver + 1), 2026, 2027)

    expect([...at(atThreshold, 2026).carry.salaryEarnerIds]).toEqual(['a2'])
    expect([...at(overThreshold, 2026).carry.salaryEarnerIds]).toEqual(['a1', 'a2'])

    const reducedLess = at(atThreshold, 2027).nationalHealthInsurance?.result
    const reducedMore = at(overThreshold, 2027).nationalHealthInsurance?.result
    expect(reducedLess?.reductionJudgmentIncome).toBe(500000)
    expect(reducedLess?.reductionRate).toBe(0.5)
    expect(reducedLess?.total).toBe(86035)
    expect(reducedMore?.reductionRate).toBe(0.7)
    expect(reducedMore?.total).toBe(55581)
  })

  /**
   * 年金の基準は年齢で違う。2026 年（起点年 = 前年も同じとみなす）・川崎市。
   * a1（1960 年生・66 歳）は事業の所得 50 万（白色）+ 年金、a2（1963 年生・63 歳）は年金だけ。2 人とも国保。
   */
  function pensioners(firstPension: number, secondPension: number): TaxTestInput {
    return household({
      municipality: KAWASAKI,
      adults: [adult('a1', 1960, 70), adult('a2', 1963, 60)],
      incomes: [business('a1', 500000, 'white')],
      retirement: [pension('a1', 65, firstPension), pension('a2', 60, secondPension)],
    })
  }

  it('年金は 65 歳以上と 65 歳未満で基準が違い、どちらも基準ちょうどなら当たらない', () => {
    const over65 = thresholds.pensionRevenueOverAge65Plus
    const under65 = thresholds.pensionRevenueOverUnder65
    const resultOf = (first: number, second: number): HouseholdTaxYear =>
      at(runYears(pensioners(first, second), 2026, 2026), 2026)

    const both = resultOf(over65 + 1, under65 + 1)
    expect([...both.carry.salaryEarnerIds]).toEqual(['a1', 'a2'])
    expect(both.nationalHealthInsurance?.result.reductionRate).toBe(0.7)
    // 66 歳・63 歳：介護分は 63 歳の a2 だけ。国民年金は 2 人とも 60 歳以上で無い
    expect(both.nationalHealthInsurance?.result.total).toBe(48963)
    expect(both.socialInsurance).toBe(48963)

    // 66 歳の a1 が基準（125 万）ちょうど → 当たらない
    const firstAtThreshold = resultOf(over65, under65 + 1)
    expect([...firstAtThreshold.carry.salaryEarnerIds]).toEqual(['a2'])
    expect(firstAtThreshold.nationalHealthInsurance?.result.reductionRate).toBe(0.5)
    expect(firstAtThreshold.nationalHealthInsurance?.result.total).toBe(76252)

    // 63 歳の a2 が基準（60 万）ちょうど → 当たらない
    const secondAtThreshold = resultOf(over65 + 1, under65)
    expect([...secondAtThreshold.carry.salaryEarnerIds]).toEqual(['a1'])
    expect(secondAtThreshold.nationalHealthInsurance?.result.reductionRate).toBe(0.5)

    // 63 歳の a2 に 65 歳以上の基準（125 万）は使わない：61 万でも当たる。66 歳の a1 は 61 万では当たらない
    const swapped = resultOf(under65 + 10000, under65 + 10000)
    expect([...swapped.carry.salaryEarnerIds]).toEqual(['a2'])
  })
})

describe('householdTaxYear：表の最初の年度より前の年（2025 年）', () => {
  /**
   * 起点年 2025・川崎市。a1・a2 とも 1986 年生（2025 年に 39 歳・2026 年に 40 歳）。a1 会社員 540 万、a2 個人事業主 所得 300 万・青色 65 万。
   * 社会保険・国保・国民年金の表は 2026 年度からしか無いので、2025 年は 2026 年度の表で計算する。年齢は実際の年（39 歳）で数えるので、
   * 介護保険（40〜64 歳）は 2025 年には掛からない。
   */
  const input = household({
    baseYear: 2025,
    municipality: KAWASAKI,
    adults: [adult('a1', 1986), adult('a2', 1986)],
    incomes: [employment('a1', 5400000), business('a2', 3000000)],
  })

  it('例外にならず、結果と持ち回りの年は実際の年（2025）になる', () => {
    const results = runYears(input, 2025, 2026)

    expect(at(results, 2025).year).toBe(2025)
    expect(at(results, 2025).members.every((member) => member.taxYear.year === 2025)).toBe(true)
    expect(at(results, 2025).carry.taxBase.year).toBe(2025)
    // 2025 年の持ち回りを 2026 年に渡せる（年の検証に通る）
    expect(at(results, 2026).year).toBe(2026)
  })

  it('年齢は実際の年で数える：39 歳の 2025 年は介護分が掛からず、40 歳の 2026 年から掛かる', () => {
    const results = runYears(input, 2025, 2026)

    // 会社の社会保険：標準報酬月額 44 万。介護保険 3,564 × 12 = 42,768 が 2026 年から乗る
    const employee2025 = memberOf(at(results, 2025), 'a1').taxYear.socialInsurance.employee
    const employee2026 = memberOf(at(results, 2026), 'a1').taxYear.socialInsurance.employee
    expect(employee2025?.longTermCare).toBe(0)
    expect(employee2025?.total).toBe(778080)
    expect(employee2026?.longTermCare).toBe(42768)
    expect(employee2026?.total).toBe(820848)

    // 国保：2026 年度の料率。介護分（51,264 + 15,828）は 2026 年から
    const nhi2025 = at(results, 2025).nationalHealthInsurance?.result
    const nhi2026 = at(results, 2026).nationalHealthInsurance?.result
    expect(nhi2025?.segments.longTermCare.premium).toBe(0)
    expect(nhi2025?.total).toBe(280533)
    expect(nhi2026?.segments.longTermCare.premium).toBe(67092)
    expect(nhi2026?.total).toBe(347625)

    // 国民年金は表の最初の年度（2026）の月額 17,920 × 12
    expect(memberOf(at(results, 2025), 'a2').taxYear.socialInsurance.nationalPension).toBe(215040)
  })

  it('所得税は表の最初の年度に寄せず、実際の年（2025 年分）の表で計算する', () => {
    // 給与 540 万 → 給与所得 388 万。社保 778,080（上のテスト）。配偶者は合計所得 235 万で控除の対象外、子なし。
    // 2025 年分：基礎控除 68 万 → 課税所得 2,421,000 → 144,600 × 1.021 = 147,637
    // （2026 年分の表なら基礎控除 104 万 → 110,881。寄せるのは年分の表を持たない社会保険・国保・国民年金だけ）
    const results = runYears(input, 2025, 2026)
    const a1 = memberOf(at(results, 2025), 'a1').taxYear

    expect(a1.income.totalIncome).toBe(3880000)
    expect(a1.incomeTax.tax).toBe(147637)
  })
})

describe('householdTaxYear：契約違反', () => {
  const input = makeMinimalInput()

  it('持ち回りの年が前年でなければ例外', () => {
    const first = householdTaxYear(input, householdIncome(input, 2026), null, masterTables)

    // 2026 年の持ち回りを 2028 年・2026 年に渡す
    expect(() =>
      householdTaxYear(input, householdIncome(input, 2028), first.carry, masterTables),
    ).toThrow(RangeError)
    expect(() =>
      householdTaxYear(input, householdIncome(input, 2026), first.carry, masterTables),
    ).toThrow(RangeError)
    // 前年のものなら通る
    expect(() =>
      householdTaxYear(input, householdIncome(input, 2027), first.carry, masterTables),
    ).not.toThrow()
  })

  it('扶養に入る大人が世帯にいない id なら例外', () => {
    const broken = makeMinimalInput({
      insurance: { dependentAdultIds: ['nobody'], nationalHealthInsuranceHouseholderId: null },
    })

    expect(() =>
      householdTaxYear(broken, householdIncome(broken, 2026), null, masterTables),
    ).toThrow(RangeError)
  })

  it('国保の世帯主が世帯にいない id なら例外', () => {
    const broken = makeMinimalInput({
      insurance: { dependentAdultIds: [], nationalHealthInsuranceHouseholderId: 'nobody' },
    })

    expect(() =>
      householdTaxYear(broken, householdIncome(broken, 2026), null, masterTables),
    ).toThrow(RangeError)
  })

  it('世帯収入の内訳が大人の並びと合っていなければ例外', () => {
    const couple = household({
      adults: [adult('a1', 1970, 60), adult('a2', 1972, 60)],
      incomes: [employment('a1', 6000000)],
    })
    const reversed: TaxTestInput = { ...couple, adults: [...couple.adults].reverse() }

    expect(() =>
      householdTaxYear(couple, householdIncome(reversed, 2026), null, masterTables),
    ).toThrow(RangeError)
  })
})

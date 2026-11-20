import { describe, expect, it } from 'vitest'
import { householdIncome } from '../../../src/domain/income/household'
import type {
  BusinessIncome,
  EmploymentIncome,
  IncomeSource,
  SideBusinessIncome,
} from '../../../src/domain/types'
import { makeMinimalInput, sampleInput, type TaxTestInput } from '../fixtures'

describe('householdIncome', () => {
  it('起点の年を、種類ごとの内訳に分けて集計する', () => {
    const result = householdIncome(sampleInput, 2025)

    expect(result.year).toBe(2025)
    expect(result.employmentGross).toBe(4800000)
    expect(result.employmentBonus).toBe(900000)
    // 4月開業なので9か月ぶん。(1,440,000 − 240,000) × 9 / 12
    expect(result.businessProfit).toBe(900000)
    // (76,000 × 12 × 0.9 − 161,000) × 0.5
    expect(result.realEstateProfit).toBe(329900)
    expect(result.sideBusinessProfit).toBe(0)
  })

  it('世帯員ごとに合計する（翌年の住民税・保育料の材料になる）', () => {
    const result = householdIncome(sampleInput, 2025)

    // 給与 + 賞与 + 不動産所得 + 副業。所得の種類が違っても同一人に合算される
    expect(result.grossByPerson.get('adult-1')).toBe(4800000 + 900000 + 329900)
    expect(result.grossByPerson.get('adult-2')).toBe(900000)
  })

  // フェーズ 1 の「概算手取りを種類ごとの係数で合計する」を置き換えた（2026-09-18）。
  // ここは税を引く前の額だけを扱い、手取りは `tax/household.ts` が `byPerson` から求める
  it('税の材料になる世帯員ごとの内訳（byPerson）を、大人全員ぶん adults の順で返す', () => {
    const result = householdIncome(sampleInput, 2025)

    expect(result.byPerson).toEqual([
      {
        personId: 'adult-1',
        employment: { pay: { annualGross: 4800000, annualBonus: 900000 }, bonusPaymentCount: 2 },
        businessProfit: 0,
        // 副業は雑所得で申告するので、事業の申告方式は持たない
        filingType: null,
        realEstateProfit: 329900,
        miscellaneousProfit: 0,
      },
      {
        personId: 'adult-2',
        employment: null,
        businessProfit: 900000,
        filingType: 'blue65',
        realEstateProfit: 0,
        miscellaneousProfit: 0,
      },
    ])
  })

  it('昇進した年は給与が置き換わる', () => {
    const result = householdIncome(sampleInput, 2028)

    expect(result.employmentGross).toBe(6600000)
    expect(result.employmentBonus).toBe(1300000)
    // 事業は開業から3年ぶん成長：1,440,000 × 1.1^3 − 240,000
    expect(result.businessProfit).toBe(1676640)
  })

  it('退職の翌年は給与が消え、不動産所得だけが残る', () => {
    // adult-1 は 1985年生・退職年齢70 → 2055年まで就労
    const beforeRetirement = householdIncome(sampleInput, 2055)
    const afterRetirement = householdIncome(sampleInput, 2056)

    expect(beforeRetirement.employmentGross).toBeGreaterThan(0)
    expect(afterRetirement.employmentGross).toBe(0)
    expect(afterRetirement.employmentBonus).toBe(0)
    // 賃貸収入は退職しても続く
    expect(afterRetirement.realEstateProfit).toBe(329900)
    expect(afterRetirement.grossByPerson.get('adult-1')).toBe(329900)
  })

  it('未登録の世帯員を指す収入があれば例外を投げる', () => {
    const broken: TaxTestInput = {
      ...sampleInput,
      incomes: [
        {
          kind: 'sideBusiness',
          personId: 'adult-99',
          annualRevenue: 100000,
          annualExpenses: 0,
          taxCategory: 'miscellaneous',
          filingType: 'white',
        },
      ],
    }
    expect(() => householdIncome(broken, 2025)).toThrow(RangeError)
  })

  it('未登録の物件を指す不動産収入があれば例外を投げる', () => {
    const broken: TaxTestInput = {
      ...sampleInput,
      investmentProperties: [],
    }
    expect(() => householdIncome(broken, 2025)).toThrow(RangeError)
  })
})

describe('householdIncome の byPerson（税・社会保険の材料）', () => {
  /** 大人 2 人・収入なしの土台。テストごとに `incomes` だけを差し替える */
  function withIncomes(
    incomes: readonly IncomeSource[],
    overrides: Partial<TaxTestInput> = {},
  ): TaxTestInput {
    return makeMinimalInput({
      adults: [
        { id: 'a1', birthYear: 1980, retirementAge: 60, lifeExpectancy: 90 },
        { id: 'a2', birthYear: 1985, retirementAge: 60, lifeExpectancy: 90 },
      ],
      incomes,
      retirement: { byPerson: [] },
      ...overrides,
    })
  }

  const employment: EmploymentIncome = {
    kind: 'employment',
    personId: 'a1',
    annualGross: 4000000,
    annualBonus: 600000,
    baseRaiseRate: 0,
    bonusPaymentCount: 3,
  }
  const business: BusinessIncome = {
    kind: 'business',
    personId: 'a2',
    startYear: 2020,
    startMonth: 1,
    annualRevenue: 3000000,
    annualExpenses: 500000,
    revenueGrowthRate: 0,
    revenueCeiling: null,
    filingType: 'blue65',
  }
  const sideBusiness: SideBusinessIncome = {
    kind: 'sideBusiness',
    personId: 'a1',
    annualRevenue: 500000,
    annualExpenses: 100000,
    taxCategory: 'miscellaneous',
    filingType: 'blue10',
  }

  it('収入の無い大人も含めて、大人全員ぶんを adults の順で返す（収入源の並び順に依らない）', () => {
    // a2 の収入源を先に書いても、結果は adults の順（a1 → a2）
    const both = householdIncome(withIncomes([business, employment]), 2026)
    expect(both.byPerson.map((person) => person.personId)).toEqual(['a1', 'a2'])

    const onlyFirst = householdIncome(withIncomes([employment]), 2026)
    expect(onlyFirst.byPerson[1]).toEqual({
      personId: 'a2',
      employment: null,
      businessProfit: 0,
      filingType: null,
      realEstateProfit: 0,
      miscellaneousProfit: 0,
    })
  })

  it('給与は額面と賞与の支給回数を持つ。退職の翌年は employment が null になる', () => {
    const input = withIncomes([employment])

    // a1 は 1980 年生・60 歳まで就労 → 2040 年が最後
    expect(householdIncome(input, 2040).byPerson[0]?.employment).toEqual({
      pay: { annualGross: 4000000, annualBonus: 600000 },
      bonusPaymentCount: 3,
    })
    expect(householdIncome(input, 2041).byPerson[0]?.employment).toBeNull()
  })

  it('副業は申告の区分で行き先が変わる：雑所得なら miscellaneousProfit、事業なら businessProfit', () => {
    const asMiscellaneous = householdIncome(withIncomes([employment, sideBusiness]), 2026)
    expect(asMiscellaneous.byPerson[0]).toMatchObject({
      businessProfit: 0,
      miscellaneousProfit: 400000,
      // 雑所得で申告するなら、副業の申告方式（青色 10 万）は使われない
      filingType: null,
    })

    const asBusiness = householdIncome(
      withIncomes([employment, { ...sideBusiness, taxCategory: 'business' }]),
      2026,
    )
    expect(asBusiness.byPerson[0]).toMatchObject({
      businessProfit: 400000,
      miscellaneousProfit: 0,
      // 本業の事業が無ければ、事業として申告する副業の方式
      filingType: 'blue10',
    })
    // 世帯の合計では、どちらの区分でも副業として数える（本業の事業所得には混ぜない）
    expect(asBusiness.sideBusinessProfit).toBe(400000)
    expect(asBusiness.businessProfit).toBe(0)
  })

  it('事業の申告方式は本業を優先する（副業を先に書いても、本業の方式になる）', () => {
    const sideAsBusiness: SideBusinessIncome = {
      ...sideBusiness,
      personId: 'a2',
      taxCategory: 'business',
      filingType: 'white',
    }
    const result = householdIncome(withIncomes([sideAsBusiness, business]), 2026)

    expect(result.byPerson[1]).toMatchObject({
      // 本業 250万 + 事業として申告する副業 40万
      businessProfit: 2500000 + 400000,
      filingType: 'blue65',
      miscellaneousProfit: 0,
    })
  })

  it('事業の収入源が無い人の申告方式は null（給与だけ・雑所得の副業だけ）', () => {
    const result = householdIncome(
      withIncomes([employment, { ...sideBusiness, personId: 'a2' }]),
      2026,
    )

    expect(result.byPerson.map((person) => person.filingType)).toEqual([null, null])
  })

  it('スケジュールの副業は、その人の副業の区分に従う。副業の入力が無い人は雑所得', () => {
    const schedule = (personId: string): TaxTestInput['sideBusinessSchedule'] => ({
      personId,
      periods: [{ fromYear: 2026, toYear: 2030, annualProfit: 700000 }],
    })

    // a1 の副業は「事業」で申告する入力 → スケジュールの額は事業所得に入り、入力の見込み額（40万）は使わない
    const followsBusiness = householdIncome(
      withIncomes([employment, { ...sideBusiness, taxCategory: 'business' }], {
        sideBusinessSchedule: schedule('a1'),
      }),
      2026,
    )
    expect(followsBusiness.byPerson[0]).toMatchObject({
      businessProfit: 700000,
      miscellaneousProfit: 0,
      filingType: 'blue10',
    })

    // a2 には副業の入力が無い → 雑所得。本業の事業所得（250万）には混ぜない
    const defaultsToMiscellaneous = householdIncome(
      withIncomes([employment, business], { sideBusinessSchedule: schedule('a2') }),
      2026,
    )
    expect(defaultsToMiscellaneous.byPerson[1]).toMatchObject({
      businessProfit: 2500000,
      miscellaneousProfit: 700000,
      filingType: 'blue65',
    })
  })

  it('byPerson の合計は、種類ごとの世帯合計と一致する', () => {
    const result = householdIncome(
      withIncomes([employment, business, { ...sideBusiness, taxCategory: 'business' }]),
      2026,
    )
    const total = result.byPerson.reduce(
      (sum, person) =>
        sum +
        (person.employment?.pay.annualGross ?? 0) +
        (person.employment?.pay.annualBonus ?? 0) +
        person.businessProfit +
        person.realEstateProfit +
        person.miscellaneousProfit,
      0,
    )

    expect(total).toBe(
      result.employmentGross +
        result.employmentBonus +
        result.businessProfit +
        result.realEstateProfit +
        result.sideBusinessProfit,
    )
  })
})

describe('householdIncome と副業スケジュール', () => {
  const withSchedule: TaxTestInput = {
    ...sampleInput,
    sideBusinessSchedule: {
      personId: 'adult-1',
      periods: [{ fromYear: 2025, toYear: 2030, annualProfit: 1200000 }],
    },
  }

  it('スケジュールがあれば入力の副業を使わず、その額に置き換える', () => {
    const result = householdIncome(withSchedule, 2025)

    expect(result.sideBusinessProfit).toBe(1200000)
    expect(result.grossByPerson.get('adult-1')).toBe(4800000 + 900000 + 329900 + 1200000)
    // 税の材料（byPerson）にも入る。adult-1 の副業は雑所得で申告する入力なので、スケジュールの額も雑所得に入る
    expect(result.byPerson[0]?.miscellaneousProfit).toBe(1200000)
    expect(result.byPerson[0]?.businessProfit).toBe(0)
  })

  it('本業の内訳（primaryByPerson）は副業を含まず、種類ごとの内訳の和と一致する', () => {
    const result = householdIncome(withSchedule, 2025)

    // 給与 + 賞与 + 不動産所得。スケジュールの副業 120万 は入らない。種類ごとに分かれている
    expect(result.primaryByPerson.get('adult-1')).toEqual({
      personId: 'adult-1',
      employment: 4800000 + 900000,
      business: 0,
      realEstate: 329900,
      amount: 4800000 + 900000 + 329900,
    })
    expect(result.primaryByPerson.get('adult-2')).toEqual({
      personId: 'adult-2',
      employment: 0,
      business: 900000,
      realEstate: 0,
      amount: 900000,
    })
    const sum = [...result.primaryByPerson.values()].reduce((total, item) => total + item.amount, 0)
    expect(sum).toBe(
      result.employmentGross +
        result.employmentBonus +
        result.businessProfit +
        result.realEstateProfit,
    )
  })

  it('スケジュールの期間外の年は副業 0（入力の見込み額にも戻らない）', () => {
    const withSchedule2031 = householdIncome(withSchedule, 2031)
    expect(withSchedule2031.sideBusinessProfit).toBe(0)
  })

  it('スケジュールが未登録の世帯員を指していれば例外を投げる', () => {
    const broken: TaxTestInput = {
      ...sampleInput,
      sideBusinessSchedule: {
        personId: 'adult-99',
        periods: [{ fromYear: 2025, toYear: 2030, annualProfit: 1200000 }],
      },
    }
    expect(() => householdIncome(broken, 2025)).toThrow(RangeError)
  })
})

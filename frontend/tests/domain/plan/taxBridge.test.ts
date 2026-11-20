import { describe, expect, it } from 'vitest'
import {
  expectedLevels,
  expectedMainIncome,
  householdGross,
  householdTaxIncome,
  householdTaxInput,
  isRetiredIn,
} from '../../../src/domain/plan/taxBridge'
import type { Goal } from '../../../src/domain/plan/types'
import { adult, defaults, makePlan } from './planFixtures'

const settings = defaults.taxBridge

describe('expectedMainIncome（見込みの本業の収入）', () => {
  it('起点の年は入れた年収。毎年の上がり方で複利に上がる', () => {
    const a = adult({ annualIncome: 4800000, raiseRate: 0.02 })
    expect(expectedMainIncome(a, 2031, 2031)).toBe(4800000)
    expect(expectedMainIncome(a, 2031, 2033)).toBe(Math.round(4800000 * 1.02 ** 2))
  })

  it('見込みの段は、その年から年収を置き換え、そこから上がり方で上がる', () => {
    const a = adult({
      raiseRate: 0.01,
      outlookSteps: [
        { year: 2034, annualIncome: 6100000 },
        { year: 2037, annualIncome: 5300000 },
      ],
    })
    expect(expectedMainIncome(a, 2031, 2033)).toBe(Math.round(4800000 * 1.01 ** 2))
    expect(expectedMainIncome(a, 2031, 2034)).toBe(6100000)
    expect(expectedMainIncome(a, 2031, 2036)).toBe(Math.round(6100000 * 1.01 ** 2))
    expect(expectedMainIncome(a, 2031, 2037)).toBe(5300000)
  })

  it('起点の年以前の見込みの段は使わない（今の年収は annualIncome が持つ）', () => {
    const a = adult({ outlookSteps: [{ year: 2031, annualIncome: 9900000 }] })
    expect(expectedMainIncome(a, 2031, 2032)).toBe(4800000)
  })

  it('働いていない大人・退職の年からは 0', () => {
    expect(expectedMainIncome(adult({ workStyle: 'notWorking' }), 2031, 2031)).toBe(0)
    // 1979 年生まれ・65 歳 → 2044 年に退職
    const a = adult()
    expect(isRetiredIn(a, 2043)).toBe(false)
    expect(isRetiredIn(a, 2044)).toBe(true)
    expect(expectedMainIncome(a, 2031, 2043)).toBe(4800000)
    expect(expectedMainIncome(a, 2031, 2044)).toBe(0)
  })

  it('年収が負、上がり方が -100% 以下、見込みの年が小数なら契約違反', () => {
    expect(() => expectedMainIncome(adult({ annualIncome: -1 }), 2031, 2031)).toThrow(RangeError)
    expect(() => expectedMainIncome(adult({ raiseRate: -1 }), 2031, 2031)).toThrow(RangeError)
    expect(() =>
      expectedMainIncome(adult({ outlookSteps: [{ year: 2032.5, annualIncome: 1 }] }), 2031, 2031),
    ).toThrow(RangeError)
  })
})

describe('expectedLevels・householdGross', () => {
  it('世帯年収は本業 ＋ 副業の所得の年額（自営業は所得のまま足す）', () => {
    const plan = makePlan({
      adults: [
        adult({ sideMonthlyProfit: 23000 }),
        adult({ id: 'adult-2', workStyle: 'selfEmployed', annualIncome: 2700000 }),
      ],
    })
    const levels = expectedLevels(plan, 2031)
    expect(levels.get('adult-1')).toEqual({ main: 4800000, sideMonthly: 23000 })
    expect(householdGross(levels)).toBe(4800000 + 23000 * 12 + 2700000)
  })

  it('退職した年からは副業も 0', () => {
    const plan = makePlan({ adults: [adult({ sideMonthlyProfit: 23000 })] })
    expect(expectedLevels(plan, 2044).get('adult-1')).toEqual({ main: 0, sideMonthly: 0 })
  })
})

describe('householdTaxInput', () => {
  it('働いていない大人を扶養に、寿命は既定値と退職の年齢の大きい方、自治体は 1 つ、年金は空', () => {
    const plan = makePlan({
      adults: [
        adult({ retirementAge: 105 }),
        adult({ id: 'adult-2', birthYear: 1981, workStyle: 'notWorking', annualIncome: 0 }),
      ],
    })
    const input = householdTaxInput(plan, settings)
    expect(input.baseYear).toBe(2031)
    expect(input.insurance).toEqual({
      dependentAdultIds: ['adult-2'],
      nationalHealthInsuranceHouseholderId: null,
    })
    expect(input.adults.map((a) => a.lifeExpectancy)).toEqual([105, settings.lifeExpectancy.value])
    expect(input.residence).toEqual([
      { fromYear: 2031, municipality: '99001', monthlyRent: null, moveInCost: 0 },
    ])
    expect(input.retirement.byPerson).toEqual([])
  })

  it('子：大学資金のカードがオンなら大学へ行く、無い・オフなら行かない。進路と塾は子の費用のカードから', () => {
    const goals: Goal[] = [
      {
        id: 'u1',
        enabled: true,
        kind: 'university',
        childId: 'c1',
        saved: 0,
        targetAmount: 1,
        allocateChildAllowance: true,
        vehicle: 'deposit',
      },
      {
        id: 'u2',
        enabled: false,
        kind: 'university',
        childId: 'c2',
        saved: 0,
        targetAmount: 1,
        allocateChildAllowance: true,
        vehicle: 'deposit',
      },
      {
        id: 'cost1',
        enabled: true,
        kind: 'childCost',
        childId: 'c1',
        schools: { elementary: 'public', juniorHigh: 'private', highSchool: 'private' },
        cramSchools: [{ fromGrade: 4, toGrade: 6, monthly: 31000 }],
        lessonsMonthly: null,
        childcareMonthly: null,
      },
    ]
    const plan = makePlan({
      children: [
        { id: 'c1', birthYear: 2043, birthMonth: 5 },
        { id: 'c2', birthYear: 2045, birthMonth: 9 },
        { id: 'c3', birthYear: 2047, birthMonth: 2 },
      ],
      goals,
    })
    const [c1, c2, c3] = householdTaxInput(plan, settings).children
    // 大学資金のカードが無い子も行かない
    expect(c3).toMatchObject({ universityType: 'none' })
    expect(c1).toMatchObject({
      universityType: 'privateHumanities',
      juniorHighType: 'private',
      highSchoolType: 'private',
      cramSchoolPeriods: [{ fromGrade: 4, toGrade: 6, monthlyFee: 31000 }],
    })
    expect(c2).toMatchObject({
      universityType: 'none',
      elementarySchoolType: 'public',
      cramSchoolPeriods: [],
    })
  })

  it('寿命の既定値が正の整数でなければ契約違反', () => {
    const bad = { ...settings, lifeExpectancy: { value: 0, basis: '' } }
    expect(() => householdTaxInput(makePlan(), bad)).toThrow(RangeError)
  })
})

describe('householdTaxIncome', () => {
  const plan = makePlan({
    adults: [
      adult(),
      adult({ id: 'adult-2', workStyle: 'selfEmployed' }),
      // 大人は 1〜2 人の契約だが、ここでは人ごとの写し方だけを見る
      adult({ id: 'adult-3', workStyle: 'notWorking' }),
    ],
  })
  const levels = new Map([
    ['adult-1', { main: 4800000, sideMonthly: 0 }],
    ['adult-2', { main: 2700000, sideMonthly: 15000 }],
    ['adult-3', { main: 0, sideMonthly: 8000 }],
  ])

  it('会社員は給与、自営業は事業所得と既定の申告方式、副業は雑所得の年額', () => {
    const income = householdTaxIncome(plan, 2032, levels, settings)
    expect(income.year).toBe(2032)
    expect(income.byPerson).toEqual([
      {
        personId: 'adult-1',
        employment: {
          pay: { annualGross: 4800000, annualBonus: 0 },
          bonusPaymentCount: settings.bonusPaymentCount.value,
        },
        businessProfit: 0,
        filingType: null,
        realEstateProfit: 0,
        miscellaneousProfit: 0,
      },
      {
        personId: 'adult-2',
        employment: null,
        businessProfit: 2700000,
        filingType: settings.selfEmployedFilingType.value,
        realEstateProfit: 0,
        miscellaneousProfit: 180000,
      },
      {
        personId: 'adult-3',
        employment: null,
        businessProfit: 0,
        filingType: null,
        realEstateProfit: 0,
        miscellaneousProfit: 96000,
      },
    ])
  })

  it('賞与の割合を入れると、賞与を円に丸めて残りを月給ぶんにする（合計がずれない）', () => {
    const withBonus = { ...settings, bonusShare: { value: 0.23, basis: '' } }
    const [first] = householdTaxIncome(plan, 2032, levels, withBonus).byPerson
    expect(first?.employment?.pay).toEqual({ annualGross: 3696000, annualBonus: 1104000 })
  })

  it('会社員の本業が 0 の年は給与なし（会社の社会保険に入らない）', () => {
    const zero = new Map(levels).set('adult-1', { main: 0, sideMonthly: 0 })
    expect(householdTaxIncome(plan, 2032, zero, settings).byPerson[0]?.employment).toBeNull()
  })

  it('大人が欠けている、金額が負、既定値が選択肢に無いなら契約違反', () => {
    const missing = new Map([...levels].slice(0, 2))
    expect(() => householdTaxIncome(plan, 2032, missing, settings)).toThrow(/adult-3/)
    const negative = new Map(levels).set('adult-1', { main: -1, sideMonthly: 0 })
    expect(() => householdTaxIncome(plan, 2032, negative, settings)).toThrow(RangeError)
    const badFiling = { ...settings, selfEmployedFilingType: { value: 'blue', basis: '' } }
    expect(() => householdTaxIncome(plan, 2032, levels, badFiling)).toThrow(/申告方式/)
    const badShare = { ...settings, bonusShare: { value: 1.5, basis: '' } }
    expect(() => householdTaxIncome(plan, 2032, levels, badShare)).toThrow(/賞与/)
  })
})

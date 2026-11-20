import { describe, expect, it } from 'vitest'
import {
  annuityFactor,
  buildSavingsSchedule,
  solveHouseholdContribution,
} from '../../../src/domain/goal/savings'
import type { SavingsTerms } from '../../../src/domain/goal/savings'

/** 2026〜2028 の3年で 300万 を貯める（利回り 0） */
const threeYears: SavingsTerms = {
  amount: 3000000,
  startYear: 2026,
  householdFromYear: 2026,
  useYear: 2029,
  rate: 0,
  stages: [],
}

const noEarmark: ReadonlyMap<number, number> = new Map()

describe('annuityFactor', () => {
  it('利回り 0 なら年数そのもの', () => {
    expect(annuityFactor(0, 3)).toBe(3)
    expect(annuityFactor(0, 0)).toBe(0)
  })

  it('利回りがあれば複利で積み上がる（10% × 2年 = 1 + 1.1）', () => {
    expect(annuityFactor(0.1, 2)).toBeCloseTo(2.1, 10)
    expect(annuityFactor(0.1, 0)).toBe(0)
  })

  it('年数が負・非整数、または年率が -100% 以下なら例外', () => {
    expect(() => annuityFactor(0, -1)).toThrow(RangeError)
    expect(() => annuityFactor(0, 1.5)).toThrow(RangeError)
    expect(() => annuityFactor(-1, 3)).toThrow(RangeError)
  })
})

describe('solveHouseholdContribution', () => {
  it('利回り 0 なら目標額を年数で割った額', () => {
    expect(solveHouseholdContribution(threeYears, noEarmark)).toBe(1000000)
  })

  it('割り切れなければ切り上げる（四捨五入だと使う年の前年末に届かない）', () => {
    expect(solveHouseholdContribution({ ...threeYears, amount: 1000000 }, noEarmark)).toBe(333334)
  })

  it('利回りがあれば複利ぶん少なくて済む（10% × 2年で 210万 なら年 100万）', () => {
    const terms: SavingsTerms = {
      amount: 2100000,
      startYear: 2026,
      householdFromYear: 2026,
      useYear: 2028,
      rate: 0.1,
      stages: [],
    }
    expect(solveHouseholdContribution(terms, noEarmark)).toBe(1000000)
  })

  it('児童手当から回す分を先に引く', () => {
    const earmarked = new Map([
      [2026, 500000],
      [2027, 500000],
    ])
    // 300万 − 100万 = 200万 を3年で
    expect(solveHouseholdContribution(threeYears, earmarked)).toBe(666667)
  })

  it('児童手当だけで目標額に届くなら 0', () => {
    const earmarked = new Map([
      [2026, 1500000],
      [2027, 1500000],
    ])
    expect(solveHouseholdContribution(threeYears, earmarked)).toBe(0)
  })

  it('家計からの積立の開始年が積立線の開始より後なら、その年からの年数で割る', () => {
    // 2027〜2028 の2年で 300万
    expect(solveHouseholdContribution({ ...threeYears, householdFromYear: 2027 }, noEarmark)).toBe(
      1500000,
    )
  })

  it('家計からは積み立てない（null）なら 0', () => {
    expect(solveHouseholdContribution({ ...threeYears, householdFromYear: null }, noEarmark)).toBe(
      0,
    )
  })

  it('目標額 0 なら 0', () => {
    expect(solveHouseholdContribution({ ...threeYears, amount: 0 }, noEarmark)).toBe(0)
  })
})

describe('buildSavingsSchedule', () => {
  it('利回り 0 なら毎年一定額ずつ積み上がり、最後の年に目標額になる', () => {
    expect(buildSavingsSchedule(threeYears, 1000000, noEarmark)).toEqual([
      { year: 2026, contribution: 1000000, earmarked: 0, required: 1000000 },
      { year: 2027, contribution: 1000000, earmarked: 0, required: 2000000 },
      { year: 2028, contribution: 1000000, earmarked: 0, required: 3000000 },
    ])
  })

  it('利回りがあれば前年末の残高に掛けてから積む（順方向シミュレーションと同じ順序）', () => {
    const terms: SavingsTerms = {
      amount: 2100000,
      startYear: 2026,
      householdFromYear: 2026,
      useYear: 2028,
      rate: 0.1,
      stages: [],
    }
    expect(buildSavingsSchedule(terms, 1000000, noEarmark)).toEqual([
      { year: 2026, contribution: 1000000, earmarked: 0, required: 1000000 },
      { year: 2027, contribution: 1000000, earmarked: 0, required: 2100000 },
    ])
  })

  it('目標額を上限にする（切り上げの端数や児童手当の超過分を線に出さない）', () => {
    const schedule = buildSavingsSchedule({ ...threeYears, amount: 1000000 }, 333334, noEarmark)
    expect(schedule.map((entry) => entry.required)).toEqual([333334, 666668, 1000000])
  })

  it('児童手当だけの期間は家計の積立が 0 で、手当のぶんだけ線が上がる', () => {
    const earmarked = new Map([
      [2026, 600000],
      [2027, 600000],
      [2028, 600000],
    ])
    const schedule = buildSavingsSchedule(
      { ...threeYears, amount: 1000000, householdFromYear: null },
      0,
      earmarked,
    )
    expect(schedule).toEqual([
      { year: 2026, contribution: 0, earmarked: 600000, required: 600000 },
      { year: 2027, contribution: 0, earmarked: 600000, required: 1000000 },
      { year: 2028, contribution: 0, earmarked: 600000, required: 1000000 },
    ])
  })

  it('家計からの積立は開始年より前の年には乗らない', () => {
    const schedule = buildSavingsSchedule(
      { ...threeYears, householdFromYear: 2027 },
      1500000,
      noEarmark,
    )
    expect(schedule.map((entry) => entry.contribution)).toEqual([0, 1500000, 1500000])
    expect(schedule.map((entry) => entry.required)).toEqual([0, 1500000, 3000000])
  })

  it('開始年が使う年以降なら例外', () => {
    expect(() =>
      buildSavingsSchedule(
        { ...threeYears, startYear: 2029, householdFromYear: 2029 },
        0,
        noEarmark,
      ),
    ).toThrow(RangeError)
  })

  it('家計の開始年が積立の期間外なら例外', () => {
    expect(() =>
      buildSavingsSchedule({ ...threeYears, householdFromYear: 2025 }, 0, noEarmark),
    ).toThrow(RangeError)
    expect(() =>
      buildSavingsSchedule({ ...threeYears, householdFromYear: 2029 }, 0, noEarmark),
    ).toThrow(RangeError)
  })

  it('積立額や児童手当の額が負なら例外', () => {
    expect(() => buildSavingsSchedule(threeYears, -1, noEarmark)).toThrow(RangeError)
    expect(() => buildSavingsSchedule(threeYears, 0, new Map([[2026, -1]]))).toThrow(RangeError)
  })

  it('目標額が負なら例外', () => {
    expect(() => buildSavingsSchedule({ ...threeYears, amount: -1 }, 0, noEarmark)).toThrow(
      RangeError,
    )
  })
})

describe('段階積立（D29 案 1）', () => {
  /** 2026〜2029 の 4 年で 400万（利回り 0）。2026 は月 5万（年 60万）に抑える */
  const staged: SavingsTerms = {
    amount: 4000000,
    startYear: 2026,
    householdFromYear: 2026,
    useYear: 2030,
    rate: 0,
    stages: [{ untilYear: 2026, annualAmount: 600000 }],
  }

  it('段階の額を目標額から引き、残りの年数で割る（400万 − 60万 = 340万 を 3 年で）', () => {
    expect(solveHouseholdContribution(staged, noEarmark)).toBe(1133334)
  })

  it('積立線は段階の年はその額、残りの年は解いた額で積む', () => {
    const schedule = buildSavingsSchedule(staged, 1133334, noEarmark)
    expect(schedule.map((entry) => entry.contribution)).toEqual([600000, 1133334, 1133334, 1133334])
    expect(schedule.map((entry) => entry.required)).toEqual([600000, 1733334, 2866668, 4000000])
  })

  it('段階が 2 つなら前の段階の翌年から次の段階の年までがその額（2026 は 60万、2027 は 120万）', () => {
    const terms: SavingsTerms = {
      ...staged,
      stages: [
        { untilYear: 2026, annualAmount: 600000 },
        { untilYear: 2027, annualAmount: 1200000 },
      ],
    }
    // 400万 − 60万 − 120万 = 220万 を 2028〜2029 の 2 年で
    expect(solveHouseholdContribution(terms, noEarmark)).toBe(1100000)
    expect(
      buildSavingsSchedule(terms, 1100000, noEarmark).map((entry) => entry.contribution),
    ).toEqual([600000, 1200000, 1100000, 1100000])
  })

  it('利回りがあれば段階の額も将来価値に直して引く（10%：2026 の 100万は 2027 末に 110万）', () => {
    const terms: SavingsTerms = {
      amount: 2100000,
      startYear: 2026,
      householdFromYear: 2026,
      useYear: 2028,
      rate: 0.1,
      stages: [{ untilYear: 2026, annualAmount: 1000000 }],
    }
    // 210万 − 110万 = 100万 を 2027 の 1 年で
    expect(solveHouseholdContribution(terms, noEarmark)).toBe(1000000)
  })

  it('段階の年より前に家計の開始年が来る大学資金でも、段階は家計の開始年から数える', () => {
    const terms: SavingsTerms = {
      amount: 3000000,
      startYear: 2026,
      householdFromYear: 2027,
      useYear: 2030,
      rate: 0,
      stages: [{ untilYear: 2027, annualAmount: 500000 }],
    }
    const earmarked = new Map([[2026, 200000]])
    // 300万 − 20万（児童手当） − 50万（2027） = 230万 を 2028〜2029 の 2 年で
    expect(solveHouseholdContribution(terms, earmarked)).toBe(1150000)
    expect(
      buildSavingsSchedule(terms, 1150000, earmarked).map((entry) => entry.contribution),
    ).toEqual([0, 500000, 1150000, 1150000])
  })

  it('段階の額だけで目標額を超えるなら理由つきの例外（順方向は段階の額をそのまま積むので超過が副業に乗る）', () => {
    const terms: SavingsTerms = { ...staged, stages: [{ untilYear: 2027, annualAmount: 3000000 }] }
    expect(() => solveHouseholdContribution(terms, noEarmark)).toThrow(/目標額を超えています/)
    // ちょうど目標額なら通り、残りは 0
    const exact: SavingsTerms = { ...staged, stages: [{ untilYear: 2027, annualAmount: 2000000 }] }
    expect(solveHouseholdContribution(exact, noEarmark)).toBe(0)
  })

  it('児童手当だけで目標額を超える場合は従来どおり 0（手当の額は利用者が決められない）', () => {
    const terms: SavingsTerms = { ...staged, stages: [] }
    const earmarked = new Map([[2026, 5000000]])
    expect(solveHouseholdContribution(terms, earmarked)).toBe(0)
  })

  it('児童手当だけで届く目標に段階を置くと、段階ではなく児童手当が理由だと分かる文言で断る', () => {
    const earmarked = new Map([[2026, 5000000]])
    expect(() => solveHouseholdContribution(staged, earmarked)).toThrow(
      /児童手当だけで目標額に届く/,
    )
  })

  it('家計から積み立てない目標に段階があれば例外', () => {
    expect(() =>
      solveHouseholdContribution({ ...staged, householdFromYear: null }, noEarmark),
    ).toThrow(RangeError)
  })

  it('段階の年が家計の開始年より前、または使う年の前年以降なら例外（残りを解く年を 1 年は残す）', () => {
    expect(() =>
      solveHouseholdContribution(
        { ...staged, stages: [{ untilYear: 2025, annualAmount: 1 }] },
        noEarmark,
      ),
    ).toThrow(RangeError)
    expect(() =>
      solveHouseholdContribution(
        { ...staged, stages: [{ untilYear: 2029, annualAmount: 1 }] },
        noEarmark,
      ),
    ).toThrow(RangeError)
    // 2028 まで（使う年の 2 年前）は通る
    expect(() =>
      solveHouseholdContribution(
        { ...staged, stages: [{ untilYear: 2028, annualAmount: 1 }] },
        noEarmark,
      ),
    ).not.toThrow()
  })

  it('段階の年が昇順でない・同じ年が重なる・額が負なら例外', () => {
    expect(() =>
      solveHouseholdContribution(
        {
          ...staged,
          stages: [
            { untilYear: 2027, annualAmount: 1 },
            { untilYear: 2026, annualAmount: 1 },
          ],
        },
        noEarmark,
      ),
    ).toThrow(RangeError)
    expect(() =>
      solveHouseholdContribution(
        {
          ...staged,
          stages: [
            { untilYear: 2026, annualAmount: 1 },
            { untilYear: 2026, annualAmount: 2 },
          ],
        },
        noEarmark,
      ),
    ).toThrow(RangeError)
    expect(() =>
      solveHouseholdContribution(
        { ...staged, stages: [{ untilYear: 2026, annualAmount: -1 }] },
        noEarmark,
      ),
    ).toThrow(RangeError)
  })
})

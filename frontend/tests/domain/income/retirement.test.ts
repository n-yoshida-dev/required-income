import { describe, expect, it } from 'vitest'
import {
  householdRetirementIncomeInYear,
  pensionInYear,
  severancePayInYear,
} from '../../../src/domain/income/retirement'
import type { PensionIndexation } from '../../../src/domain/income/retirement'
import type { Person, PersonRetirement } from '../../../src/domain/types'

/**
 * 架空の世帯員。生年も架空の値にする（`.claude/rules/dummy-values.md`）。
 *
 * - 1980年生・70歳まで就労（最終就労年 2050）・95歳想定（2075年まで）
 * - 年金は 65歳開始（2045年から）
 */
const person: Person = { id: 'a1', birthYear: 1980, retirementAge: 70, lifeExpectancy: 95 }

const retirement: PersonRetirement = {
  personId: 'a1',
  severancePay: 10000000,
  severanceYear: null,
  pensionStartAge: 65,
  annualPension: 1720000,
}

/** 改定なし（名目固定）。既存の期待値をそのまま使うため */
const NO_INDEX: PensionIndexation = { rate: 0, baseYear: 2026 }

describe('pensionInYear', () => {
  it('受給開始年齢に達した年から年金額を受け取る', () => {
    expect(pensionInYear(person, retirement, 2044, NO_INDEX)).toBe(0)
    expect(pensionInYear(person, retirement, 2045, NO_INDEX)).toBe(1720000)
    expect(pensionInYear(person, retirement, 2046, NO_INDEX)).toBe(1720000)
  })

  it('寿命想定の年まで受け取り、その翌年から 0 になる', () => {
    expect(pensionInYear(person, retirement, 2075, NO_INDEX)).toBe(1720000)
    expect(pensionInYear(person, retirement, 2076, NO_INDEX)).toBe(0)
  })

  it('繰下げ受給は開始年齢を上げるだけで表せる', () => {
    const deferred: PersonRetirement = { ...retirement, pensionStartAge: 70 }

    expect(pensionInYear(person, deferred, 2049, NO_INDEX)).toBe(0)
    expect(pensionInYear(person, deferred, 2050, NO_INDEX)).toBe(1720000)
  })

  it('改定率があれば起点年からの経過年数で複利に伸ばす（受給前の年も数える）', () => {
    const indexed: PensionIndexation = { rate: 0.02, baseYear: 2026 }
    // 2045 年は起点から 19 年。172万 × 1.02^19 = 2,505,xxx
    expect(pensionInYear(person, retirement, 2045, indexed)).toBe(
      Math.round(1720000 * Math.pow(1.02, 19)),
    )
    // 受給前は 0 のまま
    expect(pensionInYear(person, retirement, 2044, indexed)).toBe(0)
  })

  it('改定率が −100% 以下や有限でなければ例外', () => {
    expect(() => pensionInYear(person, retirement, 2045, { rate: -1, baseYear: 2026 })).toThrow(
      RangeError,
    )
    expect(() => pensionInYear(person, retirement, 2045, { rate: NaN, baseYear: 2026 })).toThrow(
      RangeError,
    )
  })

  it('年金額が負なら例外', () => {
    const broken: PersonRetirement = { ...retirement, annualPension: -1 }

    expect(() => pensionInYear(person, broken, 2045, NO_INDEX)).toThrow(RangeError)
  })
})

describe('severancePayInYear', () => {
  it('受取年が null なら就労を終える年（birthYear + retirementAge）に受け取る', () => {
    expect(severancePayInYear(person, retirement, 2049)).toBe(0)
    expect(severancePayInYear(person, retirement, 2050)).toBe(10000000)
    expect(severancePayInYear(person, retirement, 2051)).toBe(0)
  })

  it('受取年を指定したらその年に受け取る', () => {
    const early: PersonRetirement = { ...retirement, severanceYear: 2040 }

    expect(severancePayInYear(person, early, 2040)).toBe(10000000)
    expect(severancePayInYear(person, early, 2050)).toBe(0)
  })

  it('退職金 0 の人（個人事業主など）はどの年も 0', () => {
    const none: PersonRetirement = { ...retirement, severancePay: 0 }

    expect(severancePayInYear(person, none, 2050)).toBe(0)
  })
})

describe('householdRetirementIncomeInYear', () => {
  // 2人目は 1985年生・65歳まで就労・85歳想定（2070年まで）。年金は 70歳開始（2055年から）で
  // 退職金なし。「片方だけ受給している数年間」（決定 D10）を作るための組み合わせ
  const second: Person = { id: 'a2', birthYear: 1985, retirementAge: 65, lifeExpectancy: 85 }
  const secondRetirement: PersonRetirement = {
    personId: 'a2',
    severancePay: 0,
    severanceYear: null,
    pensionStartAge: 70,
    annualPension: 900000,
  }
  const adults = [person, second]
  const byPerson = [retirement, secondRetirement]

  it('片方だけ受給している期間は、その人の年金だけが乗る', () => {
    // 2045〜2054 は a1 のみ。2055 から2人ぶんになる
    expect(householdRetirementIncomeInYear(adults, byPerson, 2050, NO_INDEX).pension).toBe(1720000)
    expect(householdRetirementIncomeInYear(adults, byPerson, 2055, NO_INDEX).pension).toBe(2620000)
  })

  it('先に寿命を迎えた人の年金は、その翌年から世帯合計に含めない', () => {
    // a2 の寿命想定は 2070年まで。2071 からは a1 の年金だけが残る
    expect(householdRetirementIncomeInYear(adults, byPerson, 2070, NO_INDEX).pension).toBe(2620000)
    expect(householdRetirementIncomeInYear(adults, byPerson, 2071, NO_INDEX).pension).toBe(1720000)
  })

  it('退職金は受け取る年だけ乗る', () => {
    expect(householdRetirementIncomeInYear(adults, byPerson, 2050, NO_INDEX).severancePay).toBe(
      10000000,
    )
    expect(householdRetirementIncomeInYear(adults, byPerson, 2051, NO_INDEX).severancePay).toBe(0)
  })

  it('設定の無い世帯員は年金も退職金も 0 として扱う', () => {
    const result = householdRetirementIncomeInYear(adults, [retirement], 2055, NO_INDEX)

    expect(result.pension).toBe(1720000)
  })

  it('存在しない世帯員を指す設定は例外', () => {
    const broken: PersonRetirement = { ...retirement, personId: 'unknown' }

    expect(() => householdRetirementIncomeInYear(adults, [broken], 2050, NO_INDEX)).toThrow(
      RangeError,
    )
  })

  it('同じ世帯員の設定が重複していたら例外', () => {
    expect(() =>
      householdRetirementIncomeInYear(adults, [retirement, retirement], 2050, NO_INDEX),
    ).toThrow(RangeError)
  })
})

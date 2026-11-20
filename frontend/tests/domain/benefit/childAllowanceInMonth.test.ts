/**
 * `childAllowanceInMonth`（ある月の児童手当を子ごとに出す。T10 で足した）のテスト。
 * 12 か月の合計が `childAllowanceInYear` の子ごとの年額と一致すること（同じ数え方）を、子の一生のすべての年で確かめる。
 * 金額は本物の制度データ（data/benefit/child-allowance.json）。子の生年月は架空。
 */

import { describe, expect, it } from 'vitest'
import {
  childAllowanceInMonth,
  childAllowanceInYear,
  lastEligibleMonth,
} from '../../../src/domain/benefit/childAllowance'
import type { Child, ChildAllowanceTable } from '../../../src/domain/types'
import { childAllowance } from '../fixtures'

/** 児童手当に効くのは生年月だけなので、進路はすべて同じにしておく */
function makeChild(id: string, birthYear: number, birthMonth: number): Child {
  return {
    id,
    birthYear,
    birthMonth: birthMonth as Child['birthMonth'],
    elementarySchoolType: 'public',
    juniorHighType: 'public',
    highSchoolType: 'public',
    annualHighSchoolTuition: null,
    universityType: 'none',
    cramSchoolPeriods: [],
  }
}

/** 表の区分（3 歳未満・3 歳以上） */
const tierOf = (table: ChildAllowanceTable, fromAge: number) => {
  const tier = table.tiers.find((t) => t.fromAge === fromAge)
  if (tier === undefined) throw new Error(`児童手当の表に ${fromAge} 歳からの区分が無い`)
  return tier
}
const UNDER_3 = tierOf(childAllowance, 0).monthlyAmount
const FROM_3 = tierOf(childAllowance, 3).monthlyAmount
const THIRD = tierOf(childAllowance, 3).monthlyAmountThirdOrLater

/** その子のある年の、月ごとの額の 12 か月の和 */
function sumOfMonths(children: readonly Child[], childId: string, year: number): number {
  let total = 0
  for (let month = 1; month <= 12; month++) {
    total += childAllowanceInMonth(children, childAllowance, year, month).get(childId) ?? NaN
  }
  return total
}

/** 生まれる前の年から支給が終わった次の年まで、子ごとに「月の和 ＝ 年額」を確かめる */
function expectMonthsMatchYears(children: readonly Child[]): void {
  for (const child of children) {
    const last = lastEligibleMonth(child, childAllowance)
    for (let year = child.birthYear - 1; year <= last.year + 1; year++) {
      const annual = childAllowanceInYear(children, childAllowance, year).byChild.find(
        (entry) => entry.childId === child.id,
      )?.annualAmount
      expect({ child: child.id, year, amount: sumOfMonths(children, child.id, year) }).toEqual({
        child: child.id,
        year,
        amount: annual,
      })
    }
  }
}

describe('12 か月の和は childAllowanceInYear の年額と一致する', () => {
  it('年の途中で 3 歳になる子（2030 年 7 月生まれ）', () => {
    expectMonthsMatchYears([makeChild('child-jul', 2030, 7)])
  })

  it('1〜3 月生まれ（支給の終わりが 1 年早い）', () => {
    expectMonthsMatchYears([makeChild('child-jan', 2031, 1)])
    expectMonthsMatchYears([makeChild('child-feb', 2029, 2)])
    expectMonthsMatchYears([makeChild('child-mar', 2032, 3)])
  })

  it('12 月生まれ（支給は翌年 1 月から）', () => {
    expectMonthsMatchYears([makeChild('child-dec', 2033, 12)])
  })

  it('3 人の子：3 人目の加算が付き、いちばん上が数える年齢を過ぎると外れる', () => {
    expectMonthsMatchYears([
      makeChild('child-1', 2030, 5),
      makeChild('child-2', 2034, 9),
      makeChild('child-3', 2046, 12),
    ])
  })
})

describe('月ごとの額', () => {
  const july = makeChild('child-jul', 2030, 7)

  it('生まれた月は 0、翌月から 3 歳未満の額。3 歳の誕生月まで 3 歳未満の額、翌月から 3 歳以上の額', () => {
    const at = (year: number, month: number) =>
      childAllowanceInMonth([july], childAllowance, year, month).get('child-jul')
    expect(at(2030, 7)).toBe(0)
    expect(at(2030, 8)).toBe(UNDER_3)
    expect(at(2033, 7)).toBe(UNDER_3)
    expect(at(2033, 8)).toBe(FROM_3)
    // 本物の額：15,000 → 10,000
    expect([UNDER_3, FROM_3]).toEqual([15000, 10000])
  })

  it('支給は 18 歳になった後の最初の 3 月まで（7 月生まれは 2049 年 3 月、2049 年 4 月は 0）', () => {
    const at = (year: number, month: number) =>
      childAllowanceInMonth([july], childAllowance, year, month).get('child-jul')
    expect(at(2049, 3)).toBe(FROM_3)
    expect(at(2049, 4)).toBe(0)
  })

  it('3 人目の加算は月ごとに数え直す：いちばん上（2030 年 5 月生まれ）が 22 歳の年度末（2053 年 3 月）を過ぎると、翌月から 2 人目の額', () => {
    const family = [
      makeChild('child-1', 2030, 5),
      makeChild('child-2', 2034, 9),
      makeChild('child-3', 2046, 12),
    ]
    const third = (year: number, month: number) =>
      childAllowanceInMonth(family, childAllowance, year, month).get('child-3')
    expect(third(2053, 3)).toBe(THIRD)
    expect(third(2053, 4)).toBe(FROM_3)
    expect(THIRD).toBe(30000)
    // 支給の対象でない子（いちばん上はもう 18 歳の年度末を過ぎている）も 0 円で含む
    expect(childAllowanceInMonth(family, childAllowance, 2053, 3).get('child-1')).toBe(0)
  })

  it('まだ生まれていない子も 0 円で含む', () => {
    expect(childAllowanceInMonth([july], childAllowance, 2029, 6).get('child-jul')).toBe(0)
  })
})

describe('契約違反', () => {
  const child = makeChild('child-x', 2030, 7)

  it('月が 1〜12 の整数でない・年が整数でないなら投げる', () => {
    expect(() => childAllowanceInMonth([child], childAllowance, 2031, 0)).toThrow(RangeError)
    expect(() => childAllowanceInMonth([child], childAllowance, 2031, 13)).toThrow(RangeError)
    expect(() => childAllowanceInMonth([child], childAllowance, 2031, 1.5)).toThrow(RangeError)
    expect(() => childAllowanceInMonth([child], childAllowance, 2031.5, 1)).toThrow(RangeError)
  })

  it('子の id が重なる・生月が壊れているなら投げる', () => {
    expect(() => childAllowanceInMonth([child, child], childAllowance, 2031, 1)).toThrow(RangeError)
    expect(() =>
      childAllowanceInMonth([makeChild('child-y', 2030, 13)], childAllowance, 2031, 1),
    ).toThrow(RangeError)
  })
})

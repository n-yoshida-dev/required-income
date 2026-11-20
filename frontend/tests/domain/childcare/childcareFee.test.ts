import { describe, expect, it } from 'vitest'
import {
  childcareCostInYear,
  childcareFreeFromYear,
  householdChildcareCostInYear,
  nurseryClassAge,
} from '../../../src/domain/childcare/childcareFee'
import type { Child, ChildcareEnrollment, ChildcareTable } from '../../../src/domain/types'
import { childcareFree } from '../fixtures'

/**
 * **架空の世帯の値。実際の保育料の表ではない。**
 *
 * 制度側の数値は `freeFromClassAge` だけで、本物は
 * `frontend/src/data/childcare/free-education.json`（`/verify-institution` で裏取り後に作成）に置く。
 * ここで確かめたいのは金額そのものではなく、
 * 「いつ保育料が 0 になり、そのとき実費がどう変わり、インフレがどちらに効くか」という仕組み。
 *
 * 無償化の境目がマスタデータで動くことを示すため、
 * `freeFromClassAge` を変えたケースも下に置いてある。
 */
const table: ChildcareTable = {
  freeFromClassAge: 3,
  standardMonthlySideDishCost: 4000,
  standardMonthlyStapleFoodCost: 1000,
}

/** 保育料に効くのは生年月だけなので、進路はすべて揃えておく */
function makeChild(id: string, birthYear: number, birthMonth: number): Child {
  return {
    id,
    birthYear,
    birthMonth: birthMonth as Child['birthMonth'],
    elementarySchoolType: 'public',
    juniorHighType: 'public',
    highSchoolType: 'public',
    annualHighSchoolTuition: null,
    universityType: 'nationalPublic',
    cramSchoolPeriods: [],
  }
}

function makeEnrollment(
  childId: string,
  fromYear: number,
  overrides: Partial<ChildcareEnrollment> = {},
): ChildcareEnrollment {
  return {
    childId,
    fromYear,
    monthlyFee: 38000,
    monthlyExtraCost: 3000,
    monthlyExtraCostAfterFree: 9000,
    ...overrides,
  }
}

const BASE_YEAR = 2019

// 2018年5月生まれ → 小1は2025年。0歳児クラス2019・3歳児クラス2022・5歳児クラス2024
const child = makeChild('child-a', 2018, 5)
const enrollment = makeEnrollment('child-a', 2019)

// 2018年2月生まれ（早生まれ）→ 小1は2024年。すべてが1年早く進む
const earlyChild = makeChild('child-early', 2018, 2)

describe('nurseryClassAge', () => {
  it('0歳児クラスから5歳児クラスまでを順に返す', () => {
    const classAges = [2019, 2020, 2021, 2022, 2023, 2024].map((year) =>
      nurseryClassAge(child, year),
    )

    expect(classAges).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('小学校に入学する年は6になる（保育園の対象外）', () => {
    expect(nurseryClassAge(child, 2025)).toBe(6)
  })

  it('生まれる前は負になる', () => {
    expect(nurseryClassAge(child, 2018)).toBe(-1)
  })

  it('早生まれは1年早くクラスが上がる', () => {
    // 同じ2018年生まれでも、2月生まれは2021年に3歳児クラス（5月生まれは2022年）
    expect(nurseryClassAge(earlyChild, 2021)).toBe(3)
    expect(nurseryClassAge(child, 2021)).toBe(2)
  })

  it('生月が範囲外なら例外を投げる', () => {
    expect(() => nurseryClassAge(makeChild('bad', 2018, 13), 2020)).toThrow(RangeError)
  })
})

describe('childcareFreeFromYear', () => {
  it('3歳児クラスの年を返す', () => {
    expect(childcareFreeFromYear(child, table)).toBe(2022)
  })

  it('早生まれは1年早く無償になる', () => {
    expect(childcareFreeFromYear(earlyChild, table)).toBe(2021)
  })

  it('マスタデータの無償化のクラス年齢で動く', () => {
    expect(
      childcareFreeFromYear(child, {
        freeFromClassAge: 2,
        standardMonthlySideDishCost: 4000,
        standardMonthlyStapleFoodCost: 1000,
      }),
    ).toBe(2021)
    expect(
      childcareFreeFromYear(child, {
        freeFromClassAge: 4,
        standardMonthlySideDishCost: 4000,
        standardMonthlyStapleFoodCost: 1000,
      }),
    ).toBe(2023)
  })
})

describe('childcareCostInYear', () => {
  describe('通っている期間', () => {
    it('入園する年より前は計上しない', () => {
      const result = childcareCostInYear(
        child,
        makeEnrollment('child-a', 2021),
        table,
        0,
        BASE_YEAR,
        2020,
      )

      expect(result.enrolled).toBe(false)
      expect(result.total).toBe(0)
    })

    it('小学校に入学する年からは計上しない（実費も含めて0）', () => {
      const result = childcareCostInYear(child, enrollment, table, 0, BASE_YEAR, 2025)

      expect(result.enrolled).toBe(false)
      expect(result.fee).toBe(0)
      expect(result.extraCost).toBe(0)
    })

    it('入園の情報が無ければ計上しない', () => {
      const result = childcareCostInYear(child, null, table, 0, BASE_YEAR, 2021)

      expect(result.enrolled).toBe(false)
      expect(result.total).toBe(0)
    })

    it('入園していない年でもクラス年齢は返す（画面で並べるため）', () => {
      expect(childcareCostInYear(child, null, table, 0, BASE_YEAR, 2025).classAge).toBe(6)
    })
  })

  describe('無償化', () => {
    it('0〜2歳児クラスは保育料が発生する', () => {
      const fees = [2019, 2020, 2021].map(
        (year) => childcareCostInYear(child, enrollment, table, 0, BASE_YEAR, year).fee,
      )

      expect(fees).toEqual([456000, 456000, 456000])
    })

    it('3歳児クラスから保育料が0になる', () => {
      const fees = [2022, 2023, 2024].map(
        (year) => childcareCostInYear(child, enrollment, table, 0, BASE_YEAR, year).fee,
      )

      expect(fees).toEqual([0, 0, 0])
    })

    it('保育料が0になっても実費は残り、給食費のぶん額が上がる', () => {
      const before = childcareCostInYear(child, enrollment, table, 0, BASE_YEAR, 2021)
      const after = childcareCostInYear(child, enrollment, table, 0, BASE_YEAR, 2022)

      expect(before.extraCost).toBe(36000)
      expect(after.extraCost).toBe(108000)
      expect(after.total).toBe(108000)
    })

    it('無償化後の実費が未入力なら「今の実費 + 副食費の目安 + 主食費の既定値」で置く', () => {
      const result = childcareCostInYear(
        child,
        makeEnrollment('child-a', 2019, { monthlyExtraCostAfterFree: null }),
        table,
        0,
        BASE_YEAR,
        2022,
      )

      // 教材費・行事費 3,000円 は続き、そこへ副食費の目安 4,000円 と主食費の既定値 1,000円 が乗る
      expect(result.extraCost).toBe((3000 + 4000 + 1000) * 12)
    })

    it('無償化後の実費が未入力でも、無償化の前は副食費を足さない', () => {
      const result = childcareCostInYear(
        child,
        makeEnrollment('child-a', 2019, { monthlyExtraCostAfterFree: null }),
        table,
        0,
        BASE_YEAR,
        2021,
      )

      expect(result.extraCost).toBe(36000)
    })

    it('無償化の境目はマスタデータで動く', () => {
      const at2 = childcareCostInYear(
        child,
        enrollment,
        {
          freeFromClassAge: 2,
          standardMonthlySideDishCost: 4000,
          standardMonthlyStapleFoodCost: 1000,
        },
        0,
        BASE_YEAR,
        2021,
      )
      const at4 = childcareCostInYear(
        child,
        enrollment,
        {
          freeFromClassAge: 4,
          standardMonthlySideDishCost: 4000,
          standardMonthlyStapleFoodCost: 1000,
        },
        0,
        BASE_YEAR,
        2022,
      )

      // 2歳児クラスから無償なら2021年は0円、4歳児クラスからなら2022年はまだ有償
      expect(at2.fee).toBe(0)
      expect(at4.fee).toBe(456000)
    })

    it('無償化のクラス年齢が0なら在園中ずっと保育料が0になる', () => {
      const fees = [2019, 2021, 2024].map(
        (year) =>
          childcareCostInYear(
            child,
            enrollment,
            {
              freeFromClassAge: 0,
              standardMonthlySideDishCost: 4000,
              standardMonthlyStapleFoodCost: 1000,
            },
            0,
            BASE_YEAR,
            year,
          ).fee,
      )

      expect(fees).toEqual([0, 0, 0])
    })

    it('無償化のクラス年齢が6なら在園中ずっと有償のままになる', () => {
      const fees = [2019, 2022, 2024].map(
        (year) =>
          childcareCostInYear(
            child,
            enrollment,
            {
              freeFromClassAge: 6,
              standardMonthlySideDishCost: 4000,
              standardMonthlyStapleFoodCost: 1000,
            },
            0,
            BASE_YEAR,
            year,
          ).fee,
      )

      expect(fees).toEqual([456000, 456000, 456000])
    })
  })

  describe('インフレ', () => {
    it('保育料はインフレさせない（階層表の名目額のため）', () => {
      const result = childcareCostInYear(child, enrollment, table, 0.02, BASE_YEAR, 2021)

      expect(result.fee).toBe(456000)
    })

    it('実費はインフレで逓増させる', () => {
      const result = childcareCostInYear(child, enrollment, table, 0.02, BASE_YEAR, 2021)

      // 3,000円 × 12か月 × 1.02^2 = 37,454.4 → 37,454
      expect(result.extraCost).toBe(37454)
    })

    it('無償化後の実費にもインフレが効く', () => {
      const result = childcareCostInYear(child, enrollment, table, 0.02, BASE_YEAR, 2022)

      // 9,000円 × 12か月 × 1.02^3 = 114,610.464 → 114,610
      expect(result.fee).toBe(0)
      expect(result.extraCost).toBe(114610)
      expect(result.total).toBe(114610)
    })

    it('起点年はインフレが掛からない', () => {
      const result = childcareCostInYear(child, enrollment, table, 0.02, BASE_YEAR, BASE_YEAR)

      expect(result.extraCost).toBe(36000)
    })
  })

  describe('契約違反', () => {
    it('起点より前の年は計算できない', () => {
      expect(() => childcareCostInYear(child, enrollment, table, 0, BASE_YEAR, 2018)).toThrow(
        RangeError,
      )
    })

    it('年が整数でなければ例外を投げる', () => {
      expect(() => childcareCostInYear(child, enrollment, table, 0, BASE_YEAR, 2021.5)).toThrow(
        RangeError,
      )
    })

    it('インフレ率が -100% 以下なら例外を投げる', () => {
      expect(() => childcareCostInYear(child, enrollment, table, -1, BASE_YEAR, 2021)).toThrow(
        RangeError,
      )
    })

    it('無償化のクラス年齢が範囲外なら例外を投げる', () => {
      expect(() =>
        childcareCostInYear(
          child,
          enrollment,
          {
            freeFromClassAge: 7,
            standardMonthlySideDishCost: 4000,
            standardMonthlyStapleFoodCost: 1000,
          },
          0,
          BASE_YEAR,
          2021,
        ),
      ).toThrow(RangeError)
      expect(() =>
        childcareCostInYear(
          child,
          enrollment,
          {
            freeFromClassAge: -1,
            standardMonthlySideDishCost: 4000,
            standardMonthlyStapleFoodCost: 1000,
          },
          0,
          BASE_YEAR,
          2021,
        ),
      ).toThrow(RangeError)
      expect(() =>
        childcareCostInYear(
          child,
          enrollment,
          {
            freeFromClassAge: 2.5,
            standardMonthlySideDishCost: 4000,
            standardMonthlyStapleFoodCost: 1000,
          },
          0,
          BASE_YEAR,
          2021,
        ),
      ).toThrow(RangeError)
    })

    it('副食費の目安額が負なら例外を投げる', () => {
      expect(() =>
        childcareCostInYear(
          child,
          enrollment,
          {
            freeFromClassAge: 3,
            standardMonthlySideDishCost: -1,
            standardMonthlyStapleFoodCost: 1000,
          },
          0,
          BASE_YEAR,
          2021,
        ),
      ).toThrow(RangeError)
    })

    it('主食費の既定値が負なら例外を投げる', () => {
      expect(() =>
        childcareCostInYear(
          child,
          enrollment,
          {
            freeFromClassAge: 3,
            standardMonthlySideDishCost: 4000,
            standardMonthlyStapleFoodCost: -1,
          },
          0,
          BASE_YEAR,
          2021,
        ),
      ).toThrow(RangeError)
    })

    it('別の子の入園の情報を渡したら例外を投げる', () => {
      expect(() =>
        childcareCostInYear(child, makeEnrollment('child-other', 2019), table, 0, BASE_YEAR, 2021),
      ).toThrow(RangeError)
    })

    it('月額が負なら例外を投げる', () => {
      expect(() =>
        childcareCostInYear(
          child,
          makeEnrollment('child-a', 2019, { monthlyFee: -1 }),
          table,
          0,
          BASE_YEAR,
          2021,
        ),
      ).toThrow(RangeError)
      expect(() =>
        childcareCostInYear(
          child,
          makeEnrollment('child-a', 2019, { monthlyExtraCostAfterFree: Number.NaN }),
          table,
          0,
          BASE_YEAR,
          2022,
        ),
      ).toThrow(RangeError)
    })

    it('入園する年が整数でなければ例外を投げる', () => {
      expect(() =>
        childcareCostInYear(child, makeEnrollment('child-a', 2019.5), table, 0, BASE_YEAR, 2021),
      ).toThrow(RangeError)
    })
  })
})

describe('householdChildcareCostInYear', () => {
  // 2020年11月生まれ → 小1は2027年。0歳児クラス2021・3歳児クラス2024
  const sibling = makeChild('child-b', 2020, 11)
  const siblingEnrollment = makeEnrollment('child-b', 2021, {
    monthlyFee: 27000,
    monthlyExtraCost: 2000,
    monthlyExtraCostAfterFree: 8000,
  })
  const children = [child, sibling]
  const enrollments = [enrollment, siblingEnrollment]

  it('兄弟が同時に通う年は保育料が2人ぶん重なる', () => {
    // 2021年：上の子が2歳児クラス、下の子が0歳児クラス。どちらも有償
    const result = householdChildcareCostInYear(children, enrollments, table, 0, BASE_YEAR, 2021)

    expect(result.byChild.map((cost) => cost.total)).toEqual([492000, 348000])
    expect(result.total).toBe(840000)
  })

  it('上の子だけ無償化された年は下の子の保育料だけが残る', () => {
    // 2022年：上の子が3歳児クラス（無償）、下の子が1歳児クラス（有償）
    const result = householdChildcareCostInYear(children, enrollments, table, 0, BASE_YEAR, 2022)

    expect(result.byChild.map((cost) => cost.fee)).toEqual([0, 324000])
    expect(result.total).toBe(456000)
  })

  it('通っていない子も0円として内訳に含む', () => {
    const result = householdChildcareCostInYear(children, [enrollment], table, 0, BASE_YEAR, 2021)

    expect(result.byChild).toHaveLength(2)
    expect(result.byChild[1]?.enrolled).toBe(false)
    expect(result.byChild[1]?.total).toBe(0)
  })

  it('子がいなければ0円', () => {
    const result = householdChildcareCostInYear([], [], table, 0, BASE_YEAR, 2021)

    expect(result.byChild).toHaveLength(0)
    expect(result.total).toBe(0)
  })

  it('存在しない子を指す入園の情報があれば例外を投げる', () => {
    expect(() =>
      householdChildcareCostInYear(
        children,
        [...enrollments, makeEnrollment('child-ghost', 2021)],
        table,
        0,
        BASE_YEAR,
        2021,
      ),
    ).toThrow(RangeError)
  })

  it('同じ子に入園の情報が2つあれば例外を投げる', () => {
    expect(() =>
      householdChildcareCostInYear(
        children,
        [enrollment, makeEnrollment('child-a', 2020)],
        table,
        0,
        BASE_YEAR,
        2021,
      ),
    ).toThrow(RangeError)
  })

  it('子の id が重複していれば例外を投げる', () => {
    expect(() =>
      householdChildcareCostInYear([child, child], [enrollment], table, 0, BASE_YEAR, 2021),
    ).toThrow(RangeError)
  })
})

describe('実際の制度データ（data/childcare/free-education.json）', () => {
  it('マスタデータが検証を通り、3歳児クラスから保育料が0になる', () => {
    // 2歳児クラス（2021年）は有償、3歳児クラス（2022年）から無償
    const before = childcareCostInYear(child, enrollment, childcareFree, 0, BASE_YEAR, 2021)
    const after = childcareCostInYear(child, enrollment, childcareFree, 0, BASE_YEAR, 2022)

    expect(before.fee).toBeGreaterThan(0)
    expect(after.fee).toBe(0)
  })

  it('無償化後の実費が未入力なら、今の実費に副食費の目安と主食費の既定値が乗る', () => {
    const result = childcareCostInYear(
      child,
      makeEnrollment('child-a', 2019, { monthlyExtraCostAfterFree: null }),
      childcareFree,
      0,
      BASE_YEAR,
      2022,
    )

    expect(result.extraCost).toBe(
      (3000 +
        childcareFree.standardMonthlySideDishCost +
        childcareFree.standardMonthlyStapleFoodCost) *
        12,
    )
  })

  it('早生まれは1年早く無償になる', () => {
    expect(childcareFreeFromYear(earlyChild, childcareFree)).toBe(
      childcareFreeFromYear(child, childcareFree) - 1,
    )
  })
})

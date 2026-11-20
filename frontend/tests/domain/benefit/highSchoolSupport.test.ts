import { describe, expect, it } from 'vitest'
import {
  highSchoolSupportInYear,
  householdHighSchoolSupportInYear,
} from '../../../src/domain/benefit/highSchoolSupport'
import type { Child, HighSchoolSupportTable } from '../../../src/domain/types'
import { highSchoolSupport } from '../fixtures'

/**
 * **架空の制度データ。実際の支給限度額でも授業料でもない。**
 *
 * 本物の値は `frontend/src/data/benefit/high-school-support.json`
 * （`/verify-institution` で裏取り後に作成）に置く。
 * ここで実際の値を使うと、テストが通ったことを制度の裏取りが済んだことと
 * 取り違えるおそれがあるため、あえて実在しない額にしてある。
 *
 * テストで確かめたいのは金額そのものではなく、
 * 「いつからいつまで支給され、授業料と支給限度額のどちらが上限になり、
 * インフレがどちらに効くか」という仕組み。
 *
 * 公立は授業料（月 8,000 円）が限度額（月 9,000 円）を**下回る**ように、
 * 私立は授業料（月 38,000 円）が限度額（月 33,000 円）を**上回る**ようにしてある。
 * これで min の両側を踏める。
 */
const table: HighSchoolSupportTable = {
  monthlyLimit: { public: 9000, private: 33000 },
  standardAnnualTuition: { public: 96000, private: 456000 },
  maxSupportedMonths: 36,
  hasIncomeLimit: false,
}

/** 就学支援金に効くのは生年月・高校の公私・授業料だけなので、他の進路は揃えておく */
function makeChild(
  id: string,
  birthYear: number,
  birthMonth: number,
  highSchoolType: 'public' | 'private',
  annualHighSchoolTuition: number | null = null,
): Child {
  return {
    id,
    birthYear,
    birthMonth: birthMonth as Child['birthMonth'],
    elementarySchoolType: 'public',
    juniorHighType: 'public',
    highSchoolType,
    annualHighSchoolTuition,
    universityType: 'nationalPublic',
    cramSchoolPeriods: [],
  }
}

// 2018年4月生まれ → 小1は2025年、高1は2034年、高3は2036年
const BASE_YEAR = 2025
const publicChild = makeChild('child-public', 2018, 4, 'public')
const privateChild = makeChild('child-private', 2018, 4, 'private')

describe('highSchoolSupportInYear', () => {
  describe('支給される期間', () => {
    it('高校に入る前は支給されない', () => {
      // 2033年は中3
      const result = highSchoolSupportInYear(publicChild, table, 0, BASE_YEAR, 2033)

      expect(result.supportedMonths).toBe(0)
      expect(result.annualAmount).toBe(0)
    })

    it('高1から高3までの3年間だけ支給される', () => {
      const months = [2034, 2035, 2036].map(
        (year) => highSchoolSupportInYear(publicChild, table, 0, BASE_YEAR, year).supportedMonths,
      )

      expect(months).toEqual([12, 12, 12])
    })

    it('高校を出たあとは支給されない', () => {
      const result = highSchoolSupportInYear(publicChild, table, 0, BASE_YEAR, 2037)

      expect(result.supportedMonths).toBe(0)
      expect(result.annualAmount).toBe(0)
    })

    it('早生まれは入学が1年早いぶん、支給の年も1年早い', () => {
      // 2018年2月生まれ → 小1は2024年、高1は2033年
      const earlyBorn = makeChild('child-early', 2018, 2, 'public')

      expect(highSchoolSupportInYear(earlyBorn, table, 0, BASE_YEAR, 2033).supportedMonths).toBe(12)
      expect(highSchoolSupportInYear(earlyBorn, table, 0, BASE_YEAR, 2036).supportedMonths).toBe(0)
    })

    it('通算月数の上限が36月より短いと、3年目が途中で打ち切られる', () => {
      const shortTable: HighSchoolSupportTable = { ...table, maxSupportedMonths: 30 }

      const months = [2034, 2035, 2036].map(
        (year) =>
          highSchoolSupportInYear(publicChild, shortTable, 0, BASE_YEAR, year).supportedMonths,
      )

      // 12 + 12 で24月を使い、3年目は残りの6月だけ
      expect(months).toEqual([12, 12, 6])
      expect(
        highSchoolSupportInYear(publicChild, shortTable, 0, BASE_YEAR, 2036).annualAmount,
      ).toBe(8000 * 6)
    })
  })

  describe('授業料と支給限度額のどちらが上限になるか', () => {
    it('授業料が限度額を下回るときは授業料が上限になる（公立）', () => {
      const result = highSchoolSupportInYear(publicChild, table, 0, BASE_YEAR, 2034)

      // 月 8,000 円（授業料）< 月 9,000 円（限度額）
      expect(result.annualAmount).toBe(96000)
    })

    it('授業料が限度額を上回るときは限度額が上限になる（私立）', () => {
      const result = highSchoolSupportInYear(privateChild, table, 0, BASE_YEAR, 2034)

      // 月 38,000 円（授業料）> 月 33,000 円（限度額）→ 限度額まで
      expect(result.annualAmount).toBe(33000 * 12)
    })

    it('子ごとの授業料の入力がマスタデータの標準額より優先される', () => {
      // 私立だが授業料の安い学校。限度額を下回るので支援金も授業料までで止まる
      const cheapPrivate = makeChild('child-cheap', 2018, 4, 'private', 240000)

      const result = highSchoolSupportInYear(cheapPrivate, table, 0, BASE_YEAR, 2034)

      expect(result.annualAmount).toBe(240000)
    })
  })

  describe('インフレの効き方', () => {
    it('授業料はインフレで上がるが、支給限度額は上がらない', () => {
      // 公立の授業料は起点では限度額を下回るが、9年ぶんのインフレで上回る
      const result = highSchoolSupportInYear(publicChild, table, 0.05, BASE_YEAR, 2034)

      // 授業料 96,000 × 1.05^9 ≒ 148,928 円（月 12,411 円）> 限度額 月 9,000 円
      expect(result.annualAmount).toBe(9000 * 12)
    })

    it('限度額に届かない範囲では、インフレした授業料がそのまま支給される', () => {
      const cheapPublic = makeChild('child-cheap-public', 2018, 4, 'public', 60000)

      const result = highSchoolSupportInYear(cheapPublic, table, 0.02, BASE_YEAR, 2034)

      // 60,000 × 1.02^9 = 71,705.554… を、月額に割ってから12を掛け、最後に1回だけ丸める
      expect(result.annualAmount).toBe(71706)
    })

    it('起点年ではインフレが効かない', () => {
      // 高1が起点年に来る子（2009年4月生まれ → 小1は2016年、高1は2025年）
      const child = makeChild('child-base-year', 2009, 4, 'public')

      expect(highSchoolSupportInYear(child, table, 0.05, BASE_YEAR, BASE_YEAR).annualAmount).toBe(
        96000,
      )
    })
  })

  describe('入力の検証', () => {
    it('起点より前の年は計算できない', () => {
      expect(() => highSchoolSupportInYear(publicChild, table, 0, BASE_YEAR, 2024)).toThrow(
        RangeError,
      )
    })

    it('年が整数でなければ落ちる', () => {
      expect(() => highSchoolSupportInYear(publicChild, table, 0, BASE_YEAR, 2034.5)).toThrow(
        RangeError,
      )
    })

    it('インフレ率が -100% 以下なら落ちる', () => {
      expect(() => highSchoolSupportInYear(publicChild, table, -1, BASE_YEAR, 2034)).toThrow(
        RangeError,
      )
    })

    it('授業料が負なら落ちる', () => {
      const broken = makeChild('child-broken', 2018, 4, 'private', -1)

      expect(() => highSchoolSupportInYear(broken, table, 0, BASE_YEAR, 2034)).toThrow(RangeError)
    })

    it('支給限度額が負なら落ちる', () => {
      const broken: HighSchoolSupportTable = {
        ...table,
        monthlyLimit: { public: -1, private: 33000 },
      }

      expect(() => highSchoolSupportInYear(publicChild, broken, 0, BASE_YEAR, 2034)).toThrow(
        RangeError,
      )
    })

    it('通算月数の上限が 0 以下なら落ちる', () => {
      const broken: HighSchoolSupportTable = { ...table, maxSupportedMonths: 0 }

      expect(() => highSchoolSupportInYear(publicChild, broken, 0, BASE_YEAR, 2034)).toThrow(
        RangeError,
      )
    })

    /**
     * **所得制限のある制度データは黙って計算しない。**
     * 2026年4月の改正で所得制限は条文から消えたが、将来復活したときに
     * 全世帯へ満額を計上したまま気づかない、という壊れ方をさせないため。
     */
    it('所得制限ありのマスタデータは未対応として落ちる', () => {
      const withIncomeLimit: HighSchoolSupportTable = { ...table, hasIncomeLimit: true }

      expect(() =>
        highSchoolSupportInYear(publicChild, withIncomeLimit, 0, BASE_YEAR, 2034),
      ).toThrow(RangeError)
    })
  })
})

describe('householdHighSchoolSupportInYear', () => {
  it('兄弟が同時に高校に通う年は支給も重なる', () => {
    // 2020年4月生まれ → 小1は2027年、高1は2036年。上の子は同じ年に高3
    const younger = makeChild('child-younger', 2020, 4, 'private')

    const result = householdHighSchoolSupportInYear(
      [publicChild, younger],
      table,
      0,
      BASE_YEAR,
      2036,
    )

    expect(result.year).toBe(2036)
    expect(result.byChild.map((detail) => detail.annualAmount)).toEqual([96000, 33000 * 12])
    expect(result.total).toBe(96000 + 33000 * 12)
  })

  it('支給の無い子も 0 円として内訳に残る', () => {
    const preschooler = makeChild('child-preschool', 2030, 4, 'public')

    const result = householdHighSchoolSupportInYear(
      [publicChild, preschooler],
      table,
      0,
      BASE_YEAR,
      2034,
    )

    expect(result.byChild).toHaveLength(2)
    expect(result.byChild[1]).toEqual({
      childId: 'child-preschool',
      supportedMonths: 0,
      annualAmount: 0,
    })
    expect(result.total).toBe(96000)
  })

  it('誰も高校にいない年は 0 円', () => {
    const result = householdHighSchoolSupportInYear([publicChild], table, 0, BASE_YEAR, 2030)

    expect(result.total).toBe(0)
  })

  it('子の id が重複していたら落ちる', () => {
    expect(() =>
      householdHighSchoolSupportInYear([publicChild, publicChild], table, 0, BASE_YEAR, 2034),
    ).toThrow(RangeError)
  })
})

/**
 * **ここだけは実際の制度データを使う**（`data/benefit/high-school-support.json`）。
 *
 * 上のテストが仕組みを固定しているのに対し、こちらは
 * 「マスタデータを差し替えたときに、制度として意味のある額が出続けているか」を見る。
 * 期待値には条文・出典の根拠を書き、数値だけが独り歩きしないようにする。
 *
 * インフレ率は 0 にする。制度の額そのものを確かめたいので、
 * 前提値の設定で結果が動かないようにするため。
 */
describe('実際の制度データ（2026年4月施行の新制度）', () => {
  it('公立は授業料が全額まかなわれ、自己負担が残らない', () => {
    // 公立高校（全日制）の授業料 年118,800円（文部科学省の資料） ＝ 施行令第2条第2号イの限度額 月9,900円 × 12
    const result = highSchoolSupportInYear(publicChild, highSchoolSupport, 0, BASE_YEAR, 2034)

    expect(result.annualAmount).toBe(118800)
    expect(result.annualAmount).toBe(highSchoolSupport.standardAnnualTuition.public)
  })

  it('私立は限度額で頭打ちになり、平均授業料との差だけ自己負担が残る', () => {
    // 施行令第2条第3号イ 月38,100円 × 12 = 457,200円（文科省の「最大45万7,200円」と一致）
    const result = highSchoolSupportInYear(privateChild, highSchoolSupport, 0, BASE_YEAR, 2034)

    expect(result.annualAmount).toBe(457200)

    // 令和6年度の私立全日制の初年度授業料 全国平均 457,331円との差
    const selfPay = highSchoolSupport.standardAnnualTuition.private - result.annualAmount
    expect(selfPay).toBe(131)
  })

  it('所得制限が撤廃されているので、世帯の所得を渡さなくても計算できる', () => {
    // 令和8年法律第8号による改正後、法第3条・第5条に所得の要件が無い。
    // TaxBase を引数に取らない設計がこれで裏付けられる
    expect(highSchoolSupport.hasIncomeLimit).toBe(false)
  })

  it('高校3年間の支給月数の合計が、法第3条第2項第2号の36月に一致する', () => {
    const months = [2034, 2035, 2036].map(
      (year) =>
        highSchoolSupportInYear(publicChild, highSchoolSupport, 0, BASE_YEAR, year).supportedMonths,
    )

    expect(months.reduce((sum, m) => sum + m, 0)).toBe(highSchoolSupport.maxSupportedMonths)
  })

  it('私立3年間の支給総額は 457,200 円 × 3 年', () => {
    const total = [2034, 2035, 2036]
      .map(
        (year) =>
          highSchoolSupportInYear(privateChild, highSchoolSupport, 0, BASE_YEAR, year).annualAmount,
      )
      .reduce((sum, amount) => sum + amount, 0)

    expect(total).toBe(457200 * 3)
  })
})

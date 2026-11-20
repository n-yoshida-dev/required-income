import { describe, expect, it } from 'vitest'
import {
  birthOrderInMonth,
  childAllowanceInYear,
  firstEligibleMonth,
  householdChildAllowanceInYear,
  lastEligibleMonth,
} from '../../../src/domain/benefit/childAllowance'
import type { Child, ChildAllowanceTable } from '../../../src/domain/types'
import { childAllowance } from '../fixtures'

/**
 * **架空の制度データ。実際の児童手当の額でも年齢でもない。**
 *
 * 本物の値は `frontend/src/data/benefit/child-allowance.json`（`/verify-institution` で裏取り後に作成）
 * に置く。ここで実際の値を使うと、テストが通ったことを制度の裏取りが済んだことと
 * 取り違えるおそれがあるため、あえて実在しない区切りにしてある。
 *
 * テストで確かめたいのは金額そのものではなく、
 * 「いつ区分が切り替わり、いつ支給が終わり、何番目の子として扱われるか」という仕組み。
 */
const table: ChildAllowanceTable = {
  tiers: [
    { fromAge: 0, monthlyAmount: 21000, monthlyAmountThirdOrLater: 34000 },
    { fromAge: 4, monthlyAmount: 13000, monthlyAmountThirdOrLater: 29000 },
  ],
  eligibilityEndAge: 15,
  birthOrderCountUpToAge: 20,
  hasIncomeLimit: false,
}

/** 児童手当の計算に効くのは生年月だけなので、進路はすべて同じにしておく */
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

/** 5月生まれ。年の途中で年齢の区分が変わる様子を見るのに使う */
const mayBorn = makeChild('child-may', 2012, 5)
/** 2月生まれ（早生まれ）。年度末が誕生日と同じ暦年に来る */
const februaryBorn = makeChild('child-feb', 2012, 2)

describe('firstEligibleMonth', () => {
  it('生まれた月の翌月から支給が始まる', () => {
    expect(firstEligibleMonth(mayBorn)).toEqual({ year: 2012, month: 6 })
  })

  it('12月生まれは翌年の1月が初回になる', () => {
    expect(firstEligibleMonth(makeChild('child-dec', 2012, 12))).toEqual({ year: 2013, month: 1 })
  })

  it('生月が 1〜12 の整数でなければ例外を投げる', () => {
    // 型では Month に絞っているが、JSON の読み込みなど型の外から壊れた値が入りうる
    const broken = { ...mayBorn, birthMonth: 0 as Child['birthMonth'] }
    expect(() => firstEligibleMonth(broken)).toThrow(RangeError)
  })
})

describe('lastEligibleMonth', () => {
  it('4月〜12月生まれは、終了年齢に達した翌年の3月まで受け取れる', () => {
    // 2012年5月生まれが15歳になるのは2027年5月。その後最初の年度末は2028年3月
    expect(lastEligibleMonth(mayBorn, table)).toEqual({ year: 2028, month: 3 })
  })

  it('早生まれ（1〜3月）は同じ暦年の3月で終わるため1年早く終了する', () => {
    // 2012年2月生まれが15歳になるのは2027年2月。その後最初の年度末は2027年3月
    expect(lastEligibleMonth(februaryBorn, table)).toEqual({ year: 2027, month: 3 })
  })

  it('終了年齢が同じでも、生月だけで受給期間が1年変わる', () => {
    expect(
      lastEligibleMonth(mayBorn, table).year - lastEligibleMonth(februaryBorn, table).year,
    ).toBe(1)
  })
})

describe('childAllowanceInYear', () => {
  it('生まれた年は、生まれた月の翌月からの月数ぶんだけ受け取る', () => {
    // 5月生まれ → 6〜12月の7か月
    const result = childAllowanceInYear([mayBorn], table, 2012)
    expect(result.byChild[0]!.eligibleMonths).toBe(7)
    expect(result.total).toBe(7 * 21000)
  })

  it('生まれる前の年は支給されない', () => {
    const result = childAllowanceInYear([mayBorn], table, 2011)
    expect(result.byChild[0]!.eligibleMonths).toBe(0)
    expect(result.total).toBe(0)
  })

  it('通常の年は12か月ぶん受け取る', () => {
    expect(householdChildAllowanceInYear([mayBorn], table, 2013)).toBe(12 * 21000)
  })

  it('年齢の区分は誕生日の翌月に切り替わる（誕生日の月はまだ前の区分）', () => {
    // 2016年5月に4歳。1〜5月は前の区分、6〜12月は次の区分
    const result = childAllowanceInYear([mayBorn], table, 2016)
    expect(result.total).toBe(5 * 21000 + 7 * 13000)
    expect(result.byChild[0]!.eligibleMonths).toBe(12)
  })

  it('支給が終わる年は1〜3月の3か月ぶんだけ受け取る', () => {
    const result = childAllowanceInYear([mayBorn], table, 2028)
    expect(result.byChild[0]!.eligibleMonths).toBe(3)
    expect(result.total).toBe(3 * 13000)
  })

  it('支給が終わった翌年は0円になる', () => {
    expect(householdChildAllowanceInYear([mayBorn], table, 2029)).toBe(0)
  })

  it('早生まれは同じ生年でも1年早く支給が終わる', () => {
    // 2027年は5月生まれがまだ12か月ぶん受け取り、2月生まれは3か月ぶんで終わる
    expect(householdChildAllowanceInYear([mayBorn], table, 2027)).toBe(12 * 13000)
    expect(householdChildAllowanceInYear([februaryBorn], table, 2027)).toBe(3 * 13000)
  })

  it('支給が無い子も内訳に 0 円として残す（画面で子ごとに出すため）', () => {
    const result = childAllowanceInYear([mayBorn, makeChild('unborn', 2030, 5)], table, 2013)
    expect(result.byChild).toHaveLength(2)
    expect(result.byChild[1]).toEqual({ childId: 'unborn', eligibleMonths: 0, annualAmount: 0 })
  })

  it('合計は内訳の合計と一致する', () => {
    const result = childAllowanceInYear([mayBorn, februaryBorn], table, 2016)
    const sum = result.byChild.reduce((acc, detail) => acc + detail.annualAmount, 0)
    expect(result.total).toBe(sum)
  })

  it('年が整数でなければ例外を投げる', () => {
    expect(() => childAllowanceInYear([mayBorn], table, 2013.5)).toThrow(RangeError)
  })

  it('子の id が重複していれば例外を投げる（内訳が黙って消えるのを防ぐ）', () => {
    expect(() =>
      childAllowanceInYear([mayBorn, { ...februaryBorn, id: mayBorn.id }], table, 2013),
    ).toThrow(RangeError)
  })
})

describe('第3子加算', () => {
  /** 3年おきの3人きょうだい。上の子が数える対象から外れる年を作れる間隔にしてある */
  const first = makeChild('first', 2012, 5)
  const second = makeChild('second', 2015, 5)
  const third = makeChild('third', 2018, 5)
  const siblings = [first, second, third]

  it('3人目には加算された額が適用される', () => {
    // 2022年：3人とも数える対象。3人目は2022年5月に4歳になるので、
    // 1〜5月が最初の区分の加算額、6月以降が次の区分の加算額になる
    const result = childAllowanceInYear(siblings, table, 2022)
    const detail = result.byChild.find((entry) => entry.childId === 'third')!
    expect(detail.annualAmount).toBe(5 * 34000 + 7 * 29000)
  })

  it('1人目・2人目には加算されない額が適用される', () => {
    const result = childAllowanceInYear(siblings, table, 2022)
    // どちらも4歳を過ぎているので次の区分の通常額
    expect(result.byChild.find((entry) => entry.childId === 'first')!.annualAmount).toBe(12 * 13000)
    expect(result.byChild.find((entry) => entry.childId === 'second')!.annualAmount).toBe(
      12 * 13000,
    )
  })

  it('入力の並び順ではなく生年月の年長順で数える', () => {
    const shuffled = [third, first, second]
    expect(householdChildAllowanceInYear(shuffled, table, 2022)).toBe(
      householdChildAllowanceInYear(siblings, table, 2022),
    )
  })

  it('支給が終わった上の子も、上限年齢までは第1子として数える', () => {
    // 2028年：一番上（2012年5月生まれ）は3月で支給が終わるが、数える対象には残る。
    // 3人目が第3子であり続けるかどうかがここで決まる
    const order = birthOrderInMonth(siblings, table, 2028, 12)
    expect(order.get('first')).toBe(1)
    expect(order.get('third')).toBe(3)
  })

  it('上の子が数える対象から外れた月に、下の子の順位が繰り上がって加算が消える', () => {
    // 一番上は2032年5月に上限年齢に達し、2033年3月の年度末で数える対象から外れる。
    // 3人目は2034年3月まで支給が続くので、2033年の途中で第3子から第2子へ変わる
    const janOrder = birthOrderInMonth(siblings, table, 2033, 1)
    const aprOrder = birthOrderInMonth(siblings, table, 2033, 4)
    expect(janOrder.get('third')).toBe(3)
    expect(aprOrder.get('third')).toBe(2)

    const detail = childAllowanceInYear(siblings, table, 2033).byChild.find(
      (entry) => entry.childId === 'third',
    )!
    expect(detail.annualAmount).toBe(3 * 29000 + 9 * 13000)
  })
})

/**
 * ここだけは実際の制度データ（`data/benefit/child-allowance.json`）を使う。
 *
 * 期待値は児童手当法第6条第1項の表から直接引いている。
 * 法文が「年長順に数えて3人目以降に第三子以降算定額を充てる」構造であることの確認であり、
 * domain 側の数え方が条文と一致していることをここで固定する。
 */
describe('実際の制度データ（児童手当法第6条第1項の表との突き合わせ）', () => {
  it('18〜22歳の兄1人＋3歳以上の子2人：10,000 + 30,000×1（法第6条第1項の表）', () => {
    // 兄は2049年3月で支給が終わり、2053年3月までは数える対象として残る
    const olderSibling = makeChild('sibling', 2030, 5)
    const childA = makeChild('a', 2038, 5)
    const childB = makeChild('b', 2040, 5)

    const result = childAllowanceInYear([olderSibling, childA, childB], childAllowance, 2050)

    expect(result.byChild.find((e) => e.childId === 'sibling')!.annualAmount).toBe(0)
    expect(result.byChild.find((e) => e.childId === 'a')!.annualAmount).toBe(12 * 10000)
    expect(result.byChild.find((e) => e.childId === 'b')!.annualAmount).toBe(12 * 30000)
    expect(result.total).toBe(12 * (10000 + 30000))
  })

  it('3歳以上1人＋3歳未満2人：10,000 + 15,000 + 30,000×1（法第6条第1項の表）', () => {
    const childX = makeChild('x', 2014, 5)
    const childA = makeChild('a', 2017, 5)
    const childB = makeChild('b', 2018, 5)

    const result = childAllowanceInYear([childX, childA, childB], childAllowance, 2019)

    expect(result.total).toBe(12 * (10000 + 15000 + 30000))
  })

  it('支給は18歳到達後最初の3月31日で終わる（法第8条第2項）', () => {
    // 2012年5月生まれ → 18歳になるのは2030年5月 → その後最初の年度末は2031年3月
    expect(lastEligibleMonth(makeChild('c', 2012, 5), childAllowance)).toEqual({
      year: 2031,
      month: 3,
    })
  })

  it('子1人なら3歳未満は15,000円、3歳以上は10,000円になる', () => {
    const only = makeChild('only', 2020, 5)
    // 2022年は3歳未満のまま
    expect(householdChildAllowanceInYear([only], childAllowance, 2022)).toBe(12 * 15000)
    // 2023年5月に3歳。5月までは3歳未満、6月から3歳以上（この切り替え月だけが未確定な箇所）
    expect(householdChildAllowanceInYear([only], childAllowance, 2023)).toBe(5 * 15000 + 7 * 10000)
    // 2024年は通年で3歳以上
    expect(householdChildAllowanceInYear([only], childAllowance, 2024)).toBe(12 * 10000)
  })
})

describe('マスタデータの検証', () => {
  it('年齢区分が空なら例外を投げる', () => {
    expect(() => childAllowanceInYear([mayBorn], { ...table, tiers: [] }, 2013)).toThrow(RangeError)
  })

  it('最初の区分が0歳から始まっていなければ例外を投げる', () => {
    const broken: ChildAllowanceTable = {
      ...table,
      tiers: [{ fromAge: 1, monthlyAmount: 21000, monthlyAmountThirdOrLater: 34000 }],
    }
    expect(() => childAllowanceInYear([mayBorn], broken, 2013)).toThrow(RangeError)
  })

  it('区分が昇順でなければ例外を投げる', () => {
    const broken: ChildAllowanceTable = {
      ...table,
      tiers: [
        { fromAge: 0, monthlyAmount: 21000, monthlyAmountThirdOrLater: 34000 },
        { fromAge: 0, monthlyAmount: 13000, monthlyAmountThirdOrLater: 29000 },
      ],
    }
    expect(() => childAllowanceInYear([mayBorn], broken, 2013)).toThrow(RangeError)
  })

  it('月額が負なら例外を投げる', () => {
    const broken: ChildAllowanceTable = {
      ...table,
      tiers: [{ fromAge: 0, monthlyAmount: -1, monthlyAmountThirdOrLater: 34000 }],
    }
    expect(() => childAllowanceInYear([mayBorn], broken, 2013)).toThrow(RangeError)
  })

  it('数える上限年齢が支給終了年齢より小さければ例外を投げる', () => {
    // 支給対象なのに順位が付かない子が出てしまう組み合わせ
    const broken: ChildAllowanceTable = { ...table, birthOrderCountUpToAge: 10 }
    expect(() => childAllowanceInYear([mayBorn], broken, 2013)).toThrow(RangeError)
  })
})

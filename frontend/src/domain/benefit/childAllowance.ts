/**
 * 児童手当。
 *
 * **収入側に計上する（SPEC §2.1）。教育費から差し引かない。**
 * 相殺すると「教育費がいくらかかっていて、そのうちいくらを給付で賄えているか」が見えなくなる。
 *
 * **インフレで増やさない。** 法律で定められた名目の額であり、物価に連動する仕組みが制度にない。
 * 改正されるまで額は動かないので、生活費のように毎年逓増させると受給額を過大に見積もる。
 *
 * **このモジュールは制度の数値を1つも持たない。** 金額・年齢区分・第3子加算の数え方は
 * すべて `ChildAllowanceTable`（マスタデータ）から受け取る。
 * ここにあるのは「いつから・いつまで・第何子として受け取るか」という仕組みだけ
 * （`.claude/rules/institution-data.md`）。
 *
 * **月単位で数える。** 年齢の区分が変わるのも支給が終わるのも年の途中なので、
 * 年単位で丸めると3歳になる年と高校を卒業する年の受給額がずれる。
 * 児童手当法第6条第1項も「月を単位として支給する」と定めている。
 *
 * 支給の始期・終期と第3子加算の構造は児童手当法の条文で裏取りした
 * （`data/benefit/child-allowance.json` の `reference.statute`）。
 * **1点だけ未確定。** 3歳の区分が誕生月から切り替わるのか翌月からかは条文からは決まらない。
 * ここでは翌月として実装している（`tierAgeInMonth`）。差は子1人につき生涯1回・5,000円。
 */

import { sumYen } from '../money'
import type {
  Child,
  ChildAllowanceTable,
  ChildAllowanceTier,
  Month,
  PersonId,
  Year,
  Yen,
} from '../types'

/** 年度末の月。日本の年度は4月に始まり3月に終わる */
const FISCAL_YEAR_END_MONTH: Month = 3

/** 子1人ぶんのその年の受給 */
export type ChildAllowanceDetail = {
  childId: PersonId
  /** その年に支給対象だった月数（0〜12） */
  eligibleMonths: number
  /** その年に受け取る額 */
  annualAmount: Yen
}

/** 世帯のその年の児童手当。内訳を残すのは画面で子ごとに出すため */
export type ChildAllowanceResult = {
  year: Year
  /** 支給が無かった子も 0 円として含む */
  byChild: readonly ChildAllowanceDetail[]
  total: Yen
}

/** 年と月を通し番号にする。月をまたぐ大小比較を素直に書くため */
function absoluteMonth(year: Year, month: number): number {
  return year * 12 + (month - 1)
}

/**
 * `age` 歳に達したあと最初に迎える年度末の暦年。
 *
 * 1〜3月生まれは誕生日と同じ暦年の3月に年度末が来るので1年早く終わる。
 * `expense/education.ts` の入学年と同じ数え方であり、同じ限界を持つ。
 * **入力が月までなので、4月1日生まれと4月2日生まれは区別できない。** 4月生まれは遅い側に倒す。
 */
function fiscalYearEndYearAtAge(child: Child, age: number): Year {
  return child.birthYear + age + (child.birthMonth <= FISCAL_YEAR_END_MONTH ? 0 : 1)
}

/**
 * 支給対象になる最初の月。生まれた月の翌月から受け取れる。
 *
 * @throws {RangeError} 生月が 1〜12 の整数でないとき
 */
export function firstEligibleMonth(child: Child): { year: Year; month: Month } {
  assertChild(child)

  // 12月生まれは翌年1月が初回になる
  const isDecember = child.birthMonth === 12
  return {
    year: isDecember ? child.birthYear + 1 : child.birthYear,
    month: (isDecember ? 1 : child.birthMonth + 1) as Month,
  }
}

/**
 * 支給対象になる最後の月。支給終了年齢に達したあと最初の年度末（3月）まで。
 *
 * @throws {RangeError} 生月またはマスタデータが不正なとき
 */
export function lastEligibleMonth(
  child: Child,
  table: ChildAllowanceTable,
): { year: Year; month: Month } {
  assertChild(child)
  assertTable(table)

  return {
    year: fiscalYearEndYearAtAge(child, table.eligibilityEndAge),
    month: FISCAL_YEAR_END_MONTH,
  }
}

/** その月に支給の対象か */
function isEligibleInMonth(
  child: Child,
  table: ChildAllowanceTable,
  year: Year,
  month: number,
): boolean {
  const current = absoluteMonth(year, month)
  const first = firstEligibleMonth(child)
  const last = lastEligibleMonth(child, table)

  return (
    current >= absoluteMonth(first.year, first.month) &&
    current <= absoluteMonth(last.year, last.month)
  )
}

/**
 * その月に「第何子か」を数える対象に入るか。
 *
 * **支給対象より広い。** 既に支給が終わった上の子も、上限年齢の年度末までは
 * 第1子として数える。ここを狭めると下の子が第3子から第2子へ繰り上がり、加算が消える。
 *
 * **実際には、上の子を数えるには監護相当の世話と生計費の負担が要る**
 * （児童手当法第6条第2項第2号。市町村は確認書で審査する）。
 * このモデルは入力された子がすべて要件を満たす前提で数えるため、
 * 実際には加算が付かないことがありうる。上振れ側の見積もりになる。
 */
function isCountedInMonth(
  child: Child,
  table: ChildAllowanceTable,
  year: Year,
  month: number,
): boolean {
  const current = absoluteMonth(year, month)
  // 数えるのは生まれた月から。支給開始（翌月）より1か月早い
  const born = absoluteMonth(child.birthYear, child.birthMonth)
  const countEnd = absoluteMonth(
    fiscalYearEndYearAtAge(child, table.birthOrderCountUpToAge),
    FISCAL_YEAR_END_MONTH,
  )

  return current >= born && current <= countEnd
}

/**
 * その月の年齢区分を引くための年齢。
 *
 * **誕生日の月はまだ前の区分**で、翌月から新しい区分になる。
 * 5月生まれの子が3歳になる年の5月はまだ「3歳未満」の額で、6月から切り替わる。
 */
function tierAgeInMonth(child: Child, year: Year, month: number): number {
  return year - child.birthYear - (month <= child.birthMonth ? 1 : 0)
}

/** 年齢に対応する区分を引く。`fromAge` が年齢以下である最後の区分 */
function tierForAge(table: ChildAllowanceTable, age: number): ChildAllowanceTier {
  let matched = table.tiers[0]!
  for (const tier of table.tiers) {
    if (tier.fromAge <= age) {
      matched = tier
    }
  }
  return matched
}

/** 年長順（生年月の昇順）。第1子から数えるため */
function compareByBirth(a: Child, b: Child): number {
  return a.birthYear - b.birthYear || a.birthMonth - b.birthMonth
}

/**
 * その年の児童手当を子ごとに求める。
 *
 * 第何子かは月ごとに数え直す。上の子が数える対象から外れた月に
 * 下の子の順位が繰り上がり、第3子加算が消えるため。
 *
 * @throws {RangeError} 年・生月・マスタデータが不正なとき、または子の id が重複しているとき
 */
export function childAllowanceInYear(
  children: readonly Child[],
  table: ChildAllowanceTable,
  year: Year,
): ChildAllowanceResult {
  if (!Number.isInteger(year)) {
    throw new RangeError(`年は整数で指定してください: ${year}`)
  }
  assertTable(table)
  assertUniqueIds(children)
  for (const child of children) {
    assertChild(child)
  }

  // 子ごとに、支給対象だった月の月額を溜める
  const monthlyAmounts = new Map<PersonId, Yen[]>(children.map((child) => [child.id, []]))

  for (let month = 1; month <= 12; month++) {
    const orderById = birthOrderInMonth(children, table, year, month)

    for (const child of children) {
      if (!isEligibleInMonth(child, table, year, month)) {
        continue
      }

      const tier = tierForAge(table, tierAgeInMonth(child, year, month))
      // 支給対象なら必ず数える対象にも入る（assertTable で上限年齢の大小を保証している）
      const order = orderById.get(child.id)!
      const amount = order >= 3 ? tier.monthlyAmountThirdOrLater : tier.monthlyAmount

      monthlyAmounts.get(child.id)!.push(amount)
    }
  }

  const byChild: ChildAllowanceDetail[] = children.map((child) => {
    const amounts = monthlyAmounts.get(child.id)!
    return {
      childId: child.id,
      eligibleMonths: amounts.length,
      annualAmount: sumYen(amounts),
    }
  })

  return {
    year,
    byChild,
    total: sumYen(byChild.map((detail) => detail.annualAmount)),
  }
}

/**
 * ある月の児童手当を子ごとに求める（2026-11-17 に足した。`childAllowanceInYear` の 1 か月ぶんと同じ数え方）。
 *
 * 新しい中核（`domain/plan/`）は帯を月で持つので、3 歳の区分の切り替わりや第 3 子の加算の付き外れを
 * 月の単位で帯にするために使う。12 か月の合計は `childAllowanceInYear` の子ごとの年額と一致する（テストで固定）。
 * 支給の対象でない子は 0 円として含む。
 *
 * @throws {RangeError} 年・月・生月・マスタデータが不正なとき、または子の id が重複しているとき
 */
export function childAllowanceInMonth(
  children: readonly Child[],
  table: ChildAllowanceTable,
  year: Year,
  month: number,
): ReadonlyMap<PersonId, Yen> {
  if (!Number.isInteger(year)) {
    throw new RangeError(`年は整数で指定してください: ${year}`)
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`月は 1〜12 の整数で指定してください: ${month}`)
  }
  assertTable(table)
  assertUniqueIds(children)
  for (const child of children) {
    assertChild(child)
  }

  const orderById = birthOrderInMonth(children, table, year, month)
  const amounts = new Map<PersonId, Yen>()
  for (const child of children) {
    if (!isEligibleInMonth(child, table, year, month)) {
      amounts.set(child.id, 0)
      continue
    }
    const tier = tierForAge(table, tierAgeInMonth(child, year, month))
    // 支給対象なら必ず数える対象にも入る（assertTable で上限年齢の大小を保証している）
    const order = orderById.get(child.id)!
    amounts.set(child.id, order >= 3 ? tier.monthlyAmountThirdOrLater : tier.monthlyAmount)
  }
  return amounts
}

/** 世帯のその年の児童手当の合計。年次シミュレーションが使う入口 */
export function householdChildAllowanceInYear(
  children: readonly Child[],
  table: ChildAllowanceTable,
  year: Year,
): Yen {
  return childAllowanceInYear(children, table, year).total
}

/**
 * その月に「第何子」として扱われるかを子ごとに返す。数える対象外の子は含まない。
 *
 * 内訳を確認したい場面（第3子加算が付く／付かないの説明）で使えるように公開する。
 */
export function birthOrderInMonth(
  children: readonly Child[],
  table: ChildAllowanceTable,
  year: Year,
  month: number,
): ReadonlyMap<PersonId, number> {
  const counted = children
    .filter((child) => isCountedInMonth(child, table, year, month))
    .sort(compareByBirth)

  return new Map(counted.map((child, index) => [child.id, index + 1]))
}

/**
 * 子の生年月を検証する。
 *
 * 型では `Month` に絞っているが、JSON の読み込みなど型の外から壊れた値が入りうる。
 *
 * @throws {RangeError} 生年が整数でない、または生月が 1〜12 の整数でないとき
 */
function assertChild(child: Child): void {
  if (!Number.isInteger(child.birthYear)) {
    throw new RangeError(`生年は整数で指定してください: ${child.birthYear}`)
  }
  if (!Number.isInteger(child.birthMonth) || child.birthMonth < 1 || child.birthMonth > 12) {
    throw new RangeError(`生月は 1〜12 で指定してください: ${child.birthMonth}`)
  }
}

/**
 * 子の id が重複していないことを確かめる。
 *
 * 重複すると内訳の Map が上書きされ、片方の受給額が黙って消える。
 *
 * @throws {RangeError} id が重複しているとき
 */
function assertUniqueIds(children: readonly Child[]): void {
  const seen = new Set<PersonId>()
  for (const child of children) {
    if (seen.has(child.id)) {
      throw new RangeError(`子の id が重複しています: ${child.id}`)
    }
    seen.add(child.id)
  }
}

/**
 * マスタデータの形を検証する。
 *
 * 制度データは JSON から来るため、型では守れない前提をここで落とす。
 *
 * @throws {RangeError} 区分が空・順序が昇順でない・金額が負・上限年齢の大小が逆のとき
 */
function assertTable(table: ChildAllowanceTable): void {
  if (table.tiers.length === 0) {
    throw new RangeError('児童手当の年齢区分が空です')
  }
  if (table.tiers[0]!.fromAge !== 0) {
    throw new RangeError(`最初の年齢区分は 0 歳から始めてください: ${table.tiers[0]!.fromAge}`)
  }

  let previousFromAge = -1
  for (const tier of table.tiers) {
    if (!Number.isInteger(tier.fromAge) || tier.fromAge <= previousFromAge) {
      throw new RangeError(`年齢区分は昇順の整数で指定してください: ${tier.fromAge}`)
    }
    previousFromAge = tier.fromAge

    for (const amount of [tier.monthlyAmount, tier.monthlyAmountThirdOrLater]) {
      if (!Number.isFinite(amount) || amount < 0) {
        throw new RangeError(`児童手当の月額は 0 以上の有限の数値で指定してください: ${amount}`)
      }
    }
  }

  if (!Number.isInteger(table.eligibilityEndAge) || table.eligibilityEndAge < 0) {
    throw new RangeError(
      `支給終了年齢は 0 以上の整数で指定してください: ${table.eligibilityEndAge}`,
    )
  }
  // 数える対象が支給対象より狭いと、支給対象なのに順位が付かない子が出る
  if (table.birthOrderCountUpToAge < table.eligibilityEndAge) {
    throw new RangeError(
      `第何子かを数える上限年齢は支給終了年齢以上である必要があります: ` +
        `${table.birthOrderCountUpToAge} < ${table.eligibilityEndAge}`,
    )
  }
}

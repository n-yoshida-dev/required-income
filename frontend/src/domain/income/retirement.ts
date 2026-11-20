/**
 * 老後の収入（公的年金・退職金）の年次展開。
 *
 * **世帯合計で持たない**（SPEC §2.11 / 決定 D10）。
 * 会社員と個人事業主では退職金の有無が違い、年金も繰上げ・繰下げで
 * 開始年齢が人ごとに変わる。「片方だけ受給している数年間」を表すため、
 * 人ごとに求めてから世帯で合計する。
 *
 * **税を引かずそのまま返す。** 公的年金等控除・退職所得控除により実際の税負担は小さい。
 * 給与・事業の手取りはフェーズ 2 で実計算になったが（`tax/household.ts`）、年金と退職金は
 * 公的年金等控除が未裏取りのため据え置いてある。収入をやや多めに見る向きの簡略化（TODO）。
 */

import { roundYen, sumYen } from '../money'
import type { Person, PersonRetirement, Rate, Year, Yen } from '../types'
import { lastWorkingYear } from './gross'

/**
 * 年金の改定。起点年の見込み額を `rate` で毎年伸ばす（`Assumptions.pensionIndexationRate`）。
 * 生活費のインフレと同じく、起点年からの経過年数で複利にする。
 */
export type PensionIndexation = {
  rate: Rate
  baseYear: Year
}

/**
 * ある年の1人ぶんの公的年金。
 *
 * 受給開始年齢に達した年（`birthYear + pensionStartAge`）から、
 * 寿命想定の年（`birthYear + lifeExpectancy`）まで受け取る。
 * どちらも境界の年を含む（就労の `lastWorkingYear` と同じく、最終年は満額で扱う）。
 *
 * 額は起点年の物価での見込み額（`annualPension`）を改定率で伸ばしたもの。
 * 起点年より前の年は伸ばさない（起点年より前に計算することは無いが、負の指数にしない）。
 *
 * @throws {RangeError} 年金額・受給開始年齢・年・改定率が不正なとき
 */
export function pensionInYear(
  person: Person,
  retirement: PersonRetirement,
  year: Year,
  indexation: PensionIndexation,
): Yen {
  assertYear(year)
  assertPersonRetirement(retirement)
  assertIndexation(indexation)

  const startYear = person.birthYear + retirement.pensionStartAge
  const endYear = person.birthYear + person.lifeExpectancy
  if (year < startYear || year > endYear) return 0
  const years = Math.max(0, year - indexation.baseYear)
  return roundYen(retirement.annualPension * Math.pow(1 + indexation.rate, years))
}

/**
 * ある年の1人ぶんの退職金。受け取る年だけ全額を返し、それ以外の年は 0。
 *
 * 受取年（`severanceYear`）が null なら、就労を終える年
 * （`lastWorkingYear` ＝ `birthYear + retirementAge`）に受け取るものとする。
 *
 * @throws {RangeError} 退職金・受取年・年が不正なとき
 */
export function severancePayInYear(person: Person, retirement: PersonRetirement, year: Year): Yen {
  assertYear(year)
  assertPersonRetirement(retirement)

  const payoutYear = retirement.severanceYear ?? lastWorkingYear(person)
  return year === payoutYear ? retirement.severancePay : 0
}

/** 世帯のその年の老後収入。年金と退職金を分けて返す（表示の内訳が違うため） */
export type HouseholdRetirementIncome = {
  year: Year
  /** 公的年金の世帯合計 */
  pension: Yen
  /** 退職金の世帯合計（受け取る年以外は 0） */
  severancePay: Yen
}

/**
 * 世帯のその年の年金・退職金を合計する。
 *
 * `retirement.byPerson` に載っていない世帯員は「年金も退職金も無い」として扱う。
 * 逆に、存在しない世帯員を指す設定は入力の組み立てミスなので例外で落とす
 * （黙って無視すると、id の書き間違いで年金が丸ごと消えたまま計算が通ってしまう）。
 *
 * @throws {RangeError} 存在しない世帯員を指す設定があるとき、同じ世帯員の設定が重複しているとき
 */
export function householdRetirementIncomeInYear(
  adults: readonly Person[],
  byPerson: readonly PersonRetirement[],
  year: Year,
  indexation: PensionIndexation,
): HouseholdRetirementIncome {
  const personById = new Map(adults.map((person) => [person.id, person]))

  const seen = new Set<string>()
  const pensions: Yen[] = []
  const severances: Yen[] = []

  for (const retirement of byPerson) {
    const person = personById.get(retirement.personId)
    if (person === undefined) {
      throw new RangeError(
        `老後の設定が未登録の世帯員を指しています: personId=${retirement.personId}`,
      )
    }
    if (seen.has(retirement.personId)) {
      throw new RangeError(`老後の設定が重複しています: personId=${retirement.personId}`)
    }
    seen.add(retirement.personId)

    pensions.push(pensionInYear(person, retirement, year, indexation))
    severances.push(severancePayInYear(person, retirement, year))
  }

  return {
    year,
    pension: sumYen(pensions),
    severancePay: sumYen(severances),
  }
}

/**
 * 年金の改定の指定を検証する。
 *
 * @throws {RangeError} 改定率が有限でない・−100% 以下、起点年が整数でないとき
 */
function assertIndexation(indexation: PensionIndexation): void {
  if (!Number.isFinite(indexation.rate) || indexation.rate <= -1) {
    throw new RangeError(`年金の改定率が不正です: ${indexation.rate}`)
  }
  if (!Number.isInteger(indexation.baseYear)) {
    throw new RangeError(`年金の改定の起点年は整数で指定してください: ${indexation.baseYear}`)
  }
}

/**
 * 年の指定を検証する。
 *
 * @throws {RangeError} 整数でないとき
 */
function assertYear(year: Year): void {
  if (!Number.isInteger(year)) {
    throw new RangeError(`年は整数で指定してください: ${year}`)
  }
}

/**
 * 1人ぶんの老後の設定を検証する。
 *
 * @throws {RangeError} 年金額・退職金・受給開始年齢・受取年が不正なとき
 */
function assertPersonRetirement(retirement: PersonRetirement): void {
  if (!Number.isFinite(retirement.annualPension) || retirement.annualPension < 0) {
    throw new RangeError(
      `年金の年額は 0 以上の有限の数値で指定してください: ${retirement.annualPension}`,
    )
  }
  if (!Number.isFinite(retirement.severancePay) || retirement.severancePay < 0) {
    throw new RangeError(
      `退職金は 0 以上の有限の数値で指定してください: ${retirement.severancePay}`,
    )
  }
  if (!Number.isInteger(retirement.pensionStartAge) || retirement.pensionStartAge < 0) {
    throw new RangeError(
      `年金の受給開始年齢は 0 以上の整数で指定してください: ${retirement.pensionStartAge}`,
    )
  }
  if (retirement.severanceYear !== null && !Number.isInteger(retirement.severanceYear)) {
    throw new RangeError(
      `退職金の受取年は整数か null で指定してください: ${retirement.severanceYear}`,
    )
  }
}

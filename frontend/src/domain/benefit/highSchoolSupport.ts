/**
 * 高等学校等就学支援金。
 *
 * **収入側に計上する（SPEC §2.1）。教育費から差し引かない。**
 * 児童手当と同じ扱い。相殺すると「高校にいくらかかっていて、そのうちいくらを
 * 給付で賄えているか」が見えなくなる。
 *
 * **前年所得に依存しない。** 2026年4月1日施行の改正で、所得による支給制限と
 * 私立向けの加算が条文から消えた。現行の条文（`data/benefit/high-school-support.json` の
 * `reference.statute`）には「所得」「課税標準額」「保護者」「加算」がいずれも登場しない。
 * したがってこのモジュールは `TaxBase` を受け取らない。
 * 保育料・住民税・国民健康保険料とは違い、1年ずれの持ち回りが要らない。
 *
 * 支給額の決まり方は法第5条第1項ひとつだけ：
 *
 * ```
 * 1か月の支給額 = min(授業料の月額, 支給限度額)
 * ```
 *
 * 支給限度額は設置者・種類・課程ごとに政令で定められる。
 * **授業料の側もモデルに要る。** 限度額だけでは、授業料が限度額を下回る学校の
 * 自己負担を出せない（支援金も授業料までで頭打ちになる）。
 *
 * **支給限度額をインフレで増やさない。** 政令で定められた名目の額であり、
 * 物価に連動する仕組みが制度にない。改正されるまで動かない。
 * 一方で授業料は `expense/education.ts` と同じくインフレで逓増させる。
 * この非対称は意図したもので、限度額が据え置かれるほど自己負担が増えていく実態を表す。
 *
 * **扱わないもの：** 高等専門学校・専修学校・各種学校（法第2条第4号・第5号）、
 * 定時制・通信制の課程。入力の `Child` が全日制の高校しか表せないため。
 */

import { roundYen, sumYen } from '../money'
import { gradeInYear, stageInYear } from '../expense/education'
import type { Child, HighSchoolSupportTable, PersonId, Rate, Year, Yen } from '../types'

/** 高校の最初の学年。小1 = 1 から数えて高1 = 10 */
const FIRST_HIGH_SCHOOL_GRADE = 10

/** 1年ぶんの月数。暦年を年度として扱うため、在学中の年は12か月として数える */
const MONTHS_PER_YEAR = 12

/** 子1人ぶんのその年の支給 */
export type HighSchoolSupportDetail = {
  childId: PersonId
  /** その年に支給対象だった月数（0〜12） */
  supportedMonths: number
  /** その年に受け取る額 */
  annualAmount: Yen
}

/** 世帯のその年の就学支援金。内訳を残すのは画面で子ごとに出すため */
export type HighSchoolSupportResult = {
  year: Year
  /** 支給が無かった子も 0 円として含む */
  byChild: readonly HighSchoolSupportDetail[]
  total: Yen
}

/**
 * その年に支給の対象となる月数。
 *
 * **通算36月の上限を高校在学中の経過で数える**（法第3条第2項第2号）。
 * 高1から数えて既に使った月数を差し引くので、上限が36月より短い制度に変わっても
 * 3年目が途中で打ち切られる形で正しく効く。
 *
 * 暦年を年度として扱うため、在学中の年は12か月とする（`expense/education.ts` と同じ簡略化）。
 */
function supportedMonthsInYear(child: Child, table: HighSchoolSupportTable, year: Year): number {
  if (stageInYear(child, year) !== 'highSchool') {
    return 0
  }

  // 高1を 0 として、その年の開始時点までに使い切った月数
  const alreadyUsed = (gradeInYear(child, year) - FIRST_HIGH_SCHOOL_GRADE) * MONTHS_PER_YEAR
  const remaining = table.maxSupportedMonths - alreadyUsed

  return Math.max(0, Math.min(MONTHS_PER_YEAR, remaining))
}

/**
 * ある年の就学支援金を子1人ぶん求める。
 *
 * @param baseYear 計算の起点となる年。授業料はこの年の水準として扱う
 * @param inflationRate 授業料に掛けるインフレ率。**支給限度額には掛けない**
 * @throws {RangeError} 年・インフレ率・授業料・マスタデータが不正なとき
 */
export function highSchoolSupportInYear(
  child: Child,
  table: HighSchoolSupportTable,
  inflationRate: Rate,
  baseYear: Year,
  year: Year,
): HighSchoolSupportDetail {
  if (!Number.isInteger(baseYear) || !Number.isInteger(year)) {
    throw new RangeError(`年は整数で指定してください: baseYear=${baseYear}, year=${year}`)
  }
  if (year < baseYear) {
    throw new RangeError(`起点より前の年は計算できません: baseYear=${baseYear}, year=${year}`)
  }
  if (!Number.isFinite(inflationRate) || inflationRate <= -1) {
    throw new RangeError(`インフレ率が不正です: ${inflationRate}`)
  }
  assertTable(table)
  assertChild(child)

  const months = supportedMonthsInYear(child, table, year)
  if (months === 0) {
    return { childId: child.id, supportedMonths: 0, annualAmount: 0 }
  }

  // 授業料はインフレで逓増させる（教育費側と揃える）
  const priceIndex = Math.pow(1 + inflationRate, year - baseYear)
  const annualTuition =
    (child.annualHighSchoolTuition ?? table.standardAnnualTuition[child.highSchoolType]) *
    priceIndex

  // 法第5条第1項の比較は月額どうし。月単位で小さい方を取り、月数を掛けてから1回だけ丸める
  const monthlyTuition = annualTuition / MONTHS_PER_YEAR
  const monthlyLimit = table.monthlyLimit[child.highSchoolType]

  return {
    childId: child.id,
    supportedMonths: months,
    annualAmount: roundYen(Math.min(monthlyTuition, monthlyLimit) * months),
  }
}

/**
 * 世帯の子ども全員ぶんのその年の就学支援金。
 *
 * **子が複数いる年は支給も重なる。** 兄弟が同時に高校に通う年は
 * 教育費の山が高くなるが、支援金も2人ぶん入る。両方をそのまま出す。
 *
 * @throws {RangeError} 子の id が重複しているとき、その他の入力が不正なとき
 */
export function householdHighSchoolSupportInYear(
  children: readonly Child[],
  table: HighSchoolSupportTable,
  inflationRate: Rate,
  baseYear: Year,
  year: Year,
): HighSchoolSupportResult {
  assertUniqueIds(children)

  const byChild = children.map((child) =>
    highSchoolSupportInYear(child, table, inflationRate, baseYear, year),
  )

  return {
    year,
    byChild,
    total: sumYen(byChild.map((detail) => detail.annualAmount)),
  }
}

/**
 * 子の入力を検証する。
 *
 * @throws {RangeError} 授業料の上書き値が負または有限でないとき
 */
function assertChild(child: Child): void {
  const tuition = child.annualHighSchoolTuition
  if (tuition !== null && (!Number.isFinite(tuition) || tuition < 0)) {
    throw new RangeError(`高校の授業料は 0 以上の有限の数値で指定してください: ${tuition}`)
  }
}

/**
 * 子の id が重複していないことを確かめる。
 *
 * 重複したまま合計すると、同じ子の支給を二重に数えても気づけない。
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
 * **`hasIncomeLimit` が true なら例外を投げる。** このモジュールは所得判定を実装していない。
 * 制限のある制度データを黙って計算すると、本来は支給されない世帯にも満額を計上して
 * 必要年収を過小に見積もる。将来の改正で所得制限が復活したら、静かに間違えるのではなく
 * ここで落ちて実装を促す方を選んだ。
 *
 * @throws {RangeError} 金額が負・上限月数が不正・所得制限ありのとき
 */
function assertTable(table: HighSchoolSupportTable): void {
  if (table.hasIncomeLimit) {
    throw new RangeError(
      '所得制限のある就学支援金の制度データには未対応です。' +
        '所得判定を実装するまで、このデータで計算すると受給額を上振れさせます',
    )
  }

  for (const amount of [
    table.monthlyLimit.public,
    table.monthlyLimit.private,
    table.standardAnnualTuition.public,
    table.standardAnnualTuition.private,
  ]) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError(`就学支援金の金額は 0 以上の有限の数値で指定してください: ${amount}`)
    }
  }

  if (!Number.isInteger(table.maxSupportedMonths) || table.maxSupportedMonths <= 0) {
    throw new RangeError(
      `支給を受けられる通算月数は 1 以上の整数で指定してください: ${table.maxSupportedMonths}`,
    )
  }
}

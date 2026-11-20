/**
 * 保育料（保育園・認定こども園の利用者負担額）と、園に払う実費。
 *
 * **フェーズ1は手入力**（SPEC §2.5）。自治体の階層表を前年の市町村民税所得割額で引く
 * 自動計算は、住民税の実装とセットでフェーズ2に回す。ここが担うのは2つだけ。
 *
 * 1. 通っている年だけ費用を計上する（入園年 〜 小学校入学の前年）
 * 2. **無償化されるクラス年齢に達した年から保育料を 0 にする**
 *
 * ## 歳児クラスは誕生日ではなく4月1日時点の年齢で決まる
 *
 * 3歳児クラス（年少）は「満3歳の誕生日」からではなく、
 * **その年度の4月1日に3歳である**子が入るクラスである。したがって学年とまったく同じ切り方になり、
 * 早生まれ（1〜3月生まれ）は1年早く上がる。
 * 学年の計算を `expense/education.ts` から借りているのはこのためで、規則を2か所に書かない。
 *
 * ## 保育料はインフレさせない。実費はさせる
 *
 * 保育料は自治体が定める階層表の名目額で、物価に連動する仕組みが制度にない
 * （就学支援金の支給限度額と同じ性質）。一方で給食費・教材費・行事費は実際の物価で動くため、
 * `expense/education.ts` の給食費と揃えてインフレで逓増させる。
 * **同じ計算の中でインフレを掛ける側と掛けない側が並ぶのは意図したもの。**
 *
 * ## 扱わないもの（フェーズ1の割り切り）
 *
 * - **所得による減免**（住民税非課税世帯の0〜2歳児無償化・多子軽減・副食費の免除）。
 *   保育料は入力された現在額に既に反映されている前提で扱う。
 *   副食費の免除は目安額に反映しないので、**該当世帯では給食費の既定値が上振れる**。
 *   主食費は国の目安が無く、`mealFee.json` のアプリの判断値（施設一覧の中央値）で足している
 * - **前年所得に応じた階層の上下。** 額は起点年の水準で据え置く。
 *   所得が伸びる世帯では実際には階層が上がるので、**費用は下振れする側に倒れている**
 * - **転居による階層表の切り替え。** 自治体が変われば表も変わるが、手入力なので額は動かない
 * - 幼稚園・預かり保育の施設等利用給付。`Child` が通園先の種類を表せない
 * - **年度の途中の入園。** 暦年を年度として扱うため（`expense/education.ts` と同じ簡略化）、
 *   年の途中から通い始めても、その暦年は12か月ぶんとして数える
 */

import { roundYen, sumYen } from '../money'
import { gradeInYear, schoolEntryYear } from '../expense/education'
import type {
  Child,
  ChildcareEnrollment,
  ChildcareTable,
  PersonId,
  Rate,
  Year,
  Yen,
} from '../types'

/**
 * 学年（小1 = 1）から歳児クラスへの差。
 * 小学校に入学する年は6歳児クラスにあたるので、学年に 5 を足すとクラス年齢になる。
 */
const CLASS_AGE_OFFSET = 5

/** 小学校に入学する年のクラス年齢。これ以上になったら保育園の対象外 */
const SCHOOL_ENTRY_CLASS_AGE = 6

/** 1年ぶんの月数。暦年を年度として扱うため、在園中の年は12か月として数える */
const MONTHS_PER_YEAR = 12

/** 子1人ぶんのその年の保育の費用 */
export type ChildcareCost = {
  year: Year
  childId: PersonId
  /**
   * その年度の歳児クラス（0歳児クラス = 0、5歳児クラス = 5）。
   * 生まれる前は負、小学校へ入学した年からは 6 以上になる。
   */
  classAge: number
  /** その年に保育園に通っているか */
  enrolled: boolean
  /** 保育料。無償化されるクラス年齢に達していれば 0 */
  fee: Yen
  /** 保育料以外の実費（給食費・教材費・行事費など） */
  extraCost: Yen
  /** 上記の合計 */
  total: Yen
}

/** 世帯のその年の保育の費用。通っていない子も 0 円として含む */
export type ChildcareResult = {
  year: Year
  byChild: readonly ChildcareCost[]
  total: Yen
}

/**
 * その年度の歳児クラス。0歳児クラスが 0、5歳児クラスが 5。
 *
 * **4月1日時点の年齢で決まる。** 満年齢ではないので誕生日では上がらない。
 * 学年と同じ切り方なので `expense/education.ts` の学年計算から導く
 * （早生まれの扱いを2か所に書かないため）。
 *
 * @throws {RangeError} 生月が 1〜12 の整数でないとき（学年計算から伝播する）
 */
export function nurseryClassAge(child: Child, year: Year): number {
  return gradeInYear(child, year) + CLASS_AGE_OFFSET
}

/**
 * その子の保育料が無償になる年（＝無償化されるクラス年齢の4月がある暦年）。
 *
 * ゴールシークが区間を切るのに使う（SPEC §2.2 の `childcareFree`）。
 * **入園しているかどうかは見ない。** 制度上いつ無償になるかだけを返す。
 *
 * @throws {RangeError} マスタデータまたは生月が不正なとき
 */
export function childcareFreeFromYear(child: Child, table: ChildcareTable): Year {
  assertTable(table)
  return schoolEntryYear(child) - (SCHOOL_ENTRY_CLASS_AGE - table.freeFromClassAge)
}

/**
 * ある年の保育の費用を子1人ぶん求める。
 *
 * @param enrollment その子の入園の情報。保育園に通わないなら `null`
 * @param baseYear 計算の起点となる年。実費の月額はこの年の水準として扱う
 * @param inflationRate 実費に掛けるインフレ率。**保育料には掛けない**
 * @throws {RangeError} 年・インフレ率・マスタデータ・入園の情報が不正なとき
 */
export function childcareCostInYear(
  child: Child,
  enrollment: ChildcareEnrollment | null,
  table: ChildcareTable,
  inflationRate: Rate,
  baseYear: Year,
  year: Year,
): ChildcareCost {
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

  const classAge = nurseryClassAge(child, year)
  const notEnrolled = {
    year,
    childId: child.id,
    classAge,
    enrolled: false,
    fee: 0,
    extraCost: 0,
    total: 0,
  }

  if (enrollment === null) {
    return notEnrolled
  }
  assertEnrollment(enrollment, child)

  // 生まれる前・入園前・小学校入学後は対象外
  if (year < enrollment.fromYear || classAge < 0 || classAge >= SCHOOL_ENTRY_CLASS_AGE) {
    return notEnrolled
  }

  const free = classAge >= table.freeFromClassAge

  // 保育料は階層表の名目額なのでインフレさせない
  const fee = free ? 0 : roundYen(enrollment.monthlyFee * MONTHS_PER_YEAR)

  // 実費は実際の物価で動くので、教育費の給食費と揃えて逓増させる
  const priceIndex = Math.pow(1 + inflationRate, year - baseYear)
  const monthlyExtra = free
    ? monthlyExtraCostAfterFree(enrollment, table)
    : enrollment.monthlyExtraCost
  const extraCost = roundYen(monthlyExtra * MONTHS_PER_YEAR * priceIndex)

  return {
    year,
    childId: child.id,
    classAge,
    enrolled: true,
    fee,
    extraCost,
    total: sumYen([fee, extraCost]),
  }
}

/**
 * 世帯の子ども全員ぶんのその年の保育の費用。
 *
 * **兄弟が同時に通う年は費用が重なる。** 0〜2歳児クラスが2人並ぶ年は保育料が2人ぶん乗るので、
 * 平らに均さずそのまま出す。通っていない子も 0 円として `byChild` に含めるのは、
 * 画面で子ごとに並べたときに行が消えないようにするため。
 *
 * @throws {RangeError} 子の id が重複、入園の情報が重複、または存在しない子を指しているとき
 */
export function householdChildcareCostInYear(
  children: readonly Child[],
  enrollments: readonly ChildcareEnrollment[],
  table: ChildcareTable,
  inflationRate: Rate,
  baseYear: Year,
  year: Year,
): ChildcareResult {
  assertUniqueChildIds(children)
  const byChildId = indexEnrollments(enrollments, children)

  const byChild = children.map((child) =>
    childcareCostInYear(
      child,
      byChildId.get(child.id) ?? null,
      table,
      inflationRate,
      baseYear,
      year,
    ),
  )

  return {
    year,
    byChild,
    total: sumYen(byChild.map((cost) => cost.total)),
  }
}

/**
 * 入園の情報を子の id で引けるようにする。
 *
 * **存在しない子を指す入園の情報は落とさずに投げる。** 黙って無視すると、
 * 子の id を書き間違えたときに保育料が丸ごと消えたまま計算が通ってしまう。
 *
 * @throws {RangeError} 同じ子に複数の入園の情報があるとき、子が見つからないとき
 */
function indexEnrollments(
  enrollments: readonly ChildcareEnrollment[],
  children: readonly Child[],
): Map<PersonId, ChildcareEnrollment> {
  const childIds = new Set(children.map((child) => child.id))
  const byChildId = new Map<PersonId, ChildcareEnrollment>()

  for (const enrollment of enrollments) {
    if (!childIds.has(enrollment.childId)) {
      throw new RangeError(`入園の情報が存在しない子を指しています: ${enrollment.childId}`)
    }
    if (byChildId.has(enrollment.childId)) {
      throw new RangeError(`同じ子に複数の入園の情報があります: ${enrollment.childId}`)
    }
    byChildId.set(enrollment.childId, enrollment)
  }

  return byChildId
}

/**
 * 無償化されたあとの実費の月額。
 *
 * 入力があればそれを使う。**無ければ「今の実費 + マスタデータの副食費の目安 + 主食費の既定値」で置く。**
 * 無償化されるのは保育料だけで、3歳児クラス以降は給食費（主食費・副食費）が
 * 実費徴収に切り替わる。教材費・行事費はそのまま続くので、
 * 今の実費を給食費で置き換えるのではなく、上に足すのが実態に合う。
 *
 * これから3歳児クラスに上がる子の給食費は利用者にはまだ分からない額なので、
 * 入力必須にすると埋められない。構造だけを置いて金額はマスタデータから引く。
 *
 * 副食費は国の目安、主食費は国の目安が無いためアプリの判断値（`mealFee.json`）。
 * どちらも園ごとに違うので、園の実額が分かり次第 `monthlyExtraCostAfterFree` で上書きするのが確実。
 */
function monthlyExtraCostAfterFree(enrollment: ChildcareEnrollment, table: ChildcareTable): Yen {
  return (
    enrollment.monthlyExtraCostAfterFree ??
    enrollment.monthlyExtraCost +
      table.standardMonthlySideDishCost +
      table.standardMonthlyStapleFoodCost
  )
}

/**
 * 入園の情報を検証する。
 *
 * @throws {RangeError} 対象の子と対応していない、入園年が整数でない、月額が負のとき
 */
function assertEnrollment(enrollment: ChildcareEnrollment, child: Child): void {
  if (enrollment.childId !== child.id) {
    throw new RangeError(
      `入園の情報が別の子のものです: enrollment=${enrollment.childId}, child=${child.id}`,
    )
  }
  if (!Number.isInteger(enrollment.fromYear)) {
    throw new RangeError(`入園する年は整数で指定してください: ${enrollment.fromYear}`)
  }
  const amounts = [enrollment.monthlyFee, enrollment.monthlyExtraCost]
  if (enrollment.monthlyExtraCostAfterFree !== null) {
    amounts.push(enrollment.monthlyExtraCostAfterFree)
  }
  for (const amount of amounts) {
    if (!Number.isFinite(amount) || amount < 0) {
      throw new RangeError(`保育の月額は 0 以上の有限の数値で指定してください: ${amount}`)
    }
  }
}

/**
 * マスタデータの形を検証する。
 *
 * 制度データは JSON から来るため、型では守れない前提をここで落とす。
 * 無償化のクラス年齢が 6 以上だと小学校入学まで無償にならず、
 * 「無償化」という制度そのものが表せていないことになるので範囲を切る。
 *
 * @throws {RangeError} 無償化のクラス年齢が 0〜6 の整数でないとき
 */
function assertTable(table: ChildcareTable): void {
  const { freeFromClassAge } = table
  if (
    !Number.isInteger(freeFromClassAge) ||
    freeFromClassAge < 0 ||
    freeFromClassAge > SCHOOL_ENTRY_CLASS_AGE
  ) {
    throw new RangeError(
      `無償化のクラス年齢は 0〜${SCHOOL_ENTRY_CLASS_AGE} の整数で指定してください: ${freeFromClassAge}`,
    )
  }
  if (
    !Number.isFinite(table.standardMonthlySideDishCost) ||
    table.standardMonthlySideDishCost < 0
  ) {
    throw new RangeError(
      `副食費の目安額は 0 以上の有限の数値で指定してください: ${table.standardMonthlySideDishCost}`,
    )
  }
  if (
    !Number.isFinite(table.standardMonthlyStapleFoodCost) ||
    table.standardMonthlyStapleFoodCost < 0
  ) {
    throw new RangeError(
      `主食費の既定値は 0 以上の有限の数値で指定してください: ${table.standardMonthlyStapleFoodCost}`,
    )
  }
}

/**
 * 子の id が重複していないことを確かめる。
 *
 * 重複したまま合計すると、同じ子の保育料を二重に数えても気づけない。
 *
 * @throws {RangeError} id が重複しているとき
 */
function assertUniqueChildIds(children: readonly Child[]): void {
  const seen = new Set<PersonId>()
  for (const child of children) {
    if (seen.has(child.id)) {
      throw new RangeError(`子の id が重複しています: ${child.id}`)
    }
    seen.add(child.id)
  }
}

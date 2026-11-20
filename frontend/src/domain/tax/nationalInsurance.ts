/**
 * 国民健康保険料と国民年金保険料。会社の社会保険に入らない人（個人事業主など）の社会保険。
 *
 * **国保は世帯単位・前年の所得で決まる。** 区分は医療分・支援分・介護分・子ども分の 4 つ（2026 年度から）で、
 * 区分ごとに「所得割（前年の所得 × 料率）+ 均等割（加入者 1 人あたりの定額）+ 平等割（1 世帯あたりの定額。
 * ある自治体だけ）」を世帯で合計し、区分ごとの賦課限度額で頭打ちにする。均等割には軽減が 3 種類ある
 * （低所得世帯の 7・5・2 割／未就学児の 5 割／子ども分のこどもの全額）。平等割に掛かるのは 7・5・2 割だけ
 * （国民健康保険法施行令第 29 条の 7 第 6 項）。所得割には、子のいる世帯の賦課基準額から引く自治体独自の控除が
 * ある自治体と無い自治体がある。
 *
 * **1 年のずれ**：この関数は「保険料の年度」と「前年の所得」を受け取る。年次モデルでは前年の `TaxBase` から
 * 当年の保険料を出す持ち回りになる（SPEC §2.4）。所得が増えた翌年に保険料が増える。
 *
 * **表に無い自治体は計算できない。** 国保には住民税のような全国共通の標準料率が無いので、黙って別の自治体の
 * 料率を当てずに例外にする（D23）。呼び出し側は `hasNationalHealthInsuranceRates` で先に確かめる。
 *
 * **JSON に無い前提（計算側の判断。KNOWLEDGE.md 2026-09-18・2026-11-20）：**
 * - 年度（4 月〜翌 3 月）の保険料を、同じ番号の暦年の支出として扱う（給与の社保と同じ規約）
 * - 料率の年度より後の年度は、最新の料率・限度額・軽減の判定式をそのまま延ばす
 * - 介護分の対象は、その年 12 月 31 日時点の年齢で判定する（実際は誕生月から月割り）
 * - 順序は「均等割・平等割の軽減 → 区分ごとに合計 → 賦課限度額 → 端数の切り捨て」。
 *   端数の処理は表の `rounding`（市の条例）に従い、書いていない段は円単位で四捨五入する
 * - 軽減判定の所得は前年の総所得金額等の単純な合算（65 歳以上の年金の 15 万円控除などの調整は入れない）。
 *   負の所得は 0 として数える。特定同一世帯所属者（後期高齢者医療へ移った人）は扱わず、
 *   特定世帯・特定継続世帯の平等割の減額（2 分の 1・4 分の 3）も入れない（保険料が高く出る安全側）
 * - 独自控除を賦課基準額が最も高い加入者から引く自治体では、その 1 人の賦課基準額が限度（残りを次の人へ回さない。保険料が高く出る安全側）
 * - 産前産後・非自発的失業・減免、表の型に入らない市独自の減額（多子世帯の均等割の減免、独自控除を見直した後の
 *   激変緩和など）は扱わない（保険料が高く出る安全側）
 */

import { roundYen } from '../money'
import type {
  Month,
  MunicipalityCode,
  NationalHealthInsuranceRounding,
  NationalHealthInsuranceSegmentRates,
  NationalInsuranceTable,
  PersonId,
  Rate,
  Year,
  Yen,
} from '../types'
import { assertYear } from './schedule'

/** 国保の加入者 1 人 */
export type NationalHealthInsuranceMember = {
  personId: PersonId
  birthYear: Year
  /** 生まれ月。未就学児・こどもの判定（年度末時点の年齢）に使う。大人は null でよい */
  birthMonth: Month | null
  /** 前年の総所得金額等（保険料の年度の前年 1〜12 月ぶん） */
  previousYearTotalIncome: Yen
  /** 軽減判定の「給与所得者等」に当たるか（一定額を超える給与収入か公的年金収入がある人） */
  isSalaryEarner: boolean
}

/**
 * 世帯主。国保は世帯主に請求が来る。世帯主が会社の健康保険に入っていて国保の加入者でない場合
 * （擬制世帯主）も、軽減判定の所得には世帯主の所得を含める。
 */
export type NationalHealthInsuranceHouseholder =
  | { kind: 'member'; personId: PersonId }
  | { kind: 'nonMember'; previousYearTotalIncome: Yen; isSalaryEarner: boolean }

/** 国保の保険料を求める入力 */
export type NationalHealthInsuranceInput = {
  /** 保険料の年度。所得はこの前年のもの */
  fiscalYear: Year
  municipalityCode: MunicipalityCode
  /** 国保の加入者。1 人以上 */
  members: readonly NationalHealthInsuranceMember[]
  householder: NationalHealthInsuranceHouseholder
}

/** 1 区分ぶんの保険料の内訳 */
export type NationalHealthInsuranceSegmentResult = {
  /** 所得割 */
  incomeLevy: Yen
  /** 均等割（軽減後） */
  perCapitaLevy: Yen
  /** 賦課限度額を掛けた後の保険料 */
  premium: Yen
  /** 賦課限度額で頭打ちになったか */
  capped: boolean
}

/** 国保の保険料（世帯の年額） */
export type NationalHealthInsuranceResult = {
  fiscalYear: Year
  /** 低所得世帯の軽減の判定に使った所得（世帯主と加入者の前年所得の合計） */
  reductionJudgmentIncome: Yen
  /** 均等割・平等割に掛かった軽減の割合（0 / 0.2 / 0.5 / 0.7） */
  reductionRate: Rate
  /** 自治体独自の控除で賦課基準額から引いた額 */
  municipalDeduction: Yen
  segments: {
    medical: NationalHealthInsuranceSegmentResult
    support: NationalHealthInsuranceSegmentResult
    longTermCare: NationalHealthInsuranceSegmentResult
    childcare: NationalHealthInsuranceSegmentResult
  }
  /**
   * 区分ごとの平等割（軽減後。賦課限度額を掛ける前）。平等割の無い区分・自治体は 0。
   * 各区分の `premium` はこれを含んだ額
   */
  perHouseholdLevies: {
    medical: Yen
    support: Yen
    longTermCare: Yen
    childcare: Yen
  }
  total: Yen
}

/** その自治体の国保の料率が表にあるか。無ければ `nationalHealthInsurance` は例外を投げる */
export function hasNationalHealthInsuranceRates(
  municipalityCode: MunicipalityCode,
  table: NationalInsuranceTable,
): boolean {
  return table.nationalHealthInsurance.byMunicipality[municipalityCode] !== undefined
}

/**
 * 世帯の国民健康保険料（年額）を求める。
 *
 * @throws {RangeError} 入力が不正なとき、自治体の料率が表に無いとき、年度が料率の年度より前のとき、
 *   表が食い違っている・未対応の値があるとき（平等割なしの自治体に平等割の額がある、独自控除の引き先・端数の処理が未対応）
 */
export function nationalHealthInsurance(
  input: NationalHealthInsuranceInput,
  table: NationalInsuranceTable,
): NationalHealthInsuranceResult {
  const { fiscalYear, municipalityCode, members, householder } = input
  assertYear(fiscalYear)
  const nhi = table.nationalHealthInsurance
  const rates = nhi.byMunicipality[municipalityCode]
  if (rates === undefined) {
    throw new RangeError(`国民健康保険の料率が表に無い自治体です: ${municipalityCode}`)
  }
  if (fiscalYear < rates.fiscalYear) {
    throw new RangeError(
      `国民健康保険の料率は ${rates.fiscalYear} 年度からしかありません: ${fiscalYear} 年度`,
    )
  }
  assertMembers(members, householder, fiscalYear, nhi.insuredAge.under)
  if (!rates.hasPerHousehold) {
    const segmentsWithPerHousehold = [
      rates.medical,
      rates.support,
      rates.longTermCare,
      rates.childcare,
    ].filter((segmentRates) => segmentRates.perHousehold !== 0)
    if (segmentsWithPerHousehold.length > 0) {
      // 「平等割なし」の表に平等割の額がある：どちらが正しいか分からないので黙って計算しない
      throw new RangeError(
        `国民健康保険の表が食い違っています（平等割なしの自治体に平等割の額がある）: ${municipalityCode}`,
      )
    }
  }

  // --- 加入者ごとの賦課基準額（前年の総所得金額等 − 住民税の基礎控除。0 未満にはしない） ---
  const bases = members.map((member) =>
    Math.max(0, member.previousYearTotalIncome - basicDeductionFor(member, table)),
  )
  const municipalDeduction = applyMunicipalDeduction(bases, input, rates.municipalDeduction)

  // --- 低所得世帯の軽減の割合 ---
  const reductionJudgmentIncome = judgmentIncome(members, householder)
  const reductionRate = reductionRateFor(input, reductionJudgmentIncome, table)

  // --- 区分ごとの所得割と均等割 ---
  const ageOf = (index: number): number => fiscalYear - memberAt(members, index).birthYear
  const isLongTermCareAge = (index: number): boolean =>
    nhi.longTermCareAgeRange.from <= ageOf(index) && ageOf(index) <= nhi.longTermCareAgeRange.to
  const isChild = (index: number): boolean =>
    ageAtFiscalYearEnd(memberAt(members, index), fiscalYear) <=
    rates.childcare.childMaxAgeAtFiscalYearEnd
  const isPreschool = (index: number): boolean =>
    ageAtFiscalYearEnd(memberAt(members, index), fiscalYear) <=
    nhi.reduction.preschoolMaxAgeAtFiscalYearEnd
  const everyone = (): boolean => true

  // --- 端数の処理（表の rounding。書いていない段は円単位の四捨五入で概算する） ---
  const rounding = resolveRounding(rates.rounding, municipalityCode)
  const preschoolFactor = (index: number): number =>
    isPreschool(index) ? 1 - nhi.reduction.preschoolPerCapitaReduction : 1

  // 均等割の軽減：所得による軽減の後、未就学児はさらに 5 割。
  // 軽減額を切り上げる市は、均等割の項目（被保険者均等割・18 歳以上被保険者均等割）ごとに 1 円未満を切り上げてから引く
  const perCapitaAfterReduction = (items: readonly Yen[], index: number): number => {
    if (!rounding.reductionAmountCeil) {
      const amount = items.reduce((sum, item) => sum + item, 0)
      return amount * (1 - reductionRate) * preschoolFactor(index)
    }
    return items.reduce(
      (sum, item) => sum + (item - ceilYen(item * reductionRate)) * preschoolFactor(index),
      0,
    )
  }
  // 平等割の軽減：7・5・2 割だけ（未就学児・こどもの軽減は掛からない）
  const perHouseholdAfterReduction = (amount: Yen): Yen =>
    rounding.reductionAmountCeil
      ? amount - ceilYen(amount * reductionRate)
      : roundYen(amount * (1 - reductionRate))

  const segment = (
    segmentRates: NationalHealthInsuranceSegmentRates,
    subjectTo: (index: number) => boolean,
    perCapitaItemsOf: (index: number) => readonly Yen[],
  ): { result: NationalHealthInsuranceSegmentResult; perHouseholdLevy: Yen } => {
    let levyBase = 0
    let incomeLevyFlooredPerMember = 0
    let perCapitaTotal = 0
    let subjectCount = 0
    members.forEach((_, index) => {
      if (!subjectTo(index)) {
        return
      }
      const memberBase = bases[index] ?? 0
      subjectCount += 1
      levyBase += memberBase
      incomeLevyFlooredPerMember += floorYen(memberBase * segmentRates.incomeRate)
      perCapitaTotal += perCapitaAfterReduction(perCapitaItemsOf(index), index)
    })
    const incomeLevy =
      rounding.incomeLevy === 'perMemberFloor'
        ? incomeLevyFlooredPerMember
        : rounding.incomeLevy === 'floor'
          ? floorYen(levyBase * segmentRates.incomeRate)
          : roundYen(levyBase * segmentRates.incomeRate)
    const perCapitaLevy = roundYen(perCapitaTotal)
    // 平等割は対象の加入者が 1 人でもいる世帯に掛かる（介護分は 40〜64 歳の加入者がいる世帯だけ）
    const perHouseholdLevy =
      subjectCount > 0 && segmentRates.perHousehold !== 0
        ? perHouseholdAfterReduction(segmentRates.perHousehold)
        : 0
    const beforeCap = incomeLevy + perCapitaLevy + perHouseholdLevy
    const afterCap = Math.min(beforeCap, segmentRates.cap)
    const unit = rounding.segmentPremiumFloorUnit
    return {
      result: {
        incomeLevy,
        perCapitaLevy,
        premium: Math.floor(afterCap / unit) * unit,
        capped: beforeCap > segmentRates.cap,
      },
      perHouseholdLevy,
    }
  }

  const medical = segment(rates.medical, everyone, () => [rates.medical.perCapita])
  const support = segment(rates.support, everyone, () => [rates.support.perCapita])
  const longTermCare = segment(rates.longTermCare, isLongTermCareAge, () => [
    rates.longTermCare.perCapita,
  ])
  // 子ども分：こどもの均等割は軽減され、18 歳以上の加入者に追加の均等割（18 歳以上被保険者均等割）が乗る
  const childcare = segment(rates.childcare, everyone, (index) =>
    isChild(index)
      ? [rates.childcare.perCapita * (1 - rates.childcare.childPerCapitaReduction)]
      : [rates.childcare.perCapita, rates.childcare.perCapitaAge18Plus],
  )

  return {
    fiscalYear,
    reductionJudgmentIncome,
    reductionRate,
    municipalDeduction,
    segments: {
      medical: medical.result,
      support: support.result,
      longTermCare: longTermCare.result,
      childcare: childcare.result,
    },
    perHouseholdLevies: {
      medical: medical.perHouseholdLevy,
      support: support.perHouseholdLevy,
      longTermCare: longTermCare.perHouseholdLevy,
      childcare: childcare.perHouseholdLevy,
    },
    total:
      medical.result.premium +
      support.result.premium +
      longTermCare.result.premium +
      childcare.result.premium,
  }
}

/**
 * 国民年金保険料（年額）。第 1 号被保険者 1 人あたりの定額 × 人数。
 *
 * その年度の月額を暦年の 12 か月ぶんに使う。表より後の年度は最新の月額を延ばす
 * （実際は名目賃金に応じて毎年度改定される。インフレは掛けない。保育料と同じ扱い）。
 * 付加保険料・前納割引・免除は扱わない。
 *
 * @param insuredCount その年に保険料を納める第 1 号被保険者の人数
 * @throws {RangeError} 年・人数が不正なとき、表の最初の年度より前のとき
 */
export function nationalPensionPremium(
  year: Year,
  insuredCount: number,
  table: NationalInsuranceTable,
): Yen {
  assertYear(year)
  if (!Number.isInteger(insuredCount) || insuredCount < 0) {
    throw new RangeError(`国民年金の加入者数は 0 以上の整数で指定してください: ${insuredCount}`)
  }
  const entry = latestUpTo(table.nationalPension.schedule, year)
  if (entry === null) {
    throw new RangeError(`国民年金保険料の表に ${year} 年度以前の額がありません`)
  }
  return entry.monthly * 12 * insuredCount
}

/**
 * その年に国民年金の第 1 号被保険者の年齢か（会社員・その被扶養配偶者でないことは呼び出し側が判断する）。
 * その年 12 月 31 日時点の年齢で判定する（実際は 20 歳になる月から 60 歳になる前月まで。年次モデルでは月割りしない）。
 */
export function isNationalPensionInsuredAge(age: number, table: NationalInsuranceTable): boolean {
  const { from, under } = table.nationalPension.insuredAge
  return from <= age && age < under
}

/** 年度末（翌年 3 月 31 日）時点の年齢。1〜3 月生まれはその日までに誕生日が来ている */
function ageAtFiscalYearEnd(
  member: Pick<NationalHealthInsuranceMember, 'birthYear' | 'birthMonth'>,
  fiscalYear: Year,
): number {
  const birthdayPassed = member.birthMonth !== null && member.birthMonth <= 3
  return fiscalYear + 1 - member.birthYear - (birthdayPassed ? 0 : 1)
}

/** 添字で加入者を取る。範囲外は呼び出し側の誤り */
function memberAt(
  members: readonly NationalHealthInsuranceMember[],
  index: number,
): NationalHealthInsuranceMember {
  const member = members[index]
  if (member === undefined) {
    throw new RangeError(`国保の加入者の添字が範囲外です: ${index}`)
  }
  return member
}

/** 賦課基準額から引く住民税の基礎控除（前年の合計所得金額で決まる） */
function basicDeductionFor(
  member: NationalHealthInsuranceMember,
  table: NationalInsuranceTable,
): Yen {
  const row = table.nationalHealthInsurance.basicDeductionSchedule.find(
    (candidate) =>
      candidate.maxTotalIncome === null ||
      member.previousYearTotalIncome <= candidate.maxTotalIncome,
  )
  if (row === undefined) {
    throw new RangeError(
      `国保の基礎控除の表に ${member.previousYearTotalIncome} 円が入る行がありません`,
    )
  }
  return row.amount
}

/** 端数の処理を読み解いた形。表の `rounding` に無い段は円単位の四捨五入 */
type ResolvedRounding = {
  incomeLevy: 'round' | 'floor' | 'perMemberFloor'
  reductionAmountCeil: boolean
  segmentPremiumFloorUnit: number
}

/**
 * 表の端数の処理を読み解く。知らない値は黙って四捨五入にせず例外にする（条例の書き方が違う市を足したときに気づくため）。
 *
 * @throws {RangeError} 未対応の値のとき
 */
function resolveRounding(
  rounding: NationalHealthInsuranceRounding | undefined,
  municipalityCode: MunicipalityCode,
): ResolvedRounding {
  const incomeLevy = rounding?.incomeLevy ?? 'round'
  if (incomeLevy !== 'round' && incomeLevy !== 'floor' && incomeLevy !== 'perMemberFloor') {
    throw new RangeError(
      `国保の所得割の端数の処理が未対応の値です（${municipalityCode}）: ${incomeLevy}`,
    )
  }
  const reductionAmount = rounding?.reductionAmount
  if (reductionAmount !== undefined && reductionAmount !== 'ceil') {
    throw new RangeError(
      `国保の軽減額の端数の処理が未対応の値です（${municipalityCode}）: ${reductionAmount}`,
    )
  }
  const unit = rounding?.segmentPremiumFloorUnit ?? 1
  if (!Number.isInteger(unit) || unit <= 0) {
    throw new RangeError(`国保の保険料を切り捨てる単位が不正です（${municipalityCode}）: ${unit}`)
  }
  return {
    incomeLevy,
    reductionAmountCeil: reductionAmount === 'ceil',
    segmentPremiumFloorUnit: unit,
  }
}

/**
 * 1 円未満を切り捨てる。料率の掛け算で出る浮動小数点の誤差（88,722.000…01 や 88,721.999…9）を
 * 小数 6 桁で丸めてから切り捨て、ちょうど整数の額が 1 円ずれないようにする
 */
function floorYen(value: number): Yen {
  return Math.floor(Math.round(value * 1e6) / 1e6)
}

/** 1 円未満を切り上げる（誤差の扱いは `floorYen` と同じ） */
function ceilYen(value: number): Yen {
  return Math.ceil(Math.round(value * 1e6) / 1e6)
}

/**
 * 自治体独自の控除を賦課基準額に掛ける。`bases` を書き換え、引いた額を返す。独自控除の無い自治体（null）は 0。
 *
 * 対象の子は、前年 12 月 31 日時点で 16 歳未満／16 歳以上 19 歳未満で、前年の合計所得金額が上限以下の加入者。
 * 引く相手は自治体で違う（賦課基準額が最も高い加入者／加入者である世帯主）。
 */
function applyMunicipalDeduction(
  bases: number[],
  input: NationalHealthInsuranceInput,
  deduction: NationalInsuranceTable['nationalHealthInsurance']['byMunicipality'][string]['municipalDeduction'],
): Yen {
  if (deduction === null) {
    return 0
  }
  const { members, householder, fiscalYear } = input
  if (deduction.ages.asOf !== 'previousDecember31') {
    // 基準日の違う自治体を足したときに、前年末の年齢で黙って判定しない
    throw new RangeError(`国保の独自控除の年齢の基準日が未対応の値です: ${deduction.ages.asOf}`)
  }
  let amount = 0
  for (const member of members) {
    if (member.previousYearTotalIncome > deduction.childIncomeLimit) {
      continue
    }
    const ageAtPreviousYearEnd = fiscalYear - 1 - member.birthYear
    if (ageAtPreviousYearEnd < deduction.ages.under16BelowAge) {
      amount += deduction.under16PerPerson
    } else if (ageAtPreviousYearEnd < deduction.ages.age16To18BelowAge) {
      amount += deduction.age16To18PerPerson
    }
  }
  if (amount === 0) {
    return 0
  }

  let targetIndex: number
  if (deduction.deductFrom === 'highestBaseMember') {
    targetIndex = bases.reduce((best, base, index) => (base > (bases[best] ?? 0) ? index : best), 0)
  } else if (deduction.deductFrom === 'insuredHouseholder') {
    if (householder.kind !== 'member') {
      return 0
    }
    targetIndex = members.findIndex((member) => member.personId === householder.personId)
  } else {
    throw new RangeError(`国保の独自控除の引き先が未対応の値です: ${deduction.deductFrom}`)
  }

  const targetBase = bases[targetIndex] ?? 0
  const applied = Math.min(amount, targetBase)
  bases[targetIndex] = targetBase - applied
  return applied
}

/** 軽減判定の所得。世帯主（加入者でなくても）と加入者の前年所得の合計。負の所得は 0 として数える */
function judgmentIncome(
  members: readonly NationalHealthInsuranceMember[],
  householder: NationalHealthInsuranceHouseholder,
): Yen {
  const memberTotal = members.reduce(
    (sum, member) => sum + Math.max(0, member.previousYearTotalIncome),
    0,
  )
  const householderIncome =
    householder.kind === 'nonMember' ? Math.max(0, householder.previousYearTotalIncome) : 0
  return memberTotal + householderIncome
}

/** 均等割の軽減の割合。判定所得が 7 割 → 5 割 → 2 割の順に、最初に収まった段の割合 */
function reductionRateFor(
  input: NationalHealthInsuranceInput,
  income: Yen,
  table: NationalInsuranceTable,
): Rate {
  const { members, householder, fiscalYear } = input
  const schedule = latestUpTo(table.nationalHealthInsurance.reduction.schedule, fiscalYear)
  if (schedule === null) {
    throw new RangeError(`国保の軽減の判定式に ${fiscalYear} 年度以前の段がありません`)
  }
  const salaryEarners =
    members.filter((member) => member.isSalaryEarner).length +
    (householder.kind === 'nonMember' && householder.isSalaryEarner ? 1 : 0)
  const addition = schedule.salaryEarnerAddition * Math.max(0, salaryEarners - 1)

  for (const tier of [schedule.seventy, schedule.fifty, schedule.twenty]) {
    if (income <= tier.base + tier.perMember * members.length + addition) {
      return tier.rate
    }
  }
  return 0
}

/** `fiscalYear` が指定の年度以下で最も新しい段。無ければ null（将来の年度は最新の段を延ばす） */
function latestUpTo<T extends { fiscalYear: Year }>(schedule: readonly T[], year: Year): T | null {
  let found: T | null = null
  for (const entry of schedule) {
    if (entry.fiscalYear <= year && (found === null || entry.fiscalYear > found.fiscalYear)) {
      found = entry
    }
  }
  return found
}

/**
 * 加入者と世帯主の入力を検証する。
 *
 * @throws {RangeError} 加入者がいない、生年・所得が不正、加入できない年齢、世帯主が加入者の中にいないとき
 */
function assertMembers(
  members: readonly NationalHealthInsuranceMember[],
  householder: NationalHealthInsuranceHouseholder,
  fiscalYear: Year,
  insuredAgeUnder: number,
): void {
  if (members.length === 0) {
    throw new RangeError('国保の加入者が 1 人もいません')
  }
  for (const member of members) {
    if (!Number.isInteger(member.birthYear) || member.birthYear > fiscalYear) {
      throw new RangeError(`国保の加入者の生年が不正です: ${member.birthYear}`)
    }
    if (!Number.isFinite(member.previousYearTotalIncome)) {
      throw new RangeError(
        `国保の加入者の前年所得が有限の数値ではありません: ${member.previousYearTotalIncome}`,
      )
    }
    if (fiscalYear - member.birthYear >= insuredAgeUnder) {
      throw new RangeError(
        `${insuredAgeUnder} 歳以上は国保の加入者にできません（後期高齢者医療制度）: ${member.personId}`,
      )
    }
  }
  if (householder.kind === 'member') {
    if (!members.some((member) => member.personId === householder.personId)) {
      throw new RangeError(`世帯主が国保の加入者の中にいません: ${householder.personId}`)
    }
  } else if (!Number.isFinite(householder.previousYearTotalIncome)) {
    throw new RangeError(
      `世帯主の前年所得が有限の数値ではありません: ${householder.previousYearTotalIncome}`,
    )
  }
}

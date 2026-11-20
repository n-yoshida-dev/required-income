/**
 * 必要手取り → 必要額面の逆算（SPEC §2.4「逆方向は二分探索で解く」）。会社員 1 人・同じ給与が続く前提。
 *
 * `steadyStateEmploymentNetPay`（額面 → 手取り）を何度も呼んで、目標の手取りに届く**最小の額面**を探す。
 *
 * **手取りは額面に対して厳密には右上がりではない。** 社会保険料は月給を等級（一定の幅）に丸めて決めるので、
 * 等級の境目では額面が少し増えただけで保険料が段で上がり、手取りが一瞬下がる。二分探索は
 * 「届く額面と、その 1 刻み下の届かない額面」の組を 1 つ見つけるだけなので、段差の手前にあるもっと小さい解を
 * 取りこぼしうる。そこで二分探索で当たりを付けたあと、**その下を一定の幅だけ総当たり**して最小の額面を選ぶ。
 * 幅（既定 100 万円）は等級 1 つぶんの年額（最大でも 72 万円）より広く取ってある。段差で下がる手取り
 * （年に数万〜十数万円）は額面を十数万円増やせば取り戻せるので、これより下に解が残ることはない。
 *
 * 届かないことは例外ではなく戻り値で返す（`.claude/rules/domain-purity.md`）。
 */

import type { Rate, Yen } from '../types'
import { steadyStateEmploymentNetPay, type EmploymentTaxInput, type TaxTables } from './employment'
import { assertNonNegativeYen } from './schedule'

/** 逆算の条件。給与の額以外は `EmploymentTaxInput` と同じ */
export type RequiredGrossInput = Omit<EmploymentTaxInput, 'pay'> & {
  /** 目標の手取り（年額。社保・所得税・住民税を引いたあと） */
  targetNetPay: Yen
  /** 額面の合計（月給ぶん + 賞与）のうち賞与が占める割合。0〜1。賞与なしなら 0 */
  bonusShare: Rate
}

/** 探索の設定 */
export type RequiredGrossOptions = {
  /** 探す額面の上限（年額） */
  maxGross: Yen
  /** 刻み。結果はこの単位になる */
  step: Yen
  /** 二分探索の解の下を総当たりする幅（年額）。等級 1 つぶんの年額より広く取る */
  scanBackWidth: Yen
}

/** 探索の既定値。上限 1 億円・1 万円刻み・下へ 100 万円ぶん総当たり */
export const DEFAULT_REQUIRED_GROSS_OPTIONS: RequiredGrossOptions = {
  maxGross: 100_000_000,
  step: 10_000,
  scanBackWidth: 1_000_000,
}

/** 逆算の結果 */
export type RequiredGrossOutcome =
  | {
      status: 'solved'
      /** 目標の手取りに届く最小の額面の合計（月給ぶん + 賞与。刻みの倍数） */
      totalGross: Yen
      /** そのうち月給ぶんの年額 */
      annualGross: Yen
      /** そのうち賞与の年額 */
      annualBonus: Yen
      /** その額面での手取り（目標以上） */
      netPay: Yen
    }
  /** 上限の額面でも目標に届かない */
  | { status: 'unreachable'; maxGross: Yen; netPayAtMax: Yen }

/**
 * 目標の手取りに届く最小の額面を求める。
 *
 * @throws {RangeError} 目標・賞与の割合・探索の設定が不正なとき、税・社保の計算の入力が不正なとき
 */
export function requiredEmploymentGross(
  input: RequiredGrossInput,
  tables: TaxTables,
  options: Partial<RequiredGrossOptions> = {},
): RequiredGrossOutcome {
  const { targetNetPay, bonusShare, ...base } = input
  const { maxGross, step, scanBackWidth } = { ...DEFAULT_REQUIRED_GROSS_OPTIONS, ...options }
  assertNonNegativeYen(targetNetPay, '目標の手取り')
  if (!Number.isFinite(bonusShare) || bonusShare < 0 || bonusShare > 1) {
    throw new RangeError(`賞与の割合は 0〜1 で指定してください: ${bonusShare}`)
  }
  if (!Number.isInteger(step) || step <= 0) {
    throw new RangeError(`探索の刻みは正の整数で指定してください: ${step}`)
  }
  if (!Number.isFinite(maxGross) || maxGross < step) {
    throw new RangeError(`探索の上限は刻み以上の有限の数値で指定してください: ${maxGross}`)
  }
  if (!Number.isFinite(scanBackWidth) || scanBackWidth < 0) {
    throw new RangeError(`総当たりの幅は 0 以上の有限の数値で指定してください: ${scanBackWidth}`)
  }

  /** 額面の合計を月給ぶんと賞与に分ける。賞与を円に丸め、残りを月給ぶんにする（合計がずれない） */
  const payOf = (totalGross: Yen): { annualGross: Yen; annualBonus: Yen } => {
    const annualBonus = Math.round(totalGross * bonusShare)
    return { annualGross: totalGross - annualBonus, annualBonus }
  }
  /** 刻み数 n の額面での手取り */
  const netAt = (units: number): Yen =>
    steadyStateEmploymentNetPay({ ...base, pay: payOf(units * step) }, tables)

  const maxUnits = Math.floor(maxGross / step)
  if (netAt(maxUnits) < targetNetPay) {
    return { status: 'unreachable', maxGross: maxUnits * step, netPayAtMax: netAt(maxUnits) }
  }

  // 二分探索：low は届かない、high は届く
  let high = maxUnits
  if (netAt(0) >= targetNetPay) {
    high = 0
  } else {
    let low = 0
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2)
      if (netAt(mid) >= targetNetPay) {
        high = mid
      } else {
        low = mid
      }
    }
  }

  // 等級の段差の手前にある、もっと小さい解を拾う
  let best = high
  const scanFrom = Math.max(0, high - Math.ceil(scanBackWidth / step))
  for (let units = high - 1; units >= scanFrom; units -= 1) {
    if (netAt(units) >= targetNetPay) {
      best = units
    }
  }

  const totalGross = best * step
  return { status: 'solved', totalGross, ...payOf(totalGross), netPay: netAt(best) }
}

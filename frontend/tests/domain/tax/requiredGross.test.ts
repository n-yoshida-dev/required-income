/**
 * 必要手取り → 必要額面の逆算。
 *
 * 期待値の柱は 2 つ：
 * - 既に手計算で固定してある「額面 → 手取り」（`employment.test.ts` の 3,915,532 円、`fixtures.ts` の 4,621,535 円）の逆が取れること
 * - **総当たりとの一致**：解より小さい額面をすべて試して 1 つも目標に届かないこと（探索の手順に依らない最小性の確認）
 */

import { describe, expect, it } from 'vitest'
import { steadyStateEmploymentNetPay } from '../../../src/domain/tax/employment'
import {
  requiredEmploymentGross,
  type RequiredGrossInput,
} from '../../../src/domain/tax/requiredGross'
import { masterTables } from '../fixtures'

const STEP = 10000

/** 2026 年・56 歳・賞与なし・裏取りの無い自治体（標準税率）・扶養なし。`makeMinimalInput` の会社員と同じ条件 */
const noBonus: Omit<RequiredGrossInput, 'targetNetPay'> = {
  year: 2026,
  age: 56,
  bonusPaymentCount: 2,
  municipalityCode: '99001',
  personal: { spouse: null, dependents: [] },
  bonusShare: 0,
}

/** 賞与なしの額面（1 万円 × units）での手取り */
function netAt(units: number): number {
  return steadyStateEmploymentNetPay(
    { ...noBonus, pay: { annualGross: units * STEP, annualBonus: 0 } },
    masterTables,
  )
}

/** 総当たりで求めた、目標に届く最小の刻み数（上限まで試して無ければ null） */
function bruteForceMinUnits(target: number, maxUnits: number): number | null {
  for (let units = 0; units <= maxUnits; units += 1) {
    if (netAt(units) >= target) {
      return units
    }
  }
  return null
}

describe('requiredEmploymentGross', () => {
  it('手計算済みの手取り 4,621,535 円（額面 600 万）の逆が取れる', () => {
    // fixtures.ts：600 万 − 社保 932,100 − 所得税 144,165 − 住民税 302,200 = 4,621,535
    const result = requiredEmploymentGross({ ...noBonus, targetNetPay: 4621535 }, masterTables)

    expect(result).toEqual({
      status: 'solved',
      totalGross: 6000000,
      annualGross: 6000000,
      annualBonus: 0,
      netPay: 4621535,
    })
  })

  it('目標を 1 円上げると、次の刻み（601 万）になる', () => {
    const result = requiredEmploymentGross({ ...noBonus, targetNetPay: 4621536 }, masterTables)

    expect(result.status).toBe('solved')
    expect(result.status === 'solved' && result.totalGross).toBe(6010000)
  })

  it('賞与の割合を保って額面を分ける。等級の境目に乗る額面（月給ぶん 420 万）より、手前の 497 万が解になる', () => {
    // employment.test.ts の基準ケース（月給ぶん 420 万 + 賞与 80 万 = 500 万 → 手取り 3,915,532。賞与の割合 0.16）を目標にする。
    // 月給ぶん 420 万は月 35 万ちょうどで、標準報酬月額が 34 万 → 36 万に上がる境目。1 つ手前の等級に収まる 497 万
    // （月給ぶん 4,174,800 = 月 347,900）のほうが保険料が安く、手取りは 500 万のときより多い
    const withBonus = {
      year: 2026,
      age: 35,
      bonusPaymentCount: 2,
      municipalityCode: '14130',
      personal: { spouse: null, dependents: [] },
    }
    const target = 3915532
    const netWithBonusAt = (units: number): number => {
      const annualBonus = Math.round(units * STEP * 0.16)
      return steadyStateEmploymentNetPay(
        { ...withBonus, pay: { annualGross: units * STEP - annualBonus, annualBonus } },
        masterTables,
      )
    }

    const result = requiredEmploymentGross(
      { ...withBonus, bonusShare: 0.16, targetNetPay: target },
      masterTables,
    )

    expect(result.status).toBe('solved')
    if (result.status !== 'solved') return
    expect(result.totalGross).toBe(4970000)
    expect(result.annualBonus).toBe(795200)
    expect(result.annualGross).toBe(4174800)
    expect(result.annualGross + result.annualBonus).toBe(result.totalGross)
    expect(result.netPay).toBe(netWithBonusAt(497))
    expect(result.netPay).toBeGreaterThanOrEqual(target)
    // 手計算済みの点：500 万ちょうどは目標と同額（解の候補だが最小ではない）
    expect(netWithBonusAt(500)).toBe(target)
    // 総当たり：497 万より小さい額面はどれも届かない
    for (let units = 0; units < 497; units += 1) {
      expect(netWithBonusAt(units)).toBeLessThan(target)
    }
  })

  it('解は総当たりの最小と一致する（目標をいくつか変えて確かめる）', () => {
    for (const target of [1500000, 2377638, 3000000, 4000000, 5500000, 7000000]) {
      const result = requiredEmploymentGross({ ...noBonus, targetNetPay: target }, masterTables)

      expect(result.status).toBe('solved')
      if (result.status === 'solved') {
        expect(result.totalGross).toBe((bruteForceMinUnits(target, 1200) ?? -1) * STEP)
        expect(result.netPay).toBeGreaterThanOrEqual(target)
      }
    }
  })

  it('等級の段差の手前にある小さい解を取りこぼさない', () => {
    // 額面を 1 万円増やすと手取りが減る点（社会保険の等級が上がる境目）を探し、その手前の手取りを目標にする。
    // 目標に届く額面は段差の手前（dropAt）にあるが、段差の直後の数刻みは目標に届かない
    let dropAt: number | null = null
    for (let units = 300; units < 900; units += 1) {
      if (netAt(units + 1) < netAt(units)) {
        dropAt = units
        break
      }
    }
    expect(dropAt).not.toBeNull()
    if (dropAt === null) return

    const target = netAt(dropAt)
    expect(netAt(dropAt + 1)).toBeLessThan(target)

    const result = requiredEmploymentGross({ ...noBonus, targetNetPay: target }, masterTables)

    expect(result.status === 'solved' && result.totalGross).toBe(
      (bruteForceMinUnits(target, 1200) ?? -1) * STEP,
    )
    expect(result.status === 'solved' && result.totalGross).toBeLessThanOrEqual(dropAt * STEP)
  })

  it('総当たりの幅を 0 にすると、段差の直後の大きい解に落ちることがある（総当たりが効いていることの確認）', () => {
    // 600 刻みの範囲で、二分探索だけの解が総当たりの最小より大きくなる目標が少なくとも 1 つある
    let found = false
    for (let units = 300; units < 900 && !found; units += 1) {
      if (netAt(units + 1) >= netAt(units)) continue
      const target = netAt(units)
      const withoutScan = requiredEmploymentGross(
        { ...noBonus, targetNetPay: target },
        masterTables,
        {
          scanBackWidth: 0,
        },
      )
      const withScan = requiredEmploymentGross({ ...noBonus, targetNetPay: target }, masterTables)
      if (
        withoutScan.status === 'solved' &&
        withScan.status === 'solved' &&
        withoutScan.totalGross > withScan.totalGross
      ) {
        found = true
      }
    }
    expect(found).toBe(true)
  })

  it('目標が 0 なら額面 0', () => {
    const result = requiredEmploymentGross({ ...noBonus, targetNetPay: 0 }, masterTables)

    expect(result).toEqual({
      status: 'solved',
      totalGross: 0,
      annualGross: 0,
      annualBonus: 0,
      netPay: 0,
    })
  })

  it('上限の額面でも届かなければ unreachable を返す（例外にしない）', () => {
    const result = requiredEmploymentGross({ ...noBonus, targetNetPay: 4621535 }, masterTables, {
      maxGross: 5000000,
    })

    expect(result).toEqual({ status: 'unreachable', maxGross: 5000000, netPayAtMax: netAt(500) })
  })

  it('不正な入力は例外', () => {
    expect(() => requiredEmploymentGross({ ...noBonus, targetNetPay: -1 }, masterTables)).toThrow(
      RangeError,
    )
    expect(() =>
      requiredEmploymentGross({ ...noBonus, targetNetPay: 1, bonusShare: 1.5 }, masterTables),
    ).toThrow(RangeError)
    expect(() =>
      requiredEmploymentGross({ ...noBonus, targetNetPay: 1 }, masterTables, { step: 0 }),
    ).toThrow(RangeError)
    expect(() =>
      requiredEmploymentGross({ ...noBonus, targetNetPay: 1 }, masterTables, { maxGross: 5000 }),
    ).toThrow(RangeError)
    expect(() =>
      requiredEmploymentGross({ ...noBonus, targetNetPay: 1 }, masterTables, {
        scanBackWidth: -1,
      }),
    ).toThrow(RangeError)
  })
})

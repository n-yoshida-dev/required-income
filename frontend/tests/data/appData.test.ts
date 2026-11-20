import { describe, expect, it } from 'vitest'
import nisaJson from '../../src/data/benefit/nisa.json'
import flat35Json from '../../src/data/housing/flat35-rate.json'
import {
  appDefaults,
  masterTables,
  mortgageRateDefault,
  mortgageRateLabel,
  nisaLimits,
  nisaLimitsFrom,
  planTables,
} from '../../src/data/appData'

// 金利と月は毎月 JSON を直すので、テストは JSON の値から組み立てる（値を写さない）
const flat35 = flat35Json.values.flat35

describe('前提の住宅ローン金利の既定値（T7）', () => {
  it('フラット35 の最頻金利をそのまま使い、何月の値かを根拠に書く（defaults.json に写さない）', () => {
    const [year, month] = flat35.appliesTo.split('-').map(Number)
    expect(appDefaults.assumptions.mortgageRate.value).toBe(flat35.mostCommonRate)
    expect(mortgageRateLabel).toBe(`全期間固定（フラット35）の${year}年${month}月の最頻金利`)
    expect(appDefaults.assumptions.mortgageRate.basis).toContain(mortgageRateLabel)
  })

  it('月は "YYYY-MM" から「◯年◯月」に直す（先頭の 0 は付けない）', () => {
    const base = { status: 'verified', appliesTo: '2030-04', mostCommonRate: 0.02 }
    expect(mortgageRateDefault(base)).toMatchObject({
      value: 0.02,
      label: '全期間固定（フラット35）の2030年4月の最頻金利',
    })
  })

  it('裏取りの済んでいない値・月の読めない値は既定値にしない（投げる）', () => {
    const base = { status: 'verified', appliesTo: '2030-04', mostCommonRate: 0.02 }
    expect(() => mortgageRateDefault({ ...base, status: 'unverified' })).toThrow(/裏取り/)
    expect(() => mortgageRateDefault({ ...base, appliesTo: '2030年4月' })).toThrow(/月/)
  })
})

describe('NISA の上限（T10。data/benefit/nisa.json から組み立てる）', () => {
  const schedule = nisaJson.values.schedule
  /** 表の 1 件（id で引く） */
  const entry = (id: string) => {
    const found = schedule.find((item) => item.id === id)
    if (found === undefined) throw new Error(`nisa.json に ${id} が無い`)
    return found
  }
  const adult = entry('adult')
  const minor = entry('minor')

  it('裏取り済みの値から、大人と未成年者の上限を組み立てる（値は JSON から。写さない）', () => {
    expect(nisaLimitsFrom(schedule)).toEqual({
      adult: {
        fromYear: adult.fromYear,
        minAgeOnJan1: adult.eligibility.minAgeOnJan1?.value,
        annualTsumitate: adult.annualLimit.tsumitate.value,
        annualGrowth: adult.annualLimit.growth.value,
        lifetime: adult.lifetimeLimit.total.value,
      },
      minor: {
        fromYear: minor.fromYear,
        maxAgeOnJan1Exclusive: minor.eligibility.maxAgeOnJan1Exclusive?.value,
        annual: minor.annualLimit.tsumitate.value,
        lifetime: minor.lifetimeLimit.total.value,
      },
    })
    // 2026-11-17 の確認時点の値（法令と金融庁の案内で裏取り済み）
    expect(nisaLimits).toEqual({
      adult: {
        fromYear: 2024,
        minAgeOnJan1: 18,
        annualTsumitate: 1200000,
        annualGrowth: 2400000,
        lifetime: 18000000,
      },
      minor: { fromYear: 2027, maxAgeOnJan1Exclusive: 18, annual: 600000, lifetime: 6000000 },
    })
  })

  it('evaluate に渡す表は、制度データの束に NISA の上限を足した物', () => {
    expect(planTables).toEqual({ ...masterTables, nisa: nisaLimits })
  })

  it('使う値が裏取りされていない・足りないなら投げる', () => {
    const unverified = structuredClone(schedule)
    const minorCopy = unverified.find((item) => item.id === 'minor')
    if (minorCopy === undefined) throw new Error('nisa.json に minor が無い')
    minorCopy.annualLimit.tsumitate.status = 'unverified'
    expect(() => nisaLimitsFrom(unverified)).toThrow(/裏取り/)

    const adultCopy = structuredClone(schedule).map((item) =>
      item.id === 'adult'
        ? { ...item, lifetimeLimit: { ...item.lifetimeLimit, total: undefined } }
        : item,
    )
    expect(() => nisaLimitsFrom(adultCopy)).toThrow(/adult\.lifetimeLimit\.total/)

    expect(() => nisaLimitsFrom(schedule.filter((item) => item.id !== 'minor'))).toThrow(/minor/)
  })

  it('未成年者の枠が生まれた年を含まない表なら投げる（domain の数え方と合わない）', () => {
    const copy = structuredClone(schedule)
    const minorCopy = copy.find((item) => item.id === 'minor')
    if (minorCopy?.eligibility.includesBirthYear === undefined) {
      throw new Error('nisa.json に minor.eligibility.includesBirthYear が無い')
    }
    minorCopy.eligibility.includesBirthYear.value = false
    expect(() => nisaLimitsFrom(copy)).toThrow(/生まれた年/)
  })
})

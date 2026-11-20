import { describe, expect, it } from 'vitest'
import { resolveMunicipality, resolveResidence } from '../../src/domain/residence'
import type { ResidenceHistory, ResidencePeriod } from '../../src/domain/types'

// 架空の自治体コード（`.claude/rules/dummy-values.md`）
const CITY_A = '99001'
const CITY_B = '99002'

const history: ResidenceHistory = [
  { fromYear: 2026, municipality: CITY_A, monthlyRent: 85000, moveInCost: 0 },
  { fromYear: 2032, municipality: CITY_B, monthlyRent: 170000, moveInCost: 700000 },
]

/** 履歴を短く書くための補助。テストの意図を値で埋もれさせないため */
function period(
  fromYear: number,
  municipality: string,
  monthlyRent: number | null,
): ResidencePeriod {
  return { fromYear, municipality, monthlyRent, moveInCost: 0 }
}

describe('resolveResidence', () => {
  it('その年に住んでいる期間そのものを返す', () => {
    expect(resolveResidence(history, 2031).fromYear).toBe(2026)
    expect(resolveResidence(history, 2032).fromYear).toBe(2032)
  })
})

describe('resolveMunicipality', () => {
  it('転居前の年は転居前の自治体', () => {
    expect(resolveMunicipality(history, 2026)).toBe(CITY_A)
    expect(resolveMunicipality(history, 2031)).toBe(CITY_A)
  })

  it('転居した年から転居先の自治体になる', () => {
    expect(resolveMunicipality(history, 2032)).toBe(CITY_B)
    expect(resolveMunicipality(history, 2050)).toBe(CITY_B)
  })

  it('履歴が昇順に並んでいなくても正しく解決する', () => {
    const unsorted: ResidenceHistory = [period(2032, CITY_B, 170000), period(2026, CITY_A, 85000)]
    expect(resolveMunicipality(unsorted, 2031)).toBe(CITY_A)
    expect(resolveMunicipality(unsorted, 2032)).toBe(CITY_B)
  })

  it('履歴が空なら例外（契約違反）', () => {
    expect(() => resolveMunicipality([], 2026)).toThrow(RangeError)
  })

  it('履歴の開始より前の年は例外（契約違反）', () => {
    // シミュレーション期間全体をカバーする履歴を渡すのは呼び出し側の責務
    expect(() => resolveMunicipality(history, 2025)).toThrow(RangeError)
  })
})

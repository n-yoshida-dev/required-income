import { describe, expect, it } from 'vitest'
import codesJson from '../../../src/data/municipality/codes.json'
import {
  describeMunicipality,
  lookupMunicipality,
  municipalityOptions,
} from '../../../src/features/shared/municipality'

describe('自治体コードの一覧（data/municipality/codes.json）', () => {
  it('メタ情報（出典・確認日）を持ち、都道府県が 47 ある', () => {
    expect(codesJson.meta.source).toMatch(/^https:\/\/www\.soumu\.go\.jp\//)
    expect(codesJson.meta.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const codes = Object.keys(codesJson.values)
    expect(codes.filter((code) => code.endsWith('000')).length).toBe(47)
    expect(codes.length).toBeGreaterThan(1900)
  })

  it('キーは 5 桁で、上 2 桁が都道府県（01〜47）', () => {
    for (const code of Object.keys(codesJson.values)) {
      expect(code).toMatch(/^\d{5}$/)
      const prefecture = Number(code.slice(0, 2))
      expect(prefecture).toBeGreaterThanOrEqual(1)
      expect(prefecture).toBeLessThanOrEqual(47)
    }
  })

  it('政令指定都市の区は市名を含み、ふりがなは混ざっていない', () => {
    // 東京 23 区は「区」だけ、政令市の区は「市 + 区」
    expect(codesJson.values['13101']?.name).toBe('千代田区')
    expect(codesJson.values['01101']?.name).toBe('札幌市中央区')
    for (const item of Object.values(codesJson.values)) {
      expect(item.name).not.toMatch(/[ｦ-ﾟァ-ヶ]{3,}$/)
    }
  })
})

describe('lookupMunicipality / describeMunicipality', () => {
  it('コードから名前と都道府県を引く。前後の空白は無視する', () => {
    expect(lookupMunicipality(' 01101 ')).toEqual({
      code: '01101',
      name: '札幌市中央区',
      prefecture: '北海道',
    })
    expect(describeMunicipality('13101')).toBe('東京都 千代田区')
  })

  it('都道府県そのものは名前を繰り返さない', () => {
    expect(describeMunicipality('01000')).toBe('北海道')
  })

  it('一覧に無いコード（架空のサンプル値）は null', () => {
    expect(lookupMunicipality('99001')).toBeNull()
    expect(describeMunicipality('')).toBeNull()
  })

  it('入力候補は一覧と同じ件数で、コード順に並ぶ', () => {
    const options = municipalityOptions()
    expect(options.length).toBe(Object.keys(codesJson.values).length)
    const codes = options.map((item) => item.code)
    expect(codes).toEqual([...codes].sort())
    // 2 回目は同じ配列を返す（作り直さない）
    expect(municipalityOptions()).toBe(options)
  })
})

import { describe, expect, it } from 'vitest'
import {
  formatDuration,
  formatEndExclusive,
  formatMan,
  formatYearRange,
  manNumber,
} from '../../../src/features/shared/format'

describe('formatYearRange', () => {
  it('年の範囲は「2031〜2035年」、1 年だけなら「2031年」（「2031〜2031年」と出さない）', () => {
    expect(formatYearRange(2031, 2035)).toBe('2031〜2035年')
    expect(formatYearRange(2031, 2031)).toBe('2031年')
  })
})

describe('manNumber・formatMan', () => {
  it('万円に四捨五入して桁区切りにする', () => {
    expect(manNumber(10504999)).toBe('1,050')
    expect(formatMan(10505000)).toBe('1,051万円')
  })

  it('小数の桁を指定できる', () => {
    expect(formatMan(68400, { digits: 1 })).toBe('6.8万円')
    expect(formatMan(7500, { digits: 1 })).toBe('0.8万円')
  })

  it('差は記号を付ける。負はマイナス記号、丸めて 0 なら記号なし', () => {
    expect(formatMan(4000000, { signed: true })).toBe('+400万円')
    expect(formatMan(-4000000, { signed: true })).toBe('−400万円')
    expect(formatMan(-4000)).toBe('0万円')
    expect(formatMan(4000, { signed: true })).toBe('0万円')
  })
})

describe('formatEndExclusive', () => {
  it('「この月の前まで」を最後に掛かる月にする（年をまたぐ）', () => {
    expect(formatEndExclusive({ year: 2035, month: 1 })).toBe('2034年12月')
  })
})

describe('formatDuration', () => {
  it('年と月に分ける。0 の部分は書かない', () => {
    expect(formatDuration(74)).toBe('6年2か月')
    expect(formatDuration(24)).toBe('2年')
    expect(formatDuration(2)).toBe('2か月')
    expect(formatDuration(0)).toBe('')
  })
})

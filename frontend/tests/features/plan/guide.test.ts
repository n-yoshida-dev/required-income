import { describe, expect, it } from 'vitest'
import {
  knownSections,
  markDone,
  nextSection,
  previousSection,
  resumeSection,
  sectionFromParam,
  startGuide,
} from '../../../src/features/plan/guide'

// 「計画」の 4 つの区分の順と案内の進み具合（T21。SPEC §4.2）
describe('区分の順', () => {
  it('家族 → 収入 → 暮らし → 目標 の順に進み、戻る', () => {
    expect(nextSection('family')).toBe('income')
    expect(nextSection('income')).toBe('living')
    expect(nextSection('living')).toBe('goals')
    expect(nextSection('goals')).toBeNull()
    expect(previousSection('family')).toBeNull()
    expect(previousSection('income')).toBe('family')
    expect(previousSection('goals')).toBe('living')
  })

  it('URL の区分の名前：知っている名前はそのまま、知らない名前・無いときは家族', () => {
    expect(sectionFromParam('living')).toBe('living')
    expect(sectionFromParam('goals')).toBe('goals')
    expect(sectionFromParam('assumptions')).toBe('family')
    expect(sectionFromParam('')).toBe('family')
    expect(sectionFromParam(undefined)).toBe('family')
  })
})

describe('再開する区分', () => {
  it('案内が無い（終えた・案内が入る前の保存）ときは家族', () => {
    expect(resumeSection(null)).toBe('family')
  })

  it('始めたばかりなら家族', () => {
    expect(resumeSection(startGuide())).toBe('family')
  })

  it('途中なら、済んでいない最初の区分', () => {
    expect(resumeSection({ done: ['family'] })).toBe('income')
    expect(resumeSection({ done: ['family', 'income'] })).toBe('living')
    expect(resumeSection({ done: ['family', 'income', 'living'] })).toBe('goals')
    // 飛ばして先の区分を済ませても、済んでいない最初の区分に戻る
    expect(resumeSection({ done: ['family', 'living'] })).toBe('income')
  })

  it('全部済んでいれば家族', () => {
    expect(resumeSection({ done: ['family', 'income', 'living', 'goals'] })).toBe('family')
  })
})

describe('済みの印', () => {
  it('区分を足すと区分の順に並び、同じ区分を重ねない', () => {
    const once = markDone(startGuide(), 'living')
    expect(once).toEqual({ done: ['living'] })
    const twice = markDone(markDone(once, 'family'), 'living')
    expect(twice).toEqual({ done: ['family', 'living'] })
  })

  it('知らない id は捨て、区分の順にそろえる', () => {
    expect(knownSections(['goals', 'old-section', 'family', 'family'])).toEqual(['family', 'goals'])
  })
})

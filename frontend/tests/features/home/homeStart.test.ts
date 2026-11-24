import { describe, expect, it } from 'vitest'
import {
  ADD_GOAL_START,
  homeStart,
  ownGoalCount,
  RESUME_START,
} from '../../../src/features/home/homeStart'

// 目標がまだ無いときの「ながめる」（T25。SPEC §4.1）
describe('目標がまだ無いときの「ながめる」', () => {
  const childOnly = [{ kind: 'childCost' as const }, { kind: 'childCost' as const }]
  const withHome = [{ kind: 'childCost' as const }, { kind: 'home' as const }]

  it('子の費用のカードは自分で足した目標に数えない', () => {
    expect(ownGoalCount([])).toBe(0)
    expect(ownGoalCount(childOnly)).toBe(0)
    expect(ownGoalCount(withHome)).toBe(1)
  })

  it('入力の途中で目標が無い：「続きを入れる」で済んでいない最初の区分へ', () => {
    expect(homeStart('saved', childOnly, { done: ['family'] })).toBe(RESUME_START)
    expect(homeStart('saved', [], { done: [] })).toBe(RESUME_START)
    expect(RESUME_START.to).toBe('/plan')
  })

  it('入力を終えて目標が無い：「目標を足す」で目標の区分へ', () => {
    expect(homeStart('saved', childOnly, null)).toBe(ADD_GOAL_START)
    expect(ADD_GOAL_START.to).toBe('/plan/goals')
  })

  it('入力の途中は、目標を足していても「続きを入れる」（見本の値が残っているので結果を出さない）', () => {
    expect(homeStart('saved', withHome, { done: ['family'] })).toBe(RESUME_START)
    expect(homeStart('saved', withHome, { done: ['family', 'income', 'living', 'goals'] })).toBe(
      RESUME_START,
    )
  })

  it('入力を終えて目標を 1 つでも足せば、ふつうの「ながめる」', () => {
    expect(homeStart('saved', withHome, null)).toBeNull()
  })

  it('見本の世帯のあいだは出さない', () => {
    expect(homeStart('sample', childOnly, null)).toBeNull()
    expect(homeStart('sample', [], { done: [] })).toBeNull()
  })

  it('文は 1 つで、途中で改行しない', () => {
    for (const start of [RESUME_START, ADD_GOAL_START]) {
      expect(start.sentence).not.toMatch(/[\n。]/)
    }
  })
})

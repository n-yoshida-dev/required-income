/**
 * 知らせの一文（`noticeText`・`noticeLines`）のうち、T10 で足した大学資金・老後資金のカードの知らせ。
 * カードの名前（`ownerNames`）を渡すと頭に添え、NISA は置き場の選択肢と同じ「NISA」から始める。どの口座・どの枠がよいかは言わない（D31）
 */

import { describe, expect, it } from 'vitest'
import type { Notice } from '../../../src/domain/plan/types'
import { noticeLines, noticeText } from '../../../src/features/home/noticeText'

const names = new Map([
  ['u1', '大学資金（1人目）'],
  ['r1', '老後資金'],
])

/** NISA の上限の知らせ（金額はダミー） */
const nisa = (overrides: Partial<Extract<Notice, { kind: 'nisaLimit' }>>): Notice => ({
  kind: 'nisaLimit',
  goalId: 'r1',
  owner: 'household',
  account: 'adult',
  limit: 'annual',
  year: 2041,
  amount: 7400000,
  cap: 7200000,
  holders: 2,
  ...overrides,
})

describe('noticeText（T10）', () => {
  it('NISA の上限：子の名義は「NISA（子の名義）」、世帯は人数ぶん。正式な枠の名前は出さない', () => {
    expect(
      noticeText(
        nisa({
          goalId: 'u1',
          owner: 'child',
          account: 'minor',
          year: 2034,
          amount: 720000,
          cap: 600000,
          holders: 1,
        }),
        names,
      ),
    ).toBe('大学資金（1人目）：NISA（子の名義）：2034年の積立 72万円が、年の上限 60万円を超えます')
    expect(
      noticeText(nisa({ limit: 'lifetime', year: 2045, amount: 36100000, cap: 36000000 })),
    ).toBe('NISA（2人ぶん）：2045年に元本が 3,610万円になり、生涯の上限 3,600万円を超えます')
    expect(noticeText(nisa({ holders: 1, cap: 3600000 }))).toBe(
      'NISA：2041年の積立 740万円が、年の上限 360万円を超えます',
    )
  })

  it('児童手当だけで届く・期限が過ぎた', () => {
    expect(noticeText({ kind: 'allowanceCovers', goalId: 'u1', withSaved: false }, names)).toBe(
      '大学資金（1人目）：児童手当だけで届きます',
    )
    expect(noticeText({ kind: 'allowanceCovers', goalId: 'u1', withSaved: true }, names)).toBe(
      '大学資金（1人目）：児童手当と貯まっている額だけで届きます',
    )
    expect(noticeText({ kind: 'fundDeadlinePast', goalId: 'r1' }, names)).toBe(
      '老後資金：使う時期が過ぎているので、計算に入れていません',
    )
  })
})

describe('noticeLines', () => {
  it('同じカード・同じ名義の年の上限と生涯の上限は、前置きをくり返さず 1 文にまとめる', () => {
    const annual = nisa({})
    const lifetime = nisa({ limit: 'lifetime', year: 2045, amount: 36100000, cap: 36000000 })
    expect(noticeLines([annual, lifetime], names)).toEqual([
      '老後資金：NISA（2人ぶん）：2041年の積立 740万円が、年の上限 720万円を、2045年に元本が 3,610万円になり、生涯の上限 3,600万円を超えます',
    ])
  })

  it('ほかの知らせ・別のカードの知らせはまとめない。並びは元の順', () => {
    const other = nisa({ goalId: 'u1', owner: 'child', account: 'minor', cap: 600000, holders: 1 })
    const lifetime = nisa({ limit: 'lifetime', year: 2045, amount: 36100000, cap: 36000000 })
    const lines = noticeLines([{ kind: 'fundDeadlinePast', goalId: 'r1' }, other, lifetime])
    expect(lines).toHaveLength(3)
    expect(lines[0]).toBe('使う時期が過ぎているので、計算に入れていません')
    expect(lines[1]?.startsWith('NISA（子の名義）：')).toBe(true)
    expect(lines[2]?.startsWith('NISA（2人ぶん）：2045年に元本')).toBe(true)
  })
})

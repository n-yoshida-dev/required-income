import { describe, expect, it } from 'vitest'
import type { FallingStep } from '../../../src/domain/plan/stepReading'
import type { CauseChange, StepCause } from '../../../src/domain/plan/types'
import {
  causeHeading,
  causePhrase,
  causePhraseChunks,
  causeSubject,
  fallReason,
} from '../../../src/features/home/causeText'

/** 理由を 1 つ作る（金額はダミー。monthlyDelta は要る手取りを押し上げる向きが正） */
const cause = (label: string, change: CauseChange, monthlyDelta: number): StepCause => ({
  goalId: `g-${label}`,
  label,
  monthlyDelta,
  change,
  monthly: Math.abs(monthlyDelta),
})

/** 下がる段を 1 つ作る（金額はダミー） */
const fall = (overrides: Partial<FallingStep> = {}): FallingStep => ({
  index: 2,
  fromYear: 2031,
  cause: cause('学校（2人目）', 'end', -27000),
  others: 0,
  ...overrides,
})

describe('causeSubject（理由の帯を文の主語にする）', () => {
  it('名前だけでお金と読める帯は名前のまま（積立・返済・費・料・税・家賃など）', () => {
    expect(causeSubject(cause('車のローンの返済', 'start', 40000))).toBe('車のローンの返済')
    expect(causeSubject(cause('次の車の積立', 'start', 20000))).toBe('次の車の積立')
    expect(causeSubject(cause('車の維持費', 'end', -10000))).toBe('車の維持費')
    expect(causeSubject(cause('保育料（1人目）', 'end', -30000))).toBe('保育料（1人目）')
    expect(causeSubject(cause('修繕と税', 'start', 20000))).toBe('修繕と税')
    expect(causeSubject(cause('家賃', 'end', -90000))).toBe('家賃')
    expect(causeSubject(cause('見本：ペットの費用', 'start', 8000))).toBe('見本：ペットの費用')
  })

  it('名前の終わりが 代・金・手当 の支払いの帯も名前のまま（「の費用」を付けない。PR #99 の指摘）', () => {
    expect(causeSubject(cause('給食代', 'start', 4700))).toBe('給食代')
    expect(causeSubject(cause('車検代', 'more', 6300))).toBe('車検代')
    expect(causeSubject(cause('入学金（1人目）', 'start', 21000))).toBe('入学金（1人目）')
    expect(causeSubject(cause('見本：仕送り金', 'end', -38000))).toBe('見本：仕送り金')
    expect(causeSubject(cause('見本：介護の手当', 'start', 12000))).toBe('見本：介護の手当')
    // 言い回しと文節のかたまりも名前のまま（添える言葉のかたまりを作らない）
    expect(causePhrase(cause('給食代', 'start', 4700))).toBe('給食代が始まる')
    expect(causePhraseChunks(cause('入学金（1人目）', 'start', 21000))).toEqual([
      '入学金（1人目）が',
      '始まる',
    ])
    expect(causePhraseChunks(cause('見本：介護の手当', 'start', 12000))).toEqual([
      '見本：介護の手当が',
      '始まる',
    ])
  })

  it('代・金・手当が名前の途中にあるだけなら「の費用」を添える（終わりだけを見る）', () => {
    expect(causeSubject(cause('代行サービス', 'start', 9000))).toBe('代行サービスの費用')
    expect(causeSubject(cause('金魚の世話', 'start', 3000))).toBe('金魚の世話の費用')
    expect(causeSubject(cause('手当て講習', 'start', 2000))).toBe('手当て講習の費用')
  })

  it('名前の終わりが 金・手当 でも、収入の帯なら「の受け取り」（収入かの判定が先）', () => {
    expect(causeSubject(cause('見本：給付金', 'start', -15000))).toBe('見本：給付金の受け取り')
    expect(causeSubject(cause('見本：住宅手当', 'end', 18000))).toBe('見本：住宅手当の受け取り')
  })

  it('名前だけでお金と読めない支払いの帯は「の費用」を添える（「学校が終わる」を下校に読ませない）', () => {
    expect(causeSubject(cause('学校（1人目）', 'end', -27000))).toBe('学校（1人目）の費用')
    expect(causeSubject(cause('塾（2人目）', 'more', 10000))).toBe('塾（2人目）の費用')
    expect(causeSubject(cause('家族旅行', 'start', 10000))).toBe('家族旅行の費用')
  })

  it('収入の帯は「の受け取り」（「費用が終わる」にしない）', () => {
    expect(causeSubject(cause('児童手当（1人目）', 'end', 10000))).toBe(
      '児童手当（1人目）の受け取り',
    )
    expect(causeSubject(cause('就学支援金（2人目）', 'start', -9000))).toBe(
      '就学支援金（2人目）の受け取り',
    )
  })
})

describe('causePhrase（名前と動きの 1 つの言い回し）', () => {
  it('本人が OK した言い方：始まる・終わる', () => {
    expect(causePhrase(cause('車のローンの返済', 'start', 43000))).toBe('車のローンの返済が始まる')
    expect(causePhrase(cause('次の車の積立', 'start', 26000))).toBe('次の車の積立が始まる')
    expect(causePhrase(cause('学校（1人目）', 'end', -27000))).toBe('学校（1人目）の費用が終わる')
  })

  it('増える・減るも同じ言い回し', () => {
    expect(causePhrase(cause('塾（1人目）', 'more', 8000))).toBe('塾（1人目）の費用が増える')
    expect(causePhrase(cause('生活費', 'less', -10000))).toBe('生活費が減る')
    expect(causePhrase(cause('児童手当（1人目）', 'less', 5000))).toBe(
      '児童手当（1人目）の受け取りが減る',
    )
  })

  it('記号（± や ↓）を使わない', () => {
    expect(causePhrase(cause('家賃', 'end', -90000))).not.toMatch(/[+−\-↓]/)
  })
})

describe('causePhraseChunks（言い回しの文節のかたまり。T22）', () => {
  it('名前のまま・「の費用」・「の受け取り」を、名前・添えた言葉・動きのかたまりに分ける。名前の中では切らない', () => {
    expect(causePhraseChunks(cause('車のローンの返済', 'start', 43000))).toEqual([
      '車のローンの返済が',
      '始まる',
    ])
    expect(causePhraseChunks(cause('学校（1人目）', 'end', -27000))).toEqual([
      '学校（1人目）の',
      '費用が',
      '終わる',
    ])
    expect(causePhraseChunks(cause('児童手当（1人目）', 'less', 5000))).toEqual([
      '児童手当（1人目）の',
      '受け取りが',
      '減る',
    ])
    // 名前が「費用」で終わる帯は名前のまま（「見本：ペットの費用」を割らない）
    expect(causePhraseChunks(cause('見本：ペットの費用', 'start', 8000))).toEqual([
      '見本：ペットの費用が',
      '始まる',
    ])
  })
})

describe('causeHeading（次の段の理由の見出し）', () => {
  it('「◯年に変わること」', () => {
    expect(causeHeading(2029)).toBe('2029年に変わること')
  })
})

describe('fallReason（段が下がる理由）', () => {
  it('「車のローンの返済が」「終わるので」（本人が OK した下がる段の言い方の理由の所）', () => {
    expect(
      fallReason(fall({ fromYear: 2035, cause: cause('車のローンの返済', 'end', -43000) })),
    ).toEqual(['車のローンの返済が', '終わるので'])
  })

  it('ほかにも下げる理由があれば主語に「など」を添える', () => {
    expect(fallReason(fall({ others: 2 }))?.join('')).toBe('学校（2人目）の費用などが終わるので')
  })

  it('収入の帯が始まって下がるときは「受け取りが始まる」', () => {
    expect(fallReason(fall({ cause: cause('児童手当（3人目）', 'start', -10000) }))?.join('')).toBe(
      '児童手当（3人目）の受け取りが始まるので',
    )
  })

  it('理由が無ければ null（金額だけ言う）', () => {
    expect(fallReason(fall({ cause: null }))).toBeNull()
  })
})

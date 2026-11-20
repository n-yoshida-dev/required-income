/**
 * 児童手当の帯（SPEC §3.2 の `childCost` と `university`）。
 *
 * 児童手当は、子の費用のカードが「児童手当」`income` の帯で出す。その子の大学資金のカードがオンで「回す」なら、
 * 大学資金のカードが同じ額を `earmarked` の帯で出し、子の費用のカードは出さない（二重に数えない・数え漏らさない。T10 の呼び出し側の設計の決定）。
 *
 * 額は前の版の `benefit/childAllowance.ts` の数え方のまま、月ごとに出す（`childAllowanceInMonth`）：
 * 支給は生まれた月の翌月から、18 歳になった後の最初の 3 月まで。3 歳の区分は誕生月の翌月から。第 3 子の加算は月ごとに数え直す。
 * 支払いの月（偶数月にその前月までの 2 か月分）は扱わず、何月分かで数える（前の版と同じ。年額は変わらない）。
 * 第 3 子の加算があるので、子を全員まとめて渡し、子ごとに割り振る。
 * 物価は掛けない（法律で決まった名目の額。前の版と同じ）。
 */

import { childAllowanceInMonth } from '../../benefit/childAllowance'
import { FIRST_GRADE, yearOfGrade } from '../../expense/education'
import type { Child } from '../../types'
import type { Band, BandContext, ChildId, ChildProfile, Goal, YearMonth, Yen } from '../types'
import { addMonths, compareYearMonth, monthsBetween, yearMonth } from '../yearMonth'
import { makeBand } from './band'

/** 帯の名前（子の順を添える前） */
export const CHILD_ALLOWANCE_LABEL = '児童手当'

/**
 * 子を、前の版の児童手当・学年の計算が読む子の形に直す。読むのは id と生まれ年月だけなので、進路などは使われない値で埋める
 */
export function legacyChildOf(child: ChildProfile): Child {
  return {
    id: child.id,
    birthYear: child.birthYear,
    birthMonth: child.birthMonth,
    elementarySchoolType: 'public',
    juniorHighType: 'public',
    highSchoolType: 'public',
    universityType: 'none',
    annualHighSchoolTuition: null,
    cramSchoolPeriods: [],
  }
}

/**
 * 大学資金を使う月：高校 3 年の次の 4 月（大学 1 年の 4 月）。積立はこの月の前まで。
 * 学年は生まれ年月から出す（1〜3 月生まれは 1 年早い。`schoolEntryYear`）。
 * 児童手当の支給の終わり（18 歳になった後の最初の 3 月）の翌月と同じ月になる（テストで固定）
 */
export function universityUseMonth(child: ChildProfile): YearMonth {
  return yearMonth(yearOfGrade(legacyChildOf(child), FIRST_GRADE.university), 4)
}

/**
 * 児童手当を大学資金に回している子。その子の大学資金のカードがオンで「回す」の物（`BandContext.allowanceEarmarked`）
 */
export function earmarkedChildren(goals: readonly Goal[]): Set<ChildId> {
  const ids = new Set<ChildId>()
  for (const goal of goals) {
    if (goal.kind === 'university' && goal.enabled && goal.allocateChildAllowance) {
      ids.add(goal.childId)
    }
  }
  return ids
}

/**
 * その子の児童手当の月額を、`from` の月から `to` の前まで 1 か月ずつ並べる。`to` が `from` 以前なら空。
 * 第 3 子の加算を数えるため、家族の子を全員まとめて渡す
 */
export function childAllowanceMonthly(
  ctx: Pick<BandContext, 'children' | 'tables'>,
  childId: ChildId,
  from: YearMonth,
  to: YearMonth,
): Yen[] {
  if (!ctx.children.some((child) => child.id === childId)) {
    throw new RangeError(`児童手当の子が見つかりません: ${childId}`)
  }
  const children = ctx.children.map(legacyChildOf)
  const months = Math.max(0, monthsBetween(from, to))
  const amounts: Yen[] = []
  for (let offset = 0; offset < months; offset++) {
    const month = addMonths(from, offset)
    const byChild = childAllowanceInMonth(
      children,
      ctx.tables.childAllowance,
      month.year,
      month.month,
    )
    amounts.push(byChild.get(childId) ?? 0)
  }
  return amounts
}

/**
 * 月額の並びを帯にまとめる。隣り合う月の額が同じなら 1 本にし、0 円の月は帯にしない
 *
 * @param from 並びの 0 番目の月
 */
export function bandsFromMonthly(
  band: Pick<Band, 'goalId' | 'label' | 'kind'>,
  amounts: readonly Yen[],
  from: YearMonth,
): Band[] {
  const bands: Band[] = []
  amounts.forEach((monthly, offset) => {
    if (monthly === 0) return
    const start = addMonths(from, offset)
    const end = addMonths(start, 1)
    const last = bands[bands.length - 1]
    if (last !== undefined && last.monthly === monthly && compareYearMonth(last.to, start) === 0) {
      bands[bands.length - 1] = makeBand({ ...last, to: end })
    } else {
      bands.push(makeBand({ ...band, monthly, from: start, to: end }))
    }
  })
  return bands
}

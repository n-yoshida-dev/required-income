/**
 * NISA の上限の知らせ（SPEC §3.2 の最後の段落・「大学資金・老後資金のカードの細部」・§3.9）。
 *
 * 置き場が NISA の大学資金・老後資金のカードについて、積む元本（家計から足す分と、大学資金なら児童手当から回す分）を暦年ごとに足し、
 * 年の上限と、元本の累計と生涯の上限を比べる。超えたら知らせるだけで、計算は止めない（どの口座・どの枠がよいかは言わない。D31）。
 * 上限の値は `data/benefit/nisa.json` の裏取り済みの値だけ（`NisaLimits`）。`unverified` の 2 項目（未成年の間の分が大人の生涯の上限に含まれるか・
 * 未成年者の枠の再利用）は判定に使わない。
 *
 * 決め事（SPEC §3.2「大学資金・老後資金のカードの細部」に写した）：
 *
 * - 大学資金（子の名義）：1 月 1 日に 18 歳未満の年と生まれた年は、未成年者のつみたて投資枠（年 60 万円・生涯 600 万円）と比べる。
 *   枠が始まる 2027 年より前と、生まれる前の年は口座が無いので判定せず、生涯の累計にも入れない。
 *   1 月 1 日に 18 歳以上の年（1〜3 月生まれでない子の高校 3 年の 1〜3 月）は、その子の大人の枠（つみたて投資枠 ＋ 成長投資枠の年の上限）と比べ、生涯は比べない
 * - 老後資金（世帯の目標）：その年の 1 月 1 日に 18 歳以上の大人の人数 ×（つみたて投資枠 ＋ 成長投資枠）を年の上限、人数 × 生涯の上限を生涯の上限とする。
 *   世帯で積める限りいっぱいまで入るとみなし、それでも入らないときだけ知らせる（どの枠・誰の名義に置くかを勧めないため）
 * - 生涯の上限は元本の累計で数え、売って枠が空くこと（再利用）は数えない（積立の途中で売らない前提）。貯まっている額は NISA の外とみなし数えない
 */

import type { FundPlan, Goal, LifePlan, NisaLimits, Notice, Year, Yen } from './types'
import { addMonths, monthsBetween } from './yearMonth'

/**
 * 積立の答えから、暦年ごとに積む元本（家計から足す分 ＋ 児童手当から回す分）を出す。年の昇順
 */
export function principalByYear(plan: FundPlan): Map<Year, Yen> {
  const byYear = new Map<Year, Yen>()
  const months = monthsBetween(plan.from, plan.useMonth)
  for (let offset = 0; offset < months; offset++) {
    const { year } = addMonths(plan.from, offset)
    const amount = plan.householdMonthly + (plan.allowanceMonthly[offset] ?? 0)
    byYear.set(year, (byYear.get(year) ?? 0) + amount)
  }
  return byYear
}

/** 上限を超えた 1 件（知らせの材料） */
export type NisaBreach = Pick<
  Extract<Notice, { kind: 'nisaLimit' }>,
  'account' | 'limit' | 'year' | 'amount' | 'cap' | 'holders'
>

/**
 * 子の名義の NISA（大学資金）の上限を確かめる。年の上限は口座の種類ごと、生涯の上限は 1 つ、それぞれ最初に超える年だけを返す。
 * ちょうど上限は超えない
 */
export function childNisaBreaches(
  principal: ReadonlyMap<Year, Yen>,
  birthYear: Year,
  limits: NisaLimits,
): NisaBreach[] {
  const breaches: NisaBreach[] = []
  // 年の上限は口座の種類（未成年者の枠・18 歳からの枠）ごとに最初の 1 件を出す
  const annualFound = { minor: false, adult: false }
  let lifetimeFound = false
  let minorTotal = 0
  for (const [year, amount] of [...principal].sort(([a], [b]) => a - b)) {
    // 生まれる前の年は口座が無い。1 月 1 日の年齢は「年 − 生まれ年 − 1」（生まれた年は −1 で、未成年者の枠に入る）
    if (year < birthYear) continue
    const ageOnJan1 = year - birthYear - 1
    if (ageOnJan1 < limits.minor.maxAgeOnJan1Exclusive) {
      // 未成年者の枠が始まる前の年は判定しない（口座が無い）。累計にも入れない
      if (year < limits.minor.fromYear) continue
      minorTotal += amount
      if (!annualFound.minor && amount > limits.minor.annual) {
        annualFound.minor = true
        breaches.push(breach('minor', 'annual', year, amount, limits.minor.annual, 1))
      }
      if (!lifetimeFound && minorTotal > limits.minor.lifetime) {
        lifetimeFound = true
        breaches.push(breach('minor', 'lifetime', year, minorTotal, limits.minor.lifetime, 1))
      }
      continue
    }
    if (year < limits.adult.fromYear) continue
    const cap = limits.adult.annualTsumitate + limits.adult.annualGrowth
    if (!annualFound.adult && amount > cap) {
      annualFound.adult = true
      breaches.push(breach('adult', 'annual', year, amount, cap, 1))
    }
  }
  return breaches
}

/**
 * 世帯の NISA（老後資金）の上限を確かめる。上限は、その年の 1 月 1 日に 18 歳以上の大人の人数ぶん。
 * 年・生涯それぞれ、最初に超える年だけを返す。ちょうど上限は超えない
 */
export function householdNisaBreaches(
  principal: ReadonlyMap<Year, Yen>,
  adultBirthYears: readonly Year[],
  limits: NisaLimits,
): NisaBreach[] {
  const breaches: NisaBreach[] = []
  let annualFound = false
  let lifetimeFound = false
  let total = 0
  for (const [year, amount] of [...principal].sort(([a], [b]) => a - b)) {
    if (year < limits.adult.fromYear) continue
    const holders = adultBirthYears.filter(
      (birthYear) => year - birthYear - 1 >= limits.adult.minAgeOnJan1,
    ).length
    if (holders === 0) continue
    total += amount
    const annualCap = holders * (limits.adult.annualTsumitate + limits.adult.annualGrowth)
    if (!annualFound && amount > annualCap) {
      annualFound = true
      breaches.push(breach('adult', 'annual', year, amount, annualCap, holders))
    }
    const lifetimeCap = holders * limits.adult.lifetime
    if (!lifetimeFound && total > lifetimeCap) {
      lifetimeFound = true
      breaches.push(breach('adult', 'lifetime', year, total, lifetimeCap, holders))
    }
  }
  return breaches
}

/**
 * 大学資金・老後資金のカードの知らせ（NISA の上限・児童手当だけで届く・期限が過ぎた）を集める。
 * `fundOf` はカードの積立の答え（期限が過ぎていれば null）。オンのカードだけを見る
 */
export function fundNotices(
  plan: Pick<LifePlan, 'goals' | 'children' | 'adults'>,
  fundOf: (goal: Goal) => FundPlan | null,
  limits: NisaLimits,
): Notice[] {
  const notices: Notice[] = []
  for (const goal of plan.goals) {
    if (!goal.enabled || (goal.kind !== 'university' && goal.kind !== 'retirement')) continue
    const fund = fundOf(goal)
    if (fund === null) {
      notices.push({ kind: 'fundDeadlinePast', goalId: goal.id })
      continue
    }
    if (goal.kind === 'university') {
      if (
        goal.allocateChildAllowance &&
        fund.householdMonthly === 0 &&
        fund.reached.allowance > 0
      ) {
        notices.push({ kind: 'allowanceCovers', goalId: goal.id, withSaved: goal.saved > 0 })
      }
      if (goal.vehicle !== 'childNisa') continue
      const child = plan.children.find((entry) => entry.id === goal.childId)
      if (child === undefined) continue
      for (const found of childNisaBreaches(principalByYear(fund), child.birthYear, limits)) {
        notices.push({ kind: 'nisaLimit', goalId: goal.id, owner: 'child', ...found })
      }
      continue
    }
    if (goal.vehicle !== 'nisa') continue
    const birthYears = plan.adults.map((adult) => adult.birthYear)
    for (const found of householdNisaBreaches(principalByYear(fund), birthYears, limits)) {
      notices.push({ kind: 'nisaLimit', goalId: goal.id, owner: 'household', ...found })
    }
  }
  return notices
}

/** 超えた 1 件を作る */
function breach(
  account: NisaBreach['account'],
  limit: NisaBreach['limit'],
  year: Year,
  amount: Yen,
  cap: Yen,
  holders: number,
): NisaBreach {
  return { account, limit, year, amount, cap, holders }
}

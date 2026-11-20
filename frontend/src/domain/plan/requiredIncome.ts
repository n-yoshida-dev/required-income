/**
 * 段ごとの要る世帯年収と、埋め方の換算（SPEC §3.6）。
 *
 * - **要る世帯年収** ＝ ほかの大人の見込み ＋ 「いちばん稼ぐ大人」の本業を動かして、世帯の手取りが要る手取りにちょうど届く額
 *   （会社員は給与の額面、自営業は所得を動かす）
 * - **埋め方の換算**：本業を上げるなら年いくら／副業なら所得で月いくら／もう 1 人の大人の本業を上げるなら年いくら。
 *   同じ探索を、動かす物だけ替えて回す。アプリはどれかを勧めない（D31）
 *
 * 探し方は `tax/requiredGross.ts` と同じ：二分探索で当たりを付け、社会保険の等級や国保の軽減の段差に備えて解の下を一定の幅だけ総当たりする。
 * 刻み・上限・総当たりの幅は `DEFAULT_REQUIRED_GROSS_OPTIONS`（1 万円・1 億円・100 万円）を使い回す。
 * 税は `householdTaxYear(…, previous: null, …)` で呼ぶ（その段の所得がずっと続いたときの答え）。
 *
 * 届かないことは例外にせず null で返す（`.claude/rules/domain-purity.md`）。
 */

import { householdTaxYear, type HouseholdTaxYear } from '../tax/household'
import { DEFAULT_REQUIRED_GROSS_OPTIONS } from '../tax/requiredGross'
import { canEarnIn, householdGross, householdTaxIncome } from './taxBridge'
import type {
  Adult,
  IncomeConversion,
  IncomeLevel,
  IncomeLevels,
  PersonId,
  SolveContext,
  Yen,
} from './types'

/** 要る世帯年収の答え */
export type RequiredGrossResult = {
  /** 要る世帯年収（その年の円） */
  gross: Yen
  /** 本業を動かした大人と、その本業の額。動かせる大人がいなかったときは null */
  mover: { personId: PersonId; main: Yen } | null
  /** 答えの収入での世帯の税（自治体の概算を知らせるのに使う） */
  taxYear: HouseholdTaxYear
}

/**
 * 段 1 つの要る世帯年収を解く関数の形（`requiredHouseholdGross` と同じ）。
 * 目標の重さ（`impact.ts`）が、換算の入力が同じ段の答えを使い回す関数に差し替える
 */
export type GrossSolver = (ctx: SolveContext, targetNet: Yen) => RequiredGrossResult | null

/** 埋め方の換算 3 つ（その年の円） */
export type ConversionSet = {
  mainJob: IncomeConversion | null
  sideJob: IncomeConversion | null
  otherAdult: IncomeConversion | null
}

/**
 * 刻み数 0〜`maxUnits` のうち、条件を満たす最小の刻み数を探す。上限でも満たさなければ null。
 * 二分探索で満たす点を見つけたあと、その下 `scanBackUnits` 刻みぶんを総当たりして、段差の手前の小さい解を拾う
 */
export function searchMinimalUnits(
  meets: (units: number) => boolean,
  maxUnits: number,
  scanBackUnits: number,
): number | null {
  if (!Number.isInteger(maxUnits) || maxUnits < 0) {
    throw new RangeError(`探索の上限は 0 以上の整数で指定してください: ${maxUnits}`)
  }
  if (!Number.isInteger(scanBackUnits) || scanBackUnits < 0) {
    throw new RangeError(`総当たりの幅は 0 以上の整数で指定してください: ${scanBackUnits}`)
  }
  if (!meets(maxUnits)) {
    return null
  }
  // 二分探索：low は満たさない、high は満たす
  let high = maxUnits
  if (meets(0)) {
    high = 0
  } else {
    let low = 0
    while (high - low > 1) {
      const mid = Math.floor((low + high) / 2)
      if (meets(mid)) {
        high = mid
      } else {
        low = mid
      }
    }
  }
  let best = high
  for (let units = high - 1; units >= Math.max(0, high - scanBackUnits); units -= 1) {
    if (meets(units)) {
      best = units
    }
  }
  return best
}

/** その収入の水準での世帯の税（前の年も同じ所得だったとみなす） */
export function householdTaxAt(ctx: SolveContext, levels: IncomeLevels): HouseholdTaxYear {
  return householdTaxYear(
    ctx.taxInput,
    householdTaxIncome(ctx.plan, ctx.year, levels, ctx.settings),
    null,
    ctx.tables,
  )
}

/**
 * その年にいちばん稼ぐ大人（本業を動かせる大人のうち、見込みの本業がいちばん大きい人。同じなら先に並んでいる人）。
 * 動かせる大人がいなければ null
 */
export function topEarner(ctx: Pick<SolveContext, 'plan' | 'year' | 'expected'>): Adult | null {
  let best: Adult | null = null
  for (const adult of ctx.plan.adults) {
    if (!canEarnIn(adult, ctx.year)) continue
    if (best === null || mainOf(ctx.expected, adult.id) > mainOf(ctx.expected, best.id)) {
      best = adult
    }
  }
  return best
}

/**
 * 要る手取り（その年の円）に届く世帯年収。いちばん稼ぐ大人の本業を 0 から探す。
 * 上限まで上げても届かない、動かせる大人がいなくて見込みのままでは届かない、なら null
 */
export function requiredHouseholdGross(
  ctx: SolveContext,
  targetNet: Yen,
): RequiredGrossResult | null {
  const mover = topEarner(ctx)
  if (mover === null) {
    const taxYear = householdTaxAt(ctx, ctx.expected)
    return taxYear.netIncome >= targetNet
      ? { gross: householdGross(ctx.expected), mover: null, taxYear }
      : null
  }
  const solved = solveMain(ctx, mover.id, 0, targetNet)
  if (solved === null) {
    return null
  }
  const levels = withLevel(ctx.expected, mover.id, { main: solved })
  return {
    gross: householdGross(levels),
    mover: { personId: mover.id, main: solved },
    taxYear: householdTaxAt(ctx, levels),
  }
}

/**
 * 埋め方の換算（要る手取りが見込みの手取りを上回るときに呼ぶ）。どれも今の見込みから上へ探す。
 *
 * @param required `requiredHouseholdGross` の答え。本業の換算はこれを使い回す（答えが今の見込み以上なら、今から上へ探しても同じ答えになるため）
 */
export function incomeConversions(
  ctx: SolveContext,
  targetNet: Yen,
  required: RequiredGrossResult | null,
): ConversionSet {
  const top = topEarner(ctx)
  if (top === null) {
    return { mainJob: null, sideJob: null, otherAdult: null }
  }

  // 本業：要る世帯年収の答えが今の見込み以上なら、そのまま使う。下回る（段差の手前に解がある）ときだけ今から上へ探し直す
  const currentMain = mainOf(ctx.expected, top.id)
  const reused =
    required?.mover?.personId === top.id && required.mover.main >= currentMain
      ? required.mover.main
      : null
  const mainRequired = reused ?? solveMain(ctx, top.id, currentMain, targetNet)

  // もう 1 人の大人：大人が 2 人で、もう 1 人が働いていて退職していないときだけ
  const other = ctx.plan.adults.find((adult) => adult.id !== top.id)
  const otherCanEarn = other !== undefined && canEarnIn(other, ctx.year)
  const otherCurrent = other === undefined ? 0 : mainOf(ctx.expected, other.id)
  const otherRequired =
    other !== undefined && otherCanEarn ? solveMain(ctx, other.id, otherCurrent, targetNet) : null

  // 副業：いちばん稼ぐ大人の副業の所得（月）を今から上へ探す
  const currentSide = sideOf(ctx.expected, top.id)
  const sideRequired = solveSide(ctx, top.id, currentSide, targetNet)

  return {
    mainJob: conversion(top.id, currentMain, mainRequired),
    sideJob: conversion(top.id, currentSide, sideRequired),
    otherAdult: other === undefined ? null : conversion(other.id, otherCurrent, otherRequired),
  }
}

/** 本業を `from` から 1 万円刻みで上へ探す。届く最小の本業の額。届かなければ null */
function solveMain(ctx: SolveContext, personId: PersonId, from: Yen, targetNet: Yen): Yen | null {
  const { step, maxGross, scanBackWidth } = DEFAULT_REQUIRED_GROSS_OPTIONS
  const maxUnits = Math.max(0, Math.floor((maxGross - from) / step))
  const units = searchMinimalUnits(
    (k) =>
      householdTaxAt(ctx, withLevel(ctx.expected, personId, { main: from + k * step })).netIncome >=
      targetNet,
    maxUnits,
    Math.ceil(scanBackWidth / step),
  )
  return units === null ? null : from + units * step
}

/** 副業の所得（月）を `from` から上へ探す。届く最小の月額。届かなければ null */
function solveSide(ctx: SolveContext, personId: PersonId, from: Yen, targetNet: Yen): Yen | null {
  const step = ctx.sideMonthlyStep
  if (!Number.isInteger(step) || step <= 0) {
    throw new RangeError(`副業の月額を探す刻みは正の整数で指定してください: ${step}`)
  }
  const { maxGross, scanBackWidth } = DEFAULT_REQUIRED_GROSS_OPTIONS
  // 本業と同じ上限と総当たりの幅を、月額に直して使う
  const maxUnits = Math.max(0, Math.floor((maxGross / 12 - from) / step))
  const units = searchMinimalUnits(
    (k) =>
      householdTaxAt(ctx, withLevel(ctx.expected, personId, { sideMonthly: from + k * step }))
        .netIncome >= targetNet,
    maxUnits,
    Math.ceil(scanBackWidth / 12 / step),
  )
  return units === null ? null : from + units * step
}

/** 1 人の水準だけを差し替えた収入の水準 */
function withLevel(
  levels: IncomeLevels,
  personId: PersonId,
  patch: Partial<IncomeLevel>,
): IncomeLevels {
  const current = levels.get(personId)
  if (current === undefined) {
    throw new RangeError(`収入の水準に大人がいません: ${personId}`)
  }
  const next = new Map(levels)
  next.set(personId, { ...current, ...patch })
  return next
}

/** 換算 1 つを作る。届かなければ null */
function conversion(
  personId: PersonId,
  current: Yen,
  required: Yen | null,
): IncomeConversion | null {
  return required === null ? null : { personId, current, required, increase: required - current }
}

/** その人の本業の見込み */
function mainOf(levels: IncomeLevels, personId: PersonId): Yen {
  return levels.get(personId)?.main ?? 0
}

/** その人の副業の見込み（月） */
function sideOf(levels: IncomeLevels, personId: PersonId): Yen {
  return levels.get(personId)?.sideMonthly ?? 0
}

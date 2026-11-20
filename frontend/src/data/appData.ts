/**
 * アプリの既定値・見本の世帯・制度データを束ねて、画面へ渡す（SPEC §1・§6）。
 *
 * domain は JSON を import せず引数で受け取る契約なので（`.claude/rules/domain-purity.md`）、
 * 画面が使う JSON はここで 1 回だけ型に当てはめる。JSON の形が型から外れたら型検査で落ちる。
 * 制度データの束は前の版から `masterTables.ts` にあり、それをそのまま渡す。
 *
 * 前提の住宅ローン金利の既定値は `defaults.json` に持たず、`housing/flat35-rate.json` の最頻金利をここで入れる
 * （毎月変わる値を 2 か所に写さない。T7）。
 */

import defaultsJson from './app/defaults.json'
import sampleHouseholdJson from './app/sample-household.json'
import nisaJson from './benefit/nisa.json'
import flat35Json from './housing/flat35-rate.json'
import { masterTables } from './masterTables'
import type {
  AppDefaults,
  NisaLimits,
  PlanTables,
  SampleHouseholdSource,
} from '../domain/plan/types'

export { masterTables }

/** `defaults.json` の形。住宅ローン金利だけは制度データから入れるので持たない */
type AppDefaultsJson = Omit<AppDefaults, 'assumptions'> & {
  assumptions: Omit<AppDefaults['assumptions'], 'mortgageRate'>
}

/** フラット35 の金利のうち、既定値に使う部分 */
type Flat35RateJson = {
  status: string
  appliesTo: string
  mostCommonRate: number
}

/**
 * 前提の住宅ローン金利の既定値と、その出どころの一言（画面の欄の下に出す）。
 * 裏取りの済んでいない値は既定値にしない（投げる。`.claude/rules/institution-data.md`）
 */
export function mortgageRateDefault(flat35: Flat35RateJson): {
  value: number
  basis: string
  label: string
} {
  if (flat35.status !== 'verified') {
    throw new Error(`フラット35 の金利が裏取りされていません（status: ${flat35.status}）`)
  }
  const matched = /^(\d{4})-(\d{2})$/.exec(flat35.appliesTo)
  if (matched === null) {
    throw new Error(`フラット35 の金利の月が読めません: ${flat35.appliesTo}`)
  }
  const label = `全期間固定（フラット35）の${matched[1]}年${Number(matched[2])}月の最頻金利`
  return {
    value: flat35.mostCommonRate,
    basis: `${label}（data/housing/flat35-rate.json。毎月変わる。D12 は固定金利が前提）`,
    label,
  }
}

const defaultsSource: AppDefaultsJson = defaultsJson.values
const mortgage = mortgageRateDefault(flat35Json.values.flat35)

/** 前提の住宅ローン金利の既定値の出どころ（「全期間固定（フラット35）の2026年11月の最頻金利」） */
export const mortgageRateLabel = mortgage.label

/** アプリの既定値（段のしきい値・税への橋渡しの既定など）。`evaluate` の第 3 引数 */
export const appDefaults: AppDefaults = {
  ...defaultsSource,
  assumptions: {
    ...defaultsSource.assumptions,
    mortgageRate: { value: mortgage.value, basis: mortgage.basis },
  },
}

/** 見本の世帯（すべてダミー値）。保存が無いとき・壊れていたときに出す */
export const sampleHousehold: SampleHouseholdSource = sampleHouseholdJson.values

/** 裏取りの状態つきの値 1 つ（`nisa.json` の項目の形） */
type CheckedValue<T> = { value: T; status: string }

/** `nisa.json` の `schedule` の 1 件のうち、上限の知らせに使う部分 */
type NisaScheduleJson = {
  id: string
  fromYear: number
  eligibility: Record<string, CheckedValue<number | boolean> | undefined>
  annualLimit: Record<string, CheckedValue<number> | undefined>
  lifetimeLimit: Record<string, CheckedValue<number> | undefined>
}

/**
 * `nisa.json` から NISA の上限（`NisaLimits`）を組み立てる。
 * 使う値は裏取りが `verified` の物だけ。足りない・裏取りされていない値があれば投げる（`.claude/rules/institution-data.md`）。
 * `unverified` の 2 項目（未成年の間の分が大人の生涯の上限に含まれるか・未成年者の枠の再利用）は読まない
 */
export function nisaLimitsFrom(schedule: readonly NisaScheduleJson[]): NisaLimits {
  const entry = (id: string): NisaScheduleJson => {
    const found = schedule.find((item) => item.id === id)
    if (found === undefined) throw new Error(`NISA の表に「${id}」がありません`)
    return found
  }
  const checked = <T>(item: CheckedValue<T> | undefined, label: string): T => {
    if (item === undefined) throw new Error(`NISA の表に ${label} がありません`)
    if (item.status !== 'verified') {
      throw new Error(`NISA の ${label} が裏取りされていません（status: ${item.status}）`)
    }
    return item.value
  }
  const number = (item: CheckedValue<number | boolean> | undefined, label: string): number => {
    const value = checked(item, label)
    if (typeof value !== 'number') throw new Error(`NISA の ${label} が数ではありません`)
    return value
  }
  const adult = entry('adult')
  const minor = entry('minor')
  // 生まれた年を未成年者の枠に含む（domain は「1 月 1 日に 18 歳未満の年と生まれた年」で数える）ことを、表の値で確かめる
  if (
    checked(minor.eligibility.includesBirthYear, 'minor.eligibility.includesBirthYear') !== true
  ) {
    throw new Error(
      'NISA の未成年者の枠が生まれた年を含まない表になっています（domain の数え方と合わない）',
    )
  }
  return {
    adult: {
      fromYear: adult.fromYear,
      minAgeOnJan1: number(adult.eligibility.minAgeOnJan1, 'adult.eligibility.minAgeOnJan1'),
      annualTsumitate: checked(adult.annualLimit.tsumitate, 'adult.annualLimit.tsumitate'),
      annualGrowth: checked(adult.annualLimit.growth, 'adult.annualLimit.growth'),
      lifetime: checked(adult.lifetimeLimit.total, 'adult.lifetimeLimit.total'),
    },
    minor: {
      fromYear: minor.fromYear,
      maxAgeOnJan1Exclusive: number(
        minor.eligibility.maxAgeOnJan1Exclusive,
        'minor.eligibility.maxAgeOnJan1Exclusive',
      ),
      annual: checked(minor.annualLimit.tsumitate, 'minor.annualLimit.tsumitate'),
      lifetime: checked(minor.lifetimeLimit.total, 'minor.lifetimeLimit.total'),
    },
  }
}

/** NISA の上限（`data/benefit/nisa.json`） */
export const nisaLimits: NisaLimits = nisaLimitsFrom(nisaJson.values.schedule)

/**
 * `evaluate` に渡す表：制度データの束（`masterTables`）に NISA の上限を足した物。
 * NISA は前の版の `MasterTables` に無いので、前の版の型と束を変えずにここで足す
 */
export const planTables: PlanTables = { ...masterTables, nisa: nisaLimits }

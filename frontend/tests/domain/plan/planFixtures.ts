/**
 * `domain/plan/` の段・換算・入口のテストで使う架空の計画（`.claude/rules/dummy-values.md`）。
 * 既定値は画面と同じ `appDefaults`（`data/app/defaults.json` に、住宅ローン金利をフラット35 の最頻金利で入れた物）。
 */

import { appDefaults, nisaLimits } from '../../../src/data/appData'
import type {
  Adult,
  AppDefaults,
  CustomGoal,
  LifePlan,
  PlanTables,
} from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { masterTables } from '../fixtures'

/** 制度データ（テストの束）に、NISA の上限（`data/benefit/nisa.json` から `appData` が組み立てた物）を足した表 */
export const tables: PlanTables = { ...masterTables, nisa: nisaLimits }

export const defaults: AppDefaults = appDefaults

/** 大人 1 人（既定は 1979 年生まれの会社員・年収 480 万） */
export const adult = (overrides: Partial<Adult> = {}): Adult => ({
  id: 'adult-1',
  birthYear: 1979,
  workStyle: 'employee',
  annualIncome: 4800000,
  raiseRate: 0,
  outlookSteps: [],
  sideMonthlyProfit: 0,
  retirementAge: 65,
  ...overrides,
})

/** 毎月の自由入力のカード */
export const monthly = (
  id: string,
  amount: number,
  from: [number, number],
  to: [number, number],
  overrides: Partial<CustomGoal> = {},
): CustomGoal =>
  ({
    id,
    enabled: true,
    kind: 'custom',
    name: id,
    amountType: 'monthly',
    direction: 'expense',
    amount,
    from: yearMonth(...from),
    to: yearMonth(...to),
    ...overrides,
  }) as CustomGoal

/** 架空の計画（起点 2031-01・大人 1 人・子なし・暮らし 22 万＋家賃 7.4 万） */
export const makePlan = (overrides: Partial<LifePlan> = {}): LifePlan => ({
  baseYearMonth: yearMonth(2031, 1),
  adults: [adult()],
  children: [],
  municipality: '99001',
  living: { monthlyLivingCost: 220000, monthlyRent: 74000 },
  goals: [],
  assumptions: { investmentReturnRate: 0.03, inflationRate: 0, mortgageRate: 0.01 },
  ...overrides,
})

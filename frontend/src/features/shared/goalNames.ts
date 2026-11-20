/**
 * 帯の持ち主（目標カードの id・暮らし）を画面に出す名前に直す。
 *
 * domain は名前を持たない（自由入力のカードだけ `name` を持つ）ので、種類と子の順から作る。
 * 種類ごとの細かい呼び方は、各カードを作るタスク（T7〜T10）で直してよい。
 */

import { LIVING_GOAL_ID, type BandOwner, type Goal, type LifePlan } from '../../domain/plan/types'

/** 暮らしの帯の名前 */
const LIVING_NAME = '暮らし'

/** 種類ごとの名前。自由入力は利用者が付けた名前を使う */
const KIND_NAME: Record<Exclude<Goal['kind'], 'custom'>, string> = {
  university: '大学資金',
  retirement: '老後資金',
  home: '家',
  car: '車',
  childCost: '子の費用',
}

/** 目標カード 1 枚の名前。子ごとのカードは「（1 人目）」のように子の順を添える */
export function goalName(goal: Goal, plan: Pick<LifePlan, 'children'>): string {
  if (goal.kind === 'custom') return goal.name
  const base = KIND_NAME[goal.kind]
  if (goal.kind === 'university' || goal.kind === 'childCost') {
    const index = plan.children.findIndex((child) => child.id === goal.childId)
    return index >= 0 ? `${base}（${index + 1}人目）` : base
  }
  return base
}

/** 帯の持ち主の id → 名前 の対応表。段の内訳を名前で見せるのに使う */
export function ownerNames(plan: Pick<LifePlan, 'children' | 'goals'>): Map<BandOwner, string> {
  const names = new Map<BandOwner, string>([[LIVING_GOAL_ID, LIVING_NAME]])
  for (const goal of plan.goals) names.set(goal.id, goalName(goal, plan))
  return names
}

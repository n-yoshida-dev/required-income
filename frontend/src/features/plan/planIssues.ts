/**
 * 「計画」の入力のうち、欄をまたいで決まる契約違反（年が逆、同じ年が 2 つ など）を見つける。
 *
 * 1 つの欄だけで決まる物（数でない、金額が負、月が 1〜12 でない）は入力欄の部品が止める。
 * ここで見つかった問題が 1 つでもあれば、画面は保存も計算もしない（保存の前に止める。握りつぶさない）。
 * 戻り値のキーは直した欄の印と同じ書き方（`touched.ts`）で、画面はその欄の下に理由を出す。
 */

import type { LifePlan } from '../../domain/plan/types'
import { compareYearMonth } from '../../domain/plan/yearMonth'
import { touchedKey } from './touched'

/** 欄の印 → 理由 */
export type PlanIssues = ReadonlyMap<string, string>

/**
 * 子の費用のカードの塾の行の問題のキー（`goals.<カードの id>.cramSchools.<行の番号>`）。
 * 直した印は塾の行全体で 1 つ（`cramSchools`）だが、理由はどの行の誤りかが分かるよう、その行の下に出す
 */
export function cramRowIssueKey(goalId: string, index: number): string {
  return touchedKey('goals', goalId, 'cramSchools', String(index))
}

/** 計画の入力の問題を集める。無ければ空 */
export function planIssues(plan: LifePlan): PlanIssues {
  const issues = new Map<string, string>()
  const baseYear = plan.baseYearMonth.year

  for (const adult of plan.adults) {
    if (adult.birthYear > baseYear) {
      issues.set(touchedKey('adults', adult.id, 'birthYear'), '今年より後の年です')
    }
    // 今年以前の見込みは計算に使われない（`expectedMainIncome` が起点の年以前の段を無視する）だけなので、止めない。
    // 来年の見込みを入れて保存した計画が、年が明けて開くと保存できなくなるのを防ぐ。画面では薄く出す
    const years = adult.outlookSteps.map((step) => step.year)
    if (new Set(years).size !== years.length) {
      issues.set(touchedKey('adults', adult.id, 'outlookSteps'), '同じ年が 2 つあります')
    }
  }

  if (plan.municipality.trim() === '') {
    issues.set('municipality', '市区町村を入れてください')
  }

  for (const goal of plan.goals) {
    if (goal.kind === 'childCost') {
      // 塾の行の学年が逆だと domain は契約違反として投げる。保存の前に、その行の学年の下で止める
      goal.cramSchools.forEach((cram, index) => {
        if (cram.fromGrade > cram.toGrade) {
          issues.set(cramRowIssueKey(goal.id, index), '始まりの学年以降にしてください')
        }
      })
      continue
    }
    if (goal.kind === 'home') {
      // 頭金が価格を超えると借りる額が負になる（domain は契約違反として投げる）。保存の前に欄の下で止める
      if (goal.downPayment > goal.price) {
        issues.set(touchedKey('goals', goal.id, 'downPayment'), '価格以下にしてください')
      }
      continue
    }
    if (goal.kind !== 'custom') continue
    if (goal.name.trim() === '') {
      issues.set(touchedKey('goals', goal.id, 'name'), '名前を入れてください')
    }
    if (goal.amountType === 'monthly' && compareYearMonth(goal.from, goal.to) >= 0) {
      issues.set(touchedKey('goals', goal.id, 'to'), '始まりの月以降にしてください')
    }
  }

  return issues
}

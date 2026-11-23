/**
 * 「計画」の 4 つの区分（家族・収入・暮らし・目標）の順と、案内の進み具合（T21。SPEC §4.2・§5）。
 * React に依存しない関数にして、単体テストで確かめる（計算ではないので domain には置かない）。
 *
 * - 今いる区分は URL（`/#/plan/<区分>`）に持つ。ここは区分の名前の読み方と、前後の区分を決めるだけ
 * - 案内の進み具合は保存に持つ（`guide`）。`guide` がある＝案内の途中。無い＝案内を終えた、または案内が入る前からの保存
 * - 済みの印は「次へ」を押した区分。欄を直した印（`touched`）とは別の物
 */

/** 区分の並び（「次へ」で進む順） */
export const PLAN_SECTIONS = ['family', 'income', 'living', 'goals'] as const

/** 区分の id */
export type PlanSectionId = (typeof PLAN_SECTIONS)[number]

/** 案内の進み具合。`done` は「次へ」を押して済ませた区分（並びは区分の順） */
export type Guide = { done: PlanSectionId[] }

/** 文字列が区分の id か */
export function isPlanSection(value: string): value is PlanSectionId {
  return (PLAN_SECTIONS as readonly string[]).includes(value)
}

/** URL の区分の名前を読む。知らない名前・無いときは家族（いちばん初め） */
export function sectionFromParam(param: string | undefined): PlanSectionId {
  return param !== undefined && isPlanSection(param) ? param : 'family'
}

/** 案内を始めたときの進み具合（どの区分も済んでいない） */
export function startGuide(): Guide {
  return { done: [] }
}

/**
 * 「計画」を開いたときに出す区分。案内の途中なら、済んでいない最初の区分。
 * 案内が無い（終えた・案内が入る前の保存）ときと、全部済んでいるときは家族
 */
export function resumeSection(guide: Guide | null): PlanSectionId {
  if (guide === null) return 'family'
  return PLAN_SECTIONS.find((section) => !guide.done.includes(section)) ?? 'family'
}

/** 区分を済みにした進み具合。並びは区分の順にそろえ、同じ区分を重ねない */
export function markDone(guide: Guide, section: PlanSectionId): Guide {
  return { done: PLAN_SECTIONS.filter((one) => one === section || guide.done.includes(one)) }
}

/** 区分の id の並びから、知っている物だけを区分の順で残す（保存を読むとき。知らない id は捨てる） */
export function knownSections(ids: readonly string[]): PlanSectionId[] {
  return PLAN_SECTIONS.filter((section) => ids.includes(section))
}

/** 次の区分。最後（目標）なら null */
export function nextSection(section: PlanSectionId): PlanSectionId | null {
  return PLAN_SECTIONS[PLAN_SECTIONS.indexOf(section) + 1] ?? null
}

/** 前の区分。初め（家族）なら null */
export function previousSection(section: PlanSectionId): PlanSectionId | null {
  const index = PLAN_SECTIONS.indexOf(section)
  return index <= 0 ? null : (PLAN_SECTIONS[index - 1] ?? null)
}

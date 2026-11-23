/**
 * 「計画」の 4 つの区分の画面の言葉（T21。SPEC §4.2）。言葉は 1 か所にまとめる。
 * 文は `docs/design-candidates/2026-11-21-own-plan-guide/synthesis.md`（案 B の題と注）のまま
 */

import type { PlanSectionId } from './guide'

/** 区分の帯とボタン（「次へ：収入」）に出す短い名前 */
export const SECTION_LABELS: Record<PlanSectionId, string> = {
  family: '家族',
  income: '収入',
  living: '暮らし',
  goals: '目標',
}

/** 区分の題（h1） */
export const SECTION_TITLES: Record<PlanSectionId, string> = {
  family: '家族の生まれ年を入れましょう',
  income: '今の収入を入れましょう',
  living: '毎月の暮らしにかかるお金は？',
  goals: 'やりたいことをひとつ足してみましょう',
}

/** 題の下にいつも出す注（無い区分は null） */
export const SECTION_NOTES: Record<PlanSectionId, string | null> = {
  family: null,
  income: '年収は、税金と社会保険を引かれる前の金額です。',
  living: null,
  goals: '金額や時期は、あとから何度でも直せます。',
}

/** 案内のあいだだけ、家族・収入・暮らしの題の下に出す注（薄い字＝既定値のまま、の意味） */
export const GUIDE_DEFAULT_NOTE = '薄い数字は仮の値です。自分の数字に直せます。'

/** 案内のあいだだけ、「次へ」の下に小さく出す注 */
export const GUIDE_PRIVACY_NOTE = '入力した数字はこのブラウザに保存されます。外へは送りません。'

/** 目標の区分の最後のボタン（自分で足した目標が 1 つ以上／0） */
export const FINISH_WITH_GOALS = '要る年収を見る'
export const FINISH_WITHOUT_GOALS = '目標はあとで足す'

/** 前の区分へ戻るボタン */
export const BACK_LABEL = '戻る'

/** 次の区分へ進むボタン（「次へ：収入」） */
export function nextLabel(section: PlanSectionId): string {
  return `次へ：${SECTION_LABELS[section]}`
}

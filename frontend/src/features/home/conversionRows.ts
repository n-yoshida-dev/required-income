/**
 * 段の内訳の「埋め方の換算」の行（SPEC §3.6・§4.1 の 2）。`evaluate` の換算を、画面に出す文字に直すだけで、計算はしない。
 *
 * 3 つ（本業・副業・パートナー）は同じ形の行にし、並びは SPEC の順のまま。どれかを目立たせない（D31）。
 * 届かない・動かせる人がいない換算（`null`）は行を出さない。
 * 2 人目の大人の呼び方は `shared/adultNames.ts`（T21。前は「もう 1 人」）
 */

import type { IncomeConversion, StepConversions } from '../../domain/plan/types'
import { PARTNER_NAME } from '../shared/adultNames'
import { formatMan, manNumber } from '../shared/format'
import { roundMan } from '../shared/displayMan'

/** 換算の行 1 つ */
export type ConversionRow = {
  key: 'mainJob' | 'sideJob' | 'otherAdult'
  /** 埋め方の名前（「本業を上げるなら」など） */
  name: string
  /** 年額か月額か */
  per: '年' | '月'
  /** 金額の数字（万円）。今の収入があれば、上乗せの分として + を付ける */
  amount: string
  /** 今 → 届く額（「530万円 → 858万円」）。今の収入が 0 なら null */
  range: string | null
  /** 行のそばに置く断り書き。無ければ null */
  note: string | null
}

/** 副業の行に添える断り書き（D32 の 3。SPEC §3.6） */
export const SIDE_JOB_NOTE = '個人事業税は含まない'

/** 換算を行に直す。換算が無い段（見込みで届いている段）は空 */
export function conversionRows(conversions: StepConversions | null): ConversionRow[] {
  if (conversions === null) return []
  const rows: (ConversionRow | null)[] = [
    row('mainJob', '本業を上げるなら', '年', conversions.mainJob, 0, null),
    row('sideJob', '副業なら', '月', conversions.sideJob, 1, SIDE_JOB_NOTE),
    row('otherAdult', `${PARTNER_NAME}の収入を上げるなら`, '年', conversions.otherAdult, 0, null),
  ]
  return rows.filter((entry): entry is ConversionRow => entry !== null)
}

/** 換算 1 つを行にする。換算が無ければ null */
function row(
  key: ConversionRow['key'],
  name: string,
  per: ConversionRow['per'],
  conversion: IncomeConversion | null,
  digits: number,
  note: string | null,
): ConversionRow | null {
  if (conversion === null) return null
  // 見せる値どうしの引き算にする（「530万円 → 903万円」と「+373」が画面の上で合う。displayMan.ts）
  const current = roundMan(conversion.current, digits)
  const required = roundMan(conversion.required, digits)
  const hasCurrent = current > 0
  return {
    key,
    name,
    per,
    amount: manNumber(hasCurrent ? required - current : required, { digits, signed: hasCurrent }),
    range: hasCurrent
      ? `${formatMan(current, { digits })} → ${formatMan(required, { digits })}`
      : null,
    note,
  }
}

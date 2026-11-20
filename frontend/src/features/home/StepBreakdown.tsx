/**
 * 段の内訳（SPEC §4.1 の 2）。押した段の下に、白い面で出す（選んだ段の白い柱とつながる。DESIGN.md）。
 *
 * 上から：目標ごとの年額（大きい順。収入の帯は負）→ 1年にかかるお金（要る手取り）→ ＋ 引かれる税金・社会保険 → 要る年収
 * → 見込みの年収と足りない額 → 埋め方の換算（見込みで届かない段だけ。T17）。
 * 数字は `evaluate` の結果をそのまま出す。税・社会保険は「要る年収 − 要る手取り」の引き算だけ。
 */

import type { BandOwner, Step, StepConversions } from '../../domain/plan/types'
import { formatYearRange, manNumber } from '../shared/format'
import { conversionRows } from './conversionRows'
import { BREAKDOWN_WORDS } from './nextStepText'
import { apportionMan, roundMan } from '../shared/displayMan'

type Props = {
  step: Step
  /** その段の埋め方の換算。見込みで届いている段は null */
  conversions: StepConversions | null
  /** 帯の持ち主の id → 名前 */
  names: ReadonlyMap<BandOwner, string>
}

/** 要る年収のそばに置く断り書き（SPEC §3.6・§3.7） */
const GROSS_NOTE = 'いちばん稼ぐ人の収入を上げた場合'
/** 段の内訳 */
export function StepBreakdown({ step, conversions, names }: Props) {
  const sorted = [...step.byGoal].sort((a, b) => b.annual - a.annual)
  // 画面の万円どうしで足し引きが合うように、見せる値にそろえる（displayMan.ts の決まり）
  const shownRows = apportionMan(
    sorted.map((row) => row.annual),
    step.requiredNet,
  )
  const rows = sorted.map((row, index) => ({ goalId: row.goalId, yen: shownRows[index] ?? 0 }))
  const net = roundMan(step.requiredNet)
  const gross = step.requiredGross === null ? null : roundMan(step.requiredGross)
  const expected = roundMan(step.expectedGross)
  const short = step.requiredGross === null || step.requiredGross > step.expectedGross
  const lack = gross === null ? 0 : gross - expected
  const fills = short ? conversionRows(conversions) : []

  return (
    <section
      className="breakdown"
      aria-label={`${formatYearRange(step.fromYear, step.toYear)}の内訳`}
    >
      {/* 1 年だけの段は「2031年」（「2031〜2031年」と出さない） */}
      <p className="breakdown__years">
        <span className="num">{step.fromYear}</span>
        {step.fromYear === step.toYear ? null : (
          <>
            〜<span className="num">{step.toYear}</span>
          </>
        )}
        年
      </p>

      <ul className="breakdown__rows">
        {rows.map((row) => (
          <li key={row.goalId}>
            <span className="breakdown__name">{names.get(row.goalId) ?? row.goalId}</span>
            <Man yen={row.yen} />
          </li>
        ))}
      </ul>

      <ul className="breakdown__bridge">
        <li className="breakdown__net">
          <span>{BREAKDOWN_WORDS.net}</span>
          <Man yen={net} />
        </li>
        {gross === null ? null : (
          <li>
            <span>{BREAKDOWN_WORDS.tax}</span>
            <Man yen={gross - net} />
          </li>
        )}
        <li className="breakdown__gross">
          <span>
            {BREAKDOWN_WORDS.gross}
            <span className="breakdown__note">{GROSS_NOTE}</span>
          </span>
          {gross === null ? <span>{BREAKDOWN_WORDS.unreachable}</span> : <Man yen={gross} />}
        </li>
      </ul>

      <p className="breakdown__expect">
        <span>
          {BREAKDOWN_WORDS.expected}
          <span className="num">{manNumber(expected)}</span>万円
        </span>
        {!short || lack <= 0 ? null : (
          <span className="breakdown__lack">
            <span className="num">{manNumber(lack)}</span>
            {BREAKDOWN_WORDS.lack}
          </span>
        )}
      </p>

      {fills.length === 0 ? null : (
        <ul className="fills" aria-label="埋め方の換算">
          {fills.map((fill) => (
            <li key={fill.key} className="fills__row">
              <span className="fills__name">{fill.name}</span>
              <span className="fills__amt">
                {fill.per} <span className="num">{fill.amount}</span>万円
              </span>
              {fill.range === null ? null : <span className="fills__range">{fill.range}</span>}
              {fill.note === null ? null : <span className="fills__note">{fill.note}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** 金額（数字だけを数字の字にして、「万円」を小さく添える） */
function Man({ yen }: { yen: number }) {
  return (
    <span className="breakdown__amt">
      <span className="num">{manNumber(yen)}</span>万円
    </span>
  )
}

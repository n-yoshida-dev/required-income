/**
 * 知らせ（`Evaluation.notices`。SPEC §3.9）を、画面に出す一文に直す。計算は止めずに見せる物なので短く書く。
 * 何かを勧める形にしない（D31。どの口座・どの枠・どの商品がよいかは言わない）。
 */

import type { BandOwner, Notice } from '../../domain/plan/types'
import { formatMan } from '../shared/format'

type NisaNotice = Extract<Notice, { kind: 'nisaLimit' }>

/**
 * NISA の呼び方。カードの「置き場」の選択肢と同じ「NISA」から始め、誰の名義かを括弧で添える
 * （子の名義は未成年者のつみたて投資枠と 18 歳からの枠のどちらも「NISA（子の名義）」。正式な名前は SPEC にだけ書く）
 */
function nisaName(notice: NisaNotice): string {
  if (notice.owner === 'child') return 'NISA（子の名義）'
  return notice.holders > 1 ? `NISA（${notice.holders}人ぶん）` : 'NISA'
}

/** 年の上限を超える一句（「2027年の積立 2,498万円が、年の上限 720万円」） */
function annualPhrase(notice: NisaNotice): string {
  return `${notice.year}年の積立 ${formatMan(notice.amount)}が、年の上限 ${formatMan(notice.cap)}`
}

/** 生涯の上限を超える一句（「2028年に元本が 5,412万円になり、生涯の上限 3,600万円」） */
function lifetimePhrase(notice: NisaNotice): string {
  return `${notice.year}年に元本が ${formatMan(notice.amount)}になり、生涯の上限 ${formatMan(notice.cap)}`
}

/**
 * 知らせを一文ずつにする。同じカード・同じ名義の NISA の年の上限と生涯の上限は、前置きをくり返さず 1 文にまとめる
 *
 * @param names 目標カードの id → 名前（`ownerNames`）。無ければカードの名前を添えない（カードの中に出すとき）
 */
export function noticeLines(
  notices: readonly Notice[],
  names?: ReadonlyMap<BandOwner, string>,
): string[] {
  const lines: string[] = []
  const merged = new Set<Notice>()
  for (const notice of notices) {
    if (merged.has(notice)) continue
    if (notice.kind === 'nisaLimit' && notice.limit === 'annual') {
      const lifetime = notices.find(
        (other): other is NisaNotice =>
          other.kind === 'nisaLimit' &&
          other.limit === 'lifetime' &&
          other.goalId === notice.goalId &&
          nisaName(other) === nisaName(notice) &&
          !merged.has(other),
      )
      if (lifetime !== undefined) {
        merged.add(lifetime)
        const name = names?.get(notice.goalId)
        lines.push(
          `${name === undefined ? '' : `${name}：`}${nisaName(notice)}：${annualPhrase(notice)}を、${lifetimePhrase(lifetime)}を超えます`,
        )
        continue
      }
    }
    lines.push(noticeText(notice, names))
  }
  return lines
}

/**
 * 知らせ 1 つを一文にする
 *
 * @param names 目標カードの id → 名前（`ownerNames`）。カードの名前を添える知らせが使う。無ければ名前を省く
 */
export function noticeText(notice: Notice, names?: ReadonlyMap<BandOwner, string>): string {
  const nameOf = (goalId: string): string => {
    const name = names?.get(goalId)
    return name === undefined ? '' : `${name}：`
  }
  switch (notice.kind) {
    case 'municipalityApproximated':
      return '国保の料率が無い自治体のため、ほかの自治体の料率で概算しています'
    case 'unsolvableStep':
      return `${notice.fromYear}〜${notice.toYear}年は、収入を上げても届きません`
    case 'onceGoalPast':
      return `「${notice.name}」の使う月が過ぎています`
    case 'onceGoalSoon':
      return `「${notice.name}」まであと${notice.monthsLeft}か月。貯まっている額を入れるか、時期をずらすと下がります`
    case 'negativeNeed':
      return `${notice.years.join('・')}年は、収入が支出を上回ります`
    case 'homeSavingSoon':
      return `家を買う月まであと${notice.monthsLeft}か月。貯まっている額を入れるか、買う年をずらすと下がります`
    case 'carSavingSoon':
      return `車を買う月まであと${notice.monthsLeft}か月。貯まっている額を入れるか、買う年をずらすと下がります`
    case 'homeLoanHeavy':
      return notice.ratio === null
        ? `家を買う年の見込みの年収が 0 円で、借りられないことがあります`
        : `借りる額が年収の${notice.ratio.toFixed(1)}倍で、目安の${notice.limit}倍を超えています。借りられないことがあります`
    case 'nisaLimit':
      return `${nameOf(notice.goalId)}${nisaName(notice)}：${notice.limit === 'annual' ? annualPhrase(notice) : lifetimePhrase(notice)}を超えます`
    case 'allowanceCovers':
      return `${nameOf(notice.goalId)}児童手当${notice.withSaved ? 'と貯まっている額' : ''}だけで届きます`
    case 'fundDeadlinePast':
      return `${nameOf(notice.goalId)}使う時期が過ぎているので、計算に入れていません`
  }
}

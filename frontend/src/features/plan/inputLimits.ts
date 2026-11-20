/**
 * 入力欄が受け付ける年・年齢の範囲。打ち間違い（"20300年" など）を保存の前に止めるための画面の決まりで、制度の数値ではない。
 * 年は起点の年からの幅で持つ（いつ開いても同じ幅になる）
 */

export const INPUT_LIMITS = {
  /** 大人の生まれ年：起点の年の何年前から、何年前まで */
  adultBirth: { yearsBeforeMax: 100, yearsBeforeMin: 0 },
  /** 子の生まれ年：起点の年の何年前から、何年後まで（生まれる予定の子も入れられる） */
  childBirth: { yearsBefore: 40, yearsAfter: 10 },
  /** 退職の年齢 */
  retirementAge: { min: 0, max: 100 },
  /** 見込みの年・カードの年：起点の年の何年前から、何年後まで */
  planYear: { yearsBefore: 50, yearsAfter: 80 },
  /** 家のローンの年数（domain は 1 以上の整数なら通す。打ち間違いを止める幅） */
  loanYears: { min: 1, max: 50 },
  /** 車のローンの年数（domain は 1 以上の整数なら通す。打ち間違いを止める幅） */
  carLoanYears: { min: 1, max: 10 },
  /** 車の買い替えの周期（年） */
  carReplaceEveryYears: { min: 1, max: 30 },
} as const

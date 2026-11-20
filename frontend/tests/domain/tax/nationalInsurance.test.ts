/**
 * 国民健康保険料・国民年金保険料。期待値は `national-insurance.json` の 2026 年度の料率から手計算した。
 *
 * 基準ケース（2026 年度・川崎市・1984 年生まれ（42 歳・介護分あり）の 1 人世帯・前年所得 400 万）：
 * - 賦課基準額 = 400 万 − 43 万 = 357 万
 * - 医療分 357 万 × 8.26% + 43,261 = 338,143 ／ 支援分 357 万 × 2.89% + 15,306 = 118,479
 * - 介護分 357 万 × 2.67% + 15,828 = 111,147 ／ 子ども分 357 万 × 0.32% + (1,665 + 77) = 13,166
 * - 合計 580,935 円
 *
 * 子の生年は `.claude/rules/dummy-values.md` に従い架空の年にしてある（未就学児のケースは料率を延ばした 2042 年度で確かめる）。
 */

import { describe, expect, it } from 'vitest'
import {
  hasNationalHealthInsuranceRates,
  isNationalPensionInsuredAge,
  nationalHealthInsurance,
  nationalPensionPremium,
  type NationalHealthInsuranceInput,
  type NationalHealthInsuranceMember,
} from '../../../src/domain/tax/nationalInsurance'
import { DUMMY_CITY_FROM, nationalInsurance } from '../fixtures'

const owner: NationalHealthInsuranceMember = {
  personId: 'owner',
  birthYear: 1984,
  birthMonth: null,
  previousYearTotalIncome: 4000000,
  isSalaryEarner: false,
}

const base: NationalHealthInsuranceInput = {
  fiscalYear: 2026,
  municipalityCode: '14130',
  members: [owner],
  householder: { kind: 'member', personId: 'owner' },
}

/** 前年所得 0 の子（加入者） */
function child(personId: string, birthYear: number, birthMonth: 2 | 3 | 4 | 5) {
  return { personId, birthYear, birthMonth, previousYearTotalIncome: 0, isSalaryEarner: false }
}

describe('nationalHealthInsurance：1 人世帯', () => {
  it('4 区分それぞれに所得割と均等割を出して合計する（川崎市）', () => {
    const result = nationalHealthInsurance(base, nationalInsurance)
    expect(result.segments.medical).toEqual({
      incomeLevy: 294882,
      perCapitaLevy: 43261,
      premium: 338143,
      capped: false,
    })
    expect(result.segments.support.premium).toBe(118479)
    expect(result.segments.longTermCare.premium).toBe(111147)
    // 子ども分の均等割は 18 歳以上の追加ぶん（77 円）が乗る
    expect(result.segments.childcare).toEqual({
      incomeLevy: 11424,
      perCapitaLevy: 1742,
      premium: 13166,
      capped: false,
    })
    expect(result.reductionRate).toBe(0)
    expect(result.municipalDeduction).toBe(0)
    expect(result.total).toBe(580935)
  })

  it('料率は自治体で切り替わる（横浜市）', () => {
    const result = nationalHealthInsurance(
      { ...base, municipalityCode: '14100' },
      nationalInsurance,
    )
    expect(result.segments.medical.premium).toBe(338251)
    expect(result.segments.support.premium).toBe(106914)
    expect(result.segments.longTermCare.premium).toBe(117588)
    expect(result.segments.childcare.premium).toBe(13908)
    expect(result.total).toBe(576661)
  })

  it('介護分は 40〜64 歳だけ。39 歳・65 歳には掛からない', () => {
    const at = (birthYear: number) =>
      nationalHealthInsurance({ ...base, members: [{ ...owner, birthYear }] }, nationalInsurance)
        .segments.longTermCare.premium
    expect(at(1987)).toBe(0) // 39 歳
    expect(at(1986)).toBe(111147) // 40 歳
    expect(at(1962)).toBe(111147) // 64 歳
    expect(at(1961)).toBe(0) // 65 歳
    expect(
      nationalHealthInsurance(
        { ...base, members: [{ ...owner, birthYear: 1990 }] },
        nationalInsurance,
      ).total,
    ).toBe(469788)
  })

  it('区分ごとに賦課限度額で頭打ちになる', () => {
    const result = nationalHealthInsurance(
      { ...base, members: [{ ...owner, previousYearTotalIncome: 12000000 }] },
      nationalInsurance,
    )
    expect(result.segments.medical).toEqual({
      incomeLevy: 955682,
      perCapitaLevy: 43261,
      premium: 670000,
      capped: true,
    })
    expect(result.segments.support.premium).toBe(260000)
    expect(result.segments.longTermCare.premium).toBe(170000)
    expect(result.segments.childcare.premium).toBe(30000)
    expect(result.total).toBe(1130000)
  })

  it('所得が基礎控除以下・赤字なら所得割は 0（賦課基準額は負にならない）', () => {
    for (const income of [430000, 0, -800000]) {
      const result = nationalHealthInsurance(
        { ...base, members: [{ ...owner, previousYearTotalIncome: income }] },
        nationalInsurance,
      )
      expect(result.segments.medical.incomeLevy).toBe(0)
    }
  })

  it('料率の年度より後の年度は最新の料率を延ばす', () => {
    const later = nationalHealthInsurance(
      { ...base, fiscalYear: 2030, members: [{ ...owner, birthYear: 1988 }] },
      nationalInsurance,
    )
    expect(later.total).toBe(580935)
  })
})

describe('nationalHealthInsurance：低所得世帯の均等割の軽減', () => {
  const totalAt = (income: number) =>
    nationalHealthInsurance(
      { ...base, members: [{ ...owner, previousYearTotalIncome: income }] },
      nationalInsurance,
    )

  it('判定所得が 43 万以下なら 7 割、＋31 万 × 人数以下なら 5 割、＋57 万 × 人数以下なら 2 割', () => {
    // 1 人世帯の境界：43 万／74 万／100 万。所得割が 0 の範囲（43 万以下）で均等割だけを確かめる
    const seventy = totalAt(430000)
    expect(seventy.reductionRate).toBe(0.7)
    expect(seventy.segments.medical.perCapitaLevy).toBe(12978)
    expect(seventy.segments.support.perCapitaLevy).toBe(4592)
    expect(seventy.segments.longTermCare.perCapitaLevy).toBe(4748)
    expect(seventy.segments.childcare.perCapitaLevy).toBe(523)
    expect(seventy.total).toBe(22841)

    expect(totalAt(430001).reductionRate).toBe(0.5)
    expect(totalAt(740000).reductionRate).toBe(0.5)
    expect(totalAt(740000).segments.medical.perCapitaLevy).toBe(21631)
    expect(totalAt(740001).reductionRate).toBe(0.2)
    expect(totalAt(1000000).reductionRate).toBe(0.2)
    expect(totalAt(1000000).segments.medical.perCapitaLevy).toBe(34609)
    expect(totalAt(1000001).reductionRate).toBe(0)
  })

  it('給与所得者等が 2 人以上なら、(人数 − 1) × 10 万を判定額に足す', () => {
    const spouse = { ...owner, personId: 'spouse', birthYear: 1990, previousYearTotalIncome: 0 }
    const input = (salaryEarners: boolean): NationalHealthInsuranceInput => ({
      ...base,
      // 2 人世帯の 7 割の判定額は 43 万。給与所得者等が 2 人なら 53 万
      members: [
        { ...owner, previousYearTotalIncome: 500000, isSalaryEarner: salaryEarners },
        { ...spouse, isSalaryEarner: salaryEarners },
      ],
    })
    expect(nationalHealthInsurance(input(false), nationalInsurance).reductionRate).toBe(0.5)
    expect(nationalHealthInsurance(input(true), nationalInsurance).reductionRate).toBe(0.7)
  })

  it('世帯主が国保の加入者でなくても（擬制世帯主）、その所得は軽減の判定に入る', () => {
    const member = { ...owner, birthYear: 1990, previousYearTotalIncome: 300000 }
    const alone = nationalHealthInsurance({ ...base, members: [member] }, nationalInsurance)
    expect(alone.reductionRate).toBe(0.7)
    expect(alone.total).toBe(18093)

    const withHouseholder = nationalHealthInsurance(
      {
        ...base,
        members: [member],
        householder: { kind: 'nonMember', previousYearTotalIncome: 5000000, isSalaryEarner: true },
      },
      nationalInsurance,
    )
    expect(withHouseholder.reductionJudgmentIncome).toBe(5300000)
    expect(withHouseholder.reductionRate).toBe(0)
    // 世帯主は加入者ではないので、所得割・均等割には入らない
    expect(withHouseholder.segments.medical.incomeLevy).toBe(0)
    expect(withHouseholder.total).toBe(60309)
  })
})

describe('nationalHealthInsurance：子のいる世帯', () => {
  it('こどもの子ども分の均等割は全額軽減。独自控除は賦課基準額の最も高い加入者から引く（川崎市）', () => {
    // 2009 年 2 月生まれ：前年末 16 歳 → 12 万の控除。年度末 18 歳 → こども
    const result = nationalHealthInsurance(
      { ...base, members: [owner, child('teen', 2009, 2)] },
      nationalInsurance,
    )
    expect(result.municipalDeduction).toBe(120000)
    expect(result.segments.medical).toMatchObject({ incomeLevy: 284970, perCapitaLevy: 86522 })
    expect(result.segments.childcare).toMatchObject({ incomeLevy: 11040, perCapitaLevy: 1742 })
    expect(result.total).toBe(622534)
  })

  it('「こども」は年度末（翌年 3 月 31 日）に 18 歳以下。3 月生まれと 4 月生まれで 1 年ずれる', () => {
    const at = (birthMonth: 3 | 4) =>
      nationalHealthInsurance(
        { ...base, members: [owner, child('young', 2008, birthMonth)] },
        nationalInsurance,
      )
    // 2008 年 3 月生まれは年度末に 19 歳 → 大人の均等割（1,665 + 77）が乗る
    expect(at(3).segments.childcare.perCapitaLevy).toBe(3484)
    expect(at(3).total).toBe(624276)
    expect(at(4).segments.childcare.perCapitaLevy).toBe(1742)
    expect(at(4).total).toBe(622534)
  })

  it('未就学児の均等割は 5 割。前年末 16 歳未満の子は 33 万の控除（2042 年度に延ばした料率で確認）', () => {
    const adult = { ...owner, birthYear: 2000 }
    const result = nationalHealthInsurance(
      { ...base, fiscalYear: 2042, members: [adult, child('preschooler', 2037, 5)] },
      nationalInsurance,
    )
    expect(result.municipalDeduction).toBe(330000)
    // 均等割：大人 43,261 + 未就学児 21,630.5 = 64,891.5 → 64,892
    expect(result.segments.medical).toMatchObject({ incomeLevy: 267624, perCapitaLevy: 64892 })
    expect(result.segments.support.perCapitaLevy).toBe(22959)
    expect(result.total).toBe(563557)
  })

  it('未就学児は年度末に 6 歳以下。3 月生まれは 1 年早く外れる', () => {
    const adult = { ...owner, birthYear: 2000 }
    const perCapitaAt = (birthMonth: 3 | 4) =>
      nationalHealthInsurance(
        { ...base, fiscalYear: 2042, members: [adult, child('kid', 2036, birthMonth)] },
        nationalInsurance,
      ).segments.medical.perCapitaLevy
    expect(perCapitaAt(3)).toBe(86522) // 年度末に 7 歳：軽減なし
    expect(perCapitaAt(4)).toBe(64892) // 年度末に 6 歳：5 割
  })

  it('所得による軽減と未就学児の軽減は重なる（7 割軽減なら 8.5 割）', () => {
    const adult = { ...owner, birthYear: 2000, previousYearTotalIncome: 400000 }
    const result = nationalHealthInsurance(
      { ...base, fiscalYear: 2042, members: [adult, child('preschooler', 2037, 5)] },
      nationalInsurance,
    )
    expect(result.reductionRate).toBe(0.7)
    // 43,261 × 0.3 + 43,261 × 0.15 = 19,467.45
    expect(result.segments.medical.perCapitaLevy).toBe(19467)
    expect(result.total).toBe(31626)
  })

  it('横浜市の独自控除は加入者である世帯主から引き、世帯主の基準総所得金額が限度', () => {
    const householder = { ...owner, previousYearTotalIncome: 600000 }
    const one = nationalHealthInsurance(
      { ...base, municipalityCode: '14100', members: [householder, child('teen', 2009, 2)] },
      nationalInsurance,
    )
    expect(one.municipalDeduction).toBe(120000)
    expect(one.reductionRate).toBe(0.5)
    expect(one.total).toBe(70300)

    // 子 2 人で控除 24 万 > 基準総所得金額 17 万 → 17 万まで
    const two = nationalHealthInsurance(
      {
        ...base,
        municipalityCode: '14100',
        members: [householder, child('teen', 2009, 2), child('teen2', 2008, 5)],
      },
      nationalInsurance,
    )
    expect(two.municipalDeduction).toBe(170000)
    expect(two.segments.medical.incomeLevy).toBe(0)
    expect(two.total).toBe(90360)
  })

  it('世帯主が加入者でない世帯：横浜市は独自控除なし、川崎市は最も高い加入者から引く', () => {
    const spouse = {
      ...owner,
      personId: 'spouse',
      birthYear: 1990,
      previousYearTotalIncome: 2000000,
    }
    const input = (municipalityCode: string): NationalHealthInsuranceInput => ({
      fiscalYear: 2026,
      municipalityCode,
      members: [spouse, child('teen', 2009, 2)],
      householder: { kind: 'nonMember', previousYearTotalIncome: 5000000, isSalaryEarner: true },
    })
    const yokohama = nationalHealthInsurance(input('14100'), nationalInsurance)
    expect(yokohama.municipalDeduction).toBe(0)
    expect(yokohama.total).toBe(287523)

    const kawasaki = nationalHealthInsurance(input('14130'), nationalInsurance)
    expect(kawasaki.municipalDeduction).toBe(120000)
    expect(kawasaki.total).toBe(285191)
  })

  it('所得が上限を超える子は独自控除の対象外', () => {
    const earningTeen = { ...child('teen', 2009, 2), previousYearTotalIncome: 580001 }
    const result = nationalHealthInsurance(
      { ...base, members: [owner, earningTeen] },
      nationalInsurance,
    )
    expect(result.municipalDeduction).toBe(0)
  })
})

describe('nationalHealthInsurance：計算できない入力', () => {
  it('料率が表に無い自治体は例外。先に hasNationalHealthInsuranceRates で確かめられる', () => {
    expect(hasNationalHealthInsuranceRates('14130', nationalInsurance)).toBe(true)
    expect(hasNationalHealthInsuranceRates(DUMMY_CITY_FROM, nationalInsurance)).toBe(false)
    expect(() =>
      nationalHealthInsurance({ ...base, municipalityCode: DUMMY_CITY_FROM }, nationalInsurance),
    ).toThrow(RangeError)
  })

  it('料率の年度より前・整数でない年度は例外', () => {
    expect(() => nationalHealthInsurance({ ...base, fiscalYear: 2025 }, nationalInsurance)).toThrow(
      RangeError,
    )
    expect(() =>
      nationalHealthInsurance({ ...base, fiscalYear: 2026.5 }, nationalInsurance),
    ).toThrow(RangeError)
  })

  it('加入者がいない・75 歳以上・世帯主が加入者の中にいない・所得が有限でないのは例外', () => {
    expect(() => nationalHealthInsurance({ ...base, members: [] }, nationalInsurance)).toThrow(
      RangeError,
    )
    expect(() =>
      nationalHealthInsurance(
        { ...base, members: [{ ...owner, birthYear: 1951 }] },
        nationalInsurance,
      ),
    ).toThrow(RangeError)
    // 74 歳は加入できる
    expect(() =>
      nationalHealthInsurance(
        { ...base, members: [{ ...owner, birthYear: 1952 }] },
        nationalInsurance,
      ),
    ).not.toThrow()
    expect(() =>
      nationalHealthInsurance(
        { ...base, householder: { kind: 'member', personId: 'someone-else' } },
        nationalInsurance,
      ),
    ).toThrow(RangeError)
    expect(() =>
      nationalHealthInsurance(
        { ...base, members: [{ ...owner, previousYearTotalIncome: Number.NaN }] },
        nationalInsurance,
      ),
    ).toThrow(RangeError)
  })

  it('平等割のある料率・未対応の引き先は黙って計算せず例外', () => {
    const kawasaki = nationalInsurance.nationalHealthInsurance.byMunicipality['14130']
    if (kawasaki === undefined) {
      throw new Error('川崎市の料率が表にありません')
    }
    // 独自控除の無い市（null）を表せるようにした（2026-11-20）ので、控除のある市であることを型で確かめてから使う
    const deduction = kawasaki.municipalDeduction
    if (deduction === null) {
      throw new Error('川崎市の独自控除が表にありません')
    }
    const withTable = (entry: typeof kawasaki) => ({
      ...nationalInsurance,
      nationalHealthInsurance: {
        ...nationalInsurance.nationalHealthInsurance,
        byMunicipality: { '14130': entry },
      },
    })
    expect(() =>
      nationalHealthInsurance(
        base,
        withTable({ ...kawasaki, medical: { ...kawasaki.medical, perHousehold: 20000 } }),
      ),
    ).toThrow(RangeError)
    expect(() =>
      nationalHealthInsurance(
        { ...base, members: [owner, child('teen', 2009, 2)] },
        withTable({
          ...kawasaki,
          municipalDeduction: { ...deduction, deductFrom: 'someoneElse' },
        }),
      ),
    ).toThrow(RangeError)
    // 年齢の基準日が前年 12 月 31 日でない表も、前年末の年齢で黙って判定しない
    expect(() =>
      nationalHealthInsurance(
        base,
        withTable({
          ...kawasaki,
          municipalDeduction: {
            ...deduction,
            ages: { ...deduction.ages, asOf: 'april1' },
          },
        }),
      ),
    ).toThrow(RangeError)
  })
})

/**
 * 2026-11-20 に足した 5 市（大阪市 27100・札幌市 01100・福岡市 40130・神戸市 28100・京都市 26100）。
 * 期待値は `national-insurance.json` の料率から、実装とは別に Decimal で計算した（規則は施行令と市の条例から書いた）。
 * 5 市とも平等割があり、独自控除は無い（null）。端数の処理は札幌市・福岡市だけ条例どおり、ほかは円単位の四捨五入。
 */
describe('nationalHealthInsurance：足した市（平等割のある市）', () => {
  const premiums = (code: string, input: NationalHealthInsuranceInput = base) => {
    const result = nationalHealthInsurance({ ...input, municipalityCode: code }, nationalInsurance)
    return {
      premiums: [
        result.segments.medical.premium,
        result.segments.support.premium,
        result.segments.longTermCare.premium,
        result.segments.childcare.premium,
      ],
      perHousehold: [
        result.perHouseholdLevies.medical,
        result.perHouseholdLevies.support,
        result.perHouseholdLevies.longTermCare,
        result.perHouseholdLevies.childcare,
      ],
      total: result.total,
    }
  }

  // 基準ケース（2026 年度・1984 年生（42 歳・介護分あり）の 1 人世帯・前年所得 400 万 → 賦課基準額 357 万）
  it.each([
    {
      code: '27100',
      // 医療 357 万 × 9.5% = 339,150 + 均等割 34,990 + 平等割 33,908。介護分・子ども分は平等割なし。子ども分の均等割は 1,745 + 96
      premiums: [408048, 131278, 111502, 11837],
      perHousehold: [33908, 10845, 0, 0],
      total: 662665,
    },
    {
      code: '01100',
      // 医療 307,377 + 20,550 + 32,540 = 360,467 → 10 円未満切り捨て 360,460
      premiums: [360460, 107730, 96750, 12450],
      perHousehold: [32540, 10010, 7550, 1000],
      total: 577390,
    },
    {
      code: '40130',
      // 医療 199,206 + 19,807 + 18,664 = 237,677 → 100 円未満切り捨て 237,600
      premiums: [237600, 132300, 111000, 11900],
      perHousehold: [18664, 9838, 7751, 911],
      total: 492800,
    },
    {
      code: '28100',
      premiums: [318966, 128279, 120096, 11442],
      perHousehold: [21800, 8740, 6880, 830],
      total: 578783,
    },
    {
      code: '26100',
      premiums: [331468, 111502, 106067, 11826],
      perHousehold: [17930, 6180, 5370, 660],
      total: 560863,
    },
  ])('$code：4 区分に所得割・均等割・平等割を出し、端数を市の規則で処理する', (expected) => {
    expect(premiums(expected.code)).toEqual({
      premiums: expected.premiums,
      perHousehold: expected.perHousehold,
      total: expected.total,
    })
  })

  it('福岡市の公式の計算例 2 件（1 人世帯・介護該当）と一致する', () => {
    // 運営協議会の資料：給与収入 300 万（給与所得 202 万）→ 263,100 円／給与収入 108 万（給与所得 43 万。7 割軽減）→ 23,300 円。
    // 所得割は 1 円未満切り捨て、軽減額は 1 円未満切り上げ、区分ごとに 100 円未満切り捨て（市の条例）
    const at = (income: number) =>
      nationalHealthInsurance(
        {
          ...base,
          municipalityCode: '40130',
          members: [{ ...owner, previousYearTotalIncome: income, isSalaryEarner: true }],
        },
        nationalInsurance,
      )
    expect(at(2020000).total).toBe(263100)
    const low = at(430000)
    expect(low.reductionRate).toBe(0.7)
    expect(low.total).toBe(23300)
  })

  it('札幌市は所得割を加入者ごとに 1 円未満切り捨ててから足す', () => {
    // 医療分：357 万 7 円 × 8.61% = 307,377.6027 → 307,377 ／ 212 万 5,559 円 × 8.61% = 183,010.6299 → 183,010。
    // 足してから切り捨てると 490,388 になるところ、加入者ごとに切り捨てて 490,387
    const result = nationalHealthInsurance(
      {
        ...base,
        municipalityCode: '01100',
        members: [
          { ...owner, previousYearTotalIncome: 4000007 },
          { ...owner, personId: 'spouse', birthYear: 1990, previousYearTotalIncome: 2555559 },
        ],
      },
      nationalInsurance,
    )
    expect(result.segments.medical.incomeLevy).toBe(490387)
    expect(result.segments.medical.premium).toBe(564020)
    expect(result.total).toBe(848950)
  })

  it('独自控除の無い市（null）は、子がいても賦課基準額から何も引かない', () => {
    const result = nationalHealthInsurance(
      { ...base, municipalityCode: '27100', members: [owner, child('teen', 2009, 2)] },
      nationalInsurance,
    )
    expect(result.municipalDeduction).toBe(0)
    // 所得割は大人の賦課基準額 357 万のまま。均等割は 2 人ぶん、平等割は世帯で 1 つ
    expect(result.segments.medical).toMatchObject({ incomeLevy: 339150, perCapitaLevy: 69980 })
    expect(result.total).toBe(708846)
  })

  it('平等割にも 7・5・2 割の軽減が掛かる（京都市・前年所得 30 万 → 7 割）', () => {
    const result = nationalHealthInsurance(
      {
        ...base,
        municipalityCode: '26100',
        members: [{ ...owner, previousYearTotalIncome: 300000 }],
      },
      nationalInsurance,
    )
    expect(result.reductionRate).toBe(0.7)
    // 平等割 17,930 × 0.3 = 5,379 など。均等割 30,080 × 0.3 = 9,024
    expect(result.perHouseholdLevies).toEqual({
      medical: 5379,
      support: 1854,
      longTermCare: 1611,
      childcare: 198,
    })
    expect(result.segments.medical).toEqual({
      incomeLevy: 0,
      perCapitaLevy: 9024,
      premium: 14403,
      capped: false,
    })
    expect(result.total).toBe(24852)
  })

  it('平等割を足すと賦課限度額を超える区分は、限度額で頭打ちになる（京都市・前年所得 840 万）', () => {
    const result = nationalHealthInsurance(
      {
        ...base,
        municipalityCode: '26100',
        members: [{ ...owner, previousYearTotalIncome: 8400000 }],
      },
      nationalInsurance,
    )
    // 医療分：797 万 × 7.94% = 632,818 + 均等割 30,080 = 662,898（限度額 67 万の内）＋ 平等割 17,930 = 680,828 → 670,000
    expect(result.segments.medical).toEqual({
      incomeLevy: 632818,
      perCapitaLevy: 30080,
      premium: 670000,
      capped: true,
    })
    expect(result.segments.support).toMatchObject({ premium: 228542, capped: false })
    expect(result.total).toBe(1092688)
  })

  it('未就学児の 5 割は平等割に掛からない（京都市・2042 年度に延ばした料率で確認）', () => {
    const adult = { ...owner, birthYear: 2000 }
    const alone = premiums('26100', { ...base, fiscalYear: 2042, members: [adult] })
    const withPreschooler = premiums('26100', {
      ...base,
      fiscalYear: 2042,
      members: [adult, child('preschooler', 2037, 5)],
    })
    // 平等割は子がいても同じ額。均等割だけ未就学児の半分が乗る（医療 30,080 + 15,040）
    expect(withPreschooler.perHousehold).toEqual(alone.perHousehold)
    expect(withPreschooler.perHousehold).toEqual([17930, 6180, 5370, 660])
    expect(withPreschooler.premiums[0]).toBe(346508)
    expect(withPreschooler.total).toBe(581083)

    // 7 割軽減の世帯：平等割は 7 割だけ（17,930 × 0.3 = 5,379）。未就学児の均等割は 8.5 割（30,080 × 0.3 + 30,080 × 0.15）
    const low = nationalHealthInsurance(
      {
        ...base,
        municipalityCode: '26100',
        fiscalYear: 2042,
        members: [{ ...adult, previousYearTotalIncome: 400000 }, child('preschooler', 2037, 5)],
      },
      nationalInsurance,
    )
    expect(low.perHouseholdLevies.medical).toBe(5379)
    expect(low.segments.medical.perCapitaLevy).toBe(13536)
    expect(low.total).toBe(30918)
  })

  it('介護分の平等割は 40〜64 歳の加入者がいる世帯だけに掛かる（札幌市・39 歳）', () => {
    const result = premiums('01100', { ...base, members: [{ ...owner, birthYear: 1987 }] })
    expect(result.premiums[2]).toBe(0)
    expect(result.perHousehold).toEqual([32540, 10010, 0, 1000])
    expect(result.total).toBe(480640)
  })

  it('端数の処理に未対応の値がある表は、黙って四捨五入せず例外', () => {
    const fukuoka = nationalInsurance.nationalHealthInsurance.byMunicipality['40130']
    if (fukuoka === undefined) {
      throw new Error('福岡市の料率が表にありません')
    }
    const withRounding = (rounding: NonNullable<typeof fukuoka.rounding>) => ({
      ...nationalInsurance,
      nationalHealthInsurance: {
        ...nationalInsurance.nationalHealthInsurance,
        byMunicipality: { '40130': { ...fukuoka, rounding } },
      },
    })
    const input = { ...base, municipalityCode: '40130' }
    expect(() => nationalHealthInsurance(input, withRounding({ incomeLevy: 'ceil' }))).toThrow(
      RangeError,
    )
    expect(() =>
      nationalHealthInsurance(input, withRounding({ reductionAmount: 'floor' })),
    ).toThrow(RangeError)
    expect(() =>
      nationalHealthInsurance(input, withRounding({ segmentPremiumFloorUnit: 0 })),
    ).toThrow(RangeError)
  })
})

describe('nationalPensionPremium', () => {
  it('その年度の月額 × 12 × 人数', () => {
    expect(nationalPensionPremium(2026, 1, nationalInsurance)).toBe(215040) // 17,920 × 12
    expect(nationalPensionPremium(2027, 1, nationalInsurance)).toBe(219480) // 18,290 × 12
    expect(nationalPensionPremium(2026, 2, nationalInsurance)).toBe(430080)
    expect(nationalPensionPremium(2026, 0, nationalInsurance)).toBe(0)
  })

  it('表より後の年度は最新の月額を延ばす。表より前の年度は例外', () => {
    expect(nationalPensionPremium(2035, 1, nationalInsurance)).toBe(219480)
    expect(() => nationalPensionPremium(2025, 1, nationalInsurance)).toThrow(RangeError)
  })

  it('人数が負・整数でなければ例外', () => {
    expect(() => nationalPensionPremium(2026, -1, nationalInsurance)).toThrow(RangeError)
    expect(() => nationalPensionPremium(2026, 1.5, nationalInsurance)).toThrow(RangeError)
  })
})

describe('isNationalPensionInsuredAge', () => {
  it('20 歳以上 60 歳未満', () => {
    expect(isNationalPensionInsuredAge(19, nationalInsurance)).toBe(false)
    expect(isNationalPensionInsuredAge(20, nationalInsurance)).toBe(true)
    expect(isNationalPensionInsuredAge(59, nationalInsurance)).toBe(true)
    expect(isNationalPensionInsuredAge(60, nationalInsurance)).toBe(false)
  })
})

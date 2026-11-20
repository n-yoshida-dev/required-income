import { describe, expect, it } from 'vitest'
import { appDefaults } from '../../../src/data/appData'
import {
  customGoalTemplate,
  homeGoalTemplate,
  sampleLifePlan,
} from '../../../src/domain/plan/defaults'
import type { Band, CustomGoal, LifePlan } from '../../../src/domain/plan/types'
import { yearMonth } from '../../../src/domain/plan/yearMonth'
import { masterTables, sampleHousehold } from '../../../src/data/appData'
import { cardMonthly, goalBands } from '../../../src/features/plan/goalCard'
import { planIssues } from '../../../src/features/plan/planIssues'
import {
  isTouched,
  touchedKey,
  withTouched,
  withoutTouchedUnder,
} from '../../../src/features/plan/touched'
import { resolveMunicipality } from '../../../src/features/shared/municipality'
import { nextId } from '../../../src/features/shared/nextId'
import { commitPlan, openPlanSession } from '../../../src/app/planSession'

const base = yearMonth(2026, 11)

/** 見本の世帯（ダミー値）から、カードを差し替えた計画 */
function planWith(goals: LifePlan['goals']): LifePlan {
  return { ...sampleLifePlan(appDefaults, sampleHousehold, base), goals }
}

describe('touched（直した欄の印）', () => {
  it('点でつなぎ、重ねずに足す', () => {
    const key = touchedKey('goals', 'goal-1', 'amount')
    expect(key).toBe('goals.goal-1.amount')
    const once = withTouched([], key)
    expect(withTouched(once, key)).toEqual([key])
    expect(isTouched(once, key)).toBe(true)
    expect(isTouched(once, 'goals.goal-1.name')).toBe(false)
  })

  it('行を外すと、その行の印だけをまとめて外す（id が前で重なる行は残す）', () => {
    const touched = [
      'goals.goal-1.amount',
      'goals.goal-1.from',
      'goals.goal-10.amount',
      'living.monthlyRent',
    ]
    expect(withoutTouchedUnder(touched, 'goals.goal-1')).toEqual([
      'goals.goal-10.amount',
      'living.monthlyRent',
    ])
  })
})

describe('nextId', () => {
  it('使われていない最小の番号にする', () => {
    expect(nextId('goal', [])).toBe('goal-1')
    expect(nextId('goal', ['goal-1', 'goal-3', 'goal-education'])).toBe('goal-2')
  })
})

describe('planIssues（欄をまたぐ契約違反）', () => {
  const monthly = (overrides: Partial<CustomGoal> = {}): CustomGoal =>
    ({
      ...customGoalTemplate(appDefaults, base, 'goal-1', 'monthlyExpense'),
      ...overrides,
    }) as CustomGoal

  it('見本の世帯と雛形のカードには問題が無い', () => {
    const plan = planWith([
      monthly(),
      customGoalTemplate(appDefaults, base, 'goal-2', 'onceExpense'),
    ])
    expect(planIssues(plan).size).toBe(0)
  })

  it('毎月のカードの終わりが始まりと同じか前なら、終わりの欄に出す', () => {
    const same = planWith([monthly({ from: yearMonth(2030, 4), to: yearMonth(2030, 4) })])
    expect(planIssues(same).get('goals.goal-1.to')).toBeTruthy()
    const reversed = planWith([monthly({ from: yearMonth(2030, 4), to: yearMonth(2029, 1) })])
    expect(planIssues(reversed).get('goals.goal-1.to')).toBeTruthy()
    const oneMonth = planWith([monthly({ from: yearMonth(2030, 4), to: yearMonth(2030, 5) })])
    expect(planIssues(oneMonth).size).toBe(0)
  })

  it('家のカード：雛形には問題が無く、頭金が価格を超えたら頭金の欄に出す（同じなら通す）', () => {
    const home = homeGoalTemplate(appDefaults, base, 'goal-3')
    expect(planIssues(planWith([home])).size).toBe(0)
    expect(
      planIssues(planWith([{ ...home, downPayment: home.price + 1 }])).get(
        'goals.goal-3.downPayment',
      ),
    ).toBeTruthy()
    expect(planIssues(planWith([{ ...home, downPayment: home.price }])).size).toBe(0)
  })

  it('名前が空なら名前の欄に出す', () => {
    expect(planIssues(planWith([monthly({ name: '  ' })])).get('goals.goal-1.name')).toBeTruthy()
  })

  it('大人の生まれ年が今年より後、見込みが今年以前・同じ年が 2 つ、市区町村が空なら出す', () => {
    const plan = planWith([])
    const [first, second] = plan.adults
    if (first === undefined || second === undefined) throw new Error('見本の大人が 2 人いない')
    const broken: LifePlan = {
      ...plan,
      municipality: '',
      adults: [
        { ...first, birthYear: base.year + 1 },
        {
          ...second,
          outlookSteps: [
            { year: 2030, annualIncome: 4000000 },
            { year: 2030, annualIncome: 4500000 },
          ],
        },
      ],
    }
    const issues = planIssues(broken)
    expect(issues.get(`adults.${first.id}.birthYear`)).toBeTruthy()
    expect(issues.get(`adults.${second.id}.outlookSteps`)).toMatch(/同じ年/)
    expect(issues.get('municipality')).toBeTruthy()

    // 今年以前の見込みは計算に使われないだけなので止めない（年が明けて開いても保存できるように）
    const thisYear = planIssues({
      ...plan,
      adults: [{ ...first, outlookSteps: [{ year: base.year, annualIncome: 4000000 }] }, second],
    })
    expect(thisYear.size).toBe(0)
  })

  it('来年の見込みを入れて保存した計画を、年が明けて開いても、別の欄を直して保存できる', () => {
    const storage = new Map<string, string>()
    const memory = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, value),
    }
    const plan = planWith([])
    const [first, ...rest] = plan.adults
    if (first === undefined) throw new Error('見本の大人がいない')
    const withOutlook: LifePlan = {
      ...plan,
      adults: [
        { ...first, outlookSteps: [{ year: base.year + 1, annualIncome: 6000000 }] },
        ...rest,
      ],
    }
    expect(commitPlan(withOutlook, [`adults.${first.id}.outlookSteps`], memory).ok).toBe(true)

    // 2 年後に開くと、見込みの年は過ぎている
    const later = openPlanSession(memory, yearMonth(base.year + 2, 3))
    const edited = {
      ...later.plan,
      living: { ...later.plan.living, monthlyRent: 80000 },
    }
    expect(planIssues(edited).size).toBe(0)
    const result = commitPlan(edited, [...later.touched, 'living.monthlyRent'], memory)
    expect(result.ok && result.saved).toBe(true)
    expect(openPlanSession(memory, yearMonth(base.year + 2, 3)).plan.living.monthlyRent).toBe(80000)
  })
})

describe('resolveMunicipality（打った文字 → 自治体コード）', () => {
  it('5 桁の数字はそのまま（一覧に無いコードも通す）', () => {
    expect(resolveMunicipality('14100')).toBe('14100')
    expect(resolveMunicipality(' 99002 ')).toBe('99002')
  })

  it('名前が一覧の 1 件にだけ合えば、そのコード', () => {
    expect(resolveMunicipality('横浜市')).toBe('14100')
    expect(resolveMunicipality('神奈川県 横浜市')).toBe('14100')
    expect(resolveMunicipality('神奈川県横浜市')).toBe('14100')
  })

  it('同じ名前が複数・合わない・空・桁の違う数字は null', () => {
    expect(resolveMunicipality('府中市')).toBeNull()
    expect(resolveMunicipality('東京都 府中市')).toBe('13206')
    expect(resolveMunicipality('横浜')).toBeNull()
    expect(resolveMunicipality('')).toBeNull()
    expect(resolveMunicipality('1410')).toBeNull()
  })
})

describe('goalCard（カードの帯と毎月いくら）', () => {
  it('オフのカードも、オンにしたときの帯を出す', () => {
    const goal = {
      ...customGoalTemplate(appDefaults, base, 'goal-1', 'monthlyExpense'),
      enabled: false,
    }
    const result = goalBands(planWith([goal]), goal, appDefaults, masterTables)
    expect(result.ok && result.bands).toHaveLength(1)
  })

  it('帯にできない入力は理由で返す（投げない）', () => {
    const goal = {
      ...customGoalTemplate(appDefaults, base, 'goal-1', 'monthlyExpense'),
      amount: -1,
    }
    const result = goalBands(planWith([goal]), goal, appDefaults, masterTables)
    expect(result.ok).toBe(false)
  })

  it('毎月いくら：同時に掛かる帯の合計のうち、いちばん重い月。収入なら印を付ける。帯が無ければ null', () => {
    const band = (
      monthly: number,
      kind: Band['kind'],
      from = base,
      to = yearMonth(2030, 1),
    ): Band => ({ goalId: 'g', label: 'x', kind, monthly, from, to })
    // 同じ期間に重なる帯は足す
    expect(cardMonthly([band(10000, 'payment'), band(30000, 'saving')], base)).toEqual({
      monthly: 40000,
      income: false,
    })
    // 重ならない帯（家の「積立」の後に「返済 ＋ 修繕と税」）は、重い方の月
    const purchase = yearMonth(2029, 1)
    expect(
      cardMonthly(
        [
          band(50000, 'saving', base, purchase),
          band(90000, 'payment', purchase, yearMonth(2064, 1)),
          band(20000, 'payment', purchase),
        ],
        base,
      ),
    ).toEqual({ monthly: 110000, income: false })
    expect(cardMonthly([band(20000, 'income')], base)).toEqual({ monthly: 20000, income: true })
    expect(cardMonthly([band(5000, 'earmarked')], base)).toBeNull()
    expect(cardMonthly([band(5000, 'payment', base, base)], base)).toBeNull()
    expect(cardMonthly([], base)).toBeNull()
  })

  it('毎月いくら：起点より前に終わった帯は数えず、起点より前に始まった帯は起点から数える（PR #86 の Codex の指摘）', () => {
    const band = (monthly: number, from: [number, number], to: [number, number]): Band => ({
      goalId: 'g',
      label: 'x',
      kind: 'payment',
      monthly,
      from: yearMonth(...from),
      to: yearMonth(...to),
    })
    // 2000 年に買って 15 年ローン：返済は 2015 年に終わっている。起点（2026-11）からは修繕と税だけ
    const repaid = band(120000, [2000, 1], [2015, 1])
    const upkeep = band(20000, [2026, 11], [2045, 1])
    expect(cardMonthly([repaid, upkeep], base)).toEqual({ monthly: 20000, income: false })
    // 返済の帯しか無く、もう終わっていれば null
    expect(cardMonthly([repaid], base)).toBeNull()
    // 起点より前に始まってまだ続く返済は、起点の月に修繕と税と重なって数える
    const ongoing = band(90000, [2020, 1], [2055, 1])
    expect(cardMonthly([ongoing, upkeep], base)).toEqual({ monthly: 110000, income: false })
    // 起点の月に終わる帯（「この月の前まで」）も数えない
    expect(cardMonthly([band(5000, [2020, 1], [2026, 11])], base)).toBeNull()
  })
})

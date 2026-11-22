import { describe, expect, it } from 'vitest'
import {
  commitPlan,
  evaluatePlan,
  openAndEvaluate,
  openPlanSession,
  returnToSample,
  startOwnPlan,
  todayYearMonth,
} from '../../src/app/planSession'
import { appDefaults } from '../../src/data/appData'
import { childCostGoalTemplate } from '../../src/domain/plan/defaults'
import type { Goal } from '../../src/domain/plan/types'
import { yearMonth } from '../../src/domain/plan/yearMonth'
import {
  PLAN_STORAGE_V2_KEY,
  savePlanV2,
  type PlanStorageV2,
  type PlanStorageV2Remover,
} from '../../src/storage/planStorageV2'

/** テスト用の保存先（消す口も持つ。見本の世帯に戻すテストで使う） */
function memoryStorage(initial: Record<string, string> = {}): PlanStorageV2 & PlanStorageV2Remover {
  const items = new Map(Object.entries(initial))
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
    removeItem: (key) => {
      items.delete(key)
    },
  }
}

const today = yearMonth(2026, 11)

/** 見本の子（child-1・child-2）の子の費用のカードの雛形（T9） */
const childCards = (): Goal[] => [
  childCostGoalTemplate(appDefaults, 'child-1'),
  childCostGoalTemplate(appDefaults, 'child-2'),
]

describe('todayYearMonth', () => {
  it('端末の日付の年と月（1 始まり）にする', () => {
    expect(todayYearMonth(new Date(2027, 0, 31))).toEqual({ year: 2027, month: 1 })
  })
})

describe('openPlanSession', () => {
  it('保存が無ければ見本の世帯を、今日を起点にして開く', () => {
    const session = openPlanSession(memoryStorage(), today)
    expect(session.origin).toBe('sample')
    expect(session.storageProblem).toBeNull()
    expect(session.plan.baseYearMonth).toEqual(today)
    expect(session.plan.goals.length).toBeGreaterThan(0)
  })

  it('保存があれば、その計画に今日の起点を足して開く', () => {
    const storage = memoryStorage()
    const sample = openPlanSession(storage, today).plan
    const edited = { ...sample, living: { ...sample.living, monthlyRent: 80000 } }
    savePlanV2(edited, ['living.monthlyRent'], storage)

    const later = yearMonth(2027, 4)
    const session = openPlanSession(storage, later)
    expect(session.origin).toBe('saved')
    expect(session.touched).toEqual(['living.monthlyRent'])
    expect(session.plan.living.monthlyRent).toBe(80000)
    expect(session.plan.baseYearMonth).toEqual(later)
  })

  it('直していない住宅ローン金利は、保存の値ではなく今の既定値で開く（既定値は毎月変わる。T7）', () => {
    const storage = memoryStorage()
    const own = startOwnPlan(openPlanSession(storage, today)).plan
    // 前の月の既定値で保存された計画（印なし）。今の既定値と必ず違う値にする
    const previous = appDefaults.assumptions.mortgageRate.value + 0.01
    const old = { ...own, assumptions: { ...own.assumptions, mortgageRate: previous } }
    savePlanV2(old, ['living.monthlyRent'], storage)
    const session = openPlanSession(storage, today)
    expect(session.plan.assumptions.mortgageRate).toBe(appDefaults.assumptions.mortgageRate.value)
    // ほかの前提は保存の値のまま
    expect(session.plan.assumptions.investmentReturnRate).toBe(old.assumptions.investmentReturnRate)
    expect(session.touched).toEqual(['living.monthlyRent'])
  })

  it('直した（印のある）住宅ローン金利は、保存の値のまま開く', () => {
    const storage = memoryStorage()
    const own = startOwnPlan(openPlanSession(storage, today)).plan
    const mine = { ...own, assumptions: { ...own.assumptions, mortgageRate: 0.0123 } }
    savePlanV2(mine, ['assumptions.mortgageRate'], storage)
    expect(openPlanSession(storage, today).plan.assumptions.mortgageRate).toBe(0.0123)
  })

  it('保存が壊れていれば見本の世帯で開き、理由を持つ', () => {
    const session = openPlanSession(memoryStorage({ [PLAN_STORAGE_V2_KEY]: 'x' }), today)
    expect(session.origin).toBe('sample')
    expect(session.storageProblem?.kind).toBe('unreadable')
  })
})

describe('openAndEvaluate', () => {
  /** 老後資金のカード（T10 で帯にした）。金額はダミー */
  const retirement: Goal = {
    id: 'goal-later',
    enabled: true,
    kind: 'retirement',
    saved: 0,
    targetAmount: 20000000,
    byYear: 2050,
    vehicle: 'nisa',
  }

  /** 大学資金のカード（T10 で帯にした。見本の 1 人目・児童手当を回す）。金額はダミー */
  const university: Goal = {
    id: 'goal-uni',
    enabled: true,
    kind: 'university',
    childId: 'child-1',
    saved: 0,
    targetAmount: 3700000,
    allocateChildAllowance: true,
    vehicle: 'childNisa',
  }

  /** 形は正しいが計算できない家のカード（頭金が価格を超える）。金額はダミー */
  const overpaidHome: Goal = {
    id: 'goal-overpaid',
    enabled: true,
    kind: 'home',
    saved: 0,
    purchaseYear: 2033,
    price: 30000000,
    downPayment: 31000000,
    loanYears: 35,
    monthlyUpkeep: 20000,
  }

  /** 車のカード（T8 で帯にした）。金額はダミー */
  const car: Goal = {
    id: 'goal-wagon',
    enabled: true,
    kind: 'car',
    saved: 0,
    purchaseYear: 2030,
    price: 3000000,
    payment: { type: 'loan', years: 5 },
    monthlyUpkeep: 15000,
    replaceEveryYears: 7,
  }

  it('車のカードを含む保存は、見本に戻さずにそのまま開いて計算する（T8）', () => {
    const storage = memoryStorage()
    const own = startOwnPlan(openPlanSession(storage, today)).plan
    savePlanV2({ ...own, goals: [car] }, ['goals.goal-wagon.payment'], storage)

    const { session, result } = openAndEvaluate(storage, today)
    expect(session.origin).toBe('saved')
    expect(session.storageProblem).toBeNull()
    // T9 より前の保存（子の費用のカードが無い）は、開くと子の数だけ雛形のカードが付く
    expect(session.plan.goals).toEqual([car, ...childCards()])
    expect(session.touched).toEqual(['goals.goal-wagon.payment'])
    const labels = result.ok ? result.evaluation.bands.map((b) => b.label) : []
    expect(labels).toEqual(
      expect.arrayContaining(['車のローンの返済', '車の維持費', '次の車の積立']),
    )
  })

  /** 家のカード（T7 で帯にした）。金額はダミー */
  const home: Goal = {
    id: 'goal-house',
    enabled: true,
    kind: 'home',
    saved: 0,
    purchaseYear: 2032,
    price: 40000000,
    downPayment: 4000000,
    loanYears: 35,
    monthlyUpkeep: 20000,
  }

  it('家のカードを含む保存は、見本に戻さずにそのまま開いて計算する（T7）', () => {
    const storage = memoryStorage()
    const own = startOwnPlan(openPlanSession(storage, today)).plan
    savePlanV2({ ...own, goals: [home] }, ['goals.goal-house.price'], storage)

    const { session, result } = openAndEvaluate(storage, today)
    expect(session.origin).toBe('saved')
    expect(session.storageProblem).toBeNull()
    expect(session.plan.goals).toEqual([home, ...childCards()])
    expect(session.touched).toEqual(['goals.goal-house.price'])
    expect(result.ok && result.evaluation.bands.some((b) => b.label === '返済')).toBe(true)
  })

  it('子の費用のカードを含む保存は、そのまま開いて計算する（カードを足し直さない。T9）', () => {
    const storage = memoryStorage()
    const own = startOwnPlan(openPlanSession(storage, today)).plan
    const [first, second] = childCards()
    if (first?.kind !== 'childCost' || second === undefined) throw new Error('雛形が無い')
    const mine: Goal = {
      ...first,
      schools: { ...first.schools, highSchool: 'private' },
      cramSchools: [{ fromGrade: 10, toGrade: 12, monthly: 23900 }],
    }
    savePlanV2({ ...own, goals: [mine, second] }, ['goals.childcost-child-1.highSchool'], storage)

    const { session, result } = openAndEvaluate(storage, today)
    expect(session.origin).toBe('saved')
    expect(session.plan.goals).toEqual([mine, second])
    expect(session.touched).toEqual(['goals.childcost-child-1.highSchool'])
    const labels = result.ok ? result.evaluation.bands.map((b) => b.label) : []
    expect(labels).toEqual(
      expect.arrayContaining(['学校（1人目）', '塾（1人目）', '学校（2人目）']),
    )
  })

  it('保存した計画が計算できれば、そのまま開く', () => {
    const storage = memoryStorage()
    savePlanV2(openPlanSession(storage, today).plan, [], storage)
    const { session, result } = openAndEvaluate(storage, today)
    expect(session.origin).toBe('saved')
    expect(result.ok).toBe(true)
  })

  it('大学資金・老後資金のカードを含む保存は、見本に戻さずにそのまま開いて計算する（T10）', () => {
    const storage = memoryStorage()
    const own = startOwnPlan(openPlanSession(storage, today)).plan
    const goals = [...childCards(), university, retirement]
    savePlanV2({ ...own, goals }, ['goals.goal-uni.targetAmount'], storage)

    const { session, result } = openAndEvaluate(storage, today)
    expect(session.origin).toBe('saved')
    expect(session.storageProblem).toBeNull()
    expect(session.plan.goals).toEqual(goals)
    expect(result.ok).toBe(true)
    const labels = result.ok ? result.evaluation.bands.map((b) => b.label) : []
    expect(labels).toEqual(
      expect.arrayContaining(['大学資金の積立（1人目）', '児童手当（1人目）', '老後資金の積立']),
    )
  })

  // 大学資金・老後資金も帯にした（T10）ので、どの種類のカードも計算できる。保存の形は正しいのに計算で投げる自然な道は
  // 契約違反（RangeError）だけになった。`openAndEvaluate` は念のため RangeError 以外も受け止める（握りつぶさず理由にする）
  it('保存した計画が今の版で計算できなければ、保存を消さずに見本で開き、理由を持つ', () => {
    const storage = memoryStorage()
    const sample = openPlanSession(storage, today).plan
    // 形は正しいが計算できない保存：頭金が価格を超える家のカード（帯にするとき RangeError）
    savePlanV2({ ...sample, goals: [...sample.goals, overpaidHome] }, [], storage)
    const saved = storage.getItem(PLAN_STORAGE_V2_KEY)

    const { session, result } = openAndEvaluate(storage, today)
    expect(session.origin).toBe('sample')
    expect(session.storageProblem?.kind).toBe('unsupported')
    expect(session.storageProblem?.reason).toContain('頭金')
    expect(result.ok).toBe(true)
    expect(storage.getItem(PLAN_STORAGE_V2_KEY)).toBe(saved)
  })

  it('保存した計画が契約違反（RangeError）でも、見本で開いて理由を持つ', () => {
    const storage = memoryStorage()
    const sample = openPlanSession(storage, today).plan
    const first = sample.goals[0]
    if (first === undefined) throw new Error('見本の世帯にカードが無い')
    // 同じ id のカードを 2 枚にする（`expandGoal` が RangeError を投げる）
    savePlanV2({ ...sample, goals: [...sample.goals, first] }, [], storage)

    const { session } = openAndEvaluate(storage, today)
    expect(session.origin).toBe('sample')
    expect(session.storageProblem?.kind).toBe('unsupported')
  })
})

describe('evaluatePlan', () => {
  it('見本の世帯は、次の段と複数の段が出る', () => {
    const result = evaluatePlan(openPlanSession(memoryStorage(), today).plan)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.evaluation.steps.length).toBeGreaterThanOrEqual(2)
    expect(result.evaluation.nextStep).not.toBeNull()
  })

  it('契約違反（RangeError）は投げずに理由を返す', () => {
    const plan = openPlanSession(memoryStorage(), today).plan
    const broken = { ...plan, living: { ...plan.living, monthlyLivingCost: -1 } }
    const result = evaluatePlan(broken)
    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.message).not.toBe('')
  })

  it('RangeError でない例外は投げ直す（握りつぶさない）', () => {
    const plan = openPlanSession(memoryStorage(), today).plan
    const broken = { ...plan, goals: null } as unknown as typeof plan
    expect(() => evaluatePlan(broken)).toThrow(TypeError)
  })
})

describe('startOwnPlan（T6）', () => {
  it('見本に入った家のカード（T7）も持ち込まない', () => {
    const sample = openPlanSession(memoryStorage(), today)
    expect(sample.plan.goals.some((goal) => goal.kind === 'home')).toBe(true)
    expect(startOwnPlan(sample).plan.goals).toEqual(childCards())
  })

  it('見本のカードを持ち込まず、家族・暮らし・前提は見本の値のまま、印は空で始める', () => {
    const sample = openPlanSession(memoryStorage(), today)
    const own = startOwnPlan({ ...sample, touched: ['living.monthlyRent'] })
    expect(own.origin).toBe('saved')
    expect(own.touched).toEqual([])
    expect(own.storageProblem).toBeNull()
    // 子の費用のカードは子ごとに付く物なので、見本の子の数だけ雛形のカード（すべて公立・塾なし）で付く（T9）
    expect(own.plan.goals).toEqual(childCards())
    expect(own.plan.adults).toEqual(sample.plan.adults)
    expect(own.plan.children).toEqual(sample.plan.children)
    expect(own.plan.living).toEqual(sample.plan.living)
    expect(own.plan.assumptions).toEqual(sample.plan.assumptions)
  })

  it('見本のカードを選り分けず、どんなカードも持ち込まない（見本に種類が増えても外し漏れない）', () => {
    const sample = openPlanSession(memoryStorage(), today)
    const other: Goal = {
      id: 'goal-house',
      enabled: true,
      kind: 'home',
      saved: 0,
      purchaseYear: 2032,
      price: 40000000,
      downPayment: 4000000,
      loanYears: 35,
      monthlyUpkeep: 20000,
    }
    const own = startOwnPlan({
      ...sample,
      plan: { ...sample.plan, goals: [...sample.plan.goals, other] },
    })
    expect(own.plan.goals).toEqual(childCards())
  })

  it('子がいなければ、目標カードは空で始まる（T9）', () => {
    const sample = openPlanSession(memoryStorage(), today)
    const own = startOwnPlan({ ...sample, plan: { ...sample.plan, children: [] } })
    expect(own.plan.goals).toEqual([])
  })
})

describe('returnToSample（T23）', () => {
  /** 自分の計画を始めて直し、保存した端末を作る */
  function storageWithOwnPlan() {
    const storage = memoryStorage()
    const own = startOwnPlan(openPlanSession(storage, today))
    const edited = { ...own.plan, living: { ...own.plan.living, monthlyRent: 70000 } }
    const committed = commitPlan(edited, ['living.monthlyRent'], storage)
    if (!committed.ok || !committed.saved) throw new Error('自分の計画を保存できなかった')
    return storage
  }

  it('保存を消し、はじめて開いたときと同じ見本の世帯にして計算する', () => {
    const storage = storageWithOwnPlan()
    const returned = returnToSample(storage, today)
    if (!returned.ok) throw new Error('見本に戻せなかった')

    const fresh = openAndEvaluate(memoryStorage(), today)
    expect(returned.session).toEqual(fresh.session)
    expect(returned.result).toEqual(fresh.result)
    expect(returned.session.origin).toBe('sample')
    expect(returned.session.touched).toEqual([])
    expect(returned.session.storageProblem).toBeNull()
  })

  it('開き直しても見本のまま（保存が残っていない）', () => {
    const storage = storageWithOwnPlan()
    returnToSample(storage, today)
    expect(storage.getItem(PLAN_STORAGE_V2_KEY)).toBeNull()
    expect(openPlanSession(storage, today).origin).toBe('sample')
  })

  it('保存を消せなければ見本にしない（ok: false。保存は残り、開き直すと自分の計画のまま）', () => {
    const storage = storageWithOwnPlan()
    const failing = {
      ...storage,
      removeItem: () => {
        throw new Error('保存を禁じた設定')
      },
    }
    expect(returnToSample(failing, today)).toEqual({ ok: false })
    expect(openPlanSession(storage, today).origin).toBe('saved')
  })
})

describe('commitPlan（T6）', () => {
  it('計算できれば保存し、印も一緒に書く', () => {
    const storage = memoryStorage()
    const plan = openPlanSession(storage, today).plan
    const edited = { ...plan, living: { ...plan.living, monthlyLivingCost: 300000 } }
    const result = commitPlan(edited, ['living.monthlyLivingCost'], storage)
    expect(result.ok && result.saved).toBe(true)

    const reopened = openPlanSession(storage, today)
    expect(reopened.origin).toBe('saved')
    expect(reopened.plan.living.monthlyLivingCost).toBe(300000)
    expect(reopened.touched).toEqual(['living.monthlyLivingCost'])
  })

  it('計算できない（契約違反）ときは保存しない', () => {
    const storage = memoryStorage()
    const plan = openPlanSession(storage, today).plan
    const broken = { ...plan, living: { ...plan.living, monthlyLivingCost: -1 } }
    const result = commitPlan(broken, [], storage)
    expect(result.ok).toBe(false)
    expect(storage.getItem(PLAN_STORAGE_V2_KEY)).toBeNull()
  })

  it('端末に書けなくても計算の結果は返し、saved: false で知らせる', () => {
    const plan = openPlanSession(memoryStorage(), today).plan
    const failing: PlanStorageV2 = {
      getItem: () => null,
      setItem: () => {
        throw new Error('容量超過')
      },
    }
    const result = commitPlan(plan, [], failing)
    expect(result.ok).toBe(true)
    expect(result.ok && result.saved).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import { appDefaults, sampleHousehold } from '../../src/data/appData'
import { sampleLifePlan } from '../../src/domain/plan/defaults'
import { yearMonth } from '../../src/domain/plan/yearMonth'
import {
  clearPlanV2,
  loadPlanV2,
  PLAN_STORAGE_V2_KEY,
  savePlanV2,
  type PlanStorageV2,
  type PlanStorageV2Remover,
} from '../../src/storage/planStorageV2'

/** テスト用の保存先。中身を覗けるように Map で持つ */
function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  const storage: PlanStorageV2 = {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, value)
    },
  }
  return { storage, items }
}

const plan = sampleLifePlan(appDefaults, sampleHousehold, yearMonth(2026, 11))

describe('savePlanV2・loadPlanV2', () => {
  it('保存が無ければ empty', () => {
    expect(loadPlanV2(memoryStorage().storage)).toEqual({ kind: 'empty' })
  })

  it('保存して読むと同じ計画に戻る。起点の年月は保存しない', () => {
    const { storage, items } = memoryStorage()
    expect(savePlanV2(plan, ['living.monthlyRent'], storage)).toBe(true)

    const raw = JSON.parse(items.get(PLAN_STORAGE_V2_KEY) ?? '{}') as Record<string, unknown>
    expect(raw.app).toBe('life-plan-simulator')
    expect(raw.version).toBe(2)
    expect(raw.plan).not.toHaveProperty('baseYearMonth')

    const { baseYearMonth: _base, ...rest } = plan
    expect(loadPlanV2(storage)).toEqual({
      kind: 'loaded',
      plan: rest,
      touched: ['living.monthlyRent'],
    })
  })

  it('大学資金のカードの進路（D37）：無い保存（T10 のころ）も読め、目標額はそのまま。ある保存は進路ごと戻る。選べない進路なら broken', () => {
    const university = plan.goals.find((goal) => goal.kind === 'university')
    if (university === undefined) throw new Error('見本に大学資金のカードが無い')
    // 見本の大学資金のカードは進路を持たない（前の保存と同じ形）
    expect(university).not.toHaveProperty('course')

    const { storage } = memoryStorage()
    savePlanV2(plan, [], storage)
    const old = loadPlanV2(storage)
    const oldCard =
      old.kind === 'loaded' ? old.plan.goals.find((g) => g.id === university.id) : null
    expect(oldCard).toEqual(university)

    const withCourse = { ...university, course: 'nationalPublic' as const }
    savePlanV2({ ...plan, goals: [withCourse] }, [], storage)
    const loaded = loadPlanV2(storage)
    expect(loaded.kind === 'loaded' ? loaded.plan.goals : null).toEqual([withCourse])

    const { storage: broken } = memoryStorage({
      [PLAN_STORAGE_V2_KEY]: JSON.stringify({
        app: 'life-plan-simulator',
        version: 2,
        plan: { ...plan, goals: [{ ...university, course: 'privateMedical' }] },
        touched: [],
      }),
    })
    expect(loadPlanV2(broken).kind).toBe('broken')
  })

  it('直した項目の印は重ねずに並べ替えて持つ', () => {
    const { storage } = memoryStorage()
    savePlanV2(plan, ['b', 'a', 'b'], storage)
    const loaded = loadPlanV2(storage)
    expect(loaded.kind === 'loaded' ? loaded.touched : null).toEqual(['a', 'b'])
  })

  it('JSON として読めなければ broken', () => {
    const { storage } = memoryStorage({ [PLAN_STORAGE_V2_KEY]: '{壊れた' })
    expect(loadPlanV2(storage).kind).toBe('broken')
  })

  it('形が合わなければ、どこが合わないかを添えて broken', () => {
    const { storage } = memoryStorage()
    savePlanV2(plan, [], storage)
    const raw = JSON.parse(storage.getItem(PLAN_STORAGE_V2_KEY) ?? '{}') as {
      plan: { living: { monthlyRent: unknown } }
    }
    raw.plan.living.monthlyRent = -1
    storage.setItem(PLAN_STORAGE_V2_KEY, JSON.stringify(raw))

    const loaded = loadPlanV2(storage)
    expect(loaded.kind).toBe('broken')
    expect(loaded.kind === 'broken' ? loaded.reason : '').toContain('plan.living.monthlyRent')
  })

  it('版やアプリ名が違えば broken', () => {
    const { storage } = memoryStorage()
    savePlanV2(plan, [], storage)
    const raw = JSON.parse(storage.getItem(PLAN_STORAGE_V2_KEY) ?? '{}') as { version: number }
    raw.version = 3
    storage.setItem(PLAN_STORAGE_V2_KEY, JSON.stringify(raw))
    expect(loadPlanV2(storage).kind).toBe('broken')
  })

  it('月が 1〜12 の外なら broken', () => {
    const { storage } = memoryStorage()
    savePlanV2(plan, [], storage)
    const raw = JSON.parse(storage.getItem(PLAN_STORAGE_V2_KEY) ?? '{}') as {
      plan: { children: { birthMonth: number }[] }
    }
    const first = raw.plan.children[0]
    if (first === undefined) throw new Error('見本の世帯に子がいない')
    first.birthMonth = 13
    storage.setItem(PLAN_STORAGE_V2_KEY, JSON.stringify(raw))
    expect(loadPlanV2(storage).kind).toBe('broken')
  })

  it('前の版の保存（v1）は読まないし、消さない', () => {
    const v1 = { 'life-plan-simulator.plan.v1': '{"app":"life-plan-simulator","version":1}' }
    const { storage, items } = memoryStorage(v1)
    expect(loadPlanV2(storage)).toEqual({ kind: 'empty' })
    savePlanV2(plan, [], storage)
    expect(items.get('life-plan-simulator.plan.v1')).toBe(v1['life-plan-simulator.plan.v1'])
  })

  it('書けなければ false', () => {
    const storage: PlanStorageV2 = {
      getItem: () => null,
      setItem: () => {
        throw new Error('容量超過')
      },
    }
    expect(savePlanV2(plan, [], storage)).toBe(false)
  })

  it('読むときに保存先が投げれば broken（握りつぶさずに理由を返す）', () => {
    const storage: PlanStorageV2 = {
      getItem: () => {
        throw new Error('保存を禁じた設定')
      },
      setItem: () => {},
    }
    expect(loadPlanV2(storage).kind).toBe('broken')
  })
})

describe('clearPlanV2（T23）', () => {
  /** 消す口も持つテスト用の保存先 */
  function removableStorage(initial: Record<string, string> = {}) {
    const { storage, items } = memoryStorage(initial)
    const remover: PlanStorageV2Remover = { removeItem: (key) => void items.delete(key) }
    return { storage: { ...storage, ...remover }, items }
  }

  it('保存した計画を消し、消したあとは empty で読める', () => {
    const { storage } = removableStorage()
    savePlanV2(plan, ['living.monthlyRent'], storage)
    expect(clearPlanV2(storage)).toBe(true)
    expect(loadPlanV2(storage)).toEqual({ kind: 'empty' })
  })

  it('保存が無くても true（消す物が無いのは失敗ではない）', () => {
    const { storage } = removableStorage()
    expect(clearPlanV2(storage)).toBe(true)
  })

  it('前の版の保存（v1）とほかのキーには触らない（D35）', () => {
    const { storage, items } = removableStorage({
      'life-plan-simulator.plan.v1': '{"old":true}',
      other: 'x',
    })
    savePlanV2(plan, [], storage)
    clearPlanV2(storage)
    expect(items.has(PLAN_STORAGE_V2_KEY)).toBe(false)
    expect(items.get('life-plan-simulator.plan.v1')).toBe('{"old":true}')
    expect(items.get('other')).toBe('x')
  })

  it('保存先が投げれば false（握りつぶさずに呼び出し側へ返す）', () => {
    const storage: PlanStorageV2Remover = {
      removeItem: () => {
        throw new Error('保存を禁じた設定')
      },
    }
    expect(clearPlanV2(storage)).toBe(false)
  })
})

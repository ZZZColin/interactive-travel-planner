import { computed, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { cloneRouteCache, createPlanRecord, normalizeParticipants, normalizePlaceAddedAt, prunePlannerBudget, reconcilePlannerRange, removedPlannerDays } from '../domain/plans'
import { normalizeBudgetState } from '../domain/budget'
import { basePlaces, createStop } from '../domain/data'
import { routeCacheKeyIncludesPlace } from '../domain/transport'
import { normalizeImportDurationDays } from '../ai/importDuration'
import type { ResolvedPlanImport } from '../ai/types'
import type { PersistedPlannerState, Place, PlaceCategory, PlanEditorValue, PlanRecord } from '../domain/types'
import { urlWithPlanId, type PlanNavigationMode } from '../domain/planUrl'
import { usePlannerStore } from './planner'
import { notifyPlanPersisted, deleteSharedPlanIfTracked, getTrackedSharedPlanId } from '../sharing/sharedPlanOwnerSync'
import { deleteSyncedPlan, fetchSession, listSyncedPlans } from '../auth/client'
import { forgetPlan, getBookkeeping, pushPlanNow, recordServerAdopted, schedulePushPlan } from '../sync/allPlansSync'
import { activeCollabSession, connectPlanCollab, disconnectPlanCollab } from '../collab/planCollab'

const STORAGE_KEY = 'interactiveTravel.plans.continuous.v1'
const VERSION_STORAGE_KEY = 'interactiveTravel.planVersions.continuous.v1'
const RECYCLE_STORAGE_KEY = 'interactiveTravel.planRecycleBin.continuous.v1'

const LEGACY_BUSINESS_KEYS = [
  'interactiveTravel.plans.v1',
  'interactiveTravel.planVersions.v1',
  'interactiveTravel.planRecycleBin.v1',
  'routePlannerPrototypeV2',
  'routePlannerAmapRoutes',
]
LEGACY_BUSINESS_KEYS.forEach((key) => localStorage.removeItem(key))

interface PlanVersion { id: string; planId: string; planName: string; createdAt: string; reason: string; record: PlanRecord }
interface RecycledPlan { id: string; deletedAt: string; record: PlanRecord }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const usePlansStore = defineStore('plans', () => {
  const planner = usePlannerStore()
  const plans = ref<PlanRecord[]>([])
  const versions = ref<PlanVersion[]>([])
  const recycleBin = ref<RecycledPlan[]>([])
  const activePlanId = ref<string | null>(null)
  const view = ref<'home' | 'planner'>('home')
  const openingPlan = ref(false)
  const saveState = ref<'saved' | 'saving' | 'error'>('saved')
  let hydrating = false
  let openingToken = 0

  try { versions.value = JSON.parse(localStorage.getItem(VERSION_STORAGE_KEY) ?? '[]') as PlanVersion[] } catch { versions.value = [] }
  try { recycleBin.value = JSON.parse(localStorage.getItem(RECYCLE_STORAGE_KEY) ?? '[]') as RecycledPlan[] } catch { recycleBin.value = [] }

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as PlanRecord[]
    plans.value = saved.map((plan) => ({
      ...plan,
      metadata: { ...plan.metadata, participants: normalizeParticipants(plan.metadata.participants) },
      plannerState: {
        ...plan.plannerState,
        placeAddedAt: normalizePlaceAddedAt(plan.plannerState.known, plan.plannerState.placeAddedAt),
        budget: normalizeBudgetState(plan.plannerState.budget),
      },
    }))
  } catch {
    plans.value = []
  }



  // owner 自己打开一份"已经分享出去"的计划时，也接入逐字实时协作（跟
  // stores/sharedPlans.ts 打开"分享给我"的计划时连的是同一个房间），这样
  // owner 才能实时看到协作者的字符级修改，不用等对方的整份快照防抖推送。
  // 用 view + activePlanId 一起判断而不是只看 activePlanId，是因为
  // goHome() 并不会清空 activePlanId（回首页之后"继续上次的计划"要用到），
  // 只看 activePlanId 会漏掉"回了首页但还没切换到别的计划"这种情况下
  // 本该断开协作连接的时机。
  watch([view, activePlanId], ([currentView, id], previous) => {
    const previousId = previous?.[1] ?? null
    if (previousId != null) {
      const previousSharedId = getTrackedSharedPlanId(previousId)
      if (previousSharedId != null) disconnectPlanCollab(previousSharedId)
    }
    const sharedId = currentView === 'planner' && id != null ? getTrackedSharedPlanId(id) : null
    if (sharedId == null) return
    if (activeCollabSession.value?.sharedPlanId === sharedId) return
    fetchSession()
      .then((session) => {
        // 等用户名查回来的这一小会儿，用户可能已经又切走了，不要连一个
        // 不该连的房间
        if (view.value === currentView && activePlanId.value === id) {
          connectPlanCollab(sharedId, session.username)
        }
      })
      .catch(() => {
        // 拿不到当前用户名（比如会话刚好过期）就不接入协作，不影响计划本身的查看和编辑
      })
  })

  const sortedPlans = computed(() => [...plans.value].sort((left, right) =>
    new Date(right.metadata.startAt).getTime() - new Date(left.metadata.startAt).getTime()))
  const activePlan = computed(() => plans.value.find((plan) => plan.metadata.id === activePlanId.value) ?? null)
  const lastSavedAt = computed(() => activePlan.value?.metadata.updatedAt ?? null)

  function persist(): boolean {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plans.value))
      return true
    } catch {
      return false
    }
  }

  function persistAuxiliary(): void {
    localStorage.setItem(VERSION_STORAGE_KEY, JSON.stringify(versions.value))
    localStorage.setItem(RECYCLE_STORAGE_KEY, JSON.stringify(recycleBin.value))
  }

  function updatePlanLocation(planId: string | null, navigation: PlanNavigationMode): void {
    if (navigation === 'none' || typeof window === 'undefined') return
    const url = urlWithPlanId(window.location.href, planId)
    const state = { ...(window.history.state ?? {}), planId }
    if (navigation === 'replace') window.history.replaceState(state, '', url)
    else window.history.pushState(state, '', url)
  }

  function captureVersion(plan: PlanRecord, reason: string, force = false): void {
    const latest = versions.value.find((item) => item.planId === plan.metadata.id)
    if (!force && latest && Date.now() - new Date(latest.createdAt).getTime() < 5 * 60_000) return
    versions.value.unshift({ id: `version_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`, planId: plan.metadata.id, planName: plan.metadata.name, createdAt: new Date().toISOString(), reason, record: clone(plan) })
    const perPlanCount = new Map<string, number>()
    versions.value = versions.value.filter((item) => { const count = perPlanCount.get(item.planId) ?? 0; perPlanCount.set(item.planId, count + 1); return count < 10 }).slice(0, 60)
    persistAuxiliary()
  }

  function syncDraft(): void {
    if (hydrating || !activePlan.value) return
    saveState.value = 'saving'
    captureVersion(activePlan.value, '自动保存前')
    activePlan.value.plannerState = planner.exportState()
    activePlan.value.routeCache = cloneRouteCache(planner.routeCache)
    activePlan.value.metadata.updatedAt = new Date().toISOString()
    const saved = persist()
    if (saved) {
      notifyPlanPersisted(clone(activePlan.value))
      schedulePushPlan(clone(activePlan.value))
    }
    queueMicrotask(() => { saveState.value = saved ? 'saved' : 'error' })
  }

  function openPlan(id: string, immediate = false, navigation: PlanNavigationMode = 'push'): void {
    const plan = plans.value.find((item) => item.metadata.id === id)
    if (!plan) return
    // 打开自己的计划一定不是只读——防一手：如果是从查看某个只读共享计划
    // 直接跳过来的（理论上界面流程不会这样，但这里保险一下）。
    planner.setReadOnly(false)
    if (activePlanId.value === id) {
      openingToken += 1
      openingPlan.value = false
      view.value = 'planner'
      updatePlanLocation(id, navigation)
      return
    }

    if (view.value !== 'home') syncDraft()
    const token = ++openingToken
    hydrating = true
    activePlanId.value = id
    view.value = 'planner'
    updatePlanLocation(id, navigation)

    const hydrate = (): void => {
      if (token !== openingToken) return
      planner.loadState(clone(plan.plannerState), cloneRouteCache(plan.routeCache))
      openingPlan.value = false
      queueMicrotask(() => { hydrating = false })
    }

    if (immediate) {
      hydrate()
      return
    }
    openingPlan.value = true
    window.requestAnimationFrame(() => window.setTimeout(hydrate, 0))
  }

  function goHome(navigation: PlanNavigationMode = 'push'): void {
    openingToken += 1
    openingPlan.value = false
    hydrating = false
    syncDraft()
    view.value = 'home'
    updatePlanLocation(null, navigation)
  }

  function normalizedBackupPlans(value: unknown): PlanRecord[] {
    if (!value || typeof value !== 'object' || Number((value as any).schemaVersion) !== 4) throw new Error('仅支持当前连续路线格式的备份')
    const source = value && typeof value === 'object' && Array.isArray((value as any).plans) ? (value as any).plans : []
    return source.map((plan: any) => {
      if (!plan?.metadata?.id || !plan?.metadata?.name || !plan?.metadata?.startAt || !plan?.metadata?.endAt || !Array.isArray(plan?.plannerState?.days)) return null
      const known = Array.isArray(plan.plannerState.known) ? plan.plannerState.known.map(String) : []
      return {
        metadata: { ...plan.metadata, id: String(plan.metadata.id), name: String(plan.metadata.name), participants: normalizeParticipants(plan.metadata.participants) },
        plannerState: { ...plan.plannerState, known, customPlaces: plan.plannerState.customPlaces ?? {}, placeAddedAt: normalizePlaceAddedAt(known, plan.plannerState.placeAddedAt), budget: normalizeBudgetState(plan.plannerState.budget) },
        routeCache: cloneRouteCache(plan.routeCache ?? {}),
      } as PlanRecord
    }).filter((plan: PlanRecord | null): plan is PlanRecord => Boolean(plan))
  }

  function createBackup(): { schemaVersion: 4; exportedAt: string; plans: PlanRecord[] } {
    if (activePlan.value) syncDraft()
    return { schemaVersion: 4, exportedAt: new Date().toISOString(), plans: clone(plans.value) }
  }

  function inspectBackup(value: unknown): { plans: PlanRecord[]; conflicts: number } {
    const imported = normalizedBackupPlans(value)
    if (!imported.length) throw new Error('备份中没有可用的旅行计划')
    const existingIds = new Set(plans.value.map((plan) => plan.metadata.id))
    return { plans: imported, conflicts: imported.filter((plan) => existingIds.has(plan.metadata.id)).length }
  }

  function importBackup(value: unknown, strategy: 'copy' | 'overwrite'): number {
    const imported = inspectBackup(value).plans
    const now = new Date().toISOString()
    imported.forEach((source, index) => {
      const existingIndex = plans.value.findIndex((plan) => plan.metadata.id === source.metadata.id)
      if (existingIndex >= 0 && strategy === 'overwrite') {
        plans.value.splice(existingIndex, 1, clone(source))
        return
      }
      const copy = clone(source)
      if (existingIndex >= 0 || plans.value.some((plan) => plan.metadata.id === copy.metadata.id)) {
        copy.metadata.id = `plan_imported_${Date.now().toString(36)}_${index}`
        copy.metadata.name = `${copy.metadata.name}（导入副本）`
        copy.metadata.createdAt = now
        copy.metadata.updatedAt = now
      }
      plans.value.push(copy)
    })
    if (!persist()) throw new Error('浏览器存储空间不足，备份未能导入')
    planner.notify(`已导入 ${imported.length} 个旅行计划`)
    return imported.length
  }

  function ensureDemoPlan(): PlanRecord {
    const existing = plans.value.find((plan) => plan.metadata.id === 'plan_baseline_chuanxi')
    if (existing) return existing
    const now = new Date().toISOString()
    const record: PlanRecord = {
      metadata: {
        id: 'plan_baseline_chuanxi', name: '川西 6 日自驾', startAt: '2026-10-02T00:00:00.000Z', endAt: '2026-10-07T12:00:00.000Z',
        participants: [{ id: 'participant_me', name: '我', age: null }, { id: 'participant_companion', name: '同行者', age: null }], createdAt: now, updatedAt: now,
      },
      plannerState: planner.exportState(),
      routeCache: cloneRouteCache(planner.routeCache),
    }
    plans.value.push(record)
    persist()
    return record
  }

  function createPlan(value: PlanEditorValue): void {
    const record = createPlanRecord(value)
    plans.value.push(record)
    persist()
    pushPlanNow(clone(record)).catch(() => {})
    openPlan(record.metadata.id)
    planner.notify('计划已创建')
  }

  function rangeReductionImpact(id: string, value: PlanEditorValue): { removedDayCount: number; placeIds: string[]; placeNames: string[] } {
    if (activePlanId.value === id) syncDraft()
    const plan = plans.value.find((item) => item.metadata.id === id)
    if (!plan) return { removedDayCount: 0, placeIds: [], placeNames: [] }
    const removedDays = removedPlannerDays(plan.plannerState, plan.metadata.startAt, value.startAt, value.endAt)
    const placeIds = [...new Set(removedDays.flatMap((day) => day.stops.map((stop) => stop.placeId)))]
    const allPlaces = { ...planner.places, ...plan.plannerState.customPlaces }
    return {
      removedDayCount: removedDays.length,
      placeIds,
      placeNames: placeIds.map((placeId) => allPlaces[placeId]?.name ?? placeId),
    }
  }

  function updatePlan(id: string, value: PlanEditorValue, strategy: 'return' | 'discard' = 'return'): void {
    if (activePlanId.value === id) syncDraft()
    const plan = plans.value.find((item) => item.metadata.id === id)
    if (!plan) return
    const impact = rangeReductionImpact(id, value)
    const previousStartAt = plan.metadata.startAt
    const rangeChanged = previousStartAt !== value.startAt || plan.metadata.endAt !== value.endAt
    plan.metadata = {
      ...plan.metadata,
      name: value.name,
      startAt: value.startAt,
      endAt: value.endAt,
      participants: normalizeParticipants(value.participants),
      updatedAt: new Date().toISOString(),
    }
    const budget = normalizeBudgetState(plan.plannerState.budget)
    budget.settings.limit = value.budgetLimit
    plan.plannerState.budget = budget
    if (rangeChanged) {
      if (strategy === 'return') {
        const removedStops = removedPlannerDays(plan.plannerState, previousStartAt, value.startAt, value.endAt).flatMap((day) => day.stops)
        const removedPlaceByStop = new Map(removedStops.map((stop) => [stop.uid, stop.placeId]))
        const budget = normalizeBudgetState(plan.plannerState.budget)
        budget.expenses = budget.expenses.map((item) => {
          const placeId = item.ownerType === 'stop' ? removedPlaceByStop.get(item.ownerId) : undefined
          return placeId ? { ...item, ownerType: 'place' as const, ownerId: placeId } : item
        })
        plan.plannerState.budget = budget
      }
      plan.plannerState = prunePlannerBudget(reconcilePlannerRange(plan.plannerState, value.startAt, value.endAt, previousStartAt))
      if (strategy === 'discard' && impact.placeIds.length) {
        const remainingScheduled = new Set(plan.plannerState.days.flatMap((day) => day.stops.map((stop) => stop.placeId)))
        const discarded = new Set(impact.placeIds.filter((placeId) => !remainingScheduled.has(placeId)))
        plan.plannerState.known = plan.plannerState.known.filter((placeId) => !discarded.has(placeId))
        discarded.forEach((placeId) => {
          delete plan.plannerState.customPlaces[placeId]
          if (plan.plannerState.placeAddedAt) delete plan.plannerState.placeAddedAt[placeId]
        })
        for (const routeKey of Object.keys(plan.routeCache)) {
          if ([...discarded].some((placeId) => routeCacheKeyIncludesPlace(routeKey, placeId))) delete plan.routeCache[routeKey]
        }
        plan.plannerState = prunePlannerBudget(plan.plannerState)
      }
    }
    if (activePlanId.value === id) {
      hydrating = true
      planner.loadState(clone(plan.plannerState), cloneRouteCache(plan.routeCache))
      queueMicrotask(() => { hydrating = false })
    }
    persist()
    notifyPlanPersisted(clone(plan))
    pushPlanNow(clone(plan)).catch(() => {})
    planner.notify('计划信息已更新')
  }

  function defaultStay(category: PlaceCategory): number {
    if (category === 'lodging') return 0
    if (category === 'food') return 60
    if (category === 'transport') return 20
    if (category === 'attraction' || category === 'nature' || category === 'culture' || category === 'viewpoint') return 120
    return 60
  }

  function importIntoState(state: PersistedPlannerState, input: ResolvedPlanImport, replaceDays: boolean): void {
    if (!state.placeAddedAt) state.placeAddedAt = normalizePlaceAddedAt(state.known, undefined)
    if (replaceDays) {
      state.known = []
      state.customPlaces = {}
      state.placeAddedAt = {}
      state.days.forEach((day) => { day.stops = [] })
    }
    const allPlaces = (): Record<string, Place> => ({ ...basePlaces, ...state.customPlaces })
    let addedAt = Date.now()

    const resolvePlaceId = (place: Place): string => {
      const existing = Object.values(allPlaces()).find((item) =>
        (place.providerId && item.providerId === place.providerId) || item.name === place.name)
      const resolved = existing ?? place
      if (!basePlaces[resolved.id]) state.customPlaces[resolved.id] = resolved
      if (!state.known.includes(resolved.id)) {
        state.known.push(resolved.id)
        state.placeAddedAt[resolved.id] = addedAt++
      }
      return resolved.id
    }

    input.days.forEach((sourceDay, dayIndex) => {
      const targetDay = state.days[dayIndex]
      if (!targetDay) return
      sourceDay.places.forEach((item) => {
        const placeId = resolvePlaceId(item.place)
        if (targetDay.stops.some((stop) => stop.placeId === placeId)) return
        const stop = createStop(placeId, item.stayMinutes ?? defaultStay(item.place.category))
        stop.transportMode = item.transportToNext ?? 'driving'
        targetDay.stops.push(stop)
      })
    })
    state.selectedDay = state.days[0]?.id ?? 'd1'
    state.selectedPlace = null
  }

  function createPlanFromAiImport(input: ResolvedPlanImport): void {
    const durationDays = normalizeImportDurationDays(input.durationDays, input.days.length, input.title)
    const start = new Date(input.startDate)
    start.setHours(8, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + durationDays - 1)
    end.setHours(20, 0, 0, 0)
    const record = createPlanRecord({
      name: input.title || 'AI 导入的旅行计划',
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      participants: normalizeParticipants(input.participants),
      budgetLimit: input.budgetLimit,
    })
    importIntoState(record.plannerState, input, true)
    plans.value.push(record)
    persist()
    pushPlanNow(clone(record)).catch(() => {})
    openPlan(record.metadata.id)
    planner.notify(`已通过 AI 创建“${record.metadata.name}”`)
  }

  function mergeAiImportIntoCurrent(input: ResolvedPlanImport): void {
    syncDraft()
    const plan = activePlan.value
    if (!plan) return
    const durationDays = normalizeImportDurationDays(input.durationDays, input.days.length, input.title)
    if (durationDays > plan.plannerState.days.length) {
      const nextEnd = new Date(plan.metadata.endAt)
      nextEnd.setDate(nextEnd.getDate() + durationDays - plan.plannerState.days.length)
      plan.metadata.endAt = nextEnd.toISOString()
      plan.plannerState = prunePlannerBudget(reconcilePlannerRange(plan.plannerState, plan.metadata.startAt, plan.metadata.endAt))
    }
    importIntoState(plan.plannerState, input, false)
    plan.metadata.updatedAt = new Date().toISOString()
    hydrating = true
    planner.loadState(clone(plan.plannerState), cloneRouteCache(plan.routeCache))
    queueMicrotask(() => { hydrating = false })
    persist()
    pushPlanNow(clone(plan)).catch(() => {})
    planner.notify('AI 行程草稿已合并到当前计划')
  }

  function deletePlan(id: string): void {
    const index = plans.value.findIndex((plan) => plan.metadata.id === id)
    if (index < 0) return
    const [removed] = plans.value.splice(index, 1)
    recycleBin.value.unshift({ id: `deleted_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`, deletedAt: new Date().toISOString(), record: clone(removed) })
    recycleBin.value = recycleBin.value.slice(0, 30)
    if (activePlanId.value === id) activePlanId.value = null
    // 删除前先按当前还没被 untrack 的 tracked id 断开协作连接：
    // deleteSharedPlanIfTracked() 里会同步地把这个计划从"已分享"的追踪表
    // 里摘掉，摘掉之后 activePlanId 变化触发的那个协作连接 watcher 就再也
    // 查不到这个计划的 shared_plans id 了，没法自己断开，这里提前处理掉。
    const sharedIdBeforeDelete = getTrackedSharedPlanId(id)
    if (sharedIdBeforeDelete != null) disconnectPlanCollab(sharedIdBeforeDelete)
    persist(); persistAuxiliary()
    // 把这个计划标记成"已删除"同步给服务器，别的设备下次同步时才会跟着删掉，
    // 而不是反过来把这台设备删掉的计划又推送回去。
    deleteSyncedPlan(id).catch(() => {})
    // 如果这个计划之前分享给过别人，把服务器上那份分享快照和授权也一起
    // 删掉，不然对方会一直看到一份不会再更新的“僵尸”计划。
    deleteSharedPlanIfTracked(id).catch(() => {})
    forgetPlan(id)
    planner.notify(`已将“${removed.metadata.name}”移入回收站`)
  }

  function restoreDeleted(recycleId: string): void {
    const index = recycleBin.value.findIndex((item) => item.id === recycleId)
    if (index < 0) return
    const [item] = recycleBin.value.splice(index, 1)
    const record = clone(item.record)
    if (plans.value.some((plan) => plan.metadata.id === record.metadata.id)) record.metadata.id = `plan_restored_${Date.now().toString(36)}`
    record.metadata.updatedAt = new Date().toISOString()
    plans.value.push(record)
    persist(); persistAuxiliary()
    pushPlanNow(clone(record)).catch(() => {})
    planner.notify(`已恢复“${record.metadata.name}”`)
  }

  function permanentlyDelete(recycleId: string): void {
    recycleBin.value = recycleBin.value.filter((item) => item.id !== recycleId)
    persistAuxiliary()
  }

  function restoreVersion(versionId: string): void {
    const version = versions.value.find((item) => item.id === versionId)
    if (!version) return
    const index = plans.value.findIndex((plan) => plan.metadata.id === version.planId)
    if (index < 0) return
    captureVersion(plans.value[index], '恢复历史版本前', true)
    plans.value.splice(index, 1, clone(version.record))
    plans.value[index].metadata.updatedAt = new Date().toISOString()
    if (activePlanId.value === version.planId) planner.loadState(clone(plans.value[index].plannerState), cloneRouteCache(plans.value[index].routeCache))
    persist()
    pushPlanNow(clone(plans.value[index])).catch(() => {})
    planner.notify(`已恢复“${version.planName}”的历史版本`)
  }

  function saveCurrent(): void {
    if (!activePlan.value) return
    activePlan.value.plannerState = planner.exportState()
    activePlan.value.routeCache = cloneRouteCache(planner.routeCache)
    activePlan.value.metadata.updatedAt = new Date().toISOString()
    persist()
    notifyPlanPersisted(clone(activePlan.value))
    pushPlanNow(clone(activePlan.value)).catch(() => {})
    planner.notify('计划已保存')
  }

  // 全部计划跨设备同步：拉服务器上这个账号的完整计划列表，跟本地的
  // plans.value 逐个比对合并。用 sync/allPlansSync.ts 里记的账本判断"服务器
  // 变了吗"和"本地变了吗"，不直接比较两边的时间戳（格式和时钟都不一样）。
  // 应用启动、窗口重新获得焦点、以及一个后台定时器都会调用这个函数。
  async function syncWithServer(): Promise<void> {
    let rows
    try {
      rows = await listSyncedPlans()
    } catch {
      return
    }
    const serverIds = new Set(rows.map((row) => row.clientPlanId))
    let changed = false

    for (const row of rows) {
      const localIndex = plans.value.findIndex((plan) => plan.metadata.id === row.clientPlanId)
      const bookkeeping = getBookkeeping(row.clientPlanId)

      if (row.deleted) {
        if (localIndex >= 0) {
          const [removed] = plans.value.splice(localIndex, 1)
          recycleBin.value.unshift({ id: `deleted_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`, deletedAt: new Date().toISOString(), record: clone(removed) })
          recycleBin.value = recycleBin.value.slice(0, 30)
          if (activePlanId.value === row.clientPlanId) {
            const wasOpen = view.value === 'planner'
            activePlanId.value = null
            if (wasOpen) { view.value = 'home'; updatePlanLocation(null, 'none') }
            // 正在看着的计划被别的设备删掉了，不能什么都不说就把人弹回首页——
            // 不然看起来像是出了故障。已经备份进回收站，提示一下就好。
            if (wasOpen) planner.notify(`"${removed.metadata.name}" 在别的设备上被删除，已为你返回首页；这份计划还在回收站里`)
          }
          forgetPlan(row.clientPlanId)
          changed = true
        }
        continue
      }

      const remote = row.record as PlanRecord
      if (localIndex < 0) {
        plans.value.push(clone(remote))
        recordServerAdopted(row.clientPlanId, row.updatedAt, remote.metadata.updatedAt)
        changed = true
        continue
      }

      const local = plans.value[localIndex]
      const serverChanged = !bookkeeping || row.updatedAt !== bookkeeping.serverUpdatedAt
      const localChangedSincePush = !bookkeeping || local.metadata.updatedAt !== bookkeeping.pushedLocalUpdatedAt

      if (serverChanged && !localChangedSincePush) {
        plans.value.splice(localIndex, 1, clone(remote))
        recordServerAdopted(row.clientPlanId, row.updatedAt, remote.metadata.updatedAt)
        if (activePlanId.value === row.clientPlanId) {
          hydrating = true
          planner.loadState(clone(remote.plannerState), cloneRouteCache(remote.routeCache))
          queueMicrotask(() => { hydrating = false })
        }
        changed = true
      } else if (!serverChanged && localChangedSincePush) {
        pushPlanNow(clone(local)).catch(() => {})
      } else if (serverChanged && localChangedSincePush) {
        // 两边都变了：正在打开的这份以本地为准（当前操作优先，视为还没
        // 来得及推送），其余的以服务器为准（假设是别的设备上更新的）。
        // 采用服务器版本前，先把这份本地改动存进回收站——不然如果这份
        // 本地改动只是因为上次推送失败才卡在本地没同步上去，直接采用
        // 服务器版本会把它悄悄丢掉。存进回收站至少还能手动找回来。
        if (activePlanId.value === row.clientPlanId) {
          pushPlanNow(clone(local)).catch(() => {})
        } else {
          recycleBin.value.unshift({
            id: `conflict_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
            deletedAt: new Date().toISOString(),
            record: clone(local),
          })
          recycleBin.value = recycleBin.value.slice(0, 30)
          plans.value.splice(localIndex, 1, clone(remote))
          recordServerAdopted(row.clientPlanId, row.updatedAt, remote.metadata.updatedAt)
          planner.notify(`“${local.metadata.name}”在别的设备上也有更新，已采用较新的版本；你在本机的改动备份到了回收站`)
          changed = true
        }
      }
    }

    // 本地有、服务器完全没见过的计划（比如刚创建时推送失败）→ 补推一次
    for (const plan of plans.value) {
      if (!serverIds.has(plan.metadata.id)) pushPlanNow(clone(plan)).catch(() => {})
    }

    if (changed) { persist(); persistAuxiliary() }
  }

  watch(
    () => ({
      days: planner.days,
      selectedDay: planner.selectedDayId,
      selectedPlace: planner.selectedPlaceId,
      poolOpen: planner.poolOpen,
      satellite: planner.satellite,
      categoryFilter: planner.categoryFilter,
      known: planner.known,
      placeAddedAt: planner.placeAddedAt,
      places: planner.places,
      routeCache: planner.routeCache,
      budget: planner.budget,
    }),
    syncDraft,
    { deep: true },
  )

  return {
    plans,
    versions,
    recycleBin,
    sortedPlans,
    activePlanId,
    activePlan,
    view,
    openingPlan,
    saveState,
    lastSavedAt,
    openPlan,
    createBackup,
    inspectBackup,
    importBackup,
    ensureDemoPlan,
    goHome,
    createPlan,
    rangeReductionImpact,
    updatePlan,
    createPlanFromAiImport,
    mergeAiImportIntoCurrent,
    deletePlan,
    restoreDeleted,
    permanentlyDelete,
    restoreVersion,
    saveCurrent,
    syncWithServer,
  }
})

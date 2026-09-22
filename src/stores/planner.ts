import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import { calculateBudgetSummary, defaultBudgetState, normalizeBudgetState, segmentExpenseOwnerId } from '../domain/budget'
import { basePlaces, createBaseDays, createStop } from '../domain/data'
import { CURRENT_PLANNER_SCHEMA_VERSION } from '../domain/migrations'
import { createPlaceAddedAt, normalizePlaceAddedAt, prunePlannerBudget } from '../domain/plans'
import { encodeRoutePath } from '../domain/polyline'
import { buildPlanRouteProjection, nextPlanStop, previousPlanStop } from '../domain/routeProjection'
import { formatDuration, scheduleDay } from '../domain/schedule'
import { routeCacheKeyIncludesPlace, transportModeMeta, transportModeOf, transportRouteCacheKey } from '../domain/transport'
import type { AiRouteDayArrangement } from '../ai/types'
import type { BudgetSettings, BudgetState, ExpenseItem, PersistedPlannerState, Place, PlaceCategory, OvernightMode, PlacePriority, RouteCache, RouteOption, Stop, TransportMode, TripDay } from '../domain/types'

interface BusinessSnapshot {
  days: TripDay[]
  customPlaces: Record<string, Place>
  known: string[]
  placeAddedAt: Record<string, number>
  budget: BudgetState
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function defaultState(): PersistedPlannerState {
  const known = Object.keys(basePlaces)
  return {
    schemaVersion: CURRENT_PLANNER_SCHEMA_VERSION,
    days: createBaseDays(),
    selectedDay: 'd2',
    selectedPlace: null,
    poolOpen: true,
    satellite: false,
    categoryFilter: 'all',
    customPlaces: {},
    known,
    placeAddedAt: createPlaceAddedAt(known),
    demo: 2,
    budget: defaultBudgetState(),
  }
}

function loadPlannerState(): PersistedPlannerState {
  const fallback = defaultState()
  try {
    const raw = localStorage.getItem('interactiveTravel.continuousPlanner.v1')
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<PersistedPlannerState>
    const known = saved.known ?? fallback.known
    return {
      ...fallback,
      ...saved,
      customPlaces: saved.customPlaces ?? {},
      known,
      placeAddedAt: normalizePlaceAddedAt(known, saved.placeAddedAt),
      budget: normalizeBudgetState(saved.budget),
    } as PersistedPlannerState
  } catch {
    return fallback
  }
}

function loadRouteCache(): RouteCache {
  try {
    return JSON.parse(localStorage.getItem('interactiveTravel.continuousRoutes.v1') ?? '{}') as RouteCache
  } catch {
    return {}
  }
}

export const usePlannerStore = defineStore('planner', () => {
  const initial = loadPlannerState()
  const days = ref<TripDay[]>(initial.days)
  const selectedDayId = ref(initial.selectedDay)
  const selectedPlaceId = ref<string | null>(initial.selectedPlace)
  const selectedSegmentUid = ref<string | null>(null)
  const previewRouteOptionId = ref<string | null>(null)
  const poolOpen = ref(initial.poolOpen)
  const satellite = ref(initial.satellite)
  const categoryFilter = ref<PlaceCategory | 'all'>(initial.categoryFilter)
  const demo = ref(initial.demo)
  const customPlaces = reactive<Record<string, Place>>(initial.customPlaces)
  const known = ref(initial.known.filter((id) => basePlaces[id] || initial.customPlaces[id]))
  const placeAddedAt = reactive<Record<string, number>>(normalizePlaceAddedAt(known.value, initial.placeAddedAt))
  const routeCache = reactive<RouteCache>(loadRouteCache())
  const budget = reactive<BudgetState>(normalizeBudgetState(initial.budget))
  const history = ref<BusinessSnapshot[]>([])
  const future = ref<BusinessSnapshot[]>([])
  const toast = ref('')
  let toastTimer = 0
  // 查看别人以"只读"权限分享的计划时会置为 true：execute()/undo()/redo() 会
  // 直接拒绝真正修改数据，不管是被哪个界面控件触发的。
  const readOnly = ref(false)

  function setReadOnly(value: boolean): void {
    readOnly.value = value
  }

  const places = computed<Record<string, Place>>(() => ({ ...basePlaces, ...customPlaces }))
  const selectedDay = computed(() => days.value.find((day) => day.id === selectedDayId.value) ?? days.value[0])
  const currentSchedule = computed(() => scheduleDay(selectedDay.value, places.value, routeCache, previousPlanStop(days.value, selectedDay.value.id)))
  const allScheduledIds = computed(() => new Set(days.value.flatMap((day) => day.stops.map((stop) => stop.placeId))))
  const overall = computed(() => {
    const warnedDays = days.value
      .map((day) => ({ day, schedule: scheduleDay(day, places.value, routeCache, previousPlanStop(days.value, day.id)) }))
      .filter(({ schedule }) => !schedule.ok)
    const missing = known.value
      .map((id) => places.value[id])
      .filter((place): place is Place => Boolean(place))
      .filter((place) => place.priority === 'must' && !allScheduledIds.value.has(place.id))
    return { warnedDays, missing, ok: warnedDays.length === 0 && missing.length === 0 }
  })
  const budgetSummaryBase = computed(() => calculateBudgetSummary({
    days: days.value,
    selectedDay: selectedDayId.value,
    selectedPlace: selectedPlaceId.value,
    poolOpen: poolOpen.value,
    satellite: satellite.value,
    categoryFilter: categoryFilter.value,
    customPlaces,
    known: known.value,
    placeAddedAt,
    demo: demo.value,
    budget,
  }, places.value, routeCache, 1))

  function candidatePlaces(query = ''): Place[] {
    const keyword = query.trim()
    return known.value
      .map((id) => places.value[id])
      .filter((place): place is Place => Boolean(place))
      .filter((place) => !allScheduledIds.value.has(place.id))
      .filter((place) => !keyword || place.name.includes(keyword) || place.type.includes(keyword))
  }

  function exportState(): PersistedPlannerState {
    return clone({
      schemaVersion: CURRENT_PLANNER_SCHEMA_VERSION,
      days: days.value,
      selectedDay: selectedDayId.value,
      selectedPlace: selectedPlaceId.value,
      poolOpen: poolOpen.value,
      satellite: satellite.value,
      categoryFilter: categoryFilter.value,
      customPlaces,
      known: known.value,
      placeAddedAt,
      demo: demo.value,
      budget,
    })
  }

  function loadState(next: PersistedPlannerState, nextRouteCache: RouteCache = {}): void {
    days.value = clone(next.days)
    selectedDayId.value = next.selectedDay
    selectedPlaceId.value = next.selectedPlace
    poolOpen.value = next.poolOpen
    satellite.value = next.satellite
    categoryFilter.value = next.categoryFilter
    demo.value = next.demo
    Object.keys(customPlaces).forEach((key) => delete customPlaces[key])
    Object.assign(customPlaces, clone(next.customPlaces ?? {}))
    known.value = clone(next.known).filter((id) => basePlaces[id] || customPlaces[id])
    Object.keys(placeAddedAt).forEach((key) => delete placeAddedAt[key])
    Object.assign(placeAddedAt, normalizePlaceAddedAt(known.value, next.placeAddedAt))
    const nextBudget = normalizeBudgetState(prunePlannerBudget(next).budget)
    budget.settings = nextBudget.settings
    budget.expenses = nextBudget.expenses
    Object.keys(routeCache).forEach((key) => delete routeCache[key])
    Object.assign(routeCache, clone(nextRouteCache))
    history.value = []
    future.value = []
  }

  function notify(message: string): void {
    toast.value = message
    window.clearTimeout(toastTimer)
    toastTimer = window.setTimeout(() => {
      toast.value = ''
    }, 2400)
  }

  function businessSnapshot(): BusinessSnapshot {
    return clone({ days: days.value, customPlaces, known: known.value, placeAddedAt, budget })
  }

  function restore(snapshot: BusinessSnapshot): void {
    days.value = clone(snapshot.days)
    Object.keys(customPlaces).forEach((key) => delete customPlaces[key])
    Object.assign(customPlaces, clone(snapshot.customPlaces))
    known.value = clone(snapshot.known)
    Object.keys(placeAddedAt).forEach((key) => delete placeAddedAt[key])
    Object.assign(placeAddedAt, clone(snapshot.placeAddedAt))
    budget.settings = clone(snapshot.budget.settings)
    budget.expenses = clone(snapshot.budget.expenses)
  }

  function execute(label: string, mutate: () => void): void {
    if (readOnly.value) {
      notify('只读模式下无法编辑，你的修改不会被保存')
      return
    }
    const before = businessSnapshot()
    const oldSchedule = currentSchedule.value
    mutate()
    history.value.push(before)
    if (history.value.length > 40) history.value.shift()
    future.value = []
    const nextSchedule = currentSchedule.value
    let delta = ''
    if (oldSchedule.km !== nextSchedule.km || oldSchedule.travel !== nextSchedule.travel) {
      const distance = nextSchedule.km - oldSchedule.km
      const duration = nextSchedule.travel - oldSchedule.travel
      delta = ` · ${distance >= 0 ? '+' : ''}${distance} km，${duration >= 0 ? '+' : ''}${formatDuration(duration)}`
    }
    notify(label + delta)
  }

  function pruneSegmentExpenses(): void {
    const projection = buildPlanRouteProjection(days.value)
    const valid = new Set(projection.segments.map((segment) => segmentExpenseOwnerId(segment.from.stop.uid, segment.to.stop.placeId)))
    budget.expenses = budget.expenses.filter((item) => item.ownerType !== 'segment' || valid.has(item.ownerId))
    projection.nodes.forEach((node) => {
      const next = nextPlanStop(days.value, node.stop.uid)
      if (node.stop.selectedRoute && (!next || node.stop.selectedRoute.toPlaceId !== next.placeId || node.stop.selectedRoute.mode !== transportModeOf(node.stop.transportMode))) node.stop.selectedRoute = undefined
    })
  }

  function undo(): void {
    if (readOnly.value) {
      notify('只读模式下无法编辑，你的修改不会被保存')
      return
    }
    const snapshot = history.value.pop()
    if (!snapshot) return
    future.value.push(businessSnapshot())
    restore(snapshot)
    notify('已撤销上一步')
  }

  function redo(): void {
    if (readOnly.value) {
      notify('只读模式下无法编辑，你的修改不会被保存')
      return
    }
    const snapshot = future.value.pop()
    if (!snapshot) return
    history.value.push(businessSnapshot())
    restore(snapshot)
    notify('已重做')
  }

  function selectDay(id: string): void {
    selectedDayId.value = id
    selectedPlaceId.value = null
    window.setTimeout(() => document.querySelector(`[data-day-section="${id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 30)
  }

  function setPreviewRouteOption(id: string | null): void { previewRouteOptionId.value = id }

  function selectSegment(uid: string | null): void {
    selectedSegmentUid.value = uid
    if (!uid) return
    const located = locateStop(uid)
    if (!located) return
    selectedDayId.value = located.day.id
    window.setTimeout(() => document.querySelector(`[data-segment-uid="${uid}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30)
  }

  function selectPlace(id: string | null): void {
    selectedPlaceId.value = id
    if (id) {
      window.setTimeout(() => {
        document.querySelector(`[data-place="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }, 30)
    }
  }

  function locateStop(uid: string): { day: TripDay; index: number; stop: Stop } | null {
    for (const day of days.value) {
      const index = day.stops.findIndex((stop) => stop.uid === uid)
      if (index >= 0) return { day, index, stop: day.stops[index] }
    }
    return null
  }

  function locatePlaceStop(placeId: string): { day: TripDay; index: number; stop: Stop } | null {
    for (const day of days.value) {
      const index = day.stops.findIndex((stop) => stop.placeId === placeId)
      if (index >= 0) return { day, index, stop: day.stops[index] }
    }
    return null
  }

  function movePlaceExpensesToStop(placeId: string, stopUid: string): void {
    budget.expenses.forEach((item) => {
      if (item.ownerType === 'place' && item.ownerId === placeId) {
        item.ownerType = 'stop'
        item.ownerId = stopUid
      }
    })
  }

  function moveStopExpensesToPlace(stopUid: string, placeId: string): void {
    budget.expenses.forEach((item) => {
      if (item.ownerType === 'stop' && item.ownerId === stopUid) {
        item.ownerType = 'place'
        item.ownerId = placeId
      }
    })
  }

  function addPlace(placeId: string, dayId = selectedDayId.value, index?: number): void {
    const day = days.value.find((item) => item.id === dayId)
    const place = places.value[placeId]
    if (!day || !place) return
    execute(`已加入 ${day.label}`, () => {
      const stop = createStop(placeId, place.category === 'lodging' ? 0 : 60)
      if (index === undefined) day.stops.push(stop)
      else day.stops.splice(index, 0, stop)
      movePlaceExpensesToStop(placeId, stop.uid)
      selectedDayId.value = dayId
      selectedPlaceId.value = placeId
      pruneSegmentExpenses()
    })
  }

  function removeStop(uid: string): void {
    const located = locateStop(uid)
    if (!located) return
    execute('已移回未安排地点', () => {
      located.day.stops.splice(located.index, 1)
      moveStopExpensesToPlace(located.stop.uid, located.stop.placeId)
      pruneSegmentExpenses()
      selectedPlaceId.value = located.stop.placeId
    })
  }

  function moveStop(uid: string, targetDayId: string, targetIndex: number): void {
    const located = locateStop(uid)
    const target = days.value.find((day) => day.id === targetDayId)
    if (!located || !target) return
    execute('已调整行程顺序', () => {
      located.day.stops.splice(located.index, 1)
      let index = targetIndex
      if (located.day.id === targetDayId && located.index < targetIndex) index -= 1
      target.stops.splice(Math.max(0, index), 0, located.stop)
      selectedDayId.value = targetDayId
      selectedPlaceId.value = located.stop.placeId
      pruneSegmentExpenses()
    })
  }

  function applyAiRouteArrangement(arrangements: AiRouteDayArrangement[], returnToPoolStopUids: string[], validatedRouteCache: RouteCache): void {
    const stopByUid = new Map(days.value.flatMap((day) => day.stops).map((stop) => [stop.uid, stop]))
    const arrangedUids = arrangements.flatMap((item) => item.stopUids)
    const allUids = [...arrangedUids, ...returnToPoolStopUids]
    const validDayIds = new Set(days.value.map((day) => day.id))
    if (allUids.length !== stopByUid.size || new Set(allUids).size !== stopByUid.size || allUids.some((uid) => !stopByUid.has(uid))) return
    if (arrangements.length !== days.value.length || new Set(arrangements.map((item) => item.dayId)).size !== days.value.length || arrangements.some((item) => !validDayIds.has(item.dayId))) return
    if (returnToPoolStopUids.some((uid) => places.value[stopByUid.get(uid)!.placeId]?.priority === 'must')) return
    execute('已应用 AI 路线调整', () => {
      returnToPoolStopUids.forEach((uid) => {
        const stop = stopByUid.get(uid)
        if (stop) moveStopExpensesToPlace(stop.uid, stop.placeId)
      })
      const arrangementByDay = new Map(arrangements.map((item) => [item.dayId, item.stopUids]))
      days.value.forEach((day) => {
        const uids = arrangementByDay.get(day.id)
        if (uids) day.stops = uids.map((uid) => stopByUid.get(uid)).filter((stop): stop is Stop => Boolean(stop))
      })
      Object.assign(routeCache, clone(validatedRouteCache))
      pruneSegmentExpenses()
      selectedPlaceId.value = null
    })
  }

  function setDayOvernightMode(dayId: string, mode: OvernightMode): void {
    const day = days.value.find((item) => item.id === dayId)
    if (!day || day.overnightMode === mode) return
    execute(`${day.label} 住宿方式已更新`, () => { day.overnightMode = mode })
  }

  function setDayMaxDrive(dayId: string, minutes: number): void {
    const day = days.value.find((item) => item.id === dayId)
    if (!day) return
    const normalized = Math.max(30, Math.min(1440, Math.round(minutes)))
    if (day.maxDrive === normalized) return
    execute(`${day.label} 驾驶上限已设为 ${formatDuration(normalized)}`, () => {
      day.maxDrive = normalized
    })
  }

  function setStopTransportMode(uid: string, mode: TransportMode): void {
    const located = locateStop(uid)
    const next = nextPlanStop(days.value, uid)
    if (!located || !next) return
    const currentMode = transportModeOf(located.stop.transportMode)
    if (currentMode === mode) return
    execute(`交通方式已改为${transportModeMeta[mode].label}`, () => {
      const nextPlaceId = next.placeId
      const expenseOwnerId = segmentExpenseOwnerId(located.stop.uid, nextPlaceId)
      budget.expenses.forEach((item) => {
        if (item.ownerType !== 'segment' || item.ownerId !== expenseOwnerId) return
        item.transportMode = mode
        item.status = 'unknown'
        const warning = `交通方式已从${transportModeMeta[currentMode].label}改为${transportModeMeta[mode].label}，原价格需重新核对`
        if (!item.note?.includes(warning)) item.note = item.note ? `${warning}；${item.note}` : warning
      })
      located.stop.transportMode = mode
      located.stop.transportDuration = null
      located.stop.transportDistance = null
      located.stop.selectedRoute = undefined
      located.stop.routePreference = undefined
    })
  }

  function setStopRouteOption(uid: string, option: RouteOption, preference: Stop['routePreference'] = 'recommended'): void {
    const located = locateStop(uid)
    const next = nextPlanStop(days.value, uid)
    if (!located || !next) return
    const mode = transportModeOf(located.stop.transportMode)
    if (option.fromPlaceId !== located.stop.placeId || option.toPlaceId !== next.placeId || option.mode !== mode) return
    execute(`已选择${option.strategyLabel}`, () => {
      const { path, ...snapshot } = option
      located.stop.routePreference = preference ?? 'recommended'
      located.stop.selectedRoute = { ...snapshot, encodedPath: encodeRoutePath(path), selectedAt: new Date().toISOString() }
      const key = transportRouteCacheKey(option.fromPlaceId, option.toPlaceId, option.mode)
      routeCache[key] = option.toll == null ? [option.distanceKm, option.durationMinutes] : [option.distanceKm, option.durationMinutes, option.toll]
      const ownerId = segmentExpenseOwnerId(located.stop.uid, next.placeId)
      budget.expenses.forEach((item) => {
        if (item.ownerType !== 'segment' || item.ownerId !== ownerId) return
        item.status = 'unknown'
        const warning = '地图路线方案已切换，原价格需重新核对'
        if (!item.note?.includes(warning)) item.note = item.note ? `${warning}；${item.note}` : warning
      })
    })
  }

  function setDayRouteOptions(dayId: string, selections: Array<{ uid: string; option: RouteOption; preference?: Stop['routePreference'] }>): void {
    const day = days.value.find((item) => item.id === dayId)
    if (!day || !selections.length) return
    execute(`${day.label} 路线偏好已应用`, () => {
      selections.forEach(({ uid, option, preference }) => {
        const index = day.stops.findIndex((stop) => stop.uid === uid)
        const stop = day.stops[index]
        const next = day.stops[index + 1]
        if (!stop || !next || option.fromPlaceId !== stop.placeId || option.toPlaceId !== next.placeId || option.mode !== transportModeOf(stop.transportMode)) return
        const { path, ...snapshot } = option
        stop.routePreference = preference ?? 'recommended'
        stop.selectedRoute = { ...snapshot, encodedPath: encodeRoutePath(path), selectedAt: new Date().toISOString() }
        const key = transportRouteCacheKey(option.fromPlaceId, option.toPlaceId, option.mode)
        routeCache[key] = option.toll == null ? [option.distanceKm, option.durationMinutes] : [option.distanceKm, option.durationMinutes, option.toll]
        const ownerId = segmentExpenseOwnerId(stop.uid, next.placeId)
        budget.expenses.forEach((item) => {
          if (item.ownerType !== 'segment' || item.ownerId !== ownerId) return
          item.status = 'unknown'
          const warning = '地图路线方案已切换，原价格需重新核对'
          if (!item.note?.includes(warning)) item.note = item.note ? `${warning}；${item.note}` : warning
        })
      })
    })
  }

  function setStopManualTransport(uid: string, duration: number, distance: number | null, schedule?: Pick<Stop, 'transportNumber' | 'transportFrom' | 'transportTo' | 'transportDepartureTime' | 'transportArrivalTime' | 'transportAdvanceMinutes' | 'transportTicketStatus' | 'transportTicketNote'>): void {
    const located = locateStop(uid)
    const next = nextPlanStop(days.value, uid)
    if (!located || !next) return
    const mode = transportModeOf(located.stop.transportMode)
    if (transportModeMeta[mode].automatic) return
    const normalizedDuration = Math.max(1, Math.round(duration))
    const normalizedDistance = distance == null ? null : Math.max(0, Math.round(distance))
    execute(`${transportModeMeta[mode].label}用时已设置为 ${formatDuration(normalizedDuration)}`, () => {
      located.stop.transportDuration = normalizedDuration
      located.stop.transportDistance = normalizedDistance
      if (schedule) Object.assign(located.stop, {
        transportNumber: schedule.transportNumber?.trim() || undefined,
        transportFrom: schedule.transportFrom?.trim() || undefined,
        transportTo: schedule.transportTo?.trim() || undefined,
        transportDepartureTime: schedule.transportDepartureTime ?? null,
        transportArrivalTime: schedule.transportArrivalTime ?? null,
        transportAdvanceMinutes: schedule.transportAdvanceMinutes ?? null,
        transportTicketStatus: schedule.transportTicketStatus ?? 'none',
        transportTicketNote: schedule.transportTicketNote?.trim() || undefined,
      })
    })
  }

  function setStopTime(uid: string, field: 'arrival' | 'departure', minutes: number): void {
    const located = locateStop(uid)
    if (!located) return
    execute(field === 'arrival' ? '已修改到达时间' : '已修改离开时间', () => {
      const current = scheduleDay(located.day, places.value, routeCache, previousPlanStop(days.value, located.day.id)).rows[located.index]
      if (field === 'arrival') {
        located.stop.arrivalTime = minutes
        located.stop.pinned = minutes
        if (located.stop.departureTime === undefined || located.stop.departureTime === null) {
          located.stop.departureTime = minutes + located.stop.stay
        }
      } else {
        located.stop.departureTime = minutes
        const arrival = located.stop.arrivalTime ?? located.stop.pinned ?? current.arrival
        if (minutes >= arrival) located.stop.stay = minutes - arrival
      }
    })
  }

  function resetStopTimes(uid: string): void {
    const located = locateStop(uid)
    if (!located) return
    execute('已恢复自动推导时间', () => {
      located.stop.arrivalTime = null
      located.stop.departureTime = null
      located.stop.pinned = null
    })
  }

  function nextPlaceAddedAt(offset = 0): number {
    const latest = Math.max(0, ...Object.values(placeAddedAt))
    return Math.max(Date.now(), latest + 1) + offset
  }

  function addCustomPlace(place: Place): void {
    const isNew = !known.value.includes(place.id)
    const addedAt = nextPlaceAddedAt()
    execute(`已将“${place.name}”加入未安排地点池`, () => {
      customPlaces[place.id] = place
      if (isNew) {
        known.value.push(place.id)
        placeAddedAt[place.id] = addedAt
      } else if (!placeAddedAt[place.id]) {
        placeAddedAt[place.id] = addedAt
      }
      selectedPlaceId.value = place.id
    })
  }

  function addPickedPlace(place: Place, targetDayId: string | null, selectAfterAdd = true): void {
    const existing = Object.values(places.value).find((item) =>
      (place.providerId && item.providerId === place.providerId)
      || (item.name === place.name && Math.hypot(item.lng - place.lng, item.lat - place.lat) < 0.002))
    const resolved = existing ?? place
    const targetDay = targetDayId ? days.value.find((day) => day.id === targetDayId) : null
    const addedAt = nextPlaceAddedAt()
    execute(targetDay ? `已将“${resolved.name}”加入 ${targetDay.label}` : `已将“${resolved.name}”加入未安排地点`, () => {
      if (!basePlaces[resolved.id]) customPlaces[resolved.id] = resolved
      if (!known.value.includes(resolved.id)) {
        known.value.push(resolved.id)
        placeAddedAt[resolved.id] = addedAt
      }
      if (targetDay && !targetDay.stops.some((stop) => stop.placeId === resolved.id)) {
        const stop = createStop(resolved.id, resolved.category === 'lodging' ? 0 : 60)
        targetDay.stops.push(stop)
        movePlaceExpensesToStop(resolved.id, stop.uid)
        selectedDayId.value = targetDay.id
      }
      if (selectAfterAdd) selectedPlaceId.value = resolved.id
      pruneSegmentExpenses()
    })
  }

  function getBudgetSummary(participantCount = 1) {
    const summary = budgetSummaryBase.value
    const normalizedCount = Math.max(1, participantCount)
    return normalizedCount === 1 ? summary : { ...summary, perPerson: summary.totalExpected / normalizedCount }
  }

  function expensesForOwner(ownerType: ExpenseItem['ownerType'], ownerId: string): ExpenseItem[] {
    return budget.expenses.filter((item) => item.ownerType === ownerType && item.ownerId === ownerId)
  }

  function updateBudgetSettings(settings: BudgetSettings): void {
    execute('预算参数已更新', () => { budget.settings = normalizeBudgetState({ settings, expenses: [] }).settings })
  }

  function upsertExpense(item: ExpenseItem): void {
    const normalized = normalizeBudgetState({ settings: budget.settings, expenses: [{ ...item, updatedAt: new Date().toISOString() }] }).expenses[0]
    const index = budget.expenses.findIndex((expense) => expense.id === item.id)
    execute(index >= 0 ? `已更新费用“${item.name}”` : `已添加费用“${item.name}”`, () => {
      if (index >= 0) budget.expenses.splice(index, 1, normalized)
      else budget.expenses.push(normalized)
    })
  }

  function deleteExpense(expenseId: string): void {
    const index = budget.expenses.findIndex((item) => item.id === expenseId)
    if (index < 0) return
    const name = budget.expenses[index].name
    execute(`已删除费用“${name}”`, () => { budget.expenses.splice(index, 1) })
  }

  function updatePlacePlanningInfo(placeId: string, note: string, altitude: number | null, rules?: Pick<Place, 'openingTime' | 'lastEntryTime' | 'closingTime' | 'reservationRequired' | 'reservationStatus' | 'reservationNote'>): void {
    const place = places.value[placeId]
    if (!place) return
    const normalizedNote = note.trim()
    const normalizedAltitude = altitude == null || !Number.isFinite(altitude) ? undefined : Math.max(-500, Math.min(9000, Math.round(altitude)))
    execute(`已更新“${place.name}”的规划信息`, () => {
      customPlaces[placeId] = { ...place, userNote: normalizedNote || undefined, altitude: normalizedAltitude, ...rules, reservationNote: rules?.reservationNote?.trim() || undefined }
    })
  }

  function setPlacePriority(placeId: string, priority: PlacePriority): void {
    const place = places.value[placeId]
    if (!place || place.priority === priority) return
    const label = priority === 'must' ? '必去' : priority === 'backup' ? '备选' : '想去'
    execute(`已将“${place.name}”设为${label}`, () => {
      customPlaces[placeId] = { ...place, priority }
    })
  }

  function clearCandidatePlaces(): void {
    const candidateIds = candidatePlaces().map((place) => place.id)
    if (!candidateIds.length) return
    const removing = new Set(candidateIds)
    execute(`已清空 ${candidateIds.length} 个未安排地点`, () => {
      known.value = known.value.filter((id) => !removing.has(id))
      candidateIds.forEach((placeId) => {
        delete customPlaces[placeId]
        delete placeAddedAt[placeId]
      })
      budget.expenses = budget.expenses.filter((item) => !(item.ownerType === 'place' && removing.has(item.ownerId)))
      if (selectedPlaceId.value && removing.has(selectedPlaceId.value)) selectedPlaceId.value = null
    })
  }

  function deleteCandidatePlace(placeId: string): void {
    const place = places.value[placeId]
    if (!place) return
    if (allScheduledIds.value.has(placeId)) {
      notify('请先将地点移回未安排地点，再执行删除')
      return
    }

    execute(`已从未安排地点删除“${place.name}”`, () => {
      known.value = known.value.filter((id) => id !== placeId)
      delete customPlaces[placeId]
      delete placeAddedAt[placeId]
      budget.expenses = budget.expenses.filter((item) => !(item.ownerType === 'place' && item.ownerId === placeId))
      if (selectedPlaceId.value === placeId) selectedPlaceId.value = null
      Object.keys(routeCache)
        .filter((key) => routeCacheKeyIncludesPlace(key, placeId))
        .forEach((key) => delete routeCache[key])
    })
  }

  function batchAddNames(names: string[]): void {
    const ids = names
      .map((name) => Object.values(places.value).find((place) => place.name.includes(name) || name.includes(place.name))?.id)
      .filter((id): id is string => Boolean(id))
      .filter((id) => !known.value.includes(id))
    const addedAt = nextPlaceAddedAt()
    execute(`已批量加入 ${ids.length} 个地点`, () => {
      known.value.push(...ids)
      ids.forEach((id, index) => { placeAddedAt[id] = addedAt + index })
    })
  }

  function moveCandidatePlace(placeId: string, targetPlaceId: string, position: 'before' | 'after'): void {
    if (placeId === targetPlaceId) return
    const sourceIndex = known.value.indexOf(placeId)
    const originalTargetIndex = known.value.indexOf(targetPlaceId)
    if (sourceIndex < 0 || originalTargetIndex < 0) return

    execute('已调整未安排地点顺序', () => {
      known.value.splice(sourceIndex, 1)
      const targetIndex = known.value.indexOf(targetPlaceId)
      known.value.splice(targetIndex + (position === 'after' ? 1 : 0), 0, placeId)
    })
  }

  function setRouteValue(fromId: string, toId: string, mode: TransportMode, km: number, min: number, toll?: number): void {
    const key = transportRouteCacheKey(fromId, toId, mode)
    const current = routeCache[key]
    const normalizedToll = toll == null ? undefined : Math.max(0, toll)
    const currentToll = current?.[2] == null ? undefined : current[2]
    if (current?.[0] === km && current?.[1] === min && currentToll === normalizedToll) return
    routeCache[key] = normalizedToll === undefined ? [km, min] : [km, min, normalizedToll]
  }

  function quickConflict(): void {
    const day2 = days.value.find((day) => day.id === 'd2')
    if (!day2) return
    execute('已将丹巴加入 Day 2，出现折返', () => {
      const existing = locatePlaceStop('danba')
      if (existing) existing.day.stops.splice(existing.index, 1)
      day2.stops.splice(Math.max(3, day2.stops.length - 1), 0, createStop('danba', 120))
      selectedDayId.value = 'd2'
      selectedPlaceId.value = 'danba'
      demo.value = 3
    })
  }

  function resolveConflict(): void {
    execute('已将丹巴调整到 Day 3', () => {
      const existing = locatePlaceStop('danba')
      if (existing) existing.day.stops.splice(existing.index, 1)
      const day3 = days.value.find((day) => day.id === 'd3')
      if (!day3) return
      if (!day3.stops.some((stop) => stop.placeId === 'hotel')) day3.stops.unshift(createStop('hotel', 0))
      day3.stops.push(createStop('danba', 120))
      selectedDayId.value = 'd2'
      selectedPlaceId.value = null
      demo.value = 4
    })
  }

  function setDemo(scene: number): void {
    history.value.push(businessSnapshot())
    future.value = []
    const custom = clone(customPlaces)
    const savedBudget = clone(budget)
    const next = defaultState()
    days.value = next.days
    selectedDayId.value = next.selectedDay
    selectedPlaceId.value = next.selectedPlace
    demo.value = scene
    Object.keys(customPlaces).forEach((key) => delete customPlaces[key])
    Object.assign(customPlaces, custom)
    known.value = [...new Set([...next.known, ...Object.keys(custom)])]
    Object.keys(placeAddedAt).forEach((key) => delete placeAddedAt[key])
    Object.assign(placeAddedAt, normalizePlaceAddedAt(known.value, next.placeAddedAt))
    budget.settings = savedBudget.settings
    budget.expenses = savedBudget.expenses

    if (scene === 1) {
      days.value.forEach((day) => { day.stops = [] })
      selectedDayId.value = 'd1'
      poolOpen.value = true
    } else if (scene === 3) {
      const day3 = days.value.find((day) => day.id === 'd3')
      if (day3) day3.stops = day3.stops.filter((stop) => stop.placeId !== 'danba')
      const day2 = days.value.find((day) => day.id === 'd2')
      day2?.stops.splice(Math.max(3, (day2?.stops.length ?? 1) - 1), 0, createStop('danba', 120))
      selectedDayId.value = 'd2'
      selectedPlaceId.value = 'danba'
    }

    const prunedBudget = normalizeBudgetState(prunePlannerBudget(exportState()).budget)
    budget.settings = prunedBudget.settings
    budget.expenses = prunedBudget.expenses
    notify(['', '从未安排地点开始', '拖拽地点，观察地图和时间变化', '这是一个故意制造的不可行方案', '调整后计划恢复可行'][scene] ?? '')
  }

  watch(
    [days, selectedDayId, selectedPlaceId, poolOpen, satellite, categoryFilter, customPlaces, known, placeAddedAt, budget, demo],
    () => {
      const value: PersistedPlannerState = {
        days: days.value,
        selectedDay: selectedDayId.value,
        selectedPlace: selectedPlaceId.value,
        poolOpen: poolOpen.value,
        satellite: satellite.value,
        categoryFilter: categoryFilter.value,
        customPlaces,
        known: known.value,
        placeAddedAt,
        demo: demo.value,
        budget,
      }
      localStorage.setItem('interactiveTravel.continuousPlanner.v1', JSON.stringify(value))
    },
    { deep: true },
  )

  watch(routeCache, () => {
    localStorage.setItem('interactiveTravel.continuousRoutes.v1', JSON.stringify(routeCache))
  }, { deep: true })

  return {
    days,
    selectedDayId,
    selectedPlaceId,
    selectedSegmentUid,
    previewRouteOptionId,
    poolOpen,
    satellite,
    categoryFilter,
    demo,
    places,
    known,
    placeAddedAt,
    routeCache,
    budget,
    history,
    future,
    toast,
    readOnly,
    setReadOnly,
    selectedDay,
    currentSchedule,
    allScheduledIds,
    overall,
    budgetSummaryBase,
    getBudgetSummary,
    expensesForOwner,
    candidatePlaces,
    exportState,
    loadState,
    notify,
    undo,
    redo,
    selectDay,
    selectPlace,
    selectSegment,
    setPreviewRouteOption,
    locatePlaceStop,
    addPlace,
    removeStop,
    moveStop,
    applyAiRouteArrangement,
    setDayOvernightMode,
    setDayMaxDrive,
    setStopTransportMode,
    setStopRouteOption,
    setDayRouteOptions,
    setStopManualTransport,
    setStopTime,
    resetStopTimes,
    addCustomPlace,
    addPickedPlace,
    updateBudgetSettings,
    upsertExpense,
    deleteExpense,
    setPlacePriority,
    updatePlacePlanningInfo,
    clearCandidatePlaces,
    deleteCandidatePlace,
    batchAddNames,
    moveCandidatePlace,
    setRouteValue,
    quickConflict,
    resolveConflict,
    setDemo,
  }
})

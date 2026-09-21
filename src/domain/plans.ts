import { defaultBudgetState, normalizeBudgetState, segmentExpenseOwnerId } from './budget'
import { buildPlanRouteProjection } from './routeProjection'
import type { PersistedPlannerState, PlanEditorValue, PlanRecord, RouteCache, TripDay, TripParticipant } from './types'

export function createParticipant(name = '', age: number | null = null, note = ''): TripParticipant {
  return {
    id: `participant_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    name,
    age,
    note,
  }
}

export function normalizeParticipants(value: unknown): TripParticipant[] {
  if (!Array.isArray(value)) return []
  const result: TripParticipant[] = []
  value.forEach((item, index) => {
    if (typeof item === 'string') {
      const name = item.trim()
      if (name) result.push({ id: `participant_legacy_${index}_${name.length}`, name, age: null })
      return
    }
    if (!item || typeof item !== 'object') return
    const current = item as Partial<TripParticipant>
    const name = String(current.name ?? '').trim()
    if (!name) return
    const ageValue = current.age == null ? null : Number(current.age)
    result.push({
      id: String(current.id || `participant_legacy_${index}_${name.length}`),
      name,
      age: ageValue != null && Number.isFinite(ageValue) ? Math.min(150, Math.max(0, Math.round(ageValue))) : null,
      note: current.note ? String(current.note).trim() : undefined,
    })
  })
  return result
}

function localDateParts(date: Date): { year: number; month: number; day: number } {
  return { year: date.getFullYear(), month: date.getMonth(), day: date.getDate() }
}

function dayStart(date: Date): Date {
  const value = new Date(date)
  value.setHours(0, 0, 0, 0)
  return value
}

function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function calendarDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dateAtOffset(startAt: string, index: number): Date {
  const date = dayStart(new Date(startAt))
  date.setDate(date.getDate() + index)
  return date
}

export function createDaysFromRange(startAt: string, endAt: string): TripDay[] {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const startDay = dayStart(start)
  const endDay = dayStart(end)
  const count = Math.max(1, Math.round((endDay.getTime() - startDay.getTime()) / 86_400_000) + 1)

  return Array.from({ length: count }, (_, index) => {
    const date = new Date(startDay)
    date.setDate(startDay.getDate() + index)
    return {
      id: `d${index + 1}`,
      label: `Day ${index + 1}`,
      date: `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`,
      start: index === 0 ? minutesOfDay(start) : 510,
      end: index === count - 1 ? minutesOfDay(end) : 1140,
      maxDrive: 360,
      stops: [],
    }
  })
}

export function createPlaceAddedAt(placeIds: string[], latestAt = Date.now()): Record<string, number> {
  const firstAt = latestAt - Math.max(0, placeIds.length - 1) * 1000
  return Object.fromEntries(placeIds.map((placeId, index) => [placeId, firstAt + index * 1000]))
}

export function normalizePlaceAddedAt(placeIds: string[], current?: Record<string, number>): Record<string, number> {
  const fallback = createPlaceAddedAt(placeIds)
  return Object.fromEntries(placeIds.map((placeId) => {
    const value = Number(current?.[placeId])
    return [placeId, Number.isFinite(value) && value > 0 ? value : fallback[placeId]]
  }))
}

export function createEmptyPlannerState(startAt: string, endAt: string): PersistedPlannerState {
  return {
    days: createDaysFromRange(startAt, endAt),
    selectedDay: 'd1',
    selectedPlace: null,
    poolOpen: true,
    satellite: false,
    categoryFilter: 'all',
    customPlaces: {},
    known: [],
    placeAddedAt: {},
    demo: 2,
    budget: defaultBudgetState(),
  }
}

export function prunePlannerBudget(state: PersistedPlannerState): PersistedPlannerState {
  const budget = normalizeBudgetState(state.budget)
  const dayIds = new Set(state.days.map((day) => day.id))
  const placeIds = new Set(state.known)
  const stopIds = new Set(state.days.flatMap((day) => day.stops.map((stop) => stop.uid)))
  const segmentIds = new Set(buildPlanRouteProjection(state.days).segments.map((segment) => segmentExpenseOwnerId(segment.from.stop.uid, segment.to.stop.placeId)))
  budget.expenses = budget.expenses.filter((item) => item.ownerType === 'plan'
    || (item.ownerType === 'day' && dayIds.has(item.ownerId))
    || (item.ownerType === 'place' && placeIds.has(item.ownerId))
    || (item.ownerType === 'stop' && stopIds.has(item.ownerId))
    || (item.ownerType === 'segment' && segmentIds.has(item.ownerId)))
  return { ...state, budget }
}

export function removedPlannerDays(state: PersistedPlannerState, previousStartAt: string, startAt: string, endAt: string): TripDay[] {
  const targetDateKeys = new Set(createDaysFromRange(startAt, endAt).map((_, index) => calendarDateKey(dateAtOffset(startAt, index))))
  return state.days.filter((_, index) => !targetDateKeys.has(calendarDateKey(dateAtOffset(previousStartAt, index))))
}

export function reconcilePlannerRange(state: PersistedPlannerState, startAt: string, endAt: string, previousStartAt = startAt): PersistedPlannerState {
  const targetDays = createDaysFromRange(startAt, endAt)
  const existingByDate = new Map(state.days.map((day, index) => [calendarDateKey(dateAtOffset(previousStartAt, index)), day]))
  const selectedIndex = state.days.findIndex((day) => day.id === state.selectedDay)
  const selectedDateKey = selectedIndex >= 0 ? calendarDateKey(dateAtOffset(previousStartAt, selectedIndex)) : null
  const previousDayDate = new Map(state.days.map((day, index) => [day.id, calendarDateKey(dateAtOffset(previousStartAt, index))]))
  const targetDayByDate = new Map(targetDays.map((day, index) => [calendarDateKey(dateAtOffset(startAt, index)), day.id]))
  const budget = normalizeBudgetState(state.budget)
  budget.expenses = budget.expenses.flatMap((item) => {
    if (item.ownerType !== 'day') return [item]
    const dateKey = previousDayDate.get(item.ownerId)
    const ownerId = dateKey ? targetDayByDate.get(dateKey) : undefined
    return ownerId ? [{ ...item, ownerId }] : []
  })
  let selectedDay = targetDays[0].id

  targetDays.forEach((target, index) => {
    const dateKey = calendarDateKey(dateAtOffset(startAt, index))
    const existing = existingByDate.get(dateKey)
    if (!existing) return
    target.stops = existing.stops
    target.maxDrive = existing.maxDrive
    if (index !== 0) target.start = existing.start
    if (index !== targetDays.length - 1) target.end = existing.end
    if (dateKey === selectedDateKey) selectedDay = target.id
  })

  return { ...state, days: targetDays, selectedDay, budget }
}

export function defaultPlanValue(): PlanEditorValue {
  const start = new Date()
  start.setDate(start.getDate() + 1)
  start.setHours(8, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 2)
  end.setHours(20, 0, 0, 0)
  return { name: '', startAt: start.toISOString(), endAt: end.toISOString(), participants: [], budgetLimit: null }
}

export function createPlanRecord(value: PlanEditorValue): PlanRecord {
  const now = new Date().toISOString()
  const plannerState = createEmptyPlannerState(value.startAt, value.endAt)
  plannerState.budget!.settings.limit = value.budgetLimit
  return {
    metadata: {
      id: `plan_${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
      name: value.name,
      startAt: value.startAt,
      endAt: value.endAt,
      participants: normalizeParticipants(value.participants),
      createdAt: now,
      updatedAt: now,
    },
    plannerState,
    routeCache: {},
  }
}

export function formatPlanDateTime(value: string): string {
  const date = new Date(value)
  const { year, month, day } = localDateParts(date)
  return `${year}/${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

export function toDateTimeLocal(value: string): string {
  const date = new Date(value)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 19)
}

export function cloneRouteCache(cache: RouteCache): RouteCache {
  return JSON.parse(JSON.stringify(cache)) as RouteCache
}

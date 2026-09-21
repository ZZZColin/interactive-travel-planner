import { requestStructuredOutput } from './adapters'
import type { AiProviderProfile, AiRouteOptimizationDraft, AiRouteValidation } from './types'
import { formatTime, scheduleDay, routeInfo } from '../domain/schedule'
import { transportModeMeta, transportModeOf, transportRouteCacheKey } from '../domain/transport'
import type { Place, RouteCache, RouteEstimate, Stop, TripDay } from '../domain/types'
import { localizeAiSystemPrompt } from '../i18n'

const issueCategories = ['detour', 'overlong', 'duplicate', 'imbalance', 'time-conflict', 'other'] as const
const issueSeverities = ['info', 'attention', 'warning'] as const

const routeOptimizationSchema = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'issues', 'dayArrangements', 'returnToPoolStopUids', 'reasons', 'cautions'],
  properties: {
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['category', 'severity', 'title', 'detail', 'dayIds', 'stopUids'], properties: {
      category: { type: 'string', enum: issueCategories }, severity: { type: 'string', enum: issueSeverities }, title: { type: 'string' }, detail: { type: 'string' },
      dayIds: { type: 'array', items: { type: 'string' } }, stopUids: { type: 'array', items: { type: 'string' } },
    } } },
    dayArrangements: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['dayId', 'stopUids'], properties: {
      dayId: { type: 'string' }, stopUids: { type: 'array', items: { type: 'string' } },
    } } },
    returnToPoolStopUids: { type: 'array', items: { type: 'string' } },
    reasons: { type: 'array', items: { type: 'string' } },
    cautions: { type: 'array', items: { type: 'string' } },
  },
}

export interface RouteOptimizationInput {
  planName: string
  constraints: { noDeletion: true; mustPlacesCannotReturnToPool: true; mapValidationRequired: true }
  days: Array<{
    dayId: string
    label: string
    date: string
    availableTime: string
    maxDriveMinutes: number
    metrics: { km: number; travelMinutes: number; warnings: string[] }
    stops: Array<{
      stopUid: string
      placeId: string
      providerId: string | null
      name: string
      category: string
      priority: string
      longitude: number
      latitude: number
      stayMinutes: number
      fixedArrivalMinutes: number | null
      fixedDepartureMinutes: number | null
      transportToNext: string | null
    }>
    segments: Array<{ fromStopUid: string; toStopUid: string; mode: string; km: number; minutes: number; source: string; fixedBoundary: boolean }>
  }>
}

export function buildRouteOptimizationInput(planName: string, days: TripDay[], places: Record<string, Place>, routeCache: RouteCache): RouteOptimizationInput {
  return {
    planName,
    constraints: { noDeletion: true, mustPlacesCannotReturnToPool: true, mapValidationRequired: true },
    days: days.map((day) => {
      const schedule = scheduleDay(day, places, routeCache)
      return {
        dayId: day.id,
        label: day.label,
        date: day.date,
        availableTime: `${formatTime(day.start)}-${formatTime(day.end)}`,
        maxDriveMinutes: day.maxDrive,
        metrics: { km: schedule.km, travelMinutes: schedule.travel, warnings: schedule.warnings },
        stops: day.stops.map((stop, index) => {
          const place = places[stop.placeId]
          return {
            stopUid: stop.uid,
            placeId: stop.placeId,
            providerId: place?.providerId ?? null,
            name: place?.name ?? stop.placeId,
            category: place?.category ?? 'other',
            priority: place?.priority ?? 'normal',
            longitude: place?.lng ?? 0,
            latitude: place?.lat ?? 0,
            stayMinutes: stop.stay,
            fixedArrivalMinutes: stop.arrivalTime ?? stop.pinned ?? null,
            fixedDepartureMinutes: stop.departureTime ?? null,
            transportToNext: index < day.stops.length - 1 ? transportModeOf(stop.transportMode) : null,
          }
        }),
        segments: day.stops.slice(0, -1).map((stop, index) => {
          const next = day.stops[index + 1]
          const route = routeInfo(stop, next, places, routeCache)
          const mode = transportModeOf(stop.transportMode)
          return { fromStopUid: stop.uid, toStopUid: next.uid, mode, km: route.km, minutes: route.min, source: route.source ?? 'estimate', fixedBoundary: !transportModeMeta[mode].automatic }
        }),
      }
    }),
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).map((item) => item.trim()).filter(Boolean) : []
}

export function normalizeRouteOptimizationDraft(value: any, days: TripDay[], places: Record<string, Place>): AiRouteOptimizationDraft {
  const dayIds = new Set(days.map((day) => day.id))
  const stopEntries = days.flatMap((day) => day.stops.map((stop) => ({ day, stop })))
  const stopByUid = new Map(stopEntries.map((entry) => [entry.stop.uid, entry]))
  const rawArrangements = Array.isArray(value?.dayArrangements) ? value.dayArrangements : []
  const arrangementByDay = new Map<string, string[]>()
  rawArrangements.forEach((item: any) => {
    const dayId = String(item?.dayId ?? '')
    if (!dayIds.has(dayId) || arrangementByDay.has(dayId)) return
    arrangementByDay.set(dayId, strings(item?.stopUids))
  })
  if (arrangementByDay.size !== days.length) throw new Error('AI 调整方案没有覆盖全部日期，请重新分析')

  const returnToPoolStopUids = strings(value?.returnToPoolStopUids)
  const allSuggested = [...arrangementByDay.values()].flat().concat(returnToPoolStopUids)
  const unknown = allSuggested.filter((uid) => !stopByUid.has(uid))
  if (unknown.length) throw new Error('AI 调整方案引用了不存在的地点节点，请重新分析')
  if (new Set(allSuggested).size !== allSuggested.length) throw new Error('AI 调整方案中存在重复地点节点，请重新分析')
  if (allSuggested.length !== stopEntries.length || stopEntries.some(({ stop }) => !allSuggested.includes(stop.uid))) throw new Error('AI 调整方案遗漏了地点节点，请重新分析')

  returnToPoolStopUids.forEach((uid) => {
    const entry = stopByUid.get(uid)!
    if (places[entry.stop.placeId]?.priority === 'must') throw new Error(`AI 不能将必去地点“${places[entry.stop.placeId].name}”退回未安排地点`)
  })

  const suggestedLocation = new Map<string, { dayId: string; index: number }>()
  arrangementByDay.forEach((uids, dayId) => uids.forEach((uid, index) => suggestedLocation.set(uid, { dayId, index })))
  days.forEach((day) => day.stops.slice(0, -1).forEach((stop, index) => {
    const mode = transportModeOf(stop.transportMode)
    if (transportModeMeta[mode].automatic) return
    const next = day.stops[index + 1]
    const fromLocation = suggestedLocation.get(stop.uid)
    const toLocation = suggestedLocation.get(next.uid)
    if (!fromLocation || !toLocation || fromLocation.dayId !== toLocation.dayId || toLocation.index !== fromLocation.index + 1) {
      throw new Error(`AI 调整方案拆散了${transportModeMeta[mode].label}固定路段，请重新分析`)
    }
  }))

  const issues = (Array.isArray(value?.issues) ? value.issues : []).map((item: any) => ({
    category: issueCategories.includes(item?.category) ? item.category : 'other',
    severity: issueSeverities.includes(item?.severity) ? item.severity : 'attention',
    title: String(item?.title || '路线问题').trim(),
    detail: String(item?.detail || '').trim(),
    dayIds: strings(item?.dayIds).filter((id) => dayIds.has(id)),
    stopUids: strings(item?.stopUids).filter((uid) => stopByUid.has(uid)),
  }))

  return {
    summary: String(value?.summary || 'AI 已完成路线检查').trim(),
    issues,
    dayArrangements: days.map((day) => ({ dayId: day.id, stopUids: arrangementByDay.get(day.id)! })),
    returnToPoolStopUids,
    reasons: strings(value?.reasons),
    cautions: strings(value?.cautions),
  }
}

export async function analyzeRouteOptimization(profile: AiProviderProfile, apiKey: string, input: RouteOptimizationInput, systemPrompt: string, signal?: AbortSignal): Promise<AiRouteOptimizationDraft> {
  const raw = await requestStructuredOutput(profile, apiKey, {
    schemaName: 'itinerary_route_optimization',
    toolName: 'optimize_itinerary_route',
    toolDescription: '审查并重排已有旅行计划中的地点节点',
    schema: routeOptimizationSchema,
    userText: `请审查以下旅行计划，并返回一个保守的调整方案。
${JSON.stringify(input)}`,
    systemPrompt: localizeAiSystemPrompt(systemPrompt),
    signal,
  })
  return raw as AiRouteOptimizationDraft
}

export function arrangeDays(days: TripDay[], draft: AiRouteOptimizationDraft): TripDay[] {
  const stopByUid = new Map(days.flatMap((day) => day.stops).map((stop) => [stop.uid, stop]))
  return days.map((day) => ({ ...day, stops: (draft.dayArrangements.find((item) => item.dayId === day.id)?.stopUids ?? []).map((uid) => stopByUid.get(uid)).filter((stop): stop is Stop => Boolean(stop)).map((stop) => ({ ...stop })) }))
}

function metrics(days: TripDay[], places: Record<string, Place>, routeCache: RouteCache) {
  const schedules = days.map((day) => scheduleDay(day, places, routeCache))
  return {
    totalKm: schedules.reduce((sum, schedule) => sum + schedule.km, 0),
    totalTravelMinutes: schedules.reduce((sum, schedule) => sum + schedule.travel, 0),
    warnedDays: schedules.filter((schedule) => !schedule.ok).length,
    conflictCount: schedules.reduce((sum, schedule) => sum + schedule.rows.filter((row) => row.conflict).length, 0),
    pendingSegments: schedules.reduce((sum, schedule) => sum + schedule.rows.filter((row) => row.route?.pending).length, 0),
  }
}

async function hydrateAutomaticRoutes(days: TripDay[], places: Record<string, Place>, routeCache: RouteCache, estimate: (from: Place, to: Place, mode: ReturnType<typeof transportModeOf>) => Promise<RouteEstimate | null>): Promise<{ provider: number; estimated: number }> {
  let provider = 0
  let estimated = 0
  const requested = new Set<string>()
  for (const day of days) {
    for (let index = 0; index < day.stops.length - 1; index += 1) {
      const stop = day.stops[index]
      const next = day.stops[index + 1]
      const mode = transportModeOf(stop.transportMode)
      if (!transportModeMeta[mode].automatic) continue
      const key = transportRouteCacheKey(stop.placeId, next.placeId, mode)
      if (routeCache[key] || requested.has(key)) continue
      requested.add(key)
      const from = places[stop.placeId]
      const to = places[next.placeId]
      if (!from || !to) continue
      const resolved = await estimate(from, to, mode)
      if (resolved) {
        routeCache[key] = resolved.toll == null ? [resolved.km, resolved.min] : [resolved.km, resolved.min, resolved.toll]
        provider += 1
      } else {
        estimated += 1
      }
    }
  }
  return { provider, estimated }
}

export async function validateRouteOptimization(days: TripDay[], places: Record<string, Place>, baseRouteCache: RouteCache, draft: AiRouteOptimizationDraft, estimate: (from: Place, to: Place, mode: ReturnType<typeof transportModeOf>) => Promise<RouteEstimate | null>): Promise<AiRouteValidation> {
  const routeCache: RouteCache = JSON.parse(JSON.stringify(baseRouteCache))
  const beforeHydration = await hydrateAutomaticRoutes(days, places, routeCache, estimate)
  const before = metrics(days, places, routeCache)
  const arranged = arrangeDays(days, draft)
  const afterHydration = await hydrateAutomaticRoutes(arranged, places, routeCache, estimate)
  const after = metrics(arranged, places, routeCache)
  return {
    before,
    after,
    routeCache,
    providerSegments: beforeHydration.provider + afterHydration.provider,
    estimatedSegments: beforeHydration.estimated + afterHydration.estimated,
  }
}

export function routeArrangementChanged(days: TripDay[], draft: AiRouteOptimizationDraft): boolean {
  if (draft.returnToPoolStopUids.length) return true
  return days.some((day) => {
    const proposed = draft.dayArrangements.find((item) => item.dayId === day.id)?.stopUids ?? []
    return proposed.length !== day.stops.length || proposed.some((uid, index) => uid !== day.stops[index]?.uid)
  })
}

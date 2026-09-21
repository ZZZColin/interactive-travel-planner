import { seededRoutes } from './data'
import { legacyDrivingRouteCacheKey, transportModeMeta, transportModeOf, transportRouteCacheKey } from './transport'
import type { DaySchedule, Place, RouteCache, RouteValue, Stop, TripDay } from './types'

export function formatTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

export function formatDuration(minutes: number, style: 'compact' | 'long' = 'compact'): string {
  const sign = minutes < 0 ? '-' : ''
  const absolute = Math.abs(minutes)
  const minuteUnit = style === 'long' ? '分钟' : '分'
  if (absolute < 60) return `${sign}${absolute}${minuteUnit}`
  const hours = Math.floor(absolute / 60)
  const rest = absolute % 60
  return `${sign}${hours}小时${rest ? `${rest}${minuteUnit}` : ''}`
}

export function routeInfo(from: Stop, to: Stop, places: Record<string, Place>, routeCache: RouteCache): RouteValue {
  const mode = transportModeOf(from.transportMode)
  const modeKey = transportRouteCacheKey(from.placeId, to.placeId, mode)
  const legacyKey = legacyDrivingRouteCacheKey(from.placeId, to.placeId)
  const selected = from.selectedRoute && from.selectedRoute.mode === mode && from.selectedRoute.toPlaceId === to.placeId ? from.selectedRoute : null
  if (selected) return { km: selected.distanceKm, min: selected.durationMinutes, mode, source: 'cache' }
  const cached = routeCache[modeKey] ?? (mode === 'driving' ? routeCache[legacyKey] ?? seededRoutes[legacyKey] : undefined)
  if (cached) return { km: cached[0], min: cached[1], mode, source: 'cache' }

  const fromPlace = places[from.placeId]
  const toPlace = places[to.placeId]
  const straightDistance = fromPlace && toPlace
    ? Math.hypot((fromPlace.lng - toPlace.lng) * 80, (fromPlace.lat - toPlace.lat) * 100)
    : 0
  const straightKm = Math.max(1, Math.round(straightDistance))

  if (!transportModeMeta[mode].automatic) {
    const scheduledDuration = from.transportDepartureTime != null && from.transportArrivalTime != null
      ? Math.max(1, from.transportArrivalTime + (from.transportArrivalTime < from.transportDepartureTime ? 1440 : 0) - from.transportDepartureTime)
      : null
    const duration = scheduledDuration ?? from.transportDuration
    return {
      km: Math.max(0, Math.round(from.transportDistance ?? straightKm)),
      min: Math.max(0, Math.round(duration ?? 0)),
      mode,
      source: 'manual',
      pending: duration == null || duration <= 0,
    }
  }

  if (mode === 'walking') {
    return { km: straightKm, min: Math.max(1, Math.round(straightKm * 12)), mode, source: 'estimate' }
  }
  if (mode === 'cycling') {
    return { km: straightKm, min: Math.max(1, Math.round(straightKm * 4)), mode, source: 'estimate' }
  }
  return {
    km: Math.max(5, Math.round(straightDistance * 0.55)),
    min: Math.max(10, Math.round(straightDistance * 0.7)),
    mode,
    source: 'estimate',
  }
}

export function scheduleDay(day: TripDay, places: Record<string, Place>, routeCache: RouteCache, previousStop: Stop | null = null): DaySchedule {
  let cursor = day.start
  let drive = 0
  let travel = 0
  let km = 0
  const pendingSegments: string[] = []
  const rows: DaySchedule['rows'] = []

  const firstStop = day.stops[0]
  if (previousStop && firstStop && previousStop.placeId !== firstStop.placeId) {
    const entry = routeInfo(previousStop, firstStop, places, routeCache)
    travel += entry.min
    if (entry.mode === 'driving') drive += entry.min
    km += entry.km
    if (entry.pending) {
      const fromName = places[previousStop.placeId]?.name ?? previousStop.placeId
      const toName = places[firstStop.placeId]?.name ?? firstStop.placeId
      pendingSegments.push(`${fromName} → ${toName} 的${transportModeMeta[entry.mode ?? 'driving'].label}用时未填写`)
    }
    const departure = previousStop.transportDepartureTime
    cursor = departure != null ? Math.max(day.start, departure) + entry.min : day.start + entry.min
  }

  day.stops.forEach((stop, index) => {
    const expectedArrival = cursor
    const explicitArrival = stop.arrivalTime ?? stop.pinned ?? null
    const arrival = explicitArrival ?? expectedArrival
    const explicitDeparture = stop.departureTime ?? null
    const departure = explicitDeparture ?? arrival + stop.stay
    const wait = Math.max(0, arrival - expectedArrival)
    const conflictMessages: string[] = []

    if (explicitArrival !== null && explicitArrival < expectedArrival) {
      conflictMessages.push(`最早只能在 ${formatTime(expectedArrival)} 到达`)
      const previous = rows[index - 1]
      if (previous) {
        previous.conflict = true
        previous.conflictMessages.push(`与后续节点“${places[stop.placeId]?.name ?? ''}”时间交叉`)
      }
    }
    if (departure < arrival) conflictMessages.push('离开时间早于到达时间')
    if (arrival < day.start) conflictMessages.push(`到达时间早于当天开始时间 ${formatTime(day.start)}`)

    const plannedDuration = Math.max(0, departure - arrival)
    const feasibleArrival = Math.max(expectedArrival, arrival)
    const feasibleDeparture = feasibleArrival + plannedDuration
    const nextStop = day.stops[index + 1]
    let route: RouteValue | null = null

    if (nextStop) {
      route = routeInfo(stop, nextStop, places, routeCache)
      travel += route.min
      if (route.mode === 'driving') drive += route.min
      km += route.km
      if (route.pending) {
        const fromName = places[stop.placeId]?.name ?? stop.placeId
        const toName = places[nextStop.placeId]?.name ?? nextStop.placeId
        pendingSegments.push(`${fromName} → ${toName} 的${transportModeMeta[route.mode ?? 'driving'].label}用时未填写`)
      }
      const segmentDeparture = stop.transportDepartureTime
      if (segmentDeparture != null) {
        const requiredArrival = segmentDeparture - Math.max(0, stop.transportAdvanceMinutes ?? 0)
        if (feasibleDeparture > requiredArrival) conflictMessages.push(`无法在 ${formatTime(requiredArrival)} 前完成前序安排并赶上${transportModeMeta[route.mode ?? 'driving'].label}`)
        cursor = Math.max(feasibleDeparture, segmentDeparture) + route.min
      } else {
        cursor = feasibleDeparture + route.min
      }
    } else {
      cursor = feasibleDeparture
    }

    rows.push({
      arrival,
      departure,
      expectedArrival,
      wait,
      late: explicitArrival !== null && explicitArrival < expectedArrival,
      conflict: conflictMessages.length > 0,
      conflictMessages,
      route,
    })
  })

  const finish = rows.length ? Math.max(rows[rows.length - 1].departure, cursor) : day.start
  const warnings: string[] = []
  warnings.push(...pendingSegments)
  const conflictCount = rows.filter((row) => row.conflict).length
  if (conflictCount) warnings.push(`存在 ${conflictCount} 个时间冲突节点`)
  if (finish > day.end) warnings.push(`预计 ${formatTime(finish)} 结束，超过可用时间 ${formatDuration(finish - day.end, 'long')}`)
  if (drive > day.maxDrive) warnings.push(`驾驶 ${formatDuration(drive, 'long')}，超过上限 ${formatDuration(drive - day.maxDrive, 'long')}`)

  return {
    rows,
    drive,
    travel,
    km,
    finish,
    total: finish - day.start,
    warnings,
    ok: warnings.length === 0,
  }
}

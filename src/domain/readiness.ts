import { checkPlaceConstraints } from './placeConstraints'
import { scheduleDay } from './schedule'
import { transportModeMeta, transportModeOf } from './transport'
import type { OvernightMode, Place, RouteCache, TripDay } from './types'

export type ReadinessCategory = 'itinerary' | 'lodging' | 'transport' | 'reservation' | 'budget'
export interface ReadinessTask {
  id: string
  category: ReadinessCategory
  severity: 'required' | 'recommended'
  title: string
  detail: string
  dayId?: string
  placeId?: string
  stopUid?: string
}
export interface ReadinessSummary { completed: number; total: number; percent: number; tasks: ReadinessTask[] }

const overnightLabels: Record<Exclude<OvernightMode, 'auto'>, string> = { 'night-transport': '夜间交通', camping: '露营', friends: '住亲友家', 'no-lodging': '无需住宿' }

export function calculateReadiness(days: TripDay[], places: Record<string, Place>, routeCache: RouteCache, unknownExpenseCount = 0): ReadinessSummary {
  const tasks: ReadinessTask[] = []
  let total = 0
  let completed = 0
  const usedDays = days.filter((day) => day.stops.length)
  usedDays.forEach((day) => {
    total += 1
    const schedule = scheduleDay(day, places, routeCache)
    if (schedule.ok) completed += 1
    else tasks.push({ id: `${day.id}-schedule`, category: 'itinerary', severity: 'required', title: `${day.label} 行程仍不可行`, detail: schedule.warnings[0] ?? '请检查时间和交通安排。', dayId: day.id })
  })

  days.slice(0, -1).forEach((day) => {
    if (!day.stops.length) return
    total += 1
    const mode = day.overnightMode ?? 'auto'
    const lastPlace = places[day.stops[day.stops.length - 1].placeId]
    if (mode !== 'auto' || lastPlace?.category === 'lodging') completed += 1
    else tasks.push({ id: `${day.id}-overnight`, category: 'lodging', severity: 'required', title: `${day.label} 尚未覆盖住宿`, detail: '请把住宿安排为当天最后一站，或明确选择夜间交通、露营、住亲友家或无需住宿。', dayId: day.id, placeId: lastPlace?.id })
    if (mode !== 'auto') {
      const label = overnightLabels[mode]
      if (!label) completed -= 0
    }
  })

  const placeIssues = checkPlaceConstraints(days, places, routeCache)
  const reservationIssueIds = new Set(placeIssues.filter((issue) => issue.id.endsWith('-reservation')).map((issue) => issue.id))
  days.forEach((day) => day.stops.forEach((stop) => {
    const place = places[stop.placeId]
    if (place?.reservationRequired) {
      total += 1
      const issueId = `${day.id}-${stop.uid}-reservation`
      if (reservationIssueIds.has(issueId)) tasks.push({ id: issueId, category: 'reservation', severity: 'required', title: `${place.name} 尚未完成预约`, detail: '请更新预约或购票状态。', dayId: day.id, placeId: place.id, stopUid: stop.uid })
      else completed += 1
    }
  }))

  days.forEach((day) => day.stops.slice(0, -1).forEach((stop) => {
    const mode = transportModeOf(stop.transportMode)
    if (transportModeMeta[mode].automatic) return
    total += 1
    const timingReady = Boolean(stop.selectedRoute || stop.transportDuration || (stop.transportDepartureTime != null && stop.transportArrivalTime != null))
    const ticketReady = ['booked', 'ticketed'].includes(stop.transportTicketStatus ?? 'none')
    if (timingReady && ticketReady) completed += 1
    else tasks.push({ id: `${day.id}-${stop.uid}-transport-ready`, category: 'transport', severity: 'required', title: `${transportModeMeta[mode].label}信息尚未确认`, detail: !timingReady ? '请补充可靠用时或出发到达时间。' : '请更新购票状态。', dayId: day.id, placeId: stop.placeId, stopUid: stop.uid })
  }))

  total += 1
  if (unknownExpenseCount === 0) completed += 1
  else tasks.push({ id: 'budget-unknown', category: 'budget', severity: 'recommended', title: `还有 ${unknownExpenseCount} 项费用待核价`, detail: '补充关键费用后，预算会更接近实际支出。' })
  return { completed, total, percent: total ? Math.round(completed / total * 100) : 100, tasks }
}

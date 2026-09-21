import { formatTime, scheduleDay } from './schedule'
import type { Place, RouteCache, TripDay } from './types'

export interface PlaceConstraintIssue {
  id: string
  severity: 'attention' | 'warning'
  dayId: string
  placeId: string
  title: string
  detail: string
}

export function checkPlaceConstraints(days: TripDay[], places: Record<string, Place>, routeCache: RouteCache): PlaceConstraintIssue[] {
  const issues: PlaceConstraintIssue[] = []
  days.forEach((day) => {
    const schedule = scheduleDay(day, places, routeCache)
    day.stops.forEach((stop, index) => {
      const place = places[stop.placeId]
      const row = schedule.rows[index]
      if (!place || !row) return
      if (place.reservationRequired && !['booked', 'ticketed'].includes(place.reservationStatus ?? 'none')) {
        issues.push({ id: `${day.id}-${stop.uid}-reservation`, severity: 'warning', dayId: day.id, placeId: place.id, title: `${place.name} 尚未完成预约`, detail: place.reservationStatus === 'pending' ? '当前标记为待预约，请在出发前确认预约或购票。' : '该地点被标记为需要预约，但尚未记录预约或购票状态。' })
      }
      if (place.openingTime != null && row.arrival < place.openingTime) {
        issues.push({ id: `${day.id}-${stop.uid}-early`, severity: 'attention', dayId: day.id, placeId: place.id, title: `${place.name} 预计到达过早`, detail: `预计 ${formatTime(row.arrival)} 到达，用户确认的开放时间为 ${formatTime(place.openingTime)}。` })
      }
      if (place.lastEntryTime != null && row.arrival > place.lastEntryTime) {
        issues.push({ id: `${day.id}-${stop.uid}-last-entry`, severity: 'warning', dayId: day.id, placeId: place.id, title: `${place.name} 可能错过最晚入场`, detail: `预计 ${formatTime(row.arrival)} 到达，用户确认的最晚入场时间为 ${formatTime(place.lastEntryTime)}。` })
      }
      if (place.closingTime != null && row.departure > place.closingTime) {
        issues.push({ id: `${day.id}-${stop.uid}-closing`, severity: 'warning', dayId: day.id, placeId: place.id, title: `${place.name} 停留时间超过关闭时间`, detail: `预计 ${formatTime(row.departure)} 离开，用户确认的关闭时间为 ${formatTime(place.closingTime)}。` })
      }
    })
  })
  return issues
}

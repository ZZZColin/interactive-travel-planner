import { transportRouteCacheKey } from './transport'
import type { Place, RouteCache, TripDay } from './types'
import { formatDuration } from './schedule'

export interface DayContinuityIssue {
  id: string
  severity: 'attention' | 'warning'
  fromDayId: string
  toDayId: string
  fromPlaceId: string
  toPlaceId: string
  title: string
  detail: string
}

function approximateKm(from: Place, to: Place): number {
  const meanLat = (from.lat + to.lat) / 2 * Math.PI / 180
  const dx = (from.lng - to.lng) * 111 * Math.cos(meanLat)
  const dy = (from.lat - to.lat) * 111
  return Math.round(Math.hypot(dx, dy))
}

export function checkDayContinuity(days: TripDay[], places: Record<string, Place>, routeCache: RouteCache = {}): DayContinuityIssue[] {
  const issues: DayContinuityIssue[] = []
  for (let index = 0; index < days.length - 1; index += 1) {
    const fromDay = days[index]
    const toDay = days[index + 1]
    const fromStop = fromDay.stops[fromDay.stops.length - 1]
    const toStop = toDay.stops[0]
    if (!fromStop || !toStop) continue
    const from = places[fromStop.placeId]
    const to = places[toStop.placeId]
    if (!from || !to || from.id === to.id) continue
    const cached = routeCache[transportRouteCacheKey(from.id, to.id, 'driving')]
    const km = cached?.[0] ?? approximateKm(from, to)
    const minutes = cached?.[1]
    if (km >= 30) issues.push({
      id: `${fromDay.id}-${toDay.id}-location`, severity: km >= 100 ? 'warning' : 'attention', fromDayId: fromDay.id, toDayId: toDay.id,
      fromPlaceId: from.id, toPlaceId: to.id,
      title: `${fromDay.label} 终点与 ${toDay.label} 起点不连续`,
      detail: cached ? `${from.name} → ${to.name} 地图驾车约 ${km} km、${formatDuration(minutes!, 'long')}，建议补充跨日交通、住宿或调整次日起点。` : `${from.name} → ${to.name} 直线距离约 ${km} km，建议补充跨日交通、住宿或调整次日起点；配置地图后可进一步验证实际驾车路线。`,
    })
    const rest = 1440 - fromDay.end + toDay.start
    if (rest < 480) issues.push({
      id: `${fromDay.id}-${toDay.id}-rest`, severity: rest < 360 ? 'warning' : 'attention', fromDayId: fromDay.id, toDayId: toDay.id,
      fromPlaceId: from.id, toPlaceId: to.id,
      title: `${fromDay.label} 与 ${toDay.label} 休息间隔偏短`,
      detail: `按日期可用时间计算仅有 ${formatDuration(rest, 'long')} 间隔，建议为住宿、整理和次日出发预留至少 8 小时。`,
    })
  }
  return issues
}

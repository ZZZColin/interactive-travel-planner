import type { Stop, TripDay } from './types'

export interface PlanStopNode {
  day: TripDay
  dayIndex: number
  stop: Stop
  stopIndex: number
  globalIndex: number
}

export interface PlanRouteSegment {
  id: string
  from: PlanStopNode
  to: PlanStopNode
  ownerDayId: string
  crossDay: boolean
}

export interface PlanRouteProjection {
  nodes: PlanStopNode[]
  segments: PlanRouteSegment[]
}

export function buildPlanRouteProjection(days: TripDay[]): PlanRouteProjection {
  const nodes: PlanStopNode[] = []
  days.forEach((day, dayIndex) => day.stops.forEach((stop, stopIndex) => {
    nodes.push({ day, dayIndex, stop, stopIndex, globalIndex: nodes.length + 1 })
  }))
  const segments = nodes.slice(0, -1).map((from, index) => {
    const to = nodes[index + 1]
    return {
      id: `${from.stop.uid}>${to.stop.uid}`,
      from,
      to,
      ownerDayId: to.day.id,
      crossDay: from.day.id !== to.day.id,
    }
  })
  return { nodes, segments }
}

export function previousPlanStop(days: TripDay[], dayId: string): Stop | null {
  const projection = buildPlanRouteProjection(days)
  const first = projection.nodes.find((node) => node.day.id === dayId)
  if (!first) return null
  return projection.nodes[first.globalIndex - 2]?.stop ?? null
}

export function nextPlanStop(days: TripDay[], stopUid: string): Stop | null {
  const nodes = buildPlanRouteProjection(days).nodes
  const index = nodes.findIndex((node) => node.stop.uid === stopUid)
  return index >= 0 ? nodes[index + 1]?.stop ?? null : null
}

import { describe, expect, it } from 'vitest'
import { createStop } from '../data'
import { buildPlanRouteProjection } from '../routeProjection'
import type { TripDay } from '../types'

const day = (id: string, stops: ReturnType<typeof createStop>[]): TripDay => ({ id, label: id.toUpperCase(), date: '09/17', start: 480, end: 1200, maxDrive: 360, stops })

describe('continuous plan route projection', () => {
  it('connects the last stop of one day to the first stop of the next day', () => {
    const days = [day('d1', [createStop('cq'), createStop('ln')]), day('d2', [createStop('mq')])]
    const projection = buildPlanRouteProjection(days)
    expect(projection.nodes.map((node) => [node.globalIndex, node.stop.placeId])).toEqual([[1, 'cq'], [2, 'ln'], [3, 'mq']])
    expect(projection.segments.map((segment) => [segment.from.stop.placeId, segment.to.stop.placeId, segment.crossDay, segment.ownerDayId])).toEqual([
      ['cq', 'ln', false, 'd1'],
      ['ln', 'mq', true, 'd2'],
    ])
  })

  it('keeps a loop return as a separate visit occurrence', () => {
    const days = [day('d1', [createStop('cq'), createStop('ln')]), day('d5', [createStop('cq')])]
    const projection = buildPlanRouteProjection(days)
    expect(projection.nodes.map((node) => [node.globalIndex, node.stop.placeId])).toEqual([[1, 'cq'], [2, 'ln'], [3, 'cq']])
    expect(projection.segments.at(-1)?.to.stop.placeId).toBe('cq')
  })
})

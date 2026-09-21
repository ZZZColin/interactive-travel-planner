import { describe, expect, it } from 'vitest'
import { checkDayContinuity } from '../continuity'
import type { Place, TripDay } from '../types'

const places: Record<string, Place> = {
  a: { id: 'a', name: '甲地', type: '住宿', category: 'lodging', priority: 'normal', lng: 104, lat: 30, crs: 'GCJ02' },
  b: { id: 'b', name: '乙地', type: '地点', category: 'attraction', priority: 'normal', lng: 106, lat: 30, crs: 'GCJ02' },
}
const stop = (uid: string, placeId: string) => ({ uid, placeId, stay: 0, pinned: null, transportMode: 'driving' as const })

describe('cross-day continuity', () => {
  it('flags distant overnight transitions and short rest windows', () => {
    const days: TripDay[] = [
      { id: 'd1', label: 'Day 1', date: '09/16', start: 480, end: 1380, maxDrive: 360, stops: [stop('a1', 'a')] },
      { id: 'd2', label: 'Day 2', date: '09/17', start: 360, end: 1200, maxDrive: 360, stops: [stop('b1', 'b')] },
    ]
    const issues = checkDayContinuity(days, places)
    expect(issues.map((item) => item.id)).toEqual(['d1-d2-location', 'd1-d2-rest'])
    expect(issues[0].severity).toBe('warning')
  })

  it('accepts the same overnight place', () => {
    const days: TripDay[] = [
      { id: 'd1', label: 'Day 1', date: '09/16', start: 480, end: 1200, maxDrive: 360, stops: [stop('a1', 'a')] },
      { id: 'd2', label: 'Day 2', date: '09/17', start: 480, end: 1200, maxDrive: 360, stops: [stop('a2', 'a')] },
    ]
    expect(checkDayContinuity(days, places)).toEqual([])
  })
})

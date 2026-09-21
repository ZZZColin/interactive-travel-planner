import { describe, expect, it, vi } from 'vitest'
import { arrangeDays, buildRouteOptimizationInput, normalizeRouteOptimizationDraft, routeArrangementChanged, validateRouteOptimization } from '../routeOptimization'
import type { Place, TripDay } from '../../domain/types'

const places: Record<string, Place> = {
  a: { id: 'a', name: 'A', type: '地点', category: 'attraction', priority: 'must', lng: 100, lat: 30, crs: 'GCJ02' },
  b: { id: 'b', name: 'B', type: '地点', category: 'attraction', priority: 'normal', lng: 101, lat: 30, crs: 'GCJ02' },
  c: { id: 'c', name: 'C', type: '地点', category: 'attraction', priority: 'normal', lng: 100.2, lat: 30, crs: 'GCJ02' },
}

const days: TripDay[] = [
  { id: 'd1', label: 'Day 1', date: '09/16', start: 480, end: 1200, maxDrive: 360, stops: [
    { uid: 'sa', placeId: 'a', stay: 60, pinned: null, transportMode: 'driving' },
    { uid: 'sb', placeId: 'b', stay: 60, pinned: null, transportMode: 'driving' },
    { uid: 'sc', placeId: 'c', stay: 60, pinned: null, transportMode: 'driving' },
  ] },
  { id: 'd2', label: 'Day 2', date: '09/17', start: 480, end: 1200, maxDrive: 360, stops: [] },
]

function draft(overrides: Record<string, unknown> = {}) {
  return {
    summary: '建议减少折返', issues: [],
    dayArrangements: [{ dayId: 'd1', stopUids: ['sa', 'sc', 'sb'] }, { dayId: 'd2', stopUids: [] }],
    returnToPoolStopUids: [], reasons: ['A 与 C 更近'], cautions: [], ...overrides,
  }
}

describe('AI route optimization', () => {
  it('builds a stable-ID input and accepts a complete conservative arrangement', () => {
    const input = buildRouteOptimizationInput('测试计划', days, places, {})
    expect(input.days[0].stops.map((stop) => stop.stopUid)).toEqual(['sa', 'sb', 'sc'])
    const normalized = normalizeRouteOptimizationDraft(draft(), days, places)
    expect(normalized.dayArrangements[0].stopUids).toEqual(['sa', 'sc', 'sb'])
    expect(routeArrangementChanged(days, normalized)).toBe(true)
    expect(arrangeDays(days, normalized)[0].stops.map((stop) => stop.uid)).toEqual(['sa', 'sc', 'sb'])
  })

  it('rejects missing nodes and returning a must place to the pool', () => {
    expect(() => normalizeRouteOptimizationDraft(draft({ dayArrangements: [{ dayId: 'd1', stopUids: ['sa', 'sb'] }, { dayId: 'd2', stopUids: [] }] }), days, places)).toThrow('遗漏')
    expect(() => normalizeRouteOptimizationDraft(draft({ dayArrangements: [{ dayId: 'd1', stopUids: ['sb', 'sc'] }, { dayId: 'd2', stopUids: [] }], returnToPoolStopUids: ['sa'] }), days, places)).toThrow('必去地点')
  })

  it('validates proposed adjacency with provider route estimates', async () => {
    const normalized = normalizeRouteOptimizationDraft(draft(), days, places)
    const estimate = vi.fn(async (from: Place, to: Place) => {
      const key = `${from.id}-${to.id}`
      const values: Record<string, [number, number]> = { 'a-b': [100, 100], 'b-c': [90, 90], 'a-c': [20, 20], 'c-b': [25, 25] }
      const value = values[key]
      return value ? { km: value[0], min: value[1], source: 'provider' as const } : null
    })
    const validation = await validateRouteOptimization(days, places, {}, normalized, estimate)
    expect(validation.before.totalKm).toBe(190)
    expect(validation.after.totalKm).toBe(45)
    expect(validation.providerSegments).toBe(4)
    expect(estimate).toHaveBeenCalledTimes(4)
  })
})

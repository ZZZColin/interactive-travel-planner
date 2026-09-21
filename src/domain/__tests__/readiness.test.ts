import { describe, expect, it } from 'vitest'
import { calculateReadiness } from '../readiness'
import type { Place, TripDay } from '../types'

const places: Record<string, Place> = {
  hotel: { id: 'hotel', name: '酒店', type: '住宿', category: 'lodging', priority: 'normal', lng: 100, lat: 30, crs: 'GCJ02' },
  spot: { id: 'spot', name: '景区', type: '景区', category: 'attraction', priority: 'must', lng: 100.1, lat: 30, crs: 'GCJ02', reservationRequired: true, reservationStatus: 'pending' },
  station: { id: 'station', name: '车站', type: '交通', category: 'transport', priority: 'normal', lng: 100.2, lat: 30, crs: 'GCJ02' },
}
const stop = (uid: string, placeId: string) => ({ uid, placeId, stay: 0, pinned: null, transportMode: 'driving' as const })

describe('plan readiness', () => {
  it('collects lodging, reservation, transport and budget tasks', () => {
    const train = { ...stop('s2', 'station'), transportMode: 'train' as const, transportDuration: 60, transportTicketStatus: 'pending' as const }
    const days: TripDay[] = [
      { id: 'd1', label: 'Day 1', date: '09/16', start: 480, end: 1200, maxDrive: 360, stops: [train, stop('s1', 'spot')] },
      { id: 'd2', label: 'Day 2', date: '09/17', start: 480, end: 1200, maxDrive: 360, stops: [stop('h1', 'hotel')] },
    ]
    const result = calculateReadiness(days, places, {}, 2)
    expect(result.tasks.map((task) => task.category)).toEqual(expect.arrayContaining(['lodging', 'reservation', 'transport', 'budget']))
    expect(result.percent).toBeLessThan(100)
  })

  it('accepts an explicit non-hotel overnight mode', () => {
    const days: TripDay[] = [
      { id: 'd1', label: 'Day 1', date: '09/16', start: 480, end: 1200, maxDrive: 360, overnightMode: 'camping', stops: [stop('s1', 'spot')] },
      { id: 'd2', label: 'Day 2', date: '09/17', start: 480, end: 1200, maxDrive: 360, stops: [stop('h1', 'hotel')] },
    ]
    const result = calculateReadiness(days, { ...places, spot: { ...places.spot, reservationRequired: false } }, {}, 0)
    expect(result.tasks.some((task) => task.category === 'lodging')).toBe(false)
  })
})

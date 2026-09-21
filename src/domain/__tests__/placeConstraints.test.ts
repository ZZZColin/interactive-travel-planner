import { describe, expect, it } from 'vitest'
import { checkPlaceConstraints } from '../placeConstraints'
import type { Place, TripDay } from '../types'

const place: Place = { id: 'p', name: '景区', type: '景区', category: 'attraction', priority: 'must', lng: 100, lat: 30, crs: 'GCJ02', openingTime: 540, lastEntryTime: 600, closingTime: 660, reservationRequired: true, reservationStatus: 'pending' }
const day: TripDay = { id: 'd1', label: 'Day 1', date: '09/16', start: 480, end: 1200, maxDrive: 360, stops: [{ uid: 's1', placeId: 'p', stay: 240, pinned: null, transportMode: 'driving' }] }

describe('place visit constraints', () => {
  it('checks reservation and confirmed opening windows', () => {
    const issues = checkPlaceConstraints([day], { p: place }, {})
    expect(issues.map((item) => item.id)).toEqual(['d1-s1-reservation', 'd1-s1-early', 'd1-s1-closing'])
  })

  it('accepts a ticketed visit inside the confirmed window', () => {
    const valid = { ...place, reservationStatus: 'ticketed' as const }
    const scheduled = { ...day, start: 540, stops: [{ ...day.stops[0], stay: 60 }] }
    expect(checkPlaceConstraints([scheduled], { p: valid }, {})).toEqual([])
  })
})

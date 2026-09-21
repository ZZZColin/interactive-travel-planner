import { describe, expect, it } from 'vitest'
import { decodeRoutePath, encodeRoutePath } from '../../domain/polyline'
import type { MapScene } from '../../domain/types'
import { bd09ToGcj02, convertCoordinate, coordinateDistance, gcj02ToBd09, gcj02ToWgs84, gcj02ToWgs84Exact, projectMapSceneCoordinates, wgs84ToGcj02 } from '../coordinates'

describe('map coordinate projection', () => {
  it('matches the supplied WGS84 / GCJ02 algorithm and uses the exact inverse for rendering', () => {
    const wgs: [number, number] = [116.397389, 39.908722]
    const gcj = wgs84ToGcj02(wgs)
    expect(gcj[0]).toBeCloseTo(116.4036, 3)
    expect(gcj[1]).toBeCloseTo(39.9101, 3)
    const approximate = gcj02ToWgs84(gcj)
    const exact = gcj02ToWgs84Exact(gcj)
    expect(approximate[0]).toBeCloseTo(wgs[0], 4)
    expect(approximate[1]).toBeCloseTo(wgs[1], 4)
    expect(Math.abs(exact[0] - wgs[0])).toBeLessThan(0.0000011)
    expect(Math.abs(exact[1] - wgs[1])).toBeLessThan(0.0000011)
    expect(convertCoordinate(gcj, 'GCJ02', 'WGS84')).toEqual(exact)
  })

  it('converts GCJ02 and BD09 in both directions', () => {
    const gcj: [number, number] = [116.403632, 39.910125]
    const bd = gcj02ToBd09(gcj)
    const restored = bd09ToGcj02(bd)
    expect(bd[0]).toBeCloseTo(116.4100, 3)
    expect(bd[1]).toBeCloseTo(39.9164, 3)
    expect(restored[0]).toBeCloseTo(gcj[0], 6)
    expect(restored[1]).toBeCloseTo(gcj[1], 6)
    expect(convertCoordinate(bd, 'BD09', 'WGS84')[0]).toBeCloseTo(116.397389, 5)
  })

  it('leaves coordinates outside mainland China unchanged', () => {
    const paris: [number, number] = [2.3522, 48.8566]
    expect(convertCoordinate(paris, 'WGS84', 'GCJ02')).toEqual(paris)
    expect(convertCoordinate(paris, 'GCJ02', 'WGS84')).toEqual(paris)
  })

  it('calculates great-circle distance in meters', () => {
    expect(coordinateDistance([116.397389, 39.908722], [116.397389, 39.909722])).toBeCloseTo(111.19, 0)
  })

  it('projects every point in persisted route polylines without mutating business data', () => {
    const path: Array<[number, number]> = [[116.4036, 39.9101], [116.4086, 39.9151], [116.4136, 39.9201]]
    const scene: MapScene = {
      places: [{ id: 'a', name: 'A', type: '地点', category: 'attraction', priority: 'normal', lng: path[0][0], lat: path[0][1], crs: 'GCJ02' }],
      days: [{ id: 'd1', label: 'Day 1', date: '09/17', start: 480, end: 1200, maxDrive: 360, stops: [{ uid: 's1', placeId: 'a', stay: 60, pinned: null, selectedRoute: { id: 'r1', providerId: 'amap', providerName: '高德地图', fromPlaceId: 'a', toPlaceId: 'b', mode: 'driving', strategyLabel: '推荐', distanceKm: 10, durationMinutes: 20, crs: 'GCJ02', encodedPath: encodeRoutePath(path), queriedAt: '2026-09-17T00:00:00.000Z', selectedAt: '2026-09-17T00:00:00.000Z' } }] }],
      selectedDayId: 'd1', selectedPlaceId: 'a', categoryFilter: 'all', satellite: false, mapMode: 'all', routeDayIds: ['d1'], routeWarning: false, routeWarningDayIds: [], routeCache: {}, conflictPlaceIds: [],
    }
    const projected = projectMapSceneCoordinates(scene, 'WGS84')
    const projectedPath = decodeRoutePath(projected.days[0].stops[0].selectedRoute!.encodedPath)
    expect(projected.places[0].crs).toBe('WGS84')
    expect(projected.days[0].stops[0].selectedRoute?.crs).toBe('WGS84')
    expect(projectedPath).toHaveLength(path.length)
    projectedPath.forEach((point, index) => {
      const expected = gcj02ToWgs84Exact(path[index])
      expect(point[0]).toBeCloseTo(expected[0], 5)
      expect(point[1]).toBeCloseTo(expected[1], 5)
    })
    expect(scene.places[0].crs).toBe('GCJ02')
    expect(scene.days[0].stops[0].selectedRoute?.crs).toBe('GCJ02')
  })
})

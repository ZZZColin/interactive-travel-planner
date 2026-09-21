import { describe, expect, it } from 'vitest'
import { encodeRoutePath } from '../polyline'
import { basePlaces, createBaseDays, createStop, seededRoutes } from '../data'
import { categoryFromPoi } from '../categories'
import { formatDuration, formatTime, scheduleDay } from '../schedule'

describe('scheduleDay', () => {
  it('reproduces the baseline Day 2 timeline', () => {
    const day = createBaseDays()[1]
    const result = scheduleDay(day, basePlaces, {}, createBaseDays()[0].stops.at(-1)!)

    expect(result.km).toBe(250)
    expect(result.drive).toBe(300)
    expect(result.travel).toBe(300)
    expect(result.finish).toBe(1040)
    expect(result.rows.map((row) => formatTime(row.arrival))).toEqual(['12:10', '14:00', '17:20'])
    expect(result.ok).toBe(true)
  })

  it('detects the deliberate Danba conflict', () => {
    const day = createBaseDays()[1]
    day.stops.splice(day.stops.length - 1, 0, createStop('danba', 120))
    const result = scheduleDay(day, basePlaces, seededRoutes)

    expect(result.ok).toBe(false)
    expect(result.warnings.length).toBeGreaterThan(0)
  })


  it('marks both nodes when an explicit arrival overlaps the previous route', () => {
    const day = createBaseDays()[1]
    day.stops[1].arrivalTime = 9 * 60
    day.stops[1].departureTime = 12 * 60
    const result = scheduleDay(day, basePlaces, {})

    expect(result.rows[0].conflict).toBe(true)
    expect(result.rows[1].conflict).toBe(true)
    expect(result.rows[1].conflictMessages[0]).toContain('最早只能在')
    expect(result.ok).toBe(false)
  })

  it('uses the route option selected on the outgoing stop', () => {
    const day = createBaseDays()[0]
    day.stops[0].selectedRoute = {
      id: 'route-option', providerId: 'amap', providerName: '高德地图', fromPlaceId: 'cq', toPlaceId: 'cd', mode: 'driving', strategyLabel: '少收费', distanceKm: 280, durationMinutes: 240, toll: 10, encodedPath: encodeRoutePath([[106.55, 29.56], [104.06, 30.57]]), queriedAt: '2026-09-16T00:00:00.000Z', selectedAt: '2026-09-16T00:00:00.000Z',
    }
    const result = scheduleDay(day, basePlaces, {})
    expect(result.km).toBe(280)
    expect(result.travel).toBe(240)
  })

  it('counts only driving segments against the daily driving limit', () => {
    const day = createBaseDays()[0]
    day.stops[0].transportMode = 'flight'
    day.stops[0].transportDuration = 90
    day.stops[0].transportDistance = 1200
    const result = scheduleDay(day, basePlaces, {})

    expect(result.drive).toBe(0)
    expect(result.travel).toBe(90)
    expect(result.km).toBe(1200)
    expect(result.ok).toBe(true)
  })

  it('warns when a manual transport mode has no reliable duration', () => {
    const day = createBaseDays()[0]
    day.stops[0].transportMode = 'train'
    day.stops[0].transportDuration = null
    const result = scheduleDay(day, basePlaces, {})

    expect(result.warnings[0]).toContain('火车用时未填写')
    expect(result.ok).toBe(false)
  })

  it('honors a pinned arrival time by inserting waiting time', () => {
    const days = createBaseDays()
    const day = days[1]
    day.stops[1].pinned = 870
    const result = scheduleDay(day, basePlaces, {}, days[0].stops.at(-1)!)

    expect(result.rows[1].arrival).toBe(870)
    expect(result.rows[1].wait).toBe(30)
  })
})

describe('formatters and place categories', () => {
  it('formats durations with Chinese units', () => {
    expect(formatDuration(30)).toBe('30分')
    expect(formatDuration(250)).toBe('4小时10分')
    expect(formatDuration(250, 'long')).toBe('4小时10分钟')
    expect(formatDuration(240)).toBe('4小时')
    expect(formatDuration(-15, 'long')).toBe('-15分钟')
  })

  it('classifies common AMap POI types', () => {
    expect(categoryFromPoi('餐饮服务;中餐厅;火锅店')).toBe('food')
    expect(categoryFromPoi('住宿服务;宾馆酒店')).toBe('lodging')
    expect(categoryFromPoi('风景名胜;公园广场')).toBe('attraction')
  })
})

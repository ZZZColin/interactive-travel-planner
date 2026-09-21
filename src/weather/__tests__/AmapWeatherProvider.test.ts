import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../domain/types'
import { loadAmap } from '../../map/providers/amap/loader'
import { createDaysFromRange } from '../../domain/plans'
import { AmapWeatherProvider } from '../providers/amap/AmapWeatherProvider'
import { weatherForecastCoverage } from '../types'

vi.mock('../../map/providers/amap/config', () => ({ hasAmapConfig: () => true }))
vi.mock('../../map/providers/amap/loader', () => ({ loadAmap: vi.fn() }))

const place: Place = { id: 'shuang', name: '双桥沟', type: '景区', category: 'attraction', priority: 'must', lng: 102.8465, lat: 31.089, crs: 'GCJ02' as const }

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('AMap weather provider', () => {
  it('normalizes a daily rain forecast returned for the place adcode', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T10:00:00+08:00'))
    const sdk = {
      LngLat: class { constructor(_lng: number, _lat: number) {} },
      Geocoder: class {
        getAddress(_location: unknown, done: (status: string, result: unknown) => void): void {
          done('complete', { regeocode: { addressComponent: { adcode: '513200' } } })
        }
      },
      Weather: class {
        getForecast(_adcode: string, done: (error: unknown, data: unknown) => void): void {
          done(null, { reportTime: '2026-09-15 09:30:00', forecasts: [{ date: '2026-09-16', dayWeather: '小雨', nightWeather: '阴', dayTemp: '14', nightTemp: '8', dayWind: '东', dayPower: '3' }] })
        }
      },
    }
    vi.mocked(loadAmap).mockResolvedValue(sdk)

    const result = await new AmapWeatherProvider().getDailyWeather(place, '2026-09-16')

    expect(result).toEqual(expect.objectContaining({ status: 'available', kind: 'rain', condition: '小雨', minTemp: 8, maxTemp: 14, dayWind: '东', dayPower: '3' }))
  })

  it('declares its maximum horizon and calculates when uncovered plan dates become queryable', () => {
    const provider = new AmapWeatherProvider()
    const days = createDaysFromRange('2026-10-02T08:00:00+08:00', '2026-10-07T20:00:00+08:00')
    const coverage = weatherForecastCoverage('2026-10-02T08:00:00+08:00', days, provider.definition.maxForecastDays, new Date('2026-09-15T10:00:00+08:00'))
    expect(provider.definition.maxForecastDays).toBe(4)
    expect(coverage.availableDays).toBe(0)
    expect(coverage.futureOutOfRangeDays).toBe(6)
    expect(coverage.firstAvailableDate).toBe('2026-09-29')
  })

  it('does not call the SDK for dates beyond the declared maximum forecast range', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T10:00:00+08:00'))
    const result = await new AmapWeatherProvider().getDailyWeather(place, '2026-09-20')
    expect(result.status).toBe('unavailable')
    expect(result.reason).toContain('4 天')
    expect(loadAmap).not.toHaveBeenCalled()
  })
})

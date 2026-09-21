import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../domain/types'
import { QWeatherProvider } from '../providers/qweather/QWeatherProvider'

vi.mock('../providers/qweather/config', () => ({
  readQWeatherConfig: () => ({ apiHost: 'https://qweather.test', authType: 'api-key', credential: 'test-key', forecastDays: 30 }),
}))

const place: Place = { id: 'shuang', name: '双桥沟', type: '景区', category: 'attraction', priority: 'must', lng: 102.8465, lat: 31.089, crs: 'GCJ02' }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('QWeather provider', () => {
  it('uses GeoAPI plus the documented 30-day city forecast endpoint', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T10:00:00+08:00'))
    const requests: Request[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = request.url
      requests.push(request)
      if (url.includes('/geo/v2/city/lookup')) return new Response(JSON.stringify({ code: '200', location: [{ id: '101271406' }] }), { status: 200 })
      return new Response(JSON.stringify({ code: '200', updateTime: '2026-09-15T09:30+08:00', daily: [{ fxDate: '2026-10-02', tempMin: '7', tempMax: '16', textDay: '小雨', windDirDay: '东北风', windScaleDay: '3-4', pop: '70' }] }), { status: 200 })
    }))

    const provider = new QWeatherProvider()
    const result = await provider.getDailyWeather(place, '2026-10-02')

    expect(provider.getConfiguredMaxForecastDays()).toBe(30)
    expect(result).toEqual(expect.objectContaining({ status: 'available', kind: 'rain', minTemp: 7, maxTemp: 16, precipitationProbability: 70 }))
    expect(requests.some((request) => request.url.includes('/geo/v2/city/lookup') && request.headers.get('X-QW-Api-Key') === 'test-key')).toBe(true)
    expect(requests.some((request) => request.url.includes('/v7/weather/30d') && request.url.includes('location=101271406') && request.headers.get('X-QW-Api-Key') === 'test-key')).toBe(true)
  })
})

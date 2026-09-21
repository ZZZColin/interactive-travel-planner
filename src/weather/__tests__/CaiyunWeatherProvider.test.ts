import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../domain/types'
import { CaiyunWeatherProvider } from '../providers/caiyun/CaiyunWeatherProvider'

vi.mock('../providers/caiyun/config', () => ({
  readCaiyunWeatherConfig: () => ({ endpoint: 'https://caiyun.test', token: 'test-token', forecastDays: 15 }),
}))

const place: Place = { id: 'shuang', name: '双桥沟', type: '景区', category: 'attraction', priority: 'must', lng: 102.8465, lat: 31.089, crs: 'GCJ02' }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Caiyun weather provider', () => {
  it('parses the documented v2.6 daily arrays and skycon code', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T10:00:00+08:00'))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL) => new Response(JSON.stringify({
      status: 'ok', server_time: 1789437600,
      result: { daily: {
        status: 'ok',
        temperature: [{ date: '2026-09-20T00:00+08:00', min: 8, max: 15, avg: 11 }],
        skycon_08h_20h: [{ date: '2026-09-20T00:00+08:00', value: 'MODERATE_RAIN' }],
        wind_08h_20h: [{ date: '2026-09-20T00:00+08:00', avg: { speed: 18, direction: 45 } }],
        precipitation: [{ date: '2026-09-20T00:00+08:00', probability: 0.8 }],
      } },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new CaiyunWeatherProvider().getDailyWeather(place, '2026-09-20')

    expect(result).toEqual(expect.objectContaining({ status: 'available', kind: 'rain', condition: '中雨', minTemp: 8, maxTemp: 15, dayWind: '东北', dayPower: '18 km/h', precipitationProbability: 80 }))
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain('/v2.6/test-token/102.8465,31.089/daily')
    expect(url).toContain('dailysteps=15')
  })
})

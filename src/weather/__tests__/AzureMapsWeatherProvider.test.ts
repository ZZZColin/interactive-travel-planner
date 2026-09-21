import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../domain/types'
import { AzureMapsWeatherProvider } from '../providers/azure/AzureMapsWeatherProvider'

vi.mock('../providers/azure/config', () => ({
  readAzureMapsWeatherConfig: () => ({ endpoint: 'https://atlas.microsoft.com', subscriptionKey: 'test-key', forecastDays: 45 }),
}))

const place: Place = { id: 'shuang', name: '双桥沟', type: '景区', category: 'attraction', priority: 'must', lng: 102.8465, lat: 31.089, crs: 'GCJ02' }

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('Azure Maps weather provider', () => {
  it('declares a 45-day maximum and parses daily forecast data', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T10:00:00+08:00'))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      summary: { startDate: '2026-09-15T00:00:00+08:00' },
      forecasts: [{
        date: '2026-10-02T07:00:00+08:00',
        temperature: { minimum: { value: 7 }, maximum: { value: 16 } },
        day: { iconPhrase: '阵雨', precipitationType: 'Rain', wind: { direction: { localizedDescription: '东北' }, speed: { value: 18 } } },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = new AzureMapsWeatherProvider()
    const result = await provider.getDailyWeather(place, '2026-10-02')

    expect(provider.definition.maxForecastDays).toBe(45)
    expect(result).toEqual(expect.objectContaining({ status: 'available', kind: 'rain', condition: '阵雨', minTemp: 7, maxTemp: 16, dayWind: '东北', dayPower: '18 km/h' }))
    const request = new Request(fetchMock.mock.calls[0][0] as URL, fetchMock.mock.calls[0][1])
    expect(request.url).toContain('duration=45')
    expect(request.headers.get('subscription-key')).toBe('test-key')
  })

  it('parses severe weather alerts from the Azure alerts endpoint', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      results: [{ alertId: 101, category: 'HURRICANE', priority: 1, source: 'National Weather Service', description: { localized: '台风预警' }, alertAreas: [{ summary: '台风红色预警', startTime: '2026-09-16T08:00:00+08:00', endTime: '2026-09-17T08:00:00+08:00', alertDetails: '预计出现严重风雨影响。' }] }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const alerts = await new AzureMapsWeatherProvider().getActiveAlerts(place)

    expect(alerts[0]).toEqual(expect.objectContaining({ eventName: 'HURRICANE', headline: '台风红色预警', severity: 'severe', source: 'National Weather Service' }))
    const request = new Request(fetchMock.mock.calls[0][0], fetchMock.mock.calls[0][1])
    expect(request.url).toContain('/weather/severe/alerts/json')
    expect(request.url).toContain('details=true')
    expect(request.headers.get('subscription-key')).toBe('test-key')
  })
})

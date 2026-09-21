import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../domain/types'
import { QWeatherProvider } from '../providers/qweather/QWeatherProvider'

vi.mock('../providers/qweather/config', () => ({
  readQWeatherConfig: () => ({ apiHost: 'https://qweather.test', authType: 'api-key', credential: 'test-key', forecastDays: 10 }),
}))

const place: Place = { id: 'shuang', name: '双桥沟', type: '景区', category: 'attraction', priority: 'must', lng: 102.8465, lat: 31.089, crs: 'GCJ02' }

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('QWeather coordinate provider', () => {
  it('uses the current 10-day coordinate endpoint and response schema', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-15T10:00:00+08:00'))
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      days: [{
        forecastStartTime: '2026-09-16T00:00:00+08:00', forecastEndTime: '2026-09-17T00:00:00+08:00',
        temperatureMax: { value: 20, unit: 'celsius' }, temperatureMin: { value: 12, unit: 'celsius' },
        daytime: { condition: { text: '阵雨' }, precipitation: { probability: 0.7, type: 'rain' }, wind: { direction: { compass: 'NE' }, scale: 3, speed: { value: 18, unit: 'km/h' } } },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await new QWeatherProvider().getDailyWeather(place, '2026-09-16')

    expect(result).toEqual(expect.objectContaining({ status: 'available', kind: 'rain', minTemp: 12, maxTemp: 20, precipitationProbability: 70 }))
    const request = new Request(fetchMock.mock.calls[0][0], fetchMock.mock.calls[0][1])
    expect(request.url).toContain('/weather/v1/daily/31.09/102.85')
    expect(request.url).toContain('days=10')
    expect(request.url).toContain('localTime=true')
    expect(request.headers.get('X-QW-Api-Key')).toBe('test-key')
  })

  it('parses current official weather alerts with validity and severity', async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({
      alerts: [{ id: 'q-alert', senderName: '阿坝州气象台', eventType: { code: '11B03', name: '暴雨' }, headline: '暴雨橙色预警', description: '预计局地出现强降雨。', instruction: '减少户外活动。', severity: 'Severe', urgency: 'Immediate', certainty: 'Likely', effectiveTime: '2026-09-16T08:00:00+08:00', expireTime: '2026-09-16T20:00:00+08:00' }],
      metadata: { attributions: [{ name: 'QWeather' }] },
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const alerts = await new QWeatherProvider().getActiveAlerts(place)

    expect(alerts[0]).toEqual(expect.objectContaining({ id: 'q-alert', headline: '暴雨橙色预警', severity: 'severe', source: '阿坝州气象台' }))
    const request = new Request(fetchMock.mock.calls[0][0], fetchMock.mock.calls[0][1])
    expect(request.url).toContain('/weatheralert/v1/current/31.09/102.85')
    expect(request.headers.get('X-QW-Api-Key')).toBe('test-key')
  })
})

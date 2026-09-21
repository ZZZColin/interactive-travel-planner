import { describe, expect, it } from 'vitest'
import type { Place } from '../domain/types'
import type { DailyWeatherResult, WeatherAlert } from '../weather/types'
import { derivePlaceRisks, highestRiskSeverity } from './engine'

const place: Place = { id: 'plateau', name: '高原营地', type: '营地', category: 'lodging', priority: 'must', lng: 100, lat: 30, altitude: 3600, crs: 'GCJ02' }
const weather: DailyWeatherResult = { status: 'available', providerId: 'qweather', providerName: '和风天气', date: '2026-09-16', condition: '小雨', kind: 'rain', minTemp: -2, maxTemp: 8, fetchedAt: Date.now() }
const alert: WeatherAlert = { id: 'alert-1', providerId: 'qweather', providerName: '和风天气', eventName: '暴雨', headline: '暴雨橙色预警', description: '预计局地出现强降雨。', severity: 'severe', source: '当地气象台', effectiveAt: '2026-09-16T08:00:00+08:00', expiresAt: '2026-09-16T20:00:00+08:00' }

describe('risk engine', () => {
  it('aggregates altitude, weather-derived and official alert risks', () => {
    const risks = derivePlaceRisks(place, '2026-09-16', weather, [alert])
    expect(risks.map((risk) => risk.category)).toEqual(expect.arrayContaining(['altitude', 'rain', 'cold', 'weather-alert']))
    expect(highestRiskSeverity(risks)).toBe('critical')
    expect(risks.find((risk) => risk.category === 'altitude')?.title).toContain('3,600 m')
  })

  it('does not attach an active alert to an unrelated future itinerary date', () => {
    const risks = derivePlaceRisks(place, '2026-10-02', null, [alert])
    expect(risks.some((risk) => risk.sourceType === 'official-alert')).toBe(false)
  })
})

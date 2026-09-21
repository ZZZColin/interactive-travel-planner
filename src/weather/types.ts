import type { Place, TripDay } from '../domain/types'

export type WeatherProviderId = 'amap' | 'azure-maps' | 'qweather' | 'caiyun'
export type WeatherSelection = WeatherProviderId | 'none'
export type WeatherKind = 'sunny' | 'cloudy' | 'overcast' | 'rain' | 'storm' | 'snow' | 'fog' | 'wind' | 'other'
export type WeatherQueryStatus = 'available' | 'unavailable' | 'error'

export interface DailyWeatherResult {
  status: WeatherQueryStatus
  providerId: WeatherProviderId
  providerName: string
  date: string
  condition?: string
  kind?: WeatherKind
  minTemp?: number
  maxTemp?: number
  dayWind?: string
  dayPower?: string
  precipitationProbability?: number
  reportedAt?: string
  fetchedAt: number
  reason?: string
}

export interface WeatherCacheEntry {
  status: 'loading' | WeatherQueryStatus
  result?: DailyWeatherResult
  fetchedAt: number
}

export interface WeatherAlert {
  id: string
  providerId: WeatherProviderId
  providerName: string
  eventName: string
  headline: string
  description: string
  instruction?: string
  severity: 'unknown' | 'minor' | 'moderate' | 'severe' | 'extreme'
  urgency?: string
  certainty?: string
  source?: string
  effectiveAt?: string
  expiresAt?: string
  attributions?: string[]
}

export interface WeatherProviderDefinition {
  id: WeatherProviderId
  name: string
  description: string
  maxForecastDays: number
  configuration: 'map-provider' | 'independent'
  supportsAlerts?: boolean
  alertLookaheadDays?: number
}

export interface WeatherProvider {
  readonly definition: WeatherProviderDefinition
  getDailyWeather(place: Place, date: string): Promise<DailyWeatherResult>
  getConfiguredMaxForecastDays?(): number
  isConfigured?(): boolean
  clearCache?(): void
  getActiveAlerts?(place: Place): Promise<WeatherAlert[]>
}

export function planDayDateKey(startAt: string, days: TripDay[], dayId: string): string {
  const index = Math.max(0, days.findIndex((day) => day.id === dayId))
  const date = new Date(startAt)
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() + index)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
export interface WeatherForecastCoverage {
  totalDays: number
  availableDays: number
  futureOutOfRangeDays: number
  pastDays: number
  firstAvailableDate: string | null
}

function startOfLocalDay(value: Date): Date {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date
}

export function weatherForecastCoverage(startAt: string, days: TripDay[], maxForecastDays: number, now = new Date()): WeatherForecastCoverage {
  const today = startOfLocalDay(now)
  let availableDays = 0
  let futureOutOfRangeDays = 0
  let pastDays = 0
  let firstOutOfRangeDate: Date | null = null
  for (const day of days) {
    const date = new Date(`${planDayDateKey(startAt, days, day.id)}T00:00:00`)
    const offset = Math.round((date.getTime() - today.getTime()) / 86_400_000)
    if (offset < 0) pastDays += 1
    else if (offset < maxForecastDays) availableDays += 1
    else {
      futureOutOfRangeDays += 1
      if (!firstOutOfRangeDate || date.getTime() < firstOutOfRangeDate.getTime()) firstOutOfRangeDate = date
    }
  }
  let firstAvailableDate: string | null = null
  if (firstOutOfRangeDate) {
    firstOutOfRangeDate.setDate(firstOutOfRangeDate.getDate() - Math.max(0, maxForecastDays - 1))
    firstAvailableDate = `${firstOutOfRangeDate.getFullYear()}-${String(firstOutOfRangeDate.getMonth() + 1).padStart(2, '0')}-${String(firstOutOfRangeDate.getDate()).padStart(2, '0')}`
  }
  return { totalDays: days.length, availableDays, futureOutOfRangeDays, pastDays, firstAvailableDate }
}

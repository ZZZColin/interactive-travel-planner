import type { Place } from '../../../domain/types'
import { weatherKindFromCondition } from '../../conditions'
import type { DailyWeatherResult, WeatherAlert, WeatherProvider } from '../../types'
import { readQWeatherConfig, type QWeatherConfig } from './config'

function daysFromToday(dateKey: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${dateKey}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function numberOrUndefined(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function placeCoordinate(location: string, axis: 'lat' | 'lng'): string {
  const [lng, lat] = location.split(',')
  return Number(axis === 'lat' ? lat : lng).toFixed(2)
}

export class QWeatherProvider implements WeatherProvider {
  private locationCache = new Map<string, Promise<string>>()
  private forecastCache = new Map<string, { fetchedAt: number; promise: Promise<any> }>()
  private alertCache = new Map<string, { fetchedAt: number; promise: Promise<WeatherAlert[]> }>()
  readonly definition = {
    id: 'qweather' as const,
    name: '和风天气',
    description: '支持经纬度 10 天精细预报和城市 30 天预报，使用用户自己的 API Host 与认证凭据。',
    maxForecastDays: 30,
    configuration: 'independent' as const,
    supportsAlerts: true,
    alertLookaheadDays: 3,
  }

  getConfiguredMaxForecastDays(): number { return readQWeatherConfig()?.forecastDays ?? this.definition.maxForecastDays }
  isConfigured(): boolean { return Boolean(readQWeatherConfig()) }
  clearCache(): void { this.locationCache.clear(); this.forecastCache.clear(); this.alertCache.clear() }

  async getActiveAlerts(place: Place): Promise<WeatherAlert[]> {
    const config = readQWeatherConfig()
    if (!config) return []
    const key = `${config.apiHost}|${place.lat.toFixed(2)},${place.lng.toFixed(2)}`
    const cached = this.alertCache.get(key)
    if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached.promise
    const request = (async () => {
      const url = new URL(`/weatheralert/v1/current/${place.lat.toFixed(2)}/${place.lng.toFixed(2)}`, `${config.apiHost}/`)
      url.searchParams.set('localTime', 'true')
      url.searchParams.set('lang', 'zh')
      const response = await fetch(url, { headers: this.auth(config) })
      if (!response.ok) throw new Error(`和风天气预警请求失败（HTTP ${response.status}）`)
      const data = await response.json() as any
      return (data?.alerts ?? []).map((alert: any): WeatherAlert => ({
        id: String(alert.id || `${alert.eventType?.code ?? 'alert'}-${alert.effectiveTime ?? Date.now()}`),
        providerId: 'qweather', providerName: this.definition.name,
        eventName: String(alert.eventType?.name || '天气预警'),
        headline: String(alert.headline || alert.eventType?.name || '天气预警'),
        description: String(alert.description || alert.headline || ''),
        instruction: alert.instruction ? String(alert.instruction) : undefined,
        severity: this.normalizeSeverity(alert.severity),
        urgency: alert.urgency ? String(alert.urgency) : undefined,
        certainty: alert.certainty ? String(alert.certainty) : undefined,
        source: alert.senderName ? String(alert.senderName) : this.definition.name,
        effectiveAt: alert.effectiveTime ? String(alert.effectiveTime) : undefined,
        expiresAt: alert.expireTime ? String(alert.expireTime) : undefined,
        attributions: (data?.metadata?.attributions ?? []).map((item: any) => String(item.name || '')).filter(Boolean),
      }))
    })()
    this.alertCache.set(key, { fetchedAt: Date.now(), promise: request })
    void request.catch(() => this.alertCache.delete(key))
    return request
  }

  async getDailyWeather(place: Place, date: string): Promise<DailyWeatherResult> {
    const fetchedAt = Date.now()
    const config = readQWeatherConfig()
    if (!config) return { status: 'error', providerId: 'qweather', providerName: this.definition.name, date, fetchedAt, reason: '尚未配置和风天气' }
    const offset = daysFromToday(date)
    if (offset < 0 || offset >= config.forecastDays) return { status: 'unavailable', providerId: 'qweather', providerName: this.definition.name, date, fetchedAt, reason: `当前和风天气配置最长支持 ${config.forecastDays} 天预报` }

    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => controller.abort(), 15_000)
    try {
      const location = config.forecastDays === 10 ? `${place.lng},${place.lat}` : await this.resolveLocationId(config, place, controller.signal)
      const cacheKey = `${config.apiHost}|${location}|${config.forecastDays}`
      const cached = this.forecastCache.get(cacheKey)
      const request = cached && Date.now() - cached.fetchedAt < 30 * 60_000
        ? cached.promise
        : this.fetchForecast(config, location, controller.signal)
      if (!cached || Date.now() - cached.fetchedAt >= 30 * 60_000) {
        this.forecastCache.set(cacheKey, { fetchedAt: Date.now(), promise: request })
        void request.catch(() => this.forecastCache.delete(cacheKey))
      }
      const data = await request
      if (config.forecastDays === 10) {
        const forecast = (data?.days ?? []).find((item: any) => String(item.forecastStartTime ?? '').slice(0, 10) === date)
        if (!forecast) return { status: 'unavailable', providerId: 'qweather', providerName: this.definition.name, date, fetchedAt, reason: '当前返回结果中没有该日期的天气预报' }
        const daytime = forecast.daytime ?? {}
        const condition = String(daytime.condition?.text || forecast.nighttime?.condition?.text || '天气')
        const probability = numberOrUndefined(daytime.precipitation?.probability)
        return {
          status: 'available', providerId: 'qweather', providerName: this.definition.name, date, condition,
          kind: weatherKindFromCondition(condition, String(daytime.precipitation?.type ?? '')),
          minTemp: numberOrUndefined(forecast.temperatureMin?.value), maxTemp: numberOrUndefined(forecast.temperatureMax?.value),
          dayWind: daytime.wind?.direction?.compass ? String(daytime.wind.direction.compass).toUpperCase() : undefined,
          dayPower: daytime.wind?.scale != null ? `${daytime.wind.scale}级` : daytime.wind?.speed?.value != null ? `${daytime.wind.speed.value} ${daytime.wind.speed.unit ?? ''}`.trim() : undefined,
          precipitationProbability: probability == null ? undefined : Math.round(probability <= 1 ? probability * 100 : probability),
          reportedAt: forecast.forecastStartTime ? String(forecast.forecastStartTime) : undefined,
          fetchedAt,
        }
      }
      const forecast = (data?.daily ?? []).find((item: any) => String(item.fxDate) === date)
      if (!forecast) return { status: 'unavailable', providerId: 'qweather', providerName: this.definition.name, date, fetchedAt, reason: '当前返回结果中没有该日期的天气预报' }
      const condition = String(forecast.textDay || forecast.textNight || '天气')
      return {
        status: 'available', providerId: 'qweather', providerName: this.definition.name, date, condition,
        kind: weatherKindFromCondition(condition), minTemp: numberOrUndefined(forecast.tempMin), maxTemp: numberOrUndefined(forecast.tempMax),
        dayWind: forecast.windDirDay ? String(forecast.windDirDay) : undefined,
        dayPower: forecast.windScaleDay ? `${forecast.windScaleDay}级` : undefined,
        precipitationProbability: numberOrUndefined(forecast.pop),
        reportedAt: data?.updateTime ? String(data.updateTime) : undefined,
        fetchedAt,
      }
    } catch (error) {
      const reason = error instanceof DOMException && error.name === 'AbortError' ? '和风天气请求超时' : error instanceof Error ? error.message : '和风天气查询失败'
      return { status: 'error', providerId: 'qweather', providerName: this.definition.name, date, fetchedAt, reason }
    } finally {
      globalThis.clearTimeout(timer)
    }
  }

  private auth(config: QWeatherConfig): HeadersInit {
    return config.authType === 'api-key' ? { 'X-QW-Api-Key': config.credential } : { Authorization: `Bearer ${config.credential}` }
  }

  private resolveLocationId(config: QWeatherConfig, place: Place, signal: AbortSignal): Promise<string> {
    const key = `${config.apiHost}|${place.lng.toFixed(4)},${place.lat.toFixed(4)}`
    const cached = this.locationCache.get(key)
    if (cached) return cached
    const request = (async () => {
      const url = new URL('/geo/v2/city/lookup', `${config.apiHost}/`)
      url.searchParams.set('location', `${place.lng},${place.lat}`)
      const response = await fetch(url, { headers: this.auth(config), signal })
      if (!response.ok) throw new Error(`和风天气 GeoAPI 请求失败（HTTP ${response.status}）`)
      const data = await response.json() as any
      if (String(data?.code) !== '200' || !data?.location?.[0]?.id) throw new Error(`无法确定“${place.name}”的和风天气 LocationID`)
      return String(data.location[0].id)
    })()
    this.locationCache.set(key, request)
    void request.catch(() => this.locationCache.delete(key))
    return request
  }

  private normalizeSeverity(value: unknown): WeatherAlert['severity'] {
    const severity = String(value ?? '').toLowerCase()
    return severity === 'extreme' || severity === 'severe' || severity === 'moderate' || severity === 'minor' ? severity : 'unknown'
  }

  private async fetchForecast(config: QWeatherConfig, location: string, signal: AbortSignal): Promise<any> {
    const url = config.forecastDays === 10
      ? new URL(`/weather/v1/daily/${placeCoordinate(location, 'lat')}/${placeCoordinate(location, 'lng')}`, `${config.apiHost}/`)
      : new URL('/v7/weather/30d', `${config.apiHost}/`)
    if (config.forecastDays === 10) {
      url.searchParams.set('days', '10')
      url.searchParams.set('localTime', 'true')
      url.searchParams.set('lang', 'zh')
    } else {
      url.searchParams.set('location', location)
      url.searchParams.set('lang', 'zh')
      url.searchParams.set('unit', 'm')
    }
    const response = await fetch(url, { headers: this.auth(config), signal })
    if (!response.ok) throw new Error(`和风天气请求失败（HTTP ${response.status}）`)
    const data = await response.json() as any
    if (config.forecastDays === 30 && String(data?.code) !== '200') throw new Error(`和风天气返回错误代码 ${data?.code ?? 'unknown'}`)
    return data
  }
}

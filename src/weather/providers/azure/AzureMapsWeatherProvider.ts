import type { Place } from '../../../domain/types'
import { weatherKindFromCondition } from '../../conditions'
import type { DailyWeatherResult, WeatherAlert, WeatherProvider } from '../../types'
import { readAzureMapsWeatherConfig } from './config'
import { currentLocale } from '../../../i18n'

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

export class AzureMapsWeatherProvider implements WeatherProvider {
  private forecastCache = new Map<string, { fetchedAt: number; promise: Promise<any> }>()
  private alertCache = new Map<string, { fetchedAt: number; promise: Promise<WeatherAlert[]> }>()
  readonly definition = {
    id: 'azure-maps' as const,
    name: 'Azure Maps Weather',
    description: '按经纬度提供最长 45 天的每日天气预报，实际范围取决于 Azure Maps 服务层级。',
    maxForecastDays: 45,
    configuration: 'independent' as const,
    supportsAlerts: true,
    alertLookaheadDays: 3,
  }

  getConfiguredMaxForecastDays(): number {
    return readAzureMapsWeatherConfig()?.forecastDays ?? this.definition.maxForecastDays
  }

  isConfigured(): boolean {
    return Boolean(readAzureMapsWeatherConfig())
  }

  clearCache(): void { this.forecastCache.clear(); this.alertCache.clear() }

  async getActiveAlerts(place: Place): Promise<WeatherAlert[]> {
    const config = readAzureMapsWeatherConfig()
    if (!config) return []
    const key = `${config.endpoint}|${place.lat.toFixed(3)},${place.lng.toFixed(3)}`
    const cached = this.alertCache.get(key)
    if (cached && Date.now() - cached.fetchedAt < 10 * 60_000) return cached.promise
    const request = (async () => {
      const url = new URL('/weather/severe/alerts/json', `${config.endpoint}/`)
      url.searchParams.set('api-version', '1.1')
      url.searchParams.set('query', `${place.lat},${place.lng}`)
      url.searchParams.set('language', currentLocale())
      url.searchParams.set('details', 'true')
      const response = await fetch(url, { headers: { 'subscription-key': config.subscriptionKey } })
      if (!response.ok) throw new Error(`Azure Maps 天气预警请求失败（HTTP ${response.status}）`)
      const data = await response.json() as any
      return (data?.results ?? []).flatMap((result: any) => (result.alertAreas ?? [{}])
        .filter((area: any) => !['cancel', 'expire'].includes(String(area.latestStatus?.english ?? '').toLowerCase()))
        .map((area: any, index: number): WeatherAlert => ({
        id: String(result.alertId || `${result.category ?? 'alert'}-${index}`),
        providerId: 'azure-maps', providerName: this.definition.name,
        eventName: String(result.category || result.description?.localized || '恶劣天气预警'),
        headline: String(area.summary || result.description?.localized || result.category || '恶劣天气预警'),
        description: String(area.alertDetails || area.summary || result.description?.localized || ''),
        severity: this.azureSeverity(result.level ?? result.priority, area.alertDetails),
        source: result.source ? String(result.source) : this.definition.name,
        effectiveAt: area.startTime ? String(area.startTime) : undefined,
        expiresAt: area.endTime ? String(area.endTime) : undefined,
      })))
    })()
    this.alertCache.set(key, { fetchedAt: Date.now(), promise: request })
    void request.catch(() => this.alertCache.delete(key))
    return request
  }

  async getDailyWeather(place: Place, date: string): Promise<DailyWeatherResult> {
    const fetchedAt = Date.now()
    const config = readAzureMapsWeatherConfig()
    if (!config) return { status: 'error', providerId: 'azure-maps', providerName: this.definition.name, date, fetchedAt, reason: '尚未配置 Azure Maps Weather' }
    const offset = daysFromToday(date)
    if (offset < 0 || offset >= config.forecastDays) {
      return { status: 'unavailable', providerId: 'azure-maps', providerName: this.definition.name, date, fetchedAt, reason: `当前 Azure Maps 配置最长支持 ${config.forecastDays} 天预报` }
    }

    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => controller.abort(), 15_000)
    try {
      const cacheKey = `${config.endpoint}|${place.lat.toFixed(4)},${place.lng.toFixed(4)}|${config.forecastDays}`
      const cached = this.forecastCache.get(cacheKey)
      const request = cached && Date.now() - cached.fetchedAt < 30 * 60_000
        ? cached.promise
        : this.fetchForecast(config.endpoint, config.subscriptionKey, config.forecastDays, place, controller.signal)
      if (!cached || Date.now() - cached.fetchedAt >= 30 * 60_000) {
        this.forecastCache.set(cacheKey, { fetchedAt: Date.now(), promise: request })
        void request.catch(() => { this.forecastCache.delete(cacheKey) })
      }
      const data = await request
      const forecast = (data?.forecasts ?? []).find((item: any) => String(item.date ?? '').slice(0, 10) === date)
      if (!forecast) return { status: 'unavailable', providerId: 'azure-maps', providerName: this.definition.name, date, fetchedAt, reason: '当前返回结果中没有该日期的天气预报' }
      const condition = String(forecast.day?.iconPhrase || forecast.day?.shortPhrase || forecast.night?.iconPhrase || '天气')
      return {
        status: 'available', providerId: 'azure-maps', providerName: this.definition.name, date, condition,
        kind: weatherKindFromCondition(condition, String(forecast.day?.precipitationType ?? '')),
        minTemp: numberOrUndefined(forecast.temperature?.minimum?.value),
        maxTemp: numberOrUndefined(forecast.temperature?.maximum?.value),
        dayWind: forecast.day?.wind?.direction?.localizedDescription ? String(forecast.day.wind.direction.localizedDescription) : undefined,
        dayPower: forecast.day?.wind?.speed?.value != null ? `${forecast.day.wind.speed.value} km/h` : undefined,
        precipitationProbability: numberOrUndefined(forecast.day?.precipitationProbability),
        reportedAt: data?.summary?.startDate ? String(data.summary.startDate) : undefined,
        fetchedAt,
      }
    } catch (error) {
      const reason = error instanceof DOMException && error.name === 'AbortError' ? 'Azure Maps Weather 请求超时' : error instanceof Error ? error.message : 'Azure Maps Weather 查询失败'
      return { status: 'error', providerId: 'azure-maps', providerName: this.definition.name, date, fetchedAt, reason }
    } finally {
      globalThis.clearTimeout(timer)
    }
  }

  private azureSeverity(priority: unknown, details: unknown): WeatherAlert['severity'] {
    const level = String(priority ?? '').toLowerCase()
    const text = `${level} ${String(details ?? '').toLowerCase()}`
    if (/extreme|red|红色|emergency/.test(text)) return 'extreme'
    if (/severe|orange|橙色/.test(text)) return 'severe'
    if (/moderate|yellow|黄色/.test(text)) return 'moderate'
    if (/minor|blue|蓝色/.test(text)) return 'minor'
    const value = Number(priority)
    if (Number.isFinite(value) && value <= 1) return 'severe'
    if (Number.isFinite(value) && value <= 2) return 'moderate'
    return 'minor'
  }

  private async fetchForecast(endpoint: string, subscriptionKey: string, forecastDays: number, place: Place, signal: AbortSignal): Promise<any> {
    const url = new URL('/weather/forecast/daily/json', `${endpoint}/`)
    url.searchParams.set('api-version', '1.1')
    url.searchParams.set('query', `${place.lat},${place.lng}`)
    url.searchParams.set('unit', 'metric')
    url.searchParams.set('duration', String(forecastDays))
    url.searchParams.set('language', currentLocale())
    const response = await fetch(url, { headers: { 'subscription-key': subscriptionKey }, signal })
    if (!response.ok) throw new Error(`Azure Maps Weather 请求失败（HTTP ${response.status}）`)
    return response.json()
  }
}

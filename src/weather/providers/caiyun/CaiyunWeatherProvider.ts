import type { Place } from '../../../domain/types'
import { weatherKindFromCondition } from '../../conditions'
import type { DailyWeatherResult, WeatherProvider } from '../../types'
import { readCaiyunWeatherConfig } from './config'

const skyconLabels: Record<string, string> = {
  CLEAR_DAY: '晴', CLEAR_NIGHT: '晴', PARTLY_CLOUDY_DAY: '多云', PARTLY_CLOUDY_NIGHT: '多云', CLOUDY: '阴',
  LIGHT_HAZE: '轻度雾霾', MODERATE_HAZE: '中度雾霾', HEAVY_HAZE: '重度雾霾',
  LIGHT_RAIN: '小雨', MODERATE_RAIN: '中雨', HEAVY_RAIN: '大雨', STORM_RAIN: '暴雨', FOG: '雾',
  LIGHT_SNOW: '小雪', MODERATE_SNOW: '中雪', HEAVY_SNOW: '大雪', STORM_SNOW: '暴雪', DUST: '浮尘', SAND: '沙尘', WIND: '大风',
}

function daysFromToday(dateKey: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(`${dateKey}T00:00:00`)
  return Math.round((target.getTime() - today.getTime()) / 86_400_000)
}

function dateItem(items: any[], date: string): any {
  return (items ?? []).find((item) => String(item?.date ?? '').slice(0, 10) === date)
}

function precipitationProbability(value: unknown): number | undefined {
  const number = Number(value)
  if (!Number.isFinite(number)) return undefined
  return Math.round(Math.min(100, Math.max(0, number <= 1 ? number * 100 : number)))
}

function windDirection(degrees: unknown): string | undefined {
  const value = Number(degrees)
  if (!Number.isFinite(value)) return undefined
  const labels = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
  return labels[Math.round(((value % 360) + 360) % 360 / 45) % 8]
}

export class CaiyunWeatherProvider implements WeatherProvider {
  private forecastCache = new Map<string, { fetchedAt: number; promise: Promise<any> }>()
  readonly definition = {
    id: 'caiyun' as const,
    name: '彩云天气',
    description: '按经纬度提供通常最长 15 天的逐日天气，实际返回天数取决于彩云套餐。',
    maxForecastDays: 15,
    configuration: 'independent' as const,
  }

  getConfiguredMaxForecastDays(): number { return readCaiyunWeatherConfig()?.forecastDays ?? this.definition.maxForecastDays }
  isConfigured(): boolean { return Boolean(readCaiyunWeatherConfig()) }
  clearCache(): void { this.forecastCache.clear() }

  async getDailyWeather(place: Place, date: string): Promise<DailyWeatherResult> {
    const fetchedAt = Date.now()
    const config = readCaiyunWeatherConfig()
    if (!config) return { status: 'error', providerId: 'caiyun', providerName: this.definition.name, date, fetchedAt, reason: '尚未配置彩云天气' }
    const offset = daysFromToday(date)
    if (offset < 0 || offset >= config.forecastDays) return { status: 'unavailable', providerId: 'caiyun', providerName: this.definition.name, date, fetchedAt, reason: `当前彩云天气配置最长支持 ${config.forecastDays} 天预报` }

    const controller = new AbortController()
    const timer = globalThis.setTimeout(() => controller.abort(), 15_000)
    try {
      const cacheKey = `${config.endpoint}|${place.lng.toFixed(4)},${place.lat.toFixed(4)}|${config.forecastDays}`
      const cached = this.forecastCache.get(cacheKey)
      const request = cached && Date.now() - cached.fetchedAt < 30 * 60_000 ? cached.promise : this.fetchForecast(config.endpoint, config.token, config.forecastDays, place, controller.signal)
      if (!cached || Date.now() - cached.fetchedAt >= 30 * 60_000) {
        this.forecastCache.set(cacheKey, { fetchedAt: Date.now(), promise: request })
        void request.catch(() => this.forecastCache.delete(cacheKey))
      }
      const data = await request
      const daily = data?.result?.daily
      const temperature = dateItem(daily?.temperature, date)
      const skycon = dateItem(daily?.skycon_08h_20h, date) ?? dateItem(daily?.skycon, date)
      if (!temperature && !skycon) return { status: 'unavailable', providerId: 'caiyun', providerName: this.definition.name, date, fetchedAt, reason: '当前返回结果中没有该日期的天气预报' }
      const condition = skyconLabels[String(skycon?.value ?? '')] ?? String(skycon?.value ?? '天气')
      const wind = dateItem(daily?.wind_08h_20h, date) ?? dateItem(daily?.wind, date)
      const precipitation = dateItem(daily?.precipitation, date)
      return {
        status: 'available', providerId: 'caiyun', providerName: this.definition.name, date, condition,
        kind: weatherKindFromCondition(condition), minTemp: Number.isFinite(Number(temperature?.min)) ? Number(temperature.min) : undefined,
        maxTemp: Number.isFinite(Number(temperature?.max)) ? Number(temperature.max) : undefined,
        dayWind: windDirection(wind?.avg?.direction),
        dayPower: Number.isFinite(Number(wind?.avg?.speed)) ? `${Math.round(Number(wind.avg.speed))} km/h` : undefined,
        precipitationProbability: precipitationProbability(precipitation?.probability),
        reportedAt: Number.isFinite(Number(data?.server_time)) ? new Date(Number(data.server_time) * 1000).toISOString() : undefined,
        fetchedAt,
      }
    } catch (error) {
      const reason = error instanceof DOMException && error.name === 'AbortError' ? '彩云天气请求超时' : error instanceof Error ? error.message : '彩云天气查询失败'
      return { status: 'error', providerId: 'caiyun', providerName: this.definition.name, date, fetchedAt, reason }
    } finally {
      globalThis.clearTimeout(timer)
    }
  }

  private async fetchForecast(endpoint: string, token: string, forecastDays: number, place: Place, signal: AbortSignal): Promise<any> {
    const url = new URL(`/v2.6/${encodeURIComponent(token)}/${place.lng},${place.lat}/daily`, `${endpoint}/`)
    url.searchParams.set('dailysteps', String(forecastDays))
    url.searchParams.set('dailystart', '0')
    url.searchParams.set('lang', 'zh_CN')
    url.searchParams.set('unit', 'metric')
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`彩云天气请求失败（HTTP ${response.status}）`)
    const data = await response.json() as any
    if (data?.status !== 'ok' || data?.result?.daily?.status !== 'ok') throw new Error(String(data?.error || '彩云天气返回了无效结果'))
    return data
  }
}

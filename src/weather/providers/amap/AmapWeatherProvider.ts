import { hasAmapConfig } from '../../../map/providers/amap/config'
import { loadAmap } from '../../../map/providers/amap/loader'
import type { Place } from '../../../domain/types'
import { projectPlaceCoordinates } from '../../../map/coordinates'
import { weatherKindFromCondition } from '../../conditions'
import type { DailyWeatherResult, WeatherProvider } from '../../types'

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

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

export class AmapWeatherProvider implements WeatherProvider {
  readonly definition = {
    id: 'amap' as const,
    name: '高德天气',
    description: '跟随高德地图 JavaScript API 配置，提供当前日期起 4 天的城市级天气预报。',
    maxForecastDays: 4,
    configuration: 'map-provider' as const,
  }

  isConfigured(): boolean { return hasAmapConfig() }

  clearCache(): void {
    this.adcodeCache.clear()
    this.forecastCache.clear()
  }

  private adcodeCache = new Map<string, Promise<string>>()
  private forecastCache = new Map<string, { fetchedAt: number; promise: Promise<any> }>()

  async getDailyWeather(place: Place, date: string): Promise<DailyWeatherResult> {
    const fetchedAt = Date.now()
    const offset = daysFromToday(date)
    if (offset < 0 || offset >= this.definition.maxForecastDays) {
      return { status: 'unavailable', providerId: 'amap', providerName: this.definition.name, date, fetchedAt, reason: `高德天气仅提供从 ${localDateKey(new Date())} 起 ${this.definition.maxForecastDays} 天的预报` }
    }
    if (!hasAmapConfig()) {
      return { status: 'error', providerId: 'amap', providerName: this.definition.name, date, fetchedAt, reason: '尚未配置高德地图，无法查询高德天气' }
    }

    try {
      const sdk = await loadAmap()
      const adcode = await this.resolveAdcode(sdk, place)
      const data = await this.getForecast(sdk, adcode)
      const forecast = (data?.forecasts ?? []).find((item: any) => String(item.date) === date)
      if (!forecast) return { status: 'unavailable', providerId: 'amap', providerName: this.definition.name, date, fetchedAt, reason: '当前返回结果中没有该日期的天气预报' }
      const condition = String(forecast.dayWeather || forecast.nightWeather || '天气')
      return {
        status: 'available', providerId: 'amap', providerName: this.definition.name, date, condition,
        kind: weatherKindFromCondition(condition), minTemp: numberOrUndefined(forecast.nightTemp), maxTemp: numberOrUndefined(forecast.dayTemp),
        dayWind: forecast.dayWind ? String(forecast.dayWind) : undefined,
        dayPower: forecast.dayPower ? String(forecast.dayPower) : undefined,
        reportedAt: data?.reportTime ? String(data.reportTime) : undefined,
        fetchedAt,
      }
    } catch (error) {
      return { status: 'error', providerId: 'amap', providerName: this.definition.name, date, fetchedAt, reason: error instanceof Error ? error.message : '高德天气查询失败' }
    }
  }

  private resolveAdcode(sdk: any, place: Place): Promise<string> {
    const providerPlace = projectPlaceCoordinates(place, 'GCJ02')
    const key = `${providerPlace.lng.toFixed(4)},${providerPlace.lat.toFixed(4)}`
    const cached = this.adcodeCache.get(key)
    if (cached) return cached
    const request = new Promise<string>((resolve, reject) => {
      const geocoder = new sdk.Geocoder({ radius: 1000, extensions: 'base' })
      geocoder.getAddress(new sdk.LngLat(providerPlace.lng, providerPlace.lat), (status: string, result: any) => {
        const adcode = status === 'complete' ? result?.regeocode?.addressComponent?.adcode : null
        if (adcode) resolve(String(adcode))
        else reject(new Error(`无法确定“${place.name}”所在的天气城市`))
      })
    })
    this.adcodeCache.set(key, request)
    void request.catch(() => { this.adcodeCache.delete(key) })
    return request
  }

  private getForecast(sdk: any, adcode: string): Promise<any> {
    const cached = this.forecastCache.get(adcode)
    if (cached && Date.now() - cached.fetchedAt < 30 * 60_000) return cached.promise
    const promise = new Promise<any>((resolve, reject) => {
      const weather = new sdk.Weather()
      weather.getForecast(adcode, (error: unknown, data: any) => {
        if (error) reject(new Error('高德天气预报查询失败'))
        else resolve(data)
      })
    })
    this.forecastCache.set(adcode, { fetchedAt: Date.now(), promise })
    void promise.catch(() => { this.forecastCache.delete(adcode) })
    return promise
  }
}

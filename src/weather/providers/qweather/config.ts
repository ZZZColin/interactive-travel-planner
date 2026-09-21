export type QWeatherAuthType = 'api-key' | 'jwt'
export interface QWeatherConfig {
  apiHost: string
  authType: QWeatherAuthType
  credential: string
  forecastDays: 10 | 30
}

const STORAGE_KEY = 'interactiveTravel.weather.qweather.config.v1'

function normalize(value?: Partial<QWeatherConfig> | null): QWeatherConfig | null {
  const apiHost = String(value?.apiHost ?? '').trim().replace(/\/+$/, '')
  const credential = String(value?.credential ?? '').trim()
  const authType: QWeatherAuthType = value?.authType === 'jwt' ? 'jwt' : 'api-key'
  const forecastDays = value?.forecastDays === 30 ? 30 : 10
  if (!apiHost || !credential) return null
  return { apiHost, authType, credential, forecastDays }
}

export function readQWeatherConfig(): QWeatherConfig | null {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { return null }
}

export function saveQWeatherConfig(value: QWeatherConfig): QWeatherConfig {
  const normalized = normalize(value)
  if (!normalized) throw new Error('请填写和风天气 API Host 和认证凭据')
  if (!/^https:\/\//i.test(normalized.apiHost)) throw new Error('和风天气 API Host 必须使用 HTTPS')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function clearQWeatherConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

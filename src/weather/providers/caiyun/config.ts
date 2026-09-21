export interface CaiyunWeatherConfig {
  endpoint: string
  token: string
  forecastDays: 5 | 10 | 15
}

const STORAGE_KEY = 'interactiveTravel.weather.caiyun.config.v1'

function normalize(value?: Partial<CaiyunWeatherConfig> | null): CaiyunWeatherConfig | null {
  const endpoint = String(value?.endpoint ?? '').trim().replace(/\/+$/, '')
  const token = String(value?.token ?? '').trim()
  const forecastDays = value?.forecastDays === 5 || value?.forecastDays === 10 || value?.forecastDays === 15 ? value.forecastDays : 15
  if (!endpoint || !token) return null
  return { endpoint, token, forecastDays }
}

export function readCaiyunWeatherConfig(): CaiyunWeatherConfig | null {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { return null }
}

export function saveCaiyunWeatherConfig(value: CaiyunWeatherConfig): CaiyunWeatherConfig {
  const normalized = normalize(value)
  if (!normalized) throw new Error('请填写彩云天气 Endpoint 和 Token')
  if (!/^https:\/\//i.test(normalized.endpoint)) throw new Error('彩云天气 Endpoint 必须使用 HTTPS')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function clearCaiyunWeatherConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

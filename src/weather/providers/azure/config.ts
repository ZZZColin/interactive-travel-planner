export interface AzureMapsWeatherConfig {
  endpoint: string
  subscriptionKey: string
  forecastDays: 15 | 25 | 45
}

const STORAGE_KEY = 'interactiveTravel.weather.azure-maps.config.v1'

function normalize(value?: Partial<AzureMapsWeatherConfig> | null): AzureMapsWeatherConfig | null {
  const endpoint = String(value?.endpoint ?? '').trim().replace(/\/+$/, '')
  const subscriptionKey = String(value?.subscriptionKey ?? '').trim()
  const forecastDays = value?.forecastDays === 15 || value?.forecastDays === 25 || value?.forecastDays === 45 ? value.forecastDays : 45
  if (!endpoint || !subscriptionKey) return null
  return { endpoint, subscriptionKey, forecastDays }
}

export function readAzureMapsWeatherConfig(): AzureMapsWeatherConfig | null {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { return null }
}

export function saveAzureMapsWeatherConfig(value: AzureMapsWeatherConfig): AzureMapsWeatherConfig {
  const normalized = normalize(value)
  if (!normalized) throw new Error('请填写 Azure Maps Endpoint 和 Subscription Key')
  if (!/^https:\/\//i.test(normalized.endpoint)) throw new Error('Azure Maps Endpoint 必须使用 HTTPS')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function clearAzureMapsWeatherConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

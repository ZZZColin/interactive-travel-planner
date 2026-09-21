export interface GoogleMapConfig {
  apiKey: string
  mapId?: string
  language: string
  region: string
}

const STORAGE_KEY = 'interactiveTravel.map.google.config'

function normalize(value: Partial<GoogleMapConfig> | null | undefined): GoogleMapConfig | null {
  const apiKey = value?.apiKey?.trim() ?? ''
  if (!apiKey) return null
  return {
    apiKey,
    mapId: value?.mapId?.trim() || undefined,
    language: value?.language?.trim() || 'zh-CN',
    region: value?.region?.trim().toUpperCase() || 'CN',
  }
}

export function readGoogleMapConfig(): GoogleMapConfig | null {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { return null }
}

export function hasGoogleMapConfig(): boolean {
  return readGoogleMapConfig() !== null
}

export function saveGoogleMapConfig(config: GoogleMapConfig): void {
  const normalized = normalize(config)
  if (!normalized) throw new Error('请填写 Google Maps API Key')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
}

export function clearGoogleMapConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

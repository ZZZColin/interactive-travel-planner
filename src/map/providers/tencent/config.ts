export interface TencentMapConfig {
  key: string
  serviceSk?: string
  mapStyleId?: string
}

const STORAGE_KEY = 'interactiveTravel.map.tencent.config'

function normalize(value: Partial<TencentMapConfig> | null | undefined): TencentMapConfig | null {
  const key = value?.key?.trim() ?? ''
  const serviceSk = value?.serviceSk?.trim() || undefined
  const mapStyleId = value?.mapStyleId?.trim() || undefined
  return key ? { key, serviceSk, mapStyleId } : null
}

export function readTencentMapConfig(): TencentMapConfig | null {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { return null }
}

export function hasTencentMapConfig(): boolean {
  return readTencentMapConfig() !== null
}

export function saveTencentMapConfig(config: TencentMapConfig): void {
  const normalized = normalize(config)
  if (!normalized) throw new Error('请填写腾讯位置服务 JavaScript API Key')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
}

export function clearTencentMapConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

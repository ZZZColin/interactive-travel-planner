export interface AmapConfig {
  key: string
  securityJsCode: string
  webServiceKey?: string
}

const STORAGE_KEY = 'interactiveTravel.map.amap.config'
const LEGACY_STORAGE_KEY = 'routePlannerAmapConfig'

function normalize(value: Partial<AmapConfig> | null | undefined): AmapConfig | null {
  const key = value?.key?.trim() ?? ''
  const securityJsCode = value?.securityJsCode?.trim() ?? ''
  const webServiceKey = value?.webServiceKey?.trim() || undefined
  return key && securityJsCode ? { key, securityJsCode, webServiceKey } : null
}

export function readAmapConfig(): AmapConfig | null {
  try {
    const current = normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'))
    if (current) return current

    const legacy = normalize(JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) ?? 'null'))
    if (legacy) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy))
      localStorage.removeItem(LEGACY_STORAGE_KEY)
      return legacy
    }
  } catch {
    return null
  }
  return null
}

export function hasAmapConfig(): boolean {
  return readAmapConfig() !== null
}

export function saveAmapConfig(config: AmapConfig): void {
  const normalized = normalize(config)
  if (!normalized) throw new Error('请同时填写高德 Web Key 和 securityJsCode')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

export function clearAmapConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

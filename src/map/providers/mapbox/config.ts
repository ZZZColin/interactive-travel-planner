export interface MapboxConfig {
  accessToken: string
  styleUrl: string
  satelliteStyleUrl: string
  terrainEnabled: boolean
  terrainExaggeration: number
  buildings3dEnabled: boolean
}

const STORAGE_KEY = 'interactiveTravel.map.mapbox.config.v1'

export const defaultMapboxConfig: Omit<MapboxConfig, 'accessToken'> = {
  styleUrl: 'mapbox://styles/mapbox/streets-v12',
  satelliteStyleUrl: 'mapbox://styles/mapbox/satellite-streets-v12',
  terrainEnabled: true,
  terrainExaggeration: 1,
  buildings3dEnabled: true,
}

function normalize(value: Partial<MapboxConfig> | null | undefined): MapboxConfig | null {
  const accessToken = value?.accessToken?.trim() ?? ''
  if (!accessToken) return null
  return {
    accessToken,
    styleUrl: value?.styleUrl?.trim() || defaultMapboxConfig.styleUrl,
    satelliteStyleUrl: value?.satelliteStyleUrl?.trim() || defaultMapboxConfig.satelliteStyleUrl,
    terrainEnabled: value?.terrainEnabled !== false,
    terrainExaggeration: Math.max(0.1, Math.min(5, Number(value?.terrainExaggeration) || 1)),
    buildings3dEnabled: value?.buildings3dEnabled !== false,
  }
}

export function readMapboxConfig(): MapboxConfig | null {
  try { return normalize(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')) } catch { return null }
}

export function hasMapboxConfig(): boolean {
  return readMapboxConfig() !== null
}

export function saveMapboxConfig(config: MapboxConfig): void {
  const normalized = normalize(config)
  if (!normalized) throw new Error('请填写 Mapbox Public Access Token')
  if (!normalized.accessToken.startsWith('pk.')) throw new Error('浏览器端必须使用以 pk. 开头的 Mapbox Public Access Token，不能使用 Secret Token')
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
}

export function clearMapboxConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

export interface MapboxConnectionResult {
  styleName: string
  elapsedMs: number
}

function styleRequestUrl(styleUrl: string, accessToken: string): string {
  const match = /^mapbox:\/\/styles\/([^/]+)\/([^/?#]+)/i.exec(styleUrl.trim())
  if (match) return `https://api.mapbox.com/styles/v1/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}?access_token=${encodeURIComponent(accessToken)}`
  const url = new URL(styleUrl)
  if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', accessToken)
  return url.toString()
}

export async function testMapboxConnection(config: MapboxConfig): Promise<MapboxConnectionResult> {
  const normalized = normalize(config)
  if (!normalized) throw new Error('请先填写 Mapbox Public Access Token')
  if (!normalized.accessToken.startsWith('pk.')) throw new Error('Token 类型不正确：浏览器端需要使用以 pk. 开头的 Public Token')
  const startedAt = performance.now()
  let response: Response
  try {
    response = await fetch(styleRequestUrl(normalized.styleUrl, normalized.accessToken), { headers: { Accept: 'application/json' } })
  } catch (reason) {
    throw new Error(`无法连接 Mapbox Styles API：${reason instanceof Error ? reason.message : String(reason)}`)
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    if (response.status === 401) throw new Error('Mapbox Token 无效或已失效（HTTP 401）')
    if (response.status === 403) throw new Error('Mapbox 拒绝访问（HTTP 403），请检查 Token 的 URL 限制、作用域和当前访问地址')
    if (response.status === 404) throw new Error('Mapbox 样式不存在或当前 Token 无权访问（HTTP 404）')
    throw new Error(`Mapbox 样式连接失败（HTTP ${response.status}）${detail ? `：${detail.slice(0, 160)}` : ''}`)
  }
  const payload = await response.json().catch(() => ({})) as { name?: string }
  return { styleName: payload.name || normalized.styleUrl, elapsedMs: Math.round(performance.now() - startedAt) }
}

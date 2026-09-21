export type CesiumImageryMode = 'natural-earth' | 'world-imagery' | 'world-imagery-labels'

export interface CesiumMapConfig {
  ionToken?: string
  imageryMode: CesiumImageryMode
  useWorldTerrain: boolean
  useOsmBuildings: boolean
  terrainExaggeration: number
}

const STORAGE_KEY = 'interactiveTravel.map.cesium.config.v1'

export const defaultCesiumMapConfig: CesiumMapConfig = {
  imageryMode: 'natural-earth',
  useWorldTerrain: false,
  useOsmBuildings: false,
  terrainExaggeration: 1,
}

function normalize(value: Partial<CesiumMapConfig> | null | undefined): CesiumMapConfig {
  const ionToken = String(value?.ionToken ?? '').trim() || undefined
  const imageryMode: CesiumImageryMode = value?.imageryMode === 'world-imagery-labels' ? 'world-imagery-labels' : value?.imageryMode === 'world-imagery' ? 'world-imagery' : 'natural-earth'
  const terrainExaggeration = Math.max(0.1, Math.min(5, Number(value?.terrainExaggeration) || 1))
  return {
    ionToken,
    imageryMode,
    useWorldTerrain: Boolean(value?.useWorldTerrain && ionToken),
    useOsmBuildings: Boolean(value?.useOsmBuildings && ionToken),
    terrainExaggeration,
  }
}

export function readCesiumMapConfig(): CesiumMapConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? normalize(JSON.parse(raw)) : null
  } catch { return null }
}

export function hasCesiumMapConfig(): boolean {
  return localStorage.getItem(STORAGE_KEY) !== null
}

export function saveCesiumMapConfig(config: CesiumMapConfig): CesiumMapConfig {
  const normalized = normalize(config)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  return normalized
}

export function clearCesiumMapConfig(): void {
  localStorage.removeItem(STORAGE_KEY)
}

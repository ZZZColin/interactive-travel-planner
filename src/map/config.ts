export type MapProviderId = 'amap' | 'tencent' | 'google'
export type MapRendererId = MapProviderId | 'mapbox' | 'cesium'

export interface MapRuntimeSelection {
  rendererId: MapRendererId
  placeServiceId: MapProviderId
  routingServiceId: MapProviderId
}

export interface MapProviderDefinition {
  id: MapProviderId
  name: string
  shortName: string
  logo: string
  description: string
}

const STORAGE_KEY = 'interactiveTravel.map.activeProvider.v1'
const RUNTIME_SELECTION_KEY = 'interactiveTravel.map.runtimeSelection.v1'

export const mapProviderDefinitions: Record<MapProviderId, MapProviderDefinition> = {
  amap: { id: 'amap', name: '高德地图', shortName: '高德', logo: '高', description: '国内 POI、路线与公交数据' },
  tencent: { id: 'tencent', name: '腾讯地图', shortName: '腾讯', logo: '腾', description: '国内 POI、路线与实时交通' },
  google: { id: 'google', name: 'Google Maps', shortName: 'Google', logo: 'G', description: '国际地点与 Google Routes' },
}

export interface MapRendererDefinition {
  id: MapRendererId
  name: string
  shortName: string
  logo: string
  description: string
  available: boolean
}

export const mapRendererDefinitions: Record<MapRendererId, MapRendererDefinition> = {
  amap: { ...mapProviderDefinitions.amap, description: '高德 JavaScript API 2.0', available: true },
  tencent: { ...mapProviderDefinitions.tencent, description: '腾讯 JavaScript API GL', available: true },
  google: { ...mapProviderDefinitions.google, description: 'Google Maps JavaScript API', available: true },
  mapbox: { id: 'mapbox', name: 'Mapbox', shortName: 'Mapbox', logo: 'M', description: '矢量样式、地形与 3D 建筑', available: true },
  cesium: { id: 'cesium', name: 'Cesium 3D 地球', shortName: 'Cesium', logo: '3D', description: '三维地形、3D Tiles 与路线动画', available: true },
}

function mapProviderId(value: unknown): MapProviderId {
  return value === 'tencent' || value === 'google' ? value : 'amap'
}

function mapRendererId(value: unknown): MapRendererId {
  return value === 'cesium' || value === 'mapbox' ? value : mapProviderId(value)
}

export function isDataProviderRenderer(id: MapRendererId): id is MapProviderId {
  return id === 'amap' || id === 'tencent' || id === 'google'
}

export function normalizeMapRuntimeSelection(selection: MapRuntimeSelection, googleFallback: Exclude<MapProviderId, 'google'> = 'amap'): MapRuntimeSelection {
  if (selection.rendererId === 'google') return selection
  return {
    ...selection,
    placeServiceId: selection.placeServiceId === 'google' ? googleFallback : selection.placeServiceId,
    routingServiceId: selection.routingServiceId === 'google' ? googleFallback : selection.routingServiceId,
  }
}

export function readMapRuntimeSelection(): MapRuntimeSelection {
  try {
    const saved = JSON.parse(localStorage.getItem(RUNTIME_SELECTION_KEY) ?? 'null') as Partial<MapRuntimeSelection> | null
    if (saved) return normalizeMapRuntimeSelection({ rendererId: mapRendererId(saved.rendererId), placeServiceId: mapProviderId(saved.placeServiceId), routingServiceId: mapProviderId(saved.routingServiceId) })
  } catch { /* fall back to the current combined provider */ }
  const current = mapProviderId(localStorage.getItem(STORAGE_KEY))
  return { rendererId: current, placeServiceId: current, routingServiceId: current }
}

export function saveMapRuntimeSelection(selection: MapRuntimeSelection): void {
  const normalized = normalizeMapRuntimeSelection(selection)
  localStorage.setItem(RUNTIME_SELECTION_KEY, JSON.stringify(normalized))
  if (isDataProviderRenderer(normalized.rendererId)) localStorage.setItem(STORAGE_KEY, normalized.rendererId)
}

export function readActiveMapProviderId(): MapProviderId {
  const selection = readMapRuntimeSelection()
  return isDataProviderRenderer(selection.rendererId) ? selection.rendererId : selection.placeServiceId
}

export function saveActiveMapProviderId(id: MapProviderId): void {
  localStorage.setItem(STORAGE_KEY, id)
  saveMapRuntimeSelection({ rendererId: id, placeServiceId: id, routingServiceId: id })
}

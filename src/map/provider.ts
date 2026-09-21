import { reactive } from 'vue'
import type { PlanMapProvider, PlanMapRenderer } from './PlanMapProvider'
import { PlanMapRuntime } from './PlanMapRuntime'
import { mapProviderDefinitions, mapRendererDefinitions, normalizeMapRuntimeSelection, readMapRuntimeSelection, saveMapRuntimeSelection, type MapProviderId, type MapRendererId, type MapRuntimeSelection } from './config'
import { AmapProvider } from './providers/amap/AmapProvider'
import { hasAmapConfig } from './providers/amap/config'
import { CesiumRenderer } from './providers/cesium/CesiumRenderer'
import { hasCesiumMapConfig } from './providers/cesium/config'
import { GoogleMapProvider } from './providers/google/GoogleMapProvider'
import { hasGoogleMapConfig } from './providers/google/config'
import { MapboxRenderer } from './providers/mapbox/MapboxRenderer'
import { hasMapboxConfig } from './providers/mapbox/config'
import { TencentMapProvider } from './providers/tencent/TencentMapProvider'
import { hasTencentMapConfig } from './providers/tencent/config'

const initialSelection = readMapRuntimeSelection()

export const mapRuntimeState = reactive({
  selection: initialSelection,
  defaultSelection: initialSelection,
  rendererDefinition: mapRendererDefinitions[initialSelection.rendererId],
  providerDefinition: mapProviderDefinitions[initialSelection.placeServiceId],
  placeServiceDefinition: mapProviderDefinitions[initialSelection.placeServiceId],
  routingServiceDefinition: mapProviderDefinitions[initialSelection.routingServiceId],
  pendingRendererDefinition: null as (typeof mapRendererDefinitions)[MapRendererId] | null,
  switching: false,
  revision: 0,
})

const instances = new Map<MapProviderId, PlanMapProvider>()
function providerInstance(id: MapProviderId): PlanMapProvider {
  const current = instances.get(id)
  if (current) return current
  const created: PlanMapProvider = id === 'tencent' ? new TencentMapProvider() : id === 'google' ? new GoogleMapProvider() : new AmapProvider()
  instances.set(id, created)
  return created
}

function rendererInstance(id: MapRendererId): PlanMapRenderer {
  if (id === 'cesium') return new CesiumRenderer()
  if (id === 'mapbox') return new MapboxRenderer()
  return providerInstance(id)
}

function runtimeParts(selection: MapRuntimeSelection) {
  return { renderer: rendererInstance(selection.rendererId), places: providerInstance(selection.placeServiceId), routing: providerInstance(selection.routingServiceId) }
}

function applySelection(selection: MapRuntimeSelection, saveAsDefault: boolean): void {
  mapRuntimeState.selection = selection
  if (saveAsDefault) mapRuntimeState.defaultSelection = selection
  mapRuntimeState.rendererDefinition = mapRendererDefinitions[selection.rendererId]
  mapRuntimeState.providerDefinition = mapProviderDefinitions[selection.placeServiceId]
  mapRuntimeState.placeServiceDefinition = mapProviderDefinitions[selection.placeServiceId]
  mapRuntimeState.routingServiceDefinition = mapProviderDefinitions[selection.routingServiceId]
  mapRuntimeState.revision += 1
}

export const planMapProvider: PlanMapRuntime = new PlanMapRuntime(runtimeParts(initialSelection))

export function getActiveMapProviderId(): MapProviderId {
  return mapRuntimeState.selection.placeServiceId
}

export function hasMapProviderConfig(id: MapProviderId): boolean {
  return id === 'tencent' ? hasTencentMapConfig() : id === 'google' ? hasGoogleMapConfig() : hasAmapConfig()
}

export function hasMapRendererConfig(id: MapRendererId): boolean {
  if (id === 'cesium') return hasCesiumMapConfig()
  if (id === 'mapbox') return hasMapboxConfig()
  return hasMapProviderConfig(id)
}

export function hasActiveMapProviderConfig(): boolean {
  const selection = mapRuntimeState.selection
  return hasMapRendererConfig(selection.rendererId) && hasMapProviderConfig(selection.placeServiceId) && hasMapProviderConfig(selection.routingServiceId)
}

async function switchSelection(requested: MapRuntimeSelection, saveAsDefault: boolean): Promise<void> {
  if (mapRuntimeState.switching) return
  const selection = normalizeMapRuntimeSelection(requested)
  const current = mapRuntimeState.selection
  if (selection.rendererId === current.rendererId && selection.placeServiceId === current.placeServiceId && selection.routingServiceId === current.routingServiceId) {
    if (saveAsDefault) {
      saveMapRuntimeSelection(selection)
      mapRuntimeState.defaultSelection = selection
      mapRuntimeState.revision += 1
    }
    return
  }
  mapRuntimeState.pendingRendererDefinition = mapRendererDefinitions[selection.rendererId]
  mapRuntimeState.switching = true
  try {
    await planMapProvider.replaceParts(runtimeParts(selection))
    if (saveAsDefault) saveMapRuntimeSelection(selection)
    applySelection(selection, saveAsDefault)
  } finally {
    mapRuntimeState.switching = false
    mapRuntimeState.pendingRendererDefinition = null
  }
}

export function switchMapRuntimeSelection(selection: MapRuntimeSelection): Promise<void> {
  return switchSelection(selection, true)
}

export function switchActiveMapProvider(id: MapProviderId): Promise<void> {
  return switchSelection({ rendererId: id, placeServiceId: id, routingServiceId: id }, true)
}

export function switchActiveMapRenderer(id: MapRendererId): Promise<void> {
  const current = mapRuntimeState.selection
  const googleFallback: Exclude<MapProviderId, 'google'> = hasAmapConfig() ? 'amap' : hasTencentMapConfig() ? 'tencent' : 'amap'
  const requested = normalizeMapRuntimeSelection({ rendererId: id, placeServiceId: current.placeServiceId, routingServiceId: current.routingServiceId }, googleFallback)
  const missing = [requested.placeServiceId, requested.routingServiceId].find((providerId) => !hasMapProviderConfig(providerId))
  if (missing) return Promise.reject(new Error(`切换到${mapRendererDefinitions[id].name}前，请先配置${mapProviderDefinitions[missing].name}数据服务`))
  return switchSelection(requested, false)
}

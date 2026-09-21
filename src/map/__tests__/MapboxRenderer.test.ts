import { beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeMapRuntimeSelection } from '../config'
import { MapboxRenderer } from '../providers/mapbox/MapboxRenderer'
import { clearMapboxConfig, readMapboxConfig, saveMapboxConfig, testMapboxConnection } from '../providers/mapbox/config'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, String(value)) }
}

beforeEach(() => vi.stubGlobal('localStorage', new MemoryStorage()))

describe('Mapbox configuration', () => {
  it('normalizes styles and terrain preferences', () => {
    saveMapboxConfig({ accessToken: ' pk.test-token ', styleUrl: '', satelliteStyleUrl: '', terrainEnabled: true, terrainExaggeration: 9, buildings3dEnabled: false })
    expect(readMapboxConfig()).toEqual({ accessToken: 'pk.test-token', styleUrl: 'mapbox://styles/mapbox/streets-v12', satelliteStyleUrl: 'mapbox://styles/mapbox/satellite-streets-v12', terrainEnabled: true, terrainExaggeration: 5, buildings3dEnabled: false })
    clearMapboxConfig()
    expect(readMapboxConfig()).toBeNull()
    expect(() => saveMapboxConfig({ accessToken: 'sk.secret', styleUrl: '', satelliteStyleUrl: '', terrainEnabled: true, terrainExaggeration: 1, buildings3dEnabled: true })).toThrow('pk.')
  })

  it('reports URL restriction failures during connection testing', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 403 })))
    await expect(testMapboxConnection({ accessToken: 'pk.test-token', styleUrl: 'mapbox://styles/mapbox/streets-v12', satelliteStyleUrl: 'mapbox://styles/mapbox/satellite-streets-v12', terrainEnabled: true, terrainExaggeration: 1, buildings3dEnabled: true })).rejects.toThrow('URL 限制')
  })
})

describe('MapboxRenderer', () => {
  it('acts as a WGS84 renderer while leaving POI and routing to selected services', () => {
    const renderer = new MapboxRenderer()
    expect(renderer.capabilities).toMatchObject({ coordinateSystem: 'WGS84', presentation: 'planar', terrain: true, satellite: true, mapPicking: true, nativePoiSearch: false, nativeRouting: false })
    expect(renderer.capabilities.displayModes).toEqual(['flat', 'tilted'])
  })

  it('switches between flat and tilted camera modes', async () => {
    const easeTo = vi.fn()
    const renderer = new MapboxRenderer() as any
    renderer.map = { easeTo }
    await renderer.setDisplayMode('tilted')
    await renderer.setDisplayMode('flat')
    expect(easeTo).toHaveBeenNthCalledWith(1, { pitch: 55, bearing: 0, duration: 500 })
    expect(easeTo).toHaveBeenNthCalledWith(2, { pitch: 0, bearing: 0, duration: 500 })
  })

  it('replays the pending scene after a zero-size initial layout is resized', () => {
    const resize = vi.fn()
    const renderScene = vi.fn()
    const scene = { places: [], days: [], selectedDayId: '', selectedPlaceId: null, categoryFilter: 'all', satellite: false, mapMode: 'all', routeDayIds: [], routeWarning: false, routeWarningDayIds: [], routeCache: {}, conflictPlaceIds: [] }
    const renderer = new MapboxRenderer() as any
    renderer.map = { resize }
    renderer.styleReady = true
    renderer.pendingScene = scene
    renderer.markers = []
    renderer.layerIds = []
    renderer.renderScene = renderScene
    renderer.resize()
    expect(resize).toHaveBeenCalledOnce()
    expect(renderScene).toHaveBeenCalledWith(scene)
  })

  it('renders the planning scene after the base style is ready even while terrain tiles are still loading', () => {
    const renderScene = vi.fn()
    const applySceneEnhancements = vi.fn()
    const renderer = new MapboxRenderer() as any
    renderer.styleReady = true
    renderer.currentStyleUrl = 'mapbox://styles/mapbox/streets-v12'
    renderer.config = { styleUrl: 'mapbox://styles/mapbox/streets-v12', satelliteStyleUrl: 'mapbox://styles/mapbox/satellite-streets-v12' }
    renderer.map = { isStyleLoaded: () => false }
    renderer.applySceneEnhancements = applySceneEnhancements
    renderer.renderScene = renderScene
    const scene = { places: [], days: [], selectedDayId: '', selectedPlaceId: null, categoryFilter: 'all', satellite: false, mapMode: 'all', routeDayIds: [], routeWarning: false, routeWarningDayIds: [], routeCache: {}, conflictPlaceIds: [] }
    renderer.updateScene(scene)
    expect(applySceneEnhancements).toHaveBeenCalledOnce()
    expect(renderScene).toHaveBeenCalledWith(scene)
  })

  it('draws a fallback route immediately while the selected route service is still loading', () => {
    const addRouteLayers = vi.fn()
    const addRouteInfo = vi.fn()
    class Bounds { extend = vi.fn(); isEmpty(): boolean { return false } }
    const renderer = new MapboxRenderer() as any
    renderer.sdk = { LngLatBounds: Bounds }
    renderer.map = { fitBounds: vi.fn() }
    renderer.routeToken = 1
    renderer.addRouteLayers = addRouteLayers
    renderer.addRouteInfo = addRouteInfo
    renderer.consumePendingFocus = () => true
    renderer.callbacks = { onRouteSummary: vi.fn(), onError: vi.fn(), onRouteSegment: vi.fn() }
    renderer.services = { routing: { searchRouteOptions: () => new Promise(() => {}) } }
    const places = [
      { id: 'a', name: 'A', type: '地点', category: 'transport', priority: 'normal', lng: 104, lat: 30, crs: 'WGS84' },
      { id: 'b', name: 'B', type: '地点', category: 'attraction', priority: 'normal', lng: 105, lat: 31, crs: 'WGS84' },
    ]
    const day = { id: 'd1', label: 'Day 1', date: '2026-09-19', start: 480, end: 1200, maxDrive: 480, stops: [
      { uid: 's1', placeId: 'a', stay: 60, pinned: null, transportMode: 'driving' },
      { uid: 's2', placeId: 'b', stay: 60, pinned: null },
    ] }
    void renderer.renderRoutes([day], { places, days: [day], selectedDayId: 'd1', selectedPlaceId: null, categoryFilter: 'all', satellite: false, mapMode: 'all', routeDayIds: ['d1'], routeWarning: false, routeWarningDayIds: [], routeCache: {}, conflictPlaceIds: [] }, 1, false)
    expect(addRouteLayers).toHaveBeenCalledWith('route-1-0', [[104, 30], [105, 31]], 'driving', false, 'a', 'b')
    expect(addRouteInfo).toHaveBeenCalledOnce()
  })

  it('keeps Mapbox rendering independent and removes Google services from non-Google maps', () => {
    expect(normalizeMapRuntimeSelection({ rendererId: 'mapbox', placeServiceId: 'tencent', routingServiceId: 'amap' })).toEqual({ rendererId: 'mapbox', placeServiceId: 'tencent', routingServiceId: 'amap' })
    expect(normalizeMapRuntimeSelection({ rendererId: 'mapbox', placeServiceId: 'google', routingServiceId: 'google' })).toEqual({ rendererId: 'mapbox', placeServiceId: 'amap', routingServiceId: 'amap' })
    expect(normalizeMapRuntimeSelection({ rendererId: 'mapbox', placeServiceId: 'google', routingServiceId: 'google' }, 'tencent')).toEqual({ rendererId: 'mapbox', placeServiceId: 'tencent', routingServiceId: 'tencent' })
  })
})

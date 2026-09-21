import { describe, expect, it, vi } from 'vitest'
import type { MapScene, Place, RouteOption } from '../../domain/types'
import type { PlanMapCallbacks, PlanMapRenderer, PlanPlaceService, PlanRoutingService } from '../PlanMapProvider'
import { PlanMapRuntime } from '../PlanMapRuntime'

function callbacks(): PlanMapCallbacks {
  return {
    onSelectPlace: vi.fn(), onSelectRouteSegment: vi.fn(), onPreviewRouteOption: vi.fn(), onRouteSummary: vi.fn(), onRouteSegment: vi.fn(),
    onMapPickStart: vi.fn(), onMapPick: vi.fn(), onError: vi.fn(),
  }
}

function createRenderer(): PlanMapRenderer & { mountedServices?: unknown; lastScene?: MapScene; lastPreview?: RouteOption[] } {
  return {
    id: 'cesium',
    capabilities: {
      dimension: '3D', presentation: 'globe', coordinateSystem: 'WGS84', satellite: true, nativePoiSearch: false, nativeRouting: false,
      traffic: false, mapPicking: true, terrain: true, threeDTiles: true, animatedEntities: true, displayModes: ['globe'], routeAlternativeModes: [],
    },
    async mount(_container, _callbacks, services) { this.mountedServices = services },
    updateScene(scene) { this.lastScene = scene },
    previewRouteOptions(options) { this.lastPreview = options },
    clearRouteOptionsPreview: vi.fn(), locateCurrentPosition: vi.fn().mockResolvedValue({ lng: 116.397, lat: 39.909 }),
    focusPlace: vi.fn(), setPickMode: vi.fn(), setTrafficEnabled: vi.fn(), setDisplayMode: vi.fn().mockResolvedValue(undefined),
    zoomIn: vi.fn(), zoomOut: vi.fn(), resize: vi.fn(), destroy: vi.fn(),
  }
}

function createPlaceService(): PlanPlaceService & { nearbyCenter?: Place } {
  return {
    id: 'amap', coordinateSystem: 'GCJ02',
    searchPlaces: vi.fn().mockResolvedValue([]),
    async searchNearbyPlaces(center) { this.nearbyCenter = center; return [] },
    getPlaceDetails: vi.fn().mockResolvedValue(null),
  }
}

function createRoutingService(): PlanRoutingService & { routeFrom?: Place } {
  return {
    id: 'tencent', coordinateSystem: 'GCJ02',
    estimateRoute: vi.fn().mockResolvedValue(null),
    async searchRouteOptions(request) {
      this.routeFrom = request.from
      return [{ id: 'route', providerId: 'tencent', providerName: '腾讯地图', fromPlaceId: request.from.id, toPlaceId: request.to.id, mode: request.mode, strategyLabel: '推荐', distanceKm: 10, durationMinutes: 20, path: [[request.from.lng, request.from.lat], [request.to.lng, request.to.lat]], queriedAt: '2026-09-17T00:00:00.000Z' }]
    },
    searchDayRouteOptions: vi.fn().mockResolvedValue([]),
  }
}

const wgsPlace: Place = { id: 'a', name: '北京', type: '城市', category: 'transport', priority: 'normal', lng: 116.397389, lat: 39.908722, crs: 'WGS84' }
const scene: MapScene = { places: [wgsPlace], days: [], selectedDayId: '', selectedPlaceId: null, categoryFilter: 'all', satellite: false, mapMode: 'all', routeDayIds: [], routeWarning: false, routeWarningDayIds: [], routeCache: {}, conflictPlaceIds: [] }

describe('PlanMapRuntime composition', () => {
  it('composes a WGS84 globe renderer with independent GCJ02 place and route services', async () => {
    const renderer = createRenderer()
    const places = createPlaceService()
    const routing = createRoutingService()
    const runtime = new PlanMapRuntime({ renderer, places, routing })

    await runtime.mount({} as HTMLElement, callbacks())
    runtime.updateScene(scene)
    await runtime.searchNearbyPlaces(wgsPlace, '酒店', 3000)
    const options = await runtime.searchRouteOptions({ from: wgsPlace, to: { ...wgsPlace, id: 'b', lng: 116.407389 }, mode: 'driving' })
    runtime.previewRouteOptions(options)

    expect((renderer.mountedServices as any).places).toMatchObject({ id: 'amap', coordinateSystem: 'WGS84' })
    expect((renderer.mountedServices as any).routing).toMatchObject({ id: 'tencent', coordinateSystem: 'WGS84' })
    expect(renderer.lastScene?.places[0].crs).toBe('WGS84')
    expect(places.nearbyCenter?.crs).toBe('GCJ02')
    expect(places.nearbyCenter?.lng).not.toBe(wgsPlace.lng)
    expect(routing.routeFrom?.crs).toBe('GCJ02')
    expect(options[0].crs).toBe('GCJ02')
    expect(renderer.lastPreview?.[0].crs).toBe('WGS84')
    expect(renderer.lastPreview?.[0].path[0][0]).toBeCloseTo(wgsPlace.lng, 5)
  })

  it('replaces the mounted renderer in place and replays the current scene', async () => {
    const firstRenderer = createRenderer()
    const secondRenderer = createRenderer()
    const runtime = new PlanMapRuntime({ renderer: firstRenderer, places: createPlaceService(), routing: createRoutingService() })
    const container = {} as HTMLElement
    const mapCallbacks = callbacks()
    await runtime.mount(container, mapCallbacks)
    runtime.updateScene(scene)

    await runtime.replaceParts({ renderer: secondRenderer, places: createPlaceService(), routing: createRoutingService() })

    expect(firstRenderer.destroy).toHaveBeenCalledOnce()
    expect(secondRenderer.mountedServices).toBeTruthy()
    expect(secondRenderer.lastScene?.places[0].crs).toBe('WGS84')
    expect(runtime.renderer).toBe(secondRenderer)
  })

  it('annotates renderer pick and location results with the renderer coordinate system', async () => {
    const renderer = createRenderer()
    const runtime = new PlanMapRuntime({ renderer, places: createPlaceService(), routing: createRoutingService() })
    const mapCallbacks = callbacks()
    let mountedCallbacks: PlanMapCallbacks | null = null
    renderer.mount = vi.fn(async (_container, callbacksValue) => { mountedCallbacks = callbacksValue })
    await runtime.mount({} as HTMLElement, mapCallbacks)
    mountedCallbacks!.onMapPick({ lng: 116.397, lat: 39.909, address: '测试地点', candidates: [] })
    const location = await runtime.locateCurrentPosition()
    expect(mapCallbacks.onMapPick).toHaveBeenCalledWith(expect.objectContaining({ crs: 'WGS84' }))
    expect(location.crs).toBe('WGS84')
  })
})

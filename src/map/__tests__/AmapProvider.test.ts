import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanMapCallbacks } from '../PlanMapProvider'
import { AmapProvider } from '../providers/amap/AmapProvider'
import { loadAmap } from '../providers/amap/loader'
import { buildAmapStaticMapUrl } from '../providers/amap/staticMap'

vi.mock('../providers/amap/loader', () => ({ loadAmap: vi.fn() }))

function createCallbacks(): PlanMapCallbacks {
  return {
    onSelectPlace: vi.fn(),
    onSelectRouteSegment: vi.fn(),
    onPreviewRouteOption: vi.fn(),
    onRouteSummary: vi.fn(),
    onRouteSegment: vi.fn(),
    onMapPickStart: vi.fn(),
    onMapPick: vi.fn(),
    onError: vi.fn(),
  }
}

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('AMap static share map', () => {
  it('builds a numbered static map with a route path', () => {
    const places = [
      { id: 'a', name: '重庆', type: '城市', category: 'transport', priority: 'normal', lng: 106.55, lat: 29.56, crs: 'GCJ02' },
      { id: 'b', name: '陇南', type: '城市', category: 'transport', priority: 'normal', lng: 104.92, lat: 33.4, crs: 'GCJ02' },
    ] as const
    const url = buildAmapStaticMapUrl([...places], 'web-service-key')
    expect(url).toContain('restapi.amap.com/v3/staticmap')
    expect(decodeURIComponent(url)).toContain('1:106.550000,29.560000;2:104.920000,33.400000')
    expect(decodeURIComponent(url)).toContain('paths=7,0x536FDA,0.88')
  })
})

describe('AmapProvider POI hotspot picking', () => {
  it('enables base-map POI hotspots and subscribes to hotspot clicks', async () => {
    let mapOptions: Record<string, unknown> | undefined
    const on = vi.fn()
    const sdk = {
      Map: class {
        constructor(_container: HTMLElement, options: Record<string, unknown>) {
          mapOptions = options
        }
        addControl(): void {}
        on = on
        setDefaultCursor(): void {}
      },
      Scale: class {},
    }
    vi.mocked(loadAmap).mockResolvedValue(sdk)

    await new AmapProvider().mount({} as HTMLElement, createCallbacks())

    expect(mapOptions?.isHotspot).toBe(true)
    expect(on).toHaveBeenCalledWith('hotspotclick', expect.any(Function))
  })

  it('recreates the map with provider-declared flat and tilted display modes', async () => {
    const options: Array<Record<string, unknown>> = []
    const destroy = vi.fn()
    const sdk = {
      Map: class {
        constructor(_container: HTMLElement, value: Record<string, unknown>) { options.push(value) }
        addControl(): void {}
        on(): void {}
        off(): void {}
        setDefaultCursor(): void {}
        destroy = destroy
      },
      Scale: class {},
    }
    vi.mocked(loadAmap).mockResolvedValue(sdk)
    const provider = new AmapProvider()

    expect(provider.capabilities.displayModes).toEqual(['flat', 'tilted'])
    await provider.mount({} as HTMLElement, createCallbacks())
    expect(options[0]).toMatchObject({ viewMode: '2D', pitch: 0, rotateEnable: false, pitchEnable: false })

    await provider.setDisplayMode('tilted')
    expect(destroy).toHaveBeenCalledOnce()
    expect(options[1]).toMatchObject({ viewMode: '3D', pitch: 50, rotation: 0, rotateEnable: true, pitchEnable: true, zooms: [2, 20] })
  })

  it('focuses a place with the official map zoom-and-center operation', () => {
    const setZoomAndCenter = vi.fn()
    const provider = new AmapProvider() as any
    provider.map = { getZoom: () => 12, setZoomAndCenter }
    const place = { id: 'focus', name: '聚焦地点', type: '景点', category: 'attraction', priority: 'normal', lng: 104.066, lat: 30.657, crs: 'GCJ02' } as const

    provider.focusPlace(place)

    expect(setZoomAndCenter).toHaveBeenCalledWith(15, [104.066, 30.657], false, 420)
  })

  it('resolves the clicked base-map POI by id instead of replacing it with nearby results', async () => {
    const callbacks = createCallbacks()
    const getDetails = vi.fn((_id: string, done: (status: string, result: unknown) => void) => {
      done('complete', {
        poiList: {
          pois: [{
            id: 'B0TEST001',
            name: '测试餐厅',
            type: '餐饮服务;中餐厅',
            pname: '四川省',
            cityname: '成都市',
            adname: '武侯区',
            address: '测试路 1 号',
            location: { lng: 104.061, lat: 30.671 },
          }],
        },
      })
    })
    const map = { add: vi.fn() }
    const provider = new AmapProvider() as any
    provider.pickMode = true
    provider.callbacks = callbacks
    provider.map = map
    provider.sdk = {
      PlaceSearch: class {
        getDetails = getDetails
      },
      Marker: class {
        constructor(_options: unknown) {}
      },
      Pixel: class {
        constructor(_x: number, _y: number) {}
      },
    }
    vi.stubGlobal('document', { createElement: () => ({ className: '', innerHTML: '' }) })

    provider.hotspotClickHandler({
      id: 'B0TEST001',
      name: '测试餐厅',
      lnglat: { lng: 104.06, lat: 30.67 },
    })
    await vi.waitFor(() => expect(callbacks.onMapPick).toHaveBeenCalledOnce())

    provider.lastHotspotAt = Date.now()
    provider.mapClickHandler({ lnglat: { lng: 104.06, lat: 30.67 } })
    expect(callbacks.onMapPickStart).toHaveBeenCalledOnce()
    expect(callbacks.onMapPickStart).toHaveBeenCalledWith(104.06, 30.67)
    expect(getDetails).toHaveBeenCalledWith('B0TEST001', expect.any(Function))
    expect(map.add).toHaveBeenCalledOnce()
    expect(callbacks.onMapPick).toHaveBeenCalledWith({
      lng: 104.06,
      lat: 30.67,
      address: '四川省 · 成都市 · 武侯区 · 测试路 1 号',
      candidates: [expect.objectContaining({
        name: '测试餐厅',
        provider: 'amap',
        providerId: 'B0TEST001',
        lng: 104.061,
        lat: 30.671,
      })],
    })
  })

  it('does not attach unrelated POI details to a manual place', async () => {
    const getDetails = vi.fn()
    const provider = new AmapProvider() as any
    provider.sdk = {
      PlaceSearch: class {
        getDetails = getDetails
        search(_keyword: string, done: (status: string, result: unknown) => void): void {
          done('complete', { poiList: { pois: [{
            id: 'UNRELATED', name: '爱宴庭私房菜', type: '其他;生活服务', tel: '123', photos: [{ url: 'https://example.test/photo.jpg' }], location: { lng: 104, lat: 30 },
          }] } })
        }
        searchNearBy(_keyword: string, _center: unknown, _radius: number, done: (status: string, result: unknown) => void): void { done('no_data', {}) }
      },
      LngLat: class { constructor(_lng: number, _lat: number) {} },
    }
    const manual = { id: 'manual', name: '地图拾取未安排点', type: '地图选点', category: 'other', priority: 'normal', provider: 'manual', lng: 104, lat: 30, crs: 'GCJ02' } as const

    await expect(provider.getPlaceDetails(manual)).resolves.toBeNull()
    expect(getDetails).not.toHaveBeenCalled()
  })

  it('searches POIs around a selected place with the requested radius', async () => {
    let serviceOptions: Record<string, unknown> | undefined
    const searchNearBy = vi.fn((_keyword: string, _center: [number, number], _radius: number, done: (status: string, result: unknown) => void) => {
      done('complete', { poiList: { pois: [
        { id: 'CENTER', name: '中心酒店', type: '住宿服务;宾馆酒店', location: { lng: 104, lat: 30 } },
        { id: 'HOTEL_2', name: '附近民宿', type: '住宿服务;旅馆招待所', address: '测试路 2 号', distance: '860', location: { lng: 104.006, lat: 30.004 } },
      ] } })
    })
    const provider = new AmapProvider() as any
    provider.sdk = {
      PlaceSearch: class {
        searchNearBy = searchNearBy
        constructor(options: Record<string, unknown>) { serviceOptions = options }
      },
    }
    const center = { id: 'center', name: '中心酒店', type: '住宿', category: 'lodging', priority: 'normal', provider: 'amap', providerId: 'CENTER', adCode: '510100', lng: 104, lat: 30, crs: 'GCJ02' } as const

    const results = await provider.searchNearbyPlaces(center, '酒店', 3000)

    expect(serviceOptions).toMatchObject({ pageSize: 12, pageIndex: 1, city: '510100', citylimit: false, extensions: 'base' })
    expect(searchNearBy).toHaveBeenCalledWith('酒店', [104, 30], 3000, expect.any(Function))
    expect(results).toEqual([
      expect.objectContaining({ providerId: 'HOTEL_2', name: '附近民宿', category: 'lodging', distanceMeters: 860 }),
    ])
  })

  it('returns and labels multiple AMap driving alternatives with tolls', async () => {
    let drivingOptions: any
    const provider = new AmapProvider() as any
    provider.sdk = {
      LngLat: class { constructor(_lng: number, _lat: number) {} },
      Driving: class {
        constructor(options: any) { drivingOptions = options }
        search(_from: unknown, _to: unknown, done: (status: string, result: unknown) => void): void {
          done('complete', { routes: [
            { distance: 100000, time: 3600, tolls: 88, traffic_lights: 20, steps: [] },
            { distance: 90000, time: 4200, tolls: 20, traffic_lights: 12, steps: [] },
          ] })
        }
      },
    }
    const from = { id: 'from', name: '出发地', type: '城市', category: 'transport', priority: 'normal', lng: 104, lat: 30, crs: 'GCJ02' } as const
    const to = { id: 'to', name: '目的地', type: '景点', category: 'attraction', priority: 'normal', lng: 105, lat: 31, crs: 'GCJ02' } as const
    const options = await provider.searchRouteOptions({ from, to, mode: 'driving' })

    expect(drivingOptions).toMatchObject({ policy: 10, showTraffic: true, extensions: 'all' })
    expect(options).toHaveLength(2)
    expect(options[0]).toMatchObject({ strategyLabel: '高德推荐', distanceKm: 100, durationMinutes: 60, toll: 88, trafficLightCount: 20 })
    expect(options[1]).toMatchObject({ strategyLabel: '距离较短', distanceKm: 90, durationMinutes: 70, toll: 20 })
    const result = await provider.searchAmapRoute('driving', from, to)
    expect(result).toMatchObject({ km: 100, min: 60, toll: 88 })
  })

  it('queries a whole-day driving route with intermediate waypoints', async () => {
    let receivedWaypoints: unknown[] = []
    const provider = new AmapProvider() as any
    provider.sdk = {
      LngLat: class { lng: number; lat: number; constructor(lng: number, lat: number) { this.lng = lng; this.lat = lat } },
      Driving: class {
        search(_from: unknown, _to: unknown, options: any, done: (status: string, result: any) => void): void {
          receivedWaypoints = options.waypoints
          done('complete', { routes: [{ distance: 300000, time: 14400, tolls: 60, steps: [] }] })
        }
      },
    }
    const places = [
      { id: 'a', name: 'A', type: '地点', category: 'transport', priority: 'normal', lng: 104, lat: 30, crs: 'GCJ02' },
      { id: 'b', name: 'B', type: '地点', category: 'attraction', priority: 'normal', lng: 103, lat: 30.5, crs: 'GCJ02' },
      { id: 'c', name: 'C', type: '地点', category: 'lodging', priority: 'normal', lng: 102, lat: 31, crs: 'GCJ02' },
    ] as const
    const options = await provider.searchDayRouteOptions({ places: [...places] })
    expect(receivedWaypoints).toHaveLength(1)
    expect(options[0]).toMatchObject({ strategyLabel: '全天推荐', distanceKm: 300, durationMinutes: 240, toll: 60 })
  })

  it('toggles the official AMap traffic layer', () => {
    const add = vi.fn()
    const remove = vi.fn()
    const provider = new AmapProvider() as any
    provider.map = { add, remove }
    provider.sdk = { TileLayer: { Traffic: class { options: any; constructor(options: any) { this.options = options } } } }
    provider.setTrafficEnabled(true)
    expect(add).toHaveBeenCalledOnce()
    expect(provider.trafficLayer.options).toMatchObject({ autoRefresh: true, interval: 180 })
    provider.setTrafficEnabled(false)
    expect(remove).toHaveBeenCalledOnce()
  })

  it('normalizes multiple public transit plans with city lookup', async () => {
    const provider = new AmapProvider() as any
    provider.sdk = {
      LngLat: class { constructor(_lng: number, _lat: number) {} },
      Geocoder: class { getAddress(_point: unknown, done: (status: string, result: any) => void) { done('complete', { regeocode: { addressComponent: { citycode: '028' } } }) } },
      TransferPolicy: { LEAST_TIME: 0 },
      Transfer: class {
        search(_from: unknown, _to: unknown, done: (status: string, result: any) => void): void {
          done('complete', { plans: [
            { distance: 20000, time: 3600, cost: 8, walking_distance: 1200, segments: [{ walking: { steps: [{ path: [[104, 30], [104.1, 30.1]] }] } }, { transit: { lines: [{ path: [[104.1, 30.1], [104.2, 30.2]] }] } }] },
            { distance: 18000, time: 4200, cost: 5, walking_distance: 800, segments: [{ transit: { lines: [{ path: [[104, 30], [104.2, 30.2]] }] } }] },
          ] })
        }
      },
    }
    const from = { id: 'from', name: '出发地', type: '城市', category: 'transport', priority: 'normal', lng: 104, lat: 30, crs: 'GCJ02' } as const
    const to = { id: 'to', name: '目的地', type: '景点', category: 'attraction', priority: 'normal', lng: 104.2, lat: 30.2, crs: 'GCJ02' } as const
    const options = await provider.searchRouteOptions({ from, to, mode: 'transit' })
    expect(options).toHaveLength(2)
    expect(options[0]).toMatchObject({ durationMinutes: 60, distanceKm: 20, cost: 8, walkingDistanceKm: 1.2, transferCount: 1 })
    expect(options[0].path.length).toBeGreaterThan(2)
  })

  it('falls back to hotspot event data when POI details are unavailable', async () => {
    const callbacks = createCallbacks()
    const provider = new AmapProvider() as any
    provider.pickMode = true
    provider.callbacks = callbacks
    provider.map = { add: vi.fn() }
    provider.sdk = {
      PlaceSearch: class {
        getDetails(_id: string, done: (status: string, result: unknown) => void): void {
          done('error', null)
        }
      },
      Marker: class {},
      Pixel: class {},
    }
    vi.stubGlobal('document', { createElement: () => ({ className: '', innerHTML: '' }) })

    await provider.pickHotspot({
      id: 'B0FALLBACK',
      name: '底图上的咖啡店',
      lnglat: { getLng: () => 116.397, getLat: () => 39.909 },
    })

    expect(callbacks.onMapPick).toHaveBeenCalledWith(expect.objectContaining({
      candidates: [expect.objectContaining({
        name: '底图上的咖啡店',
        providerId: 'B0FALLBACK',
        lng: 116.397,
        lat: 39.909,
      })],
    }))
  })
})

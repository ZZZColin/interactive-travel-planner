import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PlanMapCallbacks } from '../PlanMapProvider'
import { TencentMapProvider } from '../providers/tencent/TencentMapProvider'
import { loadTencentMap } from '../providers/tencent/loader'

vi.mock('../providers/tencent/loader', () => ({ loadTencentMap: vi.fn() }))
vi.mock('../providers/tencent/config', () => ({ readTencentMapConfig: () => null }))

function callbacks(): PlanMapCallbacks {
  return {
    onSelectPlace: vi.fn(), onSelectRouteSegment: vi.fn(), onPreviewRouteOption: vi.fn(), onRouteSummary: vi.fn(), onRouteSegment: vi.fn(),
    onMapPickStart: vi.fn(), onMapPick: vi.fn(), onError: vi.fn(),
  }
}

const LatLng = class {
  lat: number
  lng: number
  constructor(lat: number, lng: number) { this.lat = lat; this.lng = lng }
  getLat(): number { return this.lat }
  getLng(): number { return this.lng }
}

afterEach(() => { vi.clearAllMocks() })

describe('TencentMapProvider', () => {
  it('declares the same core map capabilities as the existing planning UI', () => {
    const provider = new TencentMapProvider()
    expect(provider.capabilities.displayModes).toEqual(['flat', 'tilted'])
    expect(provider.capabilities.routeAlternativeModes).toEqual(['driving', 'walking', 'cycling', 'transit'])
    expect(provider.capabilities).toMatchObject({ satellite: true, traffic: true, mapPicking: true, nativePoiSearch: true, nativeRouting: true })
  })

  it('uses the official Search service and normalizes Tencent POIs', async () => {
    const searchRegion = vi.fn().mockResolvedValue({ data: [{ id: 'poi-1', title: '测试酒店', category: '住宿服务:酒店', address: '测试路 1 号', location: new LatLng(30.67, 104.06), ad_info: { province: '四川省', city: '成都市', district: '武侯区', adcode: 510107 } }] })
    vi.mocked(loadTencentMap).mockResolvedValue({ LatLng, service: { Search: class { searchRegion = searchRegion } } })
    const result = await new TencentMapProvider().searchPlaces('测试酒店')
    expect(searchRegion).toHaveBeenCalledWith(expect.objectContaining({ keyword: '测试酒店', cityName: '全国' }))
    expect(result[0]).toMatchObject({ name: '测试酒店', category: 'lodging', provider: 'tencent', providerId: 'poi-1', lng: 104.06, lat: 30.67, adCode: '510107' })
  })

  it('normalizes multiple official driving route alternatives in minutes and meters', async () => {
    const search = vi.fn().mockResolvedValue({ result: { routes: [
      { distance: 100000, duration: 60, toll: 45, traffic_light_count: 12, polyline: [new LatLng(30, 104), new LatLng(31, 105)] },
      { distance: 90000, duration: 70, toll: 10, polyline: [new LatLng(30, 104), new LatLng(30.8, 104.8)] },
    ] } })
    vi.mocked(loadTencentMap).mockResolvedValue({ LatLng, service: { Driving: class { search = search } } })
    const from = { id: 'a', name: 'A', type: '地点', category: 'transport', priority: 'normal', lng: 104, lat: 30, crs: 'GCJ02' } as const
    const to = { id: 'b', name: 'B', type: '地点', category: 'attraction', priority: 'normal', lng: 105, lat: 31, crs: 'GCJ02' } as const
    const options = await new TencentMapProvider().searchRouteOptions({ from, to, mode: 'driving' })
    expect(search).toHaveBeenCalledWith(expect.objectContaining({ from: expect.any(LatLng), to: expect.any(LatLng) }))
    expect(search.mock.calls[0][0]).not.toHaveProperty('fromPoi')
    expect(search.mock.calls[0][0]).not.toHaveProperty('toPoi')
    expect(options).toHaveLength(2)
    expect(options[0]).toMatchObject({ providerName: '腾讯地图', strategyLabel: '腾讯推荐', distanceKm: 100, durationMinutes: 60, toll: 45, trafficLightCount: 12 })
    expect(options[0].path).toEqual([[104, 30], [105, 31]])
  })

  it('creates route previews with the official PolylineStyle class', () => {
    const created: any[] = []
    class PolylineStyle { constructor(publicOptions: any) { Object.assign(this, publicOptions) } }
    class MultiPolyline { options: any; constructor(options: any) { this.options = options; created.push(options) } on(): void {} }
    const provider = new TencentMapProvider() as any
    provider.sdk = { LatLng, PolylineStyle, MultiPolyline }
    provider.map = {}
    provider.previewRouteOptions([{ id: 'route-1', providerId: 'tencent', providerName: '腾讯地图', fromPlaceId: 'a', toPlaceId: 'b', mode: 'driving', strategyLabel: '腾讯推荐', distanceKm: 10, durationMinutes: 20, path: [[104, 30], [105, 31]], queriedAt: '2026-09-17T00:00:00.000Z' }])
    expect(created).toHaveLength(1)
    expect(created[0].styles.route).toBeInstanceOf(PolylineStyle)
    expect(created[0].styles.route).not.toHaveProperty('dashArray')
  })

  it('turns Tencent WebService authorization failures into actionable messages', async () => {
    vi.mocked(loadTencentMap).mockResolvedValue({ LatLng, service: { Driving: class { search(): Promise<never> { return Promise.reject({ status: 199, message: 'service disabled' }) } } } })
    const from = { id: 'a', name: 'A', type: '地点', category: 'transport', priority: 'normal', lng: 104, lat: 30, crs: 'GCJ02' } as const
    const to = { id: 'b', name: 'B', type: '地点', category: 'attraction', priority: 'normal', lng: 105, lat: 31, crs: 'GCJ02' } as const
    await expect(new TencentMapProvider().searchRouteOptions({ from, to, mode: 'driving' })).rejects.toThrow('状态码 199')
    await expect(new TencentMapProvider().searchRouteOptions({ from, to, mode: 'driving' })).rejects.toThrow('尚未开启 WebServiceAPI')
  })

  it('switches between flat and tilted view through documented map methods', async () => {
    const setViewMode = vi.fn(); const setPitchable = vi.fn(); const setRotatable = vi.fn(); const easeTo = vi.fn()
    const map = { on: vi.fn(), setBaseMap: vi.fn(), setViewMode, setPitchable, setRotatable, easeTo }
    vi.mocked(loadTencentMap).mockResolvedValue({ LatLng, Map: class { constructor() { return map } } })
    const provider = new TencentMapProvider()
    await provider.mount({} as HTMLElement, callbacks())
    await provider.setDisplayMode('tilted')
    expect(setViewMode).toHaveBeenCalledWith('3D')
    expect(setPitchable).toHaveBeenCalledWith(true)
    expect(easeTo).toHaveBeenCalledWith({ pitch: 50, rotation: 0 }, { duration: 360 })
  })
})

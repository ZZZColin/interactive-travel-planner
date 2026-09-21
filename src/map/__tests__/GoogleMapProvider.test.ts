import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GoogleMapProvider } from '../providers/google/GoogleMapProvider'
import { normalizeMapRuntimeSelection } from '../config'
import { clearGoogleMapConfig, readGoogleMapConfig, saveGoogleMapConfig } from '../providers/google/config'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, String(value)) }
}

const from = { id: 'a', name: 'A', type: '城市', category: 'transport', priority: 'normal', lng: 104, lat: 30, crs: 'WGS84' } as const
const to = { id: 'b', name: 'B', type: '景点', category: 'attraction', priority: 'normal', lng: 105, lat: 31, crs: 'WGS84' } as const

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('google', { maps: { UnitSystem: { METRIC: 0 } } })
})

describe('GoogleMapConfig', () => {
  it('stores an independent browser-only Google configuration', () => {
    saveGoogleMapConfig({ apiKey: ' key ', mapId: ' map-id ', language: '', region: 'cn' })
    expect(readGoogleMapConfig()).toEqual({ apiKey: 'key', mapId: 'map-id', language: 'zh-CN', region: 'CN' })
    clearGoogleMapConfig()
    expect(readGoogleMapConfig()).toBeNull()
  })
})

describe('GoogleMapProvider', () => {
  it('keeps Google data off the Cesium renderer', () => {
    expect(normalizeMapRuntimeSelection({ rendererId: 'cesium', placeServiceId: 'google', routingServiceId: 'google' })).toEqual({ rendererId: 'cesium', placeServiceId: 'amap', routingServiceId: 'amap' })
  })

  it('declares WGS84 and the same planning capabilities as other 2D providers', () => {
    const provider = new GoogleMapProvider()
    expect(provider.coordinateSystem).toBe('WGS84')
    expect(provider.capabilities).toMatchObject({ presentation: 'planar', satellite: true, traffic: true, mapPicking: true, nativePoiSearch: true, nativeRouting: true })
    expect(provider.capabilities.routeAlternativeModes).toEqual(['driving', 'walking', 'cycling', 'transit'])
  })

  it('uses Places API New text search and normalizes POIs', async () => {
    const searchByText = vi.fn().mockResolvedValue({ places: [{ id: 'place-1', displayName: '测试酒店', formattedAddress: '测试路 1 号', primaryType: 'lodging', primaryTypeDisplayName: '酒店', location: { lng: () => 104.06, lat: () => 30.67 } }] })
    const provider = new GoogleMapProvider() as any
    provider.libraries = { places: { Place: { searchByText } } }
    const results = await provider.searchPlaces('测试酒店')
    expect(searchByText).toHaveBeenCalledWith(expect.objectContaining({ textQuery: '测试酒店', fields: expect.arrayContaining(['id', 'location']), maxResultCount: 12 }))
    expect(results[0]).toMatchObject({ name: '测试酒店', category: 'lodging', provider: 'google', providerId: 'place-1', lng: 104.06, lat: 30.67, crs: 'WGS84' })
  })

  it('uses Routes API with alternatives and preserves high-quality WGS84 paths', async () => {
    const computeRoutes = vi.fn().mockResolvedValue({ routes: [
      { description: '主路线', distanceMeters: 100500, durationMillis: 3_660_000, path: [{ lng: 104, lat: 30 }, { lng: 105, lat: 31 }], routeLabels: ['DEFAULT_ROUTE'], travelAdvisory: { tollInfo: { estimatedPrices: [{ currencyCode: 'CNY', units: 88, nanos: 0 }] } } },
      { description: '备选路线', distanceMeters: 91200, durationMillis: 4_200_000, path: [{ lng: 104, lat: 30 }, { lng: 104.8, lat: 30.9 }], routeLabels: [] },
    ] })
    const provider = new GoogleMapProvider() as any
    provider.libraries = { routes: { Route: { computeRoutes } } }
    const options = await provider.searchRouteOptions({ from, to, mode: 'driving' })
    expect(computeRoutes).toHaveBeenCalledWith(expect.objectContaining({ travelMode: 'DRIVING', computeAlternativeRoutes: true, polylineQuality: 'HIGH_QUALITY', routingPreference: 'TRAFFIC_AWARE' }))
    expect(options).toHaveLength(2)
    expect(options[0]).toMatchObject({ providerId: 'google', providerName: 'Google Maps', strategyLabel: '主路线', distanceKm: 100.5, durationMinutes: 61, toll: 88, crs: 'WGS84' })
    expect(options[0].path).toEqual([[104, 30], [105, 31]])
  })

  it('does not pretend Google Routes supports flight or ferry navigation', async () => {
    const provider = new GoogleMapProvider()
    await expect(provider.searchRouteOptions({ from, to, mode: 'flight' })).resolves.toEqual([])
    await expect(provider.searchRouteOptions({ from, to, mode: 'ferry' })).resolves.toEqual([])
  })
})

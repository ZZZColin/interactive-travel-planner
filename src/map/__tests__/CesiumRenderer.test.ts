import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CesiumRenderer } from '../providers/cesium/CesiumRenderer'
import { readCesiumMapConfig, saveCesiumMapConfig } from '../providers/cesium/config'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, String(value)) }
}

beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()) })

describe('Cesium renderer baseline', () => {
  it('declares a WGS84 globe renderer without pretending to provide POI or routing services', () => {
    const renderer = new CesiumRenderer()
    expect(renderer.capabilities).toMatchObject({
      dimension: '3D', presentation: 'globe', coordinateSystem: 'WGS84', nativePoiSearch: false, nativeRouting: false,
      traffic: false, mapPicking: true, terrain: true, threeDTiles: true, animatedEntities: true, immersiveTour: true, displayModes: ['globe'],
    })
  })

  it('builds high-resolution SVG marker and transport icon sources', () => {
    const renderer = new CesiumRenderer() as any
    const svg = renderer.createMarkerSvg('lodging', '#8b63d7', 12, 'current')
    expect(svg).toMatch(/^<svg/)
    expect(svg).toContain('viewBox="0 0 160 190"')
    expect(svg).toContain('>12</text>')
    expect(svg).toContain('<linearGradient')
    expect(svg).toContain('cx="127"')
    expect(svg).not.toContain('data:image')
    expect(renderer.transportIconSvg('driving')).toContain('<svg')
  })

  it('accepts slow presets and arbitrary custom tour speed values', () => {
    const renderer = new CesiumRenderer() as any
    expect(renderer.tourState.speed).toBe(0.5)
    renderer.setImmersiveTourSpeed(Number.NaN)
    expect(renderer.tourState.speed).toBe(0.5)
    renderer.setImmersiveTourSpeed(0.15)
    expect(renderer.tourState.speed).toBe(0.15)
    renderer.setImmersiveTourSpeed(0.01)
    expect(renderer.tourState.speed).toBe(0.05)
    renderer.setImmersiveTourSpeed(20)
    expect(renderer.tourState.speed).toBe(8)
  })

  it('can disable automatic camera following while keeping the moving tour vehicle active', () => {
    const renderer = new CesiumRenderer() as any
    const releaseTourCamera = vi.fn()
    const updateTourCamera = vi.fn()
    const requestRender = vi.fn()
    renderer.releaseTourCamera = releaseTourCamera
    renderer.updateTourCamera = updateTourCamera
    renderer.updateTourVehicleMode = vi.fn()
    renderer.viewer = {
      clock: { currentTime: 6 },
      scene: { screenSpaceCameraController: { enableInputs: false }, requestRender },
    }
    renderer.sdk = { JulianDate: { secondsDifference: (left: number, right: number) => left - right } }
    renderer.tourStartTime = 1
    renderer.tourStopTime = 11
    renderer.tourPositionProperty = { getValue: () => ({ x: 1, y: 2, z: 3 }) }
    renderer.tourVehicleOverlay = { position: null }
    renderer.tourLegs = [{ startSeconds: 0, endSeconds: 10, mode: 'driving', from: { name: 'A' }, to: { name: 'B' } }]
    renderer.tourStops = []
    renderer.tourState.status = 'playing'
    renderer.lastTourStateUpdate = performance.now()

    renderer.setImmersiveTourCameraFollow(false)
    renderer.onTourTick({ currentTime: 6 })
    expect(renderer.tourState.cameraFollow).toBe(false)
    expect(releaseTourCamera).toHaveBeenCalled()
    expect(renderer.viewer.scene.screenSpaceCameraController.enableInputs).toBe(true)
    expect(renderer.tourVehicleOverlay.position).toEqual({ x: 1, y: 2, z: 3 })
    expect(updateTourCamera).not.toHaveBeenCalled()

    renderer.setImmersiveTourCameraFollow(true)
    renderer.onTourTick({ currentTime: 6 })
    expect(renderer.tourState.cameraFollow).toBe(true)
    expect(updateTourCamera).toHaveBeenCalled()
    expect(requestRender).toHaveBeenCalled()
  })

  it('keeps tour vehicles near the ellipsoid and samples real terrain when enabled', async () => {
    const renderer = new CesiumRenderer() as any
    renderer.config = { imageryMode: 'natural-earth', useWorldTerrain: false, useOsmBuildings: false, terrainExaggeration: 1 }
    await expect(renderer.sampleTourGroundHeights([[104, 30], [104.1, 30.1]])).resolves.toEqual([3, 3])

    renderer.config.useWorldTerrain = true
    renderer.viewer = { terrainProvider: {} }
    renderer.sdk = {
      Cartographic: { fromDegrees: (lng: number, lat: number) => ({ longitude: lng, latitude: lat, height: 0 }) },
      sampleTerrainMostDetailed: async (_provider: unknown, positions: any[]) => positions.map((position, index) => ({ ...position, height: 800 + index * 20 })),
    }
    await expect(renderer.sampleTourGroundHeights([[104, 30], [104.1, 30.1]])).resolves.toEqual([803, 823])
  })

  it('supports a tokenless Natural Earth baseline and protects ion-only features', () => {
    saveCesiumMapConfig({ imageryMode: 'natural-earth', useWorldTerrain: true, useOsmBuildings: true, terrainExaggeration: 1.8 })
    expect(readCesiumMapConfig()).toEqual({ imageryMode: 'natural-earth', useWorldTerrain: false, useOsmBuildings: false, terrainExaggeration: 1.8 })
  })

  it('retains ion terrain and building settings when a token is configured', () => {
    saveCesiumMapConfig({ ionToken: 'ion-token', imageryMode: 'world-imagery', useWorldTerrain: true, useOsmBuildings: true, terrainExaggeration: 1.4 })
    expect(readCesiumMapConfig()).toEqual({ ionToken: 'ion-token', imageryMode: 'world-imagery', useWorldTerrain: true, useOsmBuildings: true, terrainExaggeration: 1.4 })
  })
})

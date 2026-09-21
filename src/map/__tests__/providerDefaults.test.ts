import { beforeEach, describe, expect, it, vi } from 'vitest'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, String(value)) }
}

beforeEach(() => {
  vi.resetModules()
  vi.stubGlobal('localStorage', new MemoryStorage())
  localStorage.setItem('interactiveTravel.map.amap.config', JSON.stringify({ key: 'amap-key', securityJsCode: 'security' }))
})

describe('map runtime defaults', () => {
  it('keeps planner renderer switches temporary until the user saves a default setup', async () => {
    const map = await import('../provider')
    const config = await import('../config')
    vi.spyOn(map.planMapProvider, 'replaceParts').mockResolvedValue(undefined)

    await map.switchActiveMapRenderer('mapbox')
    expect(map.mapRuntimeState.selection.rendererId).toBe('mapbox')
    expect(map.mapRuntimeState.defaultSelection.rendererId).toBe('amap')
    expect(config.readMapRuntimeSelection().rendererId).toBe('amap')

    await map.switchMapRuntimeSelection({ rendererId: 'mapbox', placeServiceId: 'amap', routingServiceId: 'amap' })
    expect(map.mapRuntimeState.defaultSelection.rendererId).toBe('mapbox')
    expect(config.readMapRuntimeSelection().rendererId).toBe('mapbox')
  })
})

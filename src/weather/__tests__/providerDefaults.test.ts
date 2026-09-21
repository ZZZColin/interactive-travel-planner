import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useWeatherStore } from '../../stores/weather'

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
  vi.stubGlobal('localStorage', new MemoryStorage())
  setActivePinia(createPinia())
})

describe('weather provider defaults', () => {
  it('persists the explicitly selected default weather provider', async () => {
    const store = useWeatherStore()
    expect(store.defaultProviderId).toBe('amap')
    store.setDefaultProvider('qweather')
    await nextTick()
    expect(store.selectedProviderId).toBe('qweather')
    expect(localStorage.getItem('interactiveTravel.weather.provider.v1')).toBe('qweather')
  })
})

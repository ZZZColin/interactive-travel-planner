import { nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { AiProviderProfile } from '../types'
import { readAiProviderState } from '../storage'
import { useAiProvidersStore } from '../../stores/aiProviders'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, String(value)) }
}

function profile(id: string): AiProviderProfile {
  return { id, name: id, presetId: null, protocol: 'openai-chat-completions', baseUrl: 'https://ai.example.com/v1', models: ['model'], model: 'model', timeoutSeconds: 30, contextWindowTokens: 32000, maxInputTokens: 24000, maxOutputTokens: 4000, systemPrompt: 'test' }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  setActivePinia(createPinia())
})

describe('AI provider defaults', () => {
  it('keeps the default instance stable until the user explicitly changes it', async () => {
    const store = useAiProvidersStore()
    store.updateProfile(profile('primary'), 'key-1', false)
    store.updateProfile(profile('secondary'), 'key-2', false)
    expect(store.activeId).toBe('primary')
    expect(store.defaultProfile?.id).toBe('primary')

    store.setDefault('secondary')
    await nextTick()
    expect(store.defaultConfiguredProfile?.id).toBe('secondary')
    expect(readAiProviderState().activeId).toBe('secondary')

    store.remove('secondary')
    expect(store.defaultProfile?.id).toBe('primary')
  })
})

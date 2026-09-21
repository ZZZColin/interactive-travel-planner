import { beforeEach, describe, expect, it, vi } from 'vitest'
import { saveAiProviderState, saveAiSecret } from '../../ai/storage'
import type { AiProviderProfile } from '../../ai/types'
import { saveTencentMapConfig } from '../../map/providers/tencent/config'
import { COMPLETE_BACKUP_KIND, createCompleteBackup, parseCompleteBackup, type PlanBackupPayload } from '../completeBackup'

class MemoryStorage implements Storage {
  private data = new Map<string, string>()
  get length(): number { return this.data.size }
  clear(): void { this.data.clear() }
  getItem(key: string): string | null { return this.data.get(key) ?? null }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
  setItem(key: string, value: string): void { this.data.set(key, String(value)) }
}

const profile: AiProviderProfile = {
  id: 'full-ai', name: '完整迁移 AI', presetId: null, protocol: 'openai-chat-completions', baseUrl: 'https://ai.example.com/v1',
  models: ['model-a'], model: 'model-a', timeoutSeconds: 90, contextWindowTokens: 128000, maxInputTokens: 120000, maxOutputTokens: 8000, systemPrompt: 'test',
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
})

describe('complete migration backup', () => {
  it('combines plan data and service credentials in one versioned package', () => {
    saveAiProviderState({ profiles: [profile], activeId: profile.id })
    saveAiSecret(profile.id, 'secret-key', true)
    saveTencentMapConfig({ key: 'tencent-key' })
    const plans: PlanBackupPayload = { schemaVersion: 4, exportedAt: '2026-09-18T00:00:00.000Z', plans: [{ metadata: { id: 'p1', name: '旅行计划' } }] }

    const backup = createCompleteBackup(plans, true)
    const parsed = parseCompleteBackup(JSON.parse(JSON.stringify(backup)))

    expect(parsed.kind).toBe(COMPLETE_BACKUP_KIND)
    expect(parsed.plans.plans).toHaveLength(1)
    expect(parsed.services.ai.secrets?.[0].apiKey).toBe('secret-key')
    expect(parsed.services.maps.tencent?.key).toBe('tencent-key')
  })

  it('rejects plan-only and service-only files', () => {
    expect(() => parseCompleteBackup({ schemaVersion: 4, plans: [] })).toThrow('完整迁移文件')
    expect(() => parseCompleteBackup({ kind: COMPLETE_BACKUP_KIND, version: 1, plans: { schemaVersion: 4, plans: [] } })).toThrow('缺少服务配置')
  })
})

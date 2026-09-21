import { describe, expect, it } from 'vitest'
import { deterministicShareDraft } from '../generator'

describe('share draft generation', () => {
  it('creates a complete deterministic fallback without AI', () => {
    const draft = deterministicShareDraft({
      planName: '甘南五日', dateRange: '2026/09/18—2026/09/22', totalDays: 5, totalKm: 880, totalTravelMinutes: 960, budgetText: '预计预算 ¥8,000',
      overviewFacts: [{ kind: 'people', label: '同行', value: '2 人' }, { kind: 'budget', label: '预算', value: '¥8,000' }],
      days: [{
        label: 'Day 1', date: '09/18', places: ['兰州', '合作'], route: '兰州 → 合作',
        agenda: [
          { name: '兰州', category: 'transport', categoryLabel: '交通', time: '08:00–09:00', detail: '出发' },
          { name: '合作酒店', category: 'lodging', categoryLabel: '住宿', time: '20:00–21:00', detail: '已确认' },
        ],
        facts: [{ kind: 'lodging', label: '住宿', value: '合作酒店' }, { kind: 'food', label: '美食', value: '藏餐' }],
      }],
    })
    expect(draft.title).toBe('甘南五日')
    expect(draft.days[0].route).toBe('兰州 → 合作')
    expect(draft.days[0].agenda[1].categoryLabel).toBe('住宿')
    expect(draft.days[0].facts.map((item) => item.label)).toEqual(['住宿', '美食'])
    expect(draft.overviewFacts[0].value).toBe('2 人')
    expect(draft.overview).toContain('880 km')
    expect(draft.hashtags).toContain('甘南五日')
  })
})

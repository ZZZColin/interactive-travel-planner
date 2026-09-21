import { describe, expect, it } from 'vitest'
import { durationDaysFromText, normalizeImportDurationDays } from '../importDuration'

describe('AI import duration', () => {
  it('keeps an explicit total duration when only some days have details', () => {
    expect(normalizeImportDurationDays(5, 1)).toBe(5)
  })

  it('falls back to duration text when the model omits the structured field', () => {
    expect(normalizeImportDurationDays(null, 1, '川西小环线5天4晚')).toBe(5)
    expect(durationDaysFromText('川西小环线五天四晚')).toBe(5)
    expect(durationDaysFromText('第5天返回成都')).toBeNull()
  })

  it('never truncates detailed days or creates an empty date range', () => {
    expect(normalizeImportDurationDays(2, 4)).toBe(4)
    expect(normalizeImportDurationDays(null, 0)).toBe(1)
    expect(normalizeImportDurationDays(Number.NaN, 3)).toBe(3)
  })
})

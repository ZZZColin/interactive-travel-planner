import { afterEach, describe, expect, it } from 'vitest'
import legacyEnglish from '../legacy.en.json'
import { setAppLocale, translateLegacyText } from '../index'

afterEach(() => setAppLocale('zh-CN'))

describe('application internationalization', () => {
  it('ships a broad English compatibility catalog for the existing interface', () => {
    expect(Object.keys(legacyEnglish).length).toBeGreaterThan(800)
  })

  it('translates core UI text and dynamic counters while preserving brand glyphs', () => {
    setAppLocale('en-US')
    expect(translateLegacyText('我的旅行计划')).toBe('My trips')
    expect(translateLegacyText('地图运行方案')).toBe('Map setup')
    expect(translateLegacyText('3 个问题')).toBe('3 issues')
    expect(translateLegacyText('途')).toBe('途')
  })

  it('returns the original interface text in Chinese mode', () => {
    setAppLocale('zh-CN')
    expect(translateLegacyText('我的旅行计划')).toBe('我的旅行计划')
  })
})

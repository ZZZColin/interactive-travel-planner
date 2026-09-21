import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readAiProviderState, readAiSecret, saveAiProviderState, saveAiSecret } from '../../ai/storage'
import type { AiProviderProfile } from '../../ai/types'
import { readActiveMapProviderId, readMapRuntimeSelection, saveActiveMapProviderId } from '../../map/config'
import { readAmapConfig, saveAmapConfig } from '../../map/providers/amap/config'
import { readCesiumMapConfig, saveCesiumMapConfig } from '../../map/providers/cesium/config'
import { readTencentMapConfig, saveTencentMapConfig } from '../../map/providers/tencent/config'
import { readGoogleMapConfig, saveGoogleMapConfig } from '../../map/providers/google/config'
import { readMapboxConfig, saveMapboxConfig } from '../../map/providers/mapbox/config'
import { readAzureMapsWeatherConfig, saveAzureMapsWeatherConfig } from '../../weather/providers/azure/config'
import { readQWeatherConfig, saveQWeatherConfig } from '../../weather/providers/qweather/config'
import { currentLocale, setAppLocale } from '../../i18n'
import { createServiceConfigBackup, importServiceConfigBackup, inspectServiceConfigBackup } from '../serviceConfigBackup'

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
  id: 'ai-main', name: '主 AI', presetId: null, protocol: 'openai-chat-completions', baseUrl: 'https://ai.example.com/v1',
  models: ['model-a', 'model-b'], model: 'model-a', timeoutSeconds: 90, contextWindowTokens: 128000,
  maxInputTokens: 120000, maxOutputTokens: 8000, systemPrompt: '只使用真实计划数据。',
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage())
  vi.stubGlobal('sessionStorage', new MemoryStorage())
  setAppLocale('zh-CN')
})

describe('global service configuration backup', () => {
  it('exports AI instances, credentials, map engines and weather providers', () => {
    saveAiProviderState({ profiles: [profile], activeId: profile.id })
    saveAiSecret(profile.id, 'ai-secret', false)
    saveAmapConfig({ key: 'amap-key', securityJsCode: 'amap-security', webServiceKey: 'amap-web' })
    saveTencentMapConfig({ key: 'tencent-key', serviceSk: 'tencent-sk', mapStyleId: 'style-x' })
    saveGoogleMapConfig({ apiKey: 'google-key', mapId: 'google-map-id', language: 'zh-CN', region: 'CN' })
    saveMapboxConfig({ accessToken: 'pk.mapbox-token', styleUrl: 'mapbox://styles/test/main', satelliteStyleUrl: 'mapbox://styles/test/satellite', terrainEnabled: true, terrainExaggeration: 1.4, buildings3dEnabled: true })
    saveCesiumMapConfig({ ionToken: 'ion-token', imageryMode: 'world-imagery', useWorldTerrain: true, useOsmBuildings: true, terrainExaggeration: 1.2 })
    saveActiveMapProviderId('tencent')
    saveAzureMapsWeatherConfig({ endpoint: 'https://atlas.microsoft.com', subscriptionKey: 'azure-key', forecastDays: 45 })
    saveQWeatherConfig({ apiHost: 'https://weather.example.com', authType: 'api-key', credential: 'qweather-key', forecastDays: 30 })
    localStorage.setItem('interactiveTravel.weather.provider.v1', 'qweather')
    localStorage.setItem('interactiveTravel.map.tencent.displayMode', 'tilted')

    setAppLocale('en-US')
    const backup = createServiceConfigBackup(true)
    const summary = inspectServiceConfigBackup(backup)

    expect(backup.ui).toEqual({ locale: 'en-US' })
    expect(backup.ai.state.profiles).toEqual([profile])
    expect(backup.ai.defaultProfileId).toBe(profile.id)
    expect(backup.ai.secrets).toEqual([{ profileId: profile.id, apiKey: 'ai-secret', remembered: false }])
    expect(backup.maps).toMatchObject({ activeProvider: 'tencent', runtimeSelection: { rendererId: 'tencent', placeServiceId: 'tencent', routingServiceId: 'tencent' }, defaultRuntimeSelection: { rendererId: 'tencent', placeServiceId: 'tencent', routingServiceId: 'tencent' }, amap: { key: 'amap-key' }, tencent: { key: 'tencent-key' }, google: { apiKey: 'google-key', mapId: 'google-map-id' }, mapbox: { accessToken: 'pk.mapbox-token' }, cesium: { ionToken: 'ion-token', useWorldTerrain: true }, displayModes: { tencent: 'tilted' } })
    expect(backup.weather).toMatchObject({ activeProvider: 'qweather', defaultProvider: 'qweather', azureMaps: { subscriptionKey: 'azure-key' }, qweather: { credential: 'qweather-key' } })
    expect(summary).toMatchObject({ aiProfiles: 1, aiSecrets: 1, aiDefaultProfileName: '主 AI', mapDefaultSummary: '腾讯 / 腾讯 / 腾讯', weatherDefaultName: '和风天气', mapProviders: ['高德地图', '腾讯地图', 'Google Maps', 'Mapbox', 'Cesium 3D 地球'], credentialsIncluded: true })
  })

  it('can export only non-secret instance and provider preferences', () => {
    saveAiProviderState({ profiles: [profile], activeId: profile.id })
    saveAiSecret(profile.id, 'ai-secret', true)
    saveTencentMapConfig({ key: 'tencent-key' })
    saveGoogleMapConfig({ apiKey: 'google-key', mapId: 'google-map-id', language: 'zh-CN', region: 'CN' })
    saveActiveMapProviderId('tencent')
    localStorage.setItem('interactiveTravel.weather.provider.v1', 'caiyun')

    const backup = createServiceConfigBackup(false)

    expect(backup.credentialsIncluded).toBe(false)
    expect(backup.ai.state.profiles).toHaveLength(1)
    expect(backup.ai.secrets).toBeUndefined()
    expect(backup.maps.tencent).toBeUndefined()
    expect(backup.maps.activeProvider).toBe('tencent')
    expect(backup.maps.defaultRuntimeSelection).toEqual({ rendererId: 'tencent', placeServiceId: 'tencent', routingServiceId: 'tencent' })
    expect(backup.weather.defaultProvider).toBe('caiyun')
    expect(backup.weather.activeProvider).toBe('caiyun')
  })

  it('restores defaults from legacy active fields when explicit default fields are absent', () => {
    saveAiProviderState({ profiles: [profile], activeId: profile.id })
    saveTencentMapConfig({ key: 'tencent-key' })
    saveActiveMapProviderId('tencent')
    localStorage.setItem('interactiveTravel.weather.provider.v1', 'caiyun')
    const backup = createServiceConfigBackup(true) as any
    delete backup.ai.defaultProfileId
    delete backup.maps.defaultRuntimeSelection
    delete backup.weather.defaultProvider

    const summary = inspectServiceConfigBackup(backup)
    expect(summary.aiDefaultProfileName).toBe('主 AI')
    expect(summary.mapDefaultSummary).toBe('腾讯 / 腾讯 / 腾讯')
    expect(summary.weatherDefaultName).toBe('彩云天气')
  })

  it('replaces current service configuration and restores credentials', () => {
    saveAiProviderState({ profiles: [profile], activeId: profile.id })
    saveAiSecret(profile.id, 'exported-ai-key', true)
    saveTencentMapConfig({ key: 'exported-tencent-key', serviceSk: 'service-sk' })
    saveGoogleMapConfig({ apiKey: 'google-key', mapId: 'google-map-id', language: 'zh-CN', region: 'CN' })
    saveMapboxConfig({ accessToken: 'pk.mapbox-token', styleUrl: 'mapbox://styles/test/main', satelliteStyleUrl: 'mapbox://styles/test/satellite', terrainEnabled: true, terrainExaggeration: 1.4, buildings3dEnabled: true })
    saveCesiumMapConfig({ ionToken: 'exported-ion', imageryMode: 'world-imagery', useWorldTerrain: true, useOsmBuildings: false, terrainExaggeration: 1.5 })
    saveActiveMapProviderId('tencent')
    saveQWeatherConfig({ apiHost: 'https://weather.example.com', authType: 'jwt', credential: 'weather-jwt', forecastDays: 30 })
    localStorage.setItem('interactiveTravel.weather.provider.v1', 'qweather')
    localStorage.setItem('interactiveTravel.ai.routeOptimizationPrompt.v1', '自定义路线提示词')
    setAppLocale('en-US')
    const backup = createServiceConfigBackup(true)

    localStorage.clear()
    sessionStorage.clear()
    saveAmapConfig({ key: 'old-amap', securityJsCode: 'old-security' })
    saveAzureMapsWeatherConfig({ endpoint: 'https://atlas.microsoft.com', subscriptionKey: 'old-azure', forecastDays: 15 })
    localStorage.setItem('interactiveTravel.weather.cache.v1', '{"stale":true}')

    const summary = importServiceConfigBackup(backup, 'replace')

    expect(summary.aiProfiles).toBe(1)
    expect(readAiProviderState().profiles[0].name).toBe('主 AI')
    expect(readAiProviderState().activeId).toBe(profile.id)
    expect(readAiSecret(profile.id)).toEqual({ apiKey: 'exported-ai-key', remembered: true })
    expect(readActiveMapProviderId()).toBe('tencent')
    expect(readMapRuntimeSelection()).toEqual({ rendererId: 'tencent', placeServiceId: 'tencent', routingServiceId: 'tencent' })
    expect(readTencentMapConfig()).toMatchObject({ key: 'exported-tencent-key', serviceSk: 'service-sk' })
    expect(readGoogleMapConfig()).toMatchObject({ apiKey: 'google-key', mapId: 'google-map-id' })
    expect(readMapboxConfig()).toMatchObject({ accessToken: 'pk.mapbox-token', terrainExaggeration: 1.4 })
    expect(readCesiumMapConfig()).toMatchObject({ ionToken: 'exported-ion', imageryMode: 'world-imagery', useWorldTerrain: true })
    expect(readAmapConfig()).toBeNull()
    expect(readQWeatherConfig()).toMatchObject({ credential: 'weather-jwt', authType: 'jwt' })
    expect(readAzureMapsWeatherConfig()).toBeNull()
    expect(localStorage.getItem('interactiveTravel.ai.routeOptimizationPrompt.v1')).toBe('自定义路线提示词')
    expect(localStorage.getItem('interactiveTravel.weather.cache.v1')).toBeNull()
    expect(currentLocale()).toBe('en-US')
  })
})

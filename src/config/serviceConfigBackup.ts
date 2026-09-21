import { deleteAiSecret, readAiProviderState, readAiSecret, saveAiProviderState, saveAiSecret } from '../ai/storage'
import type { AiProviderProfile, AiProviderState, AiProtocol } from '../ai/types'
import type { MapDisplayMode } from '../domain/types'
import { currentLocale, setAppLocale, type AppLocale } from '../i18n'
import { mapProviderDefinitions, mapRendererDefinitions, normalizeMapRuntimeSelection, readActiveMapProviderId, readMapRuntimeSelection, saveActiveMapProviderId, saveMapRuntimeSelection, type MapProviderId, type MapRendererId, type MapRuntimeSelection } from '../map/config'
import { clearAmapConfig, readAmapConfig, saveAmapConfig, type AmapConfig } from '../map/providers/amap/config'
import { clearMapboxConfig, readMapboxConfig, saveMapboxConfig, type MapboxConfig } from '../map/providers/mapbox/config'
import { clearGoogleMapConfig, readGoogleMapConfig, saveGoogleMapConfig, type GoogleMapConfig } from '../map/providers/google/config'
import { clearCesiumMapConfig, readCesiumMapConfig, saveCesiumMapConfig, type CesiumMapConfig } from '../map/providers/cesium/config'
import { clearTencentMapConfig, readTencentMapConfig, saveTencentMapConfig, type TencentMapConfig } from '../map/providers/tencent/config'
import { weatherProviderDefinitions } from '../weather/registry'
import type { WeatherSelection } from '../weather/types'
import { clearAzureMapsWeatherConfig, readAzureMapsWeatherConfig, saveAzureMapsWeatherConfig, type AzureMapsWeatherConfig } from '../weather/providers/azure/config'
import { clearCaiyunWeatherConfig, readCaiyunWeatherConfig, saveCaiyunWeatherConfig, type CaiyunWeatherConfig } from '../weather/providers/caiyun/config'
import { clearQWeatherConfig, readQWeatherConfig, saveQWeatherConfig, type QWeatherConfig } from '../weather/providers/qweather/config'

const AI_PROFILE_KEY = 'interactiveTravel.ai.providers.v1'
const AI_SESSION_SECRET_KEY = 'interactiveTravel.ai.secrets.session.v1'
const AI_LOCAL_SECRET_KEY = 'interactiveTravel.ai.secrets.local.v1'
const AI_ROUTE_PROMPT_KEY = 'interactiveTravel.ai.routeOptimizationPrompt.v1'
const WEATHER_PROVIDER_KEY = 'interactiveTravel.weather.provider.v1'
const WEATHER_CACHE_KEY = 'interactiveTravel.weather.cache.v1'

export const SERVICE_CONFIG_BACKUP_KIND = 'interactive-travel-service-config'
export const SERVICE_CONFIG_BACKUP_VERSION = 1

export type ServiceConfigImportStrategy = 'merge' | 'replace'

export interface ServiceConfigSecret {
  profileId: string
  apiKey: string
  remembered: boolean
}

export interface ServiceConfigBackup {
  kind: typeof SERVICE_CONFIG_BACKUP_KIND
  version: typeof SERVICE_CONFIG_BACKUP_VERSION
  exportedAt: string
  credentialsIncluded: boolean
  ai: {
    state: AiProviderState
    defaultProfileId?: string
    secrets?: ServiceConfigSecret[]
    routeOptimizationPrompt?: string
  }
  maps: {
    activeProvider: MapProviderId
    runtimeSelection?: MapRuntimeSelection
    defaultRuntimeSelection?: MapRuntimeSelection
    displayModes: Partial<Record<MapRendererId, MapDisplayMode>>
    amap?: AmapConfig
    tencent?: TencentMapConfig
    google?: GoogleMapConfig
    mapbox?: MapboxConfig
    cesium?: CesiumMapConfig
  }
  ui?: {
    locale: AppLocale
  }
  weather: {
    activeProvider: WeatherSelection
    defaultProvider?: WeatherSelection
    azureMaps?: AzureMapsWeatherConfig
    qweather?: QWeatherConfig
    caiyun?: CaiyunWeatherConfig
  }
}

export interface ServiceConfigBackupSummary {
  aiProfiles: number
  aiSecrets: number
  aiDefaultProfileName: string
  mapDefaultSummary: string
  weatherDefaultName: string
  mapProviders: string[]
  weatherProviders: string[]
  credentialsIncluded: boolean
  exportedAt: string
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isAiProtocol(value: unknown): value is AiProtocol {
  return value === 'openai-responses' || value === 'openai-chat-completions' || value === 'anthropic-messages'
}

function normalizeAiProfile(value: unknown): AiProviderProfile | null {
  if (!isRecord(value) || !value.id || !value.name || !value.baseUrl || !isAiProtocol(value.protocol)) return null
  const models = Array.isArray(value.models) ? [...new Set(value.models.map(String).map((item) => item.trim()).filter(Boolean))] : []
  const model = String(value.model || models[0] || '').trim()
  if (!model) return null
  if (!models.includes(model)) models.unshift(model)
  const contextWindowTokens = Math.max(1000, Number(value.contextWindowTokens) || 128000)
  const maxOutputTokens = Math.max(1, Number(value.maxOutputTokens) || 5000)
  return {
    id: String(value.id),
    name: String(value.name),
    presetId: value.presetId == null ? null : String(value.presetId),
    protocol: value.protocol,
    baseUrl: String(value.baseUrl),
    models,
    model,
    timeoutSeconds: Math.max(1, Number(value.timeoutSeconds) || 90),
    contextWindowTokens,
    maxInputTokens: Math.max(1, Number(value.maxInputTokens) || Math.max(1000, contextWindowTokens - maxOutputTokens)),
    maxOutputTokens,
    systemPrompt: String(value.systemPrompt || ''),
  }
}

function normalizeAiState(value: unknown): AiProviderState {
  if (!isRecord(value)) return { profiles: [], activeId: '', defaultId: '' }
  const profiles = Array.isArray(value.profiles) ? value.profiles.map(normalizeAiProfile).filter((item): item is AiProviderProfile => Boolean(item)) : []
  const requestedDefaultId = String(value.defaultId || value.activeId || '')
  const activeId = profiles.some((profile) => profile.id === requestedDefaultId) ? requestedDefaultId : profiles[0]?.id ?? ''
  return { profiles, activeId, defaultId: activeId }
}

function normalizeWeatherSelection(value: unknown): WeatherSelection {
  return value === 'none' || value === 'amap' || value === 'azure-maps' || value === 'qweather' || value === 'caiyun' ? value : 'none'
}

function normalizeMapProviderId(value: unknown): MapProviderId {
  return value === 'tencent' || value === 'google' ? value : 'amap'
}

function normalizeMapRendererId(value: unknown): MapRendererId {
  return value === 'cesium' || value === 'mapbox' ? value : normalizeMapProviderId(value)
}

function normalizeDisplayMode(value: unknown): MapDisplayMode | undefined {
  return value === 'flat' || value === 'tilted' || value === 'globe' ? value : undefined
}

function parseBackup(value: unknown): ServiceConfigBackup {
  if (!isRecord(value) || value.kind !== SERVICE_CONFIG_BACKUP_KIND) throw new Error('这不是行途规划的全局服务配置文件')
  if (value.version !== SERVICE_CONFIG_BACKUP_VERSION) throw new Error(`暂不支持配置文件版本 ${String(value.version)}`)
  if (!isRecord(value.ai) || !isRecord(value.maps) || !isRecord(value.weather)) throw new Error('配置文件内容不完整')
  const activeProvider = normalizeMapProviderId(value.maps.activeProvider)
  const displayModes: Partial<Record<MapRendererId, MapDisplayMode>> = {}
  const amapMode = normalizeDisplayMode(value.maps.displayModes?.amap)
  const tencentMode = normalizeDisplayMode(value.maps.displayModes?.tencent)
  const googleMode = normalizeDisplayMode(value.maps.displayModes?.google)
  const mapboxMode = normalizeDisplayMode(value.maps.displayModes?.mapbox)
  const cesiumMode = normalizeDisplayMode(value.maps.displayModes?.cesium)
  if (amapMode) displayModes.amap = amapMode
  if (tencentMode) displayModes.tencent = tencentMode
  if (googleMode) displayModes.google = googleMode
  if (mapboxMode) displayModes.mapbox = mapboxMode
  if (cesiumMode) displayModes.cesium = cesiumMode
  const rawDefaultRuntimeSelection = isRecord(value.maps.defaultRuntimeSelection) ? value.maps.defaultRuntimeSelection : value.maps.runtimeSelection
  const runtimeSelection: MapRuntimeSelection = normalizeMapRuntimeSelection(isRecord(rawDefaultRuntimeSelection)
    ? {
        rendererId: normalizeMapRendererId(rawDefaultRuntimeSelection.rendererId),
        placeServiceId: normalizeMapProviderId(rawDefaultRuntimeSelection.placeServiceId),
        routingServiceId: normalizeMapProviderId(rawDefaultRuntimeSelection.routingServiceId),
      }
    : { rendererId: activeProvider, placeServiceId: activeProvider, routingServiceId: activeProvider })
  const secrets = Array.isArray(value.ai.secrets) ? value.ai.secrets.flatMap((item: unknown): ServiceConfigSecret[] => {
    if (!isRecord(item) || !item.profileId || !item.apiKey) return []
    return [{ profileId: String(item.profileId), apiKey: String(item.apiKey), remembered: Boolean(item.remembered) }]
  }) : undefined
  const aiState = normalizeAiState(value.ai.state)
  const requestedDefaultProfileId = String(value.ai.defaultProfileId || aiState.activeId || '')
  aiState.activeId = aiState.profiles.some((profile) => profile.id === requestedDefaultProfileId) ? requestedDefaultProfileId : aiState.profiles[0]?.id ?? ''
  aiState.defaultId = aiState.activeId
  const defaultWeatherProvider = normalizeWeatherSelection(value.weather.defaultProvider ?? value.weather.activeProvider)
  return {
    kind: SERVICE_CONFIG_BACKUP_KIND,
    version: SERVICE_CONFIG_BACKUP_VERSION,
    exportedAt: String(value.exportedAt || new Date().toISOString()),
    credentialsIncluded: Boolean(value.credentialsIncluded),
    ai: {
      state: aiState,
      defaultProfileId: aiState.activeId,
      secrets,
      routeOptimizationPrompt: typeof value.ai.routeOptimizationPrompt === 'string' ? value.ai.routeOptimizationPrompt : undefined,
    },
    ui: { locale: value.ui?.locale === 'en-US' ? 'en-US' : 'zh-CN' },
    maps: {
      activeProvider,
      runtimeSelection,
      defaultRuntimeSelection: runtimeSelection,
      displayModes,
      amap: isRecord(value.maps.amap) ? value.maps.amap as AmapConfig : undefined,
      tencent: isRecord(value.maps.tencent) ? value.maps.tencent as TencentMapConfig : undefined,
      google: isRecord(value.maps.google) ? value.maps.google as GoogleMapConfig : undefined,
      mapbox: isRecord(value.maps.mapbox) ? value.maps.mapbox as MapboxConfig : undefined,
      cesium: isRecord(value.maps.cesium) ? value.maps.cesium as CesiumMapConfig : undefined,
    },
    weather: {
      activeProvider: defaultWeatherProvider,
      defaultProvider: defaultWeatherProvider,
      azureMaps: isRecord(value.weather.azureMaps) ? value.weather.azureMaps as AzureMapsWeatherConfig : undefined,
      qweather: isRecord(value.weather.qweather) ? value.weather.qweather as QWeatherConfig : undefined,
      caiyun: isRecord(value.weather.caiyun) ? value.weather.caiyun as CaiyunWeatherConfig : undefined,
    },
  }
}

export function createServiceConfigBackup(includeCredentials = true): ServiceConfigBackup {
  const state = readAiProviderState()
  const secrets = includeCredentials ? state.profiles.flatMap((profile): ServiceConfigSecret[] => {
    const secret = readAiSecret(profile.id)
    return secret.apiKey ? [{ profileId: profile.id, apiKey: secret.apiKey, remembered: secret.remembered }] : []
  }) : undefined
  const activeWeather = normalizeWeatherSelection(localStorage.getItem(WEATHER_PROVIDER_KEY))
  const prompt = localStorage.getItem(AI_ROUTE_PROMPT_KEY) || undefined
  const displayModes: Partial<Record<MapRendererId, MapDisplayMode>> = {}
  const amapMode = normalizeDisplayMode(localStorage.getItem('interactiveTravel.map.amap.displayMode'))
  const tencentMode = normalizeDisplayMode(localStorage.getItem('interactiveTravel.map.tencent.displayMode'))
  const googleMode = normalizeDisplayMode(localStorage.getItem('interactiveTravel.map.google.displayMode'))
  const mapboxMode = normalizeDisplayMode(localStorage.getItem('interactiveTravel.map.mapbox.displayMode'))
  const cesiumMode = normalizeDisplayMode(localStorage.getItem('interactiveTravel.map.cesium.displayMode'))
  if (amapMode) displayModes.amap = amapMode
  if (tencentMode) displayModes.tencent = tencentMode
  if (googleMode) displayModes.google = googleMode
  if (mapboxMode) displayModes.mapbox = mapboxMode
  if (cesiumMode) displayModes.cesium = cesiumMode
  const cesiumConfig = readCesiumMapConfig()
  const exportedCesiumConfig = cesiumConfig
    ? { ...cesiumConfig, ionToken: includeCredentials ? cesiumConfig.ionToken : undefined }
    : undefined
  return {
    kind: SERVICE_CONFIG_BACKUP_KIND,
    version: SERVICE_CONFIG_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    credentialsIncluded: includeCredentials,
    ai: { state, defaultProfileId: state.activeId, secrets, routeOptimizationPrompt: prompt },
    ui: { locale: currentLocale() },
    maps: {
      activeProvider: readActiveMapProviderId(),
      runtimeSelection: readMapRuntimeSelection(),
      defaultRuntimeSelection: readMapRuntimeSelection(),
      displayModes,
      amap: includeCredentials ? readAmapConfig() ?? undefined : undefined,
      tencent: includeCredentials ? readTencentMapConfig() ?? undefined : undefined,
      google: includeCredentials ? readGoogleMapConfig() ?? undefined : undefined,
      mapbox: includeCredentials ? readMapboxConfig() ?? undefined : undefined,
      cesium: exportedCesiumConfig,
    },
    weather: {
      activeProvider: activeWeather,
      defaultProvider: activeWeather,
      azureMaps: includeCredentials ? readAzureMapsWeatherConfig() ?? undefined : undefined,
      qweather: includeCredentials ? readQWeatherConfig() ?? undefined : undefined,
      caiyun: includeCredentials ? readCaiyunWeatherConfig() ?? undefined : undefined,
    },
  }
}

export function inspectServiceConfigBackup(value: unknown): ServiceConfigBackupSummary {
  const backup = parseBackup(value)
  const defaultProfileId = backup.ai.defaultProfileId || backup.ai.state.activeId
  const defaultMap = backup.maps.defaultRuntimeSelection ?? backup.maps.runtimeSelection
  const defaultWeather = backup.weather.defaultProvider ?? backup.weather.activeProvider
  return {
    aiProfiles: backup.ai.state.profiles.length,
    aiSecrets: backup.ai.secrets?.length ?? 0,
    aiDefaultProfileName: backup.ai.state.profiles.find((profile) => profile.id === defaultProfileId)?.name ?? '未设置',
    mapDefaultSummary: defaultMap ? `${mapRendererDefinitions[defaultMap.rendererId].shortName} / ${mapProviderDefinitions[defaultMap.placeServiceId].shortName} / ${mapProviderDefinitions[defaultMap.routingServiceId].shortName}` : '未设置',
    weatherDefaultName: defaultWeather === 'none' ? '关闭' : weatherProviderDefinitions.find((item) => item.id === defaultWeather)?.name ?? '未设置',
    mapProviders: [backup.maps.amap ? '高德地图' : '', backup.maps.tencent ? '腾讯地图' : '', backup.maps.google ? 'Google Maps' : '', backup.maps.mapbox ? 'Mapbox' : '', backup.maps.cesium ? 'Cesium 3D 地球' : ''].filter(Boolean),
    weatherProviders: [backup.weather.activeProvider === 'amap' ? '高德天气' : '', backup.weather.azureMaps ? 'Azure Maps Weather' : '', backup.weather.qweather ? '和风天气' : '', backup.weather.caiyun ? '彩云天气' : ''].filter(Boolean),
    credentialsIncluded: backup.credentialsIncluded,
    exportedAt: backup.exportedAt,
  }
}

export function importServiceConfigBackup(value: unknown, strategy: ServiceConfigImportStrategy): ServiceConfigBackupSummary {
  const backup = parseBackup(value)
  const currentAi = readAiProviderState()
  if (strategy === 'replace') {
    currentAi.profiles.forEach((profile) => deleteAiSecret(profile.id))
    localStorage.removeItem(AI_PROFILE_KEY)
    localStorage.removeItem(AI_LOCAL_SECRET_KEY)
    sessionStorage.removeItem(AI_SESSION_SECRET_KEY)
  }
  const profiles = strategy === 'merge'
    ? [...new Map([...currentAi.profiles, ...backup.ai.state.profiles].map((profile) => [profile.id, profile])).values()]
    : backup.ai.state.profiles
  const requestedDefaultProfileId = backup.ai.defaultProfileId || backup.ai.state.activeId
  const activeId = profiles.some((profile) => profile.id === requestedDefaultProfileId) ? requestedDefaultProfileId : profiles[0]?.id ?? ''
  saveAiProviderState({ profiles, activeId, defaultId: activeId })
  backup.ai.secrets?.forEach((secret) => saveAiSecret(secret.profileId, secret.apiKey, secret.remembered))
  if (backup.ai.routeOptimizationPrompt != null) localStorage.setItem(AI_ROUTE_PROMPT_KEY, backup.ai.routeOptimizationPrompt)
  else if (strategy === 'replace') localStorage.removeItem(AI_ROUTE_PROMPT_KEY)
  if (backup.ui?.locale) setAppLocale(backup.ui.locale)

  if (strategy === 'replace') {
    clearAmapConfig()
    clearTencentMapConfig()
    clearGoogleMapConfig()
    clearMapboxConfig()
    clearCesiumMapConfig()
    localStorage.removeItem('interactiveTravel.map.amap.displayMode')
    localStorage.removeItem('interactiveTravel.map.tencent.displayMode')
    localStorage.removeItem('interactiveTravel.map.google.displayMode')
    localStorage.removeItem('interactiveTravel.map.mapbox.displayMode')
    localStorage.removeItem('interactiveTravel.map.cesium.displayMode')
  }
  if (backup.maps.amap) saveAmapConfig(backup.maps.amap)
  if (backup.maps.tencent) saveTencentMapConfig(backup.maps.tencent)
  if (backup.maps.google) saveGoogleMapConfig(backup.maps.google)
  if (backup.maps.mapbox) saveMapboxConfig(backup.maps.mapbox)
  if (backup.maps.cesium) saveCesiumMapConfig(backup.maps.cesium)
  const defaultRuntimeSelection = backup.maps.defaultRuntimeSelection ?? backup.maps.runtimeSelection
  if (defaultRuntimeSelection) saveMapRuntimeSelection(defaultRuntimeSelection)
  else saveActiveMapProviderId(backup.maps.activeProvider)
  Object.entries(backup.maps.displayModes).forEach(([providerId, mode]) => {
    if (mode) localStorage.setItem(`interactiveTravel.map.${providerId}.displayMode`, mode)
  })

  if (strategy === 'replace') {
    clearAzureMapsWeatherConfig()
    clearQWeatherConfig()
    clearCaiyunWeatherConfig()
  }
  if (backup.weather.azureMaps) saveAzureMapsWeatherConfig(backup.weather.azureMaps)
  if (backup.weather.qweather) saveQWeatherConfig(backup.weather.qweather)
  if (backup.weather.caiyun) saveCaiyunWeatherConfig(backup.weather.caiyun)
  localStorage.setItem(WEATHER_PROVIDER_KEY, backup.weather.defaultProvider ?? backup.weather.activeProvider)
  localStorage.removeItem(WEATHER_CACHE_KEY)
  return inspectServiceConfigBackup(backup)
}

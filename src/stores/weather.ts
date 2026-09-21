import { computed, reactive, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { Place, TripDay } from '../domain/types'
import { weatherProviders } from '../weather/registry'
import { planDayDateKey, type DailyWeatherResult, type WeatherAlert, type WeatherCacheEntry, type WeatherSelection } from '../weather/types'

const PROVIDER_STORAGE_KEY = 'interactiveTravel.weather.provider.v1'
const CACHE_STORAGE_KEY = 'interactiveTravel.weather.cache.v1'
const CACHE_TTL = 30 * 60_000
const ALERT_CACHE_TTL = 10 * 60_000

interface AlertCacheEntry {
  status: 'loading' | 'available' | 'error'
  alerts: WeatherAlert[]
  fetchedAt: number
}

export function weatherCacheKey(providerId: string, placeId: string, date: string): string {
  return `${providerId}|${placeId}|${date}`
}

function loadSelection(): WeatherSelection {
  const value = localStorage.getItem(PROVIDER_STORAGE_KEY)
  return value === 'none' || value === 'amap' || value === 'azure-maps' || value === 'qweather' || value === 'caiyun' ? value : 'amap'
}

function loadCache(): Record<string, WeatherCacheEntry> {
  try {
    const value = JSON.parse(localStorage.getItem(CACHE_STORAGE_KEY) ?? '{}') as Record<string, WeatherCacheEntry>
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry?.result && Date.now() - Number(entry.fetchedAt ?? 0) < CACHE_TTL))
  } catch {
    return {}
  }
}

export const useWeatherStore = defineStore('weather', () => {
  const selectedProviderId = ref<WeatherSelection>(loadSelection())
  const defaultProviderId = selectedProviderId
  const cache = reactive<Record<string, WeatherCacheEntry>>(loadCache())
  const alertCache = reactive<Record<string, AlertCacheEntry>>({})
  const providerConfigRevision = ref(0)
  const selectedProviderDefinition = computed(() => {
    providerConfigRevision.value
    if (selectedProviderId.value === 'none') return null
    const provider = weatherProviders[selectedProviderId.value]
    return { ...provider.definition, maxForecastDays: provider.getConfiguredMaxForecastDays?.() ?? provider.definition.maxForecastDays }
  })
  const selectedProviderConfigured = computed(() => {
    providerConfigRevision.value
    return selectedProviderId.value === 'none' || (weatherProviders[selectedProviderId.value].isConfigured?.() ?? true)
  })

  function persistCache(): void {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(cache))
  }

  function setDefaultProvider(providerId: WeatherSelection): void {
    selectedProviderId.value = providerId
  }

  const setProvider = setDefaultProvider

  function alertsFor(placeId: string): WeatherAlert[] {
    const providerId = selectedProviderId.value
    if (providerId === 'none') return []
    return alertCache[`${providerId}|${placeId}`]?.alerts ?? []
  }

  function weatherFor(placeId: string, date: string): DailyWeatherResult | null {
    if (selectedProviderId.value === 'none') return null
    return cache[weatherCacheKey(selectedProviderId.value, placeId, date)]?.result ?? null
  }

  async function ensureAlerts(place: Place, force = false): Promise<void> {
    const providerId = selectedProviderId.value
    if (providerId === 'none') return
    const provider = weatherProviders[providerId]
    if (!provider.definition.supportsAlerts || !provider.getActiveAlerts) return
    const key = `${providerId}|${place.id}`
    const current = alertCache[key]
    if (!force && current?.status === 'loading') return
    if (!force && current?.status === 'available' && Date.now() - current.fetchedAt < ALERT_CACHE_TTL) return
    alertCache[key] = { status: 'loading', alerts: current?.alerts ?? [], fetchedAt: Date.now() }
    try {
      const alerts = await provider.getActiveAlerts(place)
      alertCache[key] = { status: 'available', alerts, fetchedAt: Date.now() }
    } catch {
      alertCache[key] = { status: 'error', alerts: [], fetchedAt: Date.now() }
    }
  }

  async function ensureWeather(place: Place, date: string, force = false): Promise<void> {
    const providerId = selectedProviderId.value
    if (providerId === 'none') return
    const provider = weatherProviders[providerId]
    const key = weatherCacheKey(providerId, place.id, date)
    const current = cache[key]
    if (!force && current?.status === 'loading') return
    if (!force && current?.status !== 'error' && current && Date.now() - current.fetchedAt < CACHE_TTL) return
    cache[key] = { status: 'loading', fetchedAt: Date.now() }
    const result = await provider.getDailyWeather(place, date)
    cache[key] = { status: result.status, result, fetchedAt: result.fetchedAt }
    persistCache()
  }

  function syncPlan(days: TripDay[], places: Record<string, Place>, startAt: string): void {
    const providerId = selectedProviderId.value
    if (providerId === 'none') return
    const provider = weatherProviders[providerId]
    const unique = new Map<string, { place: Place; date: string }>()
    const alertPlaces = new Map<string, Place>()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    days.forEach((day) => {
      const date = planDayDateKey(startAt, days, day.id)
      const offset = Math.round((new Date(`${date}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
      day.stops.forEach((stop) => {
        const place = places[stop.placeId]
        if (!place) return
        unique.set(`${place.id}|${date}`, { place, date })
        if (provider.definition.supportsAlerts && offset >= 0 && offset <= (provider.definition.alertLookaheadDays ?? 0)) alertPlaces.set(place.id, place)
      })
    })
    unique.forEach(({ place, date }) => { void ensureWeather(place, date) })
    alertPlaces.forEach((place) => { void ensureAlerts(place) })
  }

  function refreshProviderConfiguration(): void {
    providerConfigRevision.value += 1
  }

  function clearCache(): void {
    Object.values(weatherProviders).forEach((provider) => provider.clearCache?.())
    Object.keys(cache).forEach((key) => delete cache[key])
    Object.keys(alertCache).forEach((key) => delete alertCache[key])
    persistCache()
  }

  watch(selectedProviderId, (value) => {
    localStorage.setItem(PROVIDER_STORAGE_KEY, value)
  })

  return { selectedProviderId, defaultProviderId, selectedProviderDefinition, selectedProviderConfigured, cache, alertCache, setProvider, setDefaultProvider, weatherFor, alertsFor, ensureWeather, ensureAlerts, syncPlan, clearCache, refreshProviderConfiguration }
})

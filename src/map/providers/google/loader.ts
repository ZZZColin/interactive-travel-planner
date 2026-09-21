import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { readGoogleMapConfig } from './config'

export interface GoogleMapsLibraries {
  maps: google.maps.MapsLibrary
  places: google.maps.PlacesLibrary
  routes: google.maps.RoutesLibrary
  geocoding: google.maps.GeocodingLibrary
  core: google.maps.CoreLibrary
}

let loaderPromise: Promise<GoogleMapsLibraries> | null = null
let configuredKey = ''

export async function loadGoogleMaps(): Promise<GoogleMapsLibraries> {
  if (loaderPromise) return loaderPromise
  const config = readGoogleMapConfig()
  if (!config) throw new Error('尚未配置 Google Maps，请先填写 API Key')

  configuredKey = config.apiKey
  setOptions({
    key: config.apiKey,
    v: 'weekly',
    language: config.language,
    region: config.region,
    authReferrerPolicy: 'origin',
    mapIds: config.mapId ? [config.mapId] : undefined,
  })

  loaderPromise = Promise.all([
    importLibrary('maps'),
    importLibrary('places'),
    importLibrary('routes'),
    importLibrary('geocoding'),
    importLibrary('core'),
  ]).then(([maps, places, routes, geocoding, core]) => ({ maps, places, routes, geocoding, core }))
    .catch((reason) => {
      loaderPromise = null
      const message = reason instanceof Error ? reason.message : String(reason)
      throw new Error(`Google Maps JavaScript API 加载失败：${message || '请检查 API Key、域名限制和已启用的 API'}`)
    })

  return loaderPromise
}

export function googleMapsLoaderKey(): string {
  return configuredKey
}

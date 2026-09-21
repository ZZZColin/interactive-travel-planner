import type { WeatherProvider } from './types'
import { AmapWeatherProvider } from './providers/amap/AmapWeatherProvider'
import { AzureMapsWeatherProvider } from './providers/azure/AzureMapsWeatherProvider'
import { CaiyunWeatherProvider } from './providers/caiyun/CaiyunWeatherProvider'
import { QWeatherProvider } from './providers/qweather/QWeatherProvider'

export const weatherProviders: Record<WeatherProvider['definition']['id'], WeatherProvider> = {
  amap: new AmapWeatherProvider(),
  'azure-maps': new AzureMapsWeatherProvider(),
  qweather: new QWeatherProvider(),
  caiyun: new CaiyunWeatherProvider(),
}

export const weatherProviderDefinitions = Object.values(weatherProviders).map((provider) => provider.definition)

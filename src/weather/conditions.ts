import type { WeatherKind } from './types'

export function weatherKindFromCondition(condition: string, precipitationType = ''): WeatherKind {
  const value = `${condition} ${precipitationType}`.toLowerCase()
  if (/雷|暴雨|冰雹|thunder|storm|hail/.test(value)) return 'storm'
  if (/雨|rain|shower|drizzle/.test(value)) return 'rain'
  if (/雪|snow|flurr|sleet/.test(value)) return 'snow'
  if (/雾|霾|fog|haze|mist/.test(value)) return 'fog'
  if (/阴|overcast/.test(value)) return 'overcast'
  if (/云|cloud/.test(value)) return 'cloudy'
  if (/晴|sun|clear/.test(value)) return 'sunny'
  if (/风|沙|尘|wind|dust|sand/.test(value)) return 'wind'
  return 'other'
}

import type { TransportMode } from './types'

export interface TransportModeMeta {
  label: string
  glyph: string
  automatic: boolean
  color: string
}

export const transportModes: TransportMode[] = [
  'driving',
  'walking',
  'cycling',
  'transit',
  'train',
  'flight',
  'ferry',
]

export const transportModeMeta: Record<TransportMode, TransportModeMeta> = {
  driving: { label: '驾车', glyph: '驾', automatic: true, color: '#536fda' },
  walking: { label: '步行', glyph: '步', automatic: true, color: '#17a578' },
  cycling: { label: '骑行', glyph: '骑', automatic: true, color: '#ee8b43' },
  transit: { label: '公交 / 地铁', glyph: '公', automatic: false, color: '#3478c8' },
  train: { label: '火车', glyph: '铁', automatic: false, color: '#8b5bd6' },
  flight: { label: '飞机', glyph: '飞', automatic: false, color: '#5f7fe5' },
  ferry: { label: '轮渡', glyph: '船', automatic: false, color: '#2797ad' },
}

export function transportModeOf(mode?: TransportMode): TransportMode {
  return mode ?? 'driving'
}

export function transportRouteCacheKey(fromId: string, toId: string, mode: TransportMode): string {
  return `transport:${mode}:${encodeURIComponent(fromId)}>${encodeURIComponent(toId)}`
}

export function legacyDrivingRouteCacheKey(fromId: string, toId: string): string {
  return `${fromId}-${toId}`
}

export function routeCacheKeyIncludesPlace(key: string, placeId: string): boolean {
  if (key.startsWith('transport:')) {
    const separator = key.indexOf(':', 'transport:'.length)
    if (separator < 0) return false
    const [fromId, toId] = key.slice(separator + 1).split('>')
    return decodeURIComponent(fromId ?? '') === placeId || decodeURIComponent(toId ?? '') === placeId
  }
  return key.startsWith(`${placeId}-`) || key.endsWith(`-${placeId}`)
}

import type { Place } from '../../../domain/types'

const markerLabels = '123456789A'

export function buildAmapStaticMapUrl(places: Place[], webServiceKey: string): string {
  const points = places.filter((place) => Number.isFinite(place.lng) && Number.isFinite(place.lat))
  if (!webServiceKey.trim() || !points.length) return ''
  const params = new URLSearchParams({ key: webServiceKey.trim(), size: '1024*1024', scale: '2', traffic: '0' })
  const markers = points.slice(0, markerLabels.length).map((place, index) => `${markerLabels[index]}:${place.lng.toFixed(6)},${place.lat.toFixed(6)}`).join(';')
  params.set('markers', `mid,0x536FDA,${markers}`)
  if (points.length > 1) params.set('paths', `7,0x536FDA,0.88,,:${points.map((place) => `${place.lng.toFixed(6)},${place.lat.toFixed(6)}`).join(';')}`)
  return `https://restapi.amap.com/v3/staticmap?${params.toString()}`
}

export async function loadAmapStaticMapDataUrl(places: Place[], webServiceKey: string): Promise<string> {
  const url = buildAmapStaticMapUrl(places, webServiceKey)
  if (!url) return ''
  const response = await fetch(url)
  if (!response.ok) throw new Error(`高德静态地图请求失败（${response.status}）`)
  const type = response.headers.get('content-type') ?? ''
  if (!type.startsWith('image/')) throw new Error('高德静态地图没有返回图片，请检查 Web 服务 Key')
  const blob = await response.blob()
  return await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('静态地图图片读取失败')); reader.readAsDataURL(blob) })
}

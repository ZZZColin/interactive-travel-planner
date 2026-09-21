import { readAmapConfig } from './config'

let loaderPromise: Promise<any> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src === src)
    if (existing) {
      if (window.AMapLoader) resolve()
      else existing.addEventListener('load', () => resolve(), { once: true })
      return
    }
    const script = document.createElement('script')
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('高德地图加载器下载失败'))
    document.head.appendChild(script)
  })
}

export async function loadAmap(): Promise<any> {
  if (loaderPromise) return loaderPromise

  loaderPromise = (async () => {
    const config = readAmapConfig()
    if (!config) throw new Error('尚未配置高德地图，请先填写 Web Key 和 securityJsCode')

    window._AMapSecurityConfig = { securityJsCode: config.securityJsCode }
    if (!window.AMapLoader) await loadScript('https://webapi.amap.com/loader.js')

    return window.AMapLoader!.load({
      key: config.key,
      version: '2.0',
      plugins: ['AMap.Scale', 'AMap.Driving', 'AMap.Walking', 'AMap.Transfer', 'AMap.Riding', 'AMap.PlaceSearch', 'AMap.Geocoder', 'AMap.Geolocation', 'AMap.Weather'],
    })
  })()

  return loaderPromise
}

import { readTencentMapConfig } from './config'

let loaderPromise: Promise<any> | null = null

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = [...document.scripts].find((script) => script.src === src)
    if (existing) {
      if (window.TMap) resolve()
      else existing.addEventListener('load', () => resolve(), { once: true })
      return
    }
    const script = document.createElement('script')
    script.charset = 'utf-8'
    script.src = src
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('腾讯地图 JavaScript API GL 下载失败'))
    document.head.appendChild(script)
  })
}

export async function loadTencentMap(): Promise<any> {
  if (window.TMap) return window.TMap
  if (loaderPromise) return loaderPromise
  loaderPromise = (async () => {
    const config = readTencentMapConfig()
    if (!config) throw new Error('尚未配置腾讯地图，请先填写 JavaScript API Key')
    const src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(config.key)}&libraries=service`
    await loadScript(src)
    if (!window.TMap) throw new Error('腾讯地图 JavaScript API GL 初始化失败')
    return window.TMap
  })()
  return loaderPromise
}

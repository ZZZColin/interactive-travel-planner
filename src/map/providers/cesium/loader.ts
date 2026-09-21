let loaderPromise: Promise<any> | null = null

function cesiumLoadError(reason: unknown): Error {
  const message = reason instanceof Error ? reason.message : String(reason ?? '')
  if (/dynamically imported module|Failed to fetch|Importing a module script failed/i.test(message)) {
    return new Error('Cesium 模块资源已更新但当前页面仍使用旧缓存，页面将自动刷新；若仍未恢复，请手动刷新一次')
  }
  return new Error(`Cesium 加载失败${message ? `：${message}` : ''}`)
}

export async function loadCesium(): Promise<any> {
  if (loaderPromise) return loaderPromise
  loaderPromise = (async () => {
    window.CESIUM_BASE_URL = '/cesiumStatic/'
    const [sdk] = await Promise.all([
      import('cesium'),
      import('cesium/Build/Cesium/Widgets/widgets.css'),
    ])
    return sdk
  })().catch((reason) => {
    loaderPromise = null
    throw cesiumLoadError(reason)
  })
  return loaderPromise
}

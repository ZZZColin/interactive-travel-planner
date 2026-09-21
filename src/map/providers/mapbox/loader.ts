let loaderPromise: Promise<typeof import('mapbox-gl').default> | null = null

export async function loadMapbox(): Promise<typeof import('mapbox-gl').default> {
  if (loaderPromise) return loaderPromise
  loaderPromise = Promise.all([
    import('mapbox-gl'),
    import('mapbox-gl/dist/mapbox-gl.css'),
  ]).then(([module]) => (module.default ?? module) as typeof import('mapbox-gl').default).catch((reason) => {
    loaderPromise = null
    const message = reason instanceof Error ? reason.message : String(reason ?? '')
    throw new Error(`Mapbox GL JS 加载失败${message ? `：${message}` : ''}`)
  })
  return loaderPromise
}

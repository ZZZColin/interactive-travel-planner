import { categoryIconMarkup } from '../../../assets/icons/placeCategoryIcons'
import { categoryFromPoi } from '../../../domain/categories'
import { decodeRoutePath } from '../../../domain/polyline'
import { formatDuration, routeInfo } from '../../../domain/schedule'
import { transportModeMeta, transportModeOf, transportRouteCacheKey } from '../../../domain/transport'
import type { CurrentLocationResult, MapDisplayMode, MapScene, Place, PoiSearchResult, RouteOption, TransportMode, TripDay } from '../../../domain/types'
import type { PlanMapCallbacks, PlanMapDataServices, PlanMapRenderer } from '../../PlanMapProvider'
import { loadMapbox } from './loader'
import { readMapboxConfig, type MapboxConfig } from './config'

type MapboxSdk = typeof import('mapbox-gl').default
type MapboxMap = import('mapbox-gl').Map
type MapboxMarker = import('mapbox-gl').Marker
type MapboxRouteData = { path: Array<[number, number]>; km: number; min: number; toll?: number }

export class MapboxRenderer implements PlanMapRenderer {
  readonly id = 'mapbox'
  readonly capabilities = {
    dimension: '2.5D' as const, presentation: 'planar' as const, coordinateSystem: 'WGS84' as const,
    satellite: true, nativePoiSearch: false, nativeRouting: false, traffic: true, mapPicking: true,
    terrain: true, animatedEntities: true, displayModes: ['flat', 'tilted'] as MapDisplayMode[], routeAlternativeModes: [] as TransportMode[],
  }

  private sdk: MapboxSdk | null = null
  private map: MapboxMap | null = null
  private config: MapboxConfig | null = null
  private callbacks: PlanMapCallbacks | null = null
  private services: PlanMapDataServices | null = null
  private pendingScene: MapScene | null = null
  private markers: MapboxMarker[] = []
  private previewMarkers: MapboxMarker[] = []
  private layerIds: string[] = []
  private sourceIds: string[] = []
  private previewLayerIds: string[] = []
  private previewSourceIds: string[] = []
  private routeToken = 0
  private segmentRouteCache = new Map<string, MapboxRouteData>()
  private pickMode = false
  private trafficEnabled = false
  private displayMode: MapDisplayMode = 'flat'
  private styleReady = false
  private currentStyleUrl = ''
  private lastRouteSceneKey = ''
  private pendingFocus: Place | null = null
  private clickHandler: ((event: import('mapbox-gl').MapMouseEvent) => void) | null = null

  async mount(container: HTMLElement, callbacks: PlanMapCallbacks, services?: PlanMapDataServices): Promise<void> {
    this.config = readMapboxConfig()
    if (!this.config) throw new Error('尚未配置 Mapbox，请先填写 Public Access Token')
    if (!this.config.accessToken.startsWith('pk.')) throw new Error('Mapbox 浏览器地图必须使用以 pk. 开头的 Public Access Token，请重新配置')
    this.callbacks = callbacks
    await this.waitForContainerLayout(container)
    this.services = services ?? null
    this.sdk = await loadMapbox()
    if (!this.sdk.supported()) throw new Error('当前浏览器或显卡环境不支持 Mapbox 所需的 WebGL')
    this.currentStyleUrl = this.config.styleUrl
    this.map = new this.sdk.Map({
      container,
      accessToken: this.config.accessToken,
      style: this.currentStyleUrl,
      center: [104.2, 35.7],
      zoom: 4.6,
      pitch: this.displayMode === 'tilted' ? 55 : 0,
      bearing: 0,
      attributionControl: true,
      logoPosition: 'bottom-right',
      interactive: true,
      antialias: true,
    })
    this.clickHandler = (event) => this.handleMapClick(event)
    this.map.on('click', this.clickHandler)
    await new Promise<void>((resolve, reject) => {
      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        cleanup()
        reject(new Error('Mapbox 地图加载超时，请检查当前网络、Token URL 限制和样式地址'))
      }, 18_000)
      const cleanup = () => {
        window.clearTimeout(timeout)
        this.map?.off('load', onLoad)
        this.map?.off('error', onError)
      }
      const onLoad = () => {
        if (settled) return
        this.styleReady = true
        settled = true
        cleanup()
        this.resizeAfterLayout()
        window.requestAnimationFrame(() => this.resizeAfterLayout())
        window.setTimeout(() => this.resizeAfterLayout(), 120)
        window.setTimeout(() => this.resizeAfterLayout(), 360)
        if (this.pendingScene) this.updateScene(this.pendingScene)
        else this.applySceneEnhancements()
        resolve()
      }
      const onError = (event: import('mapbox-gl').MapboxErrorEvent) => {
        const message = event.error?.message ?? ''
        if (!message || /AbortError|cancel/i.test(message)) return
        const fatal = /401|403|unauthorized|forbidden|access token|not authorized|style.*not found|failed to load style/i.test(message)
        if (!fatal || settled) {
          if (!settled) this.callbacks?.onError(`Mapbox 资源加载提示：${message}`)
          return
        }
        settled = true
        cleanup()
        reject(new Error(this.mapLoadError(message)))
      }
      this.map!.on('load', onLoad)
      this.map!.on('error', onError)
    })
  }

  updateScene(scene: MapScene): void {
    this.pendingScene = scene
    if (!this.map || !this.styleReady) return
    const desiredStyle = scene.satellite ? this.config!.satelliteStyleUrl : this.config!.styleUrl
    if (desiredStyle !== this.currentStyleUrl) {
      this.currentStyleUrl = desiredStyle
      this.styleReady = false
      this.clearVisuals()
      this.map.setStyle(desiredStyle)
      this.map.once('style.load', () => { this.styleReady = true; this.applySceneEnhancements(); if (this.pendingScene) this.renderScene(this.pendingScene) })
      return
    }
    this.applySceneEnhancements()
    this.renderScene(scene)
  }

  private renderScene(scene: MapScene): void {
    if (!this.map || !this.styleReady) return
    this.routeToken += 1
    const token = this.routeToken
    this.clearVisuals()
    const routeDays = scene.routeDayIds.map((id) => scene.days.find((day) => day.id === id)).filter((day): day is TripDay => Boolean(day))
    const selectedDay = scene.days.find((day) => day.id === scene.selectedDayId) ?? scene.days[0]
    const effectiveDays = routeDays.length ? routeDays : selectedDay ? [selectedDay] : []
    const nodes = scene.days.flatMap((day) => day.stops.map((stop) => ({ day, stop })))
    const scheduledIds = new Set(nodes.map((node) => node.stop.placeId))
    const bounds = new this.sdk!.LngLatBounds()
    nodes.forEach((node, index) => {
      const place = scene.places.find((item) => item.id === node.stop.placeId)
      if (!place) return
      this.addPlaceMarker(place, index + 1, node.day.id === scene.selectedDayId, scene.selectedPlaceId === place.id, scene.conflictPlaceIds.includes(place.id), 180 + index)
      bounds.extend([place.lng, place.lat])
    })
    scene.places.filter((place) => !scheduledIds.has(place.id)).forEach((place) => {
      if (scene.categoryFilter !== 'all' && scene.categoryFilter !== place.category) return
      this.addPlaceMarker(place, null, false, scene.selectedPlaceId === place.id, false, 100)
      bounds.extend([place.lng, place.lat])
    })
    const routeSceneKey = JSON.stringify(effectiveDays.flatMap((day) => day.stops.map((stop) => [stop.uid, stop.placeId, stop.selectedRoute?.id, stop.transportMode])))
    const shouldFit = routeSceneKey !== this.lastRouteSceneKey
    this.lastRouteSceneKey = routeSceneKey
    const stops = effectiveDays.flatMap((day) => day.stops)
    if (stops.length > 1) void this.renderRoutes(effectiveDays, scene, token, shouldFit)
    else if (!this.consumePendingFocus() && shouldFit && !bounds.isEmpty()) this.map.fitBounds(bounds, { padding: 90, maxZoom: 14, duration: 550 })
  }

  private addPlaceMarker(place: Place, order: number | null, current: boolean, selected: boolean, conflict: boolean, zIndex: number): void {
    if (!this.map || !this.sdk) return
    const wrapper = document.createElement('div')
    const state = order == null ? 'candidate' : current ? 'current' : 'other'
    wrapper.innerHTML = `<div class="travel-marker ${state} ${selected ? 'selected' : ''} ${conflict ? 'conflict' : ''}" data-place="${this.escape(place.id)}"><div class="travel-marker-core">${categoryIconMarkup(place.category, 'marker')}${order == null ? '' : `<span class="travel-marker-orders"><span class="travel-marker-order">${order}</span></span>`}</div><span class="travel-marker-label">${this.escape(place.name)}</span></div>`
    const content = wrapper.firstElementChild as HTMLElement
    content.style.zIndex = String(zIndex)
    content.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectPlace(place.id) })
    this.markers.push(new this.sdk.Marker({ element: content, anchor: 'bottom' }).setLngLat([place.lng, place.lat]).addTo(this.map))
  }

  private async renderRoutes(days: TripDay[], scene: MapScene, token: number, shouldFit: boolean): Promise<void> {
    const stops = days.flatMap((day) => day.stops)
    const places = Object.fromEntries(scene.places.map((place) => [place.id, place]))
    const routeBounds = new this.sdk!.LngLatBounds()
    const pendingQueries: Array<Promise<{ from: Place; to: Place; mode: TransportMode; data: MapboxRouteData } | null>> = []
    let totalKm = 0
    let totalMin = 0
    let providerCount = 0

    for (let index = 0; index < stops.length - 1; index += 1) {
      if (token !== this.routeToken) return
      const fromStop = stops[index]
      const toStop = stops[index + 1]
      const from = places[fromStop.placeId]
      const to = places[toStop.placeId]
      if (!from || !to) continue
      const mode = transportModeOf(fromStop.transportMode)
      const fallback = routeInfo(fromStop, toStop, places, scene.routeCache)
      const cacheKey = transportRouteCacheKey(from.id, to.id, mode)
      const selected = fromStop.selectedRoute && fromStop.selectedRoute.mode === mode && fromStop.selectedRoute.toPlaceId === to.id ? fromStop.selectedRoute : null
      const cached = this.segmentRouteCache.get(cacheKey)
      let path = this.manualPath(from, to, mode)
      let km = fallback.km
      let min = fallback.min
      let pending = Boolean(fallback.pending)
      let source = fallback.source ?? 'estimate'
      let providerResult = false

      if (selected) {
        path = decodeRoutePath(selected.encodedPath)
        km = selected.distanceKm
        min = selected.durationMinutes
        pending = false
        source = 'provider'
        providerResult = true
      } else if (cached) {
        path = cached.path.length ? cached.path : path
        km = cached.km
        min = cached.min
        pending = false
        source = 'provider'
        providerResult = true
      } else if (transportModeMeta[mode].automatic && this.services?.routing) {
        pendingQueries.push(this.services.routing.searchRouteOptions({ from, to, mode }).then((options) => {
          const option = options[0]
          if (!option) return null
          const data: MapboxRouteData = {
            path: option.path.length ? option.path : this.manualPath(from, to, mode),
            km: option.distanceKm,
            min: option.durationMinutes,
            toll: option.toll,
          }
          this.segmentRouteCache.set(cacheKey, data)
          return { from, to, mode, data }
        }).catch((reason) => {
          this.callbacks?.onError(reason instanceof Error ? reason.message : `${transportModeMeta[mode].label}路线查询失败，已显示暂估连线`)
          return null
        }))
      }

      totalKm += km
      totalMin += min
      if (providerResult) providerCount += 1
      path.forEach(([lng, lat]) => routeBounds.extend([lng, lat]))
      const warning = scene.routeWarning || scene.routeWarningDayIds.includes(days[0]?.id ?? '')
      try {
        this.addRouteLayers(`route-${token}-${index}`, path, mode, warning, from.id, to.id)
        this.addRouteInfo(path, from, to, mode, km, min, pending, source, warning, index, stops.length > 7)
      } catch (reason) {
        this.callbacks?.onError(reason instanceof Error ? `Mapbox 路线绘制失败：${reason.message}` : 'Mapbox 路线绘制失败')
      }
    }

    if (token !== this.routeToken) return
    if (!this.consumePendingFocus() && shouldFit && !routeBounds.isEmpty()) this.map?.fitBounds(routeBounds, { padding: 100, maxZoom: 14, duration: 650 })
    this.callbacks?.onRouteSummary({ km: totalKm, min: totalMin, source: providerCount ? 'provider' : 'cache' })

    if (!pendingQueries.length) return
    const resolved = (await Promise.all(pendingQueries)).filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (token !== this.routeToken || !resolved.length) return
    resolved.forEach(({ from, to, mode, data }) => this.callbacks?.onRouteSegment(from.id, to.id, mode, data.km, data.min, data.toll))
    if (this.pendingScene) this.renderScene(this.pendingScene)
  }

  private addRouteLayers(id: string, path: Array<[number, number]>, mode: TransportMode, warning: boolean, fromId: string, toId: string): void {
    if (!this.map || path.length < 2) return
    const sourceId = `${id}-source`; const casingId = `${id}-casing`; const lineId = `${id}-line`
    const automatic = transportModeMeta[mode].automatic; const color = warning ? '#df5b5b' : transportModeMeta[mode].color
    this.map.addSource(sourceId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: path } } })
    this.map.addLayer({ id: casingId, type: 'line', source: sourceId, paint: { 'line-color': '#ffffff', 'line-width': mode === 'flight' ? 8 : 10, 'line-opacity': .92 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
    this.map.addLayer({ id: lineId, type: 'line', source: sourceId, paint: { 'line-color': color, 'line-width': mode === 'flight' ? 4 : 6, 'line-opacity': .94, ...(automatic ? {} : { 'line-dasharray': [2, 1.5] }) }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
    this.map.on('click', lineId, () => this.callbacks?.onSelectRouteSegment(fromId, toId))
    this.map.on('mouseenter', lineId, () => { if (this.map) this.map.getCanvas().style.cursor = 'pointer' })
    this.map.on('mouseleave', lineId, () => { if (this.map) this.map.getCanvas().style.cursor = this.pickMode ? 'crosshair' : '' })
    this.sourceIds.push(sourceId); this.layerIds.push(casingId, lineId)
  }

  private addRouteInfo(path: Array<[number, number]>, from: Place, to: Place, mode: TransportMode, km: number, min: number, pending: boolean, source: string, warning: boolean, index: number, compact: boolean): void {
    if (!this.map || !this.sdk || !path.length) return
    const element = document.createElement('div')
    const sourceClass = source === 'provider' || source === 'cache' ? 'verified' : source === 'manual' ? 'manual' : 'estimated'
    element.className = `map-route-info mode-${mode} ${warning ? 'warning' : ''} ${pending ? 'pending' : ''} ${sourceClass} ${compact ? 'compact' : ''}`
    element.style.setProperty('--route-color', transportModeMeta[mode].color); element.style.setProperty('--route-label-y', `${[-32, 44, -52, 62][index % 4]}px`)
    const duration = pending ? '待填用时' : formatDuration(min); const distance = km > 0 ? `${km} km` : '里程待补充'
    element.innerHTML = `<span class="map-route-info-glyph">${this.escape(transportModeMeta[mode].glyph)}</span><div><strong>${this.escape(transportModeMeta[mode].label)} · ${this.escape(duration)}</strong><small>${this.escape(distance)}${sourceClass === 'estimated' ? ' · 暂估' : sourceClass === 'manual' ? ' · 手动' : ''}</small></div>${warning ? '<i class="pi pi-exclamation-triangle"></i>' : ''}`
    element.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectRouteSegment(from.id, to.id) })
    const [lng, lat] = this.midpoint(path, from, to)
    this.markers.push(new this.sdk.Marker({ element, anchor: 'center' }).setLngLat([lng, lat]).addTo(this.map))
  }

  previewRouteOptions(options: RouteOption[], selectedId?: string): void {
    this.clearRouteOptionsPreview()
    if (!this.map || !this.sdk || !this.styleReady) return
    options.forEach((option, index) => {
      const selected = option.id === selectedId || (!selectedId && index === 0)
      const sourceId = `preview-${index}-source`; const layerId = `preview-${index}-line`
      this.map!.addSource(sourceId, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: option.path } } })
      this.map!.addLayer({ id: layerId, type: 'line', source: sourceId, paint: { 'line-color': selected ? '#536fda' : '#8793a8', 'line-width': selected ? 7 : 4, 'line-opacity': selected ? .95 : .55 }, layout: { 'line-cap': 'round', 'line-join': 'round' } })
      this.map!.on('click', layerId, () => this.callbacks?.onPreviewRouteOption(option.id))
      this.previewSourceIds.push(sourceId); this.previewLayerIds.push(layerId)
    })
  }

  clearRouteOptionsPreview(): void {
    if (this.styleReady) {
      this.previewLayerIds.slice().reverse().forEach((id) => { if (this.map?.getLayer(id)) this.map.removeLayer(id) })
      this.previewSourceIds.slice().reverse().forEach((id) => { if (this.map?.getSource(id)) this.map.removeSource(id) })
    }
    this.previewMarkers.forEach((marker) => marker.remove()); this.previewMarkers = []; this.previewLayerIds = []; this.previewSourceIds = []
  }

  locateCurrentPosition(): Promise<CurrentLocationResult> {
    if (!navigator.geolocation) return Promise.reject(new Error('当前浏览器不支持定位'))
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((position) => {
      const lng = position.coords.longitude; const lat = position.coords.latitude
      if (this.map && this.sdk) {
        this.map.flyTo({ center: [lng, lat], zoom: Math.max(this.map.getZoom(), 14), duration: 650 })
        const element = document.createElement('div'); element.className = 'current-location-marker'; element.innerHTML = '<span></span>'
        this.markers.push(new this.sdk.Marker({ element, anchor: 'center' }).setLngLat([lng, lat]).addTo(this.map))
      }
      resolve({ lng, lat, accuracy: position.coords.accuracy, locationType: '浏览器定位', crs: 'WGS84' })
    }, (reason) => reject(new Error(reason.code === 1 ? '定位权限被拒绝，请在浏览器中允许访问当前位置' : '无法获取当前位置，请检查系统定位和网络')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }))
  }

  focusPlace(place: Place): void { if (!this.map) { this.pendingFocus = place; return }; this.map.flyTo({ center: [place.lng, place.lat], zoom: Math.max(this.map.getZoom(), 14), pitch: this.displayMode === 'tilted' ? 55 : 0, duration: 600 }) }
  setPickMode(enabled: boolean): void { this.pickMode = enabled; if (this.map) this.map.getCanvas().style.cursor = enabled ? 'crosshair' : '' }
  setTrafficEnabled(enabled: boolean): void { this.trafficEnabled = enabled; this.applyTrafficLayer() }
  async setDisplayMode(mode: MapDisplayMode): Promise<void> {
    if (mode !== 'flat' && mode !== 'tilted') throw new Error('Mapbox 仅支持 2D 与倾斜视角')
    this.displayMode = mode; this.map?.easeTo({ pitch: mode === 'tilted' ? 55 : 0, bearing: 0, duration: 500 })
  }
  zoomIn(): void { this.map?.zoomIn({ duration: 240 }) }
  zoomOut(): void { this.map?.zoomOut({ duration: 240 }) }
  resize(): void {
    this.map?.resize()
    if (this.styleReady && this.pendingScene && this.markers.length === 0 && this.layerIds.length === 0) this.renderScene(this.pendingScene)
  }

  destroy(): void {
    this.routeToken += 1; this.clearRouteOptionsPreview(); this.clearVisuals()
    if (this.map && this.clickHandler) this.map.off('click', this.clickHandler)
    this.map?.remove(); this.map = null; this.styleReady = false; this.sdk = null; this.callbacks = null; this.services = null
  }

  private async waitForContainerLayout(container: HTMLElement): Promise<void> {
    const startedAt = performance.now()
    while ((container.clientWidth < 2 || container.clientHeight < 2) && performance.now() - startedAt < 2000) {
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()))
    }
    if (container.clientWidth < 2 || container.clientHeight < 2) throw new Error('Mapbox 地图容器尺寸异常，请刷新页面后重试')
  }

  private resizeAfterLayout(): void {
    this.map?.resize()
    if (this.styleReady && this.pendingScene && this.markers.length === 0 && this.layerIds.length === 0) this.renderScene(this.pendingScene)
  }

  private handleMapClick(event: import('mapbox-gl').MapMouseEvent): void {
    if (!this.pickMode || !this.map) return
    const lng = event.lngLat.lng; const lat = event.lngLat.lat
    this.callbacks?.onMapPickStart(lng, lat)
    const feature = this.map.queryRenderedFeatures(event.point).find((item) => {
      const properties = (item as any).properties as Record<string, unknown> | undefined
      const name = properties?.name_zh ?? properties?.name
      return typeof name === 'string' && name.trim()
    })
    const featureProperties = (feature as any)?.properties as Record<string, unknown> | undefined
    const name = String(featureProperties?.name_zh ?? featureProperties?.name ?? '').trim()
    const type = String(featureProperties?.class ?? featureProperties?.type ?? '地图地点')
    const candidate: PoiSearchResult | null = name ? {
      id: `mapbox_pick_${Math.round(lng * 1e6)}_${Math.round(lat * 1e6)}`, name, type,
      category: categoryFromPoi(`${type};${name}`), priority: 'normal', lng, lat,
      address: name, provider: 'manual', crs: 'WGS84',
    } : null
    this.callbacks?.onMapPick({ lng, lat, address: name, candidates: candidate ? [candidate] : [], crs: 'WGS84' })
  }

  private applySceneEnhancements(): void {
    if (!this.map || !this.config || !this.styleReady) return
    if (this.config.terrainEnabled && !this.map.getSource('mapbox-dem')) {
      this.map.addSource('mapbox-dem', { type: 'raster-dem', url: 'mapbox://mapbox.mapbox-terrain-dem-v1', tileSize: 512, maxzoom: 14 })
      this.map.setTerrain({ source: 'mapbox-dem', exaggeration: this.config.terrainExaggeration })
    }
    if (this.config.buildings3dEnabled && !this.map.getLayer('travel-3d-buildings')) {
      const labelLayer = this.map.getStyle().layers?.find((layer) => layer.type === 'symbol' && 'layout' in layer && (layer.layout as Record<string, unknown>)?.['text-field'])
      try {
        this.map.addLayer({ id: 'travel-3d-buildings', source: 'composite', 'source-layer': 'building', filter: ['==', 'extrude', 'true'], type: 'fill-extrusion', minzoom: 14,
          paint: { 'fill-extrusion-color': '#d8dce5', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-base': ['get', 'min_height'], 'fill-extrusion-opacity': .68 } }, labelLayer?.id)
      } catch { /* custom styles may not contain the composite building source */ }
    }
    this.applyTrafficLayer()
  }

  private applyTrafficLayer(): void {
    if (!this.map || !this.styleReady) return
    const sourceId = 'travel-mapbox-traffic'; const layerId = 'travel-mapbox-traffic-lines'
    if (!this.trafficEnabled) {
      if (this.map.getLayer(layerId)) this.map.removeLayer(layerId)
      if (this.map.getSource(sourceId)) this.map.removeSource(sourceId)
      return
    }
    try {
      if (!this.map.getSource(sourceId)) this.map.addSource(sourceId, { type: 'vector', url: 'mapbox://mapbox.mapbox-traffic-v1' })
      if (!this.map.getLayer(layerId)) {
        this.map.addLayer({ id: layerId, type: 'line', source: sourceId, 'source-layer': 'traffic', minzoom: 6,
          paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 16, 4], 'line-opacity': .82,
            'line-color': ['match', ['get', 'congestion'], 'low', '#36a86f', 'moderate', '#f2bf42', 'heavy', '#ed7843', 'severe', '#d94f4f', '#8793a8'] } })
      }
    } catch {
      this.callbacks?.onError('当前 Mapbox Token 或样式无法加载实时路况图层')
    }
  }

  private clearVisuals(): void {
    this.markers.forEach((marker) => marker.remove()); this.markers = []
    this.clearRouteOptionsPreview()
    if (this.styleReady) {
      this.layerIds.slice().reverse().forEach((id) => { if (this.map?.getLayer(id)) this.map.removeLayer(id) })
      this.sourceIds.slice().reverse().forEach((id) => { if (this.map?.getSource(id)) this.map.removeSource(id) })
    }
    this.layerIds = []; this.sourceIds = []
  }

  private consumePendingFocus(): boolean {
    if (!this.pendingFocus || !this.map) return false
    const place = this.pendingFocus; this.pendingFocus = null; this.focusPlace(place); return true
  }

  private manualPath(from: Place, to: Place, mode: TransportMode): Array<[number, number]> {
    if (mode !== 'flight' && mode !== 'ferry') return [[from.lng, from.lat], [to.lng, to.lat]]
    const dx = to.lng - from.lng; const dy = to.lat - from.lat; const curve = Math.min(12, Math.hypot(dx, dy) * .16); const length = Math.hypot(dx, dy) || 1
    const cx = (from.lng + to.lng) / 2 - dy / length * curve; const cy = (from.lat + to.lat) / 2 + dx / length * curve
    return Array.from({ length: 25 }, (_, index) => { const t = index / 24; const u = 1 - t; return [u * u * from.lng + 2 * u * t * cx + t * t * to.lng, u * u * from.lat + 2 * u * t * cy + t * t * to.lat] })
  }

  private midpoint(path: Array<[number, number]>, from: Place, to: Place): [number, number] {
    if (path.length < 2) return [(from.lng + to.lng) / 2, (from.lat + to.lat) / 2]
    const lengths = path.slice(1).map((point, index) => Math.hypot(point[0] - path[index][0], point[1] - path[index][1])); const target = lengths.reduce((sum, length) => sum + length, 0) / 2; let walked = 0
    for (let index = 0; index < lengths.length; index += 1) { if (walked + lengths[index] >= target) { const ratio = lengths[index] ? (target - walked) / lengths[index] : 0; return [path[index][0] + (path[index + 1][0] - path[index][0]) * ratio, path[index][1] + (path[index + 1][1] - path[index][1]) * ratio] } walked += lengths[index] }
    return path[Math.floor(path.length / 2)]
  }

  private mapLoadError(message: string): string {
    if (/401|unauthorized|access token.*invalid/i.test(message)) return 'Mapbox Token 无效或已失效，请在配置中点击“测试连接”'
    if (/403|forbidden|not authorized/i.test(message)) return 'Mapbox 拒绝当前网站访问，请检查 Token 的 URL 限制是否包含当前域名或 127.0.0.1'
    if (/style.*not found|404/i.test(message)) return 'Mapbox 样式不存在或当前 Token 无权访问，请检查 Style URL'
    return `Mapbox 地图加载失败：${message}`
  }

  private escape(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character) }

}

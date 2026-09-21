import { categoryFromPoi } from '../../../domain/categories'
import { categoryIconMarkup } from '../../../assets/icons/placeCategoryIcons'
import { decodeRoutePath } from '../../../domain/polyline'
import { formatDuration, routeInfo } from '../../../domain/schedule'
import { transportModeMeta, transportModeOf, transportRouteCacheKey } from '../../../domain/transport'
import type { CurrentLocationResult, DayRouteOptionRequest, MapDisplayMode, MapScene, Place, PlaceDetails, PoiSearchResult, RouteEstimate, RouteOption, RouteOptionRequest, TransportMode, TripDay } from '../../../domain/types'
import type { PlanMapCallbacks, PlanMapProvider } from '../../PlanMapProvider'
import { readTencentMapConfig } from './config'
import { loadTencentMap } from './loader'

interface TencentRouteData { path: Array<[number, number]>; km: number; min: number; toll?: number }

export class TencentMapProvider implements PlanMapProvider {
  readonly id = 'tencent'
  readonly coordinateSystem = 'GCJ02' as const
  readonly capabilities = {
    dimension: '2.5D' as const,
    presentation: 'planar' as const,
    coordinateSystem: 'GCJ02' as const, satellite: true, nativePoiSearch: true, nativeRouting: true, traffic: true, mapPicking: true,
    displayModes: ['flat', 'tilted'] as MapDisplayMode[], routeAlternativeModes: ['driving', 'walking', 'cycling', 'transit'] as TransportMode[],
  }
  private sdk: any = null
  private map: any = null
  private container: HTMLElement | null = null
  private callbacks: PlanMapCallbacks | null = null
  private pendingScene: MapScene | null = null
  private displayMode: MapDisplayMode = 'flat'
  private trafficEnabled = false
  private satelliteEnabled = false
  private pickMode = false
  private routeToken = 0
  private pickToken = 0
  private overlays: any[] = []
  private routeOptionPreviewOverlays: any[] = []
  private segmentRouteCache = new Map<string, TencentRouteData>()
  private routeOptionsCache = new Map<string, RouteOption[]>()
  private placeDetailsCache = new Map<string, PlaceDetails | null>()
  private pendingFocusPlace: Place | null = null
  private lastRouteSceneKey = ''

  async mount(container: HTMLElement, callbacks: PlanMapCallbacks): Promise<void> {
    this.container = container; this.callbacks = callbacks; this.sdk = await loadTencentMap(); this.createMap()
  }

  private createMap(): void {
    if (!this.sdk || !this.container) return
    const tilted = this.displayMode === 'tilted'
    const config = readTencentMapConfig()
    const options: Record<string, unknown> = {
      center: new this.sdk.LatLng(30.65, 103), zoom: 7.6, viewMode: tilted ? '3D' : '2D', pitch: tilted ? 50 : 0, rotation: 0,
      showControl: false, baseMap: { type: 'vector', features: ['base', 'building2d', 'building3d', 'point', 'label', 'arrow'] },
    }
    if (config?.mapStyleId) options.mapStyleId = config.mapStyleId
    this.map = new this.sdk.Map(this.container, options)
    this.map.on('click', this.mapClickHandler)
    this.applyBaseMap()
    this.lastRouteSceneKey = ''
    if (this.pendingScene) this.updateScene(this.pendingScene)
  }

  private readonly mapClickHandler = (event: any): void => {
    if (!this.pickMode) return
    const normalized = this.pathPoint(event?.poi?.latLng ?? event?.latLng)
    if (normalized) void this.pickAt(normalized[0], normalized[1], event?.poi?.name ?? '')
  }

  updateScene(scene: MapScene): void {
    this.pendingScene = scene
    if (!this.map || !this.sdk) return
    this.routeToken += 1; this.clearRouteOptionsPreview(); const token = this.routeToken; this.clearOverlays()
    this.satelliteEnabled = scene.satellite; this.applyBaseMap()
    const selectedDay = scene.days.find((day) => day.id === scene.selectedDayId) ?? scene.days[0]
    const routeDays = scene.routeDayIds.map((id) => scene.days.find((day) => day.id === id)).filter((day): day is TripDay => Boolean(day))
    const effectiveRouteDays = routeDays.length ? routeDays : selectedDay ? [selectedDay] : []
    const routeSceneKey = JSON.stringify(effectiveRouteDays.map((day) => ({ id: day.id, stops: day.stops.map((stop) => [stop.uid, stop.placeId, transportModeOf(stop.transportMode), stop.transportDuration, stop.transportDistance, stop.selectedRoute?.id]) })))
    const shouldFitViewport = routeSceneKey !== this.lastRouteSceneKey; this.lastRouteSceneKey = routeSceneKey
    const scheduledNodes = scene.days.flatMap((day) => day.stops.map((stop) => ({ day, stop })))
    const scheduledIds = new Set(scheduledNodes.map((node) => node.stop.placeId))
    const markerPoints: Array<[number, number]> = []
    const occurrenceCount = new Map<string, number>()
    const offsets = [[0, 0], [-22, -18], [22, 18], [24, -20], [-24, 20]]
    scheduledNodes.forEach((node, globalIndex) => {
      const place = scene.places.find((item) => item.id === node.stop.placeId); if (!place) return
      const occurrence = occurrenceCount.get(place.id) ?? 0; occurrenceCount.set(place.id, occurrence + 1)
      const [offsetX, offsetY] = offsets[occurrence % offsets.length]
      const status = node.day.id === scene.selectedDayId ? 'current' : 'other'
      const conflictClass = scene.conflictPlaceIds.includes(place.id) ? 'conflict' : ''
      const selectedClass = scene.selectedPlaceId === place.id ? 'selected' : ''
      const roleClass = globalIndex === 0 ? 'trip-start' : globalIndex === scheduledNodes.length - 1 ? 'trip-end' : ''
      const order = globalIndex + 1
      const element = document.createElement('div')
      element.className = `travel-marker ${status} ${conflictClass} ${selectedClass} ${roleClass}`
      element.dataset.place = place.id; element.dataset.stopUid = node.stop.uid; element.dataset.order = String(order)
      element.style.setProperty('--label-y', `${[0, 12, -12, 16][globalIndex % 4]}px`)
      element.innerHTML = `<div class="travel-marker-core">${categoryIconMarkup(place.category, 'marker')}<span class="travel-marker-orders"><span class="travel-marker-order">${order}</span></span></div><span class="travel-marker-label">${this.escape(place.name)}</span>`
      element.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectPlace(place.id) })
      this.overlays.push(this.createDomOverlay([place.lng, place.lat], element, offsetX, offsetY, 180 + globalIndex)); markerPoints.push([place.lng, place.lat])
    })
    scene.places.filter((place) => !scheduledIds.has(place.id)).forEach((place) => {
      if (scene.categoryFilter !== 'all' && place.category !== scene.categoryFilter) return
      const element = document.createElement('div'); element.className = `travel-marker candidate ${scene.selectedPlaceId === place.id ? 'selected' : ''}`; element.dataset.place = place.id
      element.innerHTML = `<div class="travel-marker-core">${categoryIconMarkup(place.category, 'marker')}</div><span class="travel-marker-label">${this.escape(place.name)}</span>`
      element.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectPlace(place.id) })
      this.overlays.push(this.createDomOverlay([place.lng, place.lat], element, 0, 0, 100)); markerPoints.push([place.lng, place.lat])
    })
    if (scheduledNodes.length > 1) void this.renderRoutes(effectiveRouteDays, scene, markerPoints, token, shouldFitViewport)
    else if (!this.consumePendingFocus() && shouldFitViewport && markerPoints.length) this.fitPoints(markerPoints)
  }

  async searchPlaces(keyword: string): Promise<PoiSearchResult[]> {
    const query = keyword.trim(); if (query.length < 2) return []
    const sdk = this.sdk ?? await loadTencentMap(); const service = new sdk.service.Search({ pageSize: 8 })
    const result = await service.searchRegion(this.withServiceSk({ keyword: query, cityName: '全国', autoExtend: true, referenceLocation: this.map?.getCenter?.() }))
    return this.normalizePoiResults(result?.data ?? [], query, 8)
  }

  async searchNearbyPlaces(center: Place, keyword: string, radiusMeters: number): Promise<PoiSearchResult[]> {
    const query = keyword.trim(); if (!query) return []
    const sdk = this.sdk ?? await loadTencentMap(); const service = new sdk.service.Search({ pageSize: 12 })
    const referenceLocation = new sdk.LatLng(center.lat, center.lng)
    const result = radiusMeters <= 1000
      ? await service.searchNearby(this.withServiceSk({ keyword: query, center: referenceLocation, radius: Math.max(10, Math.round(radiusMeters)), autoExtend: false, orderby: '_distance' }))
      : await service.searchRegion(this.withServiceSk({ keyword: query, cityName: center.adCode || center.cityCode || '全国', referenceLocation, autoExtend: true, orderby: '_distance' }))
    return this.normalizePoiResults(result?.data ?? [], query, 12)
      .filter((place) => (place.distanceMeters == null || place.distanceMeters <= radiusMeters) && place.providerId !== center.providerId && place.id !== center.id)
  }

  async getPlaceDetails(place: Place): Promise<PlaceDetails | null> {
    const cacheKey = place.providerId ? `id:${place.providerId}` : `place:${place.id}`
    if (this.placeDetailsCache.has(cacheKey)) return this.placeDetailsCache.get(cacheKey) ?? null
    const sdk = this.sdk ?? await loadTencentMap(); const service = new sdk.service.Search({ pageSize: 10 })
    let items: any[] = []; let matchedBy: PlaceDetails['matchedBy'] = 'name-and-location'
    if (place.providerId) { try { items = (await service.searchPoiId(this.withServiceSk({ id: place.providerId })))?.data ?? []; matchedBy = 'provider-id' } catch { items = [] } }
    if (!items.length) { try { items = (await service.searchNearby(this.withServiceSk({ keyword: place.name, center: new sdk.LatLng(place.lat, place.lng), radius: 1000, autoExtend: true, orderby: '_distance' })))?.data ?? [] } catch { items = [] } }
    const selected = items.find((item) => this.normalizedName(item.title ?? item.name) === this.normalizedName(place.name)) ?? items[0]
    const details = selected ? this.toPlaceDetails(selected, matchedBy) : null; this.placeDetailsCache.set(cacheKey, details); return details
  }

  async estimateRoute(from: Place, to: Place, mode: TransportMode): Promise<RouteEstimate | null> {
    if (!transportModeMeta[mode].automatic) return null
    const first = (await this.searchRouteOptions({ from, to, mode }))[0]
    return first ? { km: first.distanceKm, min: first.durationMinutes, toll: first.toll, source: 'provider' } : null
  }

  async searchRouteOptions(request: RouteOptionRequest): Promise<RouteOption[]> {
    const { from, to, mode, force, preference = 'recommended' } = request
    if (!this.capabilities.routeAlternativeModes.includes(mode)) return []
    const baseSegmentKey = transportRouteCacheKey(from.id, to.id, mode); const cacheKey = `${baseSegmentKey}:${preference}`
    const cached = this.routeOptionsCache.get(cacheKey); if (!force && cached?.length) return this.cloneRouteOptions(cached)
    const sdk = this.sdk ?? await loadTencentMap()
    const params = this.withServiceSk({ from: new sdk.LatLng(from.lat, from.lng), to: new sdk.LatLng(to.lat, to.lng), fromPoi: from.provider === 'tencent' ? from.providerId : undefined, toPoi: to.provider === 'tencent' ? to.providerId : undefined })
    let result: any
    try {
      if (mode === 'driving') result = await new sdk.service.Driving({ policy: this.drivingPolicy(preference), mp: true }).search(params)
      else if (mode === 'walking') result = await new sdk.service.Walking().search(params)
      else if (mode === 'cycling') result = await new sdk.service.Bicycling().search(params)
      else result = await new sdk.service.Transit({ policy: this.transitPolicy(preference) }).search(params)
      this.assertServiceResult('路线查询', result)
    } catch (error) { throw this.serviceError('路线查询', error) }
    const normalized = (result?.result?.routes ?? []).map((route: any, index: number) => this.normalizeRouteOption(route, index, from, to, mode, preference))
    if (normalized.length) {
      const first = normalized[0]; this.segmentRouteCache.set(baseSegmentKey, { path: first.path, km: first.distanceKm, min: first.durationMinutes, toll: first.toll }); this.routeOptionsCache.set(cacheKey, normalized)
    }
    return this.cloneRouteOptions(normalized)
  }

  async searchDayRouteOptions(request: DayRouteOptionRequest): Promise<RouteOption[]> {
    const places = request.places; if (places.length < 2) return []
    const sdk = this.sdk ?? await loadTencentMap(); const from = places[0]; const to = places[places.length - 1]
    let result: any
    try {
      result = await new sdk.service.Driving({ policy: this.drivingPolicy(request.preference ?? 'recommended'), mp: true }).search(this.withServiceSk({ from: new sdk.LatLng(from.lat, from.lng), to: new sdk.LatLng(to.lat, to.lng), waypoints: places.slice(1, -1).map((place) => new sdk.LatLng(place.lat, place.lng)) }))
      this.assertServiceResult('全天路线查询', result)
    } catch (error) { throw this.serviceError('全天路线查询', error) }
    return (result?.result?.routes ?? []).map((route: any, index: number) => {
      const option = this.normalizeRouteOption(route, index, from, to, 'driving', request.preference ?? 'recommended')
      option.id = `tencent-day-${places.map((place) => place.id).join('-')}-${index}-${option.distanceKm}-${option.durationMinutes}`; option.strategyLabel = index === 0 ? '全天推荐' : `全天备选 ${index + 1}`; return option
    })
  }

  previewRouteOptions(options: RouteOption[], selectedId?: string): void {
    this.clearRouteOptionsPreview(); if (!this.map || !this.sdk) return
    options.forEach((option) => {
      const selected = !selectedId || option.id === selectedId
      const layer = this.createPolyline(option.path, selected ? '#536fda' : '#aeb7c8', selected ? 8 : 5, true, `preview-${option.id}`, false)
      layer.on?.('click', () => { this.previewRouteOptions(options, option.id); this.callbacks?.onPreviewRouteOption(option.id) }); this.routeOptionPreviewOverlays.push(layer)
    })
  }

  clearRouteOptionsPreview(): void { this.routeOptionPreviewOverlays.forEach((overlay) => this.removeOverlay(overlay)); this.routeOptionPreviewOverlays = [] }

  async locateCurrentPosition(): Promise<CurrentLocationResult> {
    if (!navigator.geolocation) throw new Error('当前浏览器不支持定位')
    const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 }))
    const lng = position.coords.longitude; const lat = position.coords.latitude
    this.map?.easeTo?.({ center: new this.sdk.LatLng(lat, lng), zoom: Math.max(16, Number(this.map.getZoom?.()) || 16) }, { duration: 420 })
    const element = document.createElement('div'); element.className = 'current-location-marker'; element.innerHTML = '<span></span>'; this.overlays.push(this.createDomOverlay([lng, lat], element, 0, 0, 260))
    let address = ''; try { address = (await new this.sdk.service.Geocoder().getAddress(this.withServiceSk({ location: new this.sdk.LatLng(lat, lng), getPoi: false })))?.result?.address ?? '' } catch { /* optional */ }
    return { lng, lat, accuracy: position.coords.accuracy, address, locationType: 'browser' }
  }

  focusPlace(place: Place): void { this.pendingFocusPlace = place; this.applyPlaceFocus(place) }
  setPickMode(enabled: boolean): void { this.pickMode = enabled; if (this.container) this.container.style.cursor = enabled ? 'crosshair' : '' }
  setTrafficEnabled(enabled: boolean): void { this.trafficEnabled = enabled; this.applyBaseMap() }

  async setDisplayMode(mode: MapDisplayMode): Promise<void> {
    if (!this.capabilities.displayModes.includes(mode) || this.displayMode === mode) return
    this.displayMode = mode; if (!this.map) return
    const tilted = mode === 'tilted'; this.map.setViewMode?.(tilted ? '3D' : '2D'); this.map.setPitchable?.(tilted); this.map.setRotatable?.(tilted); this.map.easeTo?.({ pitch: tilted ? 50 : 0, rotation: 0 }, { duration: 360 })
  }

  zoomIn(): void { const zoom = Number(this.map?.getZoom?.() ?? 7); this.map?.zoomTo?.(zoom + 1, { duration: 220 }) }
  zoomOut(): void { const zoom = Number(this.map?.getZoom?.() ?? 7); this.map?.zoomTo?.(zoom - 1, { duration: 220 }) }
  resize(): void { this.map?.resize?.() }
  destroy(): void {
    this.routeToken += 1; this.clearRouteOptionsPreview(); this.clearOverlays(); this.map?.off?.('click', this.mapClickHandler); this.map?.destroy?.(); this.map = null; this.sdk = null; this.callbacks = null; this.container = null
  }

  private normalizePoiResults(items: any[], fallbackName: string, limit: number): PoiSearchResult[] {
    return items.slice(0, limit).flatMap((item, index): PoiSearchResult[] => {
      const point = this.pathPoint(item.location); const type = item.category || '腾讯地点'
      if (!point) return []
      return [{
        id: `tencent_${item.id || `${Date.now()}_${index}`}`, name: item.title || item.name || fallbackName, type,
        category: categoryFromPoi(`${type} ${item.title || item.name || ''}`), priority: 'normal',
        address: [item.ad_info?.province, item.ad_info?.city, item.ad_info?.district, item.address].filter(Boolean).join(' · '),
        provider: 'tencent', providerId: item.id, adCode: item.ad_info?.adcode ? String(item.ad_info.adcode) : undefined, cityCode: item.ad_info?.city ? String(item.ad_info.city) : undefined,
        lng: point[0], lat: point[1], distanceMeters: Number.isFinite(Number(item._distance)) ? Math.max(0, Math.round(Number(item._distance))) : undefined, crs: 'GCJ02',
      }]
    })
  }

  private toPlaceDetails(item: any, matchedBy: PlaceDetails['matchedBy']): PlaceDetails {
    return {
      sourceProvider: 'tencent', providerId: String(item.id ?? ''), matchedBy, confidence: matchedBy === 'provider-id' ? 'high' : 'medium', name: item.title || item.name || '', type: item.category || '腾讯地点',
      address: [item.ad_info?.province, item.ad_info?.city, item.ad_info?.district, item.address].filter(Boolean).join(' · '), telephone: item.tel || undefined, photos: [],
    }
  }

  private async pickAt(lng: number, lat: number, poiName = ''): Promise<void> {
    const token = ++this.pickToken; this.callbacks?.onMapPickStart(lng, lat)
    const sdk = this.sdk ?? await loadTencentMap(); const location = new sdk.LatLng(lat, lng)
    let address = `${lng.toFixed(6)}, ${lat.toFixed(6)}`; let candidates: PoiSearchResult[] = []
    try {
      const result = await new sdk.service.Geocoder().getAddress(this.withServiceSk({ location, getPoi: true, poiOptions: 'address_format=short;radius=1000;policy=1' }))
      if (token !== this.pickToken) return
      address = result?.result?.address ?? address; candidates = this.normalizePoiResults(result?.result?.pois ?? [], poiName || '地图选点', 8)
      if (poiName) { const matched = candidates.find((item) => item.name === poiName); if (matched) candidates = [matched, ...candidates.filter((item) => item.id !== matched.id)] }
    } catch { /* coordinate picking still works */ }
    if (token !== this.pickToken) return
    const marker = document.createElement('div'); marker.className = 'map-pick-coordinate-marker'; marker.innerHTML = '<span></span>'; this.overlays.push(this.createDomOverlay([lng, lat], marker, 0, 0, 270))
    this.callbacks?.onMapPick({ lng, lat, address, candidates })
  }

  private async renderRoutes(days: TripDay[], scene: MapScene, markerPoints: Array<[number, number]>, token: number, shouldFitViewport: boolean): Promise<void> {
    const stops = days.flatMap((day) => day.stops); if (stops.length < 2) return
    const combined: TripDay = { ...days[0], id: '__all__', label: '全程', stops }
    const result = await this.renderRoute(combined, scene, token)
    if (!result || token !== this.routeToken) return
    if (!this.consumePendingFocus() && shouldFitViewport) this.fitPoints([...markerPoints, ...result.points])
    this.callbacks?.onRouteSummary({ km: result.km, min: result.min, source: result.providerCount ? 'provider' : 'cache' })
  }

  private async renderRoute(day: TripDay, scene: MapScene, token: number): Promise<{ km: number; min: number; providerCount: number; points: Array<[number, number]> } | null> {
    let totalKm = 0; let totalMin = 0; let providerCount = 0; let errorShown = false
    const points: Array<[number, number]> = []; const places = Object.fromEntries(scene.places.map((place) => [place.id, place]))
    for (let index = 0; index < day.stops.length - 1; index += 1) {
      if (token !== this.routeToken) return null
      const fromStop = day.stops[index]; const toStop = day.stops[index + 1]; const from = places[fromStop.placeId]; const to = places[toStop.placeId]
      if (!from || !to) continue
      const mode = transportModeOf(fromStop.transportMode); const fallback = routeInfo(fromStop, toStop, places, scene.routeCache)
      let path = this.createManualPath(from, to, mode); let km = fallback.km; let min = fallback.min; let pending = Boolean(fallback.pending); let source = fallback.source ?? 'estimate'; let showDirection = false
      const selected = fromStop.selectedRoute && fromStop.selectedRoute.mode === mode && fromStop.selectedRoute.toPlaceId === to.id ? fromStop.selectedRoute : null
      if (selected) {
        path = decodeRoutePath(selected.encodedPath); km = selected.distanceKm; min = selected.durationMinutes; pending = false; source = 'provider'; showDirection = path.length > 0; providerCount += 1
      } else if (transportModeMeta[mode].automatic) {
        const key = transportRouteCacheKey(from.id, to.id, mode)
        let resolved = this.segmentRouteCache.get(key) ?? null
        if (!resolved) { try { resolved = await this.searchTencentRoute(mode, from, to) } catch { resolved = null } }
        if (token !== this.routeToken) return null
        if (resolved) {
          path = resolved.path.length ? resolved.path : path; km = resolved.km; min = resolved.min; pending = false; source = 'provider'; showDirection = true; providerCount += 1
          this.segmentRouteCache.set(key, resolved); this.callbacks?.onRouteSegment(from.id, to.id, mode, km, min, resolved.toll)
        } else if (!errorShown) { errorShown = true; this.callbacks?.onError(`腾讯地图${transportModeMeta[mode].label}路线计算失败，已显示地点连线和暂估用时`) }
      }
      totalKm += km; totalMin += min; points.push(...path)
      const warning = scene.routeWarning
      this.drawRoute(path, warning, mode, showDirection, from.id, to.id, index)
      this.drawRouteInfo(path, from, to, mode, km, min, pending, source, warning, index, day.stops.length > 6)
      if (transportModeMeta[mode].automatic) await new Promise((resolve) => window.setTimeout(resolve, 120))
    }
    return { km: totalKm, min: totalMin, providerCount, points }
  }

  private drawRoute(path: Array<[number, number]>, warning: boolean, mode: TransportMode, showDirection: boolean, fromId: string, toId: string, index: number): void {
    const layer = this.createPolyline(path, warning ? '#df5b5b' : transportModeMeta[mode].color, mode === 'flight' ? 5 : 6, showDirection, `route-${index}-${fromId}-${toId}`, !transportModeMeta[mode].automatic)
    layer.on?.('click', () => this.callbacks?.onSelectRouteSegment(fromId, toId)); this.overlays.push(layer)
  }

  private drawRouteInfo(path: Array<[number, number]>, from: Place, to: Place, mode: TransportMode, km: number, min: number, pending: boolean, source: string, warning: boolean, index: number, compact: boolean): void {
    const content = document.createElement('div'); const sourceClass = source === 'provider' || source === 'cache' ? 'verified' : source === 'manual' ? 'manual' : 'estimated'
    content.className = `map-route-info mode-${mode} ${warning ? 'warning' : ''} ${pending ? 'pending' : ''} ${sourceClass} ${compact ? 'compact' : ''}`; content.dataset.routeMode = mode
    content.style.setProperty('--route-color', transportModeMeta[mode].color); content.style.setProperty('--route-label-y', `${[-32, 44, -52, 62][index % 4]}px`)
    const duration = pending ? '待填用时' : formatDuration(min); const distance = km > 0 ? `${km} km` : '里程待补充'; const sourceSuffix = sourceClass === 'estimated' ? ' · 暂估' : sourceClass === 'manual' ? ' · 手动' : ''
    content.innerHTML = `<span class="map-route-info-glyph">${this.escape(transportModeMeta[mode].glyph)}</span><div><strong>${this.escape(transportModeMeta[mode].label)} · ${this.escape(duration)}</strong><small>${this.escape(distance)}${sourceSuffix}</small></div>${warning ? '<i class="pi pi-exclamation-triangle"></i>' : ''}`
    content.title = `${from.name} → ${to.name} · ${transportModeMeta[mode].label} · ${duration} · ${distance}`; content.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectRouteSegment(from.id, to.id) })
    this.overlays.push(this.createDomOverlay(this.routeMidpoint(path, from, to), content, 0, 0, 220 + index))
  }

  private createPolyline(path: Array<[number, number]>, color: string, width: number, showArrow: boolean, id: string, dashed: boolean): any {
    const styleOptions: Record<string, unknown> = { color, width, borderWidth: 2, borderColor: '#ffffff', lineCap: 'round', showArrow }
    if (dashed) styleOptions.dashArray = [12, 8]
    return new this.sdk.MultiPolyline({
      map: this.map,
      styles: { route: new this.sdk.PolylineStyle(styleOptions) },
      geometries: [{ id, styleId: 'route', paths: path.map(([lng, lat]) => new this.sdk.LatLng(lat, lng)) }],
    })
  }

  private createDomOverlay(position: [number, number], element: HTMLElement, offsetX = 0, offsetY = 0, zIndex = 100): any {
    const sdk = this.sdk
    const Overlay = function(this: any, options: any) { sdk.DOMOverlay.call(this, options) } as any
    Overlay.prototype = new sdk.DOMOverlay()
    Overlay.prototype.onInit = function(options: any) { this.position = options.position; this.element = options.element; this.offsetX = options.offsetX; this.offsetY = options.offsetY; this.zIndex = options.zIndex }
    Overlay.prototype.createDOM = function() { this.element.style.position = 'absolute'; this.element.style.zIndex = String(this.zIndex); return this.element }
    Overlay.prototype.updateDOM = function() {
      if (!this.map || !this.dom) return
      const pixel = this.map.projectToContainer(this.position); const left = pixel.getX() - this.dom.clientWidth / 2 + this.offsetX; const top = pixel.getY() - this.dom.clientHeight / 2 + this.offsetY
      this.dom.style.pointerEvents = 'auto'
      if (this.dom.parentElement) this.dom.parentElement.style.pointerEvents = 'none'
      if (this.dom.parentElement?.parentElement) this.dom.parentElement.parentElement.style.pointerEvents = 'none'
      this.dom.style.transform = `translate3d(${left}px, ${top}px, 0)`
    }
    return new Overlay({ map: this.map, position: new sdk.LatLng(position[1], position[0]), element, offsetX, offsetY, zIndex, sameSource: false, crossSource: false })
  }

  private applyBaseMap(): void {
    if (!this.map) return
    const base = this.satelliteEnabled ? { type: 'satellite', features: ['base', 'road'] } : { type: 'vector', features: ['base', 'building2d', 'building3d', 'point', 'label', 'arrow'] }
    this.map.setBaseMap?.(this.trafficEnabled ? [base, { type: 'traffic', features: ['base'], opacity: 0.82 }] : base)
  }

  private normalizeRouteOption(route: any, index: number, from: Place, to: Place, mode: TransportMode, preference: RouteOptionRequest['preference']): RouteOption {
    const path = this.collectPolyline(route); const distanceKm = Math.max(1, Math.round(Number(route.distance ?? 0) / 1000)); const durationMinutes = Math.max(1, Math.round(Number(route.duration ?? 0)))
    const toll = mode === 'driving' && Number.isFinite(Number(route.toll)) ? Math.max(0, Number(route.toll)) : undefined
    const transitSteps = mode === 'transit' ? (route.steps ?? []).filter((step: any) => step.mode === 'TRANSIT') : []
    const transferCount = mode === 'transit' ? Math.max(0, transitSteps.length - 1) : undefined
    const preferenceLabel = preference === 'fastest' ? '用时优先' : preference === 'shortest' ? mode === 'transit' ? '少步行' : '距离优先' : preference === 'least-toll' ? '少收费' : preference === 'avoid-congestion' ? mode === 'transit' ? '少换乘' : '躲避拥堵' : '腾讯推荐'
    return {
      id: `tencent-${mode}-${from.id}-${to.id}-${index}-${distanceKm}-${durationMinutes}`, providerId: 'tencent', providerName: '腾讯地图', fromPlaceId: from.id, toPlaceId: to.id, mode,
      strategyLabel: index === 0 ? preferenceLabel : route.tags?.[0] ? String(route.tags[0]) : `备选路线 ${index + 1}`,
      distanceKm, durationMinutes, toll, transferCount, trafficLightCount: Number.isFinite(Number(route.traffic_light_count)) ? Number(route.traffic_light_count) : undefined,
      path: path.length ? path : [[from.lng, from.lat], [to.lng, to.lat]], crs: 'GCJ02', queriedAt: new Date().toISOString(),
    }
  }

  private async searchTencentRoute(mode: TransportMode, from: Place, to: Place): Promise<TencentRouteData | null> {
    const first = (await this.searchRouteOptions({ from, to, mode }))[0]
    return first ? { path: first.path, km: first.distanceKm, min: first.durationMinutes, toll: first.toll } : null
  }

  private collectPolyline(value: any): Array<[number, number]> {
    const points: Array<[number, number]> = []
    const visit = (current: any, key = ''): void => {
      if (!current) return
      if (key === 'polyline' && Array.isArray(current)) { current.forEach((point) => { const normalized = this.pathPoint(point); if (normalized) points.push(normalized) }); return }
      if (Array.isArray(current)) { current.forEach((item) => visit(item)); return }
      if (typeof current === 'object') Object.entries(current).forEach(([childKey, child]) => visit(child, childKey))
    }
    visit(value)
    return points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1])
  }

  private pathPoint(point: any): [number, number] | null {
    const lat = Number(point?.lat ?? point?.getLat?.() ?? point?.[1]); const lng = Number(point?.lng ?? point?.getLng?.() ?? point?.[0])
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  private routeMidpoint(path: Array<[number, number]>, from: Place, to: Place): [number, number] {
    if (path.length < 2) return [(from.lng + to.lng) / 2, (from.lat + to.lat) / 2]
    const lengths = path.slice(1).map((point, index) => Math.hypot(point[0] - path[index][0], point[1] - path[index][1])); const target = lengths.reduce((sum, length) => sum + length, 0) / 2
    let walked = 0
    for (let index = 0; index < lengths.length; index += 1) {
      if (walked + lengths[index] >= target) { const ratio = lengths[index] ? (target - walked) / lengths[index] : 0; return [path[index][0] + (path[index + 1][0] - path[index][0]) * ratio, path[index][1] + (path[index + 1][1] - path[index][1]) * ratio] }
      walked += lengths[index]
    }
    return path[Math.floor(path.length / 2)]
  }

  private createManualPath(from: Place, to: Place, mode: TransportMode): Array<[number, number]> {
    if (mode !== 'flight') return [[from.lng, from.lat], [to.lng, to.lat]]
    const dx = to.lng - from.lng; const dy = to.lat - from.lat; const length = Math.hypot(dx, dy) || 1; const curve = Math.min(1.2, length * 0.16)
    const controlLng = (from.lng + to.lng) / 2 - (dy / length) * curve; const controlLat = (from.lat + to.lat) / 2 + (dx / length) * curve
    return Array.from({ length: 25 }, (_, index) => { const t = index / 24; const r = 1 - t; return [r * r * from.lng + 2 * r * t * controlLng + t * t * to.lng, r * r * from.lat + 2 * r * t * controlLat + t * t * to.lat] })
  }

  private fitPoints(points: Array<[number, number]>): void {
    if (!this.map || !this.sdk || !points.length) return
    const lngs = points.map((point) => point[0]); const lats = points.map((point) => point[1])
    const bounds = new this.sdk.LatLngBounds(new this.sdk.LatLng(Math.min(...lats), Math.min(...lngs)), new this.sdk.LatLng(Math.max(...lats), Math.max(...lngs)))
    this.map.fitBounds?.(bounds, { padding: 110, maxZoom: 16 })
  }

  private applyPlaceFocus(place: Place): void {
    if (!this.map || !this.sdk) return
    const zoom = Math.max(15, Math.min(18, Number(this.map.getZoom?.()) || 15)); this.map.easeTo?.({ center: new this.sdk.LatLng(place.lat, place.lng), zoom }, { duration: 420 })
  }

  private consumePendingFocus(): boolean {
    if (!this.pendingFocusPlace) return false
    const place = this.pendingFocusPlace; this.pendingFocusPlace = null; this.applyPlaceFocus(place); return true
  }

  private removeOverlay(overlay: any): void { try { overlay?.setMap?.(null) } catch { try { overlay?.destroy?.() } catch { /* noop */ } } }
  private clearOverlays(): void { this.overlays.forEach((overlay) => this.removeOverlay(overlay)); this.overlays = [] }
  private cloneRouteOptions(options: RouteOption[]): RouteOption[] { return options.map((option) => ({ ...option, path: option.path.map((point) => [...point] as [number, number]) })) }
  private drivingPolicy(preference: RouteOptionRequest['preference']): string { return preference === 'least-toll' ? 'LEAST_TIME,LEAST_FEE' : preference === 'avoid-congestion' ? 'LEAST_TIME,REAL_TRAFFIC' : 'LEAST_TIME' }
  private transitPolicy(preference: RouteOptionRequest['preference']): string { return preference === 'shortest' ? 'LEAST_WALKING' : preference === 'avoid-congestion' ? 'LEAST_TRANSFER' : 'RECOMMEND' }
  private withServiceSk<T extends Record<string, unknown>>(params: T): T & { servicesk?: string } {
    const clean = Object.fromEntries(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== '')) as T
    const servicesk = readTencentMapConfig()?.serviceSk
    return servicesk ? { ...clean, servicesk } : clean
  }
  private assertServiceResult(action: string, result: any): void {
    const status = Number(result?.status ?? 0)
    if (Number.isFinite(status) && status !== 0) throw { status, message: result?.message || `${action}失败` }
  }
  private serviceError(action: string, reason: any): Error {
    if (reason instanceof Error && !Number.isFinite(Number((reason as any).status))) return reason
    const status = Number(reason?.status ?? reason?.code ?? reason?.response?.status)
    const hints: Record<number, string> = {
      110: '当前网站域名未加入腾讯 Key 的 WebServiceAPI 授权域名',
      111: '服务签名验证失败，请清空错误的 SK，或填写控制台生成的有效 SK',
      113: '当前 Key 没有该路线服务权限',
      120: '当前 Key 每秒请求量已达到上限',
      121: '当前 Key 每日调用量已达到上限',
      190: '腾讯位置服务 Key 无效',
      199: '当前 Key 尚未开启 WebServiceAPI',
      326: '起点和终点距离过近',
      332: '途经点数量超过腾讯路线服务限制',
      373: '起点和终点距离超过该交通方式的规划范围',
      374: '起点或终点坐标无效',
      377: '当前起终点无法规划出驾车路线',
      378: '当前起终点无法规划出步行路线',
      379: '当前起终点无法规划出公交路线',
      384: '当前起终点无法规划出骑行路线',
    }
    const code = Number.isFinite(status) ? `（状态码 ${status}）` : ''
    const detail = hints[status] || reason?.message || reason?.info || reason?.msg || '请检查 WebServiceAPI 权限、调用域名和服务签名配置'
    return new Error(`腾讯地图${action}失败${code}：${detail}`)
  }
  private normalizedName(value = ''): string { return value.replace(/[\s·・()（）景区国家级风景名胜区]/g, '') }
  private escape(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character) }
}

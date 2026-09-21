import { categoryIconMarkup } from '../../../assets/icons/placeCategoryIcons'
import { categoryFromPoi } from '../../../domain/categories'
import { decodeRoutePath } from '../../../domain/polyline'
import { formatDuration, routeInfo } from '../../../domain/schedule'
import { transportModeMeta, transportModeOf, transportRouteCacheKey } from '../../../domain/transport'
import type { CurrentLocationResult, DayRouteOptionRequest, MapDisplayMode, MapScene, Place, PlaceDetails, PoiSearchResult, RouteEstimate, RouteOption, RouteOptionRequest, RoutePreference, TransportMode, TripDay } from '../../../domain/types'
import type { PlanMapCallbacks, PlanMapProvider } from '../../PlanMapProvider'
import { readGoogleMapConfig } from './config'
import { loadGoogleMaps, type GoogleMapsLibraries } from './loader'

type Overlay = { setMap(map: google.maps.Map | null): void }
type RouteData = { path: Array<[number, number]>; km: number; min: number; toll?: number }
const SEARCH_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'primaryType', 'primaryTypeDisplayName']
const DETAIL_FIELDS = [...SEARCH_FIELDS, 'nationalPhoneNumber', 'websiteURI', 'rating', 'regularOpeningHours', 'editorialSummary']

export class GoogleMapProvider implements PlanMapProvider {
  readonly id = 'google'
  readonly coordinateSystem = 'WGS84' as const
  readonly capabilities = {
    dimension: '2.5D' as const, presentation: 'planar' as const, coordinateSystem: 'WGS84' as const,
    satellite: true, nativePoiSearch: true, nativeRouting: true, traffic: true, mapPicking: true,
    displayModes: ['flat', 'tilted'] as MapDisplayMode[], routeAlternativeModes: ['driving', 'walking', 'cycling', 'transit'] as TransportMode[],
  }
  private libraries: GoogleMapsLibraries | null = null
  private map: google.maps.Map | null = null
  private container: HTMLElement | null = null
  private callbacks: PlanMapCallbacks | null = null
  private pendingScene: MapScene | null = null
  private overlays: Overlay[] = []
  private previewOverlays: Overlay[] = []
  private trafficLayer: google.maps.TrafficLayer | null = null
  private clickListener: google.maps.MapsEventListener | null = null
  private displayMode: MapDisplayMode = 'flat'
  private trafficEnabled = false
  private pickMode = false
  private pickToken = 0
  private routeToken = 0
  private lastRouteSceneKey = ''
  private pendingFocusPlace: Place | null = null
  private segmentCache = new Map<string, RouteData>()
  private routeOptionsCache = new Map<string, RouteOption[]>()
  private detailsCache = new Map<string, PlaceDetails | null>()

  async mount(container: HTMLElement, callbacks: PlanMapCallbacks): Promise<void> {
    this.container = container; this.callbacks = callbacks; this.libraries = await loadGoogleMaps(); this.createMap()
  }

  private createMap(): void {
    if (!this.container || !this.libraries) return
    const config = readGoogleMapConfig()
    if (!config) throw new Error('尚未配置 Google Maps，请先填写 API Key')
    this.map = new this.libraries.maps.Map(this.container, {
      center: { lng: 104.2, lat: 35.7 }, zoom: 5.6, mapId: config.mapId,
      mapTypeId: google.maps.MapTypeId.ROADMAP, disableDefaultUI: true, clickableIcons: true,
      gestureHandling: 'greedy', keyboardShortcuts: false, tilt: this.displayMode === 'tilted' ? 45 : 0,
      heading: 0, minZoom: 2, maxZoom: 21, backgroundColor: '#e9efe9',
    })
    this.clickListener = this.map.addListener('click', (event: google.maps.MapMouseEvent & { placeId?: string }) => {
      if (!this.pickMode || !event.latLng) return
      event.stop?.(); void this.pickAt(event.latLng.lng(), event.latLng.lat(), event.placeId)
    })
    this.lastRouteSceneKey = ''
    if (this.trafficEnabled) this.applyTrafficLayer()
    if (this.pendingScene) this.updateScene(this.pendingScene)
  }

  updateScene(scene: MapScene): void {
    this.pendingScene = scene
    if (!this.map) return
    this.routeToken += 1; this.clearRouteOptionsPreview(); this.clearOverlays()
    const token = this.routeToken
    this.map.setMapTypeId(scene.satellite ? google.maps.MapTypeId.HYBRID : google.maps.MapTypeId.ROADMAP)
    const selectedDay = scene.days.find((day) => day.id === scene.selectedDayId) ?? scene.days[0]
    const routeDays = scene.routeDayIds.map((id) => scene.days.find((day) => day.id === id)).filter((day): day is TripDay => Boolean(day))
    const effectiveDays = routeDays.length ? routeDays : selectedDay ? [selectedDay] : []
    const routeSceneKey = JSON.stringify(effectiveDays.map((day) => ({ id: day.id, stops: day.stops.map((stop) => {
      const place = scene.places.find((item) => item.id === stop.placeId)
      return [stop.uid, stop.placeId, place?.lng, place?.lat, transportModeOf(stop.transportMode), stop.transportDuration, stop.transportDistance, stop.selectedRoute?.id]
    }) })))
    const shouldFit = routeSceneKey !== this.lastRouteSceneKey; this.lastRouteSceneKey = routeSceneKey
    const nodes = scene.days.flatMap((day) => day.stops.map((stop) => ({ day, stop })))
    const scheduledIds = new Set(nodes.map((node) => node.stop.placeId))
    const positions: google.maps.LatLngLiteral[] = []
    const occurrences = new Map<string, number>(); const offsets = [[0, 0], [-22, -18], [22, 18], [24, -20], [-24, 20]]
    nodes.forEach((node, globalIndex) => {
      const place = scene.places.find((item) => item.id === node.stop.placeId); if (!place) return
      const occurrence = occurrences.get(place.id) ?? 0; occurrences.set(place.id, occurrence + 1)
      const status = node.day.id === scene.selectedDayId ? 'current' : 'other'
      const classes = [status, scene.conflictPlaceIds.includes(place.id) ? 'conflict' : '', scene.selectedPlaceId === place.id ? 'selected' : '', globalIndex === 0 ? 'trip-start' : globalIndex === nodes.length - 1 ? 'trip-end' : ''].join(' ')
      const order = globalIndex + 1
      const wrapper = document.createElement('div')
      wrapper.innerHTML = `<div class="travel-marker ${classes}" data-place="${this.escape(place.id)}" data-order="${order}" style="--label-y:${[0, 12, -12, 16][globalIndex % 4]}px"><div class="travel-marker-core">${categoryIconMarkup(place.category, 'marker')}<span class="travel-marker-orders"><span class="travel-marker-order">${order}</span></span></div><span class="travel-marker-label">${this.escape(place.name)}</span></div>`
      const content = wrapper.firstElementChild as HTMLElement
      content.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectPlace(place.id) })
      this.overlays.push(this.htmlOverlay({ lng: place.lng, lat: place.lat }, content, 180 + globalIndex, 'bottom', offsets[occurrence % offsets.length]))
      positions.push({ lng: place.lng, lat: place.lat })
    })
    scene.places.filter((place) => !scheduledIds.has(place.id)).forEach((place) => {
      if (scene.categoryFilter !== 'all' && scene.categoryFilter !== place.category) return
      const wrapper = document.createElement('div')
      wrapper.innerHTML = `<div class="travel-marker candidate ${scene.selectedPlaceId === place.id ? 'selected' : ''}" data-place="${this.escape(place.id)}"><div class="travel-marker-core">${categoryIconMarkup(place.category, 'marker')}</div><span class="travel-marker-label">${this.escape(place.name)}</span></div>`
      const content = wrapper.firstElementChild as HTMLElement
      content.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectPlace(place.id) })
      this.overlays.push(this.htmlOverlay({ lng: place.lng, lat: place.lat }, content, 100, 'bottom')); positions.push({ lng: place.lng, lat: place.lat })
    })
    if (nodes.length > 1) void this.renderRoutes(effectiveDays, scene, positions, token, shouldFit)
    else if (!this.consumePendingFocus() && shouldFit) this.fitPositions(positions)
  }

  async searchPlaces(keyword: string): Promise<PoiSearchResult[]> {
    const query = keyword.trim(); if (!query) return []
    await this.ensureLibraries()
    const { places = [] } = await this.libraries!.places.Place.searchByText({ textQuery: query, fields: SEARCH_FIELDS, maxResultCount: 12, ...this.locale() })
    return places.map((place, index) => this.toPoi(place, index)).filter((place): place is PoiSearchResult => Boolean(place))
  }

  async searchNearbyPlaces(center: Place, keyword: string, radiusMeters: number): Promise<PoiSearchResult[]> {
    const query = keyword.trim(); if (!query) return []
    await this.ensureLibraries()
    const { places = [] } = await this.libraries!.places.Place.searchByText({ textQuery: query, fields: SEARCH_FIELDS, maxResultCount: 20, locationBias: { center: { lng: center.lng, lat: center.lat }, radius: radiusMeters }, ...this.locale() })
    return places.map((place, index) => this.toPoi(place, index, center)).filter((place): place is PoiSearchResult => Boolean(place))
      .filter((place) => !place.distanceMeters || place.distanceMeters <= radiusMeters * 1.2)
      .sort((a, b) => (a.distanceMeters ?? Infinity) - (b.distanceMeters ?? Infinity)).slice(0, 12)
  }

  async getPlaceDetails(place: Place): Promise<PlaceDetails | null> {
    if (place.provider === 'manual') return null
    const key = `${place.providerId || place.name}|${place.lng.toFixed(5)}|${place.lat.toFixed(5)}`
    if (this.detailsCache.has(key)) return this.detailsCache.get(key) ?? null
    await this.ensureLibraries()
    let matched: google.maps.places.Place | null = null; let matchedBy: PlaceDetails['matchedBy'] = 'name-and-location'
    try {
      if (place.provider === 'google' && place.providerId) {
        matched = new this.libraries!.places.Place({ id: place.providerId }); await matched.fetchFields({ fields: DETAIL_FIELDS }); matchedBy = 'provider-id'
      } else {
        const result = await this.libraries!.places.Place.searchByText({ textQuery: place.name, fields: SEARCH_FIELDS, maxResultCount: 5, locationBias: { center: { lng: place.lng, lat: place.lat }, radius: 4000 }, ...this.locale() })
        matched = result.places.sort((a, b) => this.placeDistance(a, place) - this.placeDistance(b, place))[0] ?? null
        if (matched) await matched.fetchFields({ fields: DETAIL_FIELDS })
      }
    } catch { matched = null }
    const details = matched ? this.toDetails(matched, matchedBy) : null; this.detailsCache.set(key, details); return details
  }

  locateCurrentPosition(): Promise<CurrentLocationResult> {
    if (!navigator.geolocation) return Promise.reject(new Error('当前浏览器不支持定位'))
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(async (position) => {
      const lng = position.coords.longitude; const lat = position.coords.latitude; let address = ''
      try {
        await this.ensureLibraries(); const result = await new this.libraries!.geocoding.Geocoder().geocode({ location: { lng, lat }, ...this.locale() }); address = result.results[0]?.formatted_address ?? ''
      } catch { /* address is optional */ }
      this.map?.panTo({ lng, lat }); this.map?.setZoom(Math.max(this.map.getZoom() ?? 15, 15))
      if (this.map) { const content = document.createElement('div'); content.className = 'current-location-marker'; content.innerHTML = '<span></span>'; this.overlays.push(this.htmlOverlay({ lng, lat }, content, 420, 'center')) }
      resolve({ lng, lat, accuracy: position.coords.accuracy, address, locationType: '浏览器定位', crs: 'WGS84' })
    }, (reason) => reject(new Error(reason.code === 1 ? '定位权限被拒绝，请在浏览器中允许访问当前位置' : '无法获取当前位置，请检查系统定位和网络')), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }))
  }

  focusPlace(place: Place): void {
    if (!this.map) { this.pendingFocusPlace = place; return }
    this.map.panTo({ lng: place.lng, lat: place.lat }); this.map.setZoom(Math.max(this.map.getZoom() ?? 13, 14))
  }
  setPickMode(enabled: boolean): void { this.pickMode = enabled; this.map?.setOptions({ draggableCursor: enabled ? 'crosshair' : null }) }
  setTrafficEnabled(enabled: boolean): void { this.trafficEnabled = enabled; this.applyTrafficLayer() }
  async setDisplayMode(mode: MapDisplayMode): Promise<void> {
    if (mode !== 'flat' && mode !== 'tilted') throw new Error('Google Maps 仅支持 2D 与倾斜视角')
    if (mode === 'tilted' && !readGoogleMapConfig()?.mapId) throw new Error('Google 倾斜视角需要先配置支持矢量地图的 Map ID')
    this.displayMode = mode; this.map?.setTilt(mode === 'tilted' ? 45 : 0); this.map?.setHeading(0)
    if (mode === 'tilted' && (this.map?.getZoom() ?? 0) < 17) this.map?.setZoom(17)
  }
  zoomIn(): void { if (this.map) this.map.setZoom(Math.min(21, (this.map.getZoom() ?? 8) + 1)) }
  zoomOut(): void { if (this.map) this.map.setZoom(Math.max(2, (this.map.getZoom() ?? 8) - 1)) }
  resize(): void { if (this.map) google.maps.event.trigger(this.map, 'resize') }
  destroy(): void {
    this.routeToken += 1; this.pickToken += 1; this.clearRouteOptionsPreview(); this.clearOverlays(); this.trafficLayer?.setMap(null); this.trafficLayer = null
    this.clickListener?.remove(); this.clickListener = null; this.container?.replaceChildren(); this.map = null; this.container = null; this.callbacks = null
  }

  async estimateRoute(from: Place, to: Place, mode: TransportMode): Promise<RouteEstimate | null> {
    if (!this.capabilities.routeAlternativeModes.includes(mode)) return null
    const option = (await this.searchRouteOptions({ from, to, mode }))[0]
    return option ? { km: option.distanceKm, min: option.durationMinutes, toll: option.toll, source: 'provider' } : null
  }

  async searchRouteOptions(request: RouteOptionRequest): Promise<RouteOption[]> {
    const { from, to, mode, force, preference = 'recommended' } = request
    if (!this.capabilities.routeAlternativeModes.includes(mode)) return []
    const key = `${transportRouteCacheKey(from.id, to.id, mode)}|${preference}`
    if (!force && this.routeOptionsCache.has(key)) return this.cloneOptions(this.routeOptionsCache.get(key)!)
    const routes = await this.computeRoutes(from, to, mode, preference, [], true)
    const options = routes.map((route, index) => this.toRouteOption(route, from, to, mode, preference, index, false))
    if (options.length) {
      const first = options[0]; this.segmentCache.set(transportRouteCacheKey(from.id, to.id, mode), { path: first.path, km: first.distanceKm, min: first.durationMinutes, toll: first.toll }); this.routeOptionsCache.set(key, options)
    }
    return this.cloneOptions(options)
  }

  async searchDayRouteOptions(request: DayRouteOptionRequest): Promise<RouteOption[]> {
    if (request.places.length < 2) return []
    const from = request.places[0]; const to = request.places[request.places.length - 1]
    const routes = await this.computeRoutes(from, to, 'driving', request.preference ?? 'recommended', request.places.slice(1, -1), false)
    return routes.map((route, index) => this.toRouteOption(route, from, to, 'driving', request.preference ?? 'recommended', index, true))
  }

  previewRouteOptions(options: RouteOption[], selectedId?: string): void {
    this.clearRouteOptionsPreview(); if (!this.map) return
    options.forEach((option, index) => {
      const selected = option.id === selectedId || (!selectedId && index === 0); const color = selected ? '#536fda' : '#8793a8'
      const line = new google.maps.Polyline({ map: this.map!, path: option.path.map(([lng, lat]) => ({ lng, lat })), strokeColor: color, strokeOpacity: selected ? .95 : .55, strokeWeight: selected ? 7 : 4, zIndex: selected ? 410 : 390, clickable: true })
      line.addListener('click', () => this.callbacks?.onPreviewRouteOption(option.id)); this.previewOverlays.push(line)
    })
  }
  clearRouteOptionsPreview(): void { this.previewOverlays.forEach((overlay) => { try { overlay.setMap(null) } catch { /* noop */ } }); this.previewOverlays = [] }

  private async renderRoutes(days: TripDay[], scene: MapScene, positions: google.maps.LatLngLiteral[], token: number, shouldFit: boolean): Promise<void> {
    const stops = days.flatMap((day) => day.stops); if (stops.length < 2) return
    const result = await this.renderRoute({ ...days[0], id: '__all__', label: '全程', stops }, scene, token)
    if (!result || token !== this.routeToken) return
    if (!this.consumePendingFocus() && shouldFit) this.fitPositions([...positions, ...result.path.map(([lng, lat]) => ({ lng, lat }))])
    this.callbacks?.onRouteSummary({ km: result.km, min: result.min, source: result.providerCount ? 'provider' : 'cache' })
  }

  private async renderRoute(day: TripDay, scene: MapScene, token: number): Promise<{ km: number; min: number; providerCount: number; path: Array<[number, number]> } | null> {
    let totalKm = 0; let totalMin = 0; let providerCount = 0; let errorShown = false; const fullPath: Array<[number, number]> = []
    const places = Object.fromEntries(scene.places.map((place) => [place.id, place]))
    for (let index = 0; index < day.stops.length - 1; index += 1) {
      if (token !== this.routeToken) return null
      const fromStop = day.stops[index]; const toStop = day.stops[index + 1]; const from = places[fromStop.placeId]; const to = places[toStop.placeId]
      if (!from || !to) continue
      const mode = transportModeOf(fromStop.transportMode); const fallback = routeInfo(fromStop, toStop, places, scene.routeCache)
      let path = this.manualPath(from, to, mode); let km = fallback.km; let min = fallback.min; let pending = Boolean(fallback.pending); let source = fallback.source ?? 'estimate'; let direction = false
      const selected = fromStop.selectedRoute && fromStop.selectedRoute.mode === mode && fromStop.selectedRoute.toPlaceId === to.id ? fromStop.selectedRoute : null
      if (selected) { path = decodeRoutePath(selected.encodedPath); km = selected.distanceKm; min = selected.durationMinutes; pending = false; source = 'provider'; direction = path.length > 0; providerCount += 1 }
      else if (transportModeMeta[mode].automatic && this.capabilities.routeAlternativeModes.includes(mode)) {
        const cacheKey = transportRouteCacheKey(from.id, to.id, mode); let resolved = this.segmentCache.get(cacheKey) ?? null
        if (!resolved) try { const option = (await this.searchRouteOptions({ from, to, mode }))[0]; resolved = option ? { path: option.path, km: option.distanceKm, min: option.durationMinutes, toll: option.toll } : null } catch (reason) {
          if (!errorShown) { errorShown = true; this.callbacks?.onError(this.errorMessage(`${transportModeMeta[mode].label}路线计算`, reason)) }
        }
        if (token !== this.routeToken) return null
        if (resolved) { path = resolved.path.length ? resolved.path : [[from.lng, from.lat], [to.lng, to.lat]]; km = resolved.km; min = resolved.min; pending = false; source = 'provider'; direction = true; providerCount += 1; this.segmentCache.set(cacheKey, resolved); this.callbacks?.onRouteSegment(from.id, to.id, mode, km, min, resolved.toll) }
      }
      totalKm += km; totalMin += min
      const warning = day.id === '__all__' ? scene.routeWarning : scene.routeWarningDayIds.includes(day.id)
      this.drawRoute(path, warning, mode, direction, from.id, to.id); this.drawRouteInfo(path, from, to, mode, km, min, pending, source, warning, index, day.stops.length > 6)
      path.forEach((point, pointIndex) => { if (!fullPath.length || pointIndex > 0) fullPath.push(point) })
      if (transportModeMeta[mode].automatic) await new Promise((resolve) => window.setTimeout(resolve, 80))
    }
    return { km: totalKm, min: totalMin, providerCount, path: fullPath }
  }

  private async computeRoutes(from: Place, to: Place, mode: TransportMode, preference: RoutePreference, intermediates: Place[], alternatives: boolean): Promise<google.maps.routes.Route[]> {
    await this.ensureLibraries(); const travelMode = this.travelMode(mode); if (!travelMode) return []
    const driving = mode === 'driving'
    try {
      const response = await this.libraries!.routes.Route.computeRoutes({
        origin: { lat: from.lat, lng: from.lng }, destination: { lat: to.lat, lng: to.lng },
        intermediates: intermediates.map((place) => ({ location: { lat: place.lat, lng: place.lng } })), travelMode,
        computeAlternativeRoutes: alternatives && intermediates.length === 0,
        fields: ['path', 'distanceMeters', 'durationMillis', 'staticDurationMillis', 'description', 'routeLabels', 'travelAdvisory', 'viewport', 'legs'],
        polylineQuality: 'HIGH_QUALITY', language: readGoogleMapConfig()?.language, region: readGoogleMapConfig()?.region, units: google.maps.UnitSystem.METRIC,
        routingPreference: driving ? (preference === 'fastest' || preference === 'avoid-congestion' ? 'TRAFFIC_AWARE_OPTIMAL' : 'TRAFFIC_AWARE') : undefined,
        routeModifiers: driving && preference === 'least-toll' ? { avoidTolls: true } : undefined,
        requestedReferenceRoutes: driving && preference === 'shortest' ? ['SHORTER_DISTANCE'] : undefined,
        extraComputations: driving ? ['TOLLS'] : undefined,
      })
      return response.routes ?? []
    } catch (reason) { throw new Error(this.errorMessage('路线查询', reason)) }
  }

  private toRouteOption(route: google.maps.routes.Route, from: Place, to: Place, mode: TransportMode, preference: RoutePreference, index: number, dayRoute: boolean): RouteOption {
    const path = (route.path ?? []).map((point) => [Number(point.lng), Number(point.lat)] as [number, number]).filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat))
    const distanceKm = Math.max(.1, Math.round(Number(route.distanceMeters ?? 0) / 100) / 10)
    const durationMinutes = Math.max(1, Math.round(Number(route.durationMillis ?? route.staticDurationMillis ?? 0) / 60000))
    const money = route.travelAdvisory?.tollInfo?.estimatedPrices?.find((item) => item.currencyCode === 'CNY')
    const toll = money ? Math.max(0, money.units + money.nanos / 1e9) : undefined
    const labels = route.routeLabels ?? []
    const strategy = dayRoute ? (index === 0 ? '全天推荐' : `全天备选 ${index + 1}`) : route.description?.trim() || (labels.includes('SHORTER_DISTANCE') ? '距离较短' : labels.includes('FUEL_EFFICIENT') ? '节能路线' : index === 0 ? preference === 'fastest' ? '速度优先' : preference === 'least-toll' ? '少收费优先' : preference === 'avoid-congestion' ? '避开拥堵' : 'Google 推荐' : `备选路线 ${index + 1}`)
    return { id: `google-${dayRoute ? 'day-' : ''}${mode}-${from.id}-${to.id}-${index}-${distanceKm}-${durationMinutes}`, providerId: 'google', providerName: 'Google Maps', fromPlaceId: from.id, toPlaceId: to.id, mode, strategyLabel: strategy, distanceKm, durationMinutes, toll, path: path.length ? path : [[from.lng, from.lat], [to.lng, to.lat]], crs: 'WGS84', queriedAt: new Date().toISOString() }
  }

  private drawRoute(path: Array<[number, number]>, warning: boolean, mode: TransportMode, direction: boolean, fromId: string, toId: string): void {
    if (!this.map || path.length < 2) return
    const points = path.map(([lng, lat]) => ({ lng, lat })); const automatic = transportModeMeta[mode].automatic; const color = warning ? '#df5b5b' : transportModeMeta[mode].color
    const outline = new google.maps.Polyline({ map: this.map, path: points, strokeColor: '#fff', strokeOpacity: .94, strokeWeight: mode === 'flight' ? 8 : 10, zIndex: 180, clickable: false })
    const line = new google.maps.Polyline({ map: this.map, path: points, strokeColor: color, strokeOpacity: automatic ? .94 : 0, strokeWeight: mode === 'flight' ? 4 : 6, zIndex: 181, clickable: true,
      icons: automatic ? direction ? [{ icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, scale: 2.3, strokeColor: color, fillColor: color, fillOpacity: 1 }, offset: '12%', repeat: '90px' }] : undefined : [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, strokeColor: color, scale: 3 }, offset: '0', repeat: '14px' }] })
    line.addListener('click', () => this.callbacks?.onSelectRouteSegment(fromId, toId)); this.overlays.push(outline, line)
  }

  private drawRouteInfo(path: Array<[number, number]>, from: Place, to: Place, mode: TransportMode, km: number, min: number, pending: boolean, source: string, warning: boolean, index: number, compact: boolean): void {
    if (!path.length) return
    const content = document.createElement('div'); const sourceClass = source === 'provider' || source === 'cache' ? 'verified' : source === 'manual' ? 'manual' : 'estimated'
    content.className = `map-route-info mode-${mode} ${warning ? 'warning' : ''} ${pending ? 'pending' : ''} ${sourceClass} ${compact ? 'compact' : ''}`; content.dataset.routeMode = mode
    content.style.setProperty('--route-color', transportModeMeta[mode].color); content.style.setProperty('--route-label-y', `${[-32, 44, -52, 62][index % 4]}px`)
    const duration = pending ? '待填用时' : formatDuration(min); const distance = km > 0 ? `${km} km` : '里程待补充'; const suffix = sourceClass === 'estimated' ? ' · 暂估' : sourceClass === 'manual' ? ' · 手动' : ''
    content.innerHTML = `<span class="map-route-info-glyph">${this.escape(transportModeMeta[mode].glyph)}</span><div><strong>${this.escape(transportModeMeta[mode].label)} · ${this.escape(duration)}</strong><small>${this.escape(distance)}${suffix}</small></div>${warning ? '<i class="pi pi-exclamation-triangle"></i>' : ''}`
    content.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectRouteSegment(from.id, to.id) })
    const [lng, lat] = this.midpoint(path, from, to); this.overlays.push(this.htmlOverlay({ lng, lat }, content, 215 + index, 'center'))
  }

  private async pickAt(lng: number, lat: number, placeId?: string): Promise<void> {
    const token = ++this.pickToken; this.callbacks?.onMapPickStart(lng, lat); await this.ensureLibraries(); let address = ''; const candidates: PoiSearchResult[] = []
    try {
      if (placeId) { const place = new this.libraries!.places.Place({ id: placeId }); await place.fetchFields({ fields: SEARCH_FIELDS }); const result = this.toPoi(place, 0); if (result) candidates.push(result) }
      const geocode = await new this.libraries!.geocoding.Geocoder().geocode({ location: { lng, lat }, ...this.locale() }); address = geocode.results[0]?.formatted_address ?? ''
      if (!candidates.length) {
        const nearby = await this.libraries!.places.Place.searchNearby({ fields: SEARCH_FIELDS, locationRestriction: { center: { lng, lat }, radius: 180 }, maxResultCount: 8, rankPreference: 'DISTANCE', ...this.locale() })
        nearby.places.forEach((place, index) => { const result = this.toPoi(place, index, { lng, lat } as Place); if (result) candidates.push(result) })
      }
    } catch (reason) { if (!address && !candidates.length) this.callbacks?.onError(this.errorMessage('地点识别', reason)) }
    if (token === this.pickToken) this.callbacks?.onMapPick({ lng, lat, address, candidates, crs: 'WGS84' })
  }

  private htmlOverlay(position: google.maps.LatLngLiteral, content: HTMLElement, zIndex: number, anchor: 'bottom' | 'center', offset: number[] = [0, 0]): Overlay {
    if (!this.map) throw new Error('Google Maps 尚未初始化')
    const host = document.createElement('div'); host.className = `google-html-overlay anchor-${anchor}`; host.style.zIndex = String(zIndex); host.appendChild(content)
    const HtmlOverlay = class extends google.maps.OverlayView {
      onAdd(): void { this.getPanes()?.overlayMouseTarget.appendChild(host) }
      draw(): void { const point = this.getProjection()?.fromLatLngToDivPixel(new google.maps.LatLng(position)); if (point) { host.style.left = `${point.x + Number(offset[0] ?? 0)}px`; host.style.top = `${point.y + Number(offset[1] ?? 0)}px` } }
      onRemove(): void { host.remove() }
    }
    const overlay = new HtmlOverlay(); overlay.setMap(this.map); return overlay
  }

  private toPoi(place: google.maps.places.Place, index: number, center?: Pick<Place, 'lng' | 'lat'>): PoiSearchResult | null {
    if (!place.location) return null
    const lng = place.location.lng(); const lat = place.location.lat(); const name = place.displayName?.trim() || place.formattedAddress?.trim() || `Google 地点 ${index + 1}`; const type = place.primaryTypeDisplayName?.trim() || place.primaryType?.trim() || 'Google 地点'
    return { id: `google_${place.id || `${lng.toFixed(6)}_${lat.toFixed(6)}`}`, name, type, category: categoryFromPoi(`${type};${place.primaryType ?? ''};${name}`), priority: 'normal', lng, lat, address: place.formattedAddress ?? '', provider: 'google', providerId: place.id ?? undefined, distanceMeters: center ? Math.round(this.distance(center.lng, center.lat, lng, lat)) : undefined, crs: 'WGS84' }
  }

  private toDetails(place: google.maps.places.Place, matchedBy: PlaceDetails['matchedBy']): PlaceDetails {
    return { sourceProvider: 'google', providerId: place.id ?? '', matchedBy, confidence: matchedBy === 'provider-id' ? 'high' : 'medium', name: place.displayName ?? '', type: place.primaryTypeDisplayName || place.primaryType || 'Google 地点', address: place.formattedAddress ?? '', telephone: place.nationalPhoneNumber ?? undefined, website: place.websiteURI ?? undefined, rating: place.rating == null ? undefined : String(place.rating), openTime: place.regularOpeningHours?.weekdayDescriptions?.join('；'), description: place.editorialSummary ?? undefined, photos: [] }
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

  private async ensureLibraries(): Promise<void> { if (!this.libraries) this.libraries = await loadGoogleMaps() }
  private locale(): { language?: string; region?: string } { const config = readGoogleMapConfig(); return { language: config?.language, region: config?.region } }
  private travelMode(mode: TransportMode): google.maps.TravelModeString | null { return ({ driving: 'DRIVING', walking: 'WALKING', cycling: 'BICYCLING', transit: 'TRANSIT' } as Partial<Record<TransportMode, google.maps.TravelModeString>>)[mode] ?? null }
  private applyTrafficLayer(): void { if (!this.map) return; if (!this.trafficLayer) this.trafficLayer = new google.maps.TrafficLayer(); this.trafficLayer.setMap(this.trafficEnabled ? this.map : null) }
  private consumePendingFocus(): boolean { if (!this.pendingFocusPlace || !this.map) return false; const place = this.pendingFocusPlace; this.pendingFocusPlace = null; this.focusPlace(place); return true }
  private fitPositions(positions: google.maps.LatLngLiteral[]): void { if (!this.map || !positions.length) return; if (positions.length === 1) { this.map.panTo(positions[0]); this.map.setZoom(13); return } const bounds = new google.maps.LatLngBounds(); positions.forEach((position) => bounds.extend(position)); this.map.fitBounds(bounds, 90) }
  private placeDistance(place: google.maps.places.Place, target: Pick<Place, 'lng' | 'lat'>): number { return place.location ? this.distance(place.location.lng(), place.location.lat(), target.lng, target.lat) : Infinity }
  private distance(lng1: number, lat1: number, lng2: number, lat2: number): number { const rad = (value: number) => value * Math.PI / 180; const dLat = rad(lat2 - lat1); const dLng = rad(lng2 - lng1); const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2; return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) }
  private cloneOptions(options: RouteOption[]): RouteOption[] { return options.map((option) => ({ ...option, path: option.path.map((point) => [...point] as [number, number]) })) }
  private clearOverlays(): void { this.overlays.forEach((overlay) => { try { overlay.setMap(null) } catch { /* noop */ } }); this.overlays = [] }
  private errorMessage(action: string, reason: unknown): string { const message = reason instanceof Error ? reason.message : String(reason ?? ''); if (/REQUEST_DENIED|ApiNotActivated|not authorized|API key/i.test(message)) return `Google Maps ${action}失败：请检查 API Key、网站限制，并确认已启用 Maps JavaScript API、Places API (New) 与 Routes API`; if (/OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED/i.test(message)) return `Google Maps ${action}失败：调用额度已用尽或请求过于频繁`; if (/ZERO_RESULTS|NOT_FOUND/i.test(message)) return `Google Maps ${action}没有找到可用结果`; return `Google Maps ${action}失败${message ? `：${message}` : ''}` }
  private escape(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character) }
}

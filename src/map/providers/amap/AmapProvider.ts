import { categoryFromPoi } from '../../../domain/categories'
import { categoryIconMarkup } from '../../../assets/icons/placeCategoryIcons'
import { decodeRoutePath } from '../../../domain/polyline'
import { formatDuration, routeInfo } from '../../../domain/schedule'
import { transportModeMeta, transportModeOf, transportRouteCacheKey } from '../../../domain/transport'
import type { CurrentLocationResult, DayRouteOptionRequest, MapDisplayMode, MapPickResult, MapScene, Place, PlaceDetails, PoiSearchResult, RouteEstimate, RouteOption, RouteOptionRequest, TransportMode, TripDay } from '../../../domain/types'
import type { PlanMapCallbacks, PlanMapProvider } from '../../PlanMapProvider'
import { loadAmap } from './loader'

export class AmapProvider implements PlanMapProvider {
  readonly id = 'amap'
  readonly coordinateSystem = 'GCJ02' as const
  readonly capabilities = {
    dimension: '2.5D' as const,
    presentation: 'planar' as const,
    coordinateSystem: 'GCJ02' as const,
    satellite: true,
    nativePoiSearch: true,
    nativeRouting: true,
    traffic: true,
    mapPicking: true,
    displayModes: ['flat', 'tilted'] as MapDisplayMode[],
    routeAlternativeModes: ['driving', 'walking', 'cycling', 'transit'] as TransportMode[],
  }

  private sdk: any = null
  private map: any = null
  private container: HTMLElement | null = null
  private displayMode: MapDisplayMode = 'flat'
  private trafficEnabled = false
  private callbacks: PlanMapCallbacks | null = null
  private pendingScene: MapScene | null = null
  private overlays: any[] = []
  private satelliteLayers: any[] = []
  private trafficLayer: any = null
  private geolocationControl: any = null
  private pickMode = false
  private pickMarker: any = null
  private pickToken = 0
  private lastHotspotAt = 0
  private readonly mapClickHandler = (event: any): void => {
    if (!this.pickMode || Date.now() - this.lastHotspotAt < 300) return
    const lng = Number(event?.lnglat?.lng ?? event?.lnglat?.getLng?.())
    const lat = Number(event?.lnglat?.lat ?? event?.lnglat?.getLat?.())
    if (Number.isFinite(lng) && Number.isFinite(lat)) this.pickAt(lng, lat)
  }
  private readonly hotspotClickHandler = (event: any): void => {
    if (!this.pickMode) return
    this.lastHotspotAt = Date.now()
    this.pickHotspot(event)
  }
  private routeToken = 0
  private segmentRouteCache = new Map<string, { path: any[]; km: number; min: number; toll?: number }>()
  private routeOptionsCache = new Map<string, RouteOption[]>()
  private routeOptionPreviewOverlays: any[] = []
  private placeDetailsCache = new Map<string, PlaceDetails | null>()
  private pendingFocusPlace: Place | null = null
  private lastRouteSceneKey = ''

  async mount(container: HTMLElement, callbacks: PlanMapCallbacks): Promise<void> {
    this.container = container
    this.callbacks = callbacks
    this.sdk = await loadAmap()
    this.createMap()
  }

  private createMap(): void {
    if (!this.container || !this.sdk) return
    const tilted = this.displayMode === 'tilted'
    this.map = new this.sdk.Map(this.container, {
      zoom: 7.6,
      center: [103, 30.65],
      viewMode: tilted ? '3D' : '2D',
      pitch: tilted ? 50 : 0,
      rotation: 0,
      rotateEnable: tilted,
      pitchEnable: tilted,
      zooms: [2, 20],
      mapStyle: 'amap://styles/whitesmoke',
      showLabel: true,
      isHotspot: true,
      features: ['bg', 'road', 'building', 'point'],
    })
    this.map.addControl(new this.sdk.Scale())
    this.map.on('click', this.mapClickHandler)
    this.map.on('hotspotclick', this.hotspotClickHandler)
    this.map.setDefaultCursor?.(this.pickMode ? 'crosshair' : 'default')
    this.lastRouteSceneKey = ''
    if (this.pendingScene) this.updateScene(this.pendingScene)
    if (this.trafficEnabled) this.applyTrafficLayer()
  }

  updateScene(scene: MapScene): void {
    this.pendingScene = scene
    if (!this.map || !this.sdk) return
    this.routeToken += 1
    this.clearRouteOptionsPreview()
    const token = this.routeToken
    this.clearOverlays()
    this.applySatellite(scene.satellite)

    const selectedDay = scene.days.find((day) => day.id === scene.selectedDayId) ?? scene.days[0]
    const routeDays = scene.routeDayIds.map((id) => scene.days.find((day) => day.id === id)).filter((day): day is TripDay => Boolean(day))
    const effectiveRouteDays = routeDays.length ? routeDays : selectedDay ? [selectedDay] : []
    const routeSceneKey = JSON.stringify(effectiveRouteDays.map((day) => ({
      id: day.id,
      stops: day.stops.map((stop) => {
        const place = scene.places.find((item) => item.id === stop.placeId)
        return [stop.uid, stop.placeId, place?.lng, place?.lat, transportModeOf(stop.transportMode), stop.transportDuration, stop.transportDistance, stop.selectedRoute?.id]
      }),
    })))
    const shouldFitViewport = routeSceneKey !== this.lastRouteSceneKey
    this.lastRouteSceneKey = routeSceneKey
    const scheduledNodes = scene.days.flatMap((day) => day.stops.map((stop, stopIndex) => ({ day, stop, stopIndex })))
    const scheduledIds = new Set(scheduledNodes.map((node) => node.stop.placeId))
    const markers: any[] = []
    const currentMarkers: any[] = []
    const occurrenceCount = new Map<string, number>()
    const offsets = [[0, 0], [-22, -18], [22, 18], [24, -20], [-24, 20]]

    scheduledNodes.forEach((node, globalIndex) => {
      const place = scene.places.find((item) => item.id === node.stop.placeId)
      if (!place) return
      const occurrence = occurrenceCount.get(place.id) ?? 0
      occurrenceCount.set(place.id, occurrence + 1)
      const markerOffset = offsets[occurrence % offsets.length]
      const isCurrent = node.day.id === scene.selectedDayId
      const status = isCurrent ? 'current' : 'other'
      const conflictClass = scene.conflictPlaceIds.includes(place.id) ? 'conflict' : ''
      const selectedClass = scene.selectedPlaceId === place.id ? 'selected' : ''
      const order = globalIndex + 1
      const roleClass = globalIndex === 0 ? 'trip-start' : globalIndex === scheduledNodes.length - 1 ? 'trip-end' : ''
      const wrapper = document.createElement('div')
      wrapper.innerHTML = `<div class="travel-marker ${status} ${conflictClass} ${selectedClass} ${roleClass}" data-place="${this.escape(place.id)}" data-stop-uid="${this.escape(node.stop.uid)}" data-order="${order}" style="--label-y:${[0, 12, -12, 16][globalIndex % 4]}px"><div class="travel-marker-core">${categoryIconMarkup(place.category, 'marker')}<span class="travel-marker-orders"><span class="travel-marker-order">${order}</span></span></div><span class="travel-marker-label">${this.escape(place.name)}</span></div>`
      const content = wrapper.firstElementChild as HTMLElement
      content.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectPlace(place.id) })
      const marker = new this.sdk.Marker({ position: [place.lng, place.lat], content, offset: new this.sdk.Pixel(markerOffset[0], markerOffset[1]), zIndex: 180 + globalIndex })
      markers.push(marker)
      currentMarkers.push(marker)
    })

    scene.places.filter((place) => !scheduledIds.has(place.id)).forEach((place) => {
      if (scene.categoryFilter !== 'all' && place.category !== scene.categoryFilter) return
      const selectedClass = scene.selectedPlaceId === place.id ? 'selected' : ''
      const wrapper = document.createElement('div')
      wrapper.innerHTML = `<div class="travel-marker candidate ${selectedClass}" data-place="${this.escape(place.id)}"><div class="travel-marker-core">${categoryIconMarkup(place.category, 'marker')}</div><span class="travel-marker-label">${this.escape(place.name)}</span></div>`
      const content = wrapper.firstElementChild as HTMLElement
      content.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectPlace(place.id) })
      markers.push(new this.sdk.Marker({ position: [place.lng, place.lat], content, offset: new this.sdk.Pixel(0, 0), zIndex: 100 }))
    })

    this.map.add(markers)
    this.overlays.push(...markers)

    if (scheduledNodes.length > 1) {
      void this.renderRoutes(effectiveRouteDays, scene, currentMarkers, token, shouldFitViewport)
    } else if (!this.consumePendingFocus() && shouldFitViewport && markers.length) {
      this.map.setFitView(currentMarkers.length ? currentMarkers : markers, false, [100, 100, 100, 100])
    }
  }

  private normalizePoiResults(items: any[], fallbackName: string, limit: number): PoiSearchResult[] {
    return items.slice(0, limit).map((item: any, index: number) => {
      const lng = Number(item.location?.lng ?? item.location?.getLng?.())
      const lat = Number(item.location?.lat ?? item.location?.getLat?.())
      const type = item.type || '高德地点'
      const distance = Number(item.distance)
      return {
        id: `amap_${item.id || `${Date.now()}_${index}`}`,
        name: item.name || fallbackName,
        type,
        category: categoryFromPoi(`${type} ${item.name || ''}`),
        priority: 'normal' as const,
        address: [item.pname, item.cityname, item.adname, item.address].filter(Boolean).join(' · '),
        provider: 'amap' as const,
        providerId: item.id,
        cityCode: item.citycode || undefined,
        adCode: item.adcode || undefined,
        lng,
        lat,
        distanceMeters: Number.isFinite(distance) ? Math.max(0, Math.round(distance)) : undefined,
        crs: 'GCJ02' as const,
      }
    }).filter((place: PoiSearchResult) => Number.isFinite(place.lng) && Number.isFinite(place.lat))
  }

  async searchPlaces(keyword: string): Promise<PoiSearchResult[]> {
    const query = keyword.trim()
    if (query.length < 2) return []
    const sdk = this.sdk ?? await loadAmap()
    const service = new sdk.PlaceSearch({ pageSize: 8, pageIndex: 1, city: '全国', citylimit: false, extensions: 'base' })

    return new Promise((resolve, reject) => {
      service.search(query, (status: string, result: any) => {
        if (status !== 'complete') {
          reject(new Error(result?.info || '高德 POI 搜索失败'))
          return
        }
        resolve(this.normalizePoiResults(result.poiList?.pois ?? [], query, 8))
      })
    })
  }

  async searchNearbyPlaces(center: Place, keyword: string, radiusMeters: number): Promise<PoiSearchResult[]> {
    const query = keyword.trim()
    if (!query) return []
    const sdk = this.sdk ?? await loadAmap()
    const radius = Math.max(100, Math.min(50_000, Math.round(radiusMeters)))
    const service = new sdk.PlaceSearch({
      pageSize: 12,
      pageIndex: 1,
      city: center.adCode || center.cityCode || '全国',
      citylimit: false,
      extensions: 'base',
    })

    return new Promise((resolve, reject) => {
      service.searchNearBy(query, [center.lng, center.lat], radius, (status: string, result: any) => {
        if (status === 'no_data') { resolve([]); return }
        if (status !== 'complete') {
          reject(new Error(result?.info || '高德周边 POI 搜索失败'))
          return
        }
        resolve(this.normalizePoiResults(result.poiList?.pois ?? [], query, 12)
          .filter((place) => place.providerId !== center.providerId && place.id !== center.id))
      })
    })
  }

  zoomIn(): void {
    this.map?.zoomIn()
  }

  zoomOut(): void {
    this.map?.zoomOut()
  }

  focusPlace(place: Place): void {
    this.pendingFocusPlace = place
    this.applyPlaceFocus(place)
  }

  private applyPlaceFocus(place: Place): void {
    if (!this.map) return
    const currentZoom = Number(this.map.getZoom?.())
    const zoom = Number.isFinite(currentZoom) ? Math.max(15, Math.min(18, currentZoom)) : 15
    this.map.setZoomAndCenter?.(zoom, [place.lng, place.lat], false, 420)
  }

  private consumePendingFocus(): boolean {
    const place = this.pendingFocusPlace
    if (!place) return false
    this.pendingFocusPlace = null
    this.applyPlaceFocus(place)
    return true
  }

  locateCurrentPosition(): Promise<CurrentLocationResult> {
    if (!this.map || !this.sdk) {
      return Promise.reject(new Error('高德地图尚未加载完成，请稍后再试'))
    }

    if (!this.geolocationControl) {
      this.geolocationControl = new this.sdk.Geolocation({
        enableHighAccuracy: true,
        timeout: 10_000,
        showButton: false,
        showMarker: true,
        showCircle: true,
        panToLocation: true,
        zoomToAccuracy: true,
        needAddress: true,
      })
      this.map.addControl(this.geolocationControl)
    }

    return new Promise((resolve, reject) => {
      this.geolocationControl.getCurrentPosition((status: string, result: any) => {
        if (status !== 'complete' || !result?.position) {
          reject(new Error(this.geolocationErrorMessage(result)))
          return
        }

        const lng = Number(result.position.lng ?? result.position.getLng?.() ?? result.position[0])
        const lat = Number(result.position.lat ?? result.position.getLat?.() ?? result.position[1])
        if (!Number.isFinite(lng) || !Number.isFinite(lat)) {
          reject(new Error('高德地图已返回定位结果，但坐标无效，请稍后重试'))
          return
        }

        const accuracy = Number(result.accuracy)
        resolve({
          lng,
          lat,
          accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
          address: result.formattedAddress || result.addressComponent?.building || undefined,
          locationType: result.location_type || result.locationType || undefined,
        })
      })
    })
  }

  setPickMode(enabled: boolean): void {
    this.pickMode = enabled
    this.pickToken += 1
    this.map?.setDefaultCursor?.(enabled ? 'crosshair' : 'default')
    if (!enabled && this.pickMarker) {
      this.pickMarker.setMap?.(null)
      this.pickMarker = null
    }
  }

  setTrafficEnabled(enabled: boolean): void {
    this.trafficEnabled = enabled
    this.applyTrafficLayer()
  }

  private applyTrafficLayer(): void {
    if (!this.map || !this.sdk) return
    if (this.trafficEnabled && !this.trafficLayer) {
      this.trafficLayer = new this.sdk.TileLayer.Traffic({ autoRefresh: true, interval: 180 })
      this.map.add(this.trafficLayer)
    } else if (!this.trafficEnabled && this.trafficLayer) {
      this.map.remove(this.trafficLayer)
      this.trafficLayer = null
    }
  }

  async setDisplayMode(mode: MapDisplayMode): Promise<void> {
    if (!this.capabilities.displayModes.includes(mode) || this.displayMode === mode) return
    this.displayMode = mode
    if (!this.map || !this.container || !this.callbacks) return
    this.routeToken += 1
    this.map.off?.('click', this.mapClickHandler)
    this.map.off?.('hotspotclick', this.hotspotClickHandler)
    this.map.destroy?.()
    this.map = null
    this.overlays = []
    this.satelliteLayers = []
    this.trafficLayer = null
    this.geolocationControl = null
    this.pickMarker = null
    this.routeOptionPreviewOverlays = []
    this.createMap()
  }

  async getPlaceDetails(place: Place): Promise<PlaceDetails | null> {
    const cacheKey = place.providerId ? `id:${place.providerId}` : `place:${place.id}`
    if (this.placeDetailsCache.has(cacheKey)) return this.placeDetailsCache.get(cacheKey) ?? null
    const sdk = this.sdk ?? await loadAmap()
    const service = new sdk.PlaceSearch({ pageSize: 8, pageIndex: 1, citylimit: false, extensions: 'all' })

    const readDetails = (providerId: string, matchedBy: PlaceDetails['matchedBy']): Promise<PlaceDetails | null> => new Promise((resolve) => {
      service.getDetails(providerId, (status: string, result: any) => {
        const poi = status === 'complete' ? result?.poiList?.pois?.[0] : null
        resolve(poi ? this.toPlaceDetails(poi, matchedBy) : null)
      })
    })

    let details: PlaceDetails | null = null
    if (place.providerId) {
      details = await readDetails(place.providerId, 'provider-id')
    } else {
      let candidates: any[] = await new Promise((resolve) => {
        const keywordService = new sdk.PlaceSearch({ pageSize: 20, pageIndex: 1, city: '全国', citylimit: false, extensions: 'all' })
        keywordService.search(
          place.name,
          (status: string, result: any) => resolve(status === 'complete' ? result?.poiList?.pois ?? [] : []),
        )
      })
      if (!candidates.length) {
        candidates = await new Promise((resolve) => {
          service.searchNearBy(
            place.name,
            new sdk.LngLat(place.lng, place.lat),
            50_000,
            (status: string, result: any) => resolve(status === 'complete' ? result?.poiList?.pois ?? [] : []),
          )
        })
      }
      const normalized = (value: string) => value.replace(/[\s·・()（）景区国家级风景名胜区]/g, '')
      const placeName = normalized(place.name)
      const scored = candidates.map((candidate) => {
        const candidateName = normalized(candidate.name)
        const nameScore = candidateName === placeName ? 120 : candidateName.includes(placeName) || placeName.includes(candidateName) ? 75 : 0
        let score = nameScore
        if (categoryFromPoi(`${candidate.type ?? ''} ${candidate.name ?? ''}`) === place.category) score += 45
        if (candidate.tel) score += 8
        if (candidate.photos && String(candidate.photos).length > 4) score += 8
        const candidateLng = Number(candidate.location?.lng ?? candidate.location?.[0])
        const candidateLat = Number(candidate.location?.lat ?? candidate.location?.[1])
        const distanceKm = Number.isFinite(candidateLng) && Number.isFinite(candidateLat)
          ? Math.hypot((candidateLng - place.lng) * 80, (candidateLat - place.lat) * 100)
          : Number.POSITIVE_INFINITY
        score -= Math.min(20, distanceKm / 2.5)
        return { candidate, score, nameScore, distanceKm }
      }).sort((left, right) => right.score - left.score)
      const selected = scored.find((item) => item.nameScore > 0 && item.distanceKm <= 50 && item.score >= 60)?.candidate
      if (selected?.id) details = this.toPlaceDetails(selected, 'name-and-location')
    }

    this.placeDetailsCache.set(cacheKey, details)
    return details
  }

  private toPlaceDetails(poi: any, matchedBy: PlaceDetails['matchedBy']): PlaceDetails {
    let rawPhotos: any = poi.photos ?? []
    if (typeof rawPhotos === 'string') {
      try { rawPhotos = JSON.parse(rawPhotos) } catch { rawPhotos = [] }
    }
    if (!Array.isArray(rawPhotos)) rawPhotos = Object.values(rawPhotos ?? {})
    const photos = rawPhotos.slice(0, 4).map((photo: any) => ({
      title: photo?.title ?? '',
      url: String(photo?.url ?? '').replace(/^http:/, 'https:'),
    })).filter((photo: { url: string }) => Boolean(photo.url))
    return {
      sourceProvider: 'amap',
      providerId: poi.id,
      matchedBy,
      confidence: matchedBy === 'provider-id' ? 'high' : 'medium',
      name: poi.name ?? '',
      type: poi.type ?? '',
      address: [...new Set([poi.pname, poi.cityname, poi.adname, poi.address].filter(Boolean))].join(' · '),
      telephone: poi.tel || undefined,
      website: poi.website || undefined,
      email: poi.email || undefined,
      rating: poi.rating || undefined,
      openTime: poi.open_time || poi.opentime2 || undefined,
      photos,
    }
  }

  resize(): void {
    this.map?.resize()
  }

  destroy(): void {
    this.routeToken += 1
    this.clearRouteOptionsPreview()
    this.clearOverlays()
    if (this.map) {
      if (this.geolocationControl) this.map.removeControl?.(this.geolocationControl)
      if (this.trafficLayer) this.map.remove?.(this.trafficLayer)
      this.map.off?.('click', this.mapClickHandler)
      this.map.off?.('hotspotclick', this.hotspotClickHandler)
      if (this.pickMarker) this.pickMarker.setMap?.(null)
      this.map.clearEvents?.()
      this.map.destroy()
      this.map = null
    }
    this.geolocationControl = null
    this.trafficLayer = null
    this.pickMarker = null
    this.pendingFocusPlace = null
    this.lastRouteSceneKey = ''
    this.pickMode = false
    this.satelliteLayers = []
    this.container = null
    this.sdk = null
    this.callbacks = null
  }

  private async pickHotspot(event: any): Promise<void> {
    if (!this.map || !this.sdk) return
    const lng = Number(event?.lnglat?.lng ?? event?.lnglat?.getLng?.())
    const lat = Number(event?.lnglat?.lat ?? event?.lnglat?.getLat?.())
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return
    const token = ++this.pickToken
    this.callbacks?.onMapPickStart(lng, lat)
    this.showPickMarker(lng, lat)

    const poi = await new Promise<any>((resolve) => {
      if (!event?.id) { resolve(null); return }
      const service = new this.sdk.PlaceSearch({ extensions: 'all' })
      service.getDetails(event.id, (status: string, result: any) => resolve(status === 'complete' ? result?.poiList?.pois?.[0] ?? null : null))
    })
    if (token !== this.pickToken || !this.pickMode) return
    const candidate = poi ? this.toPickCandidate(poi, 0) : this.toPickCandidate({ id: event?.id, name: event?.name, location: [lng, lat], type: '高德地图 POI' }, 0)
    this.callbacks?.onMapPick({
      lng,
      lat,
      address: candidate?.address ?? '',
      candidates: candidate ? [candidate] : [],
    })
  }

  private showPickMarker(lng: number, lat: number): void {
    if (this.pickMarker) this.pickMarker.setMap?.(null)
    const markerContent = document.createElement('div')
    markerContent.className = 'map-pick-marker'
    markerContent.innerHTML = '<span></span><i></i>'
    this.pickMarker = new this.sdk.Marker({ position: [lng, lat], content: markerContent, offset: new this.sdk.Pixel(-18, -36), zIndex: 260 })
    this.map.add(this.pickMarker)
  }

  private async pickAt(lng: number, lat: number): Promise<void> {
    if (!this.map || !this.sdk) return
    const token = ++this.pickToken
    this.callbacks?.onMapPickStart(lng, lat)

    this.showPickMarker(lng, lat)

    const location = new this.sdk.LngLat(lng, lat)
    const geocoder = new this.sdk.Geocoder({ radius: 1200, extensions: 'all' })
    const placeSearch = new this.sdk.PlaceSearch({ pageSize: 8, pageIndex: 1, extensions: 'base', citylimit: false })
    const geocodePromise = new Promise<any>((resolve) => {
      geocoder.getAddress(location, (status: string, result: any) => resolve(status === 'complete' ? result?.regeocode ?? null : null))
    })
    const nearbyPromise = new Promise<any[]>((resolve) => {
      placeSearch.searchNearBy('', location, 1500, (status: string, result: any) => resolve(status === 'complete' ? result?.poiList?.pois ?? [] : []))
    })
    const [regeocode, nearby] = await Promise.all([geocodePromise, nearbyPromise])
    if (token !== this.pickToken || !this.pickMode) return
    const rawCandidates = nearby.length ? nearby : regeocode?.pois ?? []
    const candidates = rawCandidates.slice(0, 8).map((item: any, index: number) => this.toPickCandidate(item, index)).filter(Boolean) as PoiSearchResult[]
    const result: MapPickResult = {
      lng,
      lat,
      address: String(regeocode?.formattedAddress ?? ''),
      candidates,
    }
    this.callbacks?.onMapPick(result)
  }

  private toPickCandidate(item: any, index: number): PoiSearchResult | null {
    const lng = Number(item.location?.lng ?? item.location?.getLng?.() ?? item.location?.[0])
    const lat = Number(item.location?.lat ?? item.location?.getLat?.() ?? item.location?.[1])
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null
    const type = String(item.type || '高德地点')
    return {
      id: `amap_${item.id || `picked_${Date.now()}_${index}`}`,
      name: String(item.name || '地图选点'),
      type,
      category: categoryFromPoi(`${type} ${item.name || ''}`),
      priority: 'normal',
      address: [item.pname, item.cityname, item.adname, item.address].filter(Boolean).join(' · '),
      provider: 'amap',
      providerId: item.id || undefined,
      cityCode: item.citycode || undefined,
      adCode: item.adcode || undefined,
      lng,
      lat,
      crs: 'GCJ02',
    }
  }

  private geolocationErrorMessage(result: any): string {
    const code = Number(result?.code ?? result?.errorCode)
    const details = String(result?.message ?? result?.info ?? '').trim()
    const normalized = details.toLowerCase()

    if (code === 1 || normalized.includes('permission') || normalized.includes('denied')) {
      return '浏览器未授予定位权限，请在站点设置中允许访问位置后重试'
    }
    if (code === 2 || normalized.includes('unavailable')) {
      return '暂时无法获取当前位置，请检查系统定位服务、网络或 GPS 后重试'
    }
    if (code === 3 || normalized.includes('timeout')) {
      return '定位请求超时，请移动到信号较好的位置后重试'
    }
    if (normalized.includes('not_supported') || normalized.includes('not supported')) {
      return '当前浏览器或运行环境不支持定位，请使用支持定位且已启用 HTTPS 的浏览器'
    }
    return details ? `当前位置定位失败：${details}` : '当前位置定位失败，请检查浏览器定位权限后重试'
  }

  private applySatellite(enabled: boolean): void {
    if (this.satelliteLayers.length) {
      this.map.remove(this.satelliteLayers)
      this.satelliteLayers = []
    }
    if (enabled) {
      this.satelliteLayers = [new this.sdk.TileLayer.Satellite(), new this.sdk.TileLayer.RoadNet()]
      this.map.add(this.satelliteLayers)
    }
  }

  private async renderRoute(day: TripDay, scene: MapScene, token: number, segmentOffset: number): Promise<{ lines: any[]; km: number; min: number; providerResultCount: number; segmentCount: number } | null> {
    const routeLines: any[] = []
    let totalKm = 0
    let totalMin = 0
    let providerResultCount = 0
    let errorShown = false

    for (let index = 0; index < day.stops.length - 1; index += 1) {
      if (token !== this.routeToken) return null
      const fromStop = day.stops[index]
      const toStop = day.stops[index + 1]
      const from = scene.places.find((place) => place.id === fromStop.placeId)
      const to = scene.places.find((place) => place.id === toStop.placeId)
      if (!from || !to) continue

      const mode = transportModeOf(fromStop.transportMode)
      const fallback = routeInfo(fromStop, toStop, Object.fromEntries(scene.places.map((place) => [place.id, place])), scene.routeCache)
      let path: any[] = this.createManualPath(from, to, mode)
      let km = fallback.km
      let min = fallback.min
      let pending = Boolean(fallback.pending)
      let source = fallback.source ?? 'estimate'
      let showDirection = false

      const selected = fromStop.selectedRoute && fromStop.selectedRoute.mode === mode && fromStop.selectedRoute.toPlaceId === to.id ? fromStop.selectedRoute : null
      if (selected) {
        path = decodeRoutePath(selected.encodedPath)
        km = selected.distanceKm
        min = selected.durationMinutes
        pending = false
        source = 'provider'
        showDirection = path.length > 0
        providerResultCount += 1
      } else if (transportModeMeta[mode].automatic) {
        const cacheKey = transportRouteCacheKey(from.id, to.id, mode)
        const cached = this.segmentRouteCache.get(cacheKey)
        const resolved = cached ?? await this.searchAmapRoute(mode, from, to)
        if (token !== this.routeToken) return null
        if (resolved) {
          path = resolved.path.length ? resolved.path : [[from.lng, from.lat], [to.lng, to.lat]]
          km = resolved.km
          min = resolved.min
          pending = false
          source = 'provider'
          showDirection = resolved.path.length > 0
          providerResultCount += 1
          this.segmentRouteCache.set(cacheKey, resolved)
          this.callbacks?.onRouteSegment(from.id, to.id, mode, km, min, resolved.toll)
        } else if (!errorShown) {
          errorShown = true
          this.callbacks?.onError(`高德${transportModeMeta[mode].label}路线计算失败，已显示地点连线和暂估用时`)
        }
      }

      totalKm += km
      totalMin += min
      const dayWarning = day.id === '__all__' ? scene.routeWarning : scene.routeWarningDayIds.includes(day.id)
      routeLines.push(this.drawRoute(path, dayWarning, mode, showDirection, from.id, to.id))
      this.drawRouteInfo(path, from, to, mode, km, min, pending, source, dayWarning, segmentOffset + index, day.stops.length > 6)
      if (transportModeMeta[mode].automatic) await new Promise((resolve) => window.setTimeout(resolve, 180))
    }

    if (token !== this.routeToken) return null
    return { lines: routeLines, km: totalKm, min: totalMin, providerResultCount, segmentCount: Math.max(0, day.stops.length - 1) }
  }

  private async renderRoutes(days: TripDay[], scene: MapScene, markers: any[], token: number, shouldFitViewport: boolean): Promise<void> {
    const stops = days.flatMap((day) => day.stops)
    if (stops.length < 2) return
    const combined: TripDay = { ...days[0], id: '__all__', label: '全程', stops }
    const result = await this.renderRoute(combined, scene, token, 0)
    if (!result || token !== this.routeToken) return
    if (!this.consumePendingFocus() && shouldFitViewport && result.lines.length) this.map.setFitView([...markers, ...result.lines], false, [110, 110, 110, 110])
    this.callbacks?.onRouteSummary({ km: result.km, min: result.min, source: result.providerResultCount ? 'provider' : 'cache' })
  }

  async estimateRoute(from: Place, to: Place, mode: TransportMode): Promise<RouteEstimate | null> {
    if (!transportModeMeta[mode].automatic) return null
    const options = await this.searchRouteOptions({ from, to, mode })
    const first = options[0]
    return first ? { km: first.distanceKm, min: first.durationMinutes, toll: first.toll, source: 'provider' } : null
  }

  async searchRouteOptions(request: RouteOptionRequest): Promise<RouteOption[]> {
    const { from, to, mode, force, preference = 'recommended' } = request
    if (!this.capabilities.routeAlternativeModes.includes(mode)) return []
    if (!this.sdk) this.sdk = await loadAmap()
    const baseSegmentKey = transportRouteCacheKey(from.id, to.id, mode)
    const cacheKey = `${baseSegmentKey}:${preference}`
    const cached = this.routeOptionsCache.get(cacheKey)
    if (!force && cached?.length) return cached.map((option) => ({ ...option, path: option.path.map((point) => [...point] as [number, number]) }))
    const result = await (async () => {
      if (mode === 'transit') {
        const [city, cityd] = await Promise.all([this.resolveCityCode(from), this.resolveCityCode(to)])
        return new Promise<any[]>((resolve) => {
          const transferPolicy = preference === 'least-toll' ? this.sdk.TransferPolicy?.LEAST_FEE ?? 1 : preference === 'shortest' ? this.sdk.TransferPolicy?.LEAST_WALK ?? 3 : preference === 'avoid-congestion' ? this.sdk.TransferPolicy?.LEAST_TRANSFER ?? 2 : this.sdk.TransferPolicy?.LEAST_TIME ?? 0
          const service = new this.sdk.Transfer({ city: city || '全国', cityd: cityd || city || '全国', policy: transferPolicy, extensions: 'all' })
          service.search(new this.sdk.LngLat(from.lng, from.lat), new this.sdk.LngLat(to.lng, to.lat), (status: string, response: any) => resolve(status === 'complete' ? response?.plans ?? [] : []))
        })
      }
      return new Promise<any[]>((resolve) => {
        const drivingPolicy = preference === 'fastest' ? this.sdk.DrivingPolicy?.LEAST_TIME ?? 0 : preference === 'shortest' ? this.sdk.DrivingPolicy?.LEAST_DISTANCE ?? 2 : preference === 'least-toll' ? this.sdk.DrivingPolicy?.LEAST_FEE ?? 1 : preference === 'avoid-congestion' ? this.sdk.DrivingPolicy?.REAL_TRAFFIC ?? 4 : 10
        const options = mode === 'driving' ? { showTraffic: true, extensions: 'all', policy: drivingPolicy } : {}
        const service = mode === 'walking' ? new this.sdk.Walking(options) : mode === 'cycling' ? new this.sdk.Riding(options) : new this.sdk.Driving(options)
        service.search(new this.sdk.LngLat(from.lng, from.lat), new this.sdk.LngLat(to.lng, to.lat), (status: string, response: any) => resolve(status === 'complete' ? response?.routes ?? [] : []))
      })
    })()
    const normalized = result.map((route: any, index: number) => {
      const path = mode === 'transit' ? this.collectRoutePath(route) : (route.steps ?? route.rides ?? []).flatMap((step: any) => step.path ?? []).map((point: any) => this.pathPoint(point)).filter((point: [number, number] | null): point is [number, number] => Boolean(point))
      const distanceKm = Math.max(1, Math.round(Number(route.distance ?? 0) / 1000))
      const durationMinutes = Math.max(1, Math.round(Number(route.time ?? route.duration ?? 0) / 60))
      const toll = mode === 'driving' && Number.isFinite(Number(route.tolls)) ? Math.max(0, Number(route.tolls)) : undefined
      const cost = mode === 'transit' && Number.isFinite(Number(route.cost)) ? Math.max(0, Number(route.cost)) : undefined
      const walkingDistanceKm = mode === 'transit' && Number.isFinite(Number(route.walking_distance ?? route.walkingDistance)) ? Math.round(Number(route.walking_distance ?? route.walkingDistance) / 100) / 10 : undefined
      const transferCount = mode === 'transit' ? Math.max(0, Number(route.segments?.length ?? 1) - 1) : undefined
      return { id: `amap-${mode}-${from.id}-${to.id}-${index}-${distanceKm}-${durationMinutes}-${toll ?? cost ?? 0}`, providerId: 'amap', providerName: '高德地图', fromPlaceId: from.id, toPlaceId: to.id, mode, strategyLabel: '', distanceKm, durationMinutes, toll, cost, transferCount, walkingDistanceKm, trafficLightCount: Number.isFinite(Number(route.traffic_lights ?? route.trafficLights)) ? Number(route.traffic_lights ?? route.trafficLights) : undefined, path: path.length ? path : [[from.lng, from.lat], [to.lng, to.lat]], crs: 'GCJ02', queriedAt: new Date().toISOString() } as RouteOption
    })
    const fastest = Math.min(...normalized.map((option) => option.durationMinutes))
    const shortest = Math.min(...normalized.map((option) => option.distanceKm))
    const lowestToll = Math.min(...normalized.map((option) => option.toll ?? Number.POSITIVE_INFINITY))
    const preferenceLabel = preference === 'fastest' ? '用时优先' : preference === 'shortest' ? mode === 'transit' ? '少步行' : '距离优先' : preference === 'least-toll' ? '少收费' : preference === 'avoid-congestion' ? mode === 'transit' ? '少换乘' : '躲避拥堵' : '高德推荐'
    normalized.forEach((option, index) => {
      option.strategyLabel = index === 0 ? preferenceLabel : option.durationMinutes === fastest ? '用时较短' : mode === 'transit' && option.transferCount === Math.min(...normalized.map((item) => item.transferCount ?? Number.POSITIVE_INFINITY)) ? '换乘较少' : option.distanceKm === shortest ? '距离较短' : Number.isFinite(lowestToll) && option.toll === lowestToll ? '收费较少' : `备选路线 ${index + 1}`
    })
    if (normalized.length) {
      const first = normalized[0]
      this.segmentRouteCache.set(baseSegmentKey, { path: first.path, km: first.distanceKm, min: first.durationMinutes, toll: first.toll })
      this.routeOptionsCache.set(cacheKey, normalized)
    }
    return normalized.map((option) => ({ ...option, path: option.path.map((point) => [...point] as [number, number]) }))
  }

  async searchDayRouteOptions(request: DayRouteOptionRequest): Promise<RouteOption[]> {
    const places = request.places
    if (places.length < 2) return []
    if (!this.sdk) this.sdk = await loadAmap()
    const from = places[0]
    const to = places[places.length - 1]
    const waypoints = places.slice(1, -1).map((place) => new this.sdk.LngLat(place.lng, place.lat))
    const preference = request.preference ?? 'recommended'
    const policy = preference === 'fastest' ? this.sdk.DrivingPolicy?.LEAST_TIME ?? 0 : preference === 'shortest' ? this.sdk.DrivingPolicy?.LEAST_DISTANCE ?? 2 : preference === 'least-toll' ? this.sdk.DrivingPolicy?.LEAST_FEE ?? 1 : preference === 'avoid-congestion' ? this.sdk.DrivingPolicy?.REAL_TRAFFIC ?? 4 : 10
    const routes = await new Promise<any[]>((resolve) => {
      const service = new this.sdk.Driving({ showTraffic: true, extensions: 'all', policy })
      service.search(new this.sdk.LngLat(from.lng, from.lat), new this.sdk.LngLat(to.lng, to.lat), { waypoints }, (status: string, response: any) => resolve(status === 'complete' ? response?.routes ?? [] : []))
    })
    return routes.map((route, index) => {
      const path = (route.steps ?? []).flatMap((step: any) => step.path ?? []).map((point: any) => this.pathPoint(point)).filter((point: [number, number] | null): point is [number, number] => Boolean(point))
      const distanceKm = Math.max(1, Math.round(Number(route.distance ?? 0) / 1000))
      const durationMinutes = Math.max(1, Math.round(Number(route.time ?? 0) / 60))
      const toll = Number.isFinite(Number(route.tolls)) ? Math.max(0, Number(route.tolls)) : undefined
      return { id: `amap-day-${places.map((place) => place.id).join('-')}-${index}-${distanceKm}-${durationMinutes}`, providerId: 'amap', providerName: '高德地图', fromPlaceId: from.id, toPlaceId: to.id, mode: 'driving', strategyLabel: index === 0 ? '全天推荐' : `全天备选 ${index + 1}`, distanceKm, durationMinutes, toll, trafficLightCount: Number.isFinite(Number(route.traffic_lights)) ? Number(route.traffic_lights) : undefined, path: path.length ? path : places.map((place) => [place.lng, place.lat] as [number, number]), crs: 'GCJ02', queriedAt: new Date().toISOString() } as RouteOption
    })
  }

  private async resolveCityCode(place: Place): Promise<string> {
    if (place.cityCode) return place.cityCode
    if (!this.sdk) return ''
    return new Promise((resolve) => {
      const geocoder = new this.sdk.Geocoder({ extensions: 'base' })
      geocoder.getAddress(new this.sdk.LngLat(place.lng, place.lat), (status: string, result: any) => resolve(status === 'complete' ? String(result?.regeocode?.addressComponent?.citycode ?? result?.regeocode?.addressComponent?.city ?? '') : ''))
    })
  }

  private collectRoutePath(value: any): Array<[number, number]> {
    const points: Array<[number, number]> = []
    const visit = (current: any, key = ''): void => {
      if (!current) return
      if (key === 'path' && Array.isArray(current)) {
        current.forEach((point) => { const normalized = this.pathPoint(point); if (normalized) points.push(normalized) })
        return
      }
      if (Array.isArray(current)) { current.forEach((item) => visit(item)); return }
      if (typeof current === 'object') Object.entries(current).forEach(([childKey, child]) => visit(child, childKey))
    }
    visit(value)
    return points.filter((point, index) => index === 0 || point[0] !== points[index - 1][0] || point[1] !== points[index - 1][1])
  }

  previewRouteOptions(options: RouteOption[], selectedId?: string): void {
    this.clearRouteOptionsPreview()
    if (!this.map || !this.sdk) return
    options.forEach((option) => {
      const selected = !selectedId || option.id === selectedId
      const line = new this.sdk.Polyline({ path: option.path, strokeColor: selected ? '#536fda' : '#aeb7c8', strokeWeight: selected ? 8 : 5, strokeOpacity: selected ? 0.96 : 0.55, isOutline: true, outlineColor: '#fff', borderWeight: selected ? 3 : 1, lineJoin: 'round', lineCap: 'round', zIndex: selected ? 230 : 220 })
      line.on?.('click', () => { this.previewRouteOptions(options, option.id); this.callbacks?.onPreviewRouteOption(option.id) })
      this.map.add(line)
      this.routeOptionPreviewOverlays.push(line)
    })
  }

  clearRouteOptionsPreview(): void {
    this.routeOptionPreviewOverlays.forEach((overlay) => { try { overlay.setMap?.(null) } catch { /* noop */ } })
    this.routeOptionPreviewOverlays = []
  }

  private async searchAmapRoute(mode: TransportMode, from: Place, to: Place): Promise<{ path: any[]; km: number; min: number; toll?: number } | null> {
    const options = await this.searchRouteOptions({ from, to, mode })
    const first = options[0]
    return first ? { path: first.path, km: first.distanceKm, min: first.durationMinutes, toll: first.toll } : null
  }

  private createManualPath(from: Place, to: Place, mode: TransportMode): any[] {
    if (mode !== 'flight') return [[from.lng, from.lat], [to.lng, to.lat]]
    const dx = to.lng - from.lng
    const dy = to.lat - from.lat
    const curve = Math.min(1.2, Math.hypot(dx, dy) * 0.16)
    const length = Math.hypot(dx, dy) || 1
    const controlLng = (from.lng + to.lng) / 2 - (dy / length) * curve
    const controlLat = (from.lat + to.lat) / 2 + (dx / length) * curve
    return Array.from({ length: 25 }, (_, index) => {
      const t = index / 24
      const oneMinusT = 1 - t
      return [
        oneMinusT * oneMinusT * from.lng + 2 * oneMinusT * t * controlLng + t * t * to.lng,
        oneMinusT * oneMinusT * from.lat + 2 * oneMinusT * t * controlLat + t * t * to.lat,
      ]
    })
  }

  private drawRoute(path: any[], warning: boolean, mode: TransportMode, showDirection = true, fromId = '', toId = ''): any {
    const automatic = transportModeMeta[mode].automatic
    const routeLine = new this.sdk.Polyline({
      path,
      strokeColor: warning ? '#df5b5b' : transportModeMeta[mode].color,
      strokeWeight: mode === 'flight' ? 5 : 6,
      strokeOpacity: showDirection ? 0.94 : 0.78,
      strokeStyle: automatic ? 'solid' : 'dashed',
      strokeDasharray: automatic ? undefined : [12, 8],
      isOutline: true,
      outlineColor: '#ffffff',
      borderWeight: 2,
      lineJoin: 'round',
      lineCap: 'round',
      showDir: showDirection,
    })
    routeLine.on?.('click', () => this.callbacks?.onSelectRouteSegment(fromId, toId))
    this.map.add(routeLine)
    this.overlays.push(routeLine)
    return routeLine
  }

  private pathPoint(point: any): [number, number] | null {
    const lng = Number(point?.lng ?? point?.getLng?.() ?? point?.[0])
    const lat = Number(point?.lat ?? point?.getLat?.() ?? point?.[1])
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null
  }

  private routeMidpoint(path: any[], from: Place, to: Place): [number, number] {
    const points = path.map((point) => this.pathPoint(point)).filter((point): point is [number, number] => Boolean(point))
    if (points.length < 2) return [(from.lng + to.lng) / 2, (from.lat + to.lat) / 2]
    const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]))
    const target = lengths.reduce((sum, length) => sum + length, 0) / 2
    let walked = 0
    for (let index = 0; index < lengths.length; index += 1) {
      if (walked + lengths[index] >= target) {
        const ratio = lengths[index] ? (target - walked) / lengths[index] : 0
        return [points[index][0] + (points[index + 1][0] - points[index][0]) * ratio, points[index][1] + (points[index + 1][1] - points[index][1]) * ratio]
      }
      walked += lengths[index]
    }
    return points[Math.floor(points.length / 2)]
  }

  private drawRouteInfo(path: any[], from: Place, to: Place, mode: TransportMode, km: number, min: number, pending: boolean, source: string, warning: boolean, index: number, compact: boolean): void {
    const content = document.createElement('div')
    const sourceClass = source === 'provider' || source === 'cache' ? 'verified' : source === 'manual' ? 'manual' : 'estimated'
    content.className = `map-route-info mode-${mode} ${warning ? 'warning' : ''} ${pending ? 'pending' : ''} ${sourceClass} ${compact ? 'compact' : ''}`
    content.dataset.routeMode = mode
    content.style.setProperty('--route-color', transportModeMeta[mode].color)
    content.style.setProperty('--route-label-y', `${[-32, 44, -52, 62][index % 4]}px`)
    const duration = pending ? '待填用时' : formatDuration(min)
    const distance = km > 0 ? `${km} km` : '里程待补充'
    const sourceSuffix = sourceClass === 'estimated' ? ' · 暂估' : sourceClass === 'manual' ? ' · 手动' : ''
    content.innerHTML = `<span class="map-route-info-glyph">${this.escape(transportModeMeta[mode].glyph)}</span><div><strong>${this.escape(transportModeMeta[mode].label)} · ${this.escape(duration)}</strong><small>${this.escape(distance)}${sourceSuffix}</small></div>${warning ? '<i class="pi pi-exclamation-triangle"></i>' : ''}`
    content.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectRouteSegment(from.id, to.id) })
    content.title = `${from.name} → ${to.name} · ${transportModeMeta[mode].label} · ${duration} · ${distance}`
    const marker = new this.sdk.Marker({ position: this.routeMidpoint(path, from, to), content, offset: new this.sdk.Pixel(0, 0), zIndex: 215 + index })
    this.map.add(marker)
    this.overlays.push(marker)
  }

  private clearOverlays(): void {
    this.overlays.forEach((overlay) => {
      try { overlay.setMap?.(null) } catch { /* noop */ }
    })
    this.overlays = []
  }

  private escape(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character] ?? character)
  }
}

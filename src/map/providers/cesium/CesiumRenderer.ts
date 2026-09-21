import { categoryMeta } from '../../../domain/categories'
import { categoryPaths } from '../../../assets/icons/placeCategoryIcons'
import { coordinateDistance } from '../../coordinates'
import { decodeRoutePath } from '../../../domain/polyline'
import { formatDuration, routeInfo } from '../../../domain/schedule'
import { transportModeMeta, transportModeOf, transportRouteCacheKey } from '../../../domain/transport'
import type { CurrentLocationResult, MapDisplayMode, MapPickResult, MapScene, Place, RouteOption, TransportMode } from '../../../domain/types'
import { DEFAULT_MAP_TOUR_SPEED } from '../../PlanMapProvider'
import type { MapTourState, PlanMapCallbacks, PlanMapDataServices, PlanMapRenderer } from '../../PlanMapProvider'
import { defaultCesiumMapConfig, readCesiumMapConfig, type CesiumMapConfig } from './config'
import { loadCesium } from './loader'

interface CesiumEntityMeta {
  type: 'place' | 'segment' | 'route-option' | 'current-location'
  placeId?: string
  fromId?: string
  toId?: string
  optionId?: string
}

interface CesiumDomOverlay {
  element: HTMLElement
  position: any
  offsetY: number
  anchor: 'center' | 'bottom'
  maxCameraHeight: number
  scaleWithCamera: boolean
}

interface CesiumTourLeg {
  from: Place
  to: Place
  mode: TransportMode
  path: Array<[number, number]>
  heights: number[]
  durationSeconds: number
  startSeconds: number
  endSeconds: number
}

interface CesiumTourStop {
  place: Place
  seconds: number
  index: number
}

export class CesiumRenderer implements PlanMapRenderer {
  readonly id = 'cesium'
  readonly capabilities = {
    dimension: '3D' as const,
    presentation: 'globe' as const,
    coordinateSystem: 'WGS84' as const,
    satellite: Boolean(readCesiumMapConfig()?.ionToken),
    nativePoiSearch: false,
    nativeRouting: false,
    traffic: false,
    mapPicking: true,
    terrain: true,
    threeDTiles: true,
    animatedEntities: true,
    immersiveTour: true,
    displayModes: ['globe'] as MapDisplayMode[],
    routeAlternativeModes: [] as TransportMode[],
  }

  private sdk: any = null
  private viewer: any = null
  private container: HTMLElement | null = null
  private callbacks: PlanMapCallbacks | null = null
  private services: PlanMapDataServices | null = null
  private config: CesiumMapConfig = { ...defaultCesiumMapConfig }
  private pendingScene: MapScene | null = null
  private routeToken = 0
  private imageryToken = 0
  private pickMode = false
  private satelliteEnabled = false
  private pendingFocusPlace: Place | null = null
  private lastRouteSceneKey = ''
  private previewEntityIds: string[] = []
  private segmentRouteCache = new Map<string, { path: Array<[number, number]>; km: number; min: number; toll?: number }>()
  private terrainHeightCache = new Map<string, number>()
  private osmBuildings: any = null
  private domOverlayLayer: HTMLElement | null = null
  private domOverlays: CesiumDomOverlay[] = []
  private removePostRenderListener: (() => void) | null = null
  private tourState: MapTourState = { status: 'idle', progress: 0, speed: DEFAULT_MAP_TOUR_SPEED, cameraFollow: true, message: '', stopIndex: 0, totalStops: 0, visitCountdown: 0, visitTotal: 0 }
  private tourToken = 0
  private tourPositionProperty: any = null
  private tourEntity: any = null
  private tourVehicleOverlay: CesiumDomOverlay | null = null
  private tourLegs: CesiumTourLeg[] = []
  private tourStops: CesiumTourStop[] = []
  private tourStartTime: any = null
  private tourStopTime: any = null
  private nextTourStopIndex = 0
  private tourUserPaused = false
  private tourVisitActive = false
  private tourVisitTimer = 0
  private removeClockListener: (() => void) | null = null
  private lastTourStateUpdate = 0

  async mount(container: HTMLElement, callbacks: PlanMapCallbacks, services?: PlanMapDataServices): Promise<void> {
    this.container = container
    this.callbacks = callbacks
    this.services = services ?? null
    this.config = readCesiumMapConfig() ?? { ...defaultCesiumMapConfig }
    this.sdk = await loadCesium()
    if (this.config.ionToken) this.sdk.Ion.defaultAccessToken = this.config.ionToken
    const imageryProvider = await this.createImageryProvider(false)
    const terrainProvider = this.config.useWorldTerrain && this.config.ionToken
      ? await this.sdk.createWorldTerrainAsync()
      : new this.sdk.EllipsoidTerrainProvider()
    this.viewer = new this.sdk.Viewer(container, {
      animation: false,
      baseLayer: false,
      baseLayerPicker: false,
      fullscreenButton: false,
      geocoder: false,
      homeButton: false,
      infoBox: false,
      navigationHelpButton: false,
      sceneModePicker: false,
      selectionIndicator: false,
      timeline: false,
      vrButton: false,
      terrainProvider,
      requestRenderMode: false,
      maximumRenderTimeChange: Number.POSITIVE_INFINITY,
    })
    this.viewer.imageryLayers.addImageryProvider(imageryProvider)
    this.viewer.scene.verticalExaggeration = this.config.terrainExaggeration
    this.viewer.scene.globe.depthTestAgainstTerrain = Boolean(this.config.useWorldTerrain)
    this.domOverlayLayer = document.createElement('div')
    this.domOverlayLayer.className = 'cesium-dom-overlay-layer'
    container.appendChild(this.domOverlayLayer)
    this.removePostRenderListener = this.viewer.scene.postRender.addEventListener(() => this.updateDomOverlays())
    this.viewer.scene.globe.showGroundAtmosphere = true
    this.viewer.scene.fog.enabled = true
    this.installInteractionHandler()
    if (this.config.useOsmBuildings && this.config.ionToken) {
      try {
        this.osmBuildings = await this.sdk.createOsmBuildingsAsync()
        this.viewer.scene.primitives.add(this.osmBuildings)
      } catch { this.callbacks?.onError('Cesium OSM 3D 建筑加载失败，已继续使用基础地球场景') }
    }
    if (this.pendingScene) this.updateScene(this.pendingScene)
  }

  updateScene(scene: MapScene): void {
    this.pendingScene = scene
    if (!this.viewer || !this.sdk) return
    if (this.isTourActive()) return
    this.routeToken += 1
    const token = this.routeToken
    this.clearRouteOptionsPreview()
    this.clearDomOverlays()
    if (this.satelliteEnabled !== scene.satellite) void this.setSatelliteEnabled(scene.satellite)
    this.viewer.entities.removeAll()
    const scheduledNodes = scene.days.flatMap((day) => day.stops.map((stop) => ({ day, stop })))
    const scheduledIds = new Set(scheduledNodes.map((node) => node.stop.placeId))
    scheduledNodes.forEach((node, index) => {
      const place = scene.places.find((item) => item.id === node.stop.placeId)
      if (place) this.addPlaceOverlay(place, index + 1, node.day.id === scene.selectedDayId, scene.selectedPlaceId === place.id, scene.conflictPlaceIds.includes(place.id))
    })
    scene.places.filter((place) => !scheduledIds.has(place.id)).forEach((place) => {
      if (scene.categoryFilter === 'all' || place.category === scene.categoryFilter) this.addPlaceOverlay(place, null, false, scene.selectedPlaceId === place.id, false)
    })
    const routeDays = scene.routeDayIds.map((id) => scene.days.find((day) => day.id === id)).filter(Boolean)
    const effectiveDays = routeDays.length ? routeDays : scene.days.filter((day) => day.stops.length)
    if (scheduledNodes.length > 1) void this.renderRoutes(effectiveDays as MapScene['days'], scene, token)
    const routeSceneKey = JSON.stringify(scheduledNodes.map((node) => [node.stop.uid, node.stop.placeId, node.stop.selectedRoute?.id]))
    const shouldFit = routeSceneKey !== this.lastRouteSceneKey
    this.lastRouteSceneKey = routeSceneKey
    if (this.consumePendingFocus()) return
    if (shouldFit && scene.places.length) this.fitPlaces(scene.places)
    this.viewer.scene.requestRender()
  }

  private addPlaceOverlay(place: Place, order: number | null, current: boolean, selected: boolean, conflict: boolean): void {
    if (!this.domOverlayLayer) return
    const color = conflict ? '#df5b5b' : categoryMeta[place.category].color
    const state = selected ? 'selected' : current ? 'current' : 'normal'
    const element = document.createElement('button')
    element.type = 'button'
    element.className = `cesium-place-marker ${order == null ? 'candidate' : 'scheduled'} ${state} ${conflict ? 'conflict' : ''}`
    element.style.setProperty('--marker-color', color)
    element.innerHTML = `<span class="cesium-place-marker-name">${this.escapeHtml(place.name)}</span><span class="cesium-place-marker-graphic">${this.createMarkerSvg(place.category, color, order, state)}</span>`
    element.title = place.name
    element.addEventListener('click', (event) => {
      event.stopPropagation()
      if (this.pickMode) {
        this.callbacks?.onMapPickStart(place.lng, place.lat)
        this.callbacks?.onMapPick({
          lng: place.lng,
          lat: place.lat,
          crs: 'WGS84',
          address: place.address || place.name,
          candidates: place.address ? [{ ...place, address: place.address }] : [],
        })
        return
      }
      this.callbacks?.onSelectPlace(place.id)
    })
    this.domOverlayLayer.appendChild(element)
    this.domOverlays.push({
      element,
      position: this.sdk.Cartesian3.fromDegrees(place.lng, place.lat, place.altitude ?? 0),
      offsetY: 0,
      anchor: 'bottom',
      maxCameraHeight: order == null ? 180_000 : 2_000_000,
      scaleWithCamera: true,
    })
  }

  private createMarkerSvg(category: Place['category'], color: string, order: number | null, state: 'normal' | 'current' | 'selected'): string {
    const icon = categoryPaths[categoryMeta[category].icon] ?? categoryPaths.pin
    const light = this.mixHex(color, '#ffffff', 0.28)
    const dark = this.mixHex(color, '#17233f', 0.16)
    const soft = categoryMeta[category].soft
    const glowColor = state === 'selected' ? '#f2a33b' : color
    const glow = state === 'normal' ? '' : `<circle cx="80" cy="72" r="66" fill="none" stroke="${glowColor}" stroke-width="8" opacity=".28"/>`
    const mainContent = order == null
      ? `<g transform="translate(50 42) scale(2.5)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</g>`
      : `<text x="80" y="84" text-anchor="middle" font-family="Inter,Arial,Microsoft YaHei,sans-serif" font-size="${order > 99 ? 39 : 52}" font-weight="900" letter-spacing="-1" fill="${dark}">${order}</text>`
    const categoryBadge = order == null ? '' : `<g><circle cx="127" cy="117" r="23" fill="${color}" stroke="#fff" stroke-width="6"/><g transform="translate(115 105)" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${icon}</g></g>`
    return `<svg class="cesium-place-marker-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 190" shape-rendering="geometricPrecision"><defs><linearGradient id="g" x1="28" y1="15" x2="131" y2="157" gradientUnits="userSpaceOnUse"><stop stop-color="${light}"/><stop offset=".52" stop-color="${color}"/><stop offset="1" stop-color="${dark}"/></linearGradient><radialGradient id="i" cx=".38" cy=".28" r=".78"><stop stop-color="#fff"/><stop offset="1" stop-color="${soft}"/></radialGradient></defs>${glow}<path d="M80 6C40 6 14 34 14 72c0 48 66 108 66 108s66-60 66-108C146 34 120 6 80 6Z" fill="url(#g)" stroke="#fff" stroke-width="4"/><path d="M38 40c13-20 47-31 73-17" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" opacity=".28"/><circle cx="80" cy="72" r="49" fill="url(#i)" stroke="#fff" stroke-width="4"/><circle cx="80" cy="72" r="43" fill="none" stroke="${color}" stroke-width="2" opacity=".14"/>${mainContent}${categoryBadge}</svg>`
  }

  private mixHex(source: string, target: string, ratio: number): string {
    const read = (value: string): [number, number, number] => {
      const hex = value.replace('#', '').padEnd(6, '0').slice(0, 6)
      return [Number.parseInt(hex.slice(0, 2), 16), Number.parseInt(hex.slice(2, 4), 16), Number.parseInt(hex.slice(4, 6), 16)]
    }
    const from = read(source)
    const to = read(target)
    return `#${from.map((value, index) => Math.round(value + (to[index] - value) * ratio).toString(16).padStart(2, '0')).join('')}`
  }

  private escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character)
  }

  private async renderRoutes(days: MapScene['days'], scene: MapScene, token: number): Promise<void> {
    const stops = days.flatMap((day) => day.stops)
    if (stops.length < 2 || !this.services) return
    const places = Object.fromEntries(scene.places.map((place) => [place.id, place]))
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
      let path: Array<[number, number]> = [[from.lng, from.lat], [to.lng, to.lat]]
      let km = fallback.km
      let min = fallback.min
      let source = fallback.source ?? 'estimate'
      const selected = fromStop.selectedRoute && fromStop.selectedRoute.toPlaceId === to.id && fromStop.selectedRoute.mode === mode ? fromStop.selectedRoute : null
      if (selected) {
        path = decodeRoutePath(selected.encodedPath)
        km = selected.distanceKm
        min = selected.durationMinutes
        source = 'provider'
        providerCount += 1
      } else if (transportModeMeta[mode].automatic) {
        const cacheKey = transportRouteCacheKey(from.id, to.id, mode)
        const cached = this.segmentRouteCache.get(cacheKey)
        if (cached) {
          path = cached.path
          km = cached.km
          min = cached.min
          source = 'provider'
          providerCount += 1
        } else {
          try {
            const option = (await this.services.routing.searchRouteOptions({ from, to, mode }))[0]
            if (token !== this.routeToken) return
            if (option) {
              path = option.path
              km = option.distanceKm
              min = option.durationMinutes
              source = 'provider'
              providerCount += 1
              this.segmentRouteCache.set(cacheKey, { path, km, min, toll: option.toll })
              this.callbacks?.onRouteSegment(from.id, to.id, mode, km, min, option.toll)
            }
          } catch { /* keep the visible direct connection and cached estimate */ }
        }
      }
      totalKm += km
      totalMin += min
      this.addRouteEntity(path, from, to, mode, km, min, source, scene.routeWarning, index)
    }
    if (token !== this.routeToken) return
    this.callbacks?.onRouteSummary({ km: totalKm, min: totalMin, source: providerCount ? 'provider' : 'cache' })
    this.viewer.scene.requestRender()
  }

  private addRouteEntity(path: Array<[number, number]>, from: Place, to: Place, mode: TransportMode, km: number, min: number, source: string, warning: boolean, index: number): void {
    const color = this.sdk.Color.fromCssColorString(warning ? '#df5b5b' : transportModeMeta[mode].color)
    const positions = mode === 'flight'
      ? path.map(([lng, lat], pointIndex) => this.sdk.Cartesian3.fromDegrees(lng, lat, Math.sin(Math.PI * pointIndex / Math.max(1, path.length - 1)) * 120000))
      : this.sdk.Cartesian3.fromDegreesArray(path.flat())
    const route = this.viewer.entities.add({
      id: `route-${index}-${from.id}-${to.id}`,
      polyline: {
        positions,
        width: mode === 'flight' ? 4 : 6,
        material: color.withAlpha(source === 'estimate' ? 0.66 : 0.92),
        clampToGround: mode !== 'flight' && this.config.useWorldTerrain,
        arcType: mode === 'flight' ? this.sdk.ArcType.NONE : this.sdk.ArcType.GEODESIC,
      },
    })
    ;(route as any).__travelMeta = { type: 'segment', fromId: from.id, toId: to.id } satisfies CesiumEntityMeta
    const middle = path[Math.floor(path.length / 2)] ?? [(from.lng + to.lng) / 2, (from.lat + to.lat) / 2]
    this.addRouteBadge(middle, mode === 'flight' ? 85000 : 200, mode, km, min, source, warning, index, from.id, to.id)

  }


  private addRouteBadge(coordinate: [number, number], altitude: number, mode: TransportMode, km: number, min: number, source: string, warning: boolean, index: number, fromId: string, toId: string): void {
    if (!this.domOverlayLayer) return
    const element = document.createElement('button')
    element.type = 'button'
    element.className = `cesium-route-badge mode-${mode} ${warning ? 'warning' : ''} ${source === 'estimate' ? 'estimated' : ''}`
    element.style.setProperty('--route-color', warning ? '#df5b5b' : transportModeMeta[mode].color)
    element.innerHTML = `<span class="cesium-route-badge-icon">${this.transportIconSvg(mode)}</span><span class="cesium-route-badge-copy"><b>${transportModeMeta[mode].label} · ${formatDuration(min)}</b><small>${km} km${source === 'estimate' ? ' · 暂估' : ''}</small></span>`
    element.title = `${transportModeMeta[mode].label} · ${formatDuration(min)} · ${km} km`
    element.addEventListener('click', (event) => { event.stopPropagation(); this.callbacks?.onSelectRouteSegment(fromId, toId) })
    this.domOverlayLayer.appendChild(element)
    this.domOverlays.push({ element, position: this.sdk.Cartesian3.fromDegrees(coordinate[0], coordinate[1], altitude), offsetY: [-36, 42, -52, 60][index % 4], anchor: 'center', maxCameraHeight: 1_300_000, scaleWithCamera: false })
  }

  private transportIconSvg(mode: TransportMode): string {
    const paths: Record<TransportMode, string> = {
      driving: '<path d="M4 14 6.5 8h11L20 14v4h-2v2h-3v-2H9v2H6v-2H4v-4Z"/><path d="M7 14h10"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/>',
      walking: '<circle cx="13" cy="4" r="2"/><path d="m11 8 3 3 3 1M13 10l-2 5-4 4M13 13l4 6"/>',
      cycling: '<circle cx="6" cy="17" r="4"/><circle cx="18" cy="17" r="4"/><path d="m6 17 4-7 4 7m-6-3h7l-3-6h3"/>',
      transit: '<rect x="4" y="4" width="16" height="14" rx="3"/><path d="M7 8h10M8 18v2M16 18v2"/><circle cx="8" cy="15" r="1"/><circle cx="16" cy="15" r="1"/>',
      train: '<path d="M7 3h10a2 2 0 0 1 2 2v11a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V5a2 2 0 0 1 2-2Z"/><path d="M8 7h8M8 15h.01M16 15h.01M8 22l2-3M16 19l2 3"/>',
      flight: '<path d="m3 13 7-2 4-8 2 1-2 7 6 2 1 2-7-1-3 7-2-1 1-7-5 1-3-2 1-1Z"/>',
      ferry: '<path d="M4 15h16l-2 5H6l-2-5Z"/><path d="M7 15V8h10v7M10 8V4h4v4M3 22c2 1 4 1 6 0 2 1 4 1 6 0 2 1 4 1 6 0"/>',
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[mode]}</svg>`
  }

  private updateDomOverlays(): void {
    if (!this.viewer || !this.sdk || !this.domOverlays.length) return
    const scene = this.viewer.scene
    const occluder = new this.sdk.EllipsoidalOccluder(scene.globe.ellipsoid, this.viewer.camera.position)
    const cameraHeight = Math.max(1, this.viewer.camera.positionCartographic.height)
    this.domOverlays.forEach((overlay) => {
      const visible = cameraHeight <= overlay.maxCameraHeight && occluder.isPointVisible(overlay.position)
      const point = visible ? this.sdk.SceneTransforms.worldToWindowCoordinates(scene, overlay.position) : null
      if (!point) {
        overlay.element.style.display = 'none'
        return
      }
      const anchor = overlay.anchor === 'bottom' ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)'
      const scale = overlay.scaleWithCamera ? Math.max(0.78, Math.min(1.08, 500_000 / cameraHeight)) : 1
      overlay.element.style.display = ''
      overlay.element.style.transform = `translate3d(${Math.round(point.x)}px, ${Math.round(point.y + overlay.offsetY)}px, 0) ${anchor} scale(${scale.toFixed(3)})`
    })
  }

  private clearDomOverlays(): void {
    this.domOverlays.forEach((overlay) => overlay.element.remove())
    this.domOverlays = []
  }

  private installInteractionHandler(): void {
    this.viewer.screenSpaceEventHandler.setInputAction((movement: any) => {
      const picked = this.viewer.scene.pick(movement.position)
      const entity = picked?.id
      const meta = entity?.__travelMeta as CesiumEntityMeta | undefined
      if (this.pickMode) {
        void this.pickAtScreenPosition(movement.position)
        return
      }
      if (meta?.type === 'place' && meta.placeId) this.callbacks?.onSelectPlace(meta.placeId)
      else if (meta?.type === 'segment' && meta.fromId && meta.toId) this.callbacks?.onSelectRouteSegment(meta.fromId, meta.toId)
      else if (meta?.type === 'route-option' && meta.optionId) this.callbacks?.onPreviewRouteOption(meta.optionId)
    }, this.sdk.ScreenSpaceEventType.LEFT_CLICK)
  }

  private async pickAtScreenPosition(screenPosition: any): Promise<void> {
    const scene = this.viewer.scene
    const cartesian = scene.pickPositionSupported ? scene.pickPosition(screenPosition) : this.viewer.camera.pickEllipsoid(screenPosition, scene.globe.ellipsoid)
    if (!cartesian) return
    const cartographic = this.sdk.Cartographic.fromCartesian(cartesian)
    const lng = this.sdk.Math.toDegrees(cartographic.longitude)
    const lat = this.sdk.Math.toDegrees(cartographic.latitude)
    this.callbacks?.onMapPickStart(lng, lat)
    const center: Place = { id: 'cesium-pick', name: '地图选点', type: '地图选点', category: 'other', priority: 'normal', lng, lat, crs: 'WGS84' }
    let candidates: any[] = []
    if (this.services) {
      try {
        const groups = await Promise.all(['景点', '酒店', '餐饮'].map((keyword) => this.services!.places.searchNearbyPlaces(center, keyword, 1000).catch(() => [])))
        const byId = new Map(groups.flat().map((item) => [item.providerId || item.id, item]))
        candidates = [...byId.values()].slice(0, 8)
      } catch { candidates = [] }
    }
    const result: MapPickResult = {
      lng,
      lat,
      crs: 'WGS84',
      address: candidates[0]?.address || `${lng.toFixed(6)}, ${lat.toFixed(6)}`,
      candidates,
    }
    this.addPickEntity(lng, lat)
    this.callbacks?.onMapPick(result)
  }

  private addPickEntity(lng: number, lat: number): void {
    const entity = this.viewer.entities.add({
      id: `cesium-pick-${Date.now()}`,
      position: this.sdk.Cartesian3.fromDegrees(lng, lat),
      point: {
        pixelSize: 18,
        color: this.sdk.Color.fromCssColorString('#536fda'),
        outlineColor: this.sdk.Color.WHITE,
        outlineWidth: 4,
        heightReference: this.config.useWorldTerrain ? this.sdk.HeightReference.CLAMP_TO_GROUND : this.sdk.HeightReference.NONE,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    })
    ;(entity as any).__travelMeta = { type: 'current-location' } satisfies CesiumEntityMeta
    this.viewer.scene.requestRender()
  }

  previewRouteOptions(options: RouteOption[], selectedId?: string): void {
    this.clearRouteOptionsPreview()
    if (!this.viewer || !this.sdk) return
    options.forEach((option, index) => {
      const selected = !selectedId || option.id === selectedId
      const entity = this.viewer.entities.add({
        id: `route-option-${option.id}`,
        polyline: {
          positions: this.sdk.Cartesian3.fromDegreesArray(option.path.flat()),
          width: selected ? 9 : 5,
          material: this.sdk.Color.fromCssColorString(selected ? '#536fda' : '#aeb7c8').withAlpha(selected ? 0.96 : 0.58),
          clampToGround: this.config.useWorldTerrain,
        },
      })
      ;(entity as any).__travelMeta = { type: 'route-option', optionId: option.id } satisfies CesiumEntityMeta
      this.previewEntityIds.push(entity.id)
      if (index === 0 && option.path.length) this.fitCoordinates(option.path)
    })
    this.viewer.scene.requestRender()
  }

  clearRouteOptionsPreview(): void {
    if (!this.viewer) return
    this.previewEntityIds.forEach((id) => this.viewer.entities.removeById(id))
    this.previewEntityIds = []
  }

  async startImmersiveTour(): Promise<void> {
    const scene = this.pendingScene
    if (!this.viewer || !this.sdk || !this.services || !scene) throw new Error('Cesium 场景尚未准备完成')
    const nodes = scene.days.flatMap((day) => day.stops.map((stop) => ({ day, stop, place: scene.places.find((item) => item.id === stop.placeId) }))).filter((node): node is { day: MapScene['days'][number]; stop: MapScene['days'][number]['stops'][number]; place: Place } => Boolean(node.place))
    if (nodes.length < 2) throw new Error('至少安排两个地点后才能开始路线漫游')
    this.stopTourInternal(false)
    const token = ++this.tourToken
    this.emitTourState({ status: 'opening', progress: 0, speed: this.tourState.speed || DEFAULT_MAP_TOUR_SPEED, message: '正在准备全程路线与镜头…', stopIndex: 0, totalStops: nodes.length })
    const legs = await this.resolveTourLegs(nodes, token)
    if (token !== this.tourToken || !legs.length) return
    this.tourLegs = legs
    this.tourStartTime = this.sdk.JulianDate.now()
    this.tourPositionProperty = new this.sdk.SampledPositionProperty()
    this.tourPositionProperty.setInterpolationOptions({ interpolationDegree: 1, interpolationAlgorithm: this.sdk.LinearApproximation })
    this.tourStops = [{ place: legs[0].from, seconds: 0, index: 0 }]
    legs.forEach((leg) => {
      const distances = leg.path.map((point, index) => index ? coordinateDistance(leg.path[index - 1], point) : 0)
      const totalDistance = Math.max(1, distances.reduce((sum, value) => sum + value, 0))
      let walked = 0
      leg.path.forEach((point, index) => {
        if (index) walked += distances[index]
        const fraction = walked / totalDistance
        const seconds = leg.startSeconds + leg.durationSeconds * fraction
        const altitude = leg.mode === 'flight' ? Math.sin(Math.PI * fraction) * 120000 + 6000 : leg.heights[index] ?? 3
        this.tourPositionProperty.addSample(this.sdk.JulianDate.addSeconds(this.tourStartTime, seconds, new this.sdk.JulianDate()), this.sdk.Cartesian3.fromDegrees(point[0], point[1], altitude))
      })
      this.tourStops.push({ place: leg.to, seconds: leg.endSeconds, index: this.tourStops.length })
    })
    this.tourStopTime = this.sdk.JulianDate.addSeconds(this.tourStartTime, legs[legs.length - 1].endSeconds, new this.sdk.JulianDate())
    this.tourEntity = this.viewer.entities.add({ id: `immersive-tour-${Date.now()}`, position: this.tourPositionProperty, orientation: new this.sdk.VelocityOrientationProperty(this.tourPositionProperty), show: false })
    this.createTourVehicleOverlay(legs[0].mode)
    const clock = this.viewer.clock
    clock.startTime = this.sdk.JulianDate.clone(this.tourStartTime)
    clock.stopTime = this.sdk.JulianDate.clone(this.tourStopTime)
    clock.currentTime = this.sdk.JulianDate.clone(this.tourStartTime)
    clock.clockRange = this.sdk.ClockRange.CLAMPED
    clock.multiplier = this.tourState.speed
    clock.shouldAnimate = false
    this.removeClockListener = clock.onTick.addEventListener((value: any) => this.onTourTick(value))
    this.nextTourStopIndex = 1
    this.tourUserPaused = false
    this.tourVisitActive = false
    this.viewer.scene.screenSpaceCameraController.enableInputs = !this.tourState.cameraFollow
    if (this.tourState.cameraFollow) this.fitCoordinates(nodes.map((node) => [node.place.lng, node.place.lat]))
    await this.waitForTourDelay(1200, token)
    if (token !== this.tourToken) return
    this.visitTourStop(0)
  }

  pauseImmersiveTour(): void {
    if (!this.isTourActive()) return
    this.tourUserPaused = true
    if (this.viewer) {
      this.viewer.clock.shouldAnimate = false
      this.viewer.scene.screenSpaceCameraController.enableInputs = true
    }
    this.releaseTourCamera()
    this.emitTourState({ status: 'paused', message: this.tourState.currentPlaceName ? `已暂停 · ${this.tourState.currentPlaceName}` : '漫游已暂停' })
  }

  resumeImmersiveTour(): void {
    if (!this.isTourActive()) return
    this.tourUserPaused = false
    if (this.tourVisitActive) {
      this.emitTourState({ status: 'visiting', message: this.tourState.currentPlaceName ? `正在游览 ${this.tourState.currentPlaceName}` : '正在游览地点' })
      return
    }
    if (this.viewer) {
      this.viewer.clock.multiplier = this.tourState.speed
      this.viewer.clock.shouldAnimate = true
      this.viewer.scene.screenSpaceCameraController.enableInputs = !this.tourState.cameraFollow
    }
    this.emitTourState({ status: 'playing', message: this.currentTourLegMessage() })
  }

  stopImmersiveTour(): void {
    this.stopTourInternal(true)
    if (this.pendingScene && this.viewer) this.updateScene(this.pendingScene)
  }

  setImmersiveTourSpeed(speed: number): void {
    const normalized = Number.isFinite(speed) ? Math.max(0.05, Math.min(8, Math.round(speed * 100) / 100)) : DEFAULT_MAP_TOUR_SPEED
    this.tourState.speed = normalized
    if (this.viewer) this.viewer.clock.multiplier = normalized
    this.emitTourState({ speed: normalized, message: this.tourState.message })
  }

  setImmersiveTourCameraFollow(enabled: boolean): void {
    const cameraFollow = Boolean(enabled)
    this.tourState.cameraFollow = cameraFollow
    if (this.viewer) {
      if (!cameraFollow) {
        this.viewer.camera?.cancelFlight?.()
        this.releaseTourCamera()
        this.viewer.scene.screenSpaceCameraController.enableInputs = true
      } else if (this.isTourActive() && !this.tourUserPaused) {
        this.viewer.scene.screenSpaceCameraController.enableInputs = false
        if (this.tourVisitActive && this.tourState.currentPlaceId) {
          const stop = this.tourStops.find((item) => item.place.id === this.tourState.currentPlaceId)
          if (stop) this.focusTourStopCamera(stop.place)
        } else if (this.tourPositionProperty) {
          const position = this.tourPositionProperty.getValue(this.viewer.clock.currentTime)
          const leg = this.tourLegs.find((item) => {
            if (!this.tourStartTime) return false
            const elapsed = this.sdk.JulianDate.secondsDifference(this.viewer.clock.currentTime, this.tourStartTime)
            return elapsed >= item.startSeconds && elapsed <= item.endSeconds
          })
          if (position && leg) this.updateTourCamera(this.viewer.clock.currentTime, position, leg.mode)
        }
      }
      this.viewer.scene.requestRender()
    }
    this.emitTourState({ cameraFollow, message: this.tourState.message })
  }

  private async resolveTourLegs(nodes: Array<{ stop: MapScene['days'][number]['stops'][number]; place: Place }>, token: number): Promise<CesiumTourLeg[]> {
    const legs: CesiumTourLeg[] = []
    let seconds = 0
    for (let index = 0; index < nodes.length - 1; index += 1) {
      if (token !== this.tourToken) return []
      const fromNode = nodes[index]
      const toNode = nodes[index + 1]
      const mode = transportModeOf(fromNode.stop.transportMode)
      let path: Array<[number, number]> = [[fromNode.place.lng, fromNode.place.lat], [toNode.place.lng, toNode.place.lat]]
      let km = Math.max(1, Math.round(coordinateDistance(path[0], path[1]) / 1000))
      const selected = fromNode.stop.selectedRoute && fromNode.stop.selectedRoute.toPlaceId === toNode.place.id && fromNode.stop.selectedRoute.mode === mode ? fromNode.stop.selectedRoute : null
      if (selected) {
        path = decodeRoutePath(selected.encodedPath)
        km = selected.distanceKm
      } else {
        const cacheKey = transportRouteCacheKey(fromNode.place.id, toNode.place.id, mode)
        const cached = this.segmentRouteCache.get(cacheKey)
        if (cached) {
          path = cached.path
          km = cached.km
        } else if (transportModeMeta[mode].automatic) {
          try {
            const option = (await this.services!.routing.searchRouteOptions({ from: fromNode.place, to: toNode.place, mode }))[0]
            if (option) {
              path = option.path
              km = option.distanceKm
              this.segmentRouteCache.set(cacheKey, { path, km, min: option.durationMinutes, toll: option.toll })
            }
          } catch { /* use direct leg */ }
        }
      }
      const heights = mode === 'flight' ? path.map(() => 0) : await this.sampleTourGroundHeights(path)
      if (token !== this.tourToken) return []
      const durationSeconds = Math.max(4, Math.min(12, Math.sqrt(Math.max(1, km)) * 0.68))
      legs.push({ from: fromNode.place, to: toNode.place, mode, path, heights, durationSeconds, startSeconds: seconds, endSeconds: seconds + durationSeconds })
      seconds += durationSeconds
    }
    return legs
  }

  private async sampleTourGroundHeights(path: Array<[number, number]>): Promise<number[]> {
    if (!this.config.useWorldTerrain || !this.viewer || !this.sdk) return path.map(() => 3)
    const keys = path.map(([lng, lat]) => `${lng.toFixed(6)},${lat.toFixed(6)}`)
    const missing = keys.map((key, index) => ({ key, index, point: path[index] })).filter((item) => !this.terrainHeightCache.has(item.key))
    try {
      for (let offset = 0; offset < missing.length; offset += 256) {
        const batch = missing.slice(offset, offset + 256)
        const cartographics = batch.map((item) => this.sdk.Cartographic.fromDegrees(item.point[0], item.point[1]))
        const sampled = await this.sdk.sampleTerrainMostDetailed(this.viewer.terrainProvider, cartographics)
        sampled.forEach((position: any, index: number) => {
          const height = Number.isFinite(Number(position.height)) ? Number(position.height) : 0
          this.terrainHeightCache.set(batch[index].key, height + 3)
        })
      }
    } catch {
      missing.forEach((item) => this.terrainHeightCache.set(item.key, 3))
      this.callbacks?.onError('部分漫游路线未能取得地形高程，已按地表近似高度继续播放')
    }
    return keys.map((key) => this.terrainHeightCache.get(key) ?? 3)
  }

  private onTourTick(clock: any): void {
    if (!this.tourStartTime || !this.tourStopTime || !this.tourPositionProperty || !this.viewer) return
    const totalSeconds = Math.max(0.001, this.sdk.JulianDate.secondsDifference(this.tourStopTime, this.tourStartTime))
    const elapsedSeconds = Math.max(0, Math.min(totalSeconds, this.sdk.JulianDate.secondsDifference(clock.currentTime, this.tourStartTime)))
    const position = this.tourPositionProperty.getValue(clock.currentTime)
    if (position && this.tourVehicleOverlay) this.tourVehicleOverlay.position = position
    const leg = this.tourLegs.find((item) => elapsedSeconds >= item.startSeconds && elapsedSeconds <= item.endSeconds) ?? this.tourLegs[this.tourLegs.length - 1]
    if (leg) {
      this.updateTourVehicleMode(leg.mode)
      if (this.tourState.cameraFollow && this.tourState.status === 'playing' && !this.tourUserPaused && !this.tourVisitActive && position) this.updateTourCamera(clock.currentTime, position, leg.mode)
    }
    const nextStop = this.tourStops[this.nextTourStopIndex]
    if (nextStop && elapsedSeconds >= nextStop.seconds - 0.03 && !this.tourVisitActive) {
      this.visitTourStop(this.nextTourStopIndex)
      return
    }
    const now = performance.now()
    if (now - this.lastTourStateUpdate > 100) {
      this.lastTourStateUpdate = now
      this.emitTourState({
        progress: elapsedSeconds / totalSeconds,
        fromPlaceName: leg?.from.name,
        toPlaceName: leg?.to.name,
        mode: leg?.mode,
        message: this.currentTourLegMessage(leg),
      })
    }
  }


  private visitTourStop(index: number): void {
    const stop = this.tourStops[index]
    if (!stop || !this.viewer || this.tourVisitActive) return
    const token = this.tourToken
    this.tourVisitActive = true
    this.viewer.clock.shouldAnimate = false
    if (this.tourState.cameraFollow) this.releaseTourCamera()
    this.callbacks?.onSelectPlace(stop.place.id)
    const visitDuration = Math.min(12000, Math.max(1500, 3000 / this.tourState.speed))
    const visitTotal = Math.ceil(visitDuration / 1000)
    this.emitTourState({
      status: 'visiting',
      currentPlaceId: stop.place.id,
      currentPlaceName: stop.place.name,
      message: `抵达 ${stop.place.name} · 正在查看地点信息`,
      stopIndex: index + 1,
      totalStops: this.tourStops.length,
      visitCountdown: visitTotal,
      visitTotal,
    })
    if (this.tourState.cameraFollow) this.focusTourStopCamera(stop.place)
    let remaining = visitTotal
    const interval = window.setInterval(() => {
      if (token !== this.tourToken) { window.clearInterval(interval); return }
      remaining -= 1
      if (remaining <= 0) { window.clearInterval(interval); return }
      this.emitTourState({ visitCountdown: remaining, visitTotal })
    }, 1000)
    window.clearTimeout(this.tourVisitTimer)
    this.tourVisitTimer = window.setTimeout(() => {
      window.clearInterval(interval)
      if (token !== this.tourToken) return
      this.tourVisitActive = false
      this.nextTourStopIndex = index + 1
      if (index >= this.tourStops.length - 1) {
        this.completeTour()
        return
      }
      if (this.tourUserPaused) {
        this.emitTourState({ status: 'paused', message: `已暂停 · ${stop.place.name}`, visitCountdown: 0, visitTotal: 0 })
        return
      }
      this.viewer.clock.shouldAnimate = true
      this.viewer.clock.multiplier = this.tourState.speed
      this.viewer.scene.screenSpaceCameraController.enableInputs = !this.tourState.cameraFollow
      this.emitTourState({ status: 'playing', message: this.currentTourLegMessage(), visitCountdown: 0, visitTotal: 0 })
    }, visitDuration)
  }

  skipTourVisit(): void {
    if (!this.tourVisitActive) return
    window.clearTimeout(this.tourVisitTimer)
    this.tourVisitTimer = window.setTimeout(() => {
      if (this.tourToken === 0) return
      const index = this.nextTourStopIndex - 1
      const stop = this.tourStops[Math.max(0, index)]
      this.tourVisitActive = false
      this.nextTourStopIndex = index + 1
      if (index >= this.tourStops.length - 1) {
        this.completeTour()
        return
      }
      if (this.tourUserPaused) {
        this.emitTourState({ status: 'paused', message: stop ? `已暂停 · ${stop.place.name}` : '已暂停', visitCountdown: 0, visitTotal: 0 })
        return
      }
      this.viewer.clock.shouldAnimate = true
      this.viewer.clock.multiplier = this.tourState.speed
      this.viewer.scene.screenSpaceCameraController.enableInputs = !this.tourState.cameraFollow
      this.emitTourState({ status: 'playing', message: this.currentTourLegMessage(), visitCountdown: 0, visitTotal: 0 })
    }, 50)
  }


  private completeTour(): void {
    if (!this.viewer) return
    this.viewer.clock.shouldAnimate = false
    this.removeClockListener?.()
    this.removeClockListener = null
    this.removeTourVehicle()
    if (this.tourEntity) this.viewer.entities.remove(this.tourEntity)
    this.tourEntity = null
    this.releaseTourCamera()
    this.viewer.scene.screenSpaceCameraController.enableInputs = true
    if (this.tourState.cameraFollow && this.pendingScene) this.fitPlaces(this.pendingScene.places)
    const last = this.tourStops[this.tourStops.length - 1]
    this.emitTourState({ status: 'completed', progress: 1, currentPlaceId: last?.place.id, currentPlaceName: last?.place.name, message: '全程漫游完成 · 已返回路线总览', stopIndex: this.tourStops.length, totalStops: this.tourStops.length })
  }

  private stopTourInternal(emitIdle: boolean): void {
    this.tourToken += 1
    window.clearTimeout(this.tourVisitTimer)
    this.tourVisitTimer = 0
    this.removeClockListener?.()
    this.removeClockListener = null
    if (this.viewer) {
      this.viewer.clock.shouldAnimate = false
      this.viewer.scene.screenSpaceCameraController.enableInputs = true
      if (this.tourEntity) this.viewer.entities.remove(this.tourEntity)
    }
    this.tourEntity = null
    this.tourPositionProperty = null
    this.tourLegs = []
    this.tourStops = []
    this.tourStartTime = null
    this.tourStopTime = null
    this.nextTourStopIndex = 0
    this.tourUserPaused = false
    this.tourVisitActive = false
    this.removeTourVehicle()
    this.releaseTourCamera()
    if (emitIdle) this.emitTourState({ status: 'idle', progress: 0, message: '', currentPlaceId: undefined, currentPlaceName: undefined, fromPlaceName: undefined, toPlaceName: undefined, mode: undefined, stopIndex: 0, totalStops: 0, visitCountdown: 0, visitTotal: 0 })
  }

  private createTourVehicleOverlay(mode: TransportMode): void {
    if (!this.domOverlayLayer || !this.tourPositionProperty || !this.tourStartTime) return
    const element = document.createElement('div')
    element.className = `cesium-tour-vehicle mode-${mode}`
    element.dataset.mode = mode
    element.style.setProperty('--tour-color', transportModeMeta[mode].color)
    element.innerHTML = `<span>${this.transportIconSvg(mode)}</span><i></i>`
    this.domOverlayLayer.appendChild(element)
    const overlay: CesiumDomOverlay = {
      element,
      position: this.tourPositionProperty.getValue(this.tourStartTime),
      offsetY: -12,
      anchor: 'center',
      maxCameraHeight: Number.POSITIVE_INFINITY,
      scaleWithCamera: false,
    }
    this.domOverlays.push(overlay)
    this.tourVehicleOverlay = overlay
  }

  private focusTourStopCamera(place: Place): void {
    if (!this.viewer || !this.sdk) return
    const target = this.sdk.Cartesian3.fromDegrees(place.lng, place.lat, place.altitude ?? 0)
    this.viewer.camera.flyToBoundingSphere(new this.sdk.BoundingSphere(target, 80), {
      offset: new this.sdk.HeadingPitchRange(this.sdk.Math.toRadians(18), this.sdk.Math.toRadians(-42), Math.max(2200, (place.altitude ?? 0) + 3200)),
      duration: 0.85,
    })
  }

  private updateTourVehicleMode(mode: TransportMode): void {
    const overlay = this.tourVehicleOverlay
    if (!overlay || overlay.element.dataset.mode === mode) return
    overlay.element.dataset.mode = mode
    overlay.element.className = `cesium-tour-vehicle mode-${mode}`
    overlay.element.style.setProperty('--tour-color', transportModeMeta[mode].color)
    overlay.element.innerHTML = `<span>${this.transportIconSvg(mode)}</span><i></i>`
  }

  private removeTourVehicle(): void {
    const overlay = this.tourVehicleOverlay
    if (!overlay) return
    overlay.element.remove()
    this.domOverlays = this.domOverlays.filter((item) => item !== overlay)
    this.tourVehicleOverlay = null
  }

  private updateTourCamera(time: any, position: any, mode: TransportMode): void {
    if (!this.viewer) return
    const futureTime = this.sdk.JulianDate.addSeconds(time, 0.45, new this.sdk.JulianDate())
    const future = this.tourPositionProperty?.getValue(futureTime) ?? position
    const currentCartographic = this.sdk.Cartographic.fromCartesian(position)
    const futureCartographic = this.sdk.Cartographic.fromCartesian(future)
    const deltaLongitude = futureCartographic.longitude - currentCartographic.longitude
    const heading = Math.atan2(
      Math.sin(deltaLongitude) * Math.cos(futureCartographic.latitude),
      Math.cos(currentCartographic.latitude) * Math.sin(futureCartographic.latitude) - Math.sin(currentCartographic.latitude) * Math.cos(futureCartographic.latitude) * Math.cos(deltaLongitude),
    )
    const isTerrain = this.config.useWorldTerrain
    const baseRange: Record<TransportMode, number> = { walking: 800, cycling: 1400, driving: 2600, transit: 3600, train: 5200, flight: 36000, ferry: 4800 }
    const basePitch: Record<TransportMode, number> = isTerrain ? { walking: -22, cycling: -24, driving: -26, transit: -28, train: -30, flight: -28, ferry: -30 } : { walking: -32, cycling: -34, driving: -38, transit: -42, train: -43, flight: -28, ferry: -40 }
    const vehicleHeight = currentCartographic.height + (isTerrain ? 3 : 0)
    const pitchDeg = this.computeOcclusionSafePitch(position, basePitch[mode], baseRange[mode], vehicleHeight, heading, mode)
    const range = isTerrain ? this.computeOcclusionSafeRange(position, baseRange[mode], pitchDeg, vehicleHeight, heading, mode) : baseRange[mode]
    this.viewer.camera.lookAt(position, new this.sdk.HeadingPitchRange(heading, this.sdk.Math.toRadians(pitchDeg), range))
  }

  private computeOcclusionSafePitch(position: any, basePitchDeg: number, range: number, vehicleHeight: number, heading: number, _mode: TransportMode): number {
    if (!this.viewer || !this.sdk) return basePitchDeg
    try {
      const baseLookFrom = this.computeLookAtOrigin(position, basePitchDeg, range, heading)
      const intersection = this.pickGlobeSurface(baseLookFrom, position)
      if (!intersection) return Math.max(basePitchDeg, -18)
      if (this.sdk.Cartographic.fromCartesian(intersection).height <= vehicleHeight + 150) return Math.max(basePitchDeg, -18)
      let adjustedPitchDeg = basePitchDeg + 8
      for (let step = 0; step < 4; step += 1) {
        const lookFrom = this.computeLookAtOrigin(position, adjustedPitchDeg, range, heading)
        const newIntersection = this.pickGlobeSurface(lookFrom, position)
        if (!newIntersection) return adjustedPitchDeg
        if (this.sdk.Cartographic.fromCartesian(newIntersection).height <= vehicleHeight + 120) return adjustedPitchDeg
        adjustedPitchDeg += 8
      }
      return -10
    } catch {
      return Math.max(basePitchDeg, -18)
    }
  }

  private computeOcclusionSafeRange(position: any, baseRange: number, pitchDeg: number, vehicleHeight: number, heading: number, mode: TransportMode): number {
    if (!this.viewer || !this.sdk || mode === 'flight') return baseRange
    try {
      const baseLookFrom = this.computeLookAtOrigin(position, pitchDeg, baseRange, heading)
      const intersection = this.pickGlobeSurface(baseLookFrom, position)
      if (!intersection) return baseRange
      if (this.sdk.Cartographic.fromCartesian(intersection).height <= vehicleHeight + 80) return baseRange
      const maxRange = baseRange * 4
      let adjustedRange = baseRange * 1.6
      for (let step = 0; step < 3; step += 1) {
        const lookFrom = this.computeLookAtOrigin(position, pitchDeg, adjustedRange, heading)
        const newIntersection = this.pickGlobeSurface(lookFrom, position)
        if (!newIntersection) return adjustedRange
        if (this.sdk.Cartographic.fromCartesian(newIntersection).height <= vehicleHeight + 80) return adjustedRange
        adjustedRange = Math.min(maxRange, adjustedRange * 1.4)
      }
      return maxRange
    } catch {
      return baseRange
    }
  }

  private computeLookAtOrigin(position: any, pitchDeg: number, range: number, heading: number): any {
    const pitchRad = this.sdk.Math.toRadians(pitchDeg)
    return new this.sdk.Cartesian3(
      position.x + Math.sin(heading) * Math.cos(pitchRad) * range,
      position.y - Math.cos(heading) * Math.cos(pitchRad) * range,
      position.z - Math.sin(pitchRad) * range,
    )
  }

  private pickGlobeSurface(lookFrom: any, position: any): any | undefined {
    if (!this.viewer || !this.sdk) return undefined
    const direction = this.sdk.Cartesian3.subtract(position, lookFrom, new this.sdk.Cartesian3())
    const ray = new this.sdk.Ray(lookFrom, this.sdk.Cartesian3.normalize(direction, new this.sdk.Cartesian3()))
    return this.viewer.scene.globe.pick(ray, this.viewer.scene)
  }


  private releaseTourCamera(): void {
    try { this.viewer?.camera?.lookAtTransform?.(this.sdk?.Matrix4?.IDENTITY) } catch { /* viewer may already be destroyed */ }
  }

  private currentTourLegMessage(leg = this.tourLegs.find((item) => {
    if (!this.viewer || !this.tourStartTime) return false
    const seconds = this.sdk.JulianDate.secondsDifference(this.viewer.clock.currentTime, this.tourStartTime)
    return seconds >= item.startSeconds && seconds <= item.endSeconds
  })): string {
    return leg ? `${transportModeMeta[leg.mode].label}前往 ${leg.to.name}` : '沿全程路线漫游中'
  }

  private emitTourState(patch: Partial<MapTourState>): void {
    this.tourState = { ...this.tourState, ...patch, progress: Math.max(0, Math.min(1, patch.progress ?? this.tourState.progress)) }
    this.callbacks?.onTourStateChange?.({ ...this.tourState })
  }

  private isTourActive(): boolean {
    return this.tourState.status === 'opening' || this.tourState.status === 'playing' || this.tourState.status === 'visiting' || this.tourState.status === 'paused'
  }

  private waitForTourDelay(milliseconds: number, token: number): Promise<void> {
    return new Promise((resolve) => window.setTimeout(() => resolve(), token === this.tourToken ? milliseconds : 0))
  }

  async locateCurrentPosition(): Promise<CurrentLocationResult> {
    if (!navigator.geolocation) throw new Error('当前浏览器不支持定位')
    const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12_000, maximumAge: 15_000 }))
    const lng = position.coords.longitude
    const lat = position.coords.latitude
    this.addPickEntity(lng, lat)
    const target = this.sdk.Cartesian3.fromDegrees(lng, lat)
    this.viewer.camera.flyToBoundingSphere(new this.sdk.BoundingSphere(target, 50), { offset: new this.sdk.HeadingPitchRange(0, this.sdk.Math.toRadians(-65), 3500), duration: 0.8 })
    return { lng, lat, crs: 'WGS84', accuracy: position.coords.accuracy, locationType: 'browser' }
  }

  focusPlace(place: Place): void {
    this.pendingFocusPlace = place
    if (!this.viewer || !this.sdk) return
    this.pendingFocusPlace = null
    const target = this.sdk.Cartesian3.fromDegrees(place.lng, place.lat, place.altitude ?? 0)
    this.viewer.camera.flyToBoundingSphere(new this.sdk.BoundingSphere(target, 80), {
      offset: new this.sdk.HeadingPitchRange(0, this.sdk.Math.toRadians(-48), Math.max(2800, (place.altitude ?? 0) + 3500)),
      duration: 0.9,
    })
  }

  setPickMode(enabled: boolean): void {
    this.pickMode = enabled
    if (this.container) this.container.style.cursor = enabled ? 'crosshair' : ''
  }

  setTrafficEnabled(_enabled: boolean): void { /* Cesium renderer intentionally has no traffic layer. */ }

  async setDisplayMode(mode: MapDisplayMode): Promise<void> {
    if (mode !== 'globe') throw new Error('Cesium 仅支持三维地球视角')
  }

  async setSatelliteEnabled(enabled: boolean): Promise<void> {
    this.satelliteEnabled = enabled
    await this.applyImagery(enabled)
  }

  zoomIn(): void { this.viewer?.camera?.zoomIn?.(Math.max(500, this.viewer.camera.positionCartographic.height * 0.22)) }
  zoomOut(): void { this.viewer?.camera?.zoomOut?.(Math.max(500, this.viewer.camera.positionCartographic.height * 0.22)) }
  resize(): void { this.viewer?.resize?.() }

  destroy(): void {
    this.stopTourInternal(false)
    this.routeToken += 1
    this.imageryToken += 1
    this.previewEntityIds = []
    this.segmentRouteCache.clear()
    this.terrainHeightCache.clear()
    this.clearDomOverlays()
    this.removePostRenderListener?.()
    this.removePostRenderListener = null
    this.domOverlayLayer?.remove()
    this.domOverlayLayer = null
    if (this.viewer && !this.viewer.isDestroyed?.()) this.viewer.destroy()
    this.viewer = null
    this.sdk = null
    this.container = null
    this.callbacks = null
    this.services = null
    this.osmBuildings = null
  }

  private async applyImagery(satellite: boolean): Promise<void> {
    if (!this.viewer || !this.sdk) return
    const token = ++this.imageryToken
    try {
      const provider = await this.createImageryProvider(satellite)
      if (token !== this.imageryToken || !this.viewer) return
      this.viewer.imageryLayers.removeAll(true)
      this.viewer.imageryLayers.addImageryProvider(provider)
      this.viewer.scene.requestRender()
    } catch (error) {
      this.callbacks?.onError(error instanceof Error ? error.message : 'Cesium 影像图层切换失败')
    }
  }

  private async createImageryProvider(satellite: boolean): Promise<any> {
    const mode = satellite ? 'world-imagery' : this.config.imageryMode
    if (mode === 'world-imagery' && this.config.ionToken) return this.sdk.createWorldImageryAsync({ style: this.sdk.IonWorldImageryStyle.AERIAL })
    if (mode === 'world-imagery-labels' && this.config.ionToken) return this.sdk.createWorldImageryAsync({ style: this.sdk.IonWorldImageryStyle.AERIAL_WITH_LABELS })
    return this.sdk.TileMapServiceImageryProvider.fromUrl(this.sdk.buildModuleUrl('Assets/Textures/NaturalEarthII'))
  }

  private consumePendingFocus(): boolean {
    const place = this.pendingFocusPlace
    if (!place) return false
    this.focusPlace(place)
    return true
  }

  private fitPlaces(places: Place[]): void {
    this.fitCoordinates(places.map((place) => [place.lng, place.lat]))
  }

  private fitCoordinates(points: Array<[number, number]>): void {
    if (!this.viewer || !this.sdk || !points.length) return
    const positions = points.map(([lng, lat]) => this.sdk.Cartesian3.fromDegrees(lng, lat))
    const sphere = this.sdk.BoundingSphere.fromPoints(positions)
    const range = Math.max(5000, sphere.radius * 2.6)
    this.viewer.camera.flyToBoundingSphere(sphere, {
      offset: new this.sdk.HeadingPitchRange(0, this.sdk.Math.toRadians(-55), range),
      duration: 0.9,
    })
  }
}

import type { CurrentLocationResult, DayRouteOptionRequest, MapCapabilities, MapDisplayMode, MapScene, Place, PlaceDetails, PoiSearchResult, RouteEstimate, RouteOption, RouteOptionRequest, TransportMode } from '../domain/types'
import { projectMapSceneCoordinates, projectPlaceCoordinates, projectRouteOptionCoordinates } from './coordinates'
import type { PlanMapCallbacks, PlanMapDataServices, PlanMapProvider, PlanMapRenderer, PlanPlaceService, PlanRoutingService } from './PlanMapProvider'

export interface PlanMapRuntimeParts {
  renderer: PlanMapRenderer
  places: PlanPlaceService
  routing: PlanRoutingService
}

/** Stable façade consumed by the Vue application. */
export class PlanMapRuntime implements PlanMapProvider {
  renderer: PlanMapRenderer
  places: PlanPlaceService
  routing: PlanRoutingService
  private mountedContainer: HTMLElement | null = null
  private mountedCallbacks: PlanMapCallbacks | null = null
  private pendingScene: MapScene | null = null

  constructor(parts: PlanMapRuntimeParts) {
    this.renderer = parts.renderer
    this.places = parts.places
    this.routing = parts.routing
  }

  get id(): string { return this.renderer.id }
  get capabilities(): MapCapabilities {
    const routingCapabilities = (this.routing as Partial<PlanMapRenderer>).capabilities
    return {
      ...this.renderer.capabilities,
      nativePoiSearch: true,
      nativeRouting: true,
      routeAlternativeModes: routingCapabilities?.routeAlternativeModes ?? [],
    }
  }
  get coordinateSystem() { return this.renderer.capabilities.coordinateSystem }
  get rendererId(): string { return this.renderer.id }
  get placeServiceId(): string { return this.places.id }
  get routingServiceId(): string { return this.routing.id }

  mount(container: HTMLElement, callbacks: PlanMapCallbacks): Promise<void> {
    this.mountedContainer = container
    this.mountedCallbacks = callbacks
    return this.mountRenderer(container, callbacks)
  }

  private mountRenderer(container: HTMLElement, callbacks: PlanMapCallbacks): Promise<void> {
    const rendererCoordinateSystem = this.renderer.capabilities.coordinateSystem
    const services: PlanMapDataServices = {
      places: {
        id: this.places.id,
        coordinateSystem: rendererCoordinateSystem,
        searchPlaces: async (keyword) => (await this.searchPlaces(keyword)).map((place) => projectPlaceCoordinates(place, rendererCoordinateSystem) as PoiSearchResult),
        searchNearbyPlaces: async (center, keyword, radiusMeters) => (await this.searchNearbyPlaces(center, keyword, radiusMeters)).map((place) => projectPlaceCoordinates(place, rendererCoordinateSystem) as PoiSearchResult),
        getPlaceDetails: (place) => this.getPlaceDetails(place),
      },
      routing: {
        id: this.routing.id,
        coordinateSystem: rendererCoordinateSystem,
        estimateRoute: (from, to, mode) => this.estimateRoute(from, to, mode),
        searchRouteOptions: async (request) => (await this.searchRouteOptions(request)).map((option) => projectRouteOptionCoordinates(option, rendererCoordinateSystem)),
        searchDayRouteOptions: async (request) => (await this.searchDayRouteOptions(request)).map((option) => projectRouteOptionCoordinates(option, rendererCoordinateSystem)),
      },
    }
    const rendererCallbacks: PlanMapCallbacks = {
      ...callbacks,
      onMapPick: (result) => callbacks.onMapPick({ ...result, crs: result.crs ?? this.renderer.capabilities.coordinateSystem }),
    }
    return this.renderer.mount(container, rendererCallbacks, services)
  }

  updateScene(scene: MapScene): void {
    this.pendingScene = scene
    this.renderer.updateScene(projectMapSceneCoordinates(scene, this.renderer.capabilities.coordinateSystem))
  }
  previewRouteOptions(options: RouteOption[], selectedId?: string): void {
    this.renderer.previewRouteOptions(options.map((option) => projectRouteOptionCoordinates(option, this.renderer.capabilities.coordinateSystem)), selectedId)
  }
  clearRouteOptionsPreview(): void { this.renderer.clearRouteOptionsPreview() }
  async locateCurrentPosition(): Promise<CurrentLocationResult> {
    const result = await this.renderer.locateCurrentPosition()
    return { ...result, crs: result.crs ?? this.renderer.capabilities.coordinateSystem }
  }
  focusPlace(place: Place): void { this.renderer.focusPlace(projectPlaceCoordinates(place, this.renderer.capabilities.coordinateSystem)) }
  setPickMode(enabled: boolean): void { this.renderer.setPickMode(enabled) }
  setTrafficEnabled(enabled: boolean): void { this.renderer.setTrafficEnabled(enabled) }
  setDisplayMode(mode: MapDisplayMode): Promise<void> { return this.renderer.setDisplayMode(mode) }
  zoomIn(): void { this.renderer.zoomIn() }
  zoomOut(): void { this.renderer.zoomOut() }
  resize(): void { this.renderer.resize() }
  startImmersiveTour(): Promise<void> {
    if (!this.renderer.startImmersiveTour) return Promise.reject(new Error('当前地图引擎不支持沉浸式漫游'))
    return this.renderer.startImmersiveTour()
  }
  pauseImmersiveTour(): void { this.renderer.pauseImmersiveTour?.() }
  resumeImmersiveTour(): void { this.renderer.resumeImmersiveTour?.() }
  stopImmersiveTour(): void { this.renderer.stopImmersiveTour?.() }
  setImmersiveTourSpeed(speed: number): void { this.renderer.setImmersiveTourSpeed?.(speed) }
  setImmersiveTourCameraFollow(enabled: boolean): void { this.renderer.setImmersiveTourCameraFollow?.(enabled) }
  skipTourVisit(): void { this.renderer.skipTourVisit?.() }

  destroy(): void {
    this.renderer.destroy()
    this.mountedContainer = null
    this.mountedCallbacks = null
    this.pendingScene = null
  }

  async replaceParts(parts: PlanMapRuntimeParts): Promise<void> {
    const previous: PlanMapRuntimeParts = { renderer: this.renderer, places: this.places, routing: this.routing }
    const container = this.mountedContainer
    const callbacks = this.mountedCallbacks
    const scene = this.pendingScene
    previous.renderer.destroy()
    this.renderer = parts.renderer
    this.places = parts.places
    this.routing = parts.routing
    try {
      if (container && callbacks) {
        await this.mountRenderer(container, callbacks)
        if (scene) this.renderer.updateScene(projectMapSceneCoordinates(scene, this.renderer.capabilities.coordinateSystem))
      }
    } catch (error) {
      this.renderer.destroy()
      this.renderer = previous.renderer
      this.places = previous.places
      this.routing = previous.routing
      if (container && callbacks) {
        await this.mountRenderer(container, callbacks)
        if (scene) this.renderer.updateScene(projectMapSceneCoordinates(scene, this.renderer.capabilities.coordinateSystem))
      }
      throw error
    }
  }

  searchPlaces(keyword: string): Promise<PoiSearchResult[]> { return this.places.searchPlaces(keyword) }
  searchNearbyPlaces(center: Place, keyword: string, radiusMeters: number): Promise<PoiSearchResult[]> {
    return this.places.searchNearbyPlaces(projectPlaceCoordinates(center, this.places.coordinateSystem), keyword, radiusMeters)
  }
  getPlaceDetails(place: Place): Promise<PlaceDetails | null> {
    return this.places.getPlaceDetails(projectPlaceCoordinates(place, this.places.coordinateSystem))
  }

  estimateRoute(from: Place, to: Place, mode: TransportMode): Promise<RouteEstimate | null> {
    return this.routing.estimateRoute(projectPlaceCoordinates(from, this.routing.coordinateSystem), projectPlaceCoordinates(to, this.routing.coordinateSystem), mode)
  }
  async searchRouteOptions(request: RouteOptionRequest): Promise<RouteOption[]> {
    const options = await this.routing.searchRouteOptions({
      ...request,
      from: projectPlaceCoordinates(request.from, this.routing.coordinateSystem),
      to: projectPlaceCoordinates(request.to, this.routing.coordinateSystem),
    })
    return options.map((option) => ({ ...option, crs: option.crs ?? this.routing.coordinateSystem }))
  }
  async searchDayRouteOptions(request: DayRouteOptionRequest): Promise<RouteOption[]> {
    const options = await this.routing.searchDayRouteOptions({
      ...request,
      places: request.places.map((place) => projectPlaceCoordinates(place, this.routing.coordinateSystem)),
    })
    return options.map((option) => ({ ...option, crs: option.crs ?? this.routing.coordinateSystem }))
  }
}

import type { CoordinateReferenceSystem, CurrentLocationResult, DayRouteOptionRequest, MapCapabilities, MapDisplayMode, MapPickResult, MapScene, Place, PlaceDetails, PoiSearchResult, RouteEstimate, RouteOption, RouteOptionRequest, RouteSummary, TransportMode } from '../domain/types'

export const DEFAULT_MAP_TOUR_SPEED = 0.5

export type MapTourStatus = 'idle' | 'opening' | 'playing' | 'visiting' | 'paused' | 'completed'

export interface MapTourState {
  status: MapTourStatus
  progress: number
  speed: number
  cameraFollow: boolean
  message: string
  currentPlaceId?: string
  currentPlaceName?: string
  fromPlaceName?: string
  toPlaceName?: string
  mode?: TransportMode
  stopIndex: number
  totalStops: number
  visitCountdown: number
  visitTotal: number
}

export interface PlanMapCallbacks {
  onSelectPlace(placeId: string): void
  onSelectRouteSegment(fromId: string, toId: string): void
  onPreviewRouteOption(optionId: string): void
  onRouteSummary(summary: RouteSummary): void
  onRouteSegment(fromId: string, toId: string, mode: TransportMode, km: number, min: number, toll?: number): void
  onMapPickStart(lng: number, lat: number): void
  onMapPick(result: MapPickResult): void
  onError(message: string): void
  onTourStateChange?(state: MapTourState): void
}

export interface PlanPlaceService {
  readonly id: string
  readonly coordinateSystem: CoordinateReferenceSystem
  searchPlaces(keyword: string): Promise<PoiSearchResult[]>
  searchNearbyPlaces(center: Place, keyword: string, radiusMeters: number): Promise<PoiSearchResult[]>
  getPlaceDetails(place: Place): Promise<PlaceDetails | null>
}

export interface PlanRoutingService {
  readonly id: string
  readonly coordinateSystem: CoordinateReferenceSystem
  estimateRoute(from: Place, to: Place, mode: TransportMode): Promise<RouteEstimate | null>
  searchRouteOptions(request: RouteOptionRequest): Promise<RouteOption[]>
  searchDayRouteOptions(request: DayRouteOptionRequest): Promise<RouteOption[]>
}

export interface PlanMapDataServices {
  places: PlanPlaceService
  routing: PlanRoutingService
}

export interface PlanMapRenderer {
  readonly id: string
  readonly capabilities: MapCapabilities
  mount(container: HTMLElement, callbacks: PlanMapCallbacks, services?: PlanMapDataServices): Promise<void>
  updateScene(scene: MapScene): void
  previewRouteOptions(options: RouteOption[], selectedId?: string): void
  clearRouteOptionsPreview(): void
  locateCurrentPosition(): Promise<CurrentLocationResult>
  focusPlace(place: Place): void
  setPickMode(enabled: boolean): void
  setTrafficEnabled(enabled: boolean): void
  setDisplayMode(mode: MapDisplayMode): Promise<void>
  zoomIn(): void
  zoomOut(): void
  resize(): void
  startImmersiveTour?(): Promise<void>
  pauseImmersiveTour?(): void
  resumeImmersiveTour?(): void
  stopImmersiveTour?(): void
  setImmersiveTourSpeed?(speed: number): void
  setImmersiveTourCameraFollow?(enabled: boolean): void
  destroy(): void
  skipTourVisit?(): void
}

/**
 * Compatibility contract for providers such as AMap and Tencent Map that currently
 * supply rendering, POI data and route data from one SDK. Cesium will implement only
 * PlanMapRenderer and will be composed with one of the 2D data-service providers.
 */
export interface PlanMapProvider extends PlanMapRenderer, PlanPlaceService, PlanRoutingService {}

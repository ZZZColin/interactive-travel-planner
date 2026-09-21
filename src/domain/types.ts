export type PlaceCategory =
  | 'attraction'
  | 'food'
  | 'lodging'
  | 'viewpoint'
  | 'culture'
  | 'nature'
  | 'transport'
  | 'shopping'
  | 'other'

export type PlacePriority = 'must' | 'normal' | 'backup'
export type ReservationStatus = 'none' | 'pending' | 'booked' | 'ticketed'
export type TransportTicketStatus = 'none' | 'pending' | 'booked' | 'ticketed' | 'refunded'
export type OvernightMode = 'auto' | 'night-transport' | 'camping' | 'friends' | 'no-lodging'
export type RoutePreference = 'recommended' | 'fastest' | 'shortest' | 'least-toll' | 'avoid-congestion'
export type TransportMode = 'driving' | 'walking' | 'cycling' | 'transit' | 'train' | 'flight' | 'ferry'
export type CoordinateReferenceSystem = 'GCJ02' | 'WGS84' | 'BD09'
export type MapDisplayMode = 'flat' | 'tilted' | 'globe'
export type ExpenseOwnerType = 'plan' | 'day' | 'place' | 'stop' | 'segment'
export type ExpenseCategory = 'ticket' | 'shuttle' | 'cableway' | 'lodging' | 'meal' | 'fuel' | 'charging' | 'toll' | 'parking' | 'flight' | 'train' | 'transit' | 'taxi' | 'ferry' | 'rental' | 'insurance' | 'shopping' | 'other'
export type ExpenseStatus = 'unknown' | 'estimated' | 'confirmed' | 'paid' | 'free'
export type ExpenseSource = 'manual' | 'ai-extracted' | 'map-route' | 'calculated' | 'official' | 'provider'
export type ExpenseBillingUnit = 'group' | 'person' | 'vehicle' | 'room' | 'night' | 'roomNight' | 'kilometer' | 'item'
export type VehicleEnergyType = 'fuel' | 'electric'


export interface ExpenseItem {
  id: string
  ownerType: ExpenseOwnerType
  ownerId: string
  category: ExpenseCategory
  name: string
  quantity: number
  unitPrice: number | null
  minAmount: number | null
  maxAmount: number | null
  billingUnit: ExpenseBillingUnit
  status: ExpenseStatus
  source: ExpenseSource
  transportMode?: TransportMode
  sourceLabel?: string
  quotedAt?: string
  locked?: boolean
  note?: string
  updatedAt: string
}

export interface VehicleCostSettings {
  enabled: boolean
  energyType: VehicleEnergyType
  vehicleCount: number
  consumptionPer100Km: number
  energyUnitPrice: number
  perKmOther: number
  includeMapTolls: boolean
}

export interface BudgetSettings {
  currency: 'CNY'
  limit: number | null
  contingencyRate: number
  vehicle: VehicleCostSettings
}

export interface BudgetState {
  settings: BudgetSettings
  expenses: ExpenseItem[]
}

export interface Place {
  id: string
  name: string
  type: string
  category: PlaceCategory
  priority: PlacePriority
  lng: number
  lat: number
  address?: string
  provider?: 'amap' | 'tencent' | 'google' | 'manual'
  providerId?: string
  cityCode?: string
  adCode?: string
  description?: string
  userNote?: string
  altitude?: number
  openingTime?: number
  lastEntryTime?: number
  closingTime?: number
  reservationRequired?: boolean
  reservationStatus?: ReservationStatus
  reservationNote?: string
  crs: CoordinateReferenceSystem
}

export interface RouteOption {
  id: string
  providerId: string
  providerName: string
  fromPlaceId: string
  toPlaceId: string
  mode: TransportMode
  strategyLabel: string
  distanceKm: number
  durationMinutes: number
  toll?: number
  trafficLightCount?: number
  cost?: number
  transferCount?: number
  walkingDistanceKm?: number
  path: Array<[number, number]>
  crs?: CoordinateReferenceSystem
  queriedAt: string
}

export interface DayRouteOptionRequest {
  places: Place[]
  preference?: RoutePreference
}

export interface RouteOptionRequest {
  from: Place
  to: Place
  mode: TransportMode
  preference?: RoutePreference
  force?: boolean
}

export interface SelectedRouteSnapshot extends Omit<RouteOption, 'path'> {
  encodedPath: string
  selectedAt: string
}

export interface Stop {
  uid: string
  placeId: string
  stay: number
  pinned: number | null
  arrivalTime?: number | null
  departureTime?: number | null
  transportMode?: TransportMode
  transportDuration?: number | null
  transportDistance?: number | null
  transportNumber?: string
  transportFrom?: string
  transportTo?: string
  transportDepartureTime?: number | null
  transportArrivalTime?: number | null
  transportAdvanceMinutes?: number | null
  transportTicketStatus?: TransportTicketStatus
  transportTicketNote?: string
  selectedRoute?: SelectedRouteSnapshot
  routePreference?: RoutePreference
}

export interface TripDay {
  id: string
  label: string
  date: string
  start: number
  end: number
  maxDrive: number
  overnightMode?: OvernightMode
  stops: Stop[]
}

export interface RouteValue {
  km: number
  min: number
  mode?: TransportMode
  source?: 'cache' | 'provider' | 'manual' | 'estimate'
  pending?: boolean
}

export type RouteCache = Record<string, [number, number, number?]>

export interface ScheduleRow {
  arrival: number
  departure: number
  expectedArrival: number
  wait: number
  late: boolean
  conflict: boolean
  conflictMessages: string[]
  route: RouteValue | null
}

export interface DaySchedule {
  rows: ScheduleRow[]
  drive: number
  travel: number
  km: number
  finish: number
  total: number
  warnings: string[]
  ok: boolean
}

export interface PersistedPlannerState {
  schemaVersion?: number
  days: TripDay[]
  selectedDay: string
  selectedPlace: string | null
  poolOpen: boolean
  satellite: boolean
  categoryFilter: PlaceCategory | 'all'
  customPlaces: Record<string, Place>
  known: string[]
  placeAddedAt: Record<string, number>
  demo: number
  budget?: BudgetState
}

export interface PoiSearchResult extends Place {
  address: string
  distanceMeters?: number
}

export interface MapCapabilities {
  dimension: '2D' | '2.5D' | '3D'
  presentation: 'planar' | 'globe'
  coordinateSystem: CoordinateReferenceSystem
  satellite: boolean
  nativePoiSearch: boolean
  nativeRouting: boolean
  traffic: boolean
  mapPicking: boolean
  terrain?: boolean
  threeDTiles?: boolean
  animatedEntities?: boolean
  immersiveTour?: boolean
  displayModes?: MapDisplayMode[]
  routeAlternativeModes?: TransportMode[]
}

export interface MapScene {
  places: Place[]
  days: TripDay[]
  selectedDayId: string
  selectedPlaceId: string | null
  categoryFilter: PlaceCategory | 'all'
  satellite: boolean
  mapMode: 'all' | 'day'
  routeDayIds: string[]
  routeWarning: boolean
  routeWarningDayIds: string[]
  routeCache: RouteCache
  conflictPlaceIds: string[]
}


export interface MapPickResult {
  lng: number
  crs?: CoordinateReferenceSystem
  lat: number
  address: string
  candidates: PoiSearchResult[]
}

export interface RouteSummary {
  km: number
  min: number
  source: 'cache' | 'provider'
}
export interface RouteEstimate {
  km: number
  min: number
  toll?: number
  source: 'provider'
}
export interface TripParticipant {
  id: string
  name: string
  age: number | null
  note?: string
}

export interface PlanMetadata {
  id: string
  name: string
  startAt: string
  endAt: string
  participants: TripParticipant[]
  createdAt: string
  updatedAt: string
}

export interface PlanRecord {
  metadata: PlanMetadata
  plannerState: PersistedPlannerState
  routeCache: RouteCache
}

export interface PlanEditorValue {
  name: string
  startAt: string
  endAt: string
  participants: TripParticipant[]
  budgetLimit: number | null
}
export interface PlaceDetailsPhoto {
  title: string
  url: string
}

export interface PlaceDetails {
  sourceProvider: 'amap' | 'tencent' | 'google'
  providerId: string
  matchedBy: 'provider-id' | 'name-and-location' | 'name-only'
  confidence: 'high' | 'medium'
  name: string
  type: string
  address: string
  telephone?: string
  website?: string
  email?: string
  rating?: string
  openTime?: string
  description?: string
  photos: PlaceDetailsPhoto[]
}
export interface CurrentLocationResult {
  lng: number
  crs?: CoordinateReferenceSystem
  lat: number
  accuracy?: number
  address?: string
  locationType?: string
}

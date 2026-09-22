<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElButton, ElImage, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch, ElTimePicker, ElSkeletonItem, ElTag } from 'element-plus'
import { useFloatingPanel } from '../../composables/useFloatingPanel'
import { expenseCategoryMeta, expenseItemAmountRange, expenseStatusMeta, formatMoney } from '../../domain/budget'
import { categoryMeta } from '../../domain/categories'
import { derivePlaceRisks, highestRiskSeverity, type RiskSeverity } from '../../risk/engine'
import { formatDuration, scheduleDay } from '../../domain/schedule'
import type { ExpenseItem, ExpenseStatus, MapDisplayMode, MapPickResult, MapScene, Place, PlaceCategory, PlaceDetails, PoiSearchResult, ReservationStatus, RouteSummary } from '../../domain/types'
import { mapRendererDefinitions, type MapRendererId } from '../../map/config'
import { DEFAULT_MAP_TOUR_SPEED } from '../../map/PlanMapProvider'
import type { MapTourState } from '../../map/PlanMapProvider'
import { hasActiveMapProviderConfig, hasMapRendererConfig, mapRuntimeState, planMapProvider, switchActiveMapRenderer } from '../../map/provider'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import { useWeatherStore } from '../../stores/weather'
import { planDayDateKey } from '../../weather/types'
import { previousPlanStop } from '../../domain/routeProjection'
import CategoryIcon from '../ui/CategoryIcon.vue'
import { currentLocale } from '../../i18n'

const emit = defineEmits<{ settings: [providerId: MapRendererId, activate?: boolean] }>()

const store = usePlannerStore()
const plans = usePlansStore()
const weatherStore = useWeatherStore()
const mapRoot = ref<HTMLElement | null>(null)
const container = ref<HTMLElement | null>(null)
const configured = computed(() => hasActiveMapProviderConfig())
const loading = ref(configured.value)
const mapBusy = computed(() => loading.value || mapRuntimeState.switching)
const error = ref('')
const routeSummary = ref<RouteSummary | null>(null)
const tourState = ref<MapTourState>({ status: 'idle', progress: 0, speed: DEFAULT_MAP_TOUR_SPEED, cameraFollow: true, message: '', stopIndex: 0, totalStops: 0, visitCountdown: 0, visitTotal: 0 })
const tourSpeedPresets = [0.1, 0.25, 0.5, 1, 2, 4]
const tourSpeedDraft = ref(DEFAULT_MAP_TOUR_SPEED)
const tourPanelCollapsed = ref(false)
const legendExpanded = ref(false)
const trafficEnabled = ref(false)
const activeMapProviderDefinition = computed(() => mapRuntimeState.providerDefinition)
const activeMapRendererDefinition = computed(() => mapRuntimeState.rendererDefinition)
const loadingMapRendererDefinition = computed(() => mapRuntimeState.pendingRendererDefinition ?? mapRuntimeState.rendererDefinition)
const failedMapRendererId = ref<MapRendererId | null>(null)
const errorMapRendererDefinition = computed(() => failedMapRendererId.value ? mapRendererDefinitions[failedMapRendererId.value] : mapRuntimeState.rendererDefinition)
const activeMapRendererId = computed(() => mapRuntimeState.selection.rendererId)
const supportedDisplayModes = computed(() => {
  mapRuntimeState.revision
  return planMapProvider.capabilities.displayModes ?? ['flat' as MapDisplayMode]
})
const providerOptions = Object.values(mapRendererDefinitions).filter((provider) => provider.available)
const displayModeStorageKey = computed(() => { mapRuntimeState.revision; return `interactiveTravel.map.${planMapProvider.id}.displayMode` })
function preferredDisplayMode(): MapDisplayMode {
  const modes = supportedDisplayModes.value
  const stored = localStorage.getItem(displayModeStorageKey.value) as MapDisplayMode | null
  return stored && modes.includes(stored) ? stored : modes[0]
}
const mapDisplayMode = ref<MapDisplayMode>(preferredDisplayMode())
const displayModeChanging = ref(false)
const mapSearchQuery = ref('')
const mapSearchResults = ref<PoiSearchResult[]>([])
const mapSearchLoading = ref(false)
const mapSearchError = ref('')
let mapSearchTimer = 0
let mapSearchToken = 0
const placeDetails = ref<PlaceDetails | null>(null)
const detailsLoading = ref(false)
const locating = ref(false)
const pickMode = ref(false)
const pickLoading = ref(false)
const pickResult = ref<MapPickResult | null>(null)
const pickCandidateId = ref('__manual__')
const pickName = ref('')
const planningInfoOpen = ref(false)
const placeNoteDraft = ref('')
const placeAltitudeDraft = ref<number | null>(null)
const openingTimeDraft = ref<Date | null>(null)
const lastEntryTimeDraft = ref<Date | null>(null)
const closingTimeDraft = ref<Date | null>(null)
const reservationRequiredDraft = ref(false)
const reservationStatusDraft = ref<ReservationStatus>('none')
const reservationNoteDraft = ref('')
const nearbyOpen = ref(false)
const nearbyKeyword = ref('酒店')
const nearbyRadius = ref(3000)
const nearbyLoading = ref(false)
const nearbyError = ref('')
const nearbyResults = ref<PoiSearchResult[]>([])
const nearbyPresets = [
  { label: '住宿', keyword: '酒店' },
  { label: '美食', keyword: '餐饮' },
  { label: '景点', keyword: '景点' },
  { label: '停车', keyword: '停车场' },
  { label: '购物', keyword: '超市' },
]
let nearbyToken = 0
let detailsToken = 0
const routePanel = useFloatingPanel(mapRoot, { top: 18, right: 20 })
const placePanel = useFloatingPanel(mapRoot, { top: 178, right: 20 })
const categories: Array<PlaceCategory | 'all'> = ['all', 'attraction', 'food', 'lodging', 'viewpoint', 'culture', 'nature', 'transport', 'shopping']
let updateTimer = 0
let mapResizeObserver: ResizeObserver | null = null
const mapLayoutTimers: number[] = []

const routeDays = computed(() => store.days.filter((day) => day.stops.length))
const routeDaySchedules = computed(() => routeDays.value.map((day) => ({ day, schedule: scheduleDay(day, store.places, store.routeCache, previousPlanStop(store.days, day.id)) })))

const scene = computed<MapScene>(() => ({
  places: Object.values(store.places).filter((place) => store.known.includes(place.id)),
  days: store.days,
  selectedDayId: store.selectedDayId,
  selectedPlaceId: store.selectedPlaceId,
  categoryFilter: store.categoryFilter,
  satellite: store.satellite,
  mapMode: 'all',
  routeDayIds: routeDays.value.map((day) => day.id),
  routeWarning: routeDaySchedules.value.some(({ schedule }) => !schedule.ok),
  routeWarningDayIds: routeDaySchedules.value.filter(({ schedule }) => !schedule.ok).map(({ day }) => day.id),
  routeCache: store.routeCache,
  conflictPlaceIds: routeDaySchedules.value.flatMap(({ day, schedule }) => day.stops
    .filter((_, index) => schedule.rows[index]?.conflict)
    .map((stop) => stop.placeId)),
}))

const activeSummary = computed(() => routeSummary.value ?? {
  km: routeDaySchedules.value.reduce((sum, item) => sum + item.schedule.km, 0),
  min: routeDaySchedules.value.reduce((sum, item) => sum + item.schedule.travel, 0),
  source: 'cache' as const,
})
const routeScopeTitle = computed(() => '全程路线')
const routeScopeDetail = computed(() => routeDays.value.length
  ? `${routeDays.value[0].label} → ${routeDays.value[routeDays.value.length - 1].label} · ${routeDays.value.length} 天`
  : '尚未安排地点')

const selectedPlace = computed(() => store.selectedPlaceId ? store.places[store.selectedPlaceId] : null)
const selectedPlaceStop = computed(() => selectedPlace.value ? store.locatePlaceStop(selectedPlace.value.id) : null)
const selectedPlaceStops = computed(() => selectedPlace.value ? store.days.flatMap((day) => day.stops.filter((stop) => stop.placeId === selectedPlace.value!.id).map((stop) => ({ day, stop }))) : [])
function minutesToDate(minutes?: number): Date | null {
  if (minutes == null) return null
  const value = new Date(2000, 0, 1, 0, 0, 0, 0)
  value.setHours(Math.floor(minutes / 60), minutes % 60)
  return value
}
function dateToMinutes(value: Date | null): number | undefined { return value ? value.getHours() * 60 + value.getMinutes() : undefined }

watch(() => selectedPlace.value?.id, () => {
  planningInfoOpen.value = false
  placeNoteDraft.value = selectedPlace.value?.userNote ?? ''
  placeAltitudeDraft.value = selectedPlace.value?.altitude ?? null
  openingTimeDraft.value = minutesToDate(selectedPlace.value?.openingTime)
  lastEntryTimeDraft.value = minutesToDate(selectedPlace.value?.lastEntryTime)
  closingTimeDraft.value = minutesToDate(selectedPlace.value?.closingTime)
  reservationRequiredDraft.value = Boolean(selectedPlace.value?.reservationRequired)
  reservationStatusDraft.value = selectedPlace.value?.reservationStatus ?? 'none'
  reservationNoteDraft.value = selectedPlace.value?.reservationNote ?? ''
  nearbyToken += 1
  nearbyOpen.value = false
  nearbyLoading.value = false
  nearbyError.value = ''
  nearbyResults.value = []
  nearbyKeyword.value = '酒店'
  nearbyRadius.value = 3000
})

function savePlacePlanningInfo(): void {
  if (store.readOnly) return
  if (!selectedPlace.value) return
  store.updatePlacePlanningInfo(selectedPlace.value.id, placeNoteDraft.value, placeAltitudeDraft.value, { openingTime: dateToMinutes(openingTimeDraft.value), lastEntryTime: dateToMinutes(lastEntryTimeDraft.value), closingTime: dateToMinutes(closingTimeDraft.value), reservationRequired: reservationRequiredDraft.value, reservationStatus: reservationStatusDraft.value, reservationNote: reservationNoteDraft.value })
  planningInfoOpen.value = false
}
const selectedPlaceExpenseRows = computed(() => {
  const place = selectedPlace.value
  if (!place) return []
  const rows: Array<{ item: ExpenseItem; context: string }> = []
  store.expensesForOwner('place', place.id).forEach((item) => rows.push({ item, context: selectedPlaceStop.value ? '地点费用草稿' : '未安排地点' }))
  store.days.forEach((day) => {
    day.stops.filter((stop) => stop.placeId === place.id).forEach((stop) => {
      store.expensesForOwner('stop', stop.uid).forEach((item) => rows.push({ item, context: day.label }))
    })
  })
  return rows
})
const selectedPlaceExpenseTotal = computed(() => selectedPlaceExpenseRows.value.reduce((sum, row) => sum + (expenseItemAmountRange(row.item)?.expected ?? 0), 0))
const selectedPlaceUnknownExpenseCount = computed(() => selectedPlaceExpenseRows.value.filter((row) => expenseItemAmountRange(row.item) == null).length)
const selectedPlaceRiskRows = computed(() => {
  const place = selectedPlace.value
  const startAt = plans.activePlan?.metadata.startAt
  if (!place || !startAt) return []
  return store.days.flatMap((day) => {
    const date = planDayDateKey(startAt, store.days, day.id)
    const weather = weatherStore.weatherFor(place.id, date)
    return day.stops.filter((stop) => stop.placeId === place.id).flatMap(() => derivePlaceRisks(place, date, weather, weatherStore.alertsFor(place.id)).map((risk) => ({ risk, context: day.label })))
  })
})
const selectedPlaceRiskSeverity = computed(() => highestRiskSeverity(selectedPlaceRiskRows.value.map((row) => row.risk)))
const placePhotoUrls = computed(() => placeDetails.value?.photos.map((photo) => photo.url).filter(Boolean) ?? [])
const selectedPickCandidate = computed(() => pickResult.value?.candidates.find((item) => item.id === pickCandidateId.value) ?? null)

function mapSourceLabel(source: PlaceDetails['sourceProvider']): string {
  return source === 'tencent' ? '腾讯地图' : source === 'google' ? 'Google Maps' : '高德地图'
}

const placeIntroduction = computed(() => {
  const details = placeDetails.value
  if (!details) return ''
  const types = [...new Set(details.type.split(';').filter(Boolean))]
  const typeText = types.slice(-2).join(' / ')
  if (details.description) return details.description
  const parts = [`${details.name}在${mapSourceLabel(details.sourceProvider)}中归类为${typeText || '地点'}`]
  if (details.address) parts.push(`地址为${details.address}`)
  return `${parts.join('，')}。`
})

function riskSeverityLabel(severity: RiskSeverity): string {
  return ({ info: '提示', attention: '注意', warning: '警告', critical: '严重' })[severity]
}

function riskTagType(severity: RiskSeverity | null): 'info' | 'warning' | 'danger' {
  return severity === 'critical' ? 'danger' : severity === 'warning' || severity === 'attention' ? 'warning' : 'info'
}

function expenseStatusType(status: ExpenseStatus): 'success' | 'warning' | 'info' | 'primary' | 'danger' {
  if (status === 'paid') return 'success'
  if (status === 'confirmed') return 'primary'
  if (status === 'unknown') return 'danger'
  if (status === 'free') return 'info'
  return 'warning'
}

function expenseSourceText(item: ExpenseItem): string {
  if (item.sourceLabel) return item.sourceLabel
  return ({ manual: '用户录入', 'ai-extracted': 'AI 提取，待人工核对', 'map-route': '地图路线估算', calculated: '自动计算', official: '官方来源', provider: '报价服务' })[item.source]
}

function expenseAmountText(item: ExpenseItem): string {
  if (item.status === 'free') return '免费'
  const amount = expenseItemAmountRange(item)
  if (!amount) return '待核价'
  return amount.min === amount.max ? formatMoney(amount.expected) : `${formatMoney(amount.min)}～${formatMoney(amount.max)}`
}

async function loadSelectedPlaceDetails(): Promise<void> {
  const place = selectedPlace.value
  const token = ++detailsToken
  placeDetails.value = null
  if (!configured.value || !place) return
  detailsLoading.value = true
  try {
    const details = await planMapProvider.getPlaceDetails(place)
    if (token !== detailsToken) return
    placeDetails.value = details
  } catch {
    if (token !== detailsToken) return
  } finally {
    if (token === detailsToken) detailsLoading.value = false
  }
}

function scheduleUpdate(): void {
  if (!configured.value) return
  window.clearTimeout(updateTimer)
  updateTimer = window.setTimeout(() => {
    routeSummary.value = null
    planMapProvider.updateScene(scene.value)
  }, 40)
}

onMounted(async () => {
  if (!configured.value || !container.value) { loading.value = false; return }
  if (typeof ResizeObserver !== 'undefined') {
    mapResizeObserver = new ResizeObserver(() => planMapProvider.resize())
    mapResizeObserver.observe(container.value)
  }
  try {
    await planMapProvider.setDisplayMode(mapDisplayMode.value)
    await planMapProvider.mount(container.value, {
      onSelectPlace: (placeId) => store.selectPlace(placeId),
      onPreviewRouteOption: (optionId) => store.setPreviewRouteOption(optionId),
      onSelectRouteSegment: (fromId, toId) => {
        for (const day of store.days) {
          const index = day.stops.findIndex((stop, stopIndex) => stop.placeId === fromId && day.stops[stopIndex + 1]?.placeId === toId)
          if (index >= 0) { store.selectSegment(day.stops[index].uid); break }
        }
      },
      onRouteSummary: (summary) => { routeSummary.value = summary },
      onRouteSegment: (fromId, toId, mode, km, min, toll) => store.setRouteValue(fromId, toId, mode, km, min, toll),
      onMapPickStart: () => {
        pickLoading.value = true
        pickResult.value = null
      },
      onMapPick: (result) => {
        pickLoading.value = false
        pickResult.value = result
        pickCandidateId.value = result.candidates[0]?.id ?? '__manual__'
        pickName.value = result.candidates[0]?.name ?? result.address.split(/[·省市区县]/).filter(Boolean).pop() ?? '地图选点'
      },
      onError: (message) => store.notify(message),
      onTourStateChange: (state) => { tourState.value = state; tourSpeedDraft.value = state.speed },
    })
    loading.value = false
    planMapProvider.updateScene(scene.value)
    await nextTick()
    planMapProvider.resize()
    mapLayoutTimers.push(window.setTimeout(() => planMapProvider.resize(), 120))
    mapLayoutTimers.push(window.setTimeout(() => planMapProvider.resize(), 360))
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : `${activeMapProviderDefinition.value.name}加载失败`
    loading.value = false
  }
})

watch(scene, scheduleUpdate, { deep: true })
watch(() => store.selectedPlaceId, () => {
  placePanel.reset()
  loadSelectedPlaceDetails()
})
watch(selectedPickCandidate, (candidate) => {
  if (candidate) pickName.value = candidate.name
})

watch(() => mapRuntimeState.revision, async () => {
  mapDisplayMode.value = preferredDisplayMode()
  routeSummary.value = null
  tourState.value = { status: 'idle', progress: 0, speed: tourState.value.speed, cameraFollow: tourState.value.cameraFollow, message: '', stopIndex: 0, totalStops: 0, visitCountdown: 0, visitTotal: 0 }
  trafficEnabled.value = false
  pickMode.value = false
  pickResult.value = null
  error.value = ''
  try {
    await planMapProvider.setDisplayMode(mapDisplayMode.value)
    planMapProvider.updateScene(scene.value)
    await loadSelectedPlaceDetails()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '地图引擎初始化失败'
  }
})

onBeforeUnmount(() => {
  window.clearTimeout(updateTimer)
  window.clearTimeout(mapSearchTimer)
  mapResizeObserver?.disconnect()
  mapResizeObserver = null
  mapLayoutTimers.splice(0).forEach((timer) => window.clearTimeout(timer))
  planMapProvider.setPickMode(false)
  planMapProvider.destroy()
})

function scheduleMapSearch(): void {
  window.clearTimeout(mapSearchTimer)
  const query = mapSearchQuery.value.trim()
  if (query.length < 2) {
    mapSearchResults.value = []
    mapSearchError.value = ''
    return
  }
  mapSearchTimer = window.setTimeout(() => { void runMapSearch() }, 320)
}

async function runMapSearch(): Promise<void> {
  const query = mapSearchQuery.value.trim()
  if (!configured.value || query.length < 2) return
  const token = ++mapSearchToken
  mapSearchLoading.value = true
  mapSearchError.value = ''
  try {
    const results = await planMapProvider.searchPlaces(query)
    if (token !== mapSearchToken) return
    mapSearchResults.value = results
    if (!results.length) mapSearchError.value = `没有找到“${query}”`
  } catch (reason) {
    if (token !== mapSearchToken) return
    mapSearchResults.value = []
    mapSearchError.value = reason instanceof Error ? reason.message : '地点搜索失败'
  } finally {
    if (token === mapSearchToken) mapSearchLoading.value = false
  }
}

function clearMapSearch(): void {
  mapSearchQuery.value = ''
  mapSearchResults.value = []
  mapSearchError.value = ''
  mapSearchToken += 1
}

function addMapSearchResult(place: PoiSearchResult, target: 'day' | 'pool'): void {
  if (store.readOnly) return
  store.addPickedPlace(place, target === 'day' ? store.selectedDayId : null)
  planMapProvider.focusPlace(place)
  clearMapSearch()
}

function toggleTraffic(): void {
  trafficEnabled.value = !trafficEnabled.value
  planMapProvider.setTrafficEnabled(trafficEnabled.value)
}

async function setMapDisplayMode(mode: MapDisplayMode): Promise<void> {
  if (displayModeChanging.value || mapDisplayMode.value === mode || !supportedDisplayModes.value.includes(mode)) return
  const previous = mapDisplayMode.value
  mapDisplayMode.value = mode
  displayModeChanging.value = true
  routeSummary.value = null
  try {
    await planMapProvider.setDisplayMode(mode)
    localStorage.setItem(displayModeStorageKey.value, mode)
    store.notify(mode === 'tilted' ? `已切换到${activeMapProviderDefinition.value.shortName} 2.5D 立体视角` : `已切换到${activeMapProviderDefinition.value.shortName} 2D 平面视角`)
  } catch (reason) {
    mapDisplayMode.value = previous
    store.notify(reason instanceof Error ? reason.message : '地图视角切换失败')
  } finally {
    displayModeChanging.value = false
  }
}

async function selectMapRenderer(rendererId: MapRendererId): Promise<void> {
  if (rendererId === activeMapRendererId.value || mapRuntimeState.switching) return
  if (!hasMapRendererConfig(rendererId)) {
    emit('settings', rendererId, true)
    return
  }
  planMapProvider.stopImmersiveTour()
  tourState.value = { status: 'idle', progress: 0, speed: tourState.value.speed, cameraFollow: tourState.value.cameraFollow, message: '', stopIndex: 0, totalStops: 0, visitCountdown: 0, visitTotal: 0 }
  loading.value = true
  error.value = ''
  failedMapRendererId.value = null
  routeSummary.value = null
  pickMode.value = false
  pickResult.value = null
  trafficEnabled.value = false
  clearMapSearch()
  try {
    await switchActiveMapRenderer(rendererId)
    mapDisplayMode.value = preferredDisplayMode()
    await planMapProvider.setDisplayMode(mapDisplayMode.value)
    store.notify(`已临时切换到${mapRuntimeState.rendererDefinition.name}，首页默认地图方案未改变`)
  } catch (reason) {
    failedMapRendererId.value = rendererId
    const message = reason instanceof Error ? reason.message : '地图引擎切换失败'
    error.value = ''
    store.notify(`${message}，已保留${mapRuntimeState.rendererDefinition.name}`)
  } finally {
    loading.value = false
  }
}

async function startImmersiveTour(): Promise<void> {
  try { await planMapProvider.startImmersiveTour() }
  catch (reason) { store.notify(reason instanceof Error ? reason.message : '沉浸式路线漫游启动失败') }
}

function toggleImmersiveTour(): void {
  if (tourState.value.status === 'paused') planMapProvider.resumeImmersiveTour()
  else if (tourState.value.status === 'playing' || tourState.value.status === 'visiting' || tourState.value.status === 'opening') planMapProvider.pauseImmersiveTour()
  else void startImmersiveTour()
}

function stopImmersiveTour(): void {
  planMapProvider.stopImmersiveTour()
}

function setImmersiveTourSpeed(speed: number): void {
  const normalized = Math.max(0.05, Math.min(8, Math.round(speed * 100) / 100))
  tourSpeedDraft.value = normalized
  planMapProvider.setImmersiveTourSpeed(normalized)
}

function skipTourVisit(): void {
  planMapProvider.skipTourVisit()
}

function setTourCameraFollow(enabled: boolean): void {
  planMapProvider.setImmersiveTourCameraFollow(enabled)
}


function applyCustomTourSpeed(value: number | undefined): void {
  if (value == null || !Number.isFinite(value)) return
  setImmersiveTourSpeed(value)
}

function selectCategory(category: PlaceCategory | 'all'): void {
  store.categoryFilter = category
}

function togglePickMode(): void {
  if (!configured.value || mapBusy.value || error.value || store.readOnly) return
  pickMode.value = !pickMode.value
  pickLoading.value = false
  pickResult.value = null
  planMapProvider.setPickMode(pickMode.value)
}

function cancelPick(): void {
  pickMode.value = false
  pickLoading.value = false
  pickResult.value = null
  planMapProvider.setPickMode(false)
}

function buildPickedPlace(): Place | null {
  const result = pickResult.value
  const name = pickName.value.trim()
  if (!result || !name) return null
  const candidate = selectedPickCandidate.value
  if (candidate) return { ...candidate, name }
  return {
    id: `manual_pick_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    name,
    type: '地图选点',
    category: 'other',
    priority: 'normal',
    lng: result.lng,
    lat: result.lat,
    address: result.address,
    provider: 'manual',
    crs: result.crs ?? planMapProvider.capabilities.coordinateSystem,
  }
}

function addPickedPlace(targetDayId: string | null): void {
  if (store.readOnly) return
  const place = buildPickedPlace()
  if (!place) return
  store.addPickedPlace(place, targetDayId)
  cancelPick()
}

function nearbyKnownPlace(place: PoiSearchResult): Place | null {
  return Object.values(store.places).find((item) =>
    (place.providerId && item.providerId === place.providerId)
    || (item.name === place.name && Math.hypot(item.lng - place.lng, item.lat - place.lat) < 0.002)) ?? null
}

function nearbyAlreadyCollected(place: PoiSearchResult): boolean {
  const known = nearbyKnownPlace(place)
  return Boolean(known && store.known.includes(known.id))
}

function nearbyAlreadyInSelectedDay(place: PoiSearchResult): boolean {
  const known = nearbyKnownPlace(place)
  return Boolean(known && store.selectedDay.stops.some((stop) => stop.placeId === known.id))
}

function nearbyDistanceText(place: PoiSearchResult): string {
  if (place.distanceMeters == null) return ''
  if (place.distanceMeters < 1000) return `${place.distanceMeters} 米`
  return `${(place.distanceMeters / 1000).toFixed(place.distanceMeters < 10_000 ? 1 : 0)} 公里`
}

async function searchNearby(keyword = nearbyKeyword.value): Promise<void> {
  const center = selectedPlace.value
  const query = keyword.trim()
  if (!center || !query) return
  nearbyKeyword.value = query
  const token = ++nearbyToken
  nearbyLoading.value = true
  nearbyError.value = ''
  try {
    const results = await planMapProvider.searchNearbyPlaces(center, query, nearbyRadius.value)
    if (token !== nearbyToken) return
    nearbyResults.value = results
    if (!results.length) nearbyError.value = `附近 ${nearbyRadius.value / 1000} 公里内没有找到“${query}”`
  } catch (reason) {
    if (token !== nearbyToken) return
    nearbyResults.value = []
    nearbyError.value = reason instanceof Error ? reason.message : '周边地点搜索失败'
  } finally {
    if (token === nearbyToken) nearbyLoading.value = false
  }
}

function toggleNearbySearch(): void {
  nearbyOpen.value = !nearbyOpen.value
  if (nearbyOpen.value && !nearbyResults.value.length && !nearbyLoading.value) void searchNearby()
}

function useNearbyPreset(keyword: string): void {
  nearbyKeyword.value = keyword
  void searchNearby(keyword)
}

function addNearbyPlace(place: PoiSearchResult, targetDayId: string | null): void {
  if (store.readOnly) return
  const { distanceMeters: _distanceMeters, ...savedPlace } = place
  store.addPickedPlace(savedPlace, targetDayId, false)
}

async function locateCurrentPosition(): Promise<void> {
  if (!configured.value || mapBusy.value || error.value || locating.value) return
  locating.value = true
  try {
    const location = await planMapProvider.locateCurrentPosition()
    const accuracyText = location.accuracy ? `（精度约 ${Math.round(location.accuracy)} 米）` : ''
    store.notify(location.address
      ? `已定位到当前位置：${location.address}${accuracyText}`
      : `已定位到当前位置${accuracyText}`)
  } catch (reason) {
    store.notify(reason instanceof Error ? reason.message : '当前位置定位失败，请稍后重试')
  } finally {
    locating.value = false
  }
}
</script>

<template>
  <section ref="mapRoot" class="map">
    <div ref="container" class="amap-container" :class="`map-provider-${activeMapRendererId}`" />

    <div v-if="!configured" class="map-config-empty">
      <div class="map-config-empty-icon">⌖</div>
      <h2>配置{{ activeMapRendererDefinition.name }}后开始规划</h2>
      <p>{{ activeMapRendererDefinition.name }}需要完成独立配置。配置只保存在当前浏览器，不会内置到项目中。</p>
      <div class="map-config-engine-switch"><button v-for="provider in providerOptions" :key="provider.id" :class="{ active: provider.id === activeMapRendererId }" @click="provider.id === activeMapRendererId ? emit('settings', provider.id) : selectMapRenderer(provider.id)"><i>{{ provider.logo }}</i>{{ provider.name }}</button></div>
      <button class="primarybtn" @click="emit('settings', activeMapRendererId)">配置{{ activeMapRendererDefinition.name }}</button>
    </div>

    <div v-else-if="mapBusy" class="amap-loading">
      <div class="amap-loading-card">正在加载{{ loadingMapRendererDefinition.name }}与路线服务…</div>
    </div>
    <div v-else-if="error" class="amap-error">
      <h3>{{ errorMapRendererDefinition.name }}暂未加载</h3>
      <p>{{ error }}</p>
      <div class="amap-error-actions">
        <button class="primarybtn" @click="emit('settings', errorMapRendererDefinition.id)">检查{{ errorMapRendererDefinition.shortName }}配置</button>
      </div>
    </div>

    <div class="maptop">
      <div class="mapcontrol">
        <ElSelect :model-value="activeMapRendererId" class="map-provider-select" size="small" popper-class="map-provider-options" aria-label="地图引擎" @change="selectMapRenderer($event as MapRendererId)">
          <ElOption v-for="provider in providerOptions" :key="provider.id" :label="provider.shortName" :value="provider.id"><span :class="[`map-provider-option`, `provider-${provider.id}`]"><i>{{ provider.logo }}</i><b>{{ provider.name }}</b><small>{{ provider.description }}</small></span></ElOption>
        </ElSelect>
        <div class="map-poi-search" @click.stop>
          <ElInput v-model="mapSearchQuery" class="map-poi-search-input" placeholder="搜索地点、酒店或美食" clearable :disabled="!configured || mapBusy || Boolean(error)" @input="scheduleMapSearch" @clear="clearMapSearch" @keyup.enter="runMapSearch"><template #prefix><i class="pi pi-search" /></template></ElInput>
          <div v-if="mapSearchQuery.trim().length >= 2" class="map-search-results">
            <div v-if="mapSearchLoading" class="map-search-message"><span class="poi-spinner" />正在搜索“{{ mapSearchQuery.trim() }}”…</div>
            <template v-else-if="mapSearchResults.length">
              <div v-for="place in mapSearchResults" :key="place.id" class="map-search-result">
                <CategoryIcon :category="place.category" />
                <span><b>{{ place.name }}</b><small>{{ place.address || place.type }}</small></span>
                <div class="map-search-result-actions">
                  <button type="button" class="secondary" :disabled="store.readOnly" @click="addMapSearchResult(place, 'pool')">加入未安排</button>
                  <button type="button" class="primary" :disabled="store.readOnly" @click="addMapSearchResult(place, 'day')">加入当天</button>
                </div>
              </div>
            </template>
            <div v-else class="map-search-message"><i class="pi pi-info-circle" />{{ mapSearchError || '输入更完整的地点名称' }}</div>
          </div>
        </div>
        <button v-if="planMapProvider.capabilities.satellite" :class="{ active: store.satellite }" @click="store.satellite = !store.satellite">卫星图</button>
        <span v-if="supportedDisplayModes.length > 1" class="map-view-mode-switch" aria-label="地图视角">
          <button :class="{ active: mapDisplayMode === 'flat' }" :disabled="displayModeChanging" title="2D 平面视角" @click="setMapDisplayMode('flat')">2D</button>
          <button :class="{ active: mapDisplayMode === 'tilted' }" :disabled="displayModeChanging" title="2.5D 立体视角" @click="setMapDisplayMode('tilted')">2.5D</button>
        </span>
        <button v-if="planMapProvider.capabilities.traffic" class="map-traffic-button" :class="{ active: trafficEnabled }" :disabled="!configured || mapBusy || Boolean(error)" @click="toggleTraffic"><i class="pi pi-car" />路况</button>
        <button
          class="map-location-button"
          :class="{ locating }"
          :disabled="!configured || mapBusy || Boolean(error) || locating"
          aria-label="定位当前位置"
          :title="locating ? '正在定位当前位置' : '定位当前位置'"
          @click="locateCurrentPosition"
        >
          <i :class="locating ? 'pi pi-spinner pi-spin' : 'pi pi-compass'" />
        </button>
        <button
          class="map-pick-button"
          :class="{ active: pickMode }"
          :disabled="!configured || mapBusy || Boolean(error) || store.readOnly"
          title="从地图拾取地点"
          aria-label="从地图拾取地点"
          @click="togglePickMode"
        ><i class="pi pi-map-marker" /><span>拾取</span></button>
        <button v-if="planMapProvider.capabilities.immersiveTour" class="map-tour-button" :class="{ active: tourState.status !== 'idle' && tourState.status !== 'completed' }" :disabled="!configured || mapBusy || Boolean(error)" title="沉浸式路线漫游" @click="toggleImmersiveTour"><i :class="tourState.status === 'paused' ? 'pi pi-play' : tourState.status === 'playing' || tourState.status === 'visiting' || tourState.status === 'opening' ? 'pi pi-pause' : 'pi pi-video'" /><span>{{ tourState.status === 'paused' ? '继续' : tourState.status === 'playing' || tourState.status === 'visiting' || tourState.status === 'opening' ? '暂停' : tourState.status === 'completed' ? '重播' : '漫游' }}</span></button>
        <button class="map-config-icon-button" :title="`配置${activeMapRendererDefinition.name}`" :aria-label="`配置${activeMapRendererDefinition.name}`" @click="emit('settings', activeMapRendererId)"><i class="pi pi-cog" /></button>
        <span class="map-control-divider" />
        <button class="map-zoom-button" title="缩小地图" @click="planMapProvider.zoomOut">−</button>
        <button class="map-zoom-button" title="放大地图" @click="planMapProvider.zoomIn">＋</button>
      </div>
    </div>

    <section
      v-if="tourState.status !== 'idle'"
      class="cesium-tour-panel"
      :class="[`status-${tourState.status}`, { collapsed: tourPanelCollapsed }]"
    >
      <header class="cesium-tour-panel-header">
        <span class="cesium-tour-panel-icon" :class="`mode-${tourState.mode || 'driving'}`">
          <i :class="tourState.status === 'visiting' ? 'pi pi-map-marker' : tourState.mode === 'walking' ? 'pi pi-user' : tourState.mode === 'cycling' ? 'pi pi-bicycle' : tourState.mode === 'flight' ? 'pi pi-send' : tourState.mode === 'train' ? 'pi pi-table' : tourState.mode === 'ferry' ? 'pi pi-ship' : 'pi pi-car'" />
        </span>
        <div class="cesium-tour-panel-summary">
          <b>{{ tourState.status === 'opening' ? '正在准备漫游' : tourState.status === 'visiting' ? `抵达 ${tourState.currentPlaceName || '途经地点'}` : tourState.status === 'paused' ? '漫游已暂停' : tourState.status === 'completed' ? '漫游已完成' : `${tourState.fromPlaceName || '当前位置'} → ${tourState.toPlaceName || '下一站'}` }}</b>
          <small>{{ tourState.message || '沿计划路线播放交通工具与地点进度' }}</small>
        </div>
        <button
          type="button"
          class="cesium-tour-collapse-button"
          :title="tourPanelCollapsed ? '展开漫游控制' : '向下折叠漫游控制'"
          :aria-label="tourPanelCollapsed ? '展开漫游控制' : '折叠漫游控制'"
          @click="tourPanelCollapsed = !tourPanelCollapsed"
        ><i :class="tourPanelCollapsed ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" /></button>
      </header>

      <div class="cesium-tour-progress"><span :style="{ width: `${Math.round(tourState.progress * 100)}%` }" /></div>

      <div v-show="!tourPanelCollapsed" class="cesium-tour-context">
        <span v-if="tourState.fromPlaceName && tourState.toPlaceName"><i class="pi pi-directions" />{{ tourState.fromPlaceName }} → {{ tourState.toPlaceName }}</span>
        <span v-if="tourState.currentPlaceName"><i class="pi pi-map-marker" />{{ tourState.currentPlaceName }}</span>
        <span v-if="tourState.totalStops"><i class="pi pi-list" />{{ tourState.stopIndex }} / {{ tourState.totalStops }} 站</span>
        <span v-if="tourState.status === 'visiting' && tourState.visitCountdown > 0" class="cesium-tour-countdown"><i class="pi pi-hourglass" />{{ tourState.visitCountdown }}s</span>
      </div>

      <footer v-show="!tourPanelCollapsed">
        <div class="cesium-tour-speed-control">
          <span>漫游速度</span>
          <div class="cesium-tour-speeds"><button v-for="speed in tourSpeedPresets" :key="speed" :class="{ active: tourState.speed === speed }" :title="`${speed} 倍速`" @click="setImmersiveTourSpeed(speed)">{{ speed }}×</button></div>
          <label class="cesium-tour-custom-speed"><em>自定义</em><ElInputNumber v-model="tourSpeedDraft" aria-label="自定义漫游速度" :min="0.05" :max="8" :step="0.05" :precision="2" controls-position="right" size="small" @change="applyCustomTourSpeed" /><b>×</b></label>
          <label class="cesium-tour-camera-follow" title="关闭后交通工具和地点进度继续移动，地图视角保持不变"><span><i class="pi pi-video" />自动视角</span><ElSwitch :model-value="tourState.cameraFollow" size="small" @change="setTourCameraFollow(Boolean($event))" /></label>
        </div>
        <div class="cesium-tour-actions">
          <ElButton size="small" type="primary" @click="toggleImmersiveTour"><i :class="tourState.status === 'paused' || tourState.status === 'completed' ? 'pi pi-play' : 'pi pi-pause'" />{{ tourState.status === 'paused' ? '继续' : tourState.status === 'completed' ? '重新漫游' : '暂停' }}</ElButton>
          <ElButton v-if="tourState.status === 'visiting'" size="small" type="warning" @click="skipTourVisit"><i class="pi pi-forward" />跳过</ElButton>
          <ElButton size="small" @click="stopImmersiveTour"><i class="pi pi-stop" />退出</ElButton>
        </div>
      </footer>
    </section>

    <div
      v-if="configured"
      class="mapsummary floating-map-panel floating-route-summary"
      :class="{ compact: Boolean(selectedPlace) }"
      :style="routePanel.style.value"
      title="拖动调整位置"
      @pointerdown="routePanel.start"
    >
      <span class="floating-panel-grip">⠿</span>
      <div class="eyebrow">{{ routeScopeTitle }}</div>
      <div class="big">{{ activeSummary.km }} km · {{ formatDuration(activeSummary.min) }}</div>
      <div class="small">{{ routeScopeDetail }}</div>
    </div>

    <div v-if="configured && pickMode" class="map-pick-workspace">
      <div v-if="!pickResult && !pickLoading" class="map-pick-hint"><i class="pi pi-map-marker" /><span>点击地图任意位置，获取附近{{ activeMapProviderDefinition.shortName }}地点</span><button @click="cancelPick">退出</button></div>
      <div v-else-if="pickLoading" class="map-pick-loading"><span class="poi-spinner" />正在识别点击位置附近的地点…</div>
      <div v-else-if="pickResult" class="map-pick-card">
        <header><div class="map-pick-icon"><i class="pi pi-map-marker" /></div><div><strong>地图拾取地点</strong><span>{{ pickResult.address || `${pickResult.lng.toFixed(6)}, ${pickResult.lat.toFixed(6)}` }}</span></div><button title="关闭地图拾取" @click="cancelPick"><i class="pi pi-times" /></button></header>
        <div class="map-pick-form">
          <label><span>附近地点</span><ElSelect v-model="pickCandidateId" placeholder="使用点击坐标">
            <ElOption label="使用点击坐标创建地点" value="__manual__" />
            <ElOption v-for="candidate in pickResult.candidates" :key="candidate.id" :label="candidate.name" :value="candidate.id"><div class="ai-poi-option"><b>{{ candidate.name }}</b><small>{{ candidate.address || candidate.type }}</small></div></ElOption>
          </ElSelect></label>
          <label><span>地点名称</span><ElInput v-model="pickName" maxlength="60" /></label>
        </div>
        <div class="map-pick-actions"><ElButton :disabled="store.readOnly" @click="addPickedPlace(null)">加入未安排地点</ElButton><ElButton type="primary" :disabled="store.readOnly" @click="addPickedPlace(store.selectedDayId)">加入 {{ store.selectedDay.label }}</ElButton></div>
      </div>
    </div>

    <div
      v-if="configured && selectedPlace"
      class="map-place-card floating-map-panel floating-place-card"
      :style="placePanel.style.value"
    >
      <div class="map-place-card-head floating-panel-drag-handle" title="拖动调整位置" @pointerdown="placePanel.start">
        <CategoryIcon :category="selectedPlace.category" size="marker" />
        <div>
          <h3>{{ selectedPlace.name }}</h3>
          <div class="type">{{ categoryMeta[selectedPlace.category].label }} · {{ selectedPlace.type }}</div>
        </div>
        <span class="floating-panel-grip place-grip">⠿</span>
      </div>
      <p>
        {{ selectedPlaceStop
          ? `已安排 ${selectedPlaceStops.length} 次（${selectedPlaceStops.map((item) => item.day.label).join('、')}），可以继续加入其他日期。`
          : `尚未安排行程，可以直接加入当前的 ${store.selectedDay.label}。` }}
      </p>
      <div class="map-place-card-actions">
        <button v-if="selectedPlaceStop" class="ghostbtn" @click="store.selectDay(selectedPlaceStop.day.id)">查看 {{ selectedPlaceStop.day.label }}</button>
        <button class="primarybtn" :disabled="store.readOnly" @click="store.addPlace(selectedPlace.id)">{{ selectedPlaceStop ? `再次加入 ${store.selectedDay.label}` : `加入 ${store.selectedDay.label}` }}</button>
        <button class="ghostbtn nearby-search-trigger" :class="{ active: nearbyOpen }" @click="toggleNearbySearch"><i class="pi pi-search" />搜周边</button>
        <button class="ghostbtn" @click="store.selectPlace(null)">关闭</button>
      </div>

      <section v-if="nearbyOpen" class="map-nearby-search">
        <header><div><h4>搜索附近地点</h4><span>以 {{ selectedPlace.name }} 为中心</span></div><button title="关闭周边搜索" @click="nearbyOpen = false"><i class="pi pi-times" /></button></header>
        <div class="nearby-search-controls">
          <ElInput v-model="nearbyKeyword" maxlength="40" placeholder="酒店、餐厅、停车场……" clearable @keyup.enter="searchNearby()"><template #prefix><i class="pi pi-search" /></template></ElInput>
          <ElSelect v-model="nearbyRadius" aria-label="周边搜索范围" @change="searchNearby()">
            <ElOption label="1 公里" :value="1000" />
            <ElOption label="3 公里" :value="3000" />
            <ElOption label="5 公里" :value="5000" />
            <ElOption label="10 公里" :value="10000" />
          </ElSelect>
          <ElButton type="primary" :loading="nearbyLoading" :disabled="!nearbyKeyword.trim()" @click="searchNearby()">搜索</ElButton>
        </div>
        <div class="nearby-search-presets"><button v-for="preset in nearbyPresets" :key="preset.label" :class="{ active: nearbyKeyword === preset.keyword }" @click="useNearbyPreset(preset.keyword)">{{ preset.label }}</button></div>
        <div v-if="nearbyLoading" class="nearby-search-state"><span class="poi-spinner" />正在搜索 {{ nearbyKeyword }}…</div>
        <div v-else-if="nearbyError" class="nearby-search-state empty"><i class="pi pi-info-circle" />{{ nearbyError }}</div>
        <div v-else class="nearby-result-list">
          <article v-for="place in nearbyResults" :key="place.id" class="nearby-result-card">
            <CategoryIcon :category="place.category" />
            <div class="nearby-result-main"><b>{{ place.name }}</b><small><span v-if="place.distanceMeters != null">{{ nearbyDistanceText(place) }} · </span>{{ place.address || place.type }}</small></div>
            <div class="nearby-result-actions">
              <ElButton text size="small" :disabled="nearbyAlreadyCollected(place) || store.readOnly" @click="addNearbyPlace(place, null)">{{ nearbyAlreadyCollected(place) ? '已收集' : '未安排' }}</ElButton>
              <ElButton type="primary" plain size="small" :disabled="nearbyAlreadyInSelectedDay(place) || store.readOnly" @click="addNearbyPlace(place, store.selectedDayId)">{{ nearbyAlreadyInSelectedDay(place) ? `已在 ${store.selectedDay.label}` : `加入 ${store.selectedDay.label}` }}</ElButton>
            </div>
          </article>
        </div>
      </section>

      <section class="map-place-personal">
        <header><div><h4>我的规划信息</h4><span v-if="selectedPlace.altitude != null">海拔 {{ selectedPlace.altitude.toLocaleString(currentLocale()) }} m</span></div><button :disabled="store.readOnly" @click="planningInfoOpen = !planningInfoOpen"><i class="pi pi-pencil" />{{ planningInfoOpen ? '收起' : selectedPlace.userNote || selectedPlace.altitude != null ? '编辑' : '添加' }}</button></header>
        <p v-if="selectedPlace.userNote && !planningInfoOpen">{{ selectedPlace.userNote }}</p>
        <div v-if="planningInfoOpen" class="map-place-personal-form"><label><span>我的备注</span><ElInput v-model="placeNoteDraft" type="textarea" :rows="3" maxlength="500" show-word-limit placeholder="预约、停车、必看项目或同行人偏好" /></label><label><span>海拔（米）</span><ElInputNumber v-model="placeAltitudeDraft" :min="-500" :max="9000" :step="100" controls-position="right" placeholder="未知" /></label><div class="place-visit-times"><label><span>开放时间</span><ElTimePicker v-model="openingTimeDraft" format="HH:mm" clearable /></label><label><span>最晚入场</span><ElTimePicker v-model="lastEntryTimeDraft" format="HH:mm" clearable /></label><label><span>关闭时间</span><ElTimePicker v-model="closingTimeDraft" format="HH:mm" clearable /></label></div><div class="place-reservation-row"><span><b>需要预约</b><small>计划检查会提醒未预约地点</small></span><ElSwitch v-model="reservationRequiredDraft" /></div><div v-if="reservationRequiredDraft" class="place-reservation-fields"><label><span>预约状态</span><ElSelect v-model="reservationStatusDraft"><ElOption label="未处理" value="none" /><ElOption label="待预约" value="pending" /><ElOption label="已预约" value="booked" /><ElOption label="已购票" value="ticketed" /></ElSelect></label><label><span>预约 / 订单备注</span><ElInput v-model="reservationNoteDraft" placeholder="订单号、预约平台或取消规则" /></label></div><div><ElButton size="small" @click="planningInfoOpen = false">取消</ElButton><ElButton type="primary" size="small" :disabled="store.readOnly" @click="savePlacePlanningInfo">保存</ElButton></div></div>
        <small v-else-if="!selectedPlace.userNote && selectedPlace.altitude == null">可补充个人备注和可靠海拔；不会由 AI 猜测。</small>
      </section>

      <section v-if="selectedPlaceRiskRows.length" class="map-place-risks">
        <div class="map-place-risks-head"><div><h4>风险提示</h4><span>{{ selectedPlaceRiskRows.length }} 项</span></div><ElTag :type="riskTagType(selectedPlaceRiskSeverity)" size="small" effect="light">最高{{ riskSeverityLabel(selectedPlaceRiskSeverity ?? 'info') }}</ElTag></div>
        <div class="map-place-risk-list">
          <div v-for="row in selectedPlaceRiskRows" :key="`${row.context}-${row.risk.id}`" class="map-place-risk-row" :class="`risk-${row.risk.severity}`">
            <i class="pi pi-exclamation-triangle" />
            <div><b>{{ row.risk.title }}</b><small>{{ row.context }} · {{ row.risk.sourceProvider || '行程风险规则' }}</small><p>{{ row.risk.description }}</p></div>
            <span>{{ riskSeverityLabel(row.risk.severity) }}</span>
          </div>
        </div>
      </section>

      <section v-if="selectedPlaceExpenseRows.length" class="map-place-expenses">
        <div class="map-place-expenses-head">
          <div><h4>费用</h4><span>{{ selectedPlaceExpenseRows.length }} 项</span></div>
          <strong v-if="selectedPlaceExpenseTotal">合计 {{ formatMoney(selectedPlaceExpenseTotal) }}</strong>
          <strong v-else-if="selectedPlaceUnknownExpenseCount">{{ selectedPlaceUnknownExpenseCount }} 项待核价</strong>
          <strong v-else>免费</strong>
        </div>
        <div class="map-place-expense-list">
          <div v-for="row in selectedPlaceExpenseRows" :key="row.item.id" class="map-place-expense-row">
            <span class="map-place-expense-icon"><i class="pi pi-wallet" /></span>
            <div><b>{{ row.item.name }}</b><small>{{ row.context }} · {{ expenseCategoryMeta[row.item.category].label }} · {{ expenseSourceText(row.item) }}{{ row.item.quotedAt ? ` · ${row.item.quotedAt} 核价` : '' }}</small></div>
            <ElTag :type="expenseStatusType(row.item.status)" size="small" effect="light">{{ expenseStatusMeta[row.item.status].label }}</ElTag>
            <strong>{{ expenseAmountText(row.item) }}</strong>
          </div>
        </div>
        <small v-if="selectedPlaceUnknownExpenseCount" class="map-place-expense-note"><i class="pi pi-info-circle" />待核价项目没有计入当前费用合计。</small>
      </section>

      <section v-if="detailsLoading || placeDetails" class="place-introduction">
        <div class="place-introduction-head">
          <h4>地点介绍</h4>
          <ElTag type="info" round effect="light">{{ placeDetails ? `${mapSourceLabel(placeDetails.sourceProvider)} POI` : '' }}</ElTag>
        </div>

        <template v-if="detailsLoading">
          <ElSkeletonItem variant="rect" style="height:92px;border-radius:12px" />
          <ElSkeletonItem variant="text" style="width:86%;height:12px" />
          <ElSkeletonItem variant="text" style="width:68%;height:12px" />
        </template>
        <template v-else-if="placeDetails">
          <div v-if="placeDetails.photos.length" class="place-photo-strip">
            <ElImage
              v-for="(photo, photoIndex) in placeDetails.photos.slice(0, 3)"
              :key="photo.url"
              :src="photo.url"
              :alt="photo.title || placeDetails.name"
              fit="cover"
              loading="lazy"
              :preview-src-list="placePhotoUrls"
              :initial-index="photoIndex"
              :z-index="12000"
              preview-teleported
              hide-on-click-modal
              show-progress
            />
          </div>
          <p v-if="selectedPlace.description" class="user-place-description">{{ selectedPlace.description }}</p>
          <p class="structured-place-summary">{{ placeIntroduction }}</p>
          <div class="place-detail-facts">
            <div v-if="placeDetails.address"><i class="pi pi-map-marker" /><span>{{ placeDetails.address }}</span></div>
            <div v-if="placeDetails.telephone"><i class="pi pi-phone" /><span>{{ placeDetails.telephone }}</span></div>
            <div v-if="placeDetails.openTime"><i class="pi pi-clock" /><span>{{ placeDetails.openTime }}</span></div>
            <div v-if="placeDetails.rating"><i class="pi pi-star" /><span>地图评分 {{ placeDetails.rating }}</span></div>
          </div>
        </template>
      </section>
    </div>

    <div class="mapbottom">
      <div v-if="configured" class="map-legend" :class="{ expanded: legendExpanded }">
        <ElButton
          circle
          :plain="!legendExpanded"
          class="legend-toggle"
          title="地点图例"
          @click="legendExpanded = !legendExpanded"
        ><i class="pi pi-palette" /></ElButton>
        <div v-if="legendExpanded" class="category-filters">
          <button
            v-for="category in categories"
            :key="category"
            class="category-filter"
            :class="{ active: store.categoryFilter === category }"
            :title="category === 'all' ? '显示全部地点' : categoryMeta[category].label"
            @click="selectCategory(category)"
          >
            <i v-if="category === 'all'" class="pi pi-globe" />
            <template v-else>
              <CategoryIcon :category="category" />{{ categoryMeta[category].label }}
            </template>
          </button>
        </div>
      </div>

    </div>
  </section>
</template>

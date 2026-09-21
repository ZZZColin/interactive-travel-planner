<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import en from 'element-plus/es/locale/lang/en'
import { appLocale, translateLegacyText } from './i18n'
import AppHeader from './components/header/AppHeader.vue'
import HomePage from './components/home/HomePage.vue'
import PlannerSidebar from './components/itinerary/PlannerSidebar.vue'
import DeferredMapWorkspace from './components/map/DeferredMapWorkspace.vue'
import AmapSettingsModal from './components/modals/AmapSettingsModal.vue'
import TencentMapSettingsModal from './components/modals/TencentMapSettingsModal.vue'
import GoogleMapSettingsModal from './components/modals/GoogleMapSettingsModal.vue'
import MapboxSettingsModal from './components/modals/MapboxSettingsModal.vue'
import CesiumMapSettingsModal from './components/modals/CesiumMapSettingsModal.vue'
import BatchImportModal from './components/modals/BatchImportModal.vue'
import PlanCheckModal from './components/modals/PlanCheckModal.vue'
import PlanEditorModal from './components/modals/PlanEditorModal.vue'
import ReduceDaysModal from './components/modals/ReduceDaysModal.vue'
import type { PlanEditorValue, PlanRecord } from './domain/types'
import { planIdFromUrl, urlWithPlanId } from './domain/planUrl'
import { normalizeMapRuntimeSelection, type MapRendererId, type MapRuntimeSelection } from './map/config'
import { getActiveMapProviderId, hasMapProviderConfig, hasMapRendererConfig, mapRuntimeState, switchActiveMapRenderer, switchMapRuntimeSelection } from './map/provider'

const AiImportModal = defineAsyncComponent(() => import('./components/modals/AiImportModal.vue'))
const AiRouteOptimizationModal = defineAsyncComponent(() => import('./components/modals/AiRouteOptimizationModal.vue'))
const AiSettingsModal = defineAsyncComponent(() => import('./components/modals/AiSettingsModal.vue'))
const BudgetModal = defineAsyncComponent(() => import('./components/budget/BudgetModal.vue'))
const PlanBackupModal = defineAsyncComponent(() => import('./components/modals/PlanBackupModal.vue'))
const ServiceConfigBackupModal = defineAsyncComponent(() => import('./components/modals/ServiceConfigBackupModal.vue'))
const CompleteBackupModal = defineAsyncComponent(() => import('./components/modals/CompleteBackupModal.vue'))
const WeatherSettingsModal = defineAsyncComponent(() => import('./components/modals/WeatherSettingsModal.vue'))
const ShareStudioModal = defineAsyncComponent(() => import('./components/modals/ShareStudioModal.vue'))
import { usePlannerStore } from './stores/planner'
import { usePlansStore } from './stores/plans'

const elementLocale = computed(() => appLocale.value === 'zh-CN' ? zhCn : en)
const planner = usePlannerStore()
const plans = usePlansStore()
const initialPlanId = planIdFromUrl(location.href)
const initialScene = Number(new URLSearchParams(location.search).get('scene') ?? 0)
const demoMode = ref(!initialPlanId && ((initialScene >= 1 && initialScene <= 4) || new URLSearchParams(location.search).get('demo') === '1'))
const checkOpen = ref(false)
const batchOpen = ref(false)
const budgetOpen = ref(false)
const settingsOpen = ref(false)
const tencentSettingsOpen = ref(false)
const googleSettingsOpen = ref(false)
const mapboxSettingsOpen = ref(false)
const cesiumSettingsOpen = ref(false)
const mapSettingsActivateOnSave = ref(false)
const pendingMapRuntimeSelection = ref<MapRuntimeSelection | null>(null)
const weatherSettingsOpen = ref(false)
const aiImportOpen = ref(false)
const aiSettingsOpen = ref(false)
const aiRouteOptimizationOpen = ref(false)
const planEditorOpen = ref(false)
const backupOpen = ref(false)
const planBackupInitialSection = ref<'backup' | 'recycle'>('backup')
const serviceConfigBackupOpen = ref(false)
const completeBackupOpen = ref(false)
const shareOpen = ref(false)
function openMapSettings(providerId: MapRendererId = 'amap', activateOnSave = false): void {
  mapSettingsActivateOnSave.value = activateOnSave
  settingsOpen.value = providerId === 'amap'
  tencentSettingsOpen.value = providerId === 'tencent'
  googleSettingsOpen.value = providerId === 'google'
  mapboxSettingsOpen.value = providerId === 'mapbox'
  cesiumSettingsOpen.value = providerId === 'cesium'
}

function closeMapSettings(providerId: MapRendererId): void {
  if (providerId === 'amap') settingsOpen.value = false
  else if (providerId === 'tencent') tencentSettingsOpen.value = false
  else if (providerId === 'google') googleSettingsOpen.value = false
  else if (providerId === 'mapbox') mapboxSettingsOpen.value = false
  else cesiumSettingsOpen.value = false
  const anotherOpen = settingsOpen.value || tencentSettingsOpen.value || googleSettingsOpen.value || mapboxSettingsOpen.value || cesiumSettingsOpen.value
  if (!anotherOpen && pendingMapRuntimeSelection.value) {
    pendingMapRuntimeSelection.value = null
    mapSettingsActivateOnSave.value = false
  }
}

async function handleMapConfigSaved(rendererId: MapRendererId): Promise<void> {
  if (!mapSettingsActivateOnSave.value) return
  try {
    if (pendingMapRuntimeSelection.value) {
      const selection = pendingMapRuntimeSelection.value
      const missingRenderer = !hasMapRendererConfig(selection.rendererId) ? selection.rendererId : null
      const missingProvider = !hasMapProviderConfig(selection.placeServiceId) ? selection.placeServiceId : !hasMapProviderConfig(selection.routingServiceId) ? selection.routingServiceId : null
      const missing = missingRenderer ?? missingProvider
      if (missing) { openMapSettings(missing, true); return }
      pendingMapRuntimeSelection.value = null
      await switchMapRuntimeSelection(selection)
    } else await switchActiveMapRenderer(rendererId)
  } catch (reason) {
    planner.notify(reason instanceof Error ? reason.message : '地图运行方案切换失败')
  } finally {
    if (!pendingMapRuntimeSelection.value) mapSettingsActivateOnSave.value = false
  }
}

function openPlanBackup(section: 'backup' | 'recycle' = 'backup'): void {
  planBackupInitialSection.value = section
  backupOpen.value = true
}

async function requestMapRuntimeSelection(requested: MapRuntimeSelection): Promise<void> {
  const googleFallback = hasMapProviderConfig('amap') ? 'amap' : hasMapProviderConfig('tencent') ? 'tencent' : 'amap'
  const selection = normalizeMapRuntimeSelection(requested, googleFallback)
  const missingRenderer = !hasMapRendererConfig(selection.rendererId) ? selection.rendererId : null
  const missingProvider = !hasMapProviderConfig(selection.placeServiceId) ? selection.placeServiceId : !hasMapProviderConfig(selection.routingServiceId) ? selection.routingServiceId : null
  const missing = missingRenderer ?? missingProvider
  if (missing) {
    pendingMapRuntimeSelection.value = selection
    openMapSettings(missing, true)
    return
  }
  try {
    await switchMapRuntimeSelection(selection)
    planner.notify(`默认地图方案已保存：${mapRuntimeState.rendererDefinition.name}`)
  } catch (reason) {
    planner.notify(reason instanceof Error ? reason.message : '地图运行方案切换失败')
  }
}

const mobilePane = ref<'itinerary' | 'map'>('itinerary')
const editingPlan = ref<PlanRecord | null>(null)
const reduceDaysOpen = ref(false)
const workspaceRef = ref<HTMLElement | null>(null)
const sidebarWidthStorageKey = 'interactiveTravel.planner.sidebarWidth'
const defaultSidebarWidth = 560
const minimumSidebarWidth = 420
const storedSidebarWidth = Number(localStorage.getItem(sidebarWidthStorageKey) ?? NaN)
const sidebarWidth = ref(Number.isFinite(storedSidebarWidth) && storedSidebarWidth > 0 ? storedSidebarWidth : defaultSidebarWidth)
const sidebarResizing = ref(false)
const workspaceStyle = computed(() => ({ '--planner-sidebar-width': `${sidebarWidth.value}px` }))
let sidebarResizeStartX = 0
let sidebarResizeStartWidth = 0
let previousBodyCursor = ''
let previousBodyUserSelect = ''
const pendingReduction = ref<{
  removedDayCount: number
  placeNames: string[]
  planId?: string
  value?: PlanEditorValue
  returnMessage: string
  discardMessage: string
} | null>(null)

watch(() => planner.demo, (scene) => {
  if (scene === 4) window.setTimeout(() => { checkOpen.value = true }, 180)
})

watch(
  [() => plans.view, () => plans.activePlan?.metadata.name],
  ([view, planName]) => {
    document.title = view === 'planner' && planName
      ? `${planName} · 行途规划`
      : '行途规划 · 旅行路线规划器'
  },
  { immediate: true },
)

function createPlan(): void {
  editingPlan.value = null
  planEditorOpen.value = true
}

function editPlan(plan: PlanRecord): void {
  editingPlan.value = plan
  planEditorOpen.value = true
}

function savePlanMetadata(value: PlanEditorValue): void {
  if (!editingPlan.value) {
    plans.createPlan(value)
    return
  }
  const planId = editingPlan.value.metadata.id
  const impact = plans.rangeReductionImpact(planId, value)
  if (impact.removedDayCount > 0 && impact.placeIds.length > 0) {
    pendingReduction.value = {
      removedDayCount: impact.removedDayCount,
      placeNames: impact.placeNames,
      planId,
      value,
      returnMessage: '日期范围已更新，移出日期中的地点已返回未安排列表',
      discardMessage: '日期范围已更新，并删除移出日期中的地点',
    }
    reduceDaysOpen.value = true
    return
  }
  plans.updatePlan(planId, value)
}

function editActivePlan(): void {
  if (plans.activePlan) editPlan(plans.activePlan)
}

function navigateFromCheck(placeId: string, dayId?: string): void {
  if (dayId) planner.selectDay(dayId)
  planner.selectPlace(placeId)
  checkOpen.value = false
}

function setMobilePane(value: 'itinerary' | 'map'): void {
  mobilePane.value = value
  window.setTimeout(() => window.dispatchEvent(new Event('resize')), 0)
}

function maximumSidebarWidth(): number {
  const measuredWorkspaceWidth = workspaceRef.value?.clientWidth ?? 0
  const workspaceWidth = Math.max(measuredWorkspaceWidth, window.innerWidth)
  return Math.max(minimumSidebarWidth, Math.min(820, workspaceWidth - 380))
}

function setSidebarWidth(value: number, persist = false): void {
  sidebarWidth.value = Math.round(Math.min(maximumSidebarWidth(), Math.max(minimumSidebarWidth, value)))
  if (persist) localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth.value))
}

function resizeSidebar(event: PointerEvent): void {
  if (!sidebarResizing.value) return
  setSidebarWidth(sidebarResizeStartWidth + event.clientX - sidebarResizeStartX)
}

function finishSidebarResize(): void {
  if (!sidebarResizing.value) return
  sidebarResizing.value = false
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
  window.removeEventListener('pointermove', resizeSidebar)
  window.removeEventListener('pointerup', finishSidebarResize)
  window.removeEventListener('pointercancel', finishSidebarResize)
  localStorage.setItem(sidebarWidthStorageKey, String(sidebarWidth.value))
}

function startSidebarResize(event: PointerEvent): void {
  if (event.button !== 0 || window.matchMedia('(max-width: 900px)').matches) return
  sidebarResizeStartX = event.clientX
  sidebarResizeStartWidth = sidebarWidth.value
  sidebarResizing.value = true
  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', resizeSidebar)
  window.addEventListener('pointerup', finishSidebarResize)
  window.addEventListener('pointercancel', finishSidebarResize)
}

function resetSidebarWidth(): void {
  setSidebarWidth(defaultSidebarWidth, true)
}

function resizeSidebarByKeyboard(event: KeyboardEvent): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight' && event.key !== 'Home') return
  event.preventDefault()
  if (event.key === 'Home') { resetSidebarWidth(); return }
  const step = event.shiftKey ? 50 : 20
  setSidebarWidth(sidebarWidth.value + (event.key === 'ArrowRight' ? step : -step), true)
}

function constrainSidebarWidth(): void {
  setSidebarWidth(sidebarWidth.value)
}

function adjustPlanBoundary(boundary: 'start' | 'end', action: 'add' | 'remove'): void {
  const plan = plans.activePlan
  if (!plan) return
  if (action === 'remove' && planner.days.length <= 1) return

  const start = new Date(plan.metadata.startAt)
  const end = new Date(plan.metadata.endAt)
  let successMessage = ''

  if (boundary === 'start' && action === 'add') {
    start.setDate(start.getDate() - 1)
    successMessage = '已在行程前方增加一天'
  } else if (boundary === 'end' && action === 'add') {
    end.setDate(end.getDate() + 1)
    successMessage = '已在行程后方增加一天'
  } else if (boundary === 'start') {
    const nextFirstDay = planner.days[1]
    start.setDate(start.getDate() + 1)
    if (nextFirstDay) start.setHours(Math.floor(nextFirstDay.start / 60), nextFirstDay.start % 60, 0, 0)
    successMessage = '已从行程头部移除一天'
  } else {
    const nextLastDay = planner.days[planner.days.length - 2]
    end.setDate(end.getDate() - 1)
    if (nextLastDay) end.setHours(Math.floor(nextLastDay.end / 60), nextLastDay.end % 60, 0, 0)
    successMessage = '已从行程尾部移除一天'
  }

  const value: PlanEditorValue = {
    name: plan.metadata.name,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    participants: plan.metadata.participants,
    budgetLimit: plan.plannerState.budget?.settings.limit ?? null,
  }
  const impact = plans.rangeReductionImpact(plan.metadata.id, value)
  if (action === 'remove' && impact.placeIds.length) {
    pendingReduction.value = {
      removedDayCount: impact.removedDayCount,
      placeNames: impact.placeNames,
      planId: plan.metadata.id,
      value,
      returnMessage: `${successMessage}，当日地点已返回未安排列表`,
      discardMessage: `${successMessage}，并删除当日地点`,
    }
    reduceDaysOpen.value = true
    return
  }

  plans.updatePlan(plan.metadata.id, value)
  planner.notify(successMessage)
}

function applyReductionStrategy(strategy: 'return' | 'discard'): void {
  const pending = pendingReduction.value
  if (!pending) return
  if (pending.planId && pending.value) {
    plans.updatePlan(pending.planId, pending.value, strategy)
    planner.notify(strategy === 'return' ? pending.returnMessage : pending.discardMessage)
  }
  reduceDaysOpen.value = false
  pendingReduction.value = null
}

function restorePlanFromLocation(notifyMissing = true): void {
  const planId = planIdFromUrl(location.href)
  if (!planId) {
    if (plans.view !== 'home') plans.goHome('none')
    return
  }
  if (plans.plans.some((plan) => plan.metadata.id === planId)) {
    plans.openPlan(planId, true, 'none')
    return
  }
  history.replaceState({ ...(history.state ?? {}), planId: null }, '', urlWithPlanId(location.href, null))
  plans.goHome('none')
  if (notifyMissing) planner.notify('链接中的旅行计划不存在或已被删除，已返回全部计划')
}

function handleBrowserNavigation(): void {
  restorePlanFromLocation()
}

onMounted(() => {
  constrainSidebarWidth()
  window.addEventListener('resize', constrainSidebarWidth)
  window.addEventListener('popstate', handleBrowserNavigation)
  if (initialPlanId) {
    restorePlanFromLocation()
  } else if (initialScene >= 1 && initialScene <= 4) {
    const baseline = plans.ensureDemoPlan()
    plans.openPlan(baseline.metadata.id, true, 'replace')
    planner.setDemo(initialScene)
  }
})

onBeforeUnmount(() => {
  finishSidebarResize()
  window.removeEventListener('resize', constrainSidebarWidth)
  window.removeEventListener('popstate', handleBrowserNavigation)
})
</script>

<template>
  <ElConfigProvider :locale="elementLocale">
    <HomePage v-if="plans.view === 'home'" @map-runtime-change="requestMapRuntimeSelection" @map-settings="openMapSettings" @create="createPlan" @ai-import="aiImportOpen = true" @edit="editPlan" @backup="openPlanBackup('backup')" @recycle="openPlanBackup('recycle')" @config-backup="serviceConfigBackupOpen = true" @complete-backup="completeBackupOpen = true" @open-demo="plans.openPlan(plans.ensureDemoPlan().metadata.id)" />

    <template v-else>
      <div v-if="plans.openingPlan" class="plan-opening-screen">
        <div class="plan-opening-brand"><span class="brandmark">途</span>行途规划</div>
        <div class="plan-opening-card"><span class="plan-opening-spinner" /><strong>正在进入“{{ plans.activePlan?.metadata.name }}”</strong><small>正在恢复日期、地点、预算和路线数据</small></div>
      </div>
      <template v-else>
        <div class="app">
          <AppHeader :demo-mode="demoMode" @share="shareOpen = true" @check="checkOpen = true" @budget="budgetOpen = true" @weather="weatherSettingsOpen = true" @edit-plan="editActivePlan" />
          <nav class="mobile-pane-switch"><button :class="{ active: mobilePane === 'itinerary' }" @click="setMobilePane('itinerary')"><i class="pi pi-list" />行程</button><button :class="{ active: mobilePane === 'map' }" @click="setMobilePane('map')"><i class="pi pi-map" />地图</button></nav>
          <main ref="workspaceRef" class="workspace" :class="[`mobile-${mobilePane}`, { 'resizing-sidebar': sidebarResizing }]" :style="workspaceStyle">
            <PlannerSidebar :demo-mode="demoMode" @batch="batchOpen = true" @ai-import="aiImportOpen = true" @weather-settings="weatherSettingsOpen = true" @adjust-boundary="adjustPlanBoundary" />
            <div
              class="workspace-resize-handle"
              role="separator"
              aria-label="调整行程编排区域宽度"
              aria-orientation="vertical"
              :aria-valuenow="sidebarWidth"
              :aria-valuemin="minimumSidebarWidth"
              :aria-valuemax="maximumSidebarWidth()"
              tabindex="0"
              title="左右拖动调整宽度，双击恢复默认"
              @pointerdown.stop.prevent="startSidebarResize"
              @dblclick.stop.prevent="resetSidebarWidth"
              @keydown="resizeSidebarByKeyboard"
            ><span /></div>
            <DeferredMapWorkspace @settings="openMapSettings" />
          </main>
        </div>

        <PlanCheckModal :open="checkOpen" @close="checkOpen = false" @optimize="checkOpen = false; aiRouteOptimizationOpen = true" @navigate-day="planner.selectDay($event); checkOpen = false" @navigate-place="navigateFromCheck" @budget="checkOpen = false; budgetOpen = true" />
        <BudgetModal :open="budgetOpen" @close="budgetOpen = false" />
        <BatchImportModal :open="batchOpen" @close="batchOpen = false" />
      </template>
    </template>

    <AmapSettingsModal :open="settingsOpen" :activate-on-save="mapSettingsActivateOnSave" @close="closeMapSettings('amap')" @saved="handleMapConfigSaved('amap')" />
    <TencentMapSettingsModal :open="tencentSettingsOpen" :activate-on-save="mapSettingsActivateOnSave" @close="closeMapSettings('tencent')" @saved="handleMapConfigSaved('tencent')" />
    <GoogleMapSettingsModal :open="googleSettingsOpen" :activate-on-save="mapSettingsActivateOnSave" @close="closeMapSettings('google')" @saved="handleMapConfigSaved('google')" />
    <MapboxSettingsModal :open="mapboxSettingsOpen" :activate-on-save="mapSettingsActivateOnSave" @close="closeMapSettings('mapbox')" @saved="handleMapConfigSaved('mapbox')" />
    <CesiumMapSettingsModal :open="cesiumSettingsOpen" :activate-on-save="mapSettingsActivateOnSave" @close="closeMapSettings('cesium')" @saved="handleMapConfigSaved('cesium')" />
    <WeatherSettingsModal :open="weatherSettingsOpen" @close="weatherSettingsOpen = false" @map-settings="openMapSettings('amap')" />
    <AiSettingsModal :open="aiSettingsOpen" @close="aiSettingsOpen = false" />
    <AiImportModal
      :open="aiImportOpen"
      @close="aiImportOpen = false"
      @settings="aiSettingsOpen = true"
      @map-settings="openMapSettings(getActiveMapProviderId())"
    />
    <AiRouteOptimizationModal
      :open="aiRouteOptimizationOpen"
      @close="aiRouteOptimizationOpen = false"
      @settings="aiSettingsOpen = true"
      @map-settings="openMapSettings(getActiveMapProviderId())"
    />
    <PlanBackupModal :open="backupOpen" :initial-section="planBackupInitialSection" @close="backupOpen = false" />
    <ServiceConfigBackupModal :open="serviceConfigBackupOpen" @close="serviceConfigBackupOpen = false" />
    <CompleteBackupModal :open="completeBackupOpen" @close="completeBackupOpen = false" />
    <ShareStudioModal :open="shareOpen" @close="shareOpen = false" @settings="aiSettingsOpen = true" @map-settings="openMapSettings('amap')" />
    <PlanEditorModal
      :open="planEditorOpen"
      :plan="editingPlan"
      @close="planEditorOpen = false"
      @save="savePlanMetadata"
    />
    <ReduceDaysModal
      :open="reduceDaysOpen"
      :removed-day-count="pendingReduction?.removedDayCount ?? 0"
      :place-names="pendingReduction?.placeNames ?? []"
      @close="reduceDaysOpen = false; pendingReduction = null"
      @choose="applyReductionStrategy"
    />
    <div class="toast" :class="{ show: planner.toast }">{{ translateLegacyText(planner.toast) }}</div>
  </ElConfigProvider>
</template>

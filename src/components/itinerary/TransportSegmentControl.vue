<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElInput, ElInputNumber, ElOption, ElPopover, ElSelect, ElTimePicker } from 'element-plus'
import { segmentExpenseOwnerId } from '../../domain/budget'
import { formatDuration } from '../../domain/schedule'
import { transportModeMeta, transportModeOf, transportModes } from '../../domain/transport'
import type { ExpenseCategory, RouteOption, RoutePreference, ScheduleRow, Stop, TransportMode, TransportTicketStatus } from '../../domain/types'
import ExpenseEditorPopover from '../budget/ExpenseEditorPopover.vue'
import { mapRuntimeState, planMapProvider } from '../../map/provider'
import { usePlannerStore } from '../../stores/planner'
import { currentLocale } from '../../i18n'

const props = defineProps<{
  stop: Stop
  row: ScheduleRow
  toPlaceId: string
  conflict: boolean
}>()

const store = usePlannerStore()
const manualOpen = ref(false)
const routeOptionsOpen = ref(false)
const routeOptionsLoading = ref(false)
const routeOptionsError = ref('')
const routeOptions = ref<RouteOption[]>([])
const previewRouteId = ref('')
const routePreference = ref<RoutePreference>(props.stop.routePreference ?? 'recommended')
const manualHours = ref(0)
const manualMinutes = ref(0)
const manualDistance = ref<number | null>(null)
const transportNumber = ref('')
const transportFrom = ref('')
const transportTo = ref('')
const departureTime = ref<string | null>(null)
const arrivalTime = ref<string | null>(null)
const advanceMinutes = ref<number | null>(null)
const ticketStatus = ref<TransportTicketStatus>('none')
const ticketNote = ref('')
const manualDuration = computed(() => manualHours.value * 60 + manualMinutes.value)
const scheduledDuration = computed(() => {
  const departure = timeTextToMinutes(departureTime.value)
  const arrival = timeTextToMinutes(arrivalTime.value)
  return departure != null && arrival != null ? Math.max(1, arrival + (arrival < departure ? 1440 : 0) - departure) : 0
})
const effectiveDuration = computed(() => scheduledDuration.value || manualDuration.value)
const mode = computed<TransportMode>({
  get: () => transportModeOf(props.stop.transportMode),
  set: (value) => {
    if (store.readOnly) return
    store.setStopTransportMode(props.stop.uid, value)
  },
})
const meta = computed(() => transportModeMeta[mode.value])
const isManual = computed(() => !meta.value.automatic)
const supportsRouteOptions = computed(() => planMapProvider.capabilities.routeAlternativeModes?.includes(mode.value) ?? false)
const selectedRouteStale = computed(() => props.stop.selectedRoute ? Date.now() - new Date(props.stop.selectedRoute.queriedAt).getTime() > 24 * 60 * 60_000 : false)
const fromName = computed(() => store.places[props.stop.placeId]?.name ?? props.stop.placeId)
const toName = computed(() => store.places[props.toPlaceId]?.name ?? props.toPlaceId)
const expenseOwnerId = computed(() => segmentExpenseOwnerId(props.stop.uid, props.toPlaceId))
const expenseCategory = computed<ExpenseCategory>(() => ({ driving: 'parking', walking: 'other', cycling: 'rental', transit: 'transit', train: 'train', flight: 'flight', ferry: 'ferry' })[mode.value] as ExpenseCategory)

function minutesToTimeText(minutes?: number | null): string | null { return minutes == null ? null : `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}` }
function timeTextToMinutes(value: string | null): number | null { if (!value) return null; const match = /^(\d{1,2}):(\d{2})$/.exec(value); if (!match) return null; return Number(match[1]) * 60 + Number(match[2]) }

async function loadRouteOptions(force = false): Promise<void> {
  if (!supportsRouteOptions.value) return
  const from = store.places[props.stop.placeId]
  const to = store.places[props.toPlaceId]
  if (!from || !to) return
  if (!force && routeOptions.value.length) { planMapProvider.previewRouteOptions(routeOptions.value, previewRouteId.value || props.stop.selectedRoute?.id); return }
  routeOptionsLoading.value = true
  routeOptionsError.value = ''
  try {
    routeOptions.value = await planMapProvider.searchRouteOptions({ from, to, mode: mode.value, preference: routePreference.value, force })
    previewRouteId.value = props.stop.selectedRoute?.id && routeOptions.value.some((item) => item.id === props.stop.selectedRoute?.id) ? props.stop.selectedRoute.id : routeOptions.value[0]?.id ?? ''
    planMapProvider.previewRouteOptions(routeOptions.value, previewRouteId.value)
    if (!routeOptions.value.length) routeOptionsError.value = `${mapRuntimeState.providerDefinition.shortName}暂未返回可用路线方案。`
  } catch (reason) {
    routeOptionsError.value = reason instanceof Error ? reason.message : '路线方案查询失败'
  } finally { routeOptionsLoading.value = false }
}

function previewRoute(option: RouteOption): void {
  previewRouteId.value = option.id
  store.setPreviewRouteOption(option.id)
  planMapProvider.previewRouteOptions(routeOptions.value, option.id)
}

function routeDifference(option: RouteOption): string {
  const baseline = routeOptions.value[0]
  if (!baseline || baseline.id === option.id) return '推荐基准'
  const time = option.durationMinutes - baseline.durationMinutes
  const distance = option.distanceKm - baseline.distanceKm
  const toll = (option.toll ?? option.cost ?? 0) - (baseline.toll ?? baseline.cost ?? 0)
  const signed = (value: number, unit: string) => `${value > 0 ? '+' : ''}${value}${unit}`
  return [time ? signed(time, '分') : '', distance ? signed(distance, 'km') : '', toll ? signed(toll, '元') : ''].filter(Boolean).join(' · ') || '差异很小'
}

function chooseRoute(option: RouteOption): void {
  if (store.readOnly) return
  store.setStopRouteOption(props.stop.uid, option, routePreference.value)
  previewRouteId.value = option.id
  routeOptionsOpen.value = false
  store.setPreviewRouteOption(null)
  planMapProvider.clearRouteOptionsPreview()
}

function resetManualDraft(): void {
  const duration = props.stop.transportDuration ?? 0
  manualHours.value = Math.floor(duration / 60)
  manualMinutes.value = duration % 60
  manualDistance.value = props.stop.transportDistance ?? null
  transportNumber.value = props.stop.transportNumber ?? ''
  transportFrom.value = props.stop.transportFrom ?? fromName.value
  transportTo.value = props.stop.transportTo ?? toName.value
  departureTime.value = minutesToTimeText(props.stop.transportDepartureTime)
  arrivalTime.value = minutesToTimeText(props.stop.transportArrivalTime)
  advanceMinutes.value = props.stop.transportAdvanceMinutes ?? null
  ticketStatus.value = props.stop.transportTicketStatus ?? 'none'
  ticketNote.value = props.stop.transportTicketNote ?? ''
}

function saveManualTransport(): void {
  if (store.readOnly) return
  if (effectiveDuration.value < 1) return
  store.setStopManualTransport(props.stop.uid, effectiveDuration.value, manualDistance.value, { transportNumber: transportNumber.value, transportFrom: transportFrom.value, transportTo: transportTo.value, transportDepartureTime: timeTextToMinutes(departureTime.value), transportArrivalTime: timeTextToMinutes(arrivalTime.value), transportAdvanceMinutes: advanceMinutes.value, transportTicketStatus: ticketStatus.value, transportTicketNote: ticketNote.value })
  manualOpen.value = false
}

watch(routeOptionsOpen, (open) => { if (open) void loadRouteOptions(); else { store.setPreviewRouteOption(null); planMapProvider.clearRouteOptionsPreview() } })
watch(() => store.previewRouteOptionId, (id) => { if (id && routeOptionsOpen.value && routeOptions.value.some((option) => option.id === id)) previewRouteId.value = id })
watch(mode, () => { routeOptions.value = []; previewRouteId.value = ''; routeOptionsOpen.value = false })
watch(routePreference, () => { routeOptions.value = []; previewRouteId.value = ''; if (routeOptionsOpen.value) void loadRouteOptions(true) })

watch(() => store.selectedSegmentUid, (uid) => { if (uid !== props.stop.uid || store.readOnly) return; if (supportsRouteOptions.value) routeOptionsOpen.value = true; else if (isManual.value) manualOpen.value = true })

watch(manualOpen, (open) => {
  if (open) resetManualDraft()
})
</script>

<template>
  <div class="segmentline transport-segment" :class="{ bad: conflict, pending: row.route?.pending, selected: store.selectedSegmentUid === stop.uid }" :data-segment-uid="stop.uid" @click.stop="store.selectSegment(stop.uid)">
    <ElSelect v-model="mode" size="small" class="transport-mode-select" popper-class="transport-mode-options" :disabled="store.readOnly" @click.stop>
      <template #prefix><span class="transport-mode-glyph" :style="{ '--mode-color': meta.color }">{{ meta.glyph }}</span></template>
      <ElOption v-for="item in transportModes" :key="item" :label="transportModeMeta[item].label" :value="item">
        <div class="transport-mode-option">
          <span class="transport-mode-glyph" :style="{ '--mode-color': transportModeMeta[item].color }">{{ transportModeMeta[item].glyph }}</span>
          <span>{{ transportModeMeta[item].label }}</span>
          <small>{{ transportModeMeta[item].automatic ? `${mapRuntimeState.providerDefinition.shortName}自动规划` : '手动填写用时' }}</small>
        </div>
      </ElOption>
    </ElSelect>

    <template v-if="row.route?.pending">
      <b class="transport-pending">待填写用时</b>
    </template>
    <template v-else>
      <b>{{ formatDuration(row.route?.min ?? 0) }}</b>
      <span v-if="row.route?.km">{{ row.route.km }} km</span><span v-if="stop.transportNumber" class="transport-number">{{ stop.transportNumber }}</span>
    </template>

    <span v-if="stop.selectedRoute" class="selected-route-chip" :class="{ stale: selectedRouteStale }" :title="`选择于 ${new Date(stop.selectedRoute.selectedAt).toLocaleString(currentLocale())}`">{{ stop.selectedRoute.strategyLabel }}{{ selectedRouteStale ? ' · 待刷新' : '' }}</span>
    <ElPopover v-if="supportsRouteOptions" v-model:visible="routeOptionsOpen" placement="bottom-start" :width="430" trigger="click" popper-class="route-options-popover"><template #reference><ElButton text size="small" class="route-options-trigger" title="选择地图路线" :disabled="store.readOnly" @click.stop><i class="pi pi-directions" /><span>路线方案</span></ElButton></template><div class="route-options-panel"><header><div><strong>{{ fromName }} → {{ toName }}</strong><span>{{ meta.label }}路线方案 · 数据来自{{ mapRuntimeState.providerDefinition.name }}</span></div><ElSelect v-if="mode === 'driving' || mode === 'transit'" v-model="routePreference" size="small" class="route-preference-select"><ElOption label="综合推荐" value="recommended" /><ElOption label="用时优先" value="fastest" /><ElOption label="距离优先" value="shortest" /><ElOption label="少收费" value="least-toll" /><ElOption label="躲避拥堵" value="avoid-congestion" /></ElSelect><ElButton text size="small" :loading="routeOptionsLoading" @click="loadRouteOptions(true)"><i class="pi pi-refresh" />重新查询</ElButton></header><div v-if="routeOptionsLoading" class="route-options-loading"><span class="poi-spinner" />正在查询候选路线…</div><div v-else-if="routeOptionsError" class="route-options-error"><i class="pi pi-exclamation-circle" />{{ routeOptionsError }}</div><div v-else class="route-option-list"><button v-for="option in routeOptions" :key="option.id" type="button" :class="{ active: previewRouteId === option.id, selected: stop.selectedRoute?.id === option.id }" @mouseenter="previewRoute(option)" @focus="previewRoute(option)" @click="chooseRoute(option)"><span class="route-option-order">{{ routeOptions.indexOf(option) + 1 }}</span><span class="route-option-main"><b>{{ option.strategyLabel }}</b><small>{{ formatDuration(option.durationMinutes) }} · {{ option.distanceKm }} km<span v-if="option.toll != null"> · 高速费 ¥{{ option.toll }}</span><span v-if="option.cost != null"> · 预计 ¥{{ option.cost }}</span><span v-if="option.transferCount != null"> · 换乘 {{ option.transferCount }} 次</span><span v-if="option.walkingDistanceKm != null"> · 步行 {{ option.walkingDistanceKm }} km</span></small><small class="route-option-delta">{{ routeDifference(option) }}</small></span><span v-if="option.trafficLightCount != null" class="route-option-lights">{{ option.trafficLightCount }} 个红绿灯</span><em>{{ stop.selectedRoute?.id === option.id ? '已选择' : '使用' }}</em></button></div><footer><i class="pi pi-info-circle" />选择后会同步更新用时、里程、高速费、自驾成本和计划检查。</footer></div></ElPopover>

    <ExpenseEditorPopover owner-type="segment" :owner-id="expenseOwnerId" :title="`${fromName} → ${toName}交通费用`" :default-category="expenseCategory" :transport-mode="mode" />

    <ElPopover
      v-if="isManual"
      v-model:visible="manualOpen"
      placement="bottom-start"
      :width="430"
      trigger="click"
      popper-class="manual-transport-popover"
    >
      <template #reference>
        <ElButton text circle size="small" class="transport-edit-button" :title="row.route?.pending ? '填写交通用时' : '编辑交通用时'" :disabled="store.readOnly">
          <i :class="row.route?.pending ? 'pi pi-plus' : 'pi pi-pencil'" />
        </ElButton>
      </template>
      <div class="manual-transport-editor">
        <div class="manual-transport-head">
          <strong>{{ meta.label }}信息</strong>
          <span>{{ fromName }} → {{ toName }}</span>
        </div>
        <p>该方式不使用道路导航结果，请填写可靠的实际用时；里程可以留空。</p>
        <div class="manual-transport-schedule"><label><span>班次 / 航班号</span><ElInput v-model="transportNumber" placeholder="例如 G123、CA1234" /></label><div><label><span>出发站</span><ElInput v-model="transportFrom" /></label><label><span>到达站</span><ElInput v-model="transportTo" /></label></div><div><label><span>出发时间</span><ElTimePicker v-model="departureTime" format="HH:mm" value-format="HH:mm" clearable /></label><label><span>到达时间</span><ElTimePicker v-model="arrivalTime" format="HH:mm" value-format="HH:mm" clearable /></label><label><span>提前到达（分钟）</span><ElInputNumber v-model="advanceMinutes" :min="0" :max="360" :step="15" controls-position="right" /></label></div><div class="transport-ticket-fields"><label><span>票务状态</span><ElSelect v-model="ticketStatus" :teleported="false"><ElOption label="未处理" value="none" /><ElOption label="待购票" value="pending" /><ElOption label="已预订" value="booked" /><ElOption label="已出票" value="ticketed" /><ElOption label="已退票" value="refunded" /></ElSelect></label><label><span>订单 / 座位 / 退改备注</span><ElInput v-model="ticketNote" placeholder="订单号、座位、出票平台或退改规则" /></label></div></div>
        <div v-if="!scheduledDuration" class="manual-transport-time">
          <label><span>小时</span><ElInputNumber v-model="manualHours" class="manual-transport-hours" :min="0" :max="48" controls-position="right" size="small" /></label>
          <label><span>分钟</span><ElInputNumber v-model="manualMinutes" class="manual-transport-minutes" :min="0" :max="59" :step="5" controls-position="right" size="small" /></label>
        </div>
        <div v-if="scheduledDuration" class="manual-transport-derived"><i class="pi pi-clock" />已根据班次时间计算用时：{{ formatDuration(scheduledDuration) }}</div>
        <label class="manual-transport-distance">
          <span>里程（公里，可选）</span>
          <ElInputNumber v-model="manualDistance" class="manual-transport-km" :min="0" :max="30000" controls-position="right" size="small" placeholder="未填写时仅展示直线距离" />
        </label>
        <div class="manual-transport-actions">
          <span>计划用时：{{ effectiveDuration ? formatDuration(effectiveDuration) : '尚未填写' }}</span>
          <ElButton size="small" @click="manualOpen = false">取消</ElButton>
          <ElButton type="primary" size="small" :disabled="effectiveDuration < 1 || store.readOnly" @click="saveManualTransport">保存</ElButton>
        </div>
      </div>
    </ElPopover>
  </div>
</template>

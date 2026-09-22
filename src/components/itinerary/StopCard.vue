<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElTimePicker } from 'element-plus'
import { writeDragPayload, readDragPayload } from '../../domain/drag'
import { formatDuration } from '../../domain/schedule'
import { derivePlaceRisks, highestRiskSeverity } from '../../risk/engine'
import type { ScheduleRow, Stop, TripDay } from '../../domain/types'
import { planMapProvider } from '../../map/provider'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import { useWeatherStore } from '../../stores/weather'
import { planDayDateKey } from '../../weather/types'
import ExpenseEditorPopover from '../budget/ExpenseEditorPopover.vue'
import CategoryIcon from '../ui/CategoryIcon.vue'
import PlacePriorityPicker from '../places/PlacePriorityPicker.vue'
import RiskBadge from '../risk/RiskBadge.vue'
import WeatherBadge from '../weather/WeatherBadge.vue'
import TransportSegmentControl from './TransportSegmentControl.vue'

const props = defineProps<{
  day: TripDay
  stop: Stop
  index: number
  row: ScheduleRow
  dayOk: boolean
  nextConflict: boolean
}>()

const store = usePlannerStore()
const plans = usePlansStore()
const weatherStore = useWeatherStore()
const dropPosition = ref<'before' | 'after' | null>(null)
const dragging = ref(false)
const editingTimeField = ref<'arrival' | 'departure' | null>(null)
let editingReleaseTimer = 0
const isExplicit = computed(() => props.stop.arrivalTime != null || props.stop.departureTime != null || props.stop.pinned != null)
const stayDuration = computed(() => Math.max(0, props.row.departure - props.row.arrival))
const weatherDate = computed(() => plans.activePlan ? planDayDateKey(plans.activePlan.metadata.startAt, store.days, props.day.id) : '')
const weather = computed(() => {
  if (!weatherDate.value) return null
  const result = weatherStore.weatherFor(props.stop.placeId, weatherDate.value)
  return result?.status === 'available' ? result : null
})
const risks = computed(() => weatherDate.value
  ? derivePlaceRisks(store.places[props.stop.placeId], weatherDate.value, weather.value, weatherStore.alertsFor(props.stop.placeId))
  : [])
const riskSeverity = computed(() => highestRiskSeverity(risks.value))
const readinessPending = computed(() => {
  const place = store.places[props.stop.placeId]
  let count = 0
  if (place.reservationRequired && !['booked', 'ticketed'].includes(place.reservationStatus ?? 'none')) count += 1
  const hasUnknownExpense = [...store.expensesForOwner('stop', props.stop.uid), ...store.expensesForOwner('place', props.stop.placeId)].some((item) => item.status === 'unknown')
  if (hasUnknownExpense) count += 1
  const mode = props.stop.transportMode ?? 'driving'
  if (['transit', 'train', 'flight', 'ferry'].includes(mode) && !['booked', 'ticketed'].includes(props.stop.transportTicketStatus ?? 'none')) count += 1
  return count
})

function focusPlaceOnMap(): void {
  const place = store.places[props.stop.placeId]
  if (!place) return
  store.selectPlace(place.id)
  planMapProvider.focusPlace(place)
}

function onDragStart(event: DragEvent): void {
  if (store.readOnly) { event.preventDefault(); return }
  dragging.value = true
  writeDragPayload(event, { type: 'stop', uid: props.stop.uid })
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  const element = event.currentTarget as HTMLElement
  const bounds = element.getBoundingClientRect()
  dropPosition.value = event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after'
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  event.stopPropagation()
  if (store.readOnly) return
  const payload = readDragPayload(event)
  if (!payload) return
  const targetIndex = props.index + (dropPosition.value === 'after' ? 1 : 0)
  if (payload.type === 'pool') store.addPlace(payload.placeId, props.day.id, targetIndex)
  else store.moveStop(payload.uid, props.day.id, targetIndex)
  dropPosition.value = null
}

function minutesToDate(minutes: number): Date {
  const normalized = ((minutes % 1440) + 1440) % 1440
  const value = new Date(2000, 0, 1, 0, 0, 0, 0)
  value.setHours(Math.floor(normalized / 60), normalized % 60, 0, 0)
  return value
}

function dateToMinutes(value: Date | null): number | null {
  if (!value || Number.isNaN(value.getTime())) return null
  return value.getHours() * 60 + value.getMinutes()
}

const arrivalValue = ref<Date | null>(minutesToDate(props.row.arrival))
const departureValue = ref<Date | null>(minutesToDate(props.row.departure))

watch(() => props.row.arrival, (minutes) => {
  if (editingTimeField.value === 'arrival') return
  if (dateToMinutes(arrivalValue.value) !== ((minutes % 1440) + 1440) % 1440) {
    arrivalValue.value = minutesToDate(minutes)
  }
})

watch(() => props.row.departure, (minutes) => {
  if (editingTimeField.value === 'departure') return
  if (dateToMinutes(departureValue.value) !== ((minutes % 1440) + 1440) % 1440) {
    departureValue.value = minutesToDate(minutes)
  }
})

function beginTimeEdit(field: 'arrival' | 'departure'): void {
  window.clearTimeout(editingReleaseTimer)
  editingTimeField.value = field
}

function releaseTimeEdit(): void {
  window.clearTimeout(editingReleaseTimer)
  editingReleaseTimer = window.setTimeout(() => { editingTimeField.value = null }, 160)
}

function commitTime(field: 'arrival' | 'departure', minutes: number): void {
  const current = field === 'arrival'
    ? props.stop.arrivalTime ?? props.stop.pinned
    : props.stop.departureTime
  if (current === minutes) return
  store.setStopTime(props.stop.uid, field, minutes)
}

function updateTime(field: 'arrival' | 'departure', value: Date | null): void {
  const minutes = dateToMinutes(value)
  if (minutes !== null) commitTime(field, minutes)
}

function updateTimeFromInput(field: 'arrival' | 'departure', event: FocusEvent): void {
  const match = /^(\d{1,2}):(\d{2})$/.exec((event.target as HTMLInputElement).value.trim())
  if (match) {
    const hours = Number(match[1])
    const minutes = Number(match[2])
    if (hours <= 23 && minutes <= 59) commitTime(field, hours * 60 + minutes)
  }
  releaseTimeEdit()
}

onBeforeUnmount(() => window.clearTimeout(editingReleaseTimer))
</script>

<template>
  <div
    class="stopwrap"
    :class="{
      'drop-before': dropPosition === 'before',
      'drop-after': dropPosition === 'after',
    }"
    @dragover="onDragOver"
    @dragleave="dropPosition = null"
    @drop="onDrop"
  >
    <div class="dropmarker before" />
    <div
      class="stopcard stopcard-time-range"
      :class="[
        {
          selected: store.selectedPlaceId === stop.placeId,
          dragging,
          conflict: row.conflict,
          'read-only': store.readOnly,
        },
        weather?.kind ? `weather-${weather.kind}` : '',
        riskSeverity ? `risk-${riskSeverity}` : '',
      ]"
      :data-place="stop.placeId"
      :draggable="!store.readOnly"
      @dragstart="onDragStart"
      @dragend="dragging = false"
      @click="store.selectPlace(stop.placeId)"
    >
      <div class="stopmain">
        <div class="stopline">
          <span class="draghandle">⠿</span>
          <button type="button" class="place-map-focus-button" :title="`在地图上定位 ${store.places[stop.placeId].name}`" :aria-label="`在地图上定位 ${store.places[stop.placeId].name}`" @pointerdown.stop @click.stop="focusPlaceOnMap"><CategoryIcon :category="store.places[stop.placeId].category" /></button>
          <span class="stopname">{{ store.places[stop.placeId].name }}</span>
          <PlacePriorityPicker :model-value="store.places[stop.placeId].priority" @change="store.setPlacePriority(stop.placeId, $event)" />
          <ExpenseEditorPopover owner-type="stop" :owner-id="stop.uid" :title="`${store.places[stop.placeId].name}费用`" :default-category="store.places[stop.placeId].category === 'lodging' ? 'lodging' : store.places[stop.placeId].category === 'food' ? 'meal' : 'ticket'" />
          <button v-if="readinessPending" type="button" class="stop-readiness pending" :title="`${readinessPending} 项出发前事项待处理`" @click.stop="store.selectPlace(stop.placeId)"><i class="pi pi-flag" />{{ readinessPending }} 项待处理</button>
        </div>
        <div class="stopsub">{{ store.places[stop.placeId].type }}</div>

        <div class="stop-time-range" @click.stop @mousedown.stop>
          <label @focusin="beginTimeEdit('arrival')" @pointerdown="beginTimeEdit('arrival')">
            <span>到达</span>
            <ElTimePicker
              v-model="arrivalValue"
              class="stop-time-picker stop-time-arrival"
              :class="{ conflict: row.conflict }"
              format="HH:mm"
              :clearable="false"
              :disabled="store.readOnly"
              @focus="beginTimeEdit('arrival')"
              @change="updateTime('arrival', $event)"
              @blur="updateTimeFromInput('arrival', $event)"
            />
          </label>
          <span class="time-range-arrow"><i class="pi pi-arrow-right" /></span>
          <label @focusin="beginTimeEdit('departure')" @pointerdown="beginTimeEdit('departure')">
            <span>离开</span>
            <ElTimePicker
              v-model="departureValue"
              class="stop-time-picker stop-time-departure"
              :class="{ conflict: row.conflict }"
              format="HH:mm"
              :clearable="false"
              :disabled="store.readOnly"
              @focus="beginTimeEdit('departure')"
              @change="updateTime('departure', $event)"
              @blur="updateTimeFromInput('departure', $event)"
            />
          </label>
          <span class="stop-duration">{{ formatDuration(stayDuration) }}</span>
          <span class="time-source" :class="{ fixed: isExplicit }">{{ isExplicit ? '已设置' : '自动' }}</span>
          <ElButton
            v-if="isExplicit"
            text
            circle
            size="small"
            class="reset-time-button"
            title="恢复自动推导时间"
            :disabled="store.readOnly"
            @click.stop="store.resetStopTimes(stop.uid)"
          ><i class="pi pi-refresh" /></ElButton>
        </div>

        <div v-if="row.wait && !row.conflict" class="time-wait-hint"><i class="pi pi-clock" /> 等待 {{ formatDuration(row.wait) }}</div>
        <div v-if="row.conflict" class="time-conflict-message">
          <i class="pi pi-exclamation-triangle" />
          <span>{{ row.conflictMessages.join('；') }}</span>
        </div>
      </div>
      <div class="stopactions">
        <WeatherBadge v-if="weather" :weather="weather" />
        <RiskBadge v-if="risks.length" :risks="risks" />
        <ElButton text circle size="small" type="danger" class="minibtn" title="移回地点池" :disabled="store.readOnly" @click.stop="store.removeStop(stop.uid)"><i class="pi pi-times" /></ElButton>
      </div>
    </div>
    <div v-if="row.route" class="segment">
      <span />
      <TransportSegmentControl
        :stop="stop"
        :row="row"
        :to-place-id="day.stops[index + 1].placeId"
        :conflict="row.conflict && nextConflict"
      />
    </div>
    <div class="dropmarker after" />
  </div>
</template>

<style scoped>
.stopcard.read-only {
  cursor: default;
}
.stopcard.read-only .draghandle {
  cursor: not-allowed;
  opacity: 0.5;
}
</style>

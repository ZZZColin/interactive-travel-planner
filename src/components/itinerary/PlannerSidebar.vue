<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { ElButton, ElInputNumber, ElPopover } from 'element-plus'
import { formatDuration } from '../../domain/schedule'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import { useWeatherStore } from '../../stores/weather'
import { weatherForecastCoverage } from '../../weather/types'
import CandidatePool from '../places/CandidatePool.vue'
import DayItinerary from './DayItinerary.vue'
import DayTabs from './DayTabs.vue'
import PlanTimelineStatus from './PlanTimelineStatus.vue'
import { currentLocale } from '../../i18n'

const props = defineProps<{ demoMode?: boolean }>()

const emit = defineEmits<{
  batch: []
  aiImport: []
  adjustBoundary: [boundary: 'start' | 'end', action: 'add' | 'remove']
  weatherSettings: []
}>()

const store = usePlannerStore()
const plans = usePlansStore()
const weather = useWeatherStore()
const { selectedDay, overall, allScheduledIds, known, currentSchedule } = storeToRefs(store)
const driveLimitOpen = ref(false)
const driveLimitHours = ref(6)
const driveLimitMinutes = ref(0)
const driveLimitTotal = computed(() => driveLimitHours.value * 60 + driveLimitMinutes.value)
let weatherSyncFrame = 0
let weatherSyncTimer = 0
const weatherCoverage = computed(() => {
  const definition = weather.selectedProviderDefinition
  const startAt = plans.activePlan?.metadata.startAt
  return definition && startAt ? weatherForecastCoverage(startAt, store.days, definition.maxForecastDays) : null
})
const weatherCoverageDate = computed(() => weatherCoverage.value?.firstAvailableDate
  ? new Intl.DateTimeFormat(currentLocale(), { month: 'long', day: 'numeric' }).format(new Date(`${weatherCoverage.value.firstAvailableDate}T00:00:00`))
  : '')
const weatherSyncSignature = computed(() => [
  weather.selectedProviderId,
  plans.activePlan?.metadata.startAt ?? '',
  ...store.days.flatMap((day) => day.stops.map((stop) => {
    const place = store.places[stop.placeId]
    return `${day.id}:${stop.placeId}:${place?.lng ?? ''}:${place?.lat ?? ''}`
  })),
].join('|'))

function resetDriveLimitDraft(): void {
  driveLimitHours.value = Math.floor(selectedDay.value.maxDrive / 60)
  driveLimitMinutes.value = selectedDay.value.maxDrive % 60
}

function chooseDriveLimit(hours: number): void {
  driveLimitHours.value = hours
  driveLimitMinutes.value = 0
}

function saveDriveLimit(): void {
  store.setDayMaxDrive(selectedDay.value.id, driveLimitTotal.value)
  driveLimitOpen.value = false
}

function scheduleWeatherSync(): void {
  window.cancelAnimationFrame(weatherSyncFrame)
  window.clearTimeout(weatherSyncTimer)
  weatherSyncFrame = window.requestAnimationFrame(() => {
    weatherSyncTimer = window.setTimeout(() => {
      const startAt = plans.activePlan?.metadata.startAt
      if (startAt) weather.syncPlan(store.days, store.places, startAt)
    }, 0)
  })
}

watch(weatherSyncSignature, scheduleWeatherSync, { immediate: true })
onBeforeUnmount(() => {
  window.cancelAnimationFrame(weatherSyncFrame)
  window.clearTimeout(weatherSyncTimer)
})

watch(driveLimitOpen, (open) => {
  if (open) resetDriveLimitDraft()
})

watch(() => selectedDay.value.id, () => {
  driveLimitOpen.value = false
  resetDriveLimitDraft()
})
</script>

<template>
  <aside class="left">
    <div class="panelhead compact-planner-head">
      <div class="planner-headline">
        <span class="statuspill" :class="{ warn: !overall.ok }">{{ overall.ok ? '计划可行' : `${overall.warnedDays.length + overall.missing.length} 个问题` }}</span>
        <span class="planner-head-metric"><b>{{ allScheduledIds.size }}</b> / {{ known.length }} 地点</span>
        <PlanTimelineStatus />
      </div>
      <div v-if="weather.selectedProviderId !== 'none' && !weather.selectedProviderConfigured" class="weather-range-banner unconfigured">
        <i class="pi pi-exclamation-circle" />
        <span><b>{{ weather.selectedProviderDefinition?.name }}尚未配置</b>完成服务商配置后，将自动查询已安排地点的天气。</span>
        <button @click="emit('weatherSettings')">配置</button>
      </div>
      <div v-else-if="weatherCoverage?.futureOutOfRangeDays" class="weather-range-banner">
        <i class="pi pi-cloud" />
        <span><b>{{ weather.selectedProviderDefinition?.name }}最长预报 {{ weather.selectedProviderDefinition?.maxForecastDays }} 天</b>当前有 {{ weatherCoverage.futureOutOfRangeDays }} 天超出范围<span v-if="weatherCoverageDate">，预计 {{ weatherCoverageDate }} 起可陆续查询</span></span>
        <button @click="emit('weatherSettings')">设置</button>
      </div>
    </div>

    <DayTabs @adjust="(boundary, action) => emit('adjustBoundary', boundary, action)" />

    <div class="toolbar compact-day-toolbar">
      <span class="toolspacer" />
      <ElPopover
        v-model:visible="driveLimitOpen"
        placement="bottom-end"
        :width="300"
        trigger="click"
        popper-class="drive-limit-popover"
      >
        <template #reference>
          <ElButton
            text
            size="small"
            class="drive-limit-trigger"
            :class="{ warn: currentSchedule.drive > selectedDay.maxDrive }"
          >
            <i class="pi pi-car" />驾驶上限 {{ formatDuration(selectedDay.maxDrive) }}
          </ElButton>
        </template>
        <div class="drive-limit-editor">
          <div class="drive-limit-editor-head">
            <strong>{{ selectedDay.label }} 驾驶上限</strong>
            <span>只影响当前日期</span>
          </div>
          <div class="drive-limit-inputs">
            <label>
              <span>小时</span>
              <ElInputNumber
                v-model="driveLimitHours"
                class="drive-limit-hours"
                :min="0"
                :max="24"
                :step="1"
                controls-position="right"
                size="small"
              />
            </label>
            <label>
              <span>分钟</span>
              <ElInputNumber
                v-model="driveLimitMinutes"
                class="drive-limit-minutes"
                :min="0"
                :max="59"
                :step="15"
                controls-position="right"
                size="small"
              />
            </label>
          </div>
          <div class="drive-limit-presets">
            <button v-for="hours in [4, 6, 8, 10]" :key="hours" @click="chooseDriveLimit(hours)">{{ hours }} 小时</button>
          </div>
          <div class="drive-limit-actions">
            <span>当前设置：{{ formatDuration(driveLimitTotal) }}</span>
            <ElButton size="small" @click="driveLimitOpen = false">取消</ElButton>
            <ElButton type="primary" size="small" :disabled="driveLimitTotal < 30" @click="saveDriveLimit">保存</ElButton>
          </div>
        </div>
      </ElPopover>
      <button v-if="props.demoMode" class="textbtn" @click="store.quickConflict">演示超时</button>
    </div>

    <div class="itinerary">
      <DayItinerary />
    </div>

    <CandidatePool @batch="emit('batch')" @ai-import="emit('aiImport')" />
  </aside>
</template>

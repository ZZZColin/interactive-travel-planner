<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElOption, ElSelect } from 'element-plus'
import { readDragPayload } from '../../domain/drag'
import { formatMoney } from '../../domain/budget'
import { formatDuration, formatTime, routeInfo, scheduleDay } from '../../domain/schedule'
import { previousPlanStop } from '../../domain/routeProjection'
import { transportModeOf } from '../../domain/transport'
import type { ScheduleRow, TripDay } from '../../domain/types'
import { usePlannerStore } from '../../stores/planner'
import ExpenseEditorPopover from '../budget/ExpenseEditorPopover.vue'
import StopCard from './StopCard.vue'
import DayRouteOptions from './DayRouteOptions.vue'
import TransportSegmentControl from './TransportSegmentControl.vue'

const store = usePlannerStore()
const dragOverDayId = ref<string | null>(null)

const dayRows = computed(() => store.days.map((day, dayIndex) => {
  const previousStop = previousPlanStop(store.days, day.id)
  const schedule = scheduleDay(day, store.places, store.routeCache, previousStop)
  const firstStop = day.stops[0]
  const entryRoute = previousStop && firstStop && previousStop.placeId !== firstStop.placeId
    ? routeInfo(previousStop, firstStop, store.places, store.routeCache)
    : null
  const entryRow: ScheduleRow | null = entryRoute ? {
    arrival: day.start,
    departure: day.start,
    expectedArrival: day.start,
    wait: 0,
    late: false,
    conflict: false,
    conflictMessages: [],
    route: entryRoute,
  } : null
  return {
    day,
    dayIndex,
    previousStop,
    entryRow,
    schedule,
    budget: store.getBudgetSummary(1).dayTotals[day.id] ?? 0,
    routeName: day.stops.map((stop) => store.places[stop.placeId]?.name.replace('酒店', '')).filter(Boolean).join(' → '),
    mixedTransport: day.stops.slice(0, -1).some((stop) => transportModeOf(stop.transportMode) !== 'driving')
      || Boolean(previousStop && transportModeOf(previousStop.transportMode) !== 'driving'),
  }
}))

function dropAtEnd(event: DragEvent, day: TripDay): void {
  event.preventDefault()
  const payload = readDragPayload(event)
  if (!payload) return
  if (payload.type === 'pool') store.addPlace(payload.placeId, day.id, day.stops.length)
  else store.moveStop(payload.uid, day.id, day.stops.length)
  dragOverDayId.value = null
}
</script>

<template>
  <div class="continuous-itinerary">
    <section
      v-for="item in dayRows"
      :key="item.day.id"
      :data-day-section="item.day.id"
      class="continuous-day-section"
      :class="{ active: store.selectedDayId === item.day.id, warn: !item.schedule.ok, dragover: dragOverDayId === item.day.id }"
      @click.self="store.selectDay(item.day.id)"
      @dragover.prevent="dragOverDayId = item.day.id"
      @dragleave="dragOverDayId = null"
      @drop="dropAtEnd($event, item.day)"
    >
      <header class="continuous-day-header" @click="store.selectDay(item.day.id)">
        <div class="continuous-day-title"><b>{{ item.day.label }}</b><span>{{ item.day.date }}</span></div>
        <span class="routehint">{{ item.routeName || `从 ${formatTime(item.day.start)} 开始` }}</span>
        <div v-if="item.day.stops.length" class="daymetrics" @click.stop>
          <span>{{ item.schedule.km }} km</span>
          <span :class="{ bad: !item.schedule.ok }">{{ item.mixedTransport ? '交通' : '驾驶' }} {{ formatDuration(item.mixedTransport ? item.schedule.travel : item.schedule.drive) }}</span>
          <span>{{ formatTime(item.schedule.finish) }} 完成</span>
          <DayRouteOptions :day="item.day" />
          <ElSelect v-if="item.dayIndex < store.days.length - 1" :model-value="item.day.overnightMode ?? 'auto'" size="small" class="overnight-mode-select" aria-label="当晚住宿方式" @change="store.setDayOvernightMode(item.day.id, $event)"><ElOption label="自动识别住宿" value="auto" /><ElOption label="夜间交通" value="night-transport" /><ElOption label="露营" value="camping" /><ElOption label="住亲友家" value="friends" /><ElOption label="无需住宿" value="no-lodging" /></ElSelect>
          <span v-if="item.budget" class="day-budget-total">{{ formatMoney(item.budget) }}</span>
          <ExpenseEditorPopover owner-type="day" :owner-id="item.day.id" :title="`${item.day.label}公共费用`" default-category="lodging" />
        </div>
      </header>

      <div v-if="!item.schedule.ok" class="warningbar"><span class="warningicon">!</span><div>{{ item.schedule.warnings.join('；') }}</div></div>

      <div v-if="item.entryRow && item.previousStop && item.day.stops[0]" class="cross-day-segment">
        <div class="cross-day-label"><span>承接上一日</span><b>{{ store.places[item.previousStop.placeId]?.name }} → {{ store.places[item.day.stops[0].placeId]?.name }}</b></div>
        <TransportSegmentControl :stop="item.previousStop" :row="item.entryRow" :to-place-id="item.day.stops[0].placeId" :conflict="false" />
      </div>

      <div v-if="!item.day.stops.length" class="emptyday">把未安排地点拖到 {{ item.day.label }}</div>
      <template v-else>
        <StopCard
          v-for="(stop, index) in item.day.stops"
          :key="stop.uid"
          :day="item.day"
          :stop="stop"
          :index="index"
          :row="item.schedule.rows[index]"
          :day-ok="item.schedule.ok"
          :next-conflict="item.schedule.rows[index + 1]?.conflict ?? false"
        />
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { ElButton } from 'element-plus'
import { readDragPayload } from '../../domain/drag'
import { scheduleDay } from '../../domain/schedule'
import { previousPlanStop } from '../../domain/routeProjection'
import { usePlannerStore } from '../../stores/planner'

const emit = defineEmits<{ adjust: [boundary: 'start' | 'end', action: 'add' | 'remove'] }>()
const store = usePlannerStore()
const { days, selectedDayId, places, routeCache } = storeToRefs(store)
const dragOverId = ref<string | null>(null)

const dayItems = computed(() => days.value.map((day) => ({
  day,
  schedule: scheduleDay(day, places.value, routeCache.value, previousPlanStop(days.value, day.id)),
})))

function dropOnDay(event: DragEvent, dayId: string): void {
  event.preventDefault()
  if (store.readOnly) return
  const payload = readDragPayload(event)
  const day = days.value.find((item) => item.id === dayId)
  if (!payload || !day) return
  if (payload.type === 'pool') store.addPlace(payload.placeId, dayId, day.stops.length)
  else store.moveStop(payload.uid, dayId, day.stops.length)
  store.selectDay(dayId)
  dragOverId.value = null
}
</script>

<template>
  <div class="daytabsbar">
    <div class="day-boundary-control start" title="调整开始日期">
      <ElButton text circle size="small" title="向前增加一天" :disabled="store.readOnly" @click="emit('adjust', 'start', 'add')"><i class="pi pi-plus" /></ElButton>
      <ElButton text circle size="small" title="移除第一天" :disabled="days.length <= 1 || store.readOnly" @click="emit('adjust', 'start', 'remove')"><i class="pi pi-minus" /></ElButton>
    </div>

    <div class="daytabs">
      <button
        v-for="item in dayItems"
        :key="item.day.id"
        class="daytab"
        :class="{ active: selectedDayId === item.day.id, warn: !item.schedule.ok, dragover: dragOverId === item.day.id }"
        @click="store.selectDay(item.day.id)"
        @dragover.prevent="dragOverId = item.day.id"
        @dragleave="dragOverId = null"
        @drop="dropOnDay($event, item.day.id)"
      >
        <span>{{ item.day.date }}</span>
        <b>{{ item.day.label }}<i v-if="!item.schedule.ok" class="pi pi-exclamation-circle daytab-warning" title="当天安排存在问题" /></b>
      </button>
    </div>

    <div class="day-boundary-control end" title="调整结束日期">
      <ElButton text circle size="small" title="向后增加一天" :disabled="store.readOnly" @click="emit('adjust', 'end', 'add')"><i class="pi pi-plus" /></ElButton>
      <ElButton text circle size="small" title="移除最后一天" :disabled="days.length <= 1 || store.readOnly" @click="emit('adjust', 'end', 'remove')"><i class="pi pi-minus" /></ElButton>
    </div>
  </div>
</template>

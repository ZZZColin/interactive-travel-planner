<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { usePlansStore } from '../../stores/plans'

const plans = usePlansStore()
const now = ref(Date.now())
let timer = 0

function remainingText(milliseconds: number): string {
  const totalMinutes = Math.max(0, Math.floor(milliseconds / 60_000))
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  if (days > 0) return `${days}天${hours ? `${hours}小时` : ''}`
  if (hours > 0) return `${hours}小时${minutes ? `${minutes}分` : ''}`
  return `${minutes}分钟`
}

const status = computed(() => {
  const plan = plans.activePlan
  if (!plan) return { label: '未选择计划', detail: '', tone: 'secondary', icon: 'pi pi-clock' }
  const start = new Date(plan.metadata.startAt).getTime()
  const end = new Date(plan.metadata.endAt).getTime()
  if (now.value < start) {
    return { label: '未开始', detail: `${remainingText(start - now.value)}后出发`, tone: 'primary', icon: 'pi pi-calendar-clock' }
  }
  if (now.value <= end) {
    return { label: '进行中', detail: `剩余${remainingText(end - now.value)}`, tone: 'success', icon: 'pi pi-play-circle' }
  }
  return { label: '已结束', detail: `${remainingText(now.value - end)}前结束`, tone: 'secondary', icon: 'pi pi-check-circle' }
})

onMounted(() => { timer = window.setInterval(() => { now.value = Date.now() }, 1000) })
onBeforeUnmount(() => window.clearInterval(timer))
</script>

<template>
  <div class="plan-timeline-status" :class="status.tone" :title="status.detail">
    <i :class="status.icon" />
    <b>{{ status.label }}</b>
    <span v-if="status.detail">· {{ status.detail }}</span>
  </div>
</template>

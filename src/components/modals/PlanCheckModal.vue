<script setup lang="ts">
import { computed, watch } from 'vue'
import { ElButton, ElDialog, ElTag } from 'element-plus'
import { formatMoney } from '../../domain/budget'
import { checkDayContinuity } from '../../domain/continuity'
import { calculateReadiness } from '../../domain/readiness'
import { checkPlaceConstraints } from '../../domain/placeConstraints'
import { formatDuration, scheduleDay } from '../../domain/schedule'
import { previousPlanStop } from '../../domain/routeProjection'
import { derivePlaceRisks, highestRiskSeverity } from '../../risk/engine'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import { useWeatherStore } from '../../stores/weather'
import { planMapProvider } from '../../map/provider'
import { planDayDateKey } from '../../weather/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; optimize: []; navigateDay: [dayId: string]; navigatePlace: [placeId: string, dayId?: string]; budget: [] }>()
const store = usePlannerStore()
const plans = usePlansStore()
const weatherStore = useWeatherStore()


function daySchedule(day: typeof store.days[number]) {
  return scheduleDay(day, store.places, store.routeCache, previousPlanStop(store.days, day.id))
}

const usedDays = computed(() => store.days.filter((day) => day.stops.length))
const totalKm = computed(() => usedDays.value.reduce((sum, day) => sum + daySchedule(day).km, 0))
const budgetSummary = computed(() => store.getBudgetSummary(Math.max(1, plans.activePlan?.metadata.participants.length ?? 1)))
const budgetReady = computed(() => budgetSummary.value.warnings.length === 0)
const riskRows = computed(() => {
  const startAt = plans.activePlan?.metadata.startAt
  if (!startAt) return []
  return store.days.flatMap((day) => {
    const date = planDayDateKey(startAt, store.days, day.id)
    return day.stops.flatMap((stop) => {
      const place = store.places[stop.placeId]
      const weather = weatherStore.weatherFor(stop.placeId, date)
      return derivePlaceRisks(place, date, weather, weatherStore.alertsFor(stop.placeId)).map((risk) => ({ day, place, risk }))
    })
  })
})
const highestRisk = computed(() => highestRiskSeverity(riskRows.value.map((row) => row.risk)))
const significantRiskCount = computed(() => riskRows.value.filter((row) => row.risk.severity === 'warning' || row.risk.severity === 'critical').length)
const totalTravel = computed(() => usedDays.value.reduce((sum, day) => sum + daySchedule(day).travel, 0))
const continuityIssues = computed(() => checkDayContinuity(store.days, store.places, store.routeCache))
const readiness = computed(() => calculateReadiness(store.days, store.places, store.routeCache, budgetSummary.value.unknownCount))
const placeConstraintIssues = computed(() => checkPlaceConstraints(store.days, store.places, store.routeCache))

watch(() => props.open, (open) => {
  if (!open) return
  store.days.slice(0, -1).forEach((day, index) => {
    const fromStop = day.stops[day.stops.length - 1]
    const toStop = store.days[index + 1]?.stops[0]
    if (!fromStop || !toStop || fromStop.placeId === toStop.placeId) return
    const from = store.places[fromStop.placeId]
    const to = store.places[toStop.placeId]
    if (!from || !to) return
    void planMapProvider.estimateRoute(from, to, 'driving').then((route) => { if (route) store.setRouteValue(from.id, to.id, 'driving', route.km, route.min, route.toll) }).catch(() => {})
  })
})
</script>

<template>
  <ElDialog
    :model-value="open"
    class="travel-dialog resultmodal"
    width="590px"
    align-center
    destroy-on-close
    @update:model-value="!$event && emit('close')"
  >
    <template #header>
      <div class="dialog-result-header">
        <div class="dialog-result-icon" :class="{ warning: !store.overall.ok || !budgetReady || significantRiskCount > 0 || continuityIssues.length > 0 || placeConstraintIssues.length > 0 }">
          <i :class="store.overall.ok && budgetReady && significantRiskCount === 0 && continuityIssues.length === 0 && placeConstraintIssues.length === 0 ? 'pi pi-check' : 'pi pi-exclamation-triangle'" />
        </div>
        <div>
          <h2>{{ !store.overall.ok
            ? `还有 ${store.overall.warnedDays.length + store.overall.missing.length} 个行程问题需要处理`
            : continuityIssues.length
              ? `行程可行，仍有 ${continuityIssues.length} 项跨日衔接需要处理`
              : placeConstraintIssues.length
                ? `行程可行，仍有 ${placeConstraintIssues.length} 项营业或预约约束需要处理`
              : !budgetReady
              ? `行程可行，预算仍有 ${budgetSummary.warnings.length} 类信息待完善`
              : significantRiskCount
                ? `行程可行，仍有 ${significantRiskCount} 项重要风险需要关注`
                : '计划、预算和风险检查已经形成闭环' }}</h2>
          <p>路线使用确定性校验；预算明确区分未知、预计、已确认和已支付。</p>
        </div>
      </div>
    </template>

    <section class="readiness-overview"><div class="readiness-score"><strong>{{ readiness.percent }}%</strong><span>出发准备完成度</span></div><div><b>已完成 {{ readiness.completed }} / {{ readiness.total }} 项</b><span v-if="readiness.tasks.length">还有 {{ readiness.tasks.length }} 项需要处理</span><span v-else>当前已具备出发条件</span></div><ElProgress :percentage="readiness.percent" :stroke-width="8" :show-text="false" /></section>
    <div v-if="readiness.tasks.length" class="readiness-task-list"><button v-for="task in readiness.tasks" :key="task.id" type="button" :class="`task-${task.severity}`" @click="task.category === 'budget' ? emit('budget') : task.placeId ? emit('navigatePlace', task.placeId, task.dayId) : task.dayId ? emit('navigateDay', task.dayId) : undefined"><i :class="task.category === 'lodging' ? 'pi pi-home' : task.category === 'transport' ? 'pi pi-ticket' : task.category === 'reservation' ? 'pi pi-calendar' : task.category === 'budget' ? 'pi pi-wallet' : 'pi pi-clock'" /><span><b>{{ task.title }}</b><small>{{ task.detail }}</small></span><em>处理</em></button></div>

    <div class="resultgrid">
      <div class="resultmetric"><span>已安排日期</span><b>{{ usedDays.length }} 天</b></div>
      <div class="resultmetric"><span>总交通用时</span><b>{{ formatDuration(totalTravel) }}</b></div>
      <div class="resultmetric"><span>总里程</span><b>{{ totalKm }} km</b></div>
      <div class="resultmetric"><span>预计预算</span><b>{{ formatMoney(budgetSummary.totalExpected) }}</b></div>
    </div>
    <div class="checklist themed-list-scroll">
      <button v-for="day in usedDays" :key="day.id" type="button" class="checkrow actionable" @click="emit('navigateDay', day.id)">
        <i :class="{ warn: !daySchedule(day).ok }" />
        <b>{{ day.label }}</b>
        <span>
          {{ daySchedule(day).km }} km ·
          交通 {{ formatDuration(daySchedule(day).travel) }}
        </span>
        <ElTag :type="daySchedule(day).ok ? 'success' : 'danger'" round effect="light">
          {{ daySchedule(day).ok ? '可行' : '需调整' }}
        </ElTag>
      </button>
      <button v-for="place in store.overall.missing" :key="place.id" type="button" class="checkrow actionable" @click="emit('navigatePlace', place.id)">
        <i class="warn" /><b>{{ place.name }}</b><span>必去地点尚未安排</span><ElTag type="danger" round effect="light">去安排</ElTag>
      </button>
    </div>
    <div v-if="placeConstraintIssues.length" class="place-constraint-warnings"><strong><i class="pi pi-calendar-clock" />营业与预约 {{ placeConstraintIssues.length }} 项</strong><button v-for="issue in placeConstraintIssues" :key="issue.id" type="button" @click="emit('navigatePlace', issue.placeId, issue.dayId)"><span>• {{ issue.title }}</span><small>{{ issue.detail }}</small><em>处理</em></button></div>
    <div v-if="continuityIssues.length" class="continuity-check-warnings">
      <strong><i class="pi pi-link" />跨日衔接 {{ continuityIssues.length }} 项</strong>
      <button v-for="issue in continuityIssues" :key="issue.id" type="button" @click="emit('navigateDay', issue.toDayId)"><span>• {{ issue.title }}</span><small>{{ issue.detail }}</small><em>查看 {{ store.days.find((day) => day.id === issue.toDayId)?.label }}</em></button>
    </div>
    <div v-if="riskRows.length" class="risk-check-warnings" :class="`risk-${highestRisk ?? 'info'}`">
      <strong><i class="pi pi-exclamation-triangle" />风险提示 {{ riskRows.length }} 项</strong>
      <button v-for="row in riskRows" :key="`${row.day.id}-${row.place.id}-${row.risk.id}`" type="button" @click="emit('navigatePlace', row.place.id, row.day.id)">• {{ row.day.label }} · {{ row.place.name }}：{{ row.risk.title }}<em>查看</em></button>
    </div>
    <button v-if="budgetSummary.warnings.length" type="button" class="budget-check-warnings actionable" @click="emit('budget')"><strong><i class="pi pi-wallet" />预算待完善</strong><span v-for="warning in budgetSummary.warnings" :key="warning">• {{ warning }}</span><em>打开预算</em></button>
    <div class="helpnote"><i class="pi pi-info-circle" /> 预算检查只提示缺失和超支风险，不会用未经确认的价格替用户做决定。</div>

    <template #footer>
      <ElButton text @click="emit('close')">返回调整</ElButton>
      <ElButton plain type="primary" class="ai-route-check-entry" :disabled="store.readOnly" @click="emit('optimize')"><i class="pi pi-sparkles" />AI 分析路线</ElButton>
      <ElButton type="primary" @click="emit('close')"><i class="pi pi-check" />完成</ElButton>
    </template>
  </ElDialog>
</template>

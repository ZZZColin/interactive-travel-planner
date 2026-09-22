<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInputNumber, ElOption, ElProgress, ElSelect, ElSwitch, ElTag } from 'element-plus'
import { calculateBudgetSummary, expenseCategoryMeta, expenseStatusMeta, formatMoney, segmentExpenseOwnerId } from '../../domain/budget'
import type { BudgetSettings, ExpenseStatus } from '../../domain/types'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import ExpenseEditorPopover from './ExpenseEditorPopover.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = usePlannerStore()
const plans = usePlansStore()
const settings = ref<BudgetSettings>(JSON.parse(JSON.stringify(store.budget.settings)) as BudgetSettings)
const contingencyPercent = ref(0)
const activeTab = ref<'overview' | 'expenses' | 'vehicle'>('overview')
const participantCount = computed(() => Math.max(1, plans.activePlan?.metadata.participants.length ?? 1))
const summary = computed(() => {
  const state = store.exportState()
  state.budget = { settings: { ...settings.value, contingencyRate: contingencyPercent.value / 100 }, expenses: store.budget.expenses }
  return calculateBudgetSummary(state, store.places, store.routeCache, participantCount.value)
})
const overBudget = computed(() => summary.value.remaining != null && summary.value.remaining < 0)
const budgetUsage = computed(() => settings.value.limit && settings.value.limit > 0 ? Math.min(100, Math.round(summary.value.totalExpected / settings.value.limit * 100)) : 0)

watch(() => props.open, (open) => {
  if (!open) return
  settings.value = JSON.parse(JSON.stringify(store.budget.settings)) as BudgetSettings
  contingencyPercent.value = Math.round(settings.value.contingencyRate * 100)
  activeTab.value = 'overview'
})

function saveSettings(): void {
  if (store.readOnly) return
  store.updateBudgetSettings({ ...settings.value, contingencyRate: contingencyPercent.value / 100 })
  emit('close')
}

function statusType(status: ExpenseStatus): 'success' | 'warning' | 'info' | 'primary' | 'danger' {
  if (status === 'paid') return 'success'
  if (status === 'confirmed') return 'primary'
  if (status === 'unknown') return 'danger'
  if (status === 'free') return 'info'
  return 'warning'
}

function ownerLabel(ownerType: string, ownerId: string): string {
  if (ownerType === 'plan') return '全程费用'
  if (ownerType === 'day') return store.days.find((day) => day.id === ownerId)?.label ?? '日期费用'
  if (ownerType === 'place') return store.places[ownerId]?.name ?? '地点费用'
  if (ownerType === 'stop') {
    for (const day of store.days) {
      const stop = day.stops.find((item) => item.uid === ownerId)
      if (stop) return `${day.label} · ${store.places[stop.placeId]?.name ?? '地点费用'}`
    }
    return '地点费用'
  }
  if (ownerType === 'derived') return '自动计算'
  for (const day of store.days) {
    const index = day.stops.findIndex((stop, stopIndex) => segmentExpenseOwnerId(stop.uid, day.stops[stopIndex + 1]?.placeId ?? '') === ownerId)
    if (index >= 0) {
      const from = store.places[day.stops[index].placeId]?.name ?? '出发地'
      const to = store.places[day.stops[index + 1]?.placeId]?.name ?? '下一站'
      return `${from} → ${to}`
    }
  }
  return '交通费用'
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog budget-modal" width="980px" top="4vh" destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header>
      <div class="budget-dialog-title"><div class="budget-dialog-icon"><i class="pi pi-wallet" /></div><div><h2>旅行预算</h2><p>把地点、交通和全程费用汇总为可追溯的预算，而不是一个孤立总数。</p></div></div>
    </template>

    <div class="budget-layout">
      <nav class="budget-tabs" aria-label="预算页面"><button :class="{ active: activeTab === 'overview' }" @click="activeTab = 'overview'"><i class="pi pi-chart-pie" />总览</button><button :class="{ active: activeTab === 'expenses' }" @click="activeTab = 'expenses'"><i class="pi pi-receipt" />费用明细 <span>{{ summary.lines.length }}</span></button><button :class="{ active: activeTab === 'vehicle' }" @click="activeTab = 'vehicle'"><i class="pi pi-car" />预算与自驾参数</button></nav>
      <template v-if="activeTab === 'overview'">
      <section class="budget-overview">
        <div class="budget-metric primary"><span>预计总费用</span><strong>{{ formatMoney(summary.totalExpected) }}</strong><small v-if="summary.totalMin !== summary.totalMax">范围 {{ formatMoney(summary.totalMin) }}～{{ formatMoney(summary.totalMax) }}</small><small v-else>含预留 {{ formatMoney(summary.contingency) }}</small></div>
        <div class="budget-metric"><span>已确认</span><strong>{{ formatMoney(summary.confirmed) }}</strong><small>{{ summary.lines.filter((line) => line.status === 'confirmed' || line.status === 'paid').length }} 项已核价</small></div>
        <div class="budget-metric"><span>已支付</span><strong>{{ formatMoney(summary.paid) }}</strong><small>用于和预计费用对比</small></div>
        <div class="budget-metric"><span>人均预计</span><strong>{{ formatMoney(summary.perPerson) }}</strong><small>按 {{ participantCount }} 人平均</small></div>
      </section>

      <section class="budget-limit-card" :class="{ over: overBudget }">
        <div><strong>{{ settings.limit == null ? '尚未设置预算上限' : `预算上限 ${formatMoney(settings.limit)}` }}</strong><span v-if="summary.remaining != null">{{ overBudget ? `预计超出 ${formatMoney(-summary.remaining)}` : `预计剩余 ${formatMoney(summary.remaining)}` }}</span><span v-else>设置上限后可以判断是否超支</span></div>
        <ElProgress v-if="settings.limit" :percentage="budgetUsage" :status="overBudget ? 'exception' : undefined" :stroke-width="8" :show-text="false" />
        <ElTag :type="summary.unknownCount ? 'danger' : summary.warnings.length ? 'warning' : 'success'" effect="light">完整度 {{ summary.completeness }}%</ElTag>
      </section>
      <section v-if="summary.warnings.length" class="budget-warnings"><header><i class="pi pi-exclamation-triangle" /><strong>预算仍有待完善项</strong></header><span v-for="warning in summary.warnings" :key="warning">• {{ warning }}</span></section>
      </template>

      <div v-if="activeTab !== 'overview'" class="budget-columns single">
        <section v-if="activeTab === 'vehicle'" class="budget-settings-card">
          <header><div><strong>预算参数</strong><span>设置预算上限、预留比例和自驾计算依据</span></div></header>
          <div class="budget-settings-grid">
            <label><span>预算上限（元）</span><ElInputNumber v-model="settings.limit" :min="0" :max="100000000" :precision="2" controls-position="right" placeholder="可选" :disabled="store.readOnly" /></label>
            <label><span>应急预留比例</span><ElInputNumber v-model="contingencyPercent" :min="0" :max="100" :step="5" controls-position="right" :disabled="store.readOnly" /><small>按预计小计增加 {{ contingencyPercent }}%</small></label>
          </div>

          <div class="vehicle-cost-settings">
            <div class="vehicle-cost-heading"><div><strong>自驾成本自动计算</strong><span>路线变化后油费 / 电费自动更新</span></div><ElSwitch v-model="settings.vehicle.enabled" :disabled="store.readOnly" /></div>
            <template v-if="settings.vehicle.enabled">
              <div class="budget-settings-grid three">
                <label><span>能源类型</span><ElSelect v-model="settings.vehicle.energyType" :disabled="store.readOnly"><ElOption label="燃油车" value="fuel" /><ElOption label="新能源车" value="electric" /></ElSelect></label>
                <label><span>车辆数量</span><ElInputNumber v-model="settings.vehicle.vehicleCount" :min="1" :max="20" controls-position="right" :disabled="store.readOnly" /></label>
                <label><span>百公里{{ settings.vehicle.energyType === 'electric' ? '电耗' : '油耗' }}</span><ElInputNumber v-model="settings.vehicle.consumptionPer100Km" :min="0" :max="100" :precision="2" controls-position="right" :disabled="store.readOnly" /><small>{{ settings.vehicle.energyType === 'electric' ? 'kWh / 100km' : 'L / 100km' }}</small></label>
                <label><span>{{ settings.vehicle.energyType === 'electric' ? '电价（元/kWh）' : '油价（元/L）' }}</span><ElInputNumber v-model="settings.vehicle.energyUnitPrice" :min="0" :max="100" :precision="2" controls-position="right" :disabled="store.readOnly" /></label>
                <label><span>其他每公里成本</span><ElInputNumber v-model="settings.vehicle.perKmOther" :min="0" :max="100" :precision="2" controls-position="right" :disabled="store.readOnly" /><small>可用于折旧、租车里程费等</small></label>
                <label class="vehicle-toll-switch"><span>使用地图高速费</span><ElSwitch v-model="settings.vehicle.includeMapTolls" :disabled="store.readOnly" /><small>按当前驾车路线估算</small></label>
              </div>
            </template>
          </div>
        </section>

        <section v-if="activeTab === 'expenses'" class="budget-ledger-card">
          <header><div><strong>费用明细</strong><span>{{ summary.lines.length }} 项 · 未知价格 {{ summary.unknownCount }} 项</span></div><ExpenseEditorPopover owner-type="plan" owner-id="plan" title="全程费用" default-category="insurance" button-label="添加全程费用" /></header>
          <div v-if="summary.lines.length" class="budget-ledger themed-list-scroll">
            <div v-for="line in summary.lines" :key="line.id" class="budget-ledger-row">
              <span class="budget-ledger-icon"><i :class="line.source === 'calculated' || line.source === 'map-route' ? 'pi pi-calculator' : 'pi pi-receipt'" /></span>
              <div><strong>{{ line.name }}</strong><small>{{ ownerLabel(line.ownerType, line.ownerId) }} · {{ expenseCategoryMeta[line.category].label }} · {{ line.sourceLabel || (line.source === 'manual' ? '用户录入' : line.source) }}</small></div>
              <ElTag :type="statusType(line.status)" size="small" effect="light">{{ expenseStatusMeta[line.status].label }}</ElTag>
              <b>{{ line.status === 'unknown' ? '待核价' : line.min === line.max ? formatMoney(line.expected) : `${formatMoney(line.min)}～${formatMoney(line.max)}` }}</b>
              <ElButton v-if="line.ownerType !== 'derived'" text circle size="small" type="danger" title="删除费用" :disabled="store.readOnly" @click="store.deleteExpense(line.id)"><i class="pi pi-trash" /></ElButton>
              <span v-else />
            </div>
          </div>
          <div v-else class="budget-empty"><i class="pi pi-wallet" /><strong>还没有费用明细</strong><span>从地点、交通路段或全程费用开始录入。</span></div>
        </section>
      </div>

    </div>

    <template #footer><ElButton text @click="emit('close')">取消</ElButton><ElButton type="primary" :disabled="store.readOnly" @click="saveSettings">保存预算设置</ElButton></template>
  </ElDialog>
</template>

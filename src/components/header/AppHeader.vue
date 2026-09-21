<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { ElButton } from 'element-plus'
import { formatMoney } from '../../domain/budget'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import { useWeatherStore } from '../../stores/weather'
import LocaleSwitcher from '../ui/LocaleSwitcher.vue'
import { appLocale, currentLocale } from '../../i18n'

const props = defineProps<{ demoMode?: boolean }>()

const emit = defineEmits<{
  check: []
  budget: []
  weather: []
  editPlan: []
  share: []
}>()

const planner = usePlannerStore()
const plans = usePlansStore()
const weather = useWeatherStore()
const { demo, history, future } = storeToRefs(planner)
const budgetSummary = computed(() => planner.getBudgetSummary(Math.max(1, plans.activePlan?.metadata.participants.length ?? 1)))
const budgetButtonText = computed(() => {
  if (budgetSummary.value.totalExpected > 0) return formatMoney(budgetSummary.value.totalExpected)
  const limit = planner.budget.settings.limit
  return limit == null ? '预算' : `预算 ${formatMoney(limit)}`
})
const scenes = ['收集地点', '按天编排', '发现问题', '形成计划']

const planDateText = computed(() => {
  if (!plans.activePlan) return ''
  const start = new Date(plans.activePlan.metadata.startAt)
  const end = new Date(plans.activePlan.metadata.endAt)
  const locale = appLocale.value
  const formatter = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' })
  const travelers = plans.activePlan.metadata.participants.length
  return locale === 'zh-CN'
    ? `${formatter.format(start)}—${formatter.format(end)} · ${travelers} 人`
    : `${formatter.format(start)}—${formatter.format(end)} · ${travelers} ${travelers === 1 ? 'traveler' : 'travelers'}`
})
</script>

<template>
  <header class="topbar">
    <div class="brand"><span class="brandmark">途</span>行途规划</div>
    <span class="divider" />
    <ElButton text size="small" class="home-back-button" title="返回全部计划" @click="plans.goHome()">
      <i class="pi pi-arrow-left" />全部计划
    </ElButton>
    <span class="divider" />
    <div class="tripname">{{ plans.activePlan?.metadata.name ?? '旅行计划' }}</div>
    <div class="tripmeta">{{ planDateText }}</div>
    <ElButton text circle size="small" title="编辑计划信息" @click="emit('editPlan')"><i class="pi pi-pencil" /></ElButton>
    <div class="spacer" />
    <LocaleSwitcher />
    <nav v-if="props.demoMode" class="demonav">
      <button
        v-for="(scene, index) in scenes"
        :key="scene"
        :class="{ active: demo === index + 1 }"
        @click="planner.setDemo(index + 1)"
      >
        {{ scene }}
      </button>
    </nav>
    <ElButton text circle size="small" :disabled="!history.length" title="撤销" @click="planner.undo"><i class="pi pi-undo" /></ElButton>
    <ElButton text circle size="small" :disabled="!future.length" title="重做" @click="planner.redo"><i class="pi pi-redo" /></ElButton>
    <ElButton plain size="small" class="header-weather-button" :class="{ warn: !weather.selectedProviderConfigured }" @click="emit('weather')"><i class="pi pi-sun" />{{ weather.selectedProviderId === 'none' ? '天气关闭' : weather.selectedProviderConfigured ? '天气' : '配置天气' }}</ElButton>
    <ElButton plain size="small" class="header-budget-button" @click="emit('budget')"><i class="pi pi-wallet" />{{ budgetButtonText }}<span v-if="budgetSummary.unknownCount" class="header-budget-dot" /></ElButton>
    <ElButton plain size="small" class="header-share-button" @click="emit('share')"><i class="pi pi-share-alt" />分享</ElButton>
    <ElButton plain size="small" class="check-plan-button" @click="emit('check')"><i class="pi pi-check-circle" />检查计划</ElButton>
    <div class="autosave-status" :class="plans.saveState" :title="plans.lastSavedAt ? `最近保存 ${new Date(plans.lastSavedAt).toLocaleString(currentLocale())}` : '计划会自动保存'">
      <i :class="plans.saveState === 'saving' ? 'pi pi-spinner pi-spin' : plans.saveState === 'error' ? 'pi pi-exclamation-circle' : 'pi pi-check-circle'" />
      <span>{{ plans.saveState === 'saving' ? '正在保存' : plans.saveState === 'error' ? '保存失败' : '已自动保存' }}</span>
    </div>
  </header>
</template>

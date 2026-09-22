<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput, ElOption, ElSelect, ElTag } from 'element-plus'
import { estimateTokenCount } from '../../ai/adapters'
import { DEFAULT_AI_ROUTE_OPTIMIZATION_PROMPT } from '../../ai/prompt'
import { analyzeRouteOptimization, buildRouteOptimizationInput, normalizeRouteOptimizationDraft, routeArrangementChanged, validateRouteOptimization } from '../../ai/routeOptimization'
import type { AiRouteOptimizationDraft, AiRouteValidation } from '../../ai/types'
import { segmentExpenseOwnerId } from '../../domain/budget'
import { formatDuration } from '../../domain/schedule'
import { hasActiveMapProviderConfig, mapRuntimeState, planMapProvider } from '../../map/provider'
import { useAiProvidersStore } from '../../stores/aiProviders'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'

const PROMPT_STORAGE_KEY = 'interactiveTravel.ai.routeOptimizationPrompt.v1'
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; settings: []; mapSettings: [] }>()
const providers = useAiProvidersStore()
const planner = usePlannerStore()
const plans = usePlansStore()
const selectedInstanceId = ref('')
const selectedModel = ref('')
const prompt = ref(localStorage.getItem(PROMPT_STORAGE_KEY) || DEFAULT_AI_ROUTE_OPTIMIZATION_PROMPT)
const promptExpanded = ref(false)
const analyzing = ref(false)
const progressText = ref('')
const error = ref('')
const draft = ref<AiRouteOptimizationDraft | null>(null)
const validation = ref<AiRouteValidation | null>(null)
let analysisController: AbortController | null = null

const selectedInstance = computed(() => providers.configuredProfiles.find((item) => item.id === selectedInstanceId.value) ?? null)
const availableModels = computed(() => selectedInstance.value?.models ?? [])
const input = computed(() => buildRouteOptimizationInput(plans.activePlan?.metadata.name ?? '当前计划', planner.days, planner.places, planner.routeCache))
const tokenEstimate = computed(() => estimateTokenCount(`${prompt.value}
${JSON.stringify(input.value)}`))
const scheduledCount = computed(() => planner.days.reduce((sum, day) => sum + day.stops.length, 0))
const changed = computed(() => draft.value ? routeArrangementChanged(planner.days, draft.value) : false)
const dayName = computed(() => Object.fromEntries(planner.days.map((day) => [day.id, day.label])))
const stopName = computed(() => Object.fromEntries(planner.days.flatMap((day) => day.stops.map((stop) => [stop.uid, planner.places[stop.placeId]?.name ?? stop.placeId]))))
const dayPreviews = computed(() => draft.value?.dayArrangements.map((arrangement) => ({
  dayId: arrangement.dayId,
  label: dayName.value[arrangement.dayId] ?? arrangement.dayId,
  before: planner.days.find((day) => day.id === arrangement.dayId)?.stops.map((stop) => planner.places[stop.placeId]?.name ?? stop.placeId) ?? [],
  after: arrangement.stopUids.map((uid) => stopName.value[uid] ?? uid),
})) ?? [])
const affectedSegmentExpenseCount = computed(() => {
  if (!draft.value) return 0
  const stopByUid = new Map(planner.days.flatMap((day) => day.stops).map((stop) => [stop.uid, stop]))
  const validOwners = new Set<string>()
  draft.value.dayArrangements.forEach((arrangement) => arrangement.stopUids.slice(0, -1).forEach((uid, index) => {
    const next = stopByUid.get(arrangement.stopUids[index + 1])
    if (next) validOwners.add(segmentExpenseOwnerId(uid, next.placeId))
  }))
  return planner.budget.expenses.filter((item) => item.ownerType === 'segment' && !validOwners.has(item.ownerId)).length
})
const improvement = computed(() => {
  if (!validation.value) return null
  return {
    km: validation.value.before.totalKm - validation.value.after.totalKm,
    minutes: validation.value.before.totalTravelMinutes - validation.value.after.totalTravelMinutes,
    warnings: validation.value.before.warnedDays - validation.value.after.warnedDays,
  }
})

watch(() => providers.configuredProfiles.map((item) => item.id).join(','), () => {
  if (!selectedInstance.value) selectedInstanceId.value = providers.activeConfiguredProfile?.id ?? providers.configuredProfiles[0]?.id ?? ''
})
watch(selectedInstanceId, (id) => {
  const profile = providers.configuredProfiles.find((item) => item.id === id)
  if (!profile) { selectedModel.value = ''; return }
  selectedModel.value = profile.model || profile.models[0] || ''
})
watch(() => props.open, (open) => {
  if (!open) { analysisController?.abort(); analysisController = null; return }
  selectedInstanceId.value = providers.activeConfiguredProfile?.id ?? providers.configuredProfiles[0]?.id ?? ''
  selectedModel.value = selectedInstance.value?.model ?? selectedInstance.value?.models?.[0] ?? ''
  prompt.value = localStorage.getItem(PROMPT_STORAGE_KEY) || DEFAULT_AI_ROUTE_OPTIMIZATION_PROMPT
  promptExpanded.value = false
  analyzing.value = false
  progressText.value = ''
  error.value = ''
  draft.value = null
  validation.value = null
})

function resetPrompt(): void {
  prompt.value = DEFAULT_AI_ROUTE_OPTIMIZATION_PROMPT
  localStorage.removeItem(PROMPT_STORAGE_KEY)
}

function savePrompt(): void {
  const value = prompt.value.trim() || DEFAULT_AI_ROUTE_OPTIMIZATION_PROMPT
  prompt.value = value
  if (value === DEFAULT_AI_ROUTE_OPTIMIZATION_PROMPT) localStorage.removeItem(PROMPT_STORAGE_KEY)
  else localStorage.setItem(PROMPT_STORAGE_KEY, value)
  planner.notify('AI 路线审查提示词已保存')
}

async function analyze(): Promise<void> {
  const profile = selectedInstance.value
  if (!profile) { error.value = '请先配置可用的 AI 接入实例'; return }
  if (!selectedModel.value) { error.value = '请选择模型'; return }
  if (!hasActiveMapProviderConfig()) { error.value = '请先配置当前地图，用于验证 AI 调整后的真实路线'; return }
  if (scheduledCount.value < 2) { error.value = '至少安排两个地点后才能分析路线'; return }
  error.value = ''
  draft.value = null
  validation.value = null
  analysisController?.abort()
  const controller = new AbortController()
  analysisController = controller
  analyzing.value = true
  try {
    progressText.value = '正在让 AI 审查路线结构…'
    const raw = await analyzeRouteOptimization({ ...profile, model: selectedModel.value }, providers.readSecret(profile.id).apiKey, input.value, prompt.value.trim() || DEFAULT_AI_ROUTE_OPTIMIZATION_PROMPT, controller.signal)
    draft.value = normalizeRouteOptimizationDraft(raw, planner.days, planner.places)
    progressText.value = `正在使用${mapRuntimeState.providerDefinition.shortName}验证调整前后的路线…`
    validation.value = await validateRouteOptimization(planner.days, planner.places, planner.routeCache, draft.value, (from, to, mode) => planMapProvider.estimateRoute(from, to, mode))
    progressText.value = ''
  } catch (reason) {
    if (controller.signal.aborted) return
    error.value = reason instanceof Error ? reason.message : 'AI 路线分析失败'
    draft.value = null
    validation.value = null
  } finally {
    if (analysisController === controller) { analysisController = null; analyzing.value = false }
  }
}

function cancelAnalysis(): void {
  analysisController?.abort()
  analysisController = null
  analyzing.value = false
  progressText.value = ''
  planner.notify('已取消 AI 路线分析')
}

function apply(): void {
  if (!draft.value || !validation.value || !changed.value || planner.readOnly) return
  planner.applyAiRouteArrangement(draft.value.dayArrangements, draft.value.returnToPoolStopUids, validation.value.routeCache)
  emit('close')
}

function issueTagType(severity: string): 'info' | 'warning' | 'danger' {
  if (severity === 'warning') return 'danger'
  if (severity === 'attention') return 'warning'
  return 'info'
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog ai-route-optimization-modal" width="860px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header>
      <div class="ai-route-dialog-title"><span><i class="pi pi-sparkles" /></span><div><h2>AI 路线优化</h2><p>AI 提出地点重排建议，当前地图引擎负责验证实际距离和用时，确认后才修改计划。</p></div></div>
    </template>

    <div class="ai-route-layout">
      <section class="ai-route-config">
        <div class="ai-route-provider-row">
          <div class="field"><label>AI 接入实例</label><ElSelect v-model="selectedInstanceId" placeholder="选择已配置的实例"><ElOption v-for="profile in providers.configuredProfiles" :key="profile.id" :label="profile.id === providers.activeId ? `${profile.name}（默认）` : profile.name" :value="profile.id" /></ElSelect></div>
          <div class="field"><label>模型</label><ElSelect v-model="selectedModel" :disabled="!selectedInstance"><ElOption v-for="model in availableModels" :key="model" :label="model" :value="model" /></ElSelect></div>
          <ElButton v-if="!providers.configuredProfiles.length" size="small" @click="emit('settings')">配置 AI</ElButton>
        </div>
        <div class="ai-route-scope"><i class="pi pi-shield" /><div><strong>将发送 {{ planner.days.length }} 天、{{ scheduledCount }} 个已安排地点</strong><span>包含坐标、优先级、停留时间和路线摘要；不发送参与人员姓名、API Key 或费用明细。</span></div><em>约 {{ tokenEstimate }} Token</em></div>
        <div v-if="!hasActiveMapProviderConfig()" class="ai-map-required"><i class="pi pi-map-marker" /><span>需要配置当前地图才能对候选顺序进行真实路线验证。</span><ElButton size="small" @click="emit('mapSettings')">配置当前地图</ElButton></div>
        <button type="button" class="ai-route-prompt-toggle" @click="promptExpanded = !promptExpanded"><span><i class="pi pi-sliders-h" />路线审查提示词</span><i :class="promptExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" /></button>
        <div v-if="promptExpanded" class="ai-route-prompt-editor"><ElInput v-model="prompt" type="textarea" :rows="8" resize="vertical" /><div><span>与旅行分享抽取提示词相互独立。</span><ElButton text size="small" @click="resetPrompt">恢复默认</ElButton><ElButton text type="primary" size="small" @click="savePrompt">保存提示词</ElButton></div></div>
        <div v-if="error" class="form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
        <div class="ai-route-analyze-actions"><ElButton v-if="analyzing" @click="cancelAnalysis"><i class="pi pi-times" />取消分析</ElButton>        <ElButton type="primary" class="ai-route-analyze-button" :loading="analyzing" :disabled="!selectedInstance || !selectedModel || !hasActiveMapProviderConfig() || scheduledCount < 2" @click="analyze"><i class="pi pi-sparkles" />{{ analyzing ? progressText || '正在分析…' : draft ? '重新分析路线' : '开始分析路线' }}</ElButton></div>
      </section>

      <template v-if="draft && validation">
        <section class="ai-route-result-head"><div><strong>{{ draft.summary }}</strong><span>{{ changed ? '下面是 AI 建议，并已完成地图路线验证。' : 'AI 建议保持当前地点安排。' }}</span></div><ElTag :type="changed ? 'primary' : 'success'" round>{{ changed ? '存在调整建议' : '无需调整' }}</ElTag></section>

        <section v-if="draft.issues.length" class="ai-route-issues"><article v-for="(issue, index) in draft.issues" :key="index"><ElTag :type="issueTagType(issue.severity)" size="small" effect="light">{{ issue.severity === 'warning' ? '警告' : issue.severity === 'attention' ? '注意' : '提示' }}</ElTag><div><strong>{{ issue.title }}</strong><p>{{ issue.detail }}</p><small v-if="issue.dayIds.length">{{ issue.dayIds.map((id) => dayName[id] || id).join('、') }}</small></div></article></section>

        <section class="ai-route-comparison">
          <header><div><strong>{{ mapRuntimeState.providerDefinition.shortName }}路线验证</strong><span>新产生的驾车、步行和骑行路段会重新查询地图。</span></div><ElTag :type="validation.estimatedSegments ? 'warning' : 'success'" effect="light">{{ validation.estimatedSegments ? `${validation.estimatedSegments} 段仍为暂估` : '路线已验证' }}</ElTag></header>
          <div class="ai-route-metrics">
            <div><span>总里程</span><b>{{ validation.before.totalKm }} km</b><i class="pi pi-arrow-right" /><strong>{{ validation.after.totalKm }} km</strong><em :class="{ better: improvement && improvement.km > 0, worse: improvement && improvement.km < 0 }">{{ improvement && improvement.km !== 0 ? `${improvement.km > 0 ? '减少' : '增加'} ${Math.abs(improvement.km)} km` : '基本不变' }}</em></div>
            <div><span>总交通时间</span><b>{{ formatDuration(validation.before.totalTravelMinutes) }}</b><i class="pi pi-arrow-right" /><strong>{{ formatDuration(validation.after.totalTravelMinutes) }}</strong><em :class="{ better: improvement && improvement.minutes > 0, worse: improvement && improvement.minutes < 0 }">{{ improvement && improvement.minutes !== 0 ? `${improvement.minutes > 0 ? '减少' : '增加'} ${formatDuration(Math.abs(improvement.minutes))}` : '基本不变' }}</em></div>
            <div><span>问题日期</span><b>{{ validation.before.warnedDays }} 天</b><i class="pi pi-arrow-right" /><strong>{{ validation.after.warnedDays }} 天</strong><em :class="{ better: improvement && improvement.warnings > 0, worse: improvement && improvement.warnings < 0 }">{{ improvement && improvement.warnings > 0 ? `减少 ${improvement.warnings} 天` : improvement && improvement.warnings < 0 ? `增加 ${-improvement.warnings} 天` : '没有变化' }}</em></div>
          </div>
        </section>

        <section class="ai-route-day-plans"><header><strong>地点安排对比</strong><span>只调整顺序和所属日期，不修改地点本身。</span></header><article v-for="day in dayPreviews" :key="day.dayId" :class="{ changed: day.before.join('|') !== day.after.join('|') }"><b>{{ day.label }}</b><div><small>当前</small><span>{{ day.before.length ? day.before.join(' → ') : '无安排' }}</span></div><i class="pi pi-arrow-down" /><div><small>建议</small><span>{{ day.after.length ? day.after.join(' → ') : '无安排' }}</span></div></article></section>

        <section v-if="draft.returnToPoolStopUids.length" class="ai-route-return-pool"><i class="pi pi-inbox" /><div><strong>建议退回未安排地点</strong><span>{{ draft.returnToPoolStopUids.map((uid) => stopName[uid] || uid).join('、') }}</span></div><ElTag type="warning" effect="light">不会删除</ElTag></section>
        <section v-if="affectedSegmentExpenseCount" class="ai-route-expense-impact"><i class="pi pi-wallet" /><div><strong>{{ affectedSegmentExpenseCount }} 项原路段费用将不再适用</strong><span>确认调整后会从当前预算中移除；如需恢复，可以整体撤销本次 AI 调整。</span></div></section>
        <section v-if="draft.reasons.length || draft.cautions.length" class="ai-route-notes"><div v-if="draft.reasons.length"><strong>调整依据</strong><span v-for="reason in draft.reasons" :key="reason">• {{ reason }}</span></div><div v-if="draft.cautions.length"><strong>需要注意</strong><span v-for="caution in draft.cautions" :key="caution">• {{ caution }}</span></div></section>
      </template>
    </div>

    <template #footer>
      <ElButton text @click="emit('close')">取消</ElButton>
      <ElButton v-if="draft && validation" type="primary" :disabled="!changed || validation.estimatedSegments > 0 || planner.readOnly" :title="validation.estimatedSegments ? `存在未通过${mapRuntimeState.providerDefinition.shortName}验证的新路段，暂不能应用` : ''" @click="apply"><i class="pi pi-check" />{{ !changed ? '当前无需调整' : validation.estimatedSegments ? '路线验证不完整' : '确认并应用调整' }}</ElButton>
    </template>
  </ElDialog>
</template>

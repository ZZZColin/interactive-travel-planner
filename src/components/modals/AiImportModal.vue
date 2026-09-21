<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDatePicker, ElDialog, ElInput, ElInputNumber, ElOption, ElRadioButton, ElRadioGroup, ElSelect, ElTag } from 'element-plus'
import { estimateMultimodalTokens, extractTravelPlan } from '../../ai/adapters'
import { normalizeImportDurationDays } from '../../ai/importDuration'
import { createParticipant, normalizeParticipants } from '../../domain/plans'
import { DEFAULT_AI_SYSTEM_PROMPT } from '../../ai/prompt'
import type { AiImportDraft, AiInputImage, AiResolvedDay, ResolvedPlanImport } from '../../ai/types'
import type { TripParticipant } from '../../domain/types'
import { transportModeMeta } from '../../domain/transport'
import { hasActiveMapProviderConfig, mapRuntimeState, planMapProvider } from '../../map/provider'
import { useAiProvidersStore } from '../../stores/aiProviders'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import ParticipantEditor from '../plans/ParticipantEditor.vue'
import { currentLocale } from '../../i18n'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; settings: []; mapSettings: [] }>()
const providers = useAiProvidersStore()
const plans = usePlansStore()
const planner = usePlannerStore()
const sourceText = ref('')
const targetMode = ref<'new' | 'current'>('new')
const parsing = ref(false)
const error = ref('')
const draft = ref<AiImportDraft | null>(null)
const resolvedDays = ref<AiResolvedDay[]>([])
const title = ref('')
const participants = ref<TripParticipant[]>([createParticipant()])
const budgetLimit = ref<number | null>(null)
const startDate = ref<Date>(new Date(Date.now() + 86_400_000))
const durationDays = ref(1)
const matchingText = ref('')
const selectedInstanceId = ref('')
const selectedModel = ref('')
const inputImages = ref<AiInputImage[]>([])
const imageInput = ref<HTMLInputElement | null>(null)
const promptExpanded = ref(false)
const customSystemPrompt = ref(DEFAULT_AI_SYSTEM_PROMPT)
let parseController: AbortController | null = null

const selectedInstance = computed(() => providers.configuredProfiles.find((item) => item.id === selectedInstanceId.value) ?? null)
const availableModels = computed(() => selectedInstance.value?.models ?? [])
const sourceTokenEstimate = computed(() => estimateMultimodalTokens(sourceText.value, inputImages.value.length, customSystemPrompt.value))
const inputTooLarge = computed(() => sourceTokenEstimate.value > (selectedInstance.value?.maxInputTokens ?? Number.POSITIVE_INFINITY))
const selectedCount = computed(() => resolvedDays.value.reduce((sum, day) => sum + day.places.filter((place) => place.selectedId).length, 0))
const unresolvedCount = computed(() => resolvedDays.value.reduce((sum, day) => sum + day.places.filter((place) => !place.selectedId).length, 0))
const endDateLabel = computed(() => {
  const end = new Date(startDate.value)
  end.setDate(end.getDate() + Math.max(1, durationDays.value) - 1)
  return new Intl.DateTimeFormat(currentLocale(), { year: 'numeric', month: '2-digit', day: '2-digit' }).format(end)
})

watch(() => providers.configuredProfiles.map((item) => item.id).join(','), () => {
  if (!selectedInstance.value) selectedInstanceId.value = providers.activeConfiguredProfile?.id ?? providers.configuredProfiles[0]?.id ?? ''
})
watch(selectedInstanceId, (id) => {
  const profile = providers.configuredProfiles.find((item) => item.id === id)
  if (!profile) {
    selectedModel.value = ''
    return
  }
  selectedModel.value = profile.model || profile.models[0] || ''
  customSystemPrompt.value = profile.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT
})

watch(() => props.open, (open) => {
  if (!open) { parseController?.abort(); parseController = null; return }
  selectedInstanceId.value = providers.activeConfiguredProfile?.id ?? providers.configuredProfiles[0]?.id ?? ''
  selectedModel.value = selectedInstance.value?.model ?? selectedInstance.value?.models?.[0] ?? ''
  customSystemPrompt.value = selectedInstance.value?.systemPrompt || DEFAULT_AI_SYSTEM_PROMPT
  inputImages.value = []
  promptExpanded.value = false
  error.value = ''
  draft.value = null
  resolvedDays.value = []
  matchingText.value = ''
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  tomorrow.setHours(0, 0, 0, 0)
  startDate.value = tomorrow
  durationDays.value = 1
  participants.value = [createParticipant()]
  budgetLimit.value = null
})

const supportedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error(`无法读取图片：${file.name}`))
    reader.readAsDataURL(file)
  })
}

async function addImageFiles(files: File[]): Promise<void> {
  error.value = ''
  for (const file of files) {
    if (inputImages.value.length >= 6) { error.value = '单次最多添加 6 张图片'; break }
    if (!supportedImageTypes.has(file.type)) { error.value = `不支持的图片格式：${file.name}`; continue }
    if (file.size > 5 * 1024 * 1024) { error.value = `图片不能超过 5 MB：${file.name}`; continue }
    const dataUrl = await readFileAsDataUrl(file)
    inputImages.value.push({ id: `img_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`, name: file.name || `粘贴图片 ${inputImages.value.length + 1}`, mimeType: file.type as AiInputImage['mimeType'], dataUrl, size: file.size })
  }
}

function handlePaste(event: ClipboardEvent): void {
  const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'))
  if (!files.length) return
  event.preventDefault()
  addImageFiles(files)
}

function chooseImages(): void {
  imageInput.value?.click()
}

function handleImageInput(event: Event): void {
  const input = event.target as HTMLInputElement
  addImageFiles([...(input.files ?? [])])
  input.value = ''
}

function removeImage(id: string): void {
  inputImages.value = inputImages.value.filter((image) => image.id !== id)
}

function savePromptAsInstanceDefault(): void {
  const profile = selectedInstance.value
  if (!profile || !customSystemPrompt.value.trim()) return
  const secret = providers.readSecret(profile.id)
  providers.updateProfile({ ...profile, systemPrompt: customSystemPrompt.value.trim() }, secret.apiKey, secret.remembered)
  planner.notify('当前系统提示词已保存为该接入实例的默认值')
}

function normalizeName(value: string): string {
  return value.replace(/[\s·・()（）景区风景区国家级]/g, '')
}

async function parseSource(): Promise<void> {
  const profile = selectedInstance.value
  if (!profile) { error.value = '请先配置并保存一个 AI 接入实例'; emit('settings'); return }
  const secret = providers.readSecret(profile.id)
  if (!secret.apiKey) { error.value = '当前 AI 接入实例没有可用的 API Key'; emit('settings'); return }
  parseController?.abort()
  const controller = new AbortController()
  parseController = controller
  parsing.value = true
  error.value = ''
  draft.value = null
  resolvedDays.value = []
  try {
    const value = await extractTravelPlan({ ...profile, model: selectedModel.value || profile.model }, secret.apiKey, sourceText.value, inputImages.value, customSystemPrompt.value, controller.signal)
    draft.value = value
    title.value = value.title
    durationDays.value = normalizeImportDurationDays(value.durationDays, value.days.length)
    const cache = new Map<string, Awaited<ReturnType<typeof planMapProvider.searchPlaces>>>()
    const canSearchMap = hasActiveMapProviderConfig()
    const days: AiResolvedDay[] = []
    let completed = 0
    const total = value.days.reduce((sum, day) => sum + day.places.length, 0)
    for (const day of value.days) {
      const places = []
      for (const place of day.places) {
        completed += 1
        matchingText.value = canSearchMap ? `正在核验地点 ${completed} / ${total}：${place.name}` : '尚未配置当前地图引擎，地点暂时无法核验'
        let candidates = cache.get(place.name) ?? []
        if (canSearchMap && !cache.has(place.name)) {
          try { candidates = await planMapProvider.searchPlaces(place.name) } catch { candidates = [] }
          cache.set(place.name, candidates)
          await new Promise((resolve) => window.setTimeout(resolve, 180))
        }
        const normalized = normalizeName(place.name)
        const exact = candidates.find((candidate) => normalizeName(candidate.name) === normalized)
        places.push({ ...place, candidates: candidates.slice(0, 5), selectedId: (exact ?? candidates[0])?.id ?? null })
      }
      days.push({ ...day, places })
    }
    resolvedDays.value = days
    matchingText.value = ''
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : 'AI 行程解析失败'
  } finally {
    parsing.value = false
  }
}

function buildResolvedImport(): ResolvedPlanImport {
  return {
    title: title.value.trim() || draft.value?.title || 'AI 导入的旅行计划',
    startDate: startDate.value,
    durationDays: normalizeImportDurationDays(durationDays.value, resolvedDays.value.length),
    participants: normalizeParticipants(participants.value),
    budgetLimit: budgetLimit.value,
    days: resolvedDays.value.map((day) => ({
      places: day.places.flatMap((item) => {
        const place = item.candidates.find((candidate) => candidate.id === item.selectedId)
        return place ? [{ place, stayMinutes: item.stayMinutes, transportToNext: item.transportToNext }] : []
      }),
    })),
  }
}

function cancelParsing(): void {
  parseController?.abort()
  parseController = null
  parsing.value = false
  matchingText.value = ''
  planner.notify('已取消 AI 解析')
}

function applyImport(): void {
  if (!draft.value || selectedCount.value === 0) return
  const value = buildResolvedImport()
  if (targetMode.value === 'new') plans.createPlanFromAiImport(value)
  else plans.mergeAiImportIntoCurrent(value)
  emit('close')
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog ai-import-modal" width="1180px" top="3vh" destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header>
      <div class="ai-dialog-title">
        <div class="ai-dialog-icon"><i class="pi pi-sparkles" /></div>
        <div><h2>AI 识别旅行分享</h2><p>把小红书、公众号或聊天攻略转换为可核验的计划草稿。</p></div>
      </div>
    </template>

    <div class="ai-import-layout" :class="{ previewing: draft }">
      <section class="ai-import-source" @paste="handlePaste">
        <div class="ai-import-provider-row">
          <ElSelect v-model="selectedInstanceId" class="ai-import-provider" placeholder="选择已配置的 AI 接入实例">
            <ElOption v-for="profile in providers.configuredProfiles" :key="profile.id" :label="profile.id === providers.activeId ? `${profile.name}（默认）` : profile.name" :value="profile.id" />
          </ElSelect>
          <ElSelect v-model="selectedModel" class="ai-import-model" filterable allow-create default-first-option placeholder="选择模型" :disabled="!selectedInstance">
            <ElOption v-for="model in availableModels" :key="model" :label="model" :value="model" />
          </ElSelect>
          <ElButton title="配置 AI 接入实例" @click="emit('settings')"><i class="pi pi-cog" /></ElButton>
        </div>
        <div v-if="!providers.configuredProfiles.length" class="ai-no-instance"><i class="pi pi-info-circle" /><span>还没有可用的 AI 接入实例。预置 Provider 只是参数模板，需要填写 API Key 并保存后才能在这里选择。</span><ElButton size="small" @click="emit('settings')">配置接入实例</ElButton></div>
        <ElInput v-model="sourceText" type="textarea" :autosize="{ minRows: 12, maxRows: 22 }" resize="none" maxlength="50000" show-word-limit placeholder="粘贴完整的旅行分享文本。AI 只负责抽取地点和按天结构，不会直接覆盖计划。" />
        <div class="ai-media-toolbar">
          <input ref="imageInput" class="hidden" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple @change="handleImageInput">
          <ElButton size="small" @click="chooseImages"><i class="pi pi-image" />添加图片</ElButton>
          <span>支持直接粘贴截图，单张不超过 5 MB，最多 6 张；模型需要具备图像理解能力。</span>
        </div>
        <div v-if="inputImages.length" class="ai-image-list">
          <figure v-for="image in inputImages" :key="image.id" class="ai-image-item">
            <img :src="image.dataUrl" :alt="image.name">
            <figcaption>{{ image.name }}</figcaption>
            <button title="移除图片" @click="removeImage(image.id)"><i class="pi pi-times" /></button>
          </figure>
        </div>
        <section class="ai-prompt-override">
          <button class="ai-prompt-toggle" @click="promptExpanded = !promptExpanded">
            <span><i class="pi pi-sliders-h" />系统提示词</span><small>可临时调整本次抽取规则</small><i :class="promptExpanded ? 'pi pi-chevron-up' : 'pi pi-chevron-down'" />
          </button>
          <div v-if="promptExpanded" class="ai-prompt-body">
            <ElInput v-model="customSystemPrompt" type="textarea" :autosize="{ minRows: 7, maxRows: 14 }" resize="vertical" />
            <div class="ai-prompt-actions">
              <ElButton text size="small" @click="customSystemPrompt = DEFAULT_AI_SYSTEM_PROMPT">恢复内置默认</ElButton>
              <ElButton text size="small" :disabled="!selectedInstance" @click="savePromptAsInstanceDefault">保存为实例默认</ElButton>
            </div>
          </div>
        </section>
        <div class="ai-input-budget" :class="{ exceeded: inputTooLarge }">
          <span>输入估算约 {{ sourceTokenEstimate.toLocaleString() }} Token<span v-if="inputImages.length">（含 {{ inputImages.length }} 张图片）</span></span>
          <span>上限 {{ selectedInstance?.maxInputTokens.toLocaleString() ?? '未设置' }} Token</span>
        </div>
        <div class="ai-source-notice"><i class="pi pi-info-circle" />点击解析后，文本会发送给当前选择的 AI 供应商；原文默认不会写入旅行计划。</div>
        <div v-if="error" class="form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
        <ElButton type="primary" class="ai-parse-button" :loading="parsing" :disabled="(sourceText.trim().length < 20 && !inputImages.length) || inputTooLarge || !selectedModel || !selectedInstance" @click="parseSource">
          <i class="pi pi-sparkles" />{{ parsing ? matchingText || '正在请求 AI…' : draft ? '重新解析' : '解析并核验地点' }}
        </ElButton>
        <ElButton v-if="parsing" class="ai-cancel-request" @click="cancelParsing"><i class="pi pi-times" />取消解析</ElButton>
      </section>

      <section v-if="draft" class="ai-import-preview">
        <div class="ai-preview-toolbar">
          <div><strong>导入方式</strong><span>默认创建新计划，不会覆盖当前计划。</span></div>
          <ElRadioGroup v-model="targetMode" size="small">
            <ElRadioButton value="new">创建新计划</ElRadioButton>
            <ElRadioButton value="current" :disabled="!plans.activePlan">合并当前计划</ElRadioButton>
          </ElRadioGroup>
        </div>

        <div class="ai-preview-meta">
          <div class="field"><label>计划名称</label><ElInput v-model="title" /></div>
          <div v-if="targetMode === 'new'" class="field"><label>出发日期</label><ElDatePicker v-model="startDate" type="date" format="YYYY-MM-DD" :clearable="false" /></div>
          <div v-if="targetMode === 'new'" class="field ai-duration-field"><label>行程天数</label><ElInputNumber v-model="durationDays" :min="Math.max(1, resolvedDays.length)" :max="365" controls-position="right" /><small>结束日期 {{ endDateLabel }}</small></div>
          <div v-if="targetMode === 'new'" class="field"><label>总预算（元）</label><ElInputNumber v-model="budgetLimit" :min="0" :max="100000000" :precision="2" controls-position="right" placeholder="可选" /></div>
        </div>
        <ParticipantEditor v-if="targetMode === 'new'" v-model="participants" class="ai-import-participant-editor" description="可补充姓名、年龄和票务住宿备注。" />

        <div class="ai-draft-summary">
          <ElTag type="primary" round>{{ durationDays }} 天</ElTag>
          <ElTag v-if="draft.days.length < durationDays" type="info" round>{{ draft.days.length }} 天有明细</ElTag>
          <ElTag type="success" round>{{ selectedCount }} 个地点已匹配</ElTag>
          <ElTag v-if="unresolvedCount" type="warning" round>{{ unresolvedCount }} 个待确认</ElTag>
          <span v-if="draft.origin">起止线索：{{ draft.origin }}{{ draft.returnToOrigin ? '往返' : '' }}</span>
        </div>

        <div v-if="!hasActiveMapProviderConfig()" class="ai-map-required"><i class="pi pi-map-marker" /><span>{{ mapRuntimeState.providerDefinition.name }}配置完成后才能核验并导入地点。</span><ElButton size="small" @click="emit('mapSettings')">配置当前地图</ElButton></div>
        <div v-if="matchingText" class="ai-matching-status"><span class="poi-spinner" />{{ matchingText }}</div>

        <div class="ai-day-preview-list">
          <article v-for="(day, dayIndex) in resolvedDays" :key="dayIndex" class="ai-day-preview">
            <header><strong>{{ day.sourceLabel || `D${dayIndex + 1}` }}</strong><span v-if="day.startArea || day.endArea">{{ day.startArea || '未说明' }} → {{ day.endArea || '未说明' }}</span><em v-if="day.overnightArea">住 {{ day.overnightArea }}（住宿区域待选）</em></header>
            <div v-for="(place, placeIndex) in day.places" :key="`${dayIndex}-${placeIndex}`" class="ai-place-match" :class="{ unresolved: !place.selectedId }">
              <span class="ai-place-order">{{ placeIndex + 1 }}</span>
              <div class="ai-place-source"><b>{{ place.name }}</b><small>{{ place.note || place.kind }}</small></div>
              <ElSelect v-model="place.selectedId" clearable filterable :placeholder="`未找到${mapRuntimeState.providerDefinition.shortName}地点`">
                <ElOption v-for="candidate in place.candidates" :key="candidate.id" :label="candidate.name" :value="candidate.id"><div class="ai-poi-option"><b>{{ candidate.name }}</b><small>{{ candidate.address || candidate.type }}</small></div></ElOption>
              </ElSelect>
              <span class="ai-place-transport">{{ place.transportToNext ? `下一段：${transportModeMeta[place.transportToNext].label}` : '' }}</span>
            </div>
          </article>
        </div>

        <div v-if="draft.uncertainties.length" class="ai-uncertainties"><strong>AI 标记的不确定信息</strong><span v-for="item in draft.uncertainties" :key="item">• {{ item }}</span></div>
      </section>
    </div>

    <template #footer>
      <ElButton text @click="emit('close')">取消</ElButton>
      <ElButton v-if="draft" type="primary" :disabled="selectedCount === 0 || parsing" @click="applyImport">{{ targetMode === 'new' ? '创建并进入新计划' : '合并到当前计划' }}</ElButton>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput, ElOption, ElSelect } from 'element-plus'
import { domToPng } from 'modern-screenshot'
import { generateAiCoverImage, listAiModels } from '../../ai/adapters'
import { zipSync } from 'fflate'
import { expenseCategoryMeta, formatMoney } from '../../domain/budget'
import { categoryMeta } from '../../domain/categories'
import { formatDuration, formatTime, scheduleDay } from '../../domain/schedule'
import { buildPlanRouteProjection, previousPlanStop } from '../../domain/routeProjection'
import { transportModeMeta, transportModeOf } from '../../domain/transport'
import { readAmapConfig } from '../../map/providers/amap/config'
import { loadAmapStaticMapDataUrl } from '../../map/providers/amap/staticMap'
import { useAiProvidersStore } from '../../stores/aiProviders'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import { useWeatherStore } from '../../stores/weather'
import { planDayDateKey } from '../../weather/types'
import { DEFAULT_SHARE_PROMPT, deterministicShareDraft, generateShareDraft, type ShareDraft, type ShareFormat, type SharePlanInput, type ShareStyleId } from '../../share/generator'
import SharePageContent, { type SharePageModel } from '../share/SharePageContent.vue'
import { currentLocale } from '../../i18n'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; settings: []; mapSettings: [] }>()
const planner = usePlannerStore()
const plans = usePlansStore()
const providers = useAiProvidersStore()
const weather = useWeatherStore()
const styleId = ref<ShareStyleId>('journal')
const format = ref<ShareFormat>('cards')
const currentPage = ref(0)
const draft = ref<ShareDraft | null>(null)
const promptExpanded = ref(false)
const prompt = ref(DEFAULT_SHARE_PROMPT)
const selectedInstanceId = ref('')
const selectedModel = ref('')
const generating = ref(false)
const generationMode = ref<'standard' | 'ai-cover'>('standard')
const imageModel = ref('gpt-image-1')
const coverPromptExpanded = ref(false)
const coverPrompt = ref('')
const aiPageBackgrounds = ref<Record<string, string>>({})
const generatingCover = ref(false)
const coverGenerationProgress = ref('')
const fetchingImageModels = ref(false)
const discoveredImageModels = ref<string[]>([])
let imageModelsFetchedFor = ''
const exporting = ref(false)
const photos = ref<string[]>([])
const photoInput = ref<HTMLInputElement | null>(null)
const mapImage = ref('')
const mapImageLoading = ref(false)
const mapImageError = ref('')
const previewCanvas = ref<HTMLElement | null>(null)
const previewScale = ref(0.4)
let previewObserver: ResizeObserver | null = null

const styles: Array<{ id: ShareStyleId; name: string; note: string; ratio: string }> = [
  { id: 'journal', name: '小红书手账', note: '暖色、贴纸和轻松文案', ratio: '3:4' },
  { id: 'clean', name: '清爽攻略', note: '路线清楚，适合照着走', ratio: '3:4' },
  { id: 'magazine', name: '抖音杂志', note: '大标题、强留白、9:16', ratio: '9:16' },
  { id: 'minimal', name: '极简行程', note: '黑白秩序与时间轴', ratio: '3:4' },
]
const selectedStyle = computed(() => styles.find((item) => item.id === styleId.value) ?? styles[0])
const dimensions = computed(() => {
  if (format.value === 'long') return { width: 1080, height: Math.max(2400, 900 + (draft.value?.days.length ?? 1) * 760) }
  if (styleId.value === 'magazine') return { width: 1080, height: 1920 }
  return { width: 1080, height: 1440 }
})
const selectedInstance = computed(() => providers.configuredProfiles.find((item) => item.id === selectedInstanceId.value) ?? null)
const availableModels = computed(() => selectedInstance.value?.models ?? [])
const imageModelSuggestions = computed(() => [...new Set(['gpt-image-1', ...(selectedInstance.value?.models ?? []), ...discoveredImageModels.value].map((model) => model.trim()).filter(Boolean))])

const planInput = computed<SharePlanInput>(() => {
  const plan = plans.activePlan
  const participantCount = Math.max(1, plan?.metadata.participants.length ?? 1)
  const budget = planner.getBudgetSummary(participantCount)
  const projection = buildPlanRouteProjection(planner.days)
  const schedules = planner.days.map((day) => scheduleDay(day, planner.places, planner.routeCache, previousPlanStop(planner.days, day.id)))
  const dateText = plan ? `${new Date(plan.metadata.startAt).toLocaleDateString(currentLocale())}—${new Date(plan.metadata.endAt).toLocaleDateString(currentLocale())}` : ''
  const days: SharePlanInput['days'] = planner.days.map((day, dayIndex) => {
    const schedule = schedules[dayIndex]
    const agenda: SharePlanInput['days'][number]['agenda'] = day.stops.flatMap((stop, stopIndex) => {
      const place = planner.places[stop.placeId]
      if (!place) return []
      const row = schedule?.rows[stopIndex]
      const categoryLabel = categoryMeta[place.category].label
      const detail = [place.userNote, place.type !== categoryLabel ? place.type : '', place.address].find((item) => item?.trim())?.trim() ?? ''
      return [{
        name: place.name,
        category: place.category,
        categoryLabel,
        time: row ? `${formatTime(row.arrival)}–${formatTime(row.departure)}` : '',
        detail: detail.slice(0, 48),
      }]
    })
    const facts: SharePlanInput['days'][number]['facts'] = []
    if (agenda.length && schedule) facts.push({ kind: 'schedule', label: '日程', value: `${formatTime(schedule.rows[0]?.arrival ?? day.start)}–${formatTime(schedule.finish)} · ${agenda.length} 项安排` })
    const dateKey = plan ? planDayDateKey(plan.metadata.startAt, planner.days, day.id) : ''
    const dayWeather = dateKey ? day.stops.map((stop) => weather.weatherFor(stop.placeId, dateKey)).find((item) => item?.status === 'available') : null
    if (dayWeather) {
      const temperatures = dayWeather.minTemp != null && dayWeather.maxTemp != null ? `${dayWeather.minTemp}–${dayWeather.maxTemp}℃` : ''
      const weatherText = [dayWeather.condition, temperatures].filter(Boolean).join(' · ')
      if (weatherText) facts.push({ kind: 'weather', label: '天气', value: weatherText })
    }
    const lodging = agenda.filter((item) => item.category === 'lodging').map((item) => item.name)
    const food = agenda.filter((item) => item.category === 'food').map((item) => item.name)
    const overnightLabels = { 'night-transport': '夜间交通', camping: '露营', friends: '住亲友家', 'no-lodging': '无需住宿' } as const
    if (lodging.length) facts.push({ kind: 'lodging', label: '住宿', value: lodging.join('、') })
    else if (day.overnightMode && day.overnightMode !== 'auto') facts.push({ kind: 'lodging', label: '过夜', value: overnightLabels[day.overnightMode] })
    if (food.length) facts.push({ kind: 'food', label: '美食', value: food.join('、') })
    const daySegments = projection.segments.filter((segment) => segment.ownerDayId === day.id && segment.from.stop.placeId !== segment.to.stop.placeId)
    const transportLabels = [...new Set(daySegments.map((segment) => transportModeMeta[transportModeOf(segment.from.stop.transportMode)].label))]
    const transportNumbers = [...new Set(daySegments.map((segment) => segment.from.stop.transportNumber?.trim()).filter(Boolean))]
    if (schedule && (schedule.travel > 0 || transportLabels.length)) {
      const modeText = [transportLabels.join(' / ') || '行程移动', transportNumbers.join(' / ')].filter(Boolean).join(' · ')
      facts.push({ kind: 'transport', label: '交通', value: `${modeText} · ${formatDuration(schedule.travel)}${schedule.km > 0 ? ` · ${Math.round(schedule.km)} km` : ''}` })
    }
    const dayExpenseLines = budget.lines.filter((line) => line.dayId === day.id && line.expected > 0)
    const expenseByCategory = new Map<string, number>()
    dayExpenseLines.forEach((line) => expenseByCategory.set(line.category, (expenseByCategory.get(line.category) ?? 0) + line.expected))
    const expenseDetails = [...expenseByCategory.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3).map(([category, amount]) => `${expenseCategoryMeta[category as keyof typeof expenseCategoryMeta].label} ${formatMoney(amount)}`)
    const dayBudget = budget.dayTotals[day.id] ?? 0
    if (dayBudget > 0) facts.push({ kind: 'budget', label: '当日预算', value: [formatMoney(dayBudget), ...expenseDetails].join(' · ') })
    const places = agenda.map((item) => item.name)
    return { label: `${day.label} · ${day.date}`, date: day.date, places, route: places.join(' → '), agenda, facts }
  })
  const overviewFacts: SharePlanInput['overviewFacts'] = []
  const participantNames = plan?.metadata.participants.map((item) => item.name.trim()).filter(Boolean) ?? []
  overviewFacts.push({ kind: 'people', label: '同行', value: `${participantCount} 人${participantNames.length ? ` · ${participantNames.slice(0, 4).join('、')}` : ''}` })
  const totalKm = schedules.reduce((sum, item) => sum + item.km, 0)
  const totalTravelMinutes = schedules.reduce((sum, item) => sum + item.travel, 0)
  if (totalTravelMinutes > 0 || totalKm > 0) overviewFacts.push({ kind: 'transport', label: '全程交通', value: `${formatDuration(totalTravelMinutes)} · ${Math.round(totalKm)} km` })
  const lodgingCount = days.reduce((sum, day) => sum + day.agenda.filter((item) => item.category === 'lodging').length, 0)
  const foodCount = days.reduce((sum, day) => sum + day.agenda.filter((item) => item.category === 'food').length, 0)
  if (lodgingCount) overviewFacts.push({ kind: 'lodging', label: '住宿', value: `${lodgingCount} 处已编排行程` })
  if (foodCount) overviewFacts.push({ kind: 'food', label: '美食', value: `${foodCount} 处已编排行程` })
  if (budget.totalExpected > 0) overviewFacts.push({ kind: 'budget', label: '预算', value: `${formatMoney(budget.totalExpected)} · 人均 ${formatMoney(budget.perPerson)}` })
  return {
    planName: plan?.metadata.name ?? '旅行计划', dateRange: dateText, totalDays: planner.days.length,
    totalKm, totalTravelMinutes,
    budgetText: budget.totalExpected > 0 ? `预计预算 ${formatMoney(budget.totalExpected)}` : '',
    overviewFacts,
    days,
  }
})
const metaText = computed(() => `${planInput.value.totalDays} 天 · ${planInput.value.dateRange}`)
const metricsText = computed(() => `${Math.round(planInput.value.totalKm)} km · 交通 ${formatDuration(planInput.value.totalTravelMinutes)}`)
const pages = computed<SharePageModel[]>(() => {
  if (!draft.value) return []
  if (format.value === 'poster') return [{ id: 'cover', kind: 'cover' }]
  if (format.value === 'long') return [{ id: 'long', kind: 'long' }]
  return [{ id: 'cover', kind: 'cover' }, { id: 'map', kind: 'map' }, { id: 'overview', kind: 'overview' }, ...draft.value.days.map((day, index) => ({ id: `day-${index}`, kind: 'day' as const, day })), { id: 'tips', kind: 'tips' }]
})
const backgroundTargets = computed(() => pages.value.filter((page) => page.kind !== 'map'))
const generatedBackgroundCount = computed(() => Object.keys(aiPageBackgrounds.value).length)

function updatePreviewScale(): void {
  const canvas = previewCanvas.value
  if (!canvas) return
  const availableWidth = Math.max(220, canvas.clientWidth - 28)
  const availableHeight = Math.max(320, canvas.clientHeight - 28)
  previewScale.value = format.value === 'long'
    ? Math.min(0.68, availableWidth / dimensions.value.width)
    : Math.min(0.72, availableWidth / dimensions.value.width, availableHeight / dimensions.value.height)
}

watch(previewCanvas, (element) => {
  previewObserver?.disconnect()
  previewObserver = null
  if (!element || typeof ResizeObserver === 'undefined') return
  previewObserver = new ResizeObserver(updatePreviewScale)
  previewObserver.observe(element)
  nextTick(updatePreviewScale)
})
watch([dimensions, format, () => props.open], () => nextTick(updatePreviewScale))
onBeforeUnmount(() => previewObserver?.disconnect())

async function loadShareMap(): Promise<void> {
  const webServiceKey = readAmapConfig()?.webServiceKey ?? ''
  const places = planner.days.flatMap((day) => day.stops.map((stop) => planner.places[stop.placeId]).filter(Boolean))
  mapImage.value = ''
  mapImageError.value = ''
  if (!webServiceKey) { mapImageError.value = '配置高德 Web 服务 Key 后可生成带真实底图的路线卡片'; return }
  if (!places.length) { mapImageError.value = '当前计划还没有可用于绘图的地点'; return }
  mapImageLoading.value = true
  try { mapImage.value = await loadAmapStaticMapDataUrl(places, webServiceKey) }
  catch (error) { mapImageError.value = error instanceof Error ? error.message : '高德静态地图生成失败' }
  finally { mapImageLoading.value = false }
}

watch(() => props.open, (open) => {
  if (!open) return
  selectedInstanceId.value = providers.activeConfiguredProfile?.id ?? providers.configuredProfiles[0]?.id ?? ''
  selectedModel.value = selectedInstance.value?.model ?? selectedInstance.value?.models[0] ?? ''
  styleId.value = 'journal'; format.value = 'cards'; currentPage.value = 0; prompt.value = DEFAULT_SHARE_PROMPT; promptExpanded.value = false; photos.value = []; generationMode.value = 'standard'; imageModel.value = 'gpt-image-1'; coverPromptExpanded.value = false; aiPageBackgrounds.value = {}; coverGenerationProgress.value = ''; coverPrompt.value = ''; discoveredImageModels.value = []; imageModelsFetchedFor = ''
  draft.value = deterministicShareDraft(planInput.value)
  void loadShareMap()
}, { immediate: true })
watch(selectedInstanceId, () => { selectedModel.value = selectedInstance.value?.model ?? selectedInstance.value?.models[0] ?? ''; discoveredImageModels.value = []; imageModelsFetchedFor = ''; const preferred = selectedInstance.value?.models.find((model) => /image|dall|flux|stable/i.test(model)); imageModel.value = preferred ?? selectedInstance.value?.model ?? 'gpt-image-1' })
watch(pages, () => { currentPage.value = Math.min(currentPage.value, Math.max(0, pages.value.length - 1)) })

async function generateWithAi(): Promise<void> {
  const instance = selectedInstance.value
  if (!instance || !selectedModel.value) { emit('settings'); return }
  generating.value = true
  try {
    const profile = { ...instance, model: selectedModel.value }
    draft.value = await generateShareDraft(profile, providers.readSecret(instance.id).apiKey, planInput.value, prompt.value)
    planner.notify('分享文案已生成，可以继续编辑和预览')
  } catch (error) { planner.notify(error instanceof Error ? error.message : '分享文案生成失败') }
  finally { generating.value = false }
}

async function fetchImageModels(force = true): Promise<void> {
  const instance = selectedInstance.value
  if (!instance || fetchingImageModels.value) return
  if (!force && imageModelsFetchedFor === instance.id) return
  fetchingImageModels.value = true
  try {
    const models = await listAiModels(instance, providers.readSecret(instance.id).apiKey)
    discoveredImageModels.value = models
    imageModelsFetchedFor = instance.id
    planner.notify(`已获取 ${models.length} 个模型；图片生成能力以供应商接口为准`)
  } catch (error) { planner.notify(error instanceof Error ? error.message : '模型列表查询失败，仍可手动输入图片模型') }
  finally { fetchingImageModels.value = false }
}

function pageBackgroundPrompt(page: SharePageModel, index: number): string {
  const custom = coverPrompt.value.trim()
  const style = selectedStyle.value.name
  const shared = `高质量竖版旅行视觉背景，${style}，真实旅行摄影或高级旅行杂志质感，构图有明显留白，适合后续叠加中文排版。不要生成任何文字、数字、地图、路线、Logo、水印、边框或界面元素。`
  let subject = `旅行计划“${planInput.value.planName}”，综合表现路线、住宿、美食与旅行体验。地点意象：${planInput.value.days.flatMap((day) => day.places).slice(0, 6).join('、') || '中国旅行目的地'}。`
  if (page.kind === 'day' && page.day) {
    const content = page.day.agenda.map((item) => `${item.categoryLabel}${item.name}`).slice(0, 6).join('、')
    const facts = page.day.facts.map((item) => `${item.label}${item.value}`).slice(0, 4).join('；')
    subject = `${page.day.label} 的旅行背景，当天真实计划包含：${content || page.day.title}${facts ? `；${facts}` : ''}。不要只表现景点；若当天包含住宿或美食，可用舒适客房、当地餐桌等无品牌氛围自然融入画面，但不要虚构店铺招牌或具体菜名。`
  }
  else if (page.kind === 'overview') subject = `旅行总览背景，综合表现沿途风景、交通移动、住宿休息与当地饮食的层次感，但不要绘制地图。`
  else if (page.kind === 'tips') subject = `旅行准备与出行提醒背景，包含克制的行李、天气与道路旅行意象，不要出现文字。`
  else if (page.kind === 'long') subject = `完整长图的统一旅行背景，画面边缘简洁，中部大面积留白。`
  return `${custom ? `${custom}
` : ''}${subject}${shared} 第 ${index + 1} 张卡片应与同组其他卡片风格统一，但画面内容不要重复。`
}

function pageImage(page: SharePageModel, index: number): string {
  if (page.kind === 'map') return ''
  return photos.value[index % Math.max(1, photos.value.length)] || aiPageBackgrounds.value[page.id] || (page.kind === 'cover' ? mapImage.value : '')
}

async function generateCardBackgrounds(): Promise<void> {
  const instance = selectedInstance.value
  if (!instance) { emit('settings'); return }
  generationMode.value = 'ai-cover'
  generatingCover.value = true
  const next = { ...aiPageBackgrounds.value }
  let completed = 0
  let failed = 0
  try {
    for (let index = 0; index < backgroundTargets.value.length; index += 1) {
      const page = backgroundTargets.value[index]
      coverGenerationProgress.value = `${index + 1} / ${backgroundTargets.value.length}`
      try { next[page.id] = await generateAiCoverImage(instance, providers.readSecret(instance.id).apiKey, imageModel.value, pageBackgroundPrompt(page, index)); completed += 1 }
      catch { failed += 1 }
      aiPageBackgrounds.value = { ...next }
    }
    planner.notify(failed ? `已生成 ${completed} 张背景，${failed} 张失败，可单独重试` : `已为 ${completed} 张分享卡片生成适配背景`)
  } finally { generatingCover.value = false; coverGenerationProgress.value = '' }
}


function choosePhotos(): void { photoInput.value?.click() }
function loadPhotos(event: Event): void {
  const files = Array.from((event.target as HTMLInputElement).files ?? []).slice(0, 8)
  files.forEach((file) => { const reader = new FileReader(); reader.onload = () => photos.value.push(String(reader.result)); reader.readAsDataURL(file) })
  ;(event.target as HTMLInputElement).value = ''
}
function safeName(value: string): string { return value.replace(/[\\/:*?"<>|]/g, '_').trim() || '旅行计划' }
function downloadBlob(blob: Blob, name: string): void { const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
async function renderPage(index: number): Promise<{ name: string; dataUrl: string }> {
  await nextTick()
  const node = document.querySelector<HTMLElement>(`.share-export-stage [data-export-page="${index}"]`)
  if (!node) throw new Error('分享页面尚未准备完成')
  const dataUrl = await domToPng(node, { backgroundColor: '#ffffff', scale: 1 })
  return { name: `${safeName(planInput.value.planName)}_${String(index + 1).padStart(2, '0')}.png`, dataUrl }
}
function dataUrlBytes(dataUrl: string): Uint8Array<ArrayBuffer> { const binary = atob(dataUrl.split(',')[1] ?? ''); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); return bytes }
async function downloadCurrent(): Promise<void> { exporting.value = true; try { const file = await renderPage(currentPage.value); downloadBlob(new Blob([dataUrlBytes(file.dataUrl)], { type: 'image/png' }), file.name) } catch (error) { planner.notify(error instanceof Error ? error.message : '图片导出失败') } finally { exporting.value = false } }
async function downloadAll(): Promise<void> {
  exporting.value = true
  try {
    const files: Record<string, Uint8Array> = {}
    for (let index = 0; index < pages.value.length; index += 1) { const file = await renderPage(index); files[file.name] = dataUrlBytes(file.dataUrl) }
    const zip = zipSync(files, { level: 6 })
    downloadBlob(new Blob([zip], { type: 'application/zip' }), `${safeName(planInput.value.planName)}_${selectedStyle.value.name}.zip`)
  } catch (error) { planner.notify(error instanceof Error ? error.message : '分享图片打包失败') }
  finally { exporting.value = false }
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog share-studio-modal" width="1280px" top="3vh" destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header><div class="share-dialog-title"><span><i class="pi pi-share-alt" /></span><div><h2>分享工作室</h2><p>用计划数据生成适合手机阅读的图文卡片，不截取当前工作台。</p></div></div></template>
    <div v-if="draft" class="share-studio-layout">
      <aside class="share-settings-panel">
        <section><label>分享形式</label><div class="share-format-tabs"><button v-for="item in [{id:'cards',name:'多图卡片'},{id:'long',name:'单张长图'},{id:'poster',name:'封面海报'}]" :key="item.id" :class="{active:format===item.id}" @click="format=item.id as ShareFormat">{{ item.name }}</button></div></section>
        <section><label>风格对比</label><div class="share-style-grid"><button v-for="style in styles" :key="style.id" :class="{active:styleId===style.id}" @click="styleId=style.id"><b>{{ style.name }}</b><small>{{ style.note }}</small><em>{{ style.ratio }}</em></button></div></section>
        <section class="share-generation-mode"><label>封面生成</label><div class="share-cover-mode-tabs"><button :class="{active:generationMode==='standard'}" @click="generationMode='standard'">模板 / 真实地图</button><button :class="{active:generationMode==='ai-cover'}" @click="generationMode='ai-cover'">AI 多卡背景 + 真实内容</button></div><template v-if="generationMode==='ai-cover'"><div class="share-ai-row share-image-model-row"><ElSelect v-model="selectedInstanceId" placeholder="AI 接入实例"><ElOption v-for="item in providers.configuredProfiles" :key="item.id" :label="item.id === providers.activeId ? `${item.name}（默认）` : item.name" :value="item.id" /></ElSelect><ElSelect v-model="imageModel" filterable allow-create default-first-option placeholder="可选择或输入任意图片模型" @visible-change="(visible:boolean)=>visible&&fetchImageModels(false)"><ElOption v-for="model in imageModelSuggestions" :key="model" :label="model" :value="model" /></ElSelect><ElButton circle :loading="fetchingImageModels" title="从供应商刷新模型" @click="fetchImageModels(true)"><i class="pi pi-refresh" /></ElButton></div><ElButton type="primary" plain :loading="generatingCover" :disabled="selectedInstance?.protocol==='anthropic-messages'" @click="generateCardBackgrounds"><i class="pi pi-image" />{{ generatingCover ? `正在生成 ${coverGenerationProgress}` : generatedBackgroundCount ? `重新生成 ${backgroundTargets.length} 张背景` : `生成 ${backgroundTargets.length} 张卡片背景` }}</ElButton><small v-if="selectedInstance?.protocol==='anthropic-messages'">Anthropic 协议实例不提供图片生成接口，请选择 OpenAI 兼容实例。</small><button class="share-prompt-toggle" @click="coverPromptExpanded=!coverPromptExpanded"><span>AI 封面提示词</span><i :class="coverPromptExpanded?'pi pi-chevron-up':'pi pi-chevron-down'" /></button><ElInput v-if="coverPromptExpanded" v-model="coverPrompt" type="textarea" :rows="5" :placeholder="'补充整套背景的统一视觉要求，例如：秋季高原、自然纪实、低饱和暖色。每张卡片仍会自动加入各自的地点和内容提示。'" /><div v-if="generatedBackgroundCount" class="share-cover-thumb-grid"><figure v-for="page in backgroundTargets" :key="page.id" v-show="aiPageBackgrounds[page.id]"><img :src="aiPageBackgrounds[page.id]" :alt="`${page.id} AI 背景`"><figcaption>{{ page.kind === 'day' ? page.day?.label : page.kind }}</figcaption><button @click="delete aiPageBackgrounds[page.id]">×</button></figure></div></template><small>下拉框展示实例保存及供应商返回的全部模型，也可手动输入；其中可能包含不支持图片生成的文本模型，最终以供应商图片接口响应为准。多图模式会为封面、总览、每天行程和提醒页分别生成不同背景；地图页始终使用真实地图。AI 只生成无文字背景，真实内容仍由模板叠加。</small></section>
        <section><label>AI 文案</label><div class="share-ai-row"><ElSelect v-model="selectedInstanceId" placeholder="选择 AI 实例"><ElOption v-for="item in providers.configuredProfiles" :key="item.id" :label="item.id === providers.activeId ? `${item.name}（默认）` : item.name" :value="item.id" /></ElSelect><ElSelect v-model="selectedModel" filterable allow-create placeholder="模型"><ElOption v-for="model in availableModels" :key="model" :label="model" :value="model" /></ElSelect></div><ElButton type="primary" plain :loading="generating" @click="generateWithAi"><i class="pi pi-sparkles" />{{ selectedInstance ? '用 AI 生成分享文案' : '配置 AI 后生成文案' }}</ElButton><button class="share-prompt-toggle" @click="promptExpanded=!promptExpanded"><span>自定义提示词</span><i :class="promptExpanded?'pi pi-chevron-up':'pi pi-chevron-down'" /></button><ElInput v-if="promptExpanded" v-model="prompt" type="textarea" :rows="7" /></section>
        <section><label>可编辑文案</label><small class="share-derived-note">时间轴、住宿、美食、交通、天气和预算会直接读取当前计划，避免 AI 改写事实；这里仅编辑标题与描述。</small><ElInput v-model="draft.title" placeholder="分享标题" /><ElInput v-model="draft.subtitle" placeholder="副标题" /><ElInput v-model="draft.overview" type="textarea" :rows="3" placeholder="行程总览" /><details class="share-day-edit" v-for="day in draft.days" :key="day.label"><summary>{{ day.label }} · {{ day.title }}</summary><ElInput v-model="day.title" /><ElInput v-model="day.summary" type="textarea" :rows="2" /></details></section>
        <section class="share-map-source"><label>路线地图</label><div v-if="mapImageLoading" class="share-map-status"><span class="poi-spinner" />正在生成高德静态路线图…</div><div v-else-if="mapImage" class="share-map-status ready"><i class="pi pi-map" />已加入高德真实底图路线页<ElButton text size="small" @click="loadShareMap"><i class="pi pi-refresh" />刷新</ElButton></div><div v-else class="share-map-status warning"><i class="pi pi-info-circle" /><span>{{ mapImageError }}</span><ElButton text size="small" @click="emit('mapSettings')">配置</ElButton></div></section>
        <section><label>照片素材</label><input ref="photoInput" type="file" class="hidden" accept="image/*" multiple @change="loadPhotos"><ElButton @click="choosePhotos"><i class="pi pi-image" />上传照片</ElButton><span class="share-photo-count">{{ photos.length ? `已选择 ${photos.length} 张` : '无照片时使用路线图形与主题背景' }}</span></section>
      </aside>
      <main class="share-preview-panel">
        <header><div><b>{{ selectedStyle.name }}</b><span>{{ dimensions.width }} × {{ dimensions.height }} · {{ pages.length }} 张</span></div><div><ElButton :disabled="currentPage<=0" circle @click="currentPage--"><i class="pi pi-angle-left" /></ElButton><span>{{ currentPage+1 }} / {{ pages.length }}</span><ElButton :disabled="currentPage>=pages.length-1" circle @click="currentPage++"><i class="pi pi-angle-right" /></ElButton></div></header>
        <div ref="previewCanvas" class="share-preview-canvas" :class="{ 'is-long': format === 'long' }"><div class="share-preview-shell" :style="{width:`${dimensions.width*previewScale}px`,height:`${dimensions.height*previewScale}px`}"><div class="share-preview-scale" :style="{transform:`scale(${previewScale})`,width:`${dimensions.width}px`,height:`${dimensions.height}px`}"><SharePageContent :page="pages[currentPage]" :draft="draft" :style-id="styleId" :meta="metaText" :metrics="metricsText" :photo="pageImage(pages[currentPage], currentPage)" :map-image="mapImage" :style="{width:`${dimensions.width}px`,height:`${dimensions.height}px`} " /></div></div></div>
        <footer><span>图片只使用当前计划、用户编辑文案和已上传素材。</span><ElButton :loading="exporting" @click="downloadCurrent">下载当前图</ElButton><ElButton type="primary" :loading="exporting" @click="downloadAll"><i class="pi pi-download" />{{ pages.length>1?'打包下载':'下载图片' }}</ElButton></footer>
      </main>
    </div>
    <div class="share-export-stage" aria-hidden="true"><SharePageContent v-for="(page,index) in pages" :key="page.id" :data-export-page="index" :page="page" :draft="draft!" :style-id="styleId" :meta="metaText" :metrics="metricsText" :photo="pageImage(page, index)" :map-image="mapImage" :style="{width:`${dimensions.width}px`,height:`${dimensions.height}px`} " /></div>
  </ElDialog>
</template>

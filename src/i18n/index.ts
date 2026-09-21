import { createI18n } from 'vue-i18n'
import { ref, watch } from 'vue'
import legacyEnglish from './legacy.en.json'

export type AppLocale = 'zh-CN' | 'en-US'

export const APP_LOCALE_STORAGE_KEY = 'interactiveTravel.locale.v1'
const STORAGE_KEY = APP_LOCALE_STORAGE_KEY
const supportedLocales: AppLocale[] = ['zh-CN', 'en-US']

function initialLocale(): AppLocale {
  const saved = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
  if (supportedLocales.includes(saved as AppLocale)) return saved as AppLocale
  const browserLanguage = typeof navigator === 'undefined' ? 'zh-CN' : navigator.language
  return browserLanguage.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export const appLocale = ref<AppLocale>(initialLocale())

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: appLocale.value,
  fallbackLocale: 'zh-CN',
  messages: {
    'zh-CN': {
      locale: { label: '语言', chinese: '中文', english: 'English' },
      app: { name: '行途规划', title: '行途规划 · 互动式旅行路线规划器' },
    },
    'en-US': {
      locale: { label: 'Language', chinese: '中文', english: 'English' },
      app: { name: 'TripPath', title: 'TripPath · Interactive Travel Planner' },
    },
  },
})

const overrides: Record<string, string> = {
  '行途规划': 'TripPath',
  '至': 'to',
  '人': 'people',
  '天': 'days',
  '分': 'min',
  '元': 'CNY',
  '互动式旅行路线规划器': 'Interactive Travel Planner',
  '我的旅行计划': 'My trips',
  '全部计划': 'All trips',
  '旅行计划': 'Trip',
  '地图运行方案': 'Map setup',
  '地图显示': 'Map renderer',
  '地点搜索': 'Place search',
  '路线计算': 'Routing service',
  '未安排地点': 'Unscheduled places',
  '未安排': 'Unscheduled',
  '按天编排': 'Daily itinerary',
  '检查计划': 'Check trip',
  '计划可行': 'Trip looks feasible',
  '计划名称': 'Trip name',
  '新建计划': 'New trip',
  '新建旅行计划': 'New trip',
  'AI 导入计划': 'Import with AI',
  'AI 导入': 'AI import',
  '费用明细': 'Expense details',
  '旅行预算': 'Trip budget',
  '总预算': 'Total budget',
  '预算参数': 'Budget settings',
  '完整迁移': 'Full migration',
  '导入导出': 'Import & export',
  '仅旅行计划': 'Trips only',
  '仅服务配置': 'Service settings only',
  '地图选点': 'Pick on map',
  '搜周边': 'Search nearby',
  '从地图拾取地点': 'Pick a place from the map',
  '当前路线': 'Current route',
  '全程路线': 'Full route',
  '全天路线': 'Day route',
  '路线方案': 'Route options',
  '路线计算失败': 'Route calculation failed',
  '自动视角': 'Auto camera',
  '漫游速度': 'Tour speed',
  '自定义': 'Custom',
  '配置天气': 'Configure weather',
  '天气关闭': 'Weather off',
  '风险提示': 'Risk alerts',
  '出行提醒': 'Travel alerts',
  '已自动保存': 'Saved',
  '正在保存': 'Saving',
  '保存失败': 'Save failed',
  '待出发': 'Upcoming',
  '进行中': 'In progress',
  '已结束': 'Completed',
  '待核价': 'Price needed',
  '需配置': 'Setup required',
  '已配置': 'Configured',
  '默认': 'Default',
  '默认实例': 'Default instance',
  '设为默认': 'Set as default',
  '默认服务': 'Default service',
  '保存并设为默认': 'Save & set default',
  '保存默认服务': 'Save default service',
  '默认方案': 'Default setup',
  '保存配置': 'Save settings',
  '恢复内置默认': 'Restore defaults',
  '查看川西示例': 'View sample trip',
  '打开回收站': 'Open recycle bin',
  '参与人员': 'Travelers',
  '精确到秒': 'To the second',
  '地图搜索、附近发现和地点详情': 'Map search, nearby discovery, and place details',
  '路线、时长、里程和候选方案': 'Routes, duration, distance, and alternatives',
  '配置会应用到所有旅行计划。': 'The setup applies to all trips.',
  '高德 JavaScript API 2.0': 'AMap JavaScript API 2.0',
  '腾讯 JavaScript API GL': 'Tencent Maps JavaScript API GL',
  '高德天气尚未配置': 'AMap Weather is not configured',
  '自然景区': 'Natural attraction',
  '古镇': 'Historic town',
  '观景点': 'Viewpoint',
  '摄影地': 'Photo spot',
  '草原': 'Grassland',
  '创建第一个计划，开始收集地点并安排路线。': 'Create your first trip, collect places, and build the route.',
  '从地点收集、按天编排到路线与时间校验，每个计划都是一个独立工作空间。': 'Collect places, build a daily itinerary, and validate routes and timing in one workspace.',
}

const englishCatalog = { ...(legacyEnglish as Record<string, string>), ...overrides }

const patterns: Array<[RegExp, (...matches: string[]) => string]> = [
  [/^(\d+) 个旅行计划 · 按开始时间倒序$/, (count) => `${count} trips · sorted by start date`],
  [/^最近编辑 (.+)$/, (value) => `Last edited ${value}`],
  [/^(\d+) 个问题$/, (count) => `${count} issues`],
  [/^(\d+) 人$/, (count) => `${count} travelers`],
  [/^(\d+) 天$/, (count) => `${count} days`],
  [/^剩余(.+)$/, (value) => `${value} remaining`],
  [/^(.+)后出发$/, (value) => `Departs in ${value}`],
  [/^(.+)前结束$/, (value) => `Ended ${value} ago`],
  [/^加入 (.+)$/, (value) => `Add to ${value}`],
  [/^海拔 ([\d,.]+) m$/, (value) => `Elevation ${value} m`],
  [/^导出于 (.+)$/, (value) => `Exported ${value}`],
  [/^已定位到当前位置：(.+)$/, (value) => `Current location: ${value}`],
  [/^配置(.+)后开始规划$/, (provider) => `Configure ${provider} to start planning`],
  [/^(.+)需要完成独立配置。配置只保存在当前浏览器，不会内置到项目中。$/, (provider) => `${provider} requires its own setup. Settings stay in this browser and are never bundled with the app.`],
  [/^(.+)天气尚未配置$/, (provider) => `${provider} weather is not configured`],
  [/^驾驶上限 (.+)$/, (value) => `Driving limit ${value}`],
  [/^从 (.+) 开始$/, (value) => `Starts at ${value}`],
  [/^把未安排地点拖到 (.+)$/, (day) => `Drag unscheduled places to ${day}`],
  [/^(\d+) 个本地匹配 · 输入 2 字自动查高德$/, (count) => `${count} local matches · enter 2 characters to search AMap`],
  [/^当前设置：(.+)$/, (value) => `Current setting: ${value}`],
  [/^(.+)自动规划$/, (provider) => `${provider} auto route`],
  [/^(.+)路线方案 · 数据来自(.+)$/, (mode, provider) => `${mode} route options · Data from ${provider}`],
  [/^Day (\d+) 全天途经点路线$/, (day) => `Day ${day} route with all stops`],
]

export function translateLegacyText(value: string): string {
  if (appLocale.value === 'zh-CN' || !value) return value
  const trimmed = value.trim()
  const exact = overrides[trimmed] ?? (trimmed.length > 1 ? englishCatalog[trimmed] : undefined)
  if (exact) return value.replace(trimmed, exact)
  for (const [pattern, formatter] of patterns) {
    const match = pattern.exec(trimmed)
    if (match) return value.replace(trimmed, formatter(...match.slice(1)))
  }
  const fragments = trimmed
    .replace(/(\d+)天/g, '$1d')
    .replace(/(\d+)小时/g, '$1h')
    .replace(/(\d+)分钟/g, '$1m')
    .replace(/(\d+)分(?!钟)/g, '$1m')
    .replace(/(\d+) 个?地点/g, '$1 places')
    .replace(/(.+) 完成$/, 'Finish $1')
  return fragments === trimmed ? value : value.replace(trimmed, fragments)
}

export function setAppLocale(locale: AppLocale): void {
  if (!supportedLocales.includes(locale)) return
  appLocale.value = locale
}

export function currentLocale(): AppLocale {
  return appLocale.value
}

export function localizeAiSystemPrompt(prompt: string): string {
  if (appLocale.value === 'zh-CN') return prompt
  return `${prompt.trim()}

Output language requirement: write all user-facing explanations, labels, warnings, reasons, notes, and generated copy in English. Preserve official place names when translating them would make map matching less reliable.`
}

const ignoredSelector = [
  '[data-i18n-ignore]', '.brandmark', '.category-icon', '.map-engine-logo', '.map-route-info-glyph',
  '.tripname', '.plan-card-title', '.stopname', '.travel-marker-label', '.cesium-place-marker-name',
  '.user-place-description', '.structured-place-summary', '.place-introduction', '.map-place-description',
  '.ai-source-preview', '.share-card-user-copy', 'textarea', 'script', 'style',
].join(',')

const textOriginals = new WeakMap<Text, string>()
const attributeOriginals = new WeakMap<Element, Map<string, string>>()
const translatableAttributes = ['title', 'placeholder', 'aria-label', 'alt']
let observer: MutationObserver | null = null
let rootElement: HTMLElement | null = null

function ignored(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement
  return Boolean(element?.closest(ignoredSelector))
}

function localizeTextNode(node: Text): void {
  if (ignored(node)) return
  if (appLocale.value === 'zh-CN') {
    const original = textOriginals.get(node)
    if (original != null && node.data !== original) node.data = original
    return
  }
  if (!/[\u3400-\u9fff]/.test(node.data)) return
  const original = node.data
  const translated = translateLegacyText(original)
  if (translated !== original) {
    textOriginals.set(node, original)
    node.data = translated
  }
}

function localizeElement(element: Element): void {
  if (ignored(element)) return
  for (const name of translatableAttributes) {
    const current = element.getAttribute(name)
    if (!current) continue
    if (appLocale.value === 'zh-CN') {
      const original = attributeOriginals.get(element)?.get(name)
      if (original != null && current !== original) element.setAttribute(name, original)
      continue
    }
    if (!/[\u3400-\u9fff]/.test(current)) continue
    const translated = translateLegacyText(current)
    if (translated === current) continue
    let originals = attributeOriginals.get(element)
    if (!originals) { originals = new Map(); attributeOriginals.set(element, originals) }
    originals.set(name, current)
    element.setAttribute(name, translated)
  }
}

function localizeTree(root: Node): void {
  if (root.nodeType === Node.TEXT_NODE) { localizeTextNode(root as Text); return }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return
  if (root.nodeType === Node.ELEMENT_NODE) localizeElement(root as Element)
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  let node: Node | null = walker.nextNode()
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) localizeTextNode(node as Text)
    else localizeElement(node as Element)
    node = walker.nextNode()
  }
}

function applyDocumentLocale(): void {
  const locale = appLocale.value
  i18n.global.locale.value = locale
  if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, locale)
  if (typeof document === 'undefined') return
  document.documentElement.lang = locale
  document.title = locale === 'zh-CN' ? '行途规划 · 互动式旅行路线规划器' : 'TripPath · Interactive Travel Planner'
  if (rootElement) localizeTree(rootElement)
  document.querySelectorAll('.el-popper, .el-overlay').forEach((element) => localizeTree(element))
}

export function installLegacyDomLocalization(root: HTMLElement): () => void {
  rootElement = root
  applyDocumentLocale()
  observer?.disconnect()
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'characterData') localizeTextNode(mutation.target as Text)
      else if (mutation.type === 'attributes') localizeElement(mutation.target as Element)
      else mutation.addedNodes.forEach(localizeTree)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: translatableAttributes })
  return () => { observer?.disconnect(); observer = null; rootElement = null }
}

watch(appLocale, applyDocumentLocale)

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElCheckbox, ElDialog, ElRadioButton, ElRadioGroup, ElTag } from 'element-plus'
import { createCompleteBackup, parseCompleteBackup, type CompleteBackupPayload } from '../../backup/completeBackup'
import { importServiceConfigBackup, inspectServiceConfigBackup, type ServiceConfigBackupSummary, type ServiceConfigImportStrategy } from '../../config/serviceConfigBackup'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import { currentLocale } from '../../i18n'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const planner = usePlannerStore()
const plans = usePlansStore()
const includeCredentials = ref(true)
const fileInput = ref<HTMLInputElement | null>(null)
const parsed = ref<CompleteBackupPayload | null>(null)
const planPreview = ref<{ plans: any[]; conflicts: number } | null>(null)
const servicePreview = ref<ServiceConfigBackupSummary | null>(null)
const planStrategy = ref<'copy' | 'overwrite'>('copy')
const configStrategy = ref<ServiceConfigImportStrategy>('merge')
const fileName = ref('')
const error = ref('')
const importing = ref(false)
const currentServiceSummary = computed(() => inspectServiceConfigBackup(createCompleteBackup(plans.createBackup(), includeCredentials.value).services))

watch(() => props.open, (open) => {
  if (!open) return
  includeCredentials.value = true
  parsed.value = null
  planPreview.value = null
  servicePreview.value = null
  planStrategy.value = 'copy'
  configStrategy.value = 'merge'
  fileName.value = ''
  error.value = ''
  importing.value = false
})

function localDateKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function downloadCompleteBackup(): void {
  const payload = createCompleteBackup(plans.createBackup(), includeCredentials.value)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `行途规划-完整迁移-${localDateKey()}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function chooseFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  error.value = ''
  fileName.value = file.name
  try {
    const value = parseCompleteBackup(JSON.parse(await file.text()))
    const rawPlanCount = value.plans.plans.length
    planPreview.value = rawPlanCount ? plans.inspectBackup(value.plans) : { plans: [], conflicts: 0 }
    servicePreview.value = inspectServiceConfigBackup(value.services)
    parsed.value = value
  } catch (reason) {
    parsed.value = null
    planPreview.value = null
    servicePreview.value = null
    error.value = reason instanceof Error ? reason.message : '无法读取完整迁移文件'
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

function importCompleteBackup(): void {
  if (!parsed.value || !planPreview.value || !servicePreview.value) return
  importing.value = true
  error.value = ''
  try {
    if (planPreview.value.plans.length) plans.importBackup(parsed.value.plans, planStrategy.value)
    importServiceConfigBackup(parsed.value.services, configStrategy.value)
    planner.notify(`完整迁移已恢复：${planPreview.value.plans.length} 个计划、${servicePreview.value.aiProfiles} 个 AI 实例和 ${servicePreview.value.mapProviders.length + servicePreview.value.weatherProviders.length} 个服务配置`)
    window.setTimeout(() => location.reload(), 450)
  } catch (reason) {
    importing.value = false
    error.value = reason instanceof Error ? reason.message : '完整迁移导入失败'
  }
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog complete-backup-modal" width="720px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header><div class="backup-dialog-title complete-backup-title"><span><i class="pi pi-box" /></span><div><h2>完整迁移</h2><p>一次导出或恢复旅行计划、AI、地图和天气服务配置。</p></div></div></template>
    <div class="complete-backup-layout">
      <section class="complete-backup-card export">
        <header><div><strong>导出这台设备的全部必要数据</strong><span>适合更换电脑、浏览器或重新部署后快速恢复。</span></div><ElTag type="success" effect="light">推荐</ElTag></header>
        <div class="complete-backup-scope">
          <article><i class="pi pi-map-marker" /><div><b>旅行计划</b><span>{{ plans.plans.length }} 个计划 · 包含地点、日期、路线和预算</span></div></article>
          <article><i class="pi pi-sparkles" /><div><b>AI 接入</b><span>{{ currentServiceSummary.aiProfiles }} 个实例 · 默认 {{ currentServiceSummary.aiDefaultProfileName }}</span></div></article>
          <article><i class="pi pi-map" /><div><b>地图服务</b><span>默认 {{ currentServiceSummary.mapDefaultSummary }}</span></div></article>
          <article><i class="pi pi-sun" /><div><b>天气服务</b><span>默认 {{ currentServiceSummary.weatherDefaultName }}</span></div></article>
        </div>
        <ElCheckbox v-model="includeCredentials" class="service-config-credential-toggle">包含 API Key、Token、安全密钥和服务签名</ElCheckbox>
        <div v-if="includeCredentials" class="service-config-sensitive-warning"><i class="pi pi-exclamation-triangle" /><span>完整迁移文件包含明文服务凭据，请只保存在可信设备，不要提交到 Git 或发送到公开位置。</span></div>
        <ElButton type="primary" class="complete-export-button" @click="downloadCompleteBackup"><i class="pi pi-download" />下载完整迁移文件</ElButton>
      </section>

      <section class="complete-backup-card import">
        <header><div><strong>从完整迁移文件恢复</strong><span>先预览计划数量和服务配置，再决定冲突处理方式。</span></div><ElButton @click="fileInput?.click()"><i class="pi pi-upload" />选择文件</ElButton><input ref="fileInput" type="file" accept="application/json,.json" hidden @change="chooseFile"></header>
        <div v-if="parsed && planPreview && servicePreview" class="complete-import-preview">
          <div class="complete-import-file"><span><b>{{ fileName }}</b><small>导出于 {{ new Date(parsed.exportedAt).toLocaleString(currentLocale()) }}</small></span><ElTag :type="servicePreview.credentialsIncluded ? 'warning' : 'info'" effect="light">{{ servicePreview.credentialsIncluded ? '包含敏感凭据' : '不含凭据' }}</ElTag></div>
          <div class="complete-import-sections">
            <article><header><i class="pi pi-map-marker" /><b>旅行计划</b><em>{{ planPreview.plans.length }} 个</em></header><span v-if="planPreview.conflicts">其中 {{ planPreview.conflicts }} 个计划 ID 与当前数据重复</span><span v-else>没有发现重复计划</span><ElRadioGroup v-if="planPreview.plans.length" v-model="planStrategy" size="small"><ElRadioButton value="copy">保留现有并创建副本</ElRadioButton><ElRadioButton value="overwrite">覆盖同 ID 计划</ElRadioButton></ElRadioGroup></article>
            <article><header><i class="pi pi-cog" /><b>服务配置</b><em>{{ servicePreview.aiProfiles + servicePreview.mapProviders.length + servicePreview.weatherProviders.length }} 项</em></header><span>默认 AI：{{ servicePreview.aiDefaultProfileName }}<br>默认地图：{{ servicePreview.mapDefaultSummary }}<br>默认天气：{{ servicePreview.weatherDefaultName }}</span><ElRadioGroup v-model="configStrategy" size="small"><ElRadioButton value="merge">合并并更新</ElRadioButton><ElRadioButton value="replace">完全替换</ElRadioButton></ElRadioGroup></article>
          </div>
        </div>
      </section>
      <div v-if="error" class="form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
      <div class="backup-safety-note"><i class="pi pi-shield" /><span>完整迁移不包含天气缓存、地图瓦片、AI 原始图片和临时预览文件，也不会执行 JSON 中的任何代码。</span></div>
    </div>
    <template #footer><ElButton text @click="emit('close')">关闭</ElButton><ElButton v-if="parsed" type="primary" :loading="importing" @click="importCompleteBackup">恢复全部并重新加载</ElButton></template>
  </ElDialog>
</template>

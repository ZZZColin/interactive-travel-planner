<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElCheckbox, ElDialog, ElRadioButton, ElRadioGroup, ElTag } from 'element-plus'
import { createServiceConfigBackup, importServiceConfigBackup, inspectServiceConfigBackup, type ServiceConfigBackupSummary, type ServiceConfigImportStrategy } from '../../config/serviceConfigBackup'
import { usePlannerStore } from '../../stores/planner'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const planner = usePlannerStore()
const includeCredentials = ref(true)
const fileInput = ref<HTMLInputElement | null>(null)
const parsed = ref<unknown | null>(null)
const summary = ref<ServiceConfigBackupSummary | null>(null)
const strategy = ref<ServiceConfigImportStrategy>('merge')
const fileName = ref('')
const error = ref('')
const importing = ref(false)
const exportSummary = computed(() => inspectServiceConfigBackup(createServiceConfigBackup(includeCredentials.value)))

watch(() => props.open, (open) => {
  if (!open) return
  includeCredentials.value = true
  parsed.value = null
  summary.value = null
  strategy.value = 'merge'
  fileName.value = ''
  error.value = ''
})

function localDateKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function downloadConfig(): void {
  const payload = createServiceConfigBackup(includeCredentials.value)
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `行途规划-全局配置-${localDateKey()}.json`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function chooseFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  error.value = ''
  fileName.value = file.name
  try {
    const value = JSON.parse(await file.text())
    summary.value = inspectServiceConfigBackup(value)
    parsed.value = value
  } catch (reason) {
    parsed.value = null
    summary.value = null
    error.value = reason instanceof Error ? reason.message : '无法读取全局配置文件'
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

function importConfig(): void {
  if (!parsed.value || !summary.value) return
  importing.value = true
  error.value = ''
  try {
    const imported = importServiceConfigBackup(parsed.value, strategy.value)
    planner.notify(`已导入 ${imported.aiProfiles} 个 AI 实例、${imported.mapProviders.length} 个地图配置和 ${imported.weatherProviders.length} 个天气配置`)
    window.setTimeout(() => location.reload(), 350)
  } catch (reason) {
    importing.value = false
    error.value = reason instanceof Error ? reason.message : '全局配置导入失败'
  }
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog service-config-backup-modal" width="680px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header><div class="backup-dialog-title service-config-title"><span><i class="pi pi-cog" /></span><div><h2>全局服务配置迁移</h2><p>迁移 AI 接入实例、地图引擎和天气服务配置，不包含旅行计划。</p></div></div></template>
    <div class="service-config-layout">
      <section class="service-config-export-card">
        <header><div class="backup-action-icon export"><i class="pi pi-download" /></div><div><strong>导出当前服务配置</strong><span>生成一个 JSON 文件，可在其他电脑或浏览器中恢复。</span></div></header>
        <div class="service-config-summary-grid">
          <span><b>{{ exportSummary.aiProfiles }}</b><small>AI 实例</small></span>
          <span><b>{{ exportSummary.mapProviders.length }}</b><small>地图配置</small></span>
          <span><b>{{ exportSummary.weatherProviders.length }}</b><small>天气配置</small></span>
          <span><b>{{ exportSummary.aiSecrets }}</b><small>AI 密钥</small></span>
        </div>
        <ElCheckbox v-model="includeCredentials" class="service-config-credential-toggle">包含 API Key、Token、安全密钥和服务签名</ElCheckbox>
        <div v-if="includeCredentials" class="service-config-sensitive-warning"><i class="pi pi-exclamation-triangle" /><span>导出文件包含可直接调用付费服务的明文凭据。请仅保存在可信设备中，不要发送到公开聊天、网盘或代码仓库。</span></div>
        <ElButton type="primary" @click="downloadConfig"><i class="pi pi-download" />下载全局配置</ElButton>
      </section>

      <section class="service-config-import-card">
        <header><div class="backup-action-icon import"><i class="pi pi-upload" /></div><div><strong>导入到当前浏览器</strong><span>选择此前导出的全局配置 JSON，导入后会自动重新加载应用。</span></div><ElButton @click="fileInput?.click()">选择文件</ElButton><input ref="fileInput" type="file" accept="application/json,.json" hidden @change="chooseFile"></header>
        <div v-if="summary" class="service-config-import-preview">
          <div><strong>{{ fileName }}</strong><ElTag :type="summary.credentialsIncluded ? 'warning' : 'info'" effect="light">{{ summary.credentialsIncluded ? '包含敏感凭据' : '不含凭据' }}</ElTag></div>
          <ul>
            <li><i class="pi pi-sparkles" /><span>AI：{{ summary.aiProfiles }} 个实例，默认 {{ summary.aiDefaultProfileName }}，{{ summary.aiSecrets }} 个密钥</span></li>
            <li><i class="pi pi-map" /><span>地图：默认 {{ summary.mapDefaultSummary }}；{{ summary.mapProviders.join('、') || '无地图凭据' }}</span></li>
            <li><i class="pi pi-sun" /><span>天气：默认 {{ summary.weatherDefaultName }}；{{ summary.weatherProviders.join('、') || '无天气凭据' }}</span></li>
          </ul>
          <ElRadioGroup v-model="strategy" size="small">
            <ElRadioButton value="merge">合并并更新同名配置</ElRadioButton>
            <ElRadioButton value="replace">完全替换当前服务配置</ElRadioButton>
          </ElRadioGroup>
          <small>{{ strategy === 'merge' ? '保留当前文件中没有涉及的 AI、地图和天气配置。' : '清除当前 AI、地图和独立天气服务配置，再按文件内容恢复。旅行计划不会受到影响。' }}</small>
        </div>
      </section>
      <div v-if="error" class="form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
      <div class="backup-safety-note"><i class="pi pi-shield" /><span>只解析受支持的 JSON 字段，不执行文件中的代码；天气缓存和旅行计划不会被导入。</span></div>
    </div>
    <template #footer><ElButton text @click="emit('close')">关闭</ElButton><ElButton v-if="summary" type="primary" :loading="importing" @click="importConfig">导入并重新加载</ElButton></template>
  </ElDialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElPopconfirm, ElRadioButton, ElRadioGroup, ElTag } from 'element-plus'
import { usePlansStore } from '../../stores/plans'
import { currentLocale } from '../../i18n'

const props = withDefaults(defineProps<{ open: boolean; initialSection?: 'backup' | 'recycle' }>(), { initialSection: 'backup' })
const emit = defineEmits<{ close: [] }>()
const plans = usePlansStore()
const fileInput = ref<HTMLInputElement | null>(null)
const parsed = ref<unknown | null>(null)
const preview = ref<{ plans: any[]; conflicts: number } | null>(null)
const strategy = ref<'copy' | 'overwrite'>('copy')
const error = ref('')
const fileName = ref('')
const importing = ref(false)
const previewText = computed(() => preview.value ? `${preview.value.plans.length} 个计划${preview.value.conflicts ? ` · ${preview.value.conflicts} 个与现有计划重复` : ''}` : '')
const recentVersions = computed(() => plans.versions.slice(0, 10))
function dateTime(value: string): string { return new Intl.DateTimeFormat(currentLocale(), { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }

watch(() => props.open, (open) => {
  if (!open) return
  parsed.value = null
  preview.value = null
  strategy.value = 'copy'
  error.value = ''
  fileName.value = ''
})

function localDateKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function downloadBackup(): void {
  const payload = plans.createBackup()
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `旅行计划备份-${localDateKey()}.json`
  link.click()
  URL.revokeObjectURL(url)
}

async function chooseFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  error.value = ''
  fileName.value = file.name
  try {
    const value = JSON.parse(await file.text())
    preview.value = plans.inspectBackup(value)
    parsed.value = value
  } catch (reason) {
    parsed.value = null
    preview.value = null
    error.value = reason instanceof Error ? reason.message : '无法读取备份文件'
  } finally {
    if (fileInput.value) fileInput.value.value = ''
  }
}

function importPlans(): void {
  if (!parsed.value || !preview.value) return
  importing.value = true
  error.value = ''
  try {
    plans.importBackup(parsed.value, strategy.value)
    emit('close')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '导入备份失败'
  } finally {
    importing.value = false
  }
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog plan-backup-modal" width="620px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header><div class="backup-dialog-title"><span><i :class="props.initialSection === 'recycle' ? 'pi pi-trash' : 'pi pi-database'" /></span><div><h2>{{ props.initialSection === 'recycle' ? '计划回收站' : '计划备份与恢复' }}</h2><p>{{ props.initialSection === 'recycle' ? '删除的计划会保留在这里，可以恢复或永久清除。' : '备份只包含旅行计划、地点、路线和预算，不包含地图、天气或 AI 的密钥。' }}</p></div></div></template>
    <div class="backup-layout">
      <section class="backup-action-card"><div class="backup-action-icon export"><i class="pi pi-download" /></div><div><strong>导出全部计划</strong><span>生成一个 JSON 文件，用于迁移浏览器、离线留存或恢复误删数据。</span></div><ElButton type="primary" @click="downloadBackup">下载备份</ElButton></section>
      <section class="backup-action-card"><div class="backup-action-icon import"><i class="pi pi-upload" /></div><div><strong>从备份恢复</strong><span>选择此前导出的 JSON 文件，导入前会先检查计划数量和重复项。</span></div><ElButton @click="fileInput?.click()">选择文件</ElButton><input ref="fileInput" type="file" accept="application/json,.json" hidden @change="chooseFile"></section>
      <section v-if="preview" class="backup-preview"><header><div><strong>{{ fileName }}</strong><span>{{ previewText }}</span></div><ElTag type="success" effect="light">文件可用</ElTag></header><div class="backup-plan-list"><span v-for="plan in preview.plans.slice(0, 6)" :key="plan.metadata.id"><b>{{ plan.metadata.name }}</b><small>{{ plan.plannerState.days.length }} 天 · {{ plan.plannerState.days.reduce((sum: number, day: any) => sum + day.stops.length, 0) }} 个安排</small></span><em v-if="preview.plans.length > 6">还有 {{ preview.plans.length - 6 }} 个计划</em></div><div v-if="preview.conflicts" class="backup-conflict"><strong>发现重复计划</strong><ElRadioGroup v-model="strategy" size="small"><ElRadioButton value="copy">保留现有并创建副本</ElRadioButton><ElRadioButton value="overwrite">覆盖同 ID 计划</ElRadioButton></ElRadioGroup></div></section>
      <section v-if="recentVersions.length" class="plan-history-section"><header><div><strong>自动版本历史</strong><span>每个计划最多保留 10 个版本</span></div><ElTag type="info" effect="light">{{ plans.versions.length }} 个版本</ElTag></header><div><article v-for="version in recentVersions" :key="version.id"><span><b>{{ version.planName }}</b><small>{{ dateTime(version.createdAt) }} · {{ version.reason }}</small></span><ElPopconfirm title="恢复到这个版本？当前状态会先自动备份。" confirm-button-text="恢复" cancel-button-text="取消" @confirm="plans.restoreVersion(version.id)"><template #reference><ElButton text size="small">恢复</ElButton></template></ElPopconfirm></article></div></section>
      <section v-if="plans.recycleBin.length" class="plan-history-section recycle" :class="{ prioritized: props.initialSection === 'recycle' }"><header><div><strong>回收站</strong><span>删除的计划可以恢复或永久清除</span></div><ElTag type="warning" effect="light">{{ plans.recycleBin.length }} 个</ElTag></header><div><article v-for="item in plans.recycleBin" :key="item.id"><span><b>{{ item.record.metadata.name }}</b><small>{{ dateTime(item.deletedAt) }} 删除</small></span><div><ElButton text size="small" @click="plans.restoreDeleted(item.id)">恢复</ElButton><ElPopconfirm title="永久删除后无法恢复，继续吗？" confirm-button-text="永久删除" cancel-button-text="取消" confirm-button-type="danger" @confirm="plans.permanentlyDelete(item.id)"><template #reference><ElButton text type="danger" size="small">永久删除</ElButton></template></ElPopconfirm></div></article></div></section>
      <section v-if="props.initialSection === 'recycle' && !plans.recycleBin.length" class="recycle-empty-state"><i class="pi pi-trash" /><strong>回收站为空</strong><span>删除的计划会在这里保留，方便误删后恢复。</span></section>
      <div v-if="error" class="form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
      <div class="backup-safety-note"><i class="pi pi-shield" /><span>导入不会执行文件中的任何代码；服务密钥和 AI 原始内容不会进入备份。</span></div>
    </div>
    <template #footer><ElButton text @click="emit('close')">关闭</ElButton><ElButton v-if="preview" type="primary" :loading="importing" @click="importPlans">导入 {{ preview.plans.length }} 个计划</ElButton></template>
  </ElDialog>
</template>

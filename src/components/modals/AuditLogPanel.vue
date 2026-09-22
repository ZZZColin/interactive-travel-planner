<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElButton, ElTable, ElTableColumn } from 'element-plus'
import { fetchAuditLog, type AuditLogEntry } from '../../auth/client'

const entries = ref<AuditLogEntry[]>([])
const loading = ref(false)
const error = ref('')

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    entries.value = await fetchAuditLog()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '加载审计日志失败'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="audit-log-card">
    <header>
      <div class="backup-action-icon"><i class="pi pi-history" /></div>
      <div><strong>登录与操作审计日志</strong><span>最近 200 条登录、鉴权和管理操作记录。</span></div>
      <ElButton size="small" :loading="loading" @click="load">刷新</ElButton>
    </header>
    <p v-if="error" class="auth-gate-error">{{ error }}</p>
    <ElTable :data="entries" v-loading="loading" size="small" max-height="360">
      <ElTableColumn prop="created_at" label="时间" width="130" />
      <ElTableColumn prop="username" label="账号" width="100" />
      <ElTableColumn prop="action" label="动作" width="150" />
      <ElTableColumn prop="detail" label="详情" min-width="140" show-overflow-tooltip />
      <ElTableColumn prop="ip" label="IP" width="110" />
    </ElTable>
  </section>
</template>

<style scoped>
.audit-log-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.audit-log-card header { display: flex; align-items: center; gap: 12px; }
.audit-log-card header > div:nth-child(2) { flex: 1; display: flex; flex-direction: column; }
.auth-gate-error { color: var(--el-color-danger, #f56c6c); font-size: 13px; margin: 0; }
</style>

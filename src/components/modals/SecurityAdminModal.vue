<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { ElButton, ElDialog } from 'element-plus'
import { fetchSession } from '../../auth/client'
import TwoFactorPanel from './TwoFactorPanel.vue'
import AdminUsersPanel from './AdminUsersPanel.vue'
import AuditLogPanel from './AuditLogPanel.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const role = ref<'admin' | 'member' | null>(null)

async function refreshRole(): Promise<void> {
  try {
    const session = await fetchSession()
    role.value = session.role
  } catch {
    role.value = null
  }
}

onMounted(refreshRole)
watch(() => props.open, (open) => {
  if (open) refreshRole()
})
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog security-admin-modal" width="760px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header><div class="backup-dialog-title security-admin-title"><span><i class="pi pi-shield" /></span><div><h2>安全与管理</h2><p>两步验证{{ role === 'admin' ? '、用户管理和审计日志' : '' }}。</p></div></div></template>
    <div class="security-admin-layout">
      <TwoFactorPanel />
      <AdminUsersPanel v-if="role === 'admin'" />
      <AuditLogPanel v-if="role === 'admin'" />
    </div>
    <template #footer><ElButton text @click="emit('close')">关闭</ElButton></template>
  </ElDialog>
</template>

<style scoped>
.security-admin-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
</style>

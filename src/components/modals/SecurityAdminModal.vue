<script setup lang="ts">
import { ref, watch } from 'vue'
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

// 这个组件从 App.vue 挂载起就一直存在（只是 ElDialog 内部没打开时不渲染
// 内容），如果在 onMounted 里就去请求一次 fetchSession，等于每次刷新页面
// 都会额外发一次请求，不管用户到底会不会点开"安全与管理"。改成只在真正
// 打开弹窗的那一刻才去查角色，跟 main.ts 里已经查过一次的 fetchSession
// 不重复。
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

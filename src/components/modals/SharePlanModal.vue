<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElInput, ElDialog, ElMessageBox, ElOption, ElSelect, ElTag } from 'element-plus'
import { useSharedPlansStore } from '../../stores/sharedPlans'
import type { PlanRecord } from '../../domain/types'
import type { SharePermission } from '../../auth/client'

const props = defineProps<{ open: boolean; plan: PlanRecord | null }>()
const emit = defineEmits<{ close: [] }>()

const sharedPlans = useSharedPlansStore()
const username = ref('')
const permission = ref<SharePermission>('view')
const submitting = ref(false)
const loading = ref(false)
const error = ref('')
const info = ref('')

const existingShares = computed(() => (props.plan ? sharedPlans.sharesFor(props.plan.metadata.id) : []))

watch(() => props.open, async (open) => {
  error.value = ''
  info.value = ''
  username.value = ''
  permission.value = 'view'
  if (!open || !props.plan) return
  loading.value = true
  try {
    await sharedPlans.refreshMine()
  } finally {
    loading.value = false
  }
})

async function submitShare(): Promise<void> {
  if (!props.plan || !username.value.trim() || submitting.value) return
  submitting.value = true
  error.value = ''
  info.value = ''
  try {
    await sharedPlans.sharePlan(props.plan, username.value.trim(), permission.value)
    info.value = `已分享给 ${username.value.trim()}`
    username.value = ''
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '分享失败'
  } finally {
    submitting.value = false
  }
}

async function revoke(sharedPlanId: number, userId: number): Promise<void> {
  try {
    await sharedPlans.revokeShare(sharedPlanId, userId)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '取消分享失败'
  }
}

function currentSharedPlanId(): number | null {
  if (!props.plan) return null
  return sharedPlans.mine.find((item) => item.clientPlanId === props.plan!.metadata.id)?.id ?? null
}

async function stopSharingAll(): Promise<void> {
  const sharedPlanId = currentSharedPlanId()
  if (!props.plan || sharedPlanId == null) return
  try {
    await ElMessageBox.confirm(
      '停止分享后，所有人都将立即失去对这份计划的访问权限，需要重新分享才能再次查看。确定要停止分享吗？',
      '停止分享整个计划',
      { customClass: 'travel-confirm-dialog', confirmButtonText: '停止分享', cancelButtonText: '取消', type: 'warning' },
    )
  } catch {
    return
  }
  try {
    await sharedPlans.stopSharing(sharedPlanId, props.plan.metadata.id)
    info.value = '已停止分享这份计划'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '停止分享失败'
  }
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog share-plan-modal" width="480px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header>
      <div class="share-plan-title"><h2>分享计划</h2><p v-if="plan">“{{ plan.metadata.name }}”分享给其他账号后，对方可以在自己的账号里查看，如果给了编辑权限也可以修改。</p></div>
    </template>

    <div class="share-plan-content">
      <div v-if="existingShares.length" class="share-plan-existing">
        <label>已分享给</label>
        <div v-for="grant in existingShares" :key="grant.userId" class="share-plan-grant-row">
          <span class="share-plan-grant-name">{{ grant.username }}</span>
          <ElTag size="small" :type="grant.permission === 'edit' ? 'warning' : 'info'" effect="light">{{ grant.permission === 'edit' ? '可编辑' : '只读' }}</ElTag>
          <ElButton text type="danger" size="small" @click="revoke(currentSharedPlanId()!, grant.userId)">取消分享</ElButton>
        </div>
        <ElButton text type="danger" size="small" class="share-plan-stop-all" @click="stopSharingAll">停止分享整个计划</ElButton>
      </div>
      <p v-else-if="!loading" class="share-plan-empty">还没有分享给任何账号</p>

      <div class="share-plan-form">
        <label>用户名</label>
        <ElInput v-model="username" placeholder="对方的登录用户名" @keyup.enter="submitShare" />
        <label>权限</label>
        <ElSelect v-model="permission">
          <ElOption label="只读" value="view" />
          <ElOption label="可编辑" value="edit" />
        </ElSelect>
      </div>
      <p v-if="info" class="share-plan-info">{{ info }}</p>
      <p v-if="error" class="share-plan-error">{{ error }}</p>
    </div>

    <template #footer>
      <ElButton text @click="emit('close')">关闭</ElButton>
      <ElButton type="primary" :loading="submitting" @click="submitShare">分享</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.share-plan-title h2 { margin: 0 0 4px; }
.share-plan-title p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; }
.share-plan-content { display: flex; flex-direction: column; gap: 16px; }
.share-plan-existing { display: flex; flex-direction: column; gap: 8px; }
.share-plan-existing label, .share-plan-form label { font-size: 13px; color: var(--el-text-color-secondary); }
.share-plan-grant-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 8px; background: var(--el-fill-color-light, #f5f7fa); }
.share-plan-grant-name { flex: 1; font-size: 14px; }
.share-plan-stop-all { align-self: flex-start; margin-top: 2px; }
.share-plan-empty { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; }
.share-plan-form { display: flex; flex-direction: column; gap: 6px; }
.share-plan-info { margin: 0; color: var(--el-color-success, #67c23a); font-size: 13px; }
.share-plan-error { margin: 0; color: var(--el-color-danger, #f56c6c); font-size: 13px; }
</style>

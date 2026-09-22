<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElTag } from 'element-plus'
import { useSharedPlansStore } from '../../stores/sharedPlans'
import { formatPlanDateTime } from '../../domain/plans'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const sharedPlans = useSharedPlansStore()
const loading = ref(false)
const opening = ref<number | null>(null)
const error = ref('')

watch(() => props.open, async (open) => {
  error.value = ''
  if (!open) return
  loading.value = true
  try {
    await sharedPlans.refreshSharedWithMe()
  } finally {
    loading.value = false
  }
})

// 这个函数原来叫 open，跟 defineProps 里的 open（弹窗是否显示的布尔值）
// 撞名了：<script setup> 里模板能直接访问的是这个本地声明的 open 函数，
// 不是 props.open，导致下面模板里 <ElDialog :model-value="open" ...>
// 实际绑定到的是这个函数本身（类型是 (id: number) => Promise<void>），
// 不是布尔值——vue-tsc 能查出这个类型不匹配（plain tsc 不检查模板绑定，
// 之前的隔离类型检查没跑起来 vue-tsc，没能查出这一处）。改名避免撞名。
async function openPlan(id: number): Promise<void> {
  if (opening.value) return
  opening.value = id
  error.value = ''
  try {
    await sharedPlans.openSharedPlan(id)
    emit('close')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '打开失败'
  } finally {
    opening.value = null
  }
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog shared-with-me-modal" width="520px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header>
      <div class="shared-with-me-title"><h2>共享给我的计划</h2><p>其他账号分享给你的旅行计划，只有你自己账号下的计划才会出现在主页列表里。</p></div>
    </template>

    <div class="shared-with-me-content">
      <p v-if="error" class="shared-with-me-error">{{ error }}</p>
      <p v-if="!loading && !sharedPlans.sharedWithMe.length" class="shared-with-me-empty">还没有人把计划分享给你</p>
      <div v-for="plan in sharedPlans.sharedWithMe" :key="plan.id" class="shared-with-me-row">
        <div class="shared-with-me-info">
          <strong>{{ plan.name }}</strong>
          <span>来自 {{ plan.ownerUsername }} · 最近更新 {{ formatPlanDateTime(plan.updatedAt) }}</span>
        </div>
        <ElTag size="small" :type="plan.permission === 'edit' ? 'warning' : 'info'" effect="light">{{ plan.permission === 'edit' ? '可编辑' : '只读' }}</ElTag>
        <ElButton size="small" type="primary" :loading="opening === plan.id" @click="openPlan(plan.id)">打开</ElButton>
      </div>
    </div>

    <template #footer>
      <ElButton text @click="emit('close')">关闭</ElButton>
    </template>
  </ElDialog>
</template>

<style scoped>
.shared-with-me-title h2 { margin: 0 0 4px; }
.shared-with-me-title p { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; }
.shared-with-me-content { display: flex; flex-direction: column; gap: 10px; }
.shared-with-me-empty { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; }
.shared-with-me-error { margin: 0; color: var(--el-color-danger, #f56c6c); font-size: 13px; }
.shared-with-me-row { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 10px; background: var(--el-fill-color-light, #f5f7fa); }
.shared-with-me-info { flex: 1; display: flex; flex-direction: column; gap: 2px; }
.shared-with-me-info span { font-size: 12px; color: var(--el-text-color-secondary); }
</style>

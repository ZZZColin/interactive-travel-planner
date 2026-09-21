<script setup lang="ts">
import { ElButton, ElDialog } from 'element-plus'

const props = defineProps<{
  open: boolean
  removedDayCount: number
  placeNames: string[]
}>()
const emit = defineEmits<{
  close: []
  choose: [strategy: 'return' | 'discard']
}>()
</script>

<template>
  <ElDialog
    :model-value="open"
    class="travel-dialog reduce-days-dialog"
    width="570px"
    align-center
    destroy-on-close
    @update:model-value="!$event && emit('close')"
  >
    <template #header>
      <div class="dialog-result-header">
        <div class="dialog-result-icon warning"><i class="pi pi-calendar-minus" /></div>
        <div>
          <h2>调整计划日期范围</h2>
          <p>有 {{ removedDayCount }} 个原日期将移出新的计划范围，请选择这些日期中的地点如何处理。</p>
        </div>
      </div>
    </template>

    <div v-if="placeNames.length" class="removed-place-list">
      <span>受影响地点</span>
      <div><b v-for="name in placeNames" :key="name">{{ name }}</b></div>
    </div>

    <div class="retention-options">
      <button class="retention-option recommended" @click="emit('choose', 'return')">
        <span class="retention-icon"><i class="pi pi-inbox" /></span>
        <span>
          <strong>返回未安排地点</strong>
          <small>仅移除这些地点在移出范围日期中的 Stop，地点资料、备注和分类继续保留。</small>
        </span>
        <em>推荐</em>
      </button>
      <button class="retention-option discard" @click="emit('choose', 'discard')">
        <span class="retention-icon"><i class="pi pi-trash" /></span>
        <span>
          <strong>不保留这些地点</strong>
          <small>移除这些日期的安排，并删除没有在其他日期使用的地点及相关路线缓存。</small>
        </span>
      </button>
    </div>

    <template #footer>
      <ElButton text @click="emit('close')">取消</ElButton>
    </template>
  </ElDialog>
</template>

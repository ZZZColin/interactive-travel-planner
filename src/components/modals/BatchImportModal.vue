<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput } from 'element-plus'
import { usePlannerStore } from '../../stores/planner'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
const store = usePlannerStore()
const value = ref('猫鼻梁\n新都桥\n墨石公园')

watch(() => props.open, (open) => {
  if (open) value.value = '猫鼻梁\n新都桥\n墨石公园'
})

function confirm(): void {
  const names = value.value.split(/\n|,|，/).map((item) => item.trim()).filter(Boolean)
  store.batchAddNames(names)
  emit('close')
}
</script>

<template>
  <ElDialog
    :model-value="open"
    class="travel-dialog"
    width="520px"
    title="批量放入地点池"
    align-center
    destroy-on-close
    @update:model-value="!$event && emit('close')"
  >
    <p class="dialog-description">一行一个地点。系统会与当前地点库匹配，不进行攻略内容解析。</p>
    <ElInput v-model="value" type="textarea" :autosize="{ minRows: 7, maxRows: 10 }" resize="none" />
    <template #footer>
      <ElButton text @click="emit('close')">取消</ElButton>
      <ElButton type="primary" @click="confirm"><i class="pi pi-check" />确认匹配并加入</ElButton>
    </template>
  </ElDialog>
</template>

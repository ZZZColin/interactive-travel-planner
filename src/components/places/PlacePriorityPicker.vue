<script setup lang="ts">
import { computed } from 'vue'
import { ElDropdown, ElDropdownItem, ElDropdownMenu } from 'element-plus'
import type { PlacePriority } from '../../domain/types'
import { usePlannerStore } from '../../stores/planner'

const props = defineProps<{ modelValue: PlacePriority }>()
const emit = defineEmits<{ change: [priority: PlacePriority] }>()

const store = usePlannerStore()

const options: Array<{ value: PlacePriority; label: string; description: string }> = [
  { value: 'must', label: '必去', description: '未安排时会在计划检查中提醒' },
  { value: 'normal', label: '想去', description: '希望安排，但不阻塞计划检查' },
  { value: 'backup', label: '备选', description: '时间允许时再安排' },
]
const current = computed(() => options.find((item) => item.value === props.modelValue) ?? options[1])

function selectPriority(priority: PlacePriority): void {
  if (store.readOnly) return
  if (priority !== props.modelValue) emit('change', priority)
}
</script>

<template>
  <ElDropdown trigger="click" placement="bottom-start" @command="selectPriority">
    <button
      type="button"
      class="place-priority-trigger"
      :class="`priority-${current.value}`"
      :aria-label="`地点优先级：${current.label}，点击调整`"
      title="调整地点优先级"
      draggable="false"
      :disabled="store.readOnly"
      @click.stop
      @mousedown.stop
      @dragstart.prevent
    >
      <i />
      <span>{{ current.label }}</span>
      <b class="pi pi-angle-down" />
    </button>
    <template #dropdown>
      <ElDropdownMenu class="place-priority-menu">
        <ElDropdownItem
          v-for="option in options"
          :key="option.value"
          :command="option.value"
          :disabled="option.value === modelValue"
        >
          <i class="priority-option-dot" :class="`priority-${option.value}`" />
          <span class="priority-option-copy"><strong>{{ option.label }}</strong><small>{{ option.description }}</small></span>
          <i v-if="option.value === modelValue" class="pi pi-check priority-option-check" />
        </ElDropdownItem>
      </ElDropdownMenu>
    </template>
  </ElDropdown>
</template>

<style scoped>
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>

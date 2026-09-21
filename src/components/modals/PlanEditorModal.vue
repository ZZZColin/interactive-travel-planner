<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDatePicker, ElDialog, ElInput, ElInputNumber, ElTimePicker } from 'element-plus'
import { createParticipant, defaultPlanValue, normalizeParticipants } from '../../domain/plans'
import type { PlanEditorValue, PlanRecord, TripParticipant } from '../../domain/types'
import ParticipantEditor from '../plans/ParticipantEditor.vue'

const props = defineProps<{
  open: boolean
  plan?: PlanRecord | null
}>()
const emit = defineEmits<{
  close: []
  save: [value: PlanEditorValue]
}>()

const name = ref('')
const startDate = ref<Date | null>(null)
const startTime = ref<Date | null>(null)
const endDate = ref<Date | null>(null)
const endTime = ref<Date | null>(null)
const participants = ref<TripParticipant[]>([])
const budgetLimit = ref<number | null>(null)
const error = ref('')
const editing = computed(() => Boolean(props.plan))

watch(() => props.open, (open) => {
  if (!open) return
  const value = props.plan?.metadata ?? defaultPlanValue()
  name.value = value.name
  const start = new Date(value.startAt)
  const end = new Date(value.endAt)
  startDate.value = new Date(start)
  startTime.value = new Date(start)
  endDate.value = new Date(end)
  endTime.value = new Date(end)
  const normalized = normalizeParticipants(value.participants)
  participants.value = normalized.length ? normalized.map((person) => ({ ...person })) : [createParticipant()]
  budgetLimit.value = props.plan?.plannerState.budget?.settings.limit ?? ('budgetLimit' in value ? value.budgetLimit : null)
  error.value = ''
})



function disableEndDate(date: Date): boolean {
  if (!startDate.value) return false
  const startDay = new Date(startDate.value)
  startDay.setHours(0, 0, 0, 0)
  return date.getTime() < startDay.getTime()
}

function combineDateAndTime(date: Date | null, time: Date | null): Date | null {
  if (!date || !time) return null
  const value = new Date(date)
  value.setHours(time.getHours(), time.getMinutes(), time.getSeconds(), 0)
  return value
}

function submit(): void {
  const title = name.value.trim()
  const start = combineDateAndTime(startDate.value, startTime.value)
  const end = combineDateAndTime(endDate.value, endTime.value)
  if (!title) { error.value = '请输入计划名称'; return }
  if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) { error.value = '请填写有效的起止时间'; return }
  if (end.getTime() <= start.getTime()) { error.value = '结束时间必须晚于开始时间'; return }
  const people = normalizeParticipants(participants.value)
  const duplicateNames = people.map((person) => person.name).filter((personName, index, values) => values.indexOf(personName) !== index)
  if (duplicateNames.length) { error.value = `参与人员姓名不能重复：${[...new Set(duplicateNames)].join('、')}`; return }
  emit('save', {
    name: title,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    participants: people,
    budgetLimit: budgetLimit.value == null ? null : Math.max(0, budgetLimit.value),
  })
  emit('close')
}
</script>

<template>
  <ElDialog
    :model-value="open"
    class="plan-editor-modal travel-dialog"
    width="760px"
    align-center
    destroy-on-close
    @update:model-value="!$event && emit('close')"
  >
    <template #header>
      <div class="plan-editor-title">
        <div class="plan-editor-icon"><i :class="editing ? 'pi pi-pencil' : 'pi pi-plus'" /></div>
        <div>
          <h2>{{ editing ? '编辑旅行计划' : '新建旅行计划' }}</h2>
          <p>设置行程时间、总预算和参与人员，后续仍可随时调整。</p>
        </div>
      </div>
    </template>

    <div class="plan-form element-form">
      <div class="field">
        <label for="plan-name">计划名称</label>
        <ElInput id="plan-name" v-model="name" maxlength="60" placeholder="例如：川西秋日 6 天自驾" />
      </div>
      <div class="plan-time-fields">
        <div class="field">
          <label>开始时间</label>
          <div class="plan-date-time-combo">
            <ElDatePicker v-model="startDate" type="date" format="YYYY-MM-DD" placeholder="选择开始日期" :clearable="false" />
            <ElTimePicker v-model="startTime" format="HH:mm:ss" placeholder="开始时刻" :clearable="false" />
          </div>
        </div>
        <div class="field">
          <label>结束时间</label>
          <div class="plan-date-time-combo">
            <ElDatePicker v-model="endDate" type="date" format="YYYY-MM-DD" placeholder="选择结束日期" :disabled-date="disableEndDate" :clearable="false" />
            <ElTimePicker v-model="endTime" format="HH:mm:ss" placeholder="结束时刻" :clearable="false" />
          </div>
        </div>
      </div>

      <div class="plan-budget-field">
        <div class="plan-budget-copy"><span class="plan-budget-icon"><i class="pi pi-wallet" /></span><div><strong>总预算</strong><small>用于预算总览和超支提醒；可以留空，进入计划后继续设置。</small></div></div>
        <ElInputNumber v-model="budgetLimit" aria-label="总预算" :min="0" :max="100000000" :precision="2" controls-position="right" placeholder="未设置" />
        <span>元</span>
      </div>

      <ParticipantEditor v-model="participants" />

      <div v-if="error" class="form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
    </div>

    <template #footer>
      <ElButton text @click="emit('close')">取消</ElButton>
      <ElButton type="primary" @click="submit">{{ editing ? '保存修改' : '创建并进入规划' }}</ElButton>
    </template>
  </ElDialog>
</template>

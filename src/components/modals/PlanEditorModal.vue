<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDatePicker, ElDialog, ElInput, ElInputNumber, ElTimePicker } from 'element-plus'
import { createParticipant, defaultPlanValue, normalizeParticipants } from '../../domain/plans'
import type { PlanEditorValue, PlanRecord, TripParticipant } from '../../domain/types'
import { usePlannerStore } from '../../stores/planner'
import ParticipantEditor from '../plans/ParticipantEditor.vue'
import { useCollabText } from '../../collab/useCollabText'
import { activeCollabSession } from '../../collab/planCollab'

const props = defineProps<{
  open: boolean
  plan?: PlanRecord | null
}>()
const emit = defineEmits<{
  close: []
  save: [value: PlanEditorValue]
}>()

const planner = usePlannerStore()
const nameInputRef = ref<InstanceType<typeof ElInput>>()
const name = ref('')
const startDate = ref<Date | null>(null)
const startTime = ref<Date | null>(null)
const endDate = ref<Date | null>(null)
const endTime = ref<Date | null>(null)
const participants = ref<TripParticipant[]>([])
const budgetLimit = ref<number | null>(null)
const error = ref('')
const editing = computed(() => Boolean(props.plan))
const locked = computed(() => editing.value && planner.readOnly)

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

// 计划名接入逐字实时协作：跟 locked 用的是同一个假设——这个弹窗只会为
// "当前正在打开的这份计划"编辑元数据（planner.readOnly 也是这么假设
// 的），所以只要是在编辑现有计划、且当前有协作会话在跑，就认为这个会话
// 对应的正是这份计划。
// 这个调用必须放在上面那个 `watch(() => props.open, ...)` 之后（而不是
// 之前）：两个 watcher 都会因为弹窗打开这个动作同时变脏，Vue 按注册顺序
// 依次 flush；如果协作这个 watcher 先跑，随后 props.open 那个 watcher
// 把 name 重置成计划里存的旧值，就会覆盖掉刚从 Y.Text 同步过来的、可能
// 更新的协作内容。放在后面能保证协作内容总是最后生效。
const collabNameKey = computed(() => (editing.value && activeCollabSession.value ? 'planName' : null))
// canWrite 传的是一个取值函数（每次读 locked.value 的当下最新结果），
// 不是绑定这一刻算好的布尔值：这个弹窗组件本身是常驻的（open 只是控制
// 显隐，见上面 destroy-on-close 和 watch(() => props.open, ...) 的写法），
// 同一个组件实例可能先后为一份可编辑的计划、又为一份只读的计划打开，
// 如果 canWrite 在这里就已经算成固定布尔值，后面权限变了也不会跟着变。
//
// 只读权限的计划下这个输入框本身是禁用的（本来就没有"本地打字"这条
// 路径），但绑定逻辑里还有一步"字段为空时用本地内容反向打底"，这一步
// 不看输入框是不是禁用、只要绑定就会跑——只读客户端如果也去做这一步，
// 服务器会因为权限校验丢弃这次写入，但客户端自己本地的 Y.Doc 已经先斩
// 后奏地插入了一次，等真正的内容之后从服务器广播过来，会在这个只读用户
// 自己的浏览器里被当成两次并发编辑合并成重复内容（不影响服务器上的真实
// 数据，也不影响其他人，但对这一个只读用户来说界面上会看到错乱的内容）。
// 见 collabTextBinding.ts 里 canWrite 选项的完整说明。
useCollabText(collabNameKey, name, { getInputEl: () => nameInputRef.value?.ref, canWrite: () => !locked.value })

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
  if (locked.value) return
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
      <p v-if="locked" class="form-error"><i class="pi pi-lock" />当前计划为只读分享，无法编辑计划信息。</p>
      <div class="field">
        <label for="plan-name">计划名称</label>
        <ElInput ref="nameInputRef" id="plan-name" v-model="name" maxlength="60" placeholder="例如：川西秋日 6 天自驾" :disabled="locked" />
      </div>
      <div class="plan-time-fields">
        <div class="field">
          <label>开始时间</label>
          <div class="plan-date-time-combo">
            <ElDatePicker v-model="startDate" type="date" format="YYYY-MM-DD" placeholder="选择开始日期" :clearable="false" :disabled="locked" />
            <ElTimePicker v-model="startTime" format="HH:mm:ss" placeholder="开始时刻" :clearable="false" :disabled="locked" />
          </div>
        </div>
        <div class="field">
          <label>结束时间</label>
          <div class="plan-date-time-combo">
            <ElDatePicker v-model="endDate" type="date" format="YYYY-MM-DD" placeholder="选择结束日期" :disabled-date="disableEndDate" :clearable="false" :disabled="locked" />
            <ElTimePicker v-model="endTime" format="HH:mm:ss" placeholder="结束时刻" :clearable="false" :disabled="locked" />
          </div>
        </div>
      </div>

      <div class="plan-budget-field">
        <div class="plan-budget-copy"><span class="plan-budget-icon"><i class="pi pi-wallet" /></span><div><strong>总预算</strong><small>用于预算总览和超支提醒；可以留空，进入计划后继续设置。</small></div></div>
        <ElInputNumber v-model="budgetLimit" aria-label="总预算" :min="0" :max="100000000" :precision="2" controls-position="right" placeholder="未设置" :disabled="locked" />
        <span>元</span>
      </div>

      <ParticipantEditor v-model="participants" />

      <div v-if="error" class="form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
    </div>

    <template #footer>
      <ElButton text @click="emit('close')">取消</ElButton>
      <ElButton type="primary" :disabled="locked" @click="submit">{{ editing ? '保存修改' : '创建并进入规划' }}</ElButton>
    </template>
  </ElDialog>
</template>

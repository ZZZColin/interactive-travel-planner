<script setup lang="ts">
import { computed, onBeforeUnmount, watch, type WritableComputedRef } from 'vue'
import { ElButton, ElInput, ElInputNumber } from 'element-plus'
import { createParticipant } from '../../domain/plans'
import type { TripParticipant } from '../../domain/types'
import { usePlannerStore } from '../../stores/planner'
import { bindCollabText } from '../../collab/collabTextBinding'
import { activeCollabSession, type CollabSession } from '../../collab/planCollab'

withDefaults(defineProps<{ description?: string }>(), {
  description: '年龄可用于后续门票、交通和住宿计费规则。',
})
const participants = defineModel<TripParticipant[]>({ required: true })
const planner = usePlannerStore()

function addParticipant(): void {
  if (planner.readOnly) return
  participants.value.push(createParticipant())
}

function removeParticipant(id: string): void {
  if (planner.readOnly) return
  participants.value = participants.value.filter((person) => person.id !== id)
  if (!participants.value.length) participants.value.push(createParticipant())
}

// 每一行参与人员的姓名/备注输入框的原生 DOM 元素，key 是 "name:id" /
// "note:id"。远端更新到达时用得到——只有拿到实际的 input 元素才能在写入
// 新内容前后保住用户当前的光标位置（见 collabTextBinding.ts）。用函数式
// ref（模板里 :ref="(el) => ..."）而不是固定数量的具名 ref，因为参与人员
// 的行数是动态的。
const inputEls = new Map<string, HTMLInputElement | HTMLTextAreaElement>()
function registerInputEl(field: 'name' | 'note', id: string, el: unknown): void {
  const key = `${field}:${id}`
  const instance = el as { ref?: HTMLInputElement | HTMLTextAreaElement } | null
  if (instance?.ref) inputEls.set(key, instance.ref)
  else inputEls.delete(key)
}

// 每位参与人员的姓名/备注接入逐字实时协作。参与人员是一个动态增删的
// 列表，没有用给每一行拆个子组件、在子组件的 setup() 里调 useCollabText
// 那种写法（Vue 的组合式生命周期钩子只能在组件初始化时固定调用一次，没法
// 对着一个动态变化的 v-for 逐项调用）；改成在这里自己维护一张
// "参与人员 id -> { 绑的是哪个协作会话, 解绑函数 }" 的表，参与人员列表
// 或者协作会话状态一变就重新对一遍，多余的解绑、缺的补上，达到跟
// useCollabText 一样的效果——包括它那个"只按会话对象是否变化来决定要不要
// 重新绑定，不因为网络抖动导致 synced 短暂变 false 就拆掉已有绑定"的
// 处理，理由同样是：拆了重建的话，断线期间用户在本地打的字（已经安全地
// 记在本地这份 Y.Doc 里，只是还没广播出去）会被重新拉取到的旧内容覆盖。
interface BoundField { session: CollabSession; unbind: () => void }
const nameBindings = new Map<string, BoundField>()
const noteBindings = new Map<string, BoundField>()

function participantFieldRef(id: string, field: 'name' | 'note'): WritableComputedRef<string> {
  return computed({
    get: () => {
      const person = participants.value.find((item) => item.id === id)
      return (field === 'name' ? person?.name : person?.note) ?? ''
    },
    set: (value) => {
      const person = participants.value.find((item) => item.id === id)
      if (person) person[field] = value
    },
  })
}

function reconcileBindings(bindings: Map<string, BoundField>, field: 'name' | 'note', fieldKeyPrefix: string): void {
  const session = activeCollabSession.value
  const currentIds = new Set(participants.value.map((person) => person.id))

  for (const [id, bound] of bindings) {
    if (bound.session !== session || !currentIds.has(id)) {
      bound.unbind()
      bindings.delete(id)
    }
  }
  if (!session || !session.synced.value) return

  participants.value.forEach((person) => {
    if (bindings.has(person.id)) return
    const ytext = session.getFieldText(`${fieldKeyPrefix}:${person.id}`)
    // canWrite 传取值函数、读 planner.readOnly 的当下最新值，不是绑定这
    // 一刻算好的布尔值：理由和 PlanEditorModal.vue 里一样——只读权限的人
    // 也会接入协作（好实时看到别人的修改），如果这里不做区分，只读用户
    // 遇到"字段为空、本地有内容"（见 collabTextBinding.ts 里的说明）时会
    // 在自己本地的 Y.Doc 里插入一次没人能看到、服务器也会丢弃的内容，
    // 等真正的内容后续广播过来，会在这个只读用户自己的浏览器里被当成
    // 两次并发编辑合并成重复/错乱的内容。
    const unbind = bindCollabText(ytext, participantFieldRef(person.id, field), {
      getInputEl: () => inputEls.get(`${field}:${person.id}`),
      canWrite: () => !planner.readOnly,
    })
    bindings.set(person.id, { session, unbind })
  })
}

function syncCollabBindings(): void {
  reconcileBindings(nameBindings, 'name', 'participantName')
  reconcileBindings(noteBindings, 'note', 'participantNote')
}

watch(
  [
    () => participants.value.map((person) => person.id).join(','),
    () => activeCollabSession.value,
    () => activeCollabSession.value?.synced.value,
  ],
  syncCollabBindings,
  { immediate: true },
)

onBeforeUnmount(() => {
  nameBindings.forEach((bound) => bound.unbind())
  noteBindings.forEach((bound) => bound.unbind())
  nameBindings.clear()
  noteBindings.clear()
})
</script>

<template>
  <section class="participant-editor">
    <header><div><strong>参与人员</strong><span>{{ description }}</span></div><ElButton size="small" :disabled="planner.readOnly" @click="addParticipant"><i class="pi pi-plus" />添加人员</ElButton></header>
    <div class="participant-editor-list">
      <div v-for="(person, index) in participants" :key="person.id" class="participant-editor-row">
        <span class="participant-order">{{ index + 1 }}</span>
        <label><span>姓名</span><ElInput :ref="(el) => registerInputEl('name', person.id, el)" v-model="person.name" :aria-label="`参与人员 ${index + 1} 姓名`" placeholder="姓名" maxlength="30" :disabled="planner.readOnly" /></label>
        <label><span>年龄</span><ElInputNumber v-model="person.age" :aria-label="`参与人员 ${index + 1} 年龄`" :min="0" :max="150" controls-position="right" placeholder="可选" :disabled="planner.readOnly" /></label>
        <label><span>备注</span><ElInput :ref="(el) => registerInputEl('note', person.id, el)" v-model="person.note" :aria-label="`参与人员 ${index + 1} 备注`" placeholder="儿童票、饮食、住宿等需求" maxlength="80" :disabled="planner.readOnly" /></label>
        <ElButton text circle type="danger" :title="`删除参与人员 ${index + 1}`" :disabled="planner.readOnly" @click="removeParticipant(person.id)"><i class="pi pi-trash" /></ElButton>
      </div>
    </div>
  </section>
</template>

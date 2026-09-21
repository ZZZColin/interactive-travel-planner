<script setup lang="ts">
import { ElButton, ElInput, ElInputNumber } from 'element-plus'
import { createParticipant } from '../../domain/plans'
import type { TripParticipant } from '../../domain/types'

withDefaults(defineProps<{ description?: string }>(), {
  description: '年龄可用于后续门票、交通和住宿计费规则。',
})
const participants = defineModel<TripParticipant[]>({ required: true })

function addParticipant(): void {
  participants.value.push(createParticipant())
}

function removeParticipant(id: string): void {
  participants.value = participants.value.filter((person) => person.id !== id)
  if (!participants.value.length) participants.value.push(createParticipant())
}
</script>

<template>
  <section class="participant-editor">
    <header><div><strong>参与人员</strong><span>{{ description }}</span></div><ElButton size="small" @click="addParticipant"><i class="pi pi-plus" />添加人员</ElButton></header>
    <div class="participant-editor-list">
      <div v-for="(person, index) in participants" :key="person.id" class="participant-editor-row">
        <span class="participant-order">{{ index + 1 }}</span>
        <label><span>姓名</span><ElInput v-model="person.name" :aria-label="`参与人员 ${index + 1} 姓名`" placeholder="姓名" maxlength="30" /></label>
        <label><span>年龄</span><ElInputNumber v-model="person.age" :aria-label="`参与人员 ${index + 1} 年龄`" :min="0" :max="150" controls-position="right" placeholder="可选" /></label>
        <label><span>备注</span><ElInput v-model="person.note" :aria-label="`参与人员 ${index + 1} 备注`" placeholder="儿童票、饮食、住宿等需求" maxlength="80" /></label>
        <ElButton text circle type="danger" :title="`删除参与人员 ${index + 1}`" @click="removeParticipant(person.id)"><i class="pi pi-trash" /></ElButton>
      </div>
    </div>
  </section>
</template>

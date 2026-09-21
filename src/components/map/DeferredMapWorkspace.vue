<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { MapRendererId } from '../../map/config'
import MapWorkspace from './MapWorkspace.vue'

const emit = defineEmits<{ settings: [providerId: MapRendererId, activate?: boolean] }>()
const ready = ref(false)
function forwardSettings(providerId: MapRendererId, activate?: boolean): void { emit('settings', providerId, activate) }
let frame = 0
let timer = 0

onMounted(() => {
  frame = window.requestAnimationFrame(() => {
    timer = window.setTimeout(() => { ready.value = true }, 0)
  })
})

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frame)
  window.clearTimeout(timer)
})
</script>

<template>
  <MapWorkspace v-if="ready" @settings="forwardSettings" />
  <section v-else class="map deferred-map-workspace">
    <div class="deferred-map-toolbar"><span /><span /><span /></div>
    <div class="deferred-map-loading"><i class="plan-opening-spinner" /><strong>正在加载地图</strong><small>行程编排已经可以先使用</small></div>
  </section>
</template>

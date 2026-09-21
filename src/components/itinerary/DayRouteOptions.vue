<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElOption, ElPopover, ElSelect } from 'element-plus'
import { formatDuration } from '../../domain/schedule'
import { transportModeOf } from '../../domain/transport'
import type { RouteOption, RoutePreference, TripDay } from '../../domain/types'
import { mapRuntimeState, planMapProvider } from '../../map/provider'
import { usePlannerStore } from '../../stores/planner'

const props = defineProps<{ day: TripDay }>()
const store = usePlannerStore()
const open = ref(false)
const loading = ref(false)
const applying = ref(false)
const error = ref('')
const options = ref<RouteOption[]>([])
const previewId = ref('')
const preference = ref<RoutePreference>('recommended')
const places = computed(() => props.day.stops.map((stop) => store.places[stop.placeId]).filter(Boolean))
const available = computed(() => props.day.stops.length >= 3 && props.day.stops.slice(0, -1).every((stop) => transportModeOf(stop.transportMode) === 'driving'))

async function load(): Promise<void> {
  if (!available.value) return
  loading.value = true
  error.value = ''
  try {
    options.value = await planMapProvider.searchDayRouteOptions({ places: places.value, preference: preference.value })
    previewId.value = options.value[0]?.id ?? ''
    planMapProvider.previewRouteOptions(options.value, previewId.value)
    if (!options.value.length) error.value = `${mapRuntimeState.providerDefinition.shortName}暂未返回包含全部途经点的路线。`
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '全天路线查询失败' }
  finally { loading.value = false }
}
function preview(option: RouteOption): void { previewId.value = option.id; planMapProvider.previewRouteOptions(options.value, option.id) }
async function applyPreference(): Promise<void> {
  applying.value = true
  error.value = ''
  try {
    const selections = []
    for (let index = 0; index < props.day.stops.length - 1; index += 1) {
      const stop = props.day.stops[index]
      const next = props.day.stops[index + 1]
      const from = store.places[stop.placeId]
      const to = store.places[next.placeId]
      const route = (await planMapProvider.searchRouteOptions({ from, to, mode: 'driving', preference: preference.value, force: true }))[0]
      if (route) selections.push({ uid: stop.uid, option: route, preference: preference.value })
    }
    store.setDayRouteOptions(props.day.id, selections)
    open.value = false
  } catch (reason) { error.value = reason instanceof Error ? reason.message : '应用全天路线偏好失败' }
  finally { applying.value = false; planMapProvider.clearRouteOptionsPreview() }
}
watch(open, (value) => { if (value) void load(); else planMapProvider.clearRouteOptionsPreview() })
watch(preference, () => { options.value = []; if (open.value) void load() })
</script>

<template>
  <ElPopover v-if="available" v-model:visible="open" placement="bottom-end" :width="440" trigger="click" popper-class="day-route-options-popover"><template #reference><ElButton text size="small" class="day-route-options-trigger"><i class="pi pi-sitemap" />全天路线</ElButton></template><div class="day-route-options"><header><div><strong>{{ day.label }} 全天途经点路线</strong><span>{{ places.map((place) => place.name).join(' → ') }}</span></div><ElSelect v-model="preference" size="small"><ElOption label="综合推荐" value="recommended" /><ElOption label="用时优先" value="fastest" /><ElOption label="距离优先" value="shortest" /><ElOption label="少收费" value="least-toll" /><ElOption label="躲避拥堵" value="avoid-congestion" /></ElSelect></header><div v-if="loading" class="route-options-loading"><span class="poi-spinner" />正在计算全部途经点路线…</div><div v-else-if="error" class="route-options-error">{{ error }}</div><div v-else class="day-route-option-list"><button v-for="option in options" :key="option.id" :class="{ active: previewId === option.id }" @mouseenter="preview(option)" @focus="preview(option)" @click="preview(option)"><b>{{ option.strategyLabel }}</b><span>{{ formatDuration(option.durationMinutes) }} · {{ option.distanceKm }} km<span v-if="option.toll != null"> · ¥{{ option.toll }}</span></span></button></div><footer><span>全天结果用于比较整体策略；确认后会按相同偏好重新查询并写入每个相邻路段。</span><ElButton type="primary" size="small" :loading="applying" :disabled="!options.length" @click="applyPreference">应用到每段</ElButton></footer></div></ElPopover>
</template>

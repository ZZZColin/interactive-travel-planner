<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElPopover } from 'element-plus'
import type { DailyWeatherResult, WeatherKind } from '../../weather/types'

const open = ref(false)
const props = defineProps<{ weather: DailyWeatherResult }>()
const meta: Record<WeatherKind, { glyph: string; label: string }> = {
  sunny: { glyph: '☀', label: '晴' },
  cloudy: { glyph: '⛅', label: '多云' },
  overcast: { glyph: '☁', label: '阴' },
  rain: { glyph: '☂', label: '雨' },
  storm: { glyph: 'ϟ', label: '雷雨' },
  snow: { glyph: '❄', label: '雪' },
  fog: { glyph: '≋', label: '雾霾' },
  wind: { glyph: '〰', label: '风' },
  other: { glyph: '◌', label: '天气' },
}
const current = computed(() => meta[props.weather.kind ?? 'other'])
const temperature = computed(() => {
  const min = props.weather.minTemp
  const max = props.weather.maxTemp
  if (min == null && max == null) return ''
  if (min == null) return `${max}°`
  if (max == null) return `${min}°`
  return `${min}~${max}°`
})
const wind = computed(() => props.weather.dayWind
  ? `${props.weather.dayWind.endsWith('风') ? props.weather.dayWind : `${props.weather.dayWind}风`}${props.weather.dayPower ? ` ${props.weather.dayPower}` : ''}`
  : '')
const tooltip = computed(() => [
  props.weather.date,
  props.weather.condition || current.value.label,
  temperature.value,
  wind.value,
  props.weather.precipitationProbability != null ? `降水概率 ${props.weather.precipitationProbability}%` : '',
  props.weather.providerName,
  props.weather.reportedAt ? `发布于 ${props.weather.reportedAt}` : '',
].filter(Boolean).join(' · '))
</script>

<template>
  <ElPopover v-model:visible="open" trigger="hover" placement="left" :width="280" :show-after="220" popper-class="weather-detail-popover">
    <template #reference><button type="button" class="weather-badge" :class="`weather-${weather.kind ?? 'other'}`" :title="tooltip" @click.stop="open = !open" @mousedown.stop><strong>{{ current.glyph }}</strong><span><b>{{ weather.condition || current.label }}</b><small v-if="temperature">{{ temperature }}</small></span></button></template>
    <div class="weather-detail-content"><header><strong>{{ weather.condition || current.label }}</strong><span>{{ weather.date }}</span></header><div><b>{{ temperature || '温度未知' }}</b><span v-if="wind">{{ wind }}</span><span v-if="weather.precipitationProbability != null">降水概率 {{ weather.precipitationProbability }}%</span></div><footer>{{ weather.providerName }}<span v-if="weather.reportedAt"> · 发布于 {{ weather.reportedAt }}</span></footer></div>
  </ElPopover>
</template>

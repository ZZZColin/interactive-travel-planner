<script setup lang="ts">
import { computed } from 'vue'
import { categoryMeta } from '../../domain/categories'
import { categoryPaths } from '../../assets/icons/placeCategoryIcons'
import type { PlaceCategory } from '../../domain/types'

const props = withDefaults(defineProps<{
  category: PlaceCategory
  size?: 'small' | 'marker'
}>(), { size: 'small' })

const meta = computed(() => categoryMeta[props.category])
const path = computed(() => categoryPaths[meta.value.icon])
</script>

<template>
  <span
    class="category-icon"
    :class="size"
    :style="{ '--cat': meta.color, '--soft': meta.soft }"
    :title="meta.label"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true" v-html="path" />
  </span>
</template>

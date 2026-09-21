<script setup lang="ts">
import { appLocale, setAppLocale } from '../../i18n'

function toggleLocale(): void {
  setAppLocale(appLocale.value === 'zh-CN' ? 'en-US' : 'zh-CN')
}
</script>

<template>
  <button
    type="button"
    class="locale-switcher"
    :title="appLocale === 'zh-CN' ? 'Switch to English' : '切换到中文'"
    :aria-label="appLocale === 'zh-CN' ? 'Switch to English' : '切换到中文'"
    @click="toggleLocale"
  >
    <i class="pi pi-globe" />
    <span>{{ appLocale === 'zh-CN' ? 'EN' : '中文' }}</span>
  </button>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput } from 'element-plus'
import { clearGoogleMapConfig, readGoogleMapConfig, saveGoogleMapConfig } from '../../map/providers/google/config'
import { usePlannerStore } from '../../stores/planner'

const props = withDefaults(defineProps<{ open: boolean; activateOnSave?: boolean }>(), { activateOnSave: false })
const emit = defineEmits<{ close: []; saved: [] }>()
const store = usePlannerStore()
const apiKey = ref('')
const mapId = ref('')
const language = ref('zh-CN')
const region = ref('CN')
const configured = ref(false)

watch(() => props.open, (open) => {
  if (!open) return
  const config = readGoogleMapConfig()
  apiKey.value = config?.apiKey ?? ''
  mapId.value = config?.mapId ?? ''
  language.value = config?.language ?? 'zh-CN'
  region.value = config?.region ?? 'CN'
  configured.value = Boolean(config)
})

function save(): void {
  try {
    saveGoogleMapConfig({ apiKey: apiKey.value, mapId: mapId.value, language: language.value, region: region.value })
    store.notify('Google Maps 配置已保存')
    if (props.activateOnSave) { emit('saved'); emit('close') }
    else location.reload()
  } catch (error) { store.notify(error instanceof Error ? error.message : 'Google Maps 配置保存失败') }
}

function clear(): void {
  clearGoogleMapConfig(); store.notify('Google Maps 配置已清除'); location.reload()
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog map-config-modal" width="590px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header>
      <div class="map-config-modal-title"><div class="map-engine-logo google">G</div><div><h2>Google Maps 配置</h2><p>配置只保存在当前浏览器，并独立于高德、腾讯与 Cesium。</p></div></div>
    </template>
    <div class="config-notice google-config-notice"><i class="pi pi-info-circle" /><span>需要启用 Maps JavaScript API、Places API (New) 与 Routes API，并为项目开通结算。建议给 Key 设置网站来源限制。</span></div>
    <div class="configform element-form">
      <div class="field">
        <label for="google-api-key">API Key <a href="https://console.cloud.google.com/google/maps-apis/credentials" target="_blank" rel="noopener noreferrer" class="config-field-link"><i class="pi pi-external-link" />管理凭据</a></label>
        <ElInput id="google-api-key" v-model="apiKey" show-password autocomplete="off" placeholder="填写 Google API Key" />
        <small>用于地图、地点搜索与路线查询。请限制为当前网站来源，不要提交到 Git。</small>
      </div>
      <div class="field">
        <label for="google-map-id">Map ID（可选） <a href="https://console.cloud.google.com/google/maps-apis/studio/maps" target="_blank" rel="noopener noreferrer" class="config-field-link"><i class="pi pi-external-link" />管理 Map ID</a></label>
        <ElInput id="google-map-id" v-model="mapId" autocomplete="off" placeholder="用于矢量地图、倾斜视角和云端样式" />
        <small>不填写仍可使用 2D 地图；2.5D 倾斜视角需要支持矢量地图的 Map ID。</small>
      </div>
      <div class="google-config-locale">
        <div class="field"><label for="google-language">界面语言</label><ElInput id="google-language" v-model="language" placeholder="zh-CN" /></div>
        <div class="field"><label for="google-region">区域代码</label><ElInput id="google-region" v-model="region" maxlength="2" placeholder="CN" /></div>
      </div>
    </div>
    <div class="google-api-checklist"><span><i class="pi pi-map" />地图显示</span><span><i class="pi pi-search" />地点搜索</span><span><i class="pi pi-directions" />多路线方案</span><span><i class="pi pi-car" />实时路况</span></div>
    <template #footer>
      <ElButton v-if="configured" type="danger" text @click="clear"><i class="pi pi-trash" />清除配置</ElButton><span class="spacer" />
      <ElButton text @click="emit('close')">取消</ElButton><ElButton type="primary" @click="save"><i class="pi pi-check" />保存并加载地图</ElButton>
    </template>
  </ElDialog>
</template>

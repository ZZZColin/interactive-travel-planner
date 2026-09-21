<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput, ElInputNumber, ElOption, ElSelect, ElSwitch } from 'element-plus'
import { mapRuntimeState } from '../../map/provider'
import { mapProviderDefinitions } from '../../map/config'
import { clearCesiumMapConfig, defaultCesiumMapConfig, readCesiumMapConfig, saveCesiumMapConfig, type CesiumImageryMode } from '../../map/providers/cesium/config'
import { usePlannerStore } from '../../stores/planner'

const props = withDefaults(defineProps<{ open: boolean; activateOnSave?: boolean }>(), { activateOnSave: false })
const emit = defineEmits<{ close: []; saved: [] }>()
const store = usePlannerStore()
const ionToken = ref('')
const imageryMode = ref<CesiumImageryMode>('natural-earth')
const useWorldTerrain = ref(false)
const useOsmBuildings = ref(false)
const terrainExaggeration = ref(1)
const configured = ref(false)

watch(() => props.open, (open) => {
  if (!open) return
  const config = readCesiumMapConfig() ?? defaultCesiumMapConfig
  ionToken.value = config.ionToken ?? ''
  imageryMode.value = config.imageryMode
  useWorldTerrain.value = config.useWorldTerrain
  useOsmBuildings.value = config.useOsmBuildings
  terrainExaggeration.value = config.terrainExaggeration
  configured.value = Boolean(readCesiumMapConfig())
})

function save(): void {
  try {
    saveCesiumMapConfig({ ionToken: ionToken.value, imageryMode: imageryMode.value, useWorldTerrain: useWorldTerrain.value, useOsmBuildings: useOsmBuildings.value, terrainExaggeration: terrainExaggeration.value })
    store.notify('Cesium 3D 地球配置已保存')
    if (props.activateOnSave) { emit('saved'); emit('close') }
    else location.reload()
  } catch (error) { store.notify(error instanceof Error ? error.message : 'Cesium 配置保存失败') }
}

function clear(): void {
  clearCesiumMapConfig()
  store.notify('Cesium 配置已清除')
  location.reload()
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog map-config-modal cesium-config-modal" width="590px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header><div class="map-config-modal-title"><div class="map-engine-logo cesium">3D</div><div><h2>Cesium 3D 地球配置</h2><p>Cesium 只负责三维显示；地点搜索和路线规划继续使用当前选中的二维地图服务。</p></div></div></template>
    <div class="config-notice cesium-config-notice"><i class="pi pi-info-circle" /> 不填写 ion Token 也可以使用内置自然地球影像。World Imagery、世界地形和 OSM 3D 建筑需要 Cesium ion Token。</div>
    <div class="configform element-form">
      <div class="field"><label for="cesium-ion-token">Cesium ion Token（可选） <a href="https://cesium.com/ion/tokens" target="_blank" rel="noopener noreferrer" class="config-field-link"><i class="pi pi-external-line" />获取 Token</a></label><ElInput id="cesium-ion-token" v-model="ionToken" show-password autocomplete="off" /><small>Token 只保存在当前浏览器，并可以通过全局配置迁移功能导出。</small></div>
      <div class="field"><label>默认影像</label><ElSelect v-model="imageryMode"><ElOption label="内置自然地球影像（无需 Token）" value="natural-earth" /><ElOption label="World Imagery 纯卫星影像（推荐校准路线）" value="world-imagery" :disabled="!ionToken.trim()" /><ElOption label="World Imagery + 道路标注（仅供参考）" value="world-imagery-labels" :disabled="!ionToken.trim()" /></ElSelect></div>
      <div class="cesium-feature-grid">
        <label><span><b>世界地形</b><small>显示山脉和真实高程</small></span><ElSwitch v-model="useWorldTerrain" :disabled="!ionToken.trim()" /></label>
        <label><span><b>OSM 3D 建筑</b><small>在支持区域加载三维建筑</small></span><ElSwitch v-model="useOsmBuildings" :disabled="!ionToken.trim()" /></label>
      </div>
      <div class="field cesium-exaggeration-field"><label>地形夸张</label><ElInputNumber v-model="terrainExaggeration" :min="0.5" :max="5" :step="0.1" :precision="1" /><small>1.0 为真实比例；山区路线演示可适当提高。</small></div>
      <div class="cesium-data-source-note"><i class="pi pi-link" /><span>当前地点服务：{{ mapProviderDefinitions[mapRuntimeState.selection.placeServiceId].name }}；路线服务：{{ mapProviderDefinitions[mapRuntimeState.selection.routingServiceId].name }}。</span></div>
      <div v-if="mapRuntimeState.selection.placeServiceId === `google` || mapRuntimeState.selection.routingServiceId === `google`" class="cesium-coordinate-note"><i class="pi pi-info-circle" /><span>Google 地点与路线数据不绘制到非 Google 地图；切换到 Cesium 时会自动改用已配置的高德或腾讯数据服务。</span></div>
      <div v-if="imageryMode === 'world-imagery-labels'" class="cesium-coordinate-note"><i class="pi pi-exclamation-triangle" /><span>道路标注来自独立底图数据，在中国境内可能与卫星实景或导航中心线存在数据偏差；判断路线位置时建议使用纯卫星影像。</span></div>
    </div>
    <template #footer><ElButton v-if="configured" type="danger" text @click="clear"><i class="pi pi-trash" />清除配置</ElButton><span class="spacer" /><ElButton text @click="emit('close')">取消</ElButton><ElButton type="primary" @click="save"><i class="pi pi-check" />保存并加载 3D 地球</ElButton></template>
  </ElDialog>
</template>

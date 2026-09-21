<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput } from 'element-plus'
import { clearTencentMapConfig, readTencentMapConfig, saveTencentMapConfig } from '../../map/providers/tencent/config'
import { usePlannerStore } from '../../stores/planner'

const props = withDefaults(defineProps<{ open: boolean; activateOnSave?: boolean }>(), { activateOnSave: false })
const emit = defineEmits<{ close: []; saved: [] }>()
const store = usePlannerStore()
const key = ref('')
const serviceSk = ref('')
const mapStyleId = ref('')
const configured = ref(false)

watch(() => props.open, (open) => {
  if (!open) return
  const config = readTencentMapConfig()
  key.value = config?.key ?? ''
  serviceSk.value = config?.serviceSk ?? ''
  mapStyleId.value = config?.mapStyleId ?? ''
  configured.value = Boolean(config)
})

function save(): void {
  try {
    saveTencentMapConfig({ key: key.value, serviceSk: serviceSk.value, mapStyleId: mapStyleId.value })
    store.notify('腾讯地图配置已保存')
    if (props.activateOnSave) { emit('saved'); emit('close') }
    else location.reload()
  } catch (error) { store.notify(error instanceof Error ? error.message : '腾讯地图配置保存失败') }
}

function clear(): void {
  clearTencentMapConfig()
  store.notify('腾讯地图配置已清除')
  location.reload()
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog map-config-modal" width="560px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header><div class="map-config-modal-title"><div class="map-engine-logo tencent">腾</div><div><h2>腾讯地图配置</h2><p>这组配置只属于腾讯地图 JavaScript API GL，不与高德配置共用。</p></div></div></template>
    <div class="config-notice"><i class="pi pi-info-circle" /> 地图及服务类库可能产生调用费用。配置仅保存在当前浏览器，不会写入项目或上传至应用服务器。</div>
    <div class="tencent-service-notice"><strong>路线查询还需要单独授权</strong><span>如果地图可以显示但路线查询失败，通常是 Key 未开启 WebServiceAPI、当前域名未加入授权域名，或者填写了无效的服务签名 SK。</span></div>
    <div class="configform element-form">
      <div class="field"><label for="tencent-key">JavaScript API GL Key <a href="https://lbs.qq.com/dev/console/application/mine" target="_blank" rel="noopener noreferrer" class="config-field-link"><i class="pi pi-external-line" />获取 Key</a></label><ElInput id="tencent-key" v-model="key" show-password autocomplete="off" /><small>请在腾讯位置服务控制台创建并启用 JavaScript API GL；POI 搜索和路线规划还需为同一个 Key 开启 WebServiceAPI，并配置可调用域名。</small></div>
      <div class="field"><label for="tencent-service-sk">服务签名 SK（可选）</label><ElInput id="tencent-service-sk" v-model="serviceSk" show-password autocomplete="off" /><small>只有在腾讯 WebServiceAPI 开启签名校验时填写控制台生成的 SK 字符串；未开启签名校验请留空。</small></div>
      <div class="field"><label for="tencent-style">个性化地图样式 ID（可选）</label><ElInput id="tencent-style" v-model="mapStyleId" autocomplete="off" placeholder="例如 style1 或控制台中的样式 ID" /><small>用于适配当前产品主题；留空时使用腾讯地图默认矢量底图，并保留道路、建筑和 POI 标注。</small></div>
    </div>
    <template #footer><ElButton v-if="configured" type="danger" text @click="clear"><i class="pi pi-trash" />清除配置</ElButton><span class="spacer" /><ElButton text @click="emit('close')">取消</ElButton><ElButton type="primary" @click="save"><i class="pi pi-check" />保存并加载地图</ElButton></template>
  </ElDialog>
</template>

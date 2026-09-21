<script setup lang="ts">
import { ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput } from 'element-plus'
import { clearAmapConfig, readAmapConfig, saveAmapConfig } from '../../map/providers/amap/config'
import { usePlannerStore } from '../../stores/planner'

const props = withDefaults(defineProps<{ open: boolean; activateOnSave?: boolean }>(), { activateOnSave: false })
const emit = defineEmits<{ close: []; saved: [] }>()
const store = usePlannerStore()
const key = ref('')
const securityJsCode = ref('')
const webServiceKey = ref('')
const configured = ref(false)

watch(() => props.open, (open) => {
  if (!open) return
  const config = readAmapConfig()
  key.value = config?.key ?? ''
  securityJsCode.value = config?.securityJsCode ?? ''
  webServiceKey.value = config?.webServiceKey ?? ''
  configured.value = Boolean(config)
})

function save(): void {
  try {
    saveAmapConfig({ key: key.value, securityJsCode: securityJsCode.value, webServiceKey: webServiceKey.value })
    store.notify('高德地图配置已保存')
    if (props.activateOnSave) { emit('saved'); emit('close') }
    else location.reload()
  } catch (error) {
    store.notify(error instanceof Error ? error.message : '高德地图配置保存失败')
  }
}

function clear(): void {
  clearAmapConfig()
  store.notify('高德地图配置已清除')
  location.reload()
}
</script>

<template>
  <ElDialog
    :model-value="open"
    class="travel-dialog map-config-modal"
    width="560px"
    align-center
    destroy-on-close
    @update:model-value="!$event && emit('close')"
  >
    <template #header>
      <div class="map-config-modal-title">
        <div class="map-engine-logo">高</div>
        <div>
          <h2>高德地图配置</h2>
          <p>这组配置只属于高德地图引擎，不会与其他地图引擎共用。</p>
        </div>
      </div>
    </template>

    <div class="config-notice"><i class="pi pi-info-circle" /> 地图服务可能产生调用费用。配置仅保存在当前浏览器，不会写入项目或上传至应用服务器。</div>

    <div class="configform element-form">
      <div class="field">
        <label for="amap-key">Web 端（JS API）Key <a href="https://console.amap.com/dev/key/app" target="_blank" rel="noopener noreferrer" class="config-field-link"><i class="pi pi-external-line" />获取 Key</a></label>
        <ElInput id="amap-key" v-model="key" show-password autocomplete="off" />
        <small>请使用高德开放平台创建的 Web 端（JS API）Key。</small>
      </div>
      <div class="field">
        <label for="amap-security">安全密钥 securityJsCode</label>
        <ElInput id="amap-security" v-model="securityJsCode" show-password autocomplete="off" />
        <small>必须与上面的 Web Key 属于同一个高德应用。</small>
      </div>
      <div class="field">
        <label for="amap-web-service-key">Web 服务 Key（分享地图，可选）</label>
        <ElInput id="amap-web-service-key" v-model="webServiceKey" show-password autocomplete="off" />
        <small>用于分享工作室生成带真实底图的高德静态路线图；它与 JavaScript API Key 是不同类型的 Key。</small>
      </div>
    </div>

    <template #footer>
      <ElButton v-if="configured" type="danger" text @click="clear"><i class="pi pi-trash" />清除配置</ElButton>
      <span class="spacer" />
      <ElButton text @click="emit('close')">取消</ElButton>
      <ElButton type="primary" @click="save"><i class="pi pi-check" />保存并加载地图</ElButton>
    </template>
  </ElDialog>
</template>

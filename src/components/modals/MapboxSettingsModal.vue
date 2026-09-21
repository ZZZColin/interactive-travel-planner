<script setup lang="ts">
import { ref, watch } from "vue";
import {
  ElButton,
  ElDialog,
  ElInput,
  ElInputNumber,
  ElSwitch,
} from "element-plus";
import {
  clearMapboxConfig,
  defaultMapboxConfig,
  readMapboxConfig,
  saveMapboxConfig,
  testMapboxConnection,
} from "../../map/providers/mapbox/config";
import { usePlannerStore } from "../../stores/planner";

const props = withDefaults(
  defineProps<{ open: boolean; activateOnSave?: boolean }>(),
  { activateOnSave: false },
);
const emit = defineEmits<{ close: []; saved: [] }>();
const store = usePlannerStore();
const accessToken = ref("");
const styleUrl = ref(defaultMapboxConfig.styleUrl);
const satelliteStyleUrl = ref(defaultMapboxConfig.satelliteStyleUrl);
const terrainEnabled = ref(defaultMapboxConfig.terrainEnabled);
const terrainExaggeration = ref(defaultMapboxConfig.terrainExaggeration);
const buildings3dEnabled = ref(defaultMapboxConfig.buildings3dEnabled);
const configured = ref(false)
const testing = ref(false)
const testState = ref<'idle' | 'success' | 'error'>('idle')
const testMessage = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    const config = readMapboxConfig();
    accessToken.value = config?.accessToken ?? "";
    styleUrl.value = config?.styleUrl ?? defaultMapboxConfig.styleUrl;
    satelliteStyleUrl.value =
      config?.satelliteStyleUrl ?? defaultMapboxConfig.satelliteStyleUrl;
    terrainEnabled.value =
      config?.terrainEnabled ?? defaultMapboxConfig.terrainEnabled;
    terrainExaggeration.value =
      config?.terrainExaggeration ?? defaultMapboxConfig.terrainExaggeration;
    buildings3dEnabled.value =
      config?.buildings3dEnabled ?? defaultMapboxConfig.buildings3dEnabled;
    configured.value = Boolean(config);
    testState.value = "idle";
    testMessage.value = "";
  },
);


async function testConnection(): Promise<void> {
  testing.value = true
  testState.value = 'idle'
  testMessage.value = ''
  try {
    const result = await testMapboxConnection({ accessToken: accessToken.value, styleUrl: styleUrl.value, satelliteStyleUrl: satelliteStyleUrl.value, terrainEnabled: terrainEnabled.value, terrainExaggeration: terrainExaggeration.value, buildings3dEnabled: buildings3dEnabled.value })
    testState.value = 'success'
    testMessage.value = `连接成功：${result.styleName} · ${result.elapsedMs}ms`
  } catch (reason) {
    testState.value = 'error'
    testMessage.value = reason instanceof Error ? reason.message : 'Mapbox 连接测试失败'
  } finally { testing.value = false }
}

function save(): void {
  try {
    saveMapboxConfig({
      accessToken: accessToken.value,
      styleUrl: styleUrl.value,
      satelliteStyleUrl: satelliteStyleUrl.value,
      terrainEnabled: terrainEnabled.value,
      terrainExaggeration: terrainExaggeration.value,
      buildings3dEnabled: buildings3dEnabled.value,
    });
    store.notify("Mapbox 配置已保存");
    if (props.activateOnSave) {
      emit("saved");
      emit("close");
    } else location.reload();
  } catch (error) {
    store.notify(
      error instanceof Error ? error.message : "Mapbox 配置保存失败",
    );
  }
}

function clear(): void {
  clearMapboxConfig();
  store.notify("Mapbox 配置已清除");
  location.reload();
}
</script>

<template>
  <ElDialog
    :model-value="open"
    class="travel-dialog map-config-modal mapbox-config-modal"
    width="610px"
    align-center
    destroy-on-close
    @update:model-value="!$event && emit('close')"
  >
    <template #header
      ><div class="map-config-modal-title">
        <div class="map-engine-logo mapbox">M</div>
        <div>
          <h2>Mapbox 配置</h2>
          <p>Mapbox 负责地图渲染；地点和路线服务可以在首页独立选择。</p>
        </div>
      </div></template
    >
    <div class="config-notice mapbox-config-notice">
      <i class="pi pi-info-circle" /><span
        >请使用 Public Access Token，并在 Mapbox 控制台限制允许访问的网站
        URL。配置只保存在当前浏览器。</span
      >
    </div>
    <div class="configform element-form">
      <div class="field">
        <label for="mapbox-token"
          >Public Access Token
          <a
            href="https://console.mapbox.com/account/access-tokens/"
            target="_blank"
            rel="noopener noreferrer"
            class="config-field-link"
            ><i class="pi pi-external-link" />管理 Token</a
          ></label
        ><ElInput
          id="mapbox-token"
          v-model="accessToken"
          show-password
          autocomplete="off"
          placeholder="填写 Mapbox Public Token"
        />
      </div>
      <div class="field">
        <label for="mapbox-style">普通地图 Style URL</label
        ><ElInput
          id="mapbox-style"
          v-model="styleUrl"
          autocomplete="off"
        /><small
          >默认使用 Mapbox Streets，也可以填写自己在 Mapbox Studio
          中创建的样式。</small
        >
      </div>
      <div class="field">
        <label for="mapbox-satellite-style">卫星地图 Style URL</label
        ><ElInput
          id="mapbox-satellite-style"
          v-model="satelliteStyleUrl"
          autocomplete="off"
        />
      </div>
      <div class="mapbox-feature-grid">
        <label
          ><span><b>地形</b><small>在倾斜视角中显示真实高程</small></span
          ><ElSwitch v-model="terrainEnabled"
        /></label>
        <label
          ><span><b>3D 建筑</b><small>样式支持时显示建筑拉伸</small></span
          ><ElSwitch v-model="buildings3dEnabled"
        /></label>
      </div>
      <div v-if="terrainEnabled" class="field mapbox-exaggeration-field">
        <label>地形夸张比例</label
        ><ElInputNumber
          v-model="terrainExaggeration"
          :min="0.1"
          :max="5"
          :step="0.1"
          :precision="1"
        /><small>1.0 为真实比例。</small>
      </div>
      <div v-if="testMessage" class="mapbox-test-result" :class="testState"><i :class="testState === 'success' ? 'pi pi-check-circle' : 'pi pi-exclamation-circle'" />{{ testMessage }}</div>
    </div>
    <template #footer
      ><ElButton :loading="testing" @click="testConnection"><i class="pi pi-wifi" />测试连接</ElButton><ElButton v-if="configured" type="danger" text @click="clear"
        ><i class="pi pi-trash" />清除配置</ElButton
      ><span class="spacer" /><ElButton text @click="emit('close')"
        >取消</ElButton
      ><ElButton type="primary" @click="save"
        ><i class="pi pi-check" />保存并加载 Mapbox</ElButton
      ></template
    >
  </ElDialog>
</template>

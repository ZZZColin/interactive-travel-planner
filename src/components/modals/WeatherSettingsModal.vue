<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElButton, ElDialog, ElInput, ElOption, ElSelect, ElTag } from 'element-plus'
import { hasAmapConfig } from '../../map/providers/amap/config'
import { usePlannerStore } from '../../stores/planner'
import { usePlansStore } from '../../stores/plans'
import { useWeatherStore } from '../../stores/weather'
import { weatherProviderDefinitions } from '../../weather/registry'
import { clearAzureMapsWeatherConfig, readAzureMapsWeatherConfig, saveAzureMapsWeatherConfig } from '../../weather/providers/azure/config'
import { clearCaiyunWeatherConfig, readCaiyunWeatherConfig, saveCaiyunWeatherConfig } from '../../weather/providers/caiyun/config'
import { clearQWeatherConfig, readQWeatherConfig, saveQWeatherConfig, type QWeatherAuthType } from '../../weather/providers/qweather/config'
import type { WeatherSelection } from '../../weather/types'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; mapSettings: [] }>()
const weather = useWeatherStore()
const planner = usePlannerStore()
const plans = usePlansStore()
const selected = ref<WeatherSelection>('amap')
const azureEndpoint = ref('https://atlas.microsoft.com')
const azureSubscriptionKey = ref('')
const azureForecastDays = ref<15 | 25 | 45>(45)
const azureConfigured = ref(false)
const qweatherApiHost = ref('')
const qweatherAuthType = ref<QWeatherAuthType>('api-key')
const qweatherCredential = ref('')
const qweatherForecastDays = ref<10 | 30>(10)
const qweatherConfigured = ref(false)
const caiyunEndpoint = ref('https://api.caiyunapp.com')
const caiyunToken = ref('')
const caiyunForecastDays = ref<5 | 10 | 15>(15)
const caiyunConfigured = ref(false)
const error = ref('')
const provider = computed(() => weatherProviderDefinitions.find((item) => item.id === selected.value) ?? null)
const effectiveMaxForecastDays = computed(() => {
  if (selected.value === 'azure-maps') return azureForecastDays.value
  if (selected.value === 'qweather') return qweatherForecastDays.value
  if (selected.value === 'caiyun') return caiyunForecastDays.value
  return provider.value?.maxForecastDays ?? 1
})
const forecastRange = computed(() => {
  const start = new Date()
  const end = new Date(start)
  end.setDate(end.getDate() + effectiveMaxForecastDays.value - 1)
  const format = (date: Date) => `${date.getMonth() + 1} 月 ${date.getDate()} 日`
  return `${format(start)}—${format(end)}`
})

watch(() => props.open, (open) => {
  if (!open) return
  selected.value = weather.selectedProviderId
  const azure = readAzureMapsWeatherConfig()
  azureEndpoint.value = azure?.endpoint ?? 'https://atlas.microsoft.com'
  azureSubscriptionKey.value = azure?.subscriptionKey ?? ''
  azureForecastDays.value = azure?.forecastDays ?? 45
  azureConfigured.value = Boolean(azure)
  const qweather = readQWeatherConfig()
  qweatherApiHost.value = qweather?.apiHost ?? ''
  qweatherAuthType.value = qweather?.authType ?? 'api-key'
  qweatherCredential.value = qweather?.credential ?? ''
  qweatherForecastDays.value = qweather?.forecastDays ?? 10
  qweatherConfigured.value = Boolean(qweather)
  const caiyun = readCaiyunWeatherConfig()
  caiyunEndpoint.value = caiyun?.endpoint ?? 'https://api.caiyunapp.com'
  caiyunToken.value = caiyun?.token ?? ''
  caiyunForecastDays.value = caiyun?.forecastDays ?? 15
  caiyunConfigured.value = Boolean(caiyun)
  error.value = ''
})

function syncCurrentPlan(): void {
  const startAt = plans.activePlan?.metadata.startAt
  if (startAt) weather.syncPlan(planner.days, planner.places, startAt)
}

function persistSelectedConfiguration(): void {
  if (selected.value === 'azure-maps') {
    saveAzureMapsWeatherConfig({ endpoint: azureEndpoint.value, subscriptionKey: azureSubscriptionKey.value, forecastDays: azureForecastDays.value })
    azureConfigured.value = true
  } else if (selected.value === 'qweather') {
    saveQWeatherConfig({ apiHost: qweatherApiHost.value, authType: qweatherAuthType.value, credential: qweatherCredential.value, forecastDays: qweatherForecastDays.value })
    qweatherConfigured.value = true
  } else if (selected.value === 'caiyun') {
    saveCaiyunWeatherConfig({ endpoint: caiyunEndpoint.value, token: caiyunToken.value, forecastDays: caiyunForecastDays.value })
    caiyunConfigured.value = true
  } else if (selected.value === 'amap' && !hasAmapConfig()) {
    throw new Error('请先完成高德地图配置')
  }
  weather.refreshProviderConfiguration()
}

function saveConfiguration(): void {
  error.value = ''
  try {
    persistSelectedConfiguration()
    if (selected.value === weather.defaultProviderId) {
      weather.clearCache()
      syncCurrentPlan()
    }
    planner.notify(selected.value === 'none' ? '天气关闭状态无需单独配置' : `${provider.value?.name ?? '天气服务'}配置已保存`)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '天气服务配置保存失败'
  }
}

function saveAsDefault(): void {
  error.value = ''
  try {
    persistSelectedConfiguration()
    weather.setDefaultProvider(selected.value)
    weather.clearCache()
    syncCurrentPlan()
    planner.notify(selected.value === 'none' ? '已将默认天气服务设为关闭' : `已将${provider.value?.name ?? '所选服务商'}设为默认天气服务`)
    emit('close')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '默认天气服务设置失败'
  }
}

function refresh(): void {
  weather.clearCache()
  syncCurrentPlan()
  planner.notify('天气缓存已刷新，正在重新查询')
}

function clearDefaultIfMatches(providerId: WeatherSelection): void {
  if (weather.defaultProviderId === providerId) weather.setDefaultProvider('none')
}

function clearAzure(): void {
  clearAzureMapsWeatherConfig()
  clearDefaultIfMatches('azure-maps')
  azureSubscriptionKey.value = ''
  azureConfigured.value = false
  weather.refreshProviderConfiguration()
  weather.clearCache()
  planner.notify('Azure Maps Weather 配置已清除')
}

function clearQWeather(): void {
  clearQWeatherConfig()
  clearDefaultIfMatches('qweather')
  qweatherCredential.value = ''
  qweatherConfigured.value = false
  weather.refreshProviderConfiguration()
  weather.clearCache()
  planner.notify('和风天气配置已清除')
}

function clearCaiyun(): void {
  clearCaiyunWeatherConfig()
  clearDefaultIfMatches('caiyun')
  caiyunToken.value = ''
  caiyunConfigured.value = false
  weather.refreshProviderConfiguration()
  weather.clearCache()
  planner.notify('彩云天气配置已清除')
}
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog weather-settings-modal" width="680px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header>
      <div class="weather-settings-title"><div class="weather-settings-icon">☀</div><div><h2>天气服务</h2><p>天气服务独立于地图引擎，可按供应商切换并扩展。</p></div></div>
    </template>

    <div class="weather-settings-content">
      <div class="field"><label>天气服务商</label><ElSelect v-model="selected"><ElOption label="关闭天气展示" value="none"><span class="weather-provider-option"><span>关闭天气展示</span><ElTag v-if="weather.defaultProviderId === 'none'" type="success" size="small" effect="light">默认</ElTag></span></ElOption><ElOption v-for="item in weatherProviderDefinitions" :key="item.id" :label="item.name" :value="item.id"><span class="weather-provider-option"><span>{{ item.name }}</span><ElTag v-if="weather.defaultProviderId === item.id" type="success" size="small" effect="light">默认</ElTag></span></ElOption></ElSelect></div>

      <section v-if="provider" class="weather-provider-card">
        <header><div><strong>{{ provider.name }}</strong><span>{{ provider.description }}</span></div><div class="weather-provider-card-tags"><ElTag v-if="selected === weather.defaultProviderId" type="success" effect="light">默认服务</ElTag><ElTag type="primary" effect="light">最长 {{ effectiveMaxForecastDays }} 天</ElTag></div></header>
        <div class="weather-provider-facts"><span><i class="pi pi-calendar" />当前可查询 {{ forecastRange }}</span><span><i class="pi pi-map-marker" />根据地点坐标自动查询每日天气</span><span><i class="pi pi-refresh" />天气缓存 30 分钟后自动更新</span></div>
      </section>

      <section v-if="selected === 'azure-maps'" class="azure-weather-config weather-provider-config element-form">
        <div class="azure-weather-config-head"><div><strong>Azure Maps Weather 配置</strong><span>配置只保存在当前浏览器，不会写入项目或构建产物。</span></div><ElButton v-if="azureConfigured" text type="danger" size="small" @click="clearAzure">清除配置</ElButton></div>
        <div class="field"><label>Azure Maps Endpoint</label><ElInput v-model="azureEndpoint" placeholder="https://atlas.microsoft.com" /><small>可以填写公共 Endpoint 或你自己的 Azure Maps 服务地址。</small></div>
        <div class="azure-weather-config-grid azure-key-grid"><div class="field azure-subscription-field"><label>Subscription Key <a href="https://portal.azure.com/#create/Microsoft.CognitiveServicesMaps" target="_blank" rel="noopener noreferrer" class="config-field-link"><i class="pi pi-external-line" />获取 Key</a></label><ElInput v-model="azureSubscriptionKey" show-password autocomplete="off" /></div><div class="field azure-horizon-field"><label>最长预测天数</label><ElSelect v-model="azureForecastDays"><ElOption label="15 天" :value="15" /><ElOption label="25 天" :value="25" /><ElOption label="45 天" :value="45" /></ElSelect><small>25 / 45 天需要账号具备对应服务层级。</small></div></div>
      </section>

      <section v-if="selected === 'qweather'" class="azure-weather-config weather-provider-config element-form">
        <div class="azure-weather-config-head"><div><strong>和风天气配置</strong><span>API Host 必须使用和风天气控制台分配给项目的专属 Host。</span></div><ElButton v-if="qweatherConfigured" text type="danger" size="small" @click="clearQWeather">清除配置</ElButton></div>
        <div class="field"><label>API Host</label><ElInput v-model="qweatherApiHost" placeholder="https://abcxyz.qweatherapi.com" /><small>不要填写旧的公共开发地址，使用控制台中的 API Host。</small></div>
        <div class="qweather-config-grid"><div class="field"><label>认证方式</label><ElSelect v-model="qweatherAuthType"><ElOption label="API KEY" value="api-key" /><ElOption label="JWT" value="jwt" /></ElSelect></div><div class="field"><label>{{ qweatherAuthType === 'jwt' ? 'JWT Token' : 'API KEY' }} <a href="https://console.qweather.com/" target="_blank" rel="noopener noreferrer" class="config-field-link"><i class="pi pi-external-line" />获取凭证</a></label><ElInput v-model="qweatherCredential" show-password autocomplete="off" /></div><div class="field"><label>最长预测天数</label><ElSelect v-model="qweatherForecastDays"><ElOption label="10 天经纬度预报" :value="10" /><ElOption label="30 天城市预报" :value="30" /></ElSelect></div></div>
        <div class="provider-config-note"><i class="pi pi-info-circle" />10 天使用经纬度每日预报；30 天会先通过 GeoAPI 获取 LocationID，再查询城市 30 天预报；该 v7 城市接口已被官方标记为后续弃用的兼容能力，默认建议使用 10 天经纬度接口。</div>
      </section>

      <section v-if="selected === 'caiyun'" class="azure-weather-config weather-provider-config element-form">
        <div class="azure-weather-config-head"><div><strong>彩云天气配置</strong><span>使用彩云天气 v2.6 逐日接口，实际返回天数受套餐限制。</span></div><ElButton v-if="caiyunConfigured" text type="danger" size="small" @click="clearCaiyun">清除配置</ElButton></div>
        <div class="field"><label>API Endpoint</label><ElInput v-model="caiyunEndpoint" placeholder="https://api.caiyunapp.com" /></div>
        <div class="azure-weather-config-grid"><div class="field"><label>Token <a href="https://dashboard.caiyunapp.com/" target="_blank" rel="noopener noreferrer" class="config-field-link"><i class="pi pi-external-line" />获取 Token</a></label><ElInput v-model="caiyunToken" show-password autocomplete="off" /></div><div class="field"><label>最长预测天数</label><ElSelect v-model="caiyunForecastDays"><ElOption label="5 天" :value="5" /><ElOption label="10 天" :value="10" /><ElOption label="15 天" :value="15" /></ElSelect><small>官方接口通常返回 1～15 天，最终以上游套餐为准。</small></div></div>
      </section>

      <div v-if="selected === 'amap' && !hasAmapConfig()" class="weather-config-warning"><i class="pi pi-exclamation-triangle" /><div><strong>高德地图尚未配置</strong><span>高德天气跟随高德 JavaScript API 配置，填写地图配置后才能查询。</span></div><ElButton size="small" @click="emit('mapSettings')">配置高德地图</ElButton></div>
      <div v-if="error" class="form-error"><i class="pi pi-exclamation-circle" />{{ error }}</div>
      <div class="weather-range-note"><i class="pi pi-info-circle" /><span>超出服务商预报范围的日期不会显示天气，也不会使用历史均值或 AI 猜测。长期预报的可靠性通常低于近期预报，应持续刷新；所有凭据只保存在当前浏览器，但会随天气请求发送给所选服务商。</span></div>
    </div>

    <template #footer><ElButton v-if="selected !== 'none' && selected === weather.defaultProviderId" text @click="refresh">刷新天气</ElButton><span class="spacer" /><ElButton text @click="emit('close')">取消</ElButton><ElButton v-if="selected !== 'none'" @click="saveConfiguration">保存配置</ElButton><ElButton type="primary" @click="saveAsDefault">{{ selected === weather.defaultProviderId ? '保存默认服务' : '保存并设为默认' }}</ElButton></template>
  </ElDialog>
</template>

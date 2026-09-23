<script setup lang="ts">
import { computed, ref } from 'vue'
import { ElAvatar, ElButton, ElCard, ElDropdown, ElDropdownItem, ElDropdownMenu, ElMessageBox, ElOption, ElSelect, ElTag } from 'element-plus'
import { formatMoney, normalizeBudgetState } from '../../domain/budget'
import { formatPlanDateTime } from '../../domain/plans'
import type { PlanRecord } from '../../domain/types'
import { mapProviderDefinitions, mapRendererDefinitions, type MapProviderId, type MapRendererId, type MapRuntimeSelection } from '../../map/config'
import { hasMapProviderConfig, hasMapRendererConfig, mapRuntimeState } from '../../map/provider'
import { usePlansStore } from '../../stores/plans'
import LocaleSwitcher from '../ui/LocaleSwitcher.vue'

const emit = defineEmits<{
  create: []
  aiImport: []
  edit: [plan: PlanRecord]
  backup: []
  recycle: []
  configBackup: []
  completeBackup: []
  accountSync: []
  securityAdmin: []
  openDemo: []
  mapRuntimeChange: [selection: MapRuntimeSelection]
  mapSettings: [providerId: MapRendererId]
  shareAccount: [plan: PlanRecord]
  sharedWithMe: []
}>()

const store = usePlansStore()
const migrationOpen = ref(false)

const rendererOptions = Object.values(mapRendererDefinitions).filter((item) => item.available)
const providerOptions = Object.values(mapProviderDefinitions)
const runtimeSelection = computed(() => {
  mapRuntimeState.revision
  return mapRuntimeState.defaultSelection
})

function rendererConfigured(id: MapRendererId): boolean {
  mapRuntimeState.revision
  return hasMapRendererConfig(id)
}

function providerConfigured(id: MapProviderId): boolean {
  mapRuntimeState.revision
  return hasMapProviderConfig(id)
}

function selectRenderer(rendererId: MapRendererId): void {
  emit('mapRuntimeChange', { ...runtimeSelection.value, rendererId })
}

function selectPlaceService(placeServiceId: MapProviderId): void {
  emit('mapRuntimeChange', { ...runtimeSelection.value, placeServiceId })
}

function selectRoutingService(routingServiceId: MapProviderId): void {
  emit('mapRuntimeChange', { ...runtimeSelection.value, routingServiceId })
}

function googleServiceDisabled(): boolean {
  return runtimeSelection.value.rendererId !== 'google'
}

function planStatus(plan: PlanRecord): { label: string; type: 'primary' | 'success' | 'info' } {
  const now = Date.now()
  const start = new Date(plan.metadata.startAt).getTime()
  const end = new Date(plan.metadata.endAt).getTime()
  if (now < start) return { label: '待出发', type: 'primary' }
  if (now <= end) return { label: '进行中', type: 'success' }
  return { label: '已结束', type: 'info' }
}

function planBudgetLimit(plan: PlanRecord): number | null {
  return normalizeBudgetState(plan.plannerState.budget).settings.limit
}

const planCountText = computed(() => `${store.plans.length} 个旅行计划 · 按开始时间倒序`)

function openMigration(command: 'complete' | 'plan' | 'config'): void {
  if (command === 'complete') emit('completeBackup')
  else if (command === 'plan') emit('backup')
  else emit('configBackup')
}

async function requestDelete(plan: PlanRecord): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确定删除“${plan.metadata.name}”吗？计划中的日期、地点和路线将移入回收站，之后可以恢复。`,
      '删除旅行计划',
      {
        customClass: 'travel-confirm-dialog',
        confirmButtonText: '移入回收站',
        cancelButtonText: '取消',
        confirmButtonClass: 'travel-danger-confirm',
        type: 'warning',
        autofocus: false,
      },
    )
    store.deletePlan(plan.metadata.id)
  } catch {
    // 用户取消删除时保持现有计划不变。
  }
}
</script>

<template>
  <div class="home-shell">
    <header class="home-topbar">
      <div class="brand"><span class="brandmark">途</span>行途规划</div>
      <div class="spacer" />
      <LocaleSwitcher />
      <ElButton text class="home-topbar-action" title="查看别人分享给你的计划" @click="emit('sharedWithMe')"><i class="pi pi-share-alt" /><span>共享给我</span></ElButton>
      <ElButton v-if="store.recycleBin.length" text class="home-topbar-action" title="打开计划回收站" @click="emit('recycle')"><i class="pi pi-trash" /><span>回收站</span><em>{{ store.recycleBin.length }}</em></ElButton>
      <ElDropdown trigger="click" popper-class="home-migration-menu" @command="openMigration" @visible-change="migrationOpen = $event">
        <ElButton text class="home-topbar-action" :class="{ open: migrationOpen }" title="导入、导出与迁移数据"><i class="pi pi-box" /><span>导入导出</span><i class="pi pi-chevron-down" /></ElButton>
        <template #dropdown>
          <ElDropdownMenu>
            <ElDropdownItem command="complete" class="home-migration-item recommended">
              <span class="home-migration-option complete"><i class="pi pi-clone" /><span><b>完整迁移<em>推荐</em></b><small>计划、AI、地图和天气配置</small></span></span>
            </ElDropdownItem>
            <ElDropdownItem command="plan" class="home-migration-item plan" divided>
              <span class="home-migration-option plan"><i class="pi pi-map-marker" /><span><b>仅旅行计划</b><small>地点、日期、路线与预算</small></span></span>
            </ElDropdownItem>
            <ElDropdownItem command="config" class="home-migration-item config">
              <span class="home-migration-option config"><i class="pi pi-cog" /><span><b>仅服务配置</b><small>AI、地图与天气服务密钥</small></span></span>
            </ElDropdownItem>
          </ElDropdownMenu>
        </template>
      </ElDropdown>
      <ElButton text class="home-topbar-action" title="服务器同步、修改密码与退出登录" @click="emit('accountSync')"><i class="pi pi-cloud" /><span>账号与同步</span></ElButton>
      <ElButton text class="home-topbar-action" title="两步验证、用户管理与审计日志" @click="emit('securityAdmin')"><i class="pi pi-shield" /><span>安全与管理</span></ElButton>
      <template v-if="store.plans.length">
        <ElButton class="home-ai-import" @click="emit('aiImport')"><i class="pi pi-sparkles" />AI 导入计划</ElButton>
        <ElButton type="primary" class="home-create-top" @click="emit('create')">
          <i class="pi pi-plus" />新建计划
        </ElButton>
      </template>
    </header>

    <main class="home-content">
      <section class="home-hero home-hero-clean">
        <div>
          <div class="eyebrow">TRAVEL PLANS</div>
          <h1>我的旅行计划</h1>
          <p>从地点收集、按天编排到路线与时间校验，每个计划都是一个独立工作空间。</p>
        </div>
      </section>

      <section class="home-map-runtime-card">
        <header>
          <div><span class="home-runtime-icon"><i class="pi pi-map" /></span><div><h2>地图运行方案</h2><p>地图显示、地点搜索和路线计算可以分别选择，配置会应用到所有旅行计划。</p></div></div>
          <ElTag type="success" effect="light" round>默认方案</ElTag>
        </header>
        <div class="home-runtime-selectors">
          <article>
            <label><i class="pi pi-desktop" />地图显示</label>
            <ElSelect :model-value="runtimeSelection.rendererId" popper-class="home-runtime-select-popper" @change="selectRenderer($event as MapRendererId)">
              <ElOption v-for="item in rendererOptions" :key="item.id" :value="item.id" :label="item.name"><span class="home-runtime-option"><i :class="`engine-${item.id}`">{{ item.logo }}</i><span><b>{{ item.name }}</b><small>{{ item.description }}</small></span><em :class="{ ready: rendererConfigured(item.id) }">{{ rendererConfigured(item.id) ? '已配置' : '需配置' }}</em></span></ElOption>
            </ElSelect>
            <div class="home-runtime-current"><span>{{ mapRendererDefinitions[runtimeSelection.rendererId].description }}</span><button @click="emit('mapSettings', runtimeSelection.rendererId)">配置</button></div>
          </article>
          <span class="home-runtime-connector"><i class="pi pi-plus" /></span>
          <article>
            <label><i class="pi pi-map-marker" />地点搜索</label>
            <ElSelect :model-value="runtimeSelection.placeServiceId" popper-class="home-runtime-select-popper" @change="selectPlaceService($event as MapProviderId)">
              <ElOption v-for="item in providerOptions" :key="item.id" :value="item.id" :label="item.name" :disabled="item.id === 'google' && googleServiceDisabled()"><span class="home-runtime-option"><i :class="`engine-${item.id}`">{{ item.logo }}</i><span><b>{{ item.name }}</b><small>{{ item.description }}</small></span><em :class="{ ready: providerConfigured(item.id) }">{{ providerConfigured(item.id) ? '已配置' : '需配置' }}</em></span></ElOption>
            </ElSelect>
            <div class="home-runtime-current"><span>地图搜索、附近发现和地点详情</span><button @click="emit('mapSettings', runtimeSelection.placeServiceId)">配置</button></div>
          </article>
          <span class="home-runtime-connector"><i class="pi pi-plus" /></span>
          <article>
            <label><i class="pi pi-directions" />路线计算</label>
            <ElSelect :model-value="runtimeSelection.routingServiceId" popper-class="home-runtime-select-popper" @change="selectRoutingService($event as MapProviderId)">
              <ElOption v-for="item in providerOptions" :key="item.id" :value="item.id" :label="item.name" :disabled="item.id === 'google' && googleServiceDisabled()"><span class="home-runtime-option"><i :class="`engine-${item.id}`">{{ item.logo }}</i><span><b>{{ item.name }}</b><small>{{ item.description }}</small></span><em :class="{ ready: providerConfigured(item.id) }">{{ providerConfigured(item.id) ? '已配置' : '需配置' }}</em></span></ElOption>
            </ElSelect>
            <div class="home-runtime-current"><span>路线、时长、里程和候选方案</span><button @click="emit('mapSettings', runtimeSelection.routingServiceId)">配置</button></div>
          </article>
        </div>
        <footer><i class="pi pi-info-circle" /><span v-if="runtimeSelection.rendererId === 'mapbox'">Mapbox 负责视觉渲染；大陆地点和路线建议继续使用高德或腾讯。</span><span v-else-if="runtimeSelection.rendererId === 'cesium'">Cesium 负责三维展示；地点和路线由选中的二维数据服务提供。</span><span v-else-if="runtimeSelection.rendererId !== 'google'">Google 地点与路线数据只能与 Google Maps 渲染器组合。</span><span v-else>Google Maps 渲染器可以使用独立的地点和路线服务。</span></footer>
      </section>

      <div class="home-section-head">
        <div>
          <h2>全部计划</h2>
          <span>{{ planCountText }}</span>
        </div>
      </div>

      <section v-if="store.sortedPlans.length" class="home-plan-grid">
        <ElCard
          v-for="plan in store.sortedPlans"
          :key="plan.metadata.id"
          class="plan-card"
          shadow="never"
          @click="store.openPlan(plan.metadata.id)"
        >
          <template #header>
            <div class="plan-card-cover">
              <span class="plan-card-route">● ─── ● ─── ●</span>
              <ElTag :type="planStatus(plan).type" round effect="light" class="plan-status">
                {{ planStatus(plan).label }}
              </ElTag>
              <div class="plan-card-actions">
                <ElButton text circle class="plan-share-button" title="分享给账号" @click.stop="emit('shareAccount', plan)">
                  <i class="pi pi-share-alt" />
                </ElButton>
                <ElButton text circle class="plan-edit-button" title="编辑计划" @click.stop="emit('edit', plan)">
                  <i class="pi pi-pencil" />
                </ElButton>
                <ElButton text circle type="danger" class="plan-delete-button" title="删除计划" @click.stop="requestDelete(plan)">
                  <i class="pi pi-trash" />
                </ElButton>
              </div>
            </div>
          </template>

          <h3 class="plan-card-title">{{ plan.metadata.name }}</h3>
          <div class="plan-time-row">
            <span class="plan-time-icon"><i class="pi pi-clock" /></span>
            <div>
              <span>{{ formatPlanDateTime(plan.metadata.startAt) }}</span>
              <i>至</i>
              <span>{{ formatPlanDateTime(plan.metadata.endAt) }}</span>
            </div>
          </div>
          <div class="plan-participants">
            <ElAvatar :size="26" class="participant-avatar"><i class="pi pi-users" /></ElAvatar>
            <template v-if="plan.metadata.participants.length">
              <ElTag v-for="person in plan.metadata.participants" :key="person.id" type="info" round effect="light" class="participant-chip">
                {{ person.name }}<span v-if="person.age != null"> · {{ person.age }} 岁</span>
              </ElTag>
            </template>
            <span v-else class="participant-empty">暂未填写参与人员</span>
          </div>
          <div v-if="planBudgetLimit(plan) != null" class="plan-budget-limit"><i class="pi pi-wallet" /><span>总预算</span><strong>{{ formatMoney(planBudgetLimit(plan)!) }}</strong></div>

          <template #footer>
            <div class="plan-card-footer">
              <span>最近编辑 {{ formatPlanDateTime(plan.metadata.updatedAt) }}</span>
              <strong>进入规划 <i class="pi pi-arrow-right" /></strong>
            </div>
          </template>
        </ElCard>
      </section>

      <section v-else class="home-empty-state">
        <div class="home-empty-icon"><i class="pi pi-map" /></div>
        <h3>还没有旅行计划</h3>
        <p>创建第一个计划，开始收集地点并安排路线。</p>
        <div class="home-empty-actions"><ElButton type="primary" @click="emit('create')"><i class="pi pi-plus" />新建旅行计划</ElButton><ElButton @click="emit('aiImport')"><i class="pi pi-sparkles" />AI 导入</ElButton><ElButton text @click="emit('openDemo')">查看川西示例</ElButton><ElButton v-if="store.recycleBin.length" text @click="emit('recycle')">打开回收站</ElButton></div>
      </section>
    </main>
  </div>
</template>

// 计划分享的状态管理：
// - mine：我分享出去的计划（每份带着"分享给了谁、什么权限"的列表）
// - sharedWithMe：别人分享给我的计划
// - openSharedPlan：把一份共享计划加载进当前正在运行的 planner store 里查看/
//   编辑，不会污染 plans.ts 自己的本地计划列表（打开期间把 plans.activePlanId
//   设成 null，plans.ts 自己的自动保存逻辑就不会误把共享计划写进本地列表）。
// - 编辑权限的共享计划，本地改动会防抖推送回服务器；只读权限的不会推送。
import { ref, watch } from 'vue'
import { defineStore } from 'pinia'
import {
  deleteSharedPlan,
  fetchSession,
  fetchSharedPlan,
  grantPlanShare,
  listMySharedPlans,
  listPlansSharedWithMe,
  pushSharedPlan,
  revokePlanShare,
  type EffectivePermission,
  type MySharedPlanSummary,
  type SharePermission,
  type SharedWithMePlanSummary,
} from '../auth/client'
import { pushSharedPlanNow, trackSharedPlanId, untrackSharedPlanId } from '../sharing/sharedPlanOwnerSync'
import { usePlannerStore } from './planner'
import { usePlansStore } from './plans'
import type { PlanRecord, RouteCache } from '../domain/types'
import { connectPlanCollab, disconnectPlanCollab } from '../collab/planCollab'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useSharedPlansStore = defineStore('sharedPlans', () => {
  const planner = usePlannerStore()
  const plansStore = usePlansStore()

  const mine = ref<MySharedPlanSummary[]>([])
  const sharedWithMe = ref<SharedWithMePlanSummary[]>([])

  const activeSharedPlanId = ref<number | null>(null)
  const activeSharedPlanPermission = ref<EffectivePermission | null>(null)
  const activeSharedPlanBase = ref<PlanRecord | null>(null)

  async function refreshMine(): Promise<void> {
    try {
      mine.value = await listMySharedPlans()
      mine.value.forEach((plan) => trackSharedPlanId(plan.clientPlanId, plan.id))
    } catch {
      // 拉取失败就保留上一次的结果，不打断界面
    }
  }

  async function refreshSharedWithMe(): Promise<void> {
    try {
      sharedWithMe.value = await listPlansSharedWithMe()
    } catch {
      // 同上
    }
  }

  function sharesFor(clientPlanId: string) {
    return mine.value.find((plan) => plan.clientPlanId === clientPlanId)?.shares ?? []
  }

  async function sharePlan(plan: PlanRecord, username: string, permission: SharePermission): Promise<void> {
    const { id } = await pushSharedPlanNow(plan)
    await grantPlanShare(id, username, permission)
    trackSharedPlanId(plan.metadata.id, id)
    await refreshMine()
  }

  async function revokeShare(sharedPlanId: number, userId: number): Promise<void> {
    await revokePlanShare(sharedPlanId, userId)
    await refreshMine()
  }

  async function stopSharing(sharedPlanId: number, clientPlanId: string): Promise<void> {
    await deleteSharedPlan(sharedPlanId)
    untrackSharedPlanId(clientPlanId)
    disconnectPlanCollab(sharedPlanId)
    await refreshMine()
  }

  let pushTimer = 0
  let pendingPush: (() => void) | null = null

  function scheduleActiveSharedPush(): void {
    if (!activeSharedPlanId.value || activeSharedPlanPermission.value !== 'edit' || !activeSharedPlanBase.value) return
    window.clearTimeout(pushTimer)
    const id = activeSharedPlanId.value
    const base = activeSharedPlanBase.value
    const run = (): void => {
      pendingPush = null
      const record: PlanRecord = {
        metadata: { ...base.metadata, updatedAt: new Date().toISOString() },
        plannerState: planner.exportState(),
        routeCache: clone(planner.routeCache) as RouteCache,
      }
      pushSharedPlan(id, record, record.metadata.name).catch(() => {
        // 推送失败（比如暂时离线）不打断编辑，下次变化时会自动再试
      })
    }
    pendingPush = run
    pushTimer = window.setTimeout(run, 1500)
  }

  watch(
    () => ({
      days: planner.days,
      selectedDay: planner.selectedDayId,
      selectedPlace: planner.selectedPlaceId,
      poolOpen: planner.poolOpen,
      satellite: planner.satellite,
      categoryFilter: planner.categoryFilter,
      known: planner.known,
      placeAddedAt: planner.placeAddedAt,
      places: planner.places,
      routeCache: planner.routeCache,
      budget: planner.budget,
    }),
    scheduleActiveSharedPush,
    { deep: true },
  )

  function flushPendingPush(): void {
    window.clearTimeout(pushTimer)
    if (pendingPush) {
      const run = pendingPush
      pendingPush = null
      run()
    }
  }

  function clearActiveSharedPlan(): void {
    flushPendingPush()
    if (activeSharedPlanId.value != null) disconnectPlanCollab(activeSharedPlanId.value)
    activeSharedPlanId.value = null
    activeSharedPlanPermission.value = null
    activeSharedPlanBase.value = null
    planner.setReadOnly(false)
  }

  watch(() => plansStore.view, (view) => {
    if (view !== 'planner' && activeSharedPlanId.value) clearActiveSharedPlan()
  })

  async function openSharedPlan(id: number): Promise<void> {
    const detail = await fetchSharedPlan(id)
    const record = detail.record as PlanRecord
    // 先清掉上一份共享计划的状态（防抖推送定时器、readOnly 标记等）再去
    // 加载新的一份：如果反过来做，loadState() 触发的 watch 回调会在
    // activeSharedPlanId 还没更新之前跑一次，可能把新计划的内容当成旧计划
    // 推送到错误的服务器地址去。当前界面流程走不到这一步（打开共享计划前
    // 一定会先回到主页，主页本身就会清空这份状态），这里是多一层保险。
    clearActiveSharedPlan()
    plansStore.activePlanId = null
    planner.loadState(clone(record.plannerState), clone(record.routeCache ?? {}))
    plansStore.view = 'planner'
    activeSharedPlanId.value = id
    activeSharedPlanPermission.value = detail.permission
    activeSharedPlanBase.value = record
    planner.setReadOnly(detail.permission === 'view')
    if (detail.permission === 'view') {
      planner.notify('这是共享给你的只读计划，你的修改不会被保存')
    }
    // 接入逐字实时协作：只读的人也接进来（能实时看到别人的修改），只是
    // 不会有本地输入往回写；真正的写入拦截在服务器那一侧按权限判断。
    fetchSession()
      .then((session) => {
        if (activeSharedPlanId.value === id) connectPlanCollab(id, session.username)
      })
      .catch(() => {
        // 拿不到用户名就不接入协作，不影响这份计划本身的查看/编辑
      })
  }

  return {
    mine,
    sharedWithMe,
    activeSharedPlanId,
    activeSharedPlanPermission,
    refreshMine,
    refreshSharedWithMe,
    sharesFor,
    sharePlan,
    revokeShare,
    stopSharing,
    openSharedPlan,
  }
})

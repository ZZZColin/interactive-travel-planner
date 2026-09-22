// 计划所有者一侧的"分享内容自动更新"：哪些本地计划已经分享出去了，记在
// 一个内存里的集合中（只在本次页面会话内有效，每次打开应用会由
// stores/sharedPlans.ts 重新拉一次分享列表来填充）。plans.ts 每次把某个
// 计划写进 localStorage 之后，都会调用 notifyPlanPersisted()：如果这个
// 计划在集合里，就防抖（1.5 秒）把最新快照推到服务器，这样被分享的人
// 打开时看到的就是最新内容。
//
// 这个文件故意不依赖 Pinia，只依赖 auth/client.ts——stores/plans.ts 和
// stores/sharedPlans.ts 都需要用到它，如果反过来放在某个 Pinia store 里，
// 两个 store 之间会出现循环引用。

import { deleteSharedPlan, upsertSharedPlanSnapshot } from '../auth/client'
import type { PlanRecord } from '../domain/types'

// clientPlanId -> 这个计划在服务器 shared_plans 表里的 id。记服务器 id
// 而不只是记"有没有分享"，是因为删除本地计划时要能顺带删掉服务器上那份
// 分享的快照（见 deleteSharedPlanIfTracked），DELETE /api/shared-plans/:id
// 要用这个数字 id，不是本地的字符串计划 id。
const trackedPlans = new Map<string, number>()
const pendingTimers = new Map<string, number>()

export function trackSharedPlanId(clientPlanId: string, sharedPlanId: number): void {
  trackedPlans.set(clientPlanId, sharedPlanId)
}

export function untrackSharedPlanId(clientPlanId: string): void {
  trackedPlans.delete(clientPlanId)
  const timer = pendingTimers.get(clientPlanId)
  if (timer) {
    window.clearTimeout(timer)
    pendingTimers.delete(clientPlanId)
  }
}

export function isTrackedSharedPlanId(clientPlanId: string): boolean {
  return trackedPlans.has(clientPlanId)
}

// 逐字实时协作要连的房间用的是服务器上 shared_plans 的数字 id，不是本地
// 计划 id，所以要把这个映射也暴露出去（plans.ts 打开自己已经分享出去的
// 计划时用得到）。
export function getTrackedSharedPlanId(clientPlanId: string): number | null {
  return trackedPlans.get(clientPlanId) ?? null
}

// plans.ts 每次把某个计划持久化之后调用。只有在这个计划已经被分享出去的
// 情况下才会真的发请求；没有被分享的计划完全不受影响。
export function notifyPlanPersisted(plan: PlanRecord): void {
  const id = plan.metadata.id
  if (!trackedPlans.has(id)) return
  const existing = pendingTimers.get(id)
  if (existing) window.clearTimeout(existing)
  const timer = window.setTimeout(() => {
    pendingTimers.delete(id)
    upsertSharedPlanSnapshot(id, plan.metadata.name, plan).catch(() => {
      // 推送失败（比如暂时离线）就算了，下次这个计划再变化时会自动重试
    })
  }, 1500)
  pendingTimers.set(id, timer)
}

// 立即（不等防抖）推一次，分享面板"分享"/"刷新分享内容"按钮用得到。
export function pushSharedPlanNow(plan: PlanRecord): Promise<{ id: number; updatedAt: string }> {
  const id = plan.metadata.id
  const timer = pendingTimers.get(id)
  if (timer) {
    window.clearTimeout(timer)
    pendingTimers.delete(id)
  }
  return upsertSharedPlanSnapshot(id, plan.metadata.name, plan)
}

// 本地删除一个计划时调用：如果这个计划之前分享出去过，把服务器上那份
// 分享的快照和所有授权也一起删掉——不然被分享的人会一直看到一份再也不会
// 更新的"僵尸"计划。没分享过的计划这里什么都不做。
export async function deleteSharedPlanIfTracked(clientPlanId: string): Promise<void> {
  const sharedPlanId = trackedPlans.get(clientPlanId)
  if (sharedPlanId == null) return
  untrackSharedPlanId(clientPlanId)
  await deleteSharedPlan(sharedPlanId)
}

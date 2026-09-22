// 全部计划跨设备同步的底层工具：记账 + 防抖推送。不依赖 Pinia（原因和
// sharedPlanOwnerSync.ts 一样：避免 store 之间循环引用），真正的"服务器和
// 本地谁的版本更新"合并逻辑放在 stores/plans.ts 的 syncWithServer() 里，
// 因为那部分需要直接读写 plans.value / recycleBin.value。
//
// 记账用两个时间戳，且故意不互相比较（服务器的 updated_at 是 SQLite
// datetime('now')，本地的 metadata.updatedAt 是浏览器 toISOString()，
// 两种格式、两个时钟，直接比较大小会因为时区解析不一致而出错）：
//   serverUpdatedAt      —— 上一次从服务器同步到的 updated_at（服务器格式）
//   pushedLocalUpdatedAt —— 上一次成功推送时，本地 metadata.updatedAt 是什么
// 合并时只做"服务器变了吗"（服务器格式 vs 服务器格式）和"本地变了吗"
// （本地格式 vs 本地格式）这两个同格式比较，不做跨格式比较。

import { pushSyncedPlan } from '../auth/client'
import type { PlanRecord } from '../domain/types'

const BOOKKEEPING_KEY = 'interactiveTravel.planSync.v1'

interface Bookkeeping {
  serverUpdatedAt: string
  pushedLocalUpdatedAt: string
}

function readAll(): Record<string, Bookkeeping> {
  try {
    return JSON.parse(localStorage.getItem(BOOKKEEPING_KEY) ?? '{}') as Record<string, Bookkeeping>
  } catch {
    return {}
  }
}

function writeAll(value: Record<string, Bookkeeping>): void {
  try {
    localStorage.setItem(BOOKKEEPING_KEY, JSON.stringify(value))
  } catch {
    // 存不进去就算了，最多下次多同步一次
  }
}

const pendingTimers = new Map<string, number>()

export function getBookkeeping(clientPlanId: string): Bookkeeping | null {
  return readAll()[clientPlanId] ?? null
}

export function recordServerAdopted(clientPlanId: string, serverUpdatedAt: string, localUpdatedAt: string): void {
  const all = readAll()
  all[clientPlanId] = { serverUpdatedAt, pushedLocalUpdatedAt: localUpdatedAt }
  writeAll(all)
}

export function forgetPlan(clientPlanId: string): void {
  const all = readAll()
  delete all[clientPlanId]
  writeAll(all)
  const timer = pendingTimers.get(clientPlanId)
  if (timer) {
    window.clearTimeout(timer)
    pendingTimers.delete(clientPlanId)
  }
}

// 立即推送（新建、重命名、恢复历史版本这类一次性动作用这个）。
export async function pushPlanNow(plan: PlanRecord): Promise<void> {
  const id = plan.metadata.id
  const timer = pendingTimers.get(id)
  if (timer) {
    window.clearTimeout(timer)
    pendingTimers.delete(id)
  }
  const { updatedAt } = await pushSyncedPlan(id, plan)
  recordServerAdopted(id, updatedAt, plan.metadata.updatedAt)
}

// 防抖推送（编辑过程中高频触发的自动保存用这个，避免拖拽、连续输入时
// 每一下都发请求）。
export function schedulePushPlan(plan: PlanRecord): void {
  const id = plan.metadata.id
  const existing = pendingTimers.get(id)
  if (existing) window.clearTimeout(existing)
  const timer = window.setTimeout(() => {
    pendingTimers.delete(id)
    pushPlanNow(plan).catch(() => {
      // 推送失败（比如暂时离线）不打断编辑，下次这个计划再变化，或者下一次
      // syncWithServer() 发现本地比服务器新时会自动重试
    })
  }, 1500)
  pendingTimers.set(id, timer)
}

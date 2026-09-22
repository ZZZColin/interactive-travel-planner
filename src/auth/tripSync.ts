// 旅行计划数据的服务器同步。
//
// 思路和 config/serviceConfigBackup 那一套一样：先把服务器上的数据写进
// localStorage，再让 planner store 去读——不需要等 Pinia 初始化。
// 唯一多出来的是"谁的数据更新"的判断：用一个本地时间戳标记
// （interactiveTravel.tripSync.syncedAt）记录"这台设备上一次成功同步到
// 服务器的是哪个版本"，避免这台设备上一份更旧的缓存把别的设备刚同步上去
// 的新数据覆盖掉。
//
// 这不是完整的多设备冲突合并——只是"比谁的时间戳新"，够用但不是万能：如果
// 两台设备完全离线的情况下分别编辑，后同步的会整份覆盖先同步的那份。

import { fetchTripData, pushTripData } from './client'

const PLANNER_KEY = 'interactiveTravel.continuousPlanner.v1'
const ROUTES_KEY = 'interactiveTravel.continuousRoutes.v1'
const SYNCED_AT_KEY = 'interactiveTravel.tripSync.syncedAt'

interface TripDataPayload {
  planner: unknown
  routes: unknown
}

function getSyncedAt(): string | null {
  try {
    return localStorage.getItem(SYNCED_AT_KEY)
  } catch {
    return null
  }
}

function setSyncedAt(value: string | undefined | null): void {
  if (!value) return
  try {
    localStorage.setItem(SYNCED_AT_KEY, value)
  } catch {
    // 存不进去就算了，最多下次多同步一次，不影响功能
  }
}

function readLocalPayload(): TripDataPayload {
  let planner: unknown = null
  let routes: unknown = null
  try {
    planner = JSON.parse(localStorage.getItem(PLANNER_KEY) ?? 'null')
  } catch {
    planner = null
  }
  try {
    routes = JSON.parse(localStorage.getItem(ROUTES_KEY) ?? 'null')
  } catch {
    routes = null
  }
  return { planner, routes }
}

// 登录成功、真正的 App（以及 planner store）挂载之前调用一次：
// - 服务器上的数据比本机这份新（或者本机从没同步过） → 直接覆盖本机的
//   两个 localStorage key，store 初始化时读到的就是新数据。
// - 本机这份不比服务器旧（说明上次编辑已经同步过，或者服务器还没有
//   任何数据） → 不覆盖本机；如果本机存在从未成功推送过的数据，顺带
//   补推一次，避免它一直卡在本地。
export async function hydrateTripDataFromServer(): Promise<void> {
  let response: { data: unknown; updatedAt: string | null }
  try {
    response = await fetchTripData()
  } catch {
    return
  }

  const { data, updatedAt } = response
  const localSyncedAt = getSyncedAt()

  if (data && updatedAt && (!localSyncedAt || updatedAt > localSyncedAt)) {
    const payload = data as Partial<TripDataPayload>
    if (payload.planner) localStorage.setItem(PLANNER_KEY, JSON.stringify(payload.planner))
    if (payload.routes) localStorage.setItem(ROUTES_KEY, JSON.stringify(payload.routes))
    setSyncedAt(updatedAt)
    return
  }

  if (!localSyncedAt) {
    const local = readLocalPayload()
    if (local.planner || local.routes) {
      try {
        const result = await pushTripData(local)
        setSyncedAt(result.updatedAt)
      } catch {
        // 推送失败就算了，等用户下次编辑触发防抖推送时会再试一次
      }
    }
  }
}

let pushTimer = 0

// 每次行程数据在本地变化（并写入 localStorage）之后调用，防抖约 1.5 秒
// 再推送到服务器，避免拖拽、连续输入这类高频操作每一下都发请求。
export function schedulePushTripData(): void {
  window.clearTimeout(pushTimer)
  pushTimer = window.setTimeout(() => {
    const payload = readLocalPayload()
    if (!payload.planner && !payload.routes) return
    pushTripData(payload)
      .then((result) => setSyncedAt(result.updatedAt))
      .catch(() => {
        // 推送失败（比如暂时断网）不打断编辑，下次变化时会自动再触发一次
      })
  }, 1500)
}

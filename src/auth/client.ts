import { isTauri } from '@tauri-apps/api/core'

// 桌面版（Tauri）是本地跑的独立应用，没有同源的后端可以打——网页版靠"和
// server/index.js 同源"这一点，相对路径 /api 就够用；桌面版必须先知道要连
// 哪台服务器，这个地址由用户在 ServerAddressGate 里手动填一次，存本地。
const SERVER_BASE_URL_KEY = 'interactiveTravel.desktop.serverBaseUrl'

export function getServerBaseUrl(): string {
  try {
    return localStorage.getItem(SERVER_BASE_URL_KEY) ?? ''
  } catch {
    return ''
  }
}

export function setServerBaseUrl(url: string): void {
  const normalized = url.trim().replace(/\/+$/, '')
  localStorage.setItem(SERVER_BASE_URL_KEY, normalized)
}

export function clearServerBaseUrl(): void {
  localStorage.removeItem(SERVER_BASE_URL_KEY)
}

function apiBase(): string {
  if (!isTauri()) return '/api'
  const base = getServerBaseUrl()
  return base ? `${base}/api` : '/api'
}

// 逐字实时协作用的 WebSocket 地址：跟上面 apiBase() 是同一套"服务器在哪"
// 的逻辑（网页版同源、桌面版用 ServerAddressGate 里配置的地址），只是把
// http(s) 换成 ws(s)，浏览器建立 WebSocket 连接时会自动带上同源/同站的
// cookie，不需要另外传 token。
export function collabWsUrl(path: string): string {
  if (!isTauri()) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${path}`
  }
  const base = getServerBaseUrl()
  if (!base) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${protocol}//${window.location.host}${path}`
  }
  return `${base.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:')}${path}`
}

export interface SessionInfo {
  username: string
  role: 'admin' | 'member'
  totpEnabled: boolean
}

export interface LoginResult {
  requiresTwoFactor?: boolean
  challengeId?: string
  username?: string
  role?: 'admin' | 'member'
}

export interface ServerConfigResponse {
  data: unknown
  updatedAt: string | null
}

export interface AdminUser {
  id: number
  username: string
  role: 'admin' | 'member'
  disabled: number
  totp_enabled: number
  created_at: string
}

export interface AuditLogEntry {
  id: number
  user_id: number | null
  username: string | null
  action: string
  detail: string | null
  ip: string | null
  user_agent: string | null
  created_at: string
}

export interface TwoFactorSetup {
  secret: string
  otpauthUrl: string
  qrCodeDataUrl: string
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${apiBase()}${path}`, {
    ...options,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new Error(body.error || `请求失败（HTTP ${response.status}）`)
  }
  return response.json() as Promise<T>
}

export function fetchSignupStatus(): Promise<{ allowSignup: boolean }> {
  return request('/signup-status')
}

export function register(username: string, password: string): Promise<{ ok: true }> {
  return request('/register', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export function login(username: string, password: string): Promise<LoginResult> {
  return request<LoginResult>('/login', { method: 'POST', body: JSON.stringify({ username, password }) })
}

export function verifyTwoFactor(challengeId: string, token: string): Promise<LoginResult> {
  return request<LoginResult>('/2fa/verify', { method: 'POST', body: JSON.stringify({ challengeId, token }) })
}

export function setupTwoFactor(): Promise<TwoFactorSetup> {
  return request('/2fa/setup', { method: 'POST' })
}

export function enableTwoFactor(token: string): Promise<{ recoveryCodes: string[] }> {
  return request('/2fa/enable', { method: 'POST', body: JSON.stringify({ token }) })
}

export function disableTwoFactor(password: string, token: string): Promise<void> {
  return request('/2fa/disable', { method: 'POST', body: JSON.stringify({ password, token }) })
}

export function logout(): Promise<void> {
  return request('/logout', { method: 'POST' })
}

export function fetchSession(): Promise<SessionInfo> {
  return request<SessionInfo>('/session')
}

export function fetchServerConfig(): Promise<ServerConfigResponse> {
  return request<ServerConfigResponse>('/config')
}

export function pushServerConfig(data: unknown): Promise<void> {
  return request('/config', { method: 'PUT', body: JSON.stringify(data) })
}

// ---------------------------------------------------------------------------
// 计划分享：把某一个本地计划（PlanRecord）分享给另一个账号，
// 可以选"只读"还是"可编辑"。
// ---------------------------------------------------------------------------

export type SharePermission = 'view' | 'edit'
export type EffectivePermission = 'owner' | SharePermission

export interface ShareGrant {
  userId: number
  username: string
  permission: SharePermission
}

export interface MySharedPlanSummary {
  id: number
  clientPlanId: string
  name: string
  updatedAt: string
  shares: ShareGrant[]
}

export interface SharedWithMePlanSummary {
  id: number
  name: string
  updatedAt: string
  permission: SharePermission
  ownerUsername: string
}

export interface SharedPlanDetail {
  id: number
  name: string
  record: unknown
  updatedAt: string
  permission: EffectivePermission
}

// owner 侧：把某个本地计划的最新快照 upsert 到服务器（分享时、以及之后每次
// 编辑该计划都会调用），按本地计划 id 去重，返回服务器上的分享计划 id。
export function upsertSharedPlanSnapshot(clientPlanId: string, name: string, record: unknown): Promise<{ id: number; updatedAt: string }> {
  return request('/shared-plans', { method: 'POST', body: JSON.stringify({ clientPlanId, name, record }) })
}

export function listMySharedPlans(): Promise<MySharedPlanSummary[]> {
  return request<{ plans: MySharedPlanSummary[] }>('/shared-plans/mine').then((res) => res.plans)
}

export function listPlansSharedWithMe(): Promise<SharedWithMePlanSummary[]> {
  return request<{ plans: SharedWithMePlanSummary[] }>('/shared-plans/shared-with-me').then((res) => res.plans)
}

export function fetchSharedPlan(id: number): Promise<SharedPlanDetail> {
  return request(`/shared-plans/${id}`)
}

export function pushSharedPlan(id: number, record: unknown, name?: string): Promise<{ ok: true; updatedAt: string }> {
  return request(`/shared-plans/${id}`, { method: 'PUT', body: JSON.stringify({ record, name }) })
}

export function deleteSharedPlan(id: number): Promise<void> {
  return request(`/shared-plans/${id}`, { method: 'DELETE' })
}

export function grantPlanShare(id: number, username: string, permission: SharePermission): Promise<void> {
  return request(`/shared-plans/${id}/shares`, { method: 'POST', body: JSON.stringify({ username, permission }) })
}

export function revokePlanShare(id: number, userId: number): Promise<void> {
  return request(`/shared-plans/${id}/shares/${userId}`, { method: 'DELETE' })
}

// ---------------------------------------------------------------------------
// 全部计划跨设备同步：把 stores/plans.ts 里的每一个计划都同步到服务器，
// 换设备/换浏览器登录同一账号能看到完整的计划列表。
// ---------------------------------------------------------------------------

export interface SyncedPlanRow {
  clientPlanId: string
  record: unknown
  deleted: boolean
  updatedAt: string
}

export function listSyncedPlans(): Promise<SyncedPlanRow[]> {
  return request<{ plans: SyncedPlanRow[] }>('/synced-plans').then((res) => res.plans)
}

export function pushSyncedPlan(clientPlanId: string, record: unknown): Promise<{ updatedAt: string }> {
  return request(`/synced-plans/${encodeURIComponent(clientPlanId)}`, { method: 'PUT', body: JSON.stringify({ record }) })
}

export function deleteSyncedPlan(clientPlanId: string): Promise<{ updatedAt: string }> {
  return request(`/synced-plans/${encodeURIComponent(clientPlanId)}`, { method: 'DELETE' })
}

export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request('/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
}

export function listUsers(): Promise<AdminUser[]> {
  return request<{ users: AdminUser[] }>('/admin/users').then((res) => res.users)
}

export function createUser(username: string, password: string, role: 'admin' | 'member'): Promise<{ id: number }> {
  return request('/admin/users', { method: 'POST', body: JSON.stringify({ username, password, role }) })
}

export function updateUser(
  id: number,
  patch: { disabled?: boolean; role?: 'admin' | 'member'; newPassword?: string; resetTwoFactor?: boolean },
): Promise<void> {
  return request(`/admin/users/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
}

export function deleteUser(id: number): Promise<void> {
  return request(`/admin/users/${id}`, { method: 'DELETE' })
}

export function fetchAuditLog(): Promise<AuditLogEntry[]> {
  return request<{ entries: AuditLogEntry[] }>('/admin/audit-log').then((res) => res.entries)
}

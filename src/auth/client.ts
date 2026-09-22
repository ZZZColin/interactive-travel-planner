const API_BASE = '/api'

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
  const response = await fetch(`${API_BASE}${path}`, {
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

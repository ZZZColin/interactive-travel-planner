import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import bcrypt from 'bcryptjs'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { authenticator } from 'otplib'
import QRCode from 'qrcode'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DATA_DIR = process.env.DATA_DIR || '/data'
const DB_PATH = path.join(DATA_DIR, 'trippath.db')
const STATIC_DIR = process.env.STATIC_DIR || path.join(__dirname, 'public')
const ADMIN_USERNAME = process.env.ADMIN_USERNAME
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
const PORT = Number(process.env.PORT || 3000)
const COOKIE_NAME = 'trippath_session'
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true'
const ALLOW_SIGNUP = process.env.ALLOW_SIGNUP === 'true'
// 前端和 API 现在是同一个服务、同一个源，正常情况下不需要跨域，留空即可。
// 只有本地开发时前端单独跑 vite dev server（另一个端口）才需要设置这个。
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || ''
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 天
const TWO_FACTOR_CHALLENGE_TTL_MS = 5 * 60 * 1000 // 5 分钟
const MAX_FAILED_ATTEMPTS = 5
const LOCKOUT_MS = 15 * 60 * 1000 // 15 分钟

authenticator.options = { window: 1 } // 允许 ±1 个时间步长的时钟误差

fs.mkdirSync(DATA_DIR, { recursive: true })
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    disabled INTEGER NOT NULL DEFAULT 0,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    totp_secret TEXT,
    totp_pending_secret TEXT,
    totp_enabled INTEGER NOT NULL DEFAULT 0,
    recovery_codes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    user_agent TEXT,
    ip TEXT
  );
  CREATE TABLE IF NOT EXISTS two_factor_challenges (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS configs (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    username TEXT,
    action TEXT NOT NULL,
    detail TEXT,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`)

// 给旧版本数据库补列，已存在时安静忽略（SQLite 没有 ADD COLUMN IF NOT EXISTS）
for (const statement of [
  "ALTER TABLE users ADD COLUMN totp_secret TEXT",
  "ALTER TABLE users ADD COLUMN totp_pending_secret TEXT",
  "ALTER TABLE users ADD COLUMN totp_enabled INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE users ADD COLUMN recovery_codes TEXT",
]) {
  try { db.exec(statement) } catch { /* 列已存在，忽略 */ }
}

function ensureBootstrapAdmin() {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM users').get()
  if (existing.count > 0) return
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn('数据库里还没有用户，且未设置 ADMIN_USERNAME / ADMIN_PASSWORD 环境变量，无法自动创建管理员账号')
    return
  }
  const hash = bcrypt.hashSync(ADMIN_PASSWORD, 12)
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(ADMIN_USERNAME, hash, 'admin')
  console.log(`已创建初始管理员账号：${ADMIN_USERNAME}`)
}
ensureBootstrapAdmin()

// 定期清理过期的两步验证临时挑战记录
setInterval(() => {
  db.prepare('DELETE FROM two_factor_challenges WHERE expires_at < ?').run(new Date().toISOString())
}, 10 * 60 * 1000)

const app = express()
app.set('trust proxy', 1)
// 注意：这里必须关掉 helmet 默认的 Content-Security-Policy。
// 这个服务现在同时托管前端页面本身，helmet 默认 CSP 是 default-src 'self'，
// 会连带把 connect-src / script-src 也限制成只能同源。但这个应用的核心功能就是
// 从浏览器直接连高德/腾讯/Google/Mapbox/OpenAI/Anthropic 等一堆用户自己配置的
// 第三方地址，且 Google Maps 是靠动态插入 <script src="https://maps.googleapis.com/...">
// 加载的——这些在默认 CSP 下会被浏览器直接拦掉，地图和 AI 功能会整体失效。
// helmet 其余的安全头（X-Content-Type-Options、X-Frame-Options 等）继续保留。
app.use(helmet({ contentSecurityPolicy: false }))
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())
app.use(cors(ALLOWED_ORIGIN ? { origin: ALLOWED_ORIGIN, credentials: true } : { origin: false }))

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '尝试次数过多，请稍后再试' },
})

function isUsernameValid(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_.-]{3,32}$/.test(value)
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function logAudit(req, action, detail, user) {
  db.prepare('INSERT INTO audit_log (user_id, username, action, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(user?.id ?? null, user?.username ?? null, action, detail ?? null, req.ip, req.headers['user-agent'] ?? '')
}

function createSession(user, req) {
  const rawToken = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashToken(rawToken)
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString()
  db.prepare('INSERT INTO sessions (id, user_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)')
    .run(tokenHash, user.id, expiresAt, req.headers['user-agent'] ?? '', req.ip)
  return rawToken
}

function setSessionCookie(res, rawToken) {
  res.cookie(COOKIE_NAME, rawToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: COOKIE_SECURE,
    path: '/',
    maxAge: SESSION_TTL_MS,
  })
}

function destroySession(rawToken) {
  if (!rawToken) return
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(rawToken))
}

function destroyAllSessionsForUser(userId) {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
}

function authMiddleware(req, res, next) {
  const rawToken = req.cookies?.[COOKIE_NAME]
  if (!rawToken) return res.status(401).json({ error: '未登录' })
  const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(hashToken(rawToken))
  if (!session || new Date(session.expires_at).getTime() < Date.now()) {
    if (session) db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id)
    return res.status(401).json({ error: '登录已过期，请重新登录' })
  }
  const user = db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(session.user_id)
  if (!user || user.disabled) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(session.id)
    return res.status(401).json({ error: '账号不可用' })
  }
  req.user = user
  next()
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' })
  next()
}

// ---------------------------------------------------------------------------
// 注册 / 登录状态
// ---------------------------------------------------------------------------

app.get('/api/signup-status', (req, res) => {
  res.json({ allowSignup: ALLOW_SIGNUP })
})

app.post('/api/register', authLimiter, (req, res) => {
  if (!ALLOW_SIGNUP) return res.status(403).json({ error: '当前未开放注册' })
  const { username, password } = req.body ?? {}
  if (!isUsernameValid(username)) return res.status(400).json({ error: '用户名需为 3-32 位字母、数字、下划线、点或横线' })
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: '密码至少需要 8 位' })
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) return res.status(409).json({ error: '用户名已被占用' })
  const hash = bcrypt.hashSync(password, 12)
  db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, 'member')
  logAudit(req, 'register', null, { username })
  res.json({ ok: true })
})

app.post('/api/login', authLimiter, (req, res) => {
  const { username, password } = req.body ?? {}
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' })
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username)
  if (!user) {
    logAudit(req, 'login_failed', '用户名不存在', { username })
    return res.status(401).json({ error: '用户名或密码不正确' })
  }
  if (user.disabled) {
    logAudit(req, 'login_failed', '账号已禁用', user)
    return res.status(403).json({ error: '账号已被禁用' })
  }
  if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
    logAudit(req, 'login_blocked', '账号锁定中', user)
    return res.status(423).json({ error: '登录失败次数过多，账号已临时锁定，请稍后再试' })
  }
  const passwordOk = bcrypt.compareSync(password, user.password_hash)
  if (!passwordOk) {
    const failedAttempts = user.failed_attempts + 1
    const lockedUntil = failedAttempts >= MAX_FAILED_ATTEMPTS ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null
    db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?').run(failedAttempts, lockedUntil, user.id)
    logAudit(req, 'login_failed', '密码错误', user)
    return res.status(401).json({ error: '用户名或密码不正确' })
  }
  db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(user.id)

  if (user.totp_enabled) {
    const challengeId = crypto.randomBytes(24).toString('hex')
    const expiresAt = new Date(Date.now() + TWO_FACTOR_CHALLENGE_TTL_MS).toISOString()
    db.prepare('INSERT INTO two_factor_challenges (id, user_id, expires_at) VALUES (?, ?, ?)').run(challengeId, user.id, expiresAt)
    logAudit(req, 'login_awaiting_2fa', null, user)
    return res.json({ requiresTwoFactor: true, challengeId })
  }

  const rawToken = createSession(user, req)
  setSessionCookie(res, rawToken)
  logAudit(req, 'login_success', null, user)
  res.json({ username: user.username, role: user.role })
})

app.post('/api/2fa/verify', authLimiter, (req, res) => {
  const { challengeId, token } = req.body ?? {}
  const challenge = challengeId ? db.prepare('SELECT * FROM two_factor_challenges WHERE id = ?').get(challengeId) : null
  if (!challenge || new Date(challenge.expires_at).getTime() < Date.now()) {
    if (challenge) db.prepare('DELETE FROM two_factor_challenges WHERE id = ?').run(challenge.id)
    return res.status(401).json({ error: '验证已过期，请重新登录' })
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(challenge.user_id)
  if (!user) return res.status(401).json({ error: '账号不存在' })

  let ok = user.totp_secret ? authenticator.verify({ token: String(token ?? ''), secret: user.totp_secret }) : false
  let usedRecoveryCode = false
  if (!ok && user.recovery_codes) {
    const codes = JSON.parse(user.recovery_codes)
    const matchIndex = codes.findIndex((hash) => bcrypt.compareSync(String(token ?? ''), hash))
    if (matchIndex >= 0) {
      ok = true
      usedRecoveryCode = true
      codes.splice(matchIndex, 1)
      db.prepare('UPDATE users SET recovery_codes = ? WHERE id = ?').run(JSON.stringify(codes), user.id)
    }
  }
  if (!ok) {
    logAudit(req, 'login_2fa_failed', null, user)
    return res.status(401).json({ error: '验证码不正确' })
  }
  db.prepare('DELETE FROM two_factor_challenges WHERE id = ?').run(challenge.id)
  const rawToken = createSession(user, req)
  setSessionCookie(res, rawToken)
  logAudit(req, usedRecoveryCode ? 'login_success_recovery_code' : 'login_success', null, user)
  res.json({ username: user.username, role: user.role })
})

app.post('/api/logout', (req, res) => {
  const rawToken = req.cookies?.[COOKIE_NAME]
  if (rawToken) {
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(hashToken(rawToken))
    if (session) {
      const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(session.user_id)
      if (user) logAudit(req, 'logout', null, user)
    }
  }
  destroySession(rawToken)
  res.clearCookie(COOKIE_NAME, { path: '/' })
  res.json({ ok: true })
})

app.get('/api/session', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT totp_enabled FROM users WHERE id = ?').get(req.user.id)
  res.json({ username: req.user.username, role: req.user.role, totpEnabled: Boolean(row?.totp_enabled) })
})

// ---------------------------------------------------------------------------
// 两步验证（TOTP）
// ---------------------------------------------------------------------------

app.post('/api/2fa/setup', authMiddleware, async (req, res) => {
  const secret = authenticator.generateSecret()
  db.prepare('UPDATE users SET totp_pending_secret = ? WHERE id = ?').run(secret, req.user.id)
  const otpauthUrl = authenticator.keyuri(req.user.username, 'TripPath', secret)
  try {
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)
    res.json({ secret, otpauthUrl, qrCodeDataUrl })
  } catch {
    res.status(500).json({ error: '生成二维码失败' })
  }
})

app.post('/api/2fa/enable', authMiddleware, (req, res) => {
  const { token } = req.body ?? {}
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!user.totp_pending_secret) return res.status(400).json({ error: '请先发起两步验证设置' })
  const valid = authenticator.verify({ token: String(token ?? ''), secret: user.totp_pending_secret })
  if (!valid) return res.status(400).json({ error: '验证码不正确' })
  const recoveryCodes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex'))
  const hashedCodes = recoveryCodes.map((code) => bcrypt.hashSync(code, 10))
  db.prepare('UPDATE users SET totp_secret = ?, totp_enabled = 1, totp_pending_secret = NULL, recovery_codes = ? WHERE id = ?')
    .run(user.totp_pending_secret, JSON.stringify(hashedCodes), user.id)
  logAudit(req, 'totp_enabled', null, req.user)
  res.json({ recoveryCodes })
})

app.post('/api/2fa/disable', authMiddleware, (req, res) => {
  const { password, token } = req.body ?? {}
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!bcrypt.compareSync(password ?? '', user.password_hash)) return res.status(401).json({ error: '密码不正确' })
  if (!user.totp_enabled) return res.status(400).json({ error: '尚未启用两步验证' })

  // 除了当前验证码，也接受一个未用过的恢复码——手机丢了、拿不到验证码时，
  // 用户仍然应该能凭恢复码自己关掉两步验证，而不必找管理员强制重置。
  let valid = user.totp_secret ? authenticator.verify({ token: String(token ?? ''), secret: user.totp_secret }) : false
  if (!valid && user.recovery_codes) {
    const codes = JSON.parse(user.recovery_codes)
    valid = codes.some((hash) => bcrypt.compareSync(String(token ?? ''), hash))
  }
  if (!valid) return res.status(400).json({ error: '验证码不正确' })
  db.prepare('UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = 0, recovery_codes = NULL WHERE id = ?').run(user.id)
  logAudit(req, 'totp_disabled', null, req.user)
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// 服务配置（地图 / 天气 / AI Key 等）
// ---------------------------------------------------------------------------

app.get('/api/config', authMiddleware, (req, res) => {
  const row = db.prepare('SELECT data, updated_at FROM configs WHERE user_id = ?').get(req.user.id)
  if (!row) return res.json({ data: null, updatedAt: null })
  res.json({ data: JSON.parse(row.data), updatedAt: row.updated_at })
})

app.put('/api/config', authMiddleware, (req, res) => {
  const data = req.body
  if (!data || typeof data !== 'object') return res.status(400).json({ error: '配置内容不合法' })
  const json = JSON.stringify(data)
  db.prepare(`
    INSERT INTO configs (user_id, data, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
  `).run(req.user.id, json)
  res.json({ ok: true })
})

app.post('/api/change-password', authMiddleware, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {}
  if (!currentPassword || typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: '新密码至少需要 8 位' })
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: '当前密码不正确' })
  }
  const hash = bcrypt.hashSync(newPassword, 12)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
  destroyAllSessionsForUser(user.id)
  const rawToken = createSession({ id: user.id }, req)
  setSessionCookie(res, rawToken)
  logAudit(req, 'password_changed', null, req.user)
  res.json({ ok: true })
})

// ---------------------------------------------------------------------------
// 管理员：用户管理 + 审计日志
// ---------------------------------------------------------------------------

app.get('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, username, role, disabled, totp_enabled, created_at FROM users ORDER BY id').all()
  res.json({ users })
})

app.post('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  const { username, password, role } = req.body ?? {}
  if (!isUsernameValid(username)) return res.status(400).json({ error: '用户名需为 3-32 位字母、数字、下划线、点或横线' })
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: '密码至少需要 8 位' })
  const normalizedRole = role === 'admin' ? 'admin' : 'member'
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username)
  if (existing) return res.status(409).json({ error: '用户名已被占用' })
  const hash = bcrypt.hashSync(password, 12)
  const info = db.prepare('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)').run(username, hash, normalizedRole)
  logAudit(req, 'admin_user_created', `创建用户 ${username}（${normalizedRole}）`, req.user)
  res.json({ id: info.lastInsertRowid })
})

app.patch('/api/admin/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id)
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)
  if (!target) return res.status(404).json({ error: '用户不存在' })
  const { disabled, role, newPassword, resetTwoFactor } = req.body ?? {}

  if (typeof disabled === 'boolean') {
    if (targetId === req.user.id && disabled) return res.status(400).json({ error: '不能禁用自己当前登录的账号' })
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, targetId)
    if (disabled) destroyAllSessionsForUser(targetId)
    logAudit(req, 'admin_user_updated', `${disabled ? '禁用' : '启用'} ${target.username}`, req.user)
  }

  if (role === 'admin' || role === 'member') {
    if (targetId === req.user.id && role !== 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count
      if (adminCount <= 1) return res.status(400).json({ error: '至少需要保留一个管理员账号' })
    }
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, targetId)
    logAudit(req, 'admin_user_updated', `将 ${target.username} 的角色改为 ${role}`, req.user)
  }

  if (typeof newPassword === 'string') {
    if (newPassword.length < 8) return res.status(400).json({ error: '新密码至少需要 8 位' })
    const hash = bcrypt.hashSync(newPassword, 12)
    db.prepare('UPDATE users SET password_hash = ?, failed_attempts = 0, locked_until = NULL WHERE id = ?').run(hash, targetId)
    destroyAllSessionsForUser(targetId)
    logAudit(req, 'admin_user_updated', `重置了 ${target.username} 的密码`, req.user)
    // 管理员给自己重置密码时，上面这行会把自己当前这个会话也一起清掉；
    // 这里立刻重发一个新的会话 cookie，避免这次请求成功之后自己却被瞬间登出。
    if (targetId === req.user.id) setSessionCookie(res, createSession(req.user, req))
  }

  if (resetTwoFactor === true) {
    // 给账号被锁在外面的用户（手机和恢复码都没了）一条不用直接改数据库的救急路径：
    // 管理员帮忙关掉两步验证，用户重新登录后可以自己再设置一遍。
    db.prepare('UPDATE users SET totp_secret = NULL, totp_pending_secret = NULL, totp_enabled = 0, recovery_codes = NULL WHERE id = ?').run(targetId)
    logAudit(req, 'admin_user_updated', `管理员重置了 ${target.username} 的两步验证`, req.user)
  }

  res.json({ ok: true })
})

app.delete('/api/admin/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const targetId = Number(req.params.id)
  if (targetId === req.user.id) return res.status(400).json({ error: '不能删除自己当前登录的账号' })
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId)
  if (!target) return res.status(404).json({ error: '用户不存在' })
  if (target.role === 'admin') {
    const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get().count
    if (adminCount <= 1) return res.status(400).json({ error: '至少需要保留一个管理员账号' })
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId)
  logAudit(req, 'admin_user_deleted', `删除用户 ${target.username}`, req.user)
  res.json({ ok: true })
})

app.get('/api/admin/audit-log', authMiddleware, requireAdmin, (req, res) => {
  const limit = Math.min(500, Number(req.query.limit) || 200)
  const entries = db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT ?').all(limit)
  res.json({ entries })
})

// ---------------------------------------------------------------------------
// 静态前端文件（同一个服务里直接托管 Vite 构建产物，不再需要单独的 nginx 容器）
// ---------------------------------------------------------------------------

app.use(express.static(STATIC_DIR, {
  maxAge: '30d',
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
  },
}))

// SPA 兜底：除了 /api/* 之外的所有 GET 请求都返回 index.html
app.get(/^(?!\/api\/).*/, (req, res) => {
  res.sendFile(path.join(STATIC_DIR, 'index.html'))
})

app.listen(PORT, () => console.log(`TripPath 服务已启动，监听端口 ${PORT}（前端 + API 同一个进程）`))

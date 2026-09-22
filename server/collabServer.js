// 逐字实时协作：一个共享计划一个"房间"，房间里所有人共用一份 Yjs 文档
// （Y.Doc），文档里目前只放最容易被两个人同时打字的那几类文本字段
// （计划名、每位参与人员的姓名/备注），用 Y.Text 表示，靠 Yjs 的 CRDT
// 算法按字符合并并发编辑，而不是"谁后保存谁的版本生效"。
//
// 这一层是叠加在已有的"整份计划快照防抖推送/拉取"同步机制之上的，不是
// 替换它：结构性的改动（增删日期、增删 stop、预算等）继续走原来那一套；
// 这里只负责让"正在同时看着同一个计划的人"打字时能实时看到彼此的字符级
// 修改。房间本身也会定期把 Yjs 文档状态存进 collab_docs 表，服务器重启
// 或者所有人都断开后再重新连上时能接着用。
//
// 协议用的是 yjs 生态标准的 y-protocols/sync + y-protocols/awareness，
// 消息格式和 y-websocket 保持一致（第一个 varUint 是消息大类：0=同步，
// 1=在线状态），这里没有直接依赖 y-websocket 这个包，是因为要在收到写入
// 类消息（SyncStep2 / Update）时先检查这条连接有没有编辑权限——只读权限
// 的连接仍然可以正常收到别人的更新，但它自己发上来的编辑会被服务器直接
// 丢弃、不应用也不转发，这样"只读"是在协议层面强制的，不是只靠前端把
// 输入框禁用。
import { WebSocketServer } from 'ws'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'

const messageSync = 0
const messageAwareness = 1
const SAVE_DEBOUNCE_MS = 2000
const COLLAB_PATH = '/collab'

// shared_plans.id -> 房间。跟分享功能用的是同一个 id，owner 和被分享的人
// 打开同一份计划时会连进同一个房间。
const rooms = new Map()

function parseCookie(header, name) {
  if (!header) return null
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(data)
    } catch {
      // 发送失败（连接刚好在这一刻断开）忽略，close 事件会负责清理
    }
  }
}

function seedField(fields, key, text) {
  if (fields.has(key)) return
  const ytext = new Y.Text()
  if (text) ytext.insert(0, String(text))
  fields.set(key, ytext)
}

function persistRoom(db, sharedPlanId, doc) {
  const state = Y.encodeStateAsUpdate(doc)
  db.prepare(`
    INSERT INTO collab_docs (shared_plan_id, state, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(shared_plan_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
  `).run(sharedPlanId, state)
}

function loadOrCreateRoom(db, sharedPlanId) {
  const existing = rooms.get(sharedPlanId)
  if (existing) return existing

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  const fields = doc.getMap('fields')

  const savedRow = db.prepare('SELECT state FROM collab_docs WHERE shared_plan_id = ?').get(sharedPlanId)
  if (savedRow) {
    Y.applyUpdate(doc, savedRow.state, 'persistence')
  } else {
    // 房间第一次被创建（服务器重启后，或者这份计划从来没人协作编辑过）：
    // 用分享快照里现有的计划名和每位参与人员的姓名/备注给对应字段打底，
    // 这样刚连进来的人看到的是这份计划目前真实的内容，不是一片空白。
    // 注意：Stop 本身没有名称/备注字段（行程里显示的名字来自它关联的
    // Place），能安全地按字符协作编辑的现成文本字段目前是计划名
    // （PlanMetadata.name）和参与人员的姓名/备注（TripParticipant.name /
    // .note，在 PlanMetadata.participants 里，不在 plannerState 里）。
    const planRow = db.prepare('SELECT name, record FROM shared_plans WHERE id = ?').get(sharedPlanId)
    if (planRow) {
      seedField(fields, 'planName', planRow.name ?? '')
      let record = null
      try {
        record = JSON.parse(planRow.record)
      } catch {
        record = null
      }
      const participants = record?.metadata?.participants
      if (Array.isArray(participants)) {
        for (const person of participants) {
          if (!person?.id) continue
          seedField(fields, `participantName:${person.id}`, person.name ?? '')
          seedField(fields, `participantNote:${person.id}`, person.note ?? '')
        }
      }
    }
  }

  function scheduleSave() {
    if (room.saveTimer) return
    room.saveTimer = setTimeout(() => {
      room.saveTimer = null
      persistRoom(db, sharedPlanId, doc)
    }, SAVE_DEBOUNCE_MS)
  }

  const room = { doc, awareness, connections: new Set(), saveTimer: null }
  doc.on('update', scheduleSave)
  rooms.set(sharedPlanId, room)
  return room
}

function closeRoomIfEmpty(db, sharedPlanId) {
  const room = rooms.get(sharedPlanId)
  if (!room || room.connections.size > 0) return
  // 没人连着了：先取消还没触发的防抖保存定时器（不然它之后会用一个已经
  // destroy() 掉的 doc 去编码，拿到垃圾数据，把这次立即保存的正确结果
  // 又覆盖掉），再立刻存一次盘，然后把这个房间从内存里释放掉；下次有人
  // 连进来时会从数据库里重新加载，不会丢内容。
  if (room.saveTimer) {
    clearTimeout(room.saveTimer)
    room.saveTimer = null
  }
  persistRoom(db, sharedPlanId, room.doc)
  room.doc.destroy()
  rooms.delete(sharedPlanId)
}

// 优雅关闭（收到 SIGTERM/SIGINT，比如容器重新部署）时调用：把所有还开着
// 的协作房间立刻存一次盘，不用等各自的防抖定时器。不这么做的话，进程被
// 直接杀掉时，最多可能丢失 SAVE_DEBOUNCE_MS（2 秒）之内还没来得及落盘的
// 协作编辑——虽然这些编辑其实也已经通过 WebSocket 广播给了当时在线的其他
// 协作者，不算真正丢数据，但如果这些人也恰好在这个时间点全断线重连，
// 房间会从数据库里的旧状态重新加载，体验上像是"我刚打的字不见了"。
export function flushAllRooms(db) {
  for (const [sharedPlanId, room] of rooms) {
    if (room.saveTimer) {
      clearTimeout(room.saveTimer)
      room.saveTimer = null
    }
    try {
      persistRoom(db, sharedPlanId, room.doc)
    } catch (error) {
      console.error(`协作房间 ${sharedPlanId} 优雅关闭时保存失败`, error)
    }
  }
}

// server: http.Server 实例（跟 Express app 共用同一个端口）
// db: better-sqlite3 实例
// deps.hashToken: server/index.js 里已有的会话 token 哈希函数，复用同一套
//   会话验证逻辑，避免维护两份
export function attachCollabServer(server, db, { hashToken }) {
  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    let url
    try {
      url = new URL(req.url, 'http://internal')
    } catch {
      socket.destroy()
      return
    }
    if (url.pathname !== COLLAB_PATH) {
      // 这个应用里目前只有协作用到 WebSocket，不认识的路径直接拒绝
      socket.destroy()
      return
    }

    const rawToken = parseCookie(req.headers.cookie, 'trippath_session')
    const session = rawToken ? db.prepare('SELECT * FROM sessions WHERE id = ?').get(hashToken(rawToken)) : null
    if (!session || new Date(session.expires_at).getTime() < Date.now()) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }
    const user = db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(session.user_id)
    if (!user || user.disabled) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
      socket.destroy()
      return
    }

    const sharedPlanId = Number(url.searchParams.get('planId'))
    if (!Number.isInteger(sharedPlanId) || sharedPlanId <= 0) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n')
      socket.destroy()
      return
    }
    const planRow = db.prepare('SELECT owner_id FROM shared_plans WHERE id = ?').get(sharedPlanId)
    if (!planRow) {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n')
      socket.destroy()
      return
    }
    let canWrite = planRow.owner_id === user.id
    if (!canWrite) {
      const share = db.prepare('SELECT permission FROM plan_shares WHERE shared_plan_id = ? AND user_id = ?').get(sharedPlanId, user.id)
      if (!share) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n')
        socket.destroy()
        return
      }
      canWrite = share.permission === 'edit'
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, { sharedPlanId, canWrite, username: user.username })
    })
  })

  wss.on('connection', (ws, _req, ctx) => {
    const { sharedPlanId, canWrite } = ctx
    const room = loadOrCreateRoom(db, sharedPlanId)
    room.connections.add(ws)
    ws.awarenessClientIds = new Set()

    // 新连接先发一次 SyncStep1（带上自己——也就是空文档——的状态向量），
    // 房间的公共文档收到后该怎么回是客户端的事；这里服务器扮演的角色是
    // "文档的持有方"，直接把当前完整状态用 SyncStep2 发过去。
    const syncEncoder = encoding.createEncoder()
    encoding.writeVarUint(syncEncoder, messageSync)
    syncProtocol.writeSyncStep1(syncEncoder, room.doc)
    send(ws, encoding.toUint8Array(syncEncoder))

    const currentAwarenessStates = room.awareness.getStates()
    if (currentAwarenessStates.size > 0) {
      const awEncoder = encoding.createEncoder()
      encoding.writeVarUint(awEncoder, messageAwareness)
      encoding.writeVarUint8Array(awEncoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(currentAwarenessStates.keys())))
      send(ws, encoding.toUint8Array(awEncoder))
    }

    function onDocUpdate(update, origin) {
      if (origin === ws) return // 别把这条连接自己发来的更新再回发给它
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageSync)
      syncProtocol.writeUpdate(encoder, update)
      send(ws, encoding.toUint8Array(encoder))
    }
    room.doc.on('update', onDocUpdate)

    function onAwarenessUpdate(changes, origin) {
      const changedIds = changes.added.concat(changes.updated, changes.removed)
      if (origin === ws) {
        // 这条连接自己报告的在线状态变化：记下它带来的 clientId，
        // 方便这条连接断开时知道该清理谁的在线状态
        changes.added.concat(changes.updated).forEach((id) => ws.awarenessClientIds.add(id))
        changes.removed.forEach((id) => ws.awarenessClientIds.delete(id))
        return // 不用回发给它自己
      }
      if (!changedIds.length) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, messageAwareness)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, changedIds))
      send(ws, encoding.toUint8Array(encoder))
    }
    room.awareness.on('update', onAwarenessUpdate)

    ws.on('message', (data) => {
      try {
        const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        const decoder = decoding.createDecoder(buffer)
        const messageType = decoding.readVarUint(decoder)
        if (messageType === messageSync) {
          const innerType = decoding.readVarUint(decoder)
          if (innerType === syncProtocol.messageYjsSyncStep1) {
            const encoder = encoding.createEncoder()
            encoding.writeVarUint(encoder, messageSync)
            syncProtocol.readSyncStep1(decoder, encoder, room.doc)
            send(ws, encoding.toUint8Array(encoder))
          } else if (innerType === syncProtocol.messageYjsSyncStep2 || innerType === syncProtocol.messageYjsUpdate) {
            if (canWrite) {
              syncProtocol.readUpdate(decoder, room.doc, ws)
            } else {
              // 只读连接：这段内容必须从缓冲区里消费掉（不然下一条消息会
              // 解析错位），但不应用到文档、也不转发给别人
              decoding.readVarUint8Array(decoder)
            }
          }
        } else if (messageType === messageAwareness) {
          // 在线状态（光标、用户名之类）跟编辑权限无关，只读的人也可以
          // 广播"我在看这份计划"
          awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), ws)
        }
      } catch (error) {
        console.error('协作连接的消息解析失败，断开这条连接', error)
        ws.close()
      }
    })

    ws.on('close', () => {
      room.doc.off('update', onDocUpdate)
      room.awareness.off('update', onAwarenessUpdate)
      room.connections.delete(ws)
      if (ws.awarenessClientIds.size > 0) {
        awarenessProtocol.removeAwarenessStates(room.awareness, Array.from(ws.awarenessClientIds), ws)
      }
      closeRoomIfEmpty(db, sharedPlanId)
    })

    ws.on('error', () => {
      // close 事件之后一定还会触发，这里不用重复清理
    })
    // "有没有编辑权限"这条信息，前端在建立这条连接之前已经从
    // GET /api/shared-plans/:id 的 permission 字段拿到了，协议里不用
    // 再单独发一次；这里的 canWrite 只用来决定要不要应用/转发这条连接
    // 发来的写入类消息。
  })

  return wss
}

// 逐字实时协作的客户端一侧：连服务器的 /collab 房间（房间 = 某个共享计划
// 的服务器数字 id），维护一份跟房间共用的 Yjs 文档（Y.Doc），文档变化会
// 自动通过 WebSocket 跟服务器、进而跟房间里其他人同步。
//
// 这个文件故意不依赖 Pinia（跟 sharing/sharedPlanOwnerSync.ts、
// sync/allPlansSync.ts 是同一个原因）：stores/plans.ts（计划所有者自己
// 打开自己已分享出去的计划时）和 stores/sharedPlans.ts（别人打开被分享
// 给自己的计划时）都需要用到它，两边都是 Pinia store，放在某一个 store
// 里会导致循环引用。
//
// 协议实现细节和权限校验都在服务器那一侧（server/collabServer.js）；这里
// 只管建连接、收发消息、维护本地这份 Y.Doc 和 Awareness。协议格式必须和
// 服务器保持一致：外层第一个 varUint 是消息大类（0=同步，1=在线状态）。
import { ref, shallowRef, type Ref } from 'vue'
import * as Y from 'yjs'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { collabWsUrl } from '../auth/client'

const messageSync = 0
const messageAwareness = 1
// 断线重连用指数退避（1s、2s、4s、8s、封顶 15s），而不是固定间隔重试：
// 后端要是真的挂了一段时间，固定间隔重试会让所有还开着协作页面的客户端
// 一直高频轰炸它；重连成功一次之后退避重新从 1s 算起，正常的网络抖动
// 还是能很快恢复。
const RECONNECT_BASE_DELAY_MS = 1000
const RECONNECT_MAX_DELAY_MS = 15000

export interface CollabPeer {
  clientId: number
  username: string
}

export interface CollabSession {
  sharedPlanId: number
  doc: Y.Doc
  awareness: awarenessProtocol.Awareness
  peers: Ref<CollabPeer[]>
  connected: Ref<boolean>
  // 是否已经完成过至少一轮初始同步（收到过服务器的 SyncStep2）。绑定某个
  // 字段前必须等这个变成 true——不然本地这边可能会在真正的内容（服务器用
  // 现有计划打底的名字/备注）到达之前，先就地新建一个空的 Y.Text 占位，
  // 跟随后到达的、服务器那份真正有内容的 Y.Text 在同一个 map key 上打架，
  // 搞不好把已有内容短暂地（或者干脆）冲成空字符串。见
  // useCollabText.ts 里对这个字段的使用方式。
  synced: Ref<boolean>
  // 拿到（必要时创建）某个字段对应的 Y.Text，字段用 "字段类型:实体id"
  // 这样的字符串区分，比如 "stopName:abc123"，跟服务器那边的约定一致
  getFieldText(key: string): Y.Text
}

// 同一时间只会有一个协作会话在跑（用户同一时刻只会打开一份计划），
// 用一个模块级的 shallowRef 暴露出去，组件里 watch 它来决定要不要把
// 自己的文本输入接入协作。
export const activeCollabSession = shallowRef<CollabSession | null>(null)

let currentSocket: WebSocket | null = null
let reconnectTimer: number | null = null
let reconnectAttempt = 0

function nextReconnectDelay(): number {
  const delay = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** reconnectAttempt)
  reconnectAttempt += 1
  return delay
}

function stopSocket(): void {
  if (reconnectTimer != null) {
    window.clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (currentSocket) {
    const socket = currentSocket
    currentSocket = null
    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
    try {
      socket.close()
    } catch {
      // 已经断开就算了
    }
  }
}

function updatePeers(session: CollabSession): void {
  const states = session.awareness.getStates()
  const list: CollabPeer[] = []
  states.forEach((state, clientId) => {
    if (clientId === session.doc.clientID) return
    const username = (state as { user?: { username?: string } } | undefined)?.user?.username
    if (username) list.push({ clientId, username })
  })
  session.peers.value = list
}

// sharedPlanId：服务器上 shared_plans 表的数字 id（不是本地计划 id）
// username：显示给协作者看的名字（当前登录账号的用户名）
export function connectPlanCollab(sharedPlanId: number, username: string): CollabSession {
  disconnectPlanCollab()
  reconnectAttempt = 0 // 换了一个全新的房间，退避计数不该继续沿用上一个房间的

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  awareness.setLocalStateField('user', { username })

  const peers = ref<CollabPeer[]>([])
  const connected = ref(false)
  const synced = ref(false)

  const session: CollabSession = {
    sharedPlanId,
    doc,
    awareness,
    peers,
    connected,
    synced,
    getFieldText(key: string): Y.Text {
      const fields = doc.getMap<Y.Text>('fields')
      const existing = fields.get(key)
      if (existing) return existing
      const ytext = new Y.Text()
      fields.set(key, ytext)
      return ytext
    },
  }

  function send(data: Uint8Array): void {
    if (currentSocket && currentSocket.readyState === WebSocket.OPEN) {
      // lib0/encoding 返回的 Uint8Array 类型标注是 ArrayBufferLike（理论上
      // 可能是 SharedArrayBuffer），WebSocket.send 的类型要求更严格的
      // ArrayBuffer；实际上 lib0 内部总是用 new Uint8Array(length) 这种
      // 方式分配、且是一次性拷贝出的精确长度缓冲区，这里转一下类型是安全的。
      currentSocket.send(data.buffer as ArrayBuffer)
    }
  }

  function openSocket(): void {
    const ws = new WebSocket(collabWsUrl(`/collab?planId=${sharedPlanId}`))
    ws.binaryType = 'arraybuffer'
    currentSocket = ws

    ws.onopen = () => {
      connected.value = true
      reconnectAttempt = 0 // 连上了，退避重新从头算起
      const syncEncoder = encoding.createEncoder()
      encoding.writeVarUint(syncEncoder, messageSync)
      syncProtocol.writeSyncStep1(syncEncoder, doc)
      send(encoding.toUint8Array(syncEncoder))

      const awarenessUpdate = awarenessProtocol.encodeAwarenessUpdate(awareness, [doc.clientID])
      const awEncoder = encoding.createEncoder()
      encoding.writeVarUint(awEncoder, messageAwareness)
      encoding.writeVarUint8Array(awEncoder, awarenessUpdate)
      send(encoding.toUint8Array(awEncoder))
    }

    ws.onmessage = (event) => {
      const decoder = decoding.createDecoder(new Uint8Array(event.data as ArrayBuffer))
      const messageType = decoding.readVarUint(decoder)
      if (messageType === messageSync) {
        // 这里不用 syncProtocol.readSyncMessage 那个一体化的便捷函数，是
        // 因为要精确知道"真正带着内容的 SyncStep2/Update 是不是已经收到
        // 并应用了"，而不是"收到过某条同步类消息"——服务器连上时会先发一条
        // 只带状态向量、不带实际内容的 SyncStep1，如果拿它就当作已同步，
        // useCollabText 可能会在真正内容到达前抢先绑定，见 synced 的注释。
        const innerType = decoding.readVarUint(decoder)
        if (innerType === syncProtocol.messageYjsSyncStep1) {
          const encoder = encoding.createEncoder()
          encoding.writeVarUint(encoder, messageSync)
          syncProtocol.readSyncStep1(decoder, encoder, doc)
          send(encoding.toUint8Array(encoder))
        } else if (innerType === syncProtocol.messageYjsSyncStep2 || innerType === syncProtocol.messageYjsUpdate) {
          syncProtocol.readUpdate(decoder, doc, 'server')
          synced.value = true
        }
      } else if (messageType === messageAwareness) {
        awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), 'server')
        updatePeers(session)
      }
    }

    ws.onclose = () => {
      connected.value = false
      synced.value = false
      if (currentSocket !== ws) return // 已经被 disconnectPlanCollab 换掉了，不用重连
      // 断线自动重连（比如后端重启、临时网络抖动），不用用户手动重新打开
      // 这份计划——只要还停留在这份计划的编辑页面就应该一直尝试恢复。
      reconnectTimer = window.setTimeout(openSocket, nextReconnectDelay())
    }

    ws.onerror = () => {
      // close 事件之后一定还会触发一次，这里不用重复处理
    }
  }

  openSocket()

  function onDocUpdate(update: Uint8Array, origin: unknown): void {
    if (origin === 'server') return // 服务器发来的更新，不要再发回去
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageSync)
    syncProtocol.writeUpdate(encoder, update)
    send(encoding.toUint8Array(encoder))
  }
  doc.on('update', onDocUpdate)

  function onAwarenessUpdate({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }, origin: unknown): void {
    updatePeers(session)
    if (origin === 'server') return
    const changed = added.concat(updated, removed)
    if (!changed.length) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, messageAwareness)
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed))
    send(encoding.toUint8Array(encoder))
  }
  awareness.on('update', onAwarenessUpdate)

  activeCollabSession.value = session
  return session
}

// onlyIfSharedPlanId：只有当前连着的协作会话正好是这个 shared_plans id
// 才断开，不传就无条件断开。owner 自己打开的计划和"分享给我的"计划两条
// 路径都可能触发协作连接/断开，用这个参数可以避免两边操作时序上的先后
// 顺序碰巧交叉时，误把对方刚建立好的新会话给断开——见 stores/plans.ts 和
// stores/sharedPlans.ts 里的调用方式。
export function disconnectPlanCollab(onlyIfSharedPlanId?: number): void {
  if (onlyIfSharedPlanId != null && activeCollabSession.value?.sharedPlanId !== onlyIfSharedPlanId) return
  stopSocket()
  const session = activeCollabSession.value
  if (session) {
    awarenessProtocol.removeAwarenessStates(session.awareness, [session.doc.clientID], 'local')
    session.doc.destroy()
  }
  activeCollabSession.value = null
}

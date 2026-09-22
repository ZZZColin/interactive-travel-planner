// 把一个 Y.Text 和一个普通字符串 ref 双向绑定。
//
// 本地这边输入时，不能简单地"整串替换"（ytext.delete(0, ytext.length);
// ytext.insert(0, next)）——那样等于每次按键都把整个字段删了重打一遍，
// Yjs 没法知道"这只是在末尾加了一个字"还是"整段被替换了"，两个人同时在
// 打字时会互相冲掉对方的内容，而不是按字符合并。这里改成找出旧值和新值
// 的公共前缀/后缀，只对中间真正变化的那一小段做 delete+insert，Yjs 才能
// 按位置正确合并两个人各自的修改。
//
// 只做前后缀裁剪，不是完整的 Myers diff——足够覆盖"光标处打字/删字/粘贴"
// 这些最常见的场景，而且是唯一可能落在真实输入行为里的情况（真实用户
// 输入永远是"在光标处插入/删除一段连续内容"，不会凭空产生需要跨段复用
// 字符的编辑）。两个人在同一瞬间改动同一处的极端情况下，退化成 Yjs
// 默认的按位置合并，不会丢数据，只是结果的字符顺序可能和某一方预期的不
// 完全一致。
import type { Ref } from 'vue'
import { nextTick, watch } from 'vue'
import type * as Y from 'yjs'

// 找出 prev -> next 之间真正变化的区间：[start, endPrev) 是被删掉的部分，
// [start, endNext) 是替换成的新内容。本地写入和远端光标位置调整都要用
// 同一套区间计算，两边的行为才能对得上。
function diffRange(prev: string, next: string): { start: number; endPrev: number; endNext: number } {
  let start = 0
  const maxCommon = Math.min(prev.length, next.length)
  while (start < maxCommon && prev[start] === next[start]) start++
  let endPrev = prev.length
  let endNext = next.length
  while (endPrev > start && endNext > start && prev[endPrev - 1] === next[endNext - 1]) {
    endPrev--
    endNext--
  }
  return { start, endPrev, endNext }
}

function applyLocalToYText(ytext: Y.Text, next: string): void {
  const prev = ytext.toString()
  if (prev === next) return
  const { start, endPrev, endNext } = diffRange(prev, next)
  const doc = ytext.doc
  const run = (): void => {
    if (endPrev > start) ytext.delete(start, endPrev - start)
    if (endNext > start) ytext.insert(start, next.slice(start, endNext))
  }
  if (doc) doc.transact(run, 'local-text-binding')
  else run()
}

// 远端内容变化时，把一个光标/选区位置从旧内容映射到新内容里的对应位置：
// 落在变化区间之前的位置不用动；落在变化区间之后的位置整体平移变化前后
// 的长度差；恰好落在变化区间内部的（这种情况只会发生在这段内容是被
// 别人改掉的，本地光标原本就不该继续停在那儿），夹到新内容里这段变化的
// 末尾。
function mapCursor(prev: string, next: string, pos: number): number {
  const { start, endPrev, endNext } = diffRange(prev, next)
  if (pos <= start) return pos
  if (pos >= endPrev) return pos + (endNext - endPrev)
  return endNext
}

export interface CollabTextBindingOptions {
  // 返回这个字段当前对应的原生 input/textarea 元素。Element Plus 的
  // ElInput 组件实例上有 `.input`（单行）或 `.textarea`（多行）属性指向
  // 它，用模板 ref 拿到组件实例后传一个访问器进来即可。传了这个参数，
  // 远端更新到达、且用户光标正好停在这个输入框里时，会把光标位置换算到
  // 新内容里的对应位置再恢复回去，而不是让浏览器把光标弹到末尾；不传就
  // 是"直接整体替换显示内容，光标可能跳到末尾"的朴素行为。
  getInputEl?: () => HTMLInputElement | HTMLTextAreaElement | null | undefined
  // 这个客户端此刻对这份共享计划是不是有编辑权限，默认认为有（跟原来的
  // 行为保持一致）。传成一个取值函数而不是一次性的布尔值，是因为绑定本身
  // 只在协作会话切换时才重新建立一次（见 useCollabText.ts/ParticipantEditor
  // 的"按会话对象引用判断要不要重建绑定"逻辑），中途权限如果变化（比如
  // 组件长期不销毁、反复打开不同权限的计划复用同一个绑定），一次性传入的
  // 布尔值会一直停在绑定建立那一刻的旧值上；用取值函数就能保证每次真正
  // 要用到的时候都读到当下最新的权限状态。
  //
  // 只读权限的调用方应该让这个函数返回 false——这不是为了防止真的把内容
  // 写坏（服务器那一侧本来就会按权限丢弃只读连接发上来的编辑，见
  // collabServer.js），而是为了不让只读客户端本地这份 Y.Doc 凭空多出一次
  // "本地插入"操作：这次插入只在只读客户端自己的浏览器里发生（Yjs 的
  // CRDT 操作永远是先在本地执行，不管有没有权限把它发出去），服务器和
  // 其他人完全看不到、也不会被持久化，但如果之后这个字段真正的内容通过
  // 服务器广播过来，只读客户端本地会把"自己凭空插入的这份"和"服务器广播
  // 来的这份"当成两次真正并发的编辑合并在一起，导致这一个用户自己本地看
  // 到内容变成重复/错乱（不会影响服务器上的真实数据，也不会影响其他人，
  // 但对这一个只读用户来说是显示错误）。返回 false 之后，只读客户端遇到
  // 字段为空的情况，只是老老实实按"远端为准"来（保持空，等真正的内容
  // 广播过来），不会自己在本地插入任何东西。
  canWrite?: () => boolean
}

// 返回一个解绑函数；调用方（useCollabText）负责在协作会话结束或组件卸载
// 时调用它，避免监听器堆积。
export function bindCollabText(ytext: Y.Text, local: Ref<string>, options: CollabTextBindingOptions = {}): () => void {
  let applyingRemote = false
  const canWrite = (): boolean => options.canWrite?.() ?? true

  // 绑定的第一刻，如果共享的 Y.Text 还是空的、但本地这时候已经有实际内容，
  // 反过来拿本地内容给它打底，而不是套用下面"远端内容为准"的默认规则、
  // 把本地内容清空。
  //
  // 什么时候会出现"字段是空的，但本地有内容"这种情况：协作房间不是每次
  // 都从头创建——服务器重启、或者所有人都断开后，房间会从上一次落盘的
  // 快照里恢复（见 collabServer.js 的 loadOrCreateRoom），只有房间第一次
  // 被创建、从来没有落盘过的时候才会用当前计划内容整体打底一次。如果
  // 落盘快照是在"某位参与人员被加进来"之前存的，恢复出来的文档里根本
  // 没有这位参与人员对应的字段——这种情况下由客户端第一次绑定这个字段时
  // 顺手把当前真实值（比如这位参与人员当时已经填好的名字）补进去，
  // 不然会被误当成"这个字段本来就是空的"，把已经填好的内容清空。
  //
  // 只有有编辑权限的客户端才做这件事：只读客户端就算发现字段是空的、
  // 本地却有真实内容，也不去补——补了服务器也会因为权限校验直接丢弃，
  // 唯一的效果是让只读客户端自己本地的 Y.Doc 多出一次"孤儿插入"，将来
  // 服务器真正广播这个字段的内容过来时，会跟这次孤儿插入合并成重复内容，
  // 见上面 canWrite 选项的注释。
  if (canWrite() && ytext.length === 0 && local.value) {
    applyLocalToYText(ytext, local.value)
  }

  const stopLocalWatch = watch(local, (next) => {
    if (applyingRemote) return
    if (!canWrite()) return
    applyLocalToYText(ytext, next)
  })

  function onYTextChange(): void {
    const next = ytext.toString()
    const prev = local.value
    if (prev === next) return

    const el = options.getInputEl?.()
    const isFocused = Boolean(el && typeof document !== 'undefined' && document.activeElement === el)
    // selectionStart/selectionEnd 在部分 input type（比如 number、email）
    // 上访问会直接抛异常，这里的输入框实际都是 text/textarea，正常情况
    // 不会走到 catch，保险起见还是包一层。
    let selStart: number | null = null
    let selEnd: number | null = null
    if (isFocused && el) {
      try {
        selStart = el.selectionStart
        selEnd = el.selectionEnd
      } catch {
        selStart = null
        selEnd = null
      }
    }

    applyingRemote = true
    local.value = next
    applyingRemote = false

    if (isFocused && el && selStart != null && selEnd != null) {
      const newStart = mapCursor(prev, next, selStart)
      const newEnd = mapCursor(prev, next, selEnd)
      // 这时候 DOM 里显示的还是旧内容（Vue 的响应式更新要等下一次渲染才
      // 应用到 DOM 上），必须等一次 tick，不然 setSelectionRange 会被
      // 随后而来的重新渲染悄悄重置掉。
      nextTick(() => {
        if (document.activeElement !== el) return // 这段时间里焦点已经移开了，不用再管
        try {
          el.setSelectionRange(newStart, newEnd)
        } catch {
          // 极少数场景下（比如输入法组合输入中途）恢复选区会失败，忽略，
          // 大不了这一次光标退化成跳到默认位置
        }
      })
    }
  }
  ytext.observe(onYTextChange)
  // 绑定的一开始就以 Y.Text 里已有的内容为准——可能是别人已经在编辑、或者
  // 服务器用现有计划内容打底的结果，不能让本地空字符串把它覆盖掉。
  onYTextChange()

  return () => {
    stopLocalWatch()
    ytext.unobserve(onYTextChange)
  }
}

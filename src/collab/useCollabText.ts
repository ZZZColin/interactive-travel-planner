// 组件里接一个文本字段的实时协作用的组合式函数。
//
// collabKey 传 null/undefined 表示这个字段现在不需要协作（没有打开共享
// 计划、这份计划目前没有别人可能在协作、协作连接还没建立、或者还没完成
// 首次同步）——这种情况下什么都不做，本地这个 ref 该怎么用还怎么用，
// v-model 行为完全不受影响，不会因为引入协作功能就影响到私有计划的
// 正常编辑。一旦有值且协作会话就绪，本地 ref 的读写就会跟同一个字段的
// Y.Text 双向绑定，多个人同时打字会按字符合并。
import { onBeforeUnmount, watch, type Ref } from 'vue'
import type * as Y from 'yjs'
import { bindCollabText, type CollabTextBindingOptions } from './collabTextBinding'
import { activeCollabSession, type CollabSession } from './planCollab'

export function useCollabText(
  collabKey: Ref<string | null | undefined>,
  local: Ref<string>,
  options: CollabTextBindingOptions = {},
): void {
  let unbind: (() => void) | null = null
  // 记录"当前绑定的是哪个会话对象、哪个字段 key"，而不是只看
  // connected/synced 这些会短暂抖动的状态——网络抖了一下自动重连时，
  // activeCollabSession 还是同一个会话对象（同一个 Y.Doc 没有被重建），
  // 只是 synced 短暂变成 false 又变回 true。如果这时候把绑定拆了重建，
  // `bindCollabText` 重新绑定的第一件事是拿 Y.Text 的内容覆盖本地值，
  // 会把断线期间用户在本地打的字（这些字其实已经安全地记在本地这份
  // Y.Doc 里了，只是还没来得及广播出去）冲掉。用会话对象的引用相等性
  // 判断"目标状态有没有真的变"，网络抖动时就什么都不做，绑定继续有效，
  // 断线期间的编辑等重连后由 Yjs 自己的同步握手补发出去，不会丢。
  let boundSession: CollabSession | null = null
  let boundKey: string | null = null

  function ensureBinding(): void {
    const session = activeCollabSession.value
    const key = collabKey.value ?? null
    if (session === boundSession && key === boundKey) return
    unbind?.()
    unbind = null
    boundSession = null
    boundKey = null
    if (!session || !key || !session.synced.value) return
    const ytext: Y.Text = session.getFieldText(key)
    unbind = bindCollabText(ytext, local, options)
    boundSession = session
    boundKey = key
  }

  watch(
    [collabKey, () => activeCollabSession.value, () => activeCollabSession.value?.synced.value],
    ensureBinding,
    { immediate: true },
  )

  onBeforeUnmount(() => {
    unbind?.()
    unbind = null
  })
}

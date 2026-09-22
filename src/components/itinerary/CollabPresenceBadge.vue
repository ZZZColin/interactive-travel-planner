<script setup lang="ts">
// 逐字实时协作的在线状态小标签：这份计划现在有没有开着协作连接、除了
// 自己还有没有别人也在看/编辑。没有协作会话（没打开共享计划、或者这份
// 计划没有分享给任何人）时什么都不显示，不占地方。
import { computed } from 'vue'
import { activeCollabSession } from '../../collab/planCollab'

const session = computed(() => activeCollabSession.value)
const connected = computed(() => session.value?.connected.value ?? false)
const peerNames = computed(() => (session.value?.peers.value ?? []).map((peer) => peer.username))
</script>

<template>
  <span v-if="session" class="collab-presence" :class="{ offline: !connected }">
    <i class="pi" :class="connected ? 'pi-users' : 'pi-spin pi-spinner'" />
    <template v-if="!connected">协作连接中…</template>
    <template v-else-if="peerNames.length === 0">实时协作已开启</template>
    <template v-else>{{ peerNames.join('、') }} 也在实时编辑</template>
  </span>
</template>

<style scoped>
.collab-presence {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  line-height: 1;
  padding: 3px 9px;
  border-radius: 999px;
  color: var(--el-color-success, #67c23a);
  background: var(--el-color-success-light-9, #f0f9eb);
  white-space: nowrap;
}
.collab-presence.offline {
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light, #f5f7fa);
}
</style>

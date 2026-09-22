<script setup lang="ts">
import { ElButton, ElDialog } from 'element-plus'
import ServerSyncPanel from './ServerSyncPanel.vue'

defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <ElDialog :model-value="open" class="travel-dialog account-sync-modal" width="680px" align-center destroy-on-close @update:model-value="!$event && emit('close')">
    <template #header><div class="backup-dialog-title account-sync-title"><span><i class="pi pi-cloud" /></span><div><h2>账号与同步</h2><p>服务器配置同步、修改登录密码，以及退出登录。</p></div></div></template>
    <ServerSyncPanel />
    <template #footer><ElButton text @click="emit('close')">关闭</ElButton></template>
  </ElDialog>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput } from 'element-plus'
import { createServiceConfigBackup, importServiceConfigBackup } from '../../config/serviceConfigBackup'
import { changePassword, fetchServerConfig, fetchSession, logout, pushServerConfig } from '../../auth/client'
import { usePlannerStore } from '../../stores/planner'
import AdminUsersPanel from './AdminUsersPanel.vue'
import AuditLogPanel from './AuditLogPanel.vue'
import TwoFactorPanel from './TwoFactorPanel.vue'

const planner = usePlannerStore()
const pushing = ref(false)
const pulling = ref(false)
const error = ref('')
const role = ref<'admin' | 'member' | null>(null)

const changingPassword = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const passwordError = ref('')

onMounted(async () => {
  try {
    const session = await fetchSession()
    role.value = session.role
  } catch {
    role.value = null
  }
})

async function pushToServer(): Promise<void> {
  pushing.value = true
  error.value = ''
  try {
    const payload = createServiceConfigBackup(true)
    await pushServerConfig(payload)
    planner.notify('已同步到服务器')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '同步失败'
  } finally {
    pushing.value = false
  }
}

async function pullFromServer(): Promise<void> {
  pulling.value = true
  error.value = ''
  try {
    const { data } = await fetchServerConfig()
    if (!data) {
      error.value = '服务器上还没有保存过配置'
      return
    }
    importServiceConfigBackup(data, 'replace')
    planner.notify('已从服务器拉取配置，即将刷新')
    window.setTimeout(() => location.reload(), 350)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '拉取失败'
  } finally {
    pulling.value = false
  }
}

async function submitPasswordChange(): Promise<void> {
  if (!currentPassword.value || newPassword.value.length < 8) {
    passwordError.value = '新密码至少需要 8 位'
    return
  }
  changingPassword.value = true
  passwordError.value = ''
  try {
    await changePassword(currentPassword.value, newPassword.value)
    currentPassword.value = ''
    newPassword.value = ''
    planner.notify('密码已修改')
  } catch (reason) {
    passwordError.value = reason instanceof Error ? reason.message : '修改失败'
  } finally {
    changingPassword.value = false
  }
}

async function handleLogout(): Promise<void> {
  await logout().catch(() => {})
  location.reload()
}
</script>

<template>
  <section class="service-config-server-card">
    <header>
      <div class="backup-action-icon"><i class="pi pi-cloud" /></div>
      <div><strong>服务器同步</strong><span>把当前配置同步到服务器数据库，换设备登录后自动生效。</span></div>
    </header>
    <div class="service-config-server-actions">
      <ElButton type="primary" :loading="pushing" @click="pushToServer"><i class="pi pi-upload" />同步到服务器</ElButton>
      <ElButton :loading="pulling" @click="pullFromServer"><i class="pi pi-download" />从服务器拉取</ElButton>
    </div>
    <p v-if="error" class="auth-gate-error">{{ error }}</p>

    <div class="service-config-password-change">
      <strong>修改登录密码</strong>
      <ElForm label-position="top">
        <ElFormItem label="当前密码"><ElInput v-model="currentPassword" type="password" show-password /></ElFormItem>
        <ElFormItem label="新密码（至少 8 位）"><ElInput v-model="newPassword" type="password" show-password /></ElFormItem>
      </ElForm>
      <p v-if="passwordError" class="auth-gate-error">{{ passwordError }}</p>
      <ElButton :loading="changingPassword" @click="submitPasswordChange">修改密码</ElButton>
    </div>

    <ElButton text @click="handleLogout"><i class="pi pi-sign-out" />退出登录</ElButton>
  </section>

  <TwoFactorPanel />
  <AdminUsersPanel v-if="role === 'admin'" />
  <AuditLogPanel v-if="role === 'admin'" />
</template>

<style scoped>
.service-config-server-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
  margin-top: 16px;
}
.service-config-server-actions { display: flex; gap: 8px; }
.service-config-password-change {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px dashed var(--el-border-color-lighter, #ebeef5);
}
.auth-gate-error { color: var(--el-color-danger, #f56c6c); font-size: 13px; margin: 0; }
</style>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElButton, ElDialog, ElForm, ElFormItem, ElInput, ElOption, ElSelect, ElSwitch, ElTable, ElTableColumn } from 'element-plus'
import { createUser, deleteUser, listUsers, updateUser, type AdminUser } from '../../auth/client'
import { usePlannerStore } from '../../stores/planner'

const planner = usePlannerStore()
const users = ref<AdminUser[]>([])
const loading = ref(false)
const error = ref('')

const createOpen = ref(false)
const newUsername = ref('')
const newPassword = ref('')
const newRole = ref<'member' | 'admin'>('member')
const creating = ref(false)

const resetTargetId = ref<number | null>(null)
const resetPassword = ref('')
const resetting = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    users.value = await listUsers()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '加载用户列表失败'
  } finally {
    loading.value = false
  }
}

async function submitCreate(): Promise<void> {
  if (!newUsername.value || newPassword.value.length < 8) {
    error.value = '用户名不能为空，密码至少 8 位'
    return
  }
  creating.value = true
  error.value = ''
  try {
    await createUser(newUsername.value, newPassword.value, newRole.value)
    newUsername.value = ''
    newPassword.value = ''
    newRole.value = 'member'
    createOpen.value = false
    planner.notify('用户已创建')
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '创建失败'
  } finally {
    creating.value = false
  }
}

async function toggleDisabled(user: AdminUser): Promise<void> {
  try {
    await updateUser(user.id, { disabled: !user.disabled })
    planner.notify(user.disabled ? '已启用该账号' : '已禁用该账号')
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '操作失败'
  }
}

async function toggleRole(user: AdminUser): Promise<void> {
  try {
    await updateUser(user.id, { role: user.role === 'admin' ? 'member' : 'admin' })
    planner.notify('权限已更新')
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '操作失败'
  }
}

async function resetTwoFactor(user: AdminUser): Promise<void> {
  try {
    await updateUser(user.id, { resetTwoFactor: true })
    planner.notify(`已重置 ${user.username} 的两步验证，对方重新登录后可自行再次设置`)
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '重置两步验证失败'
  }
}

async function removeUser(user: AdminUser): Promise<void> {
  try {
    await deleteUser(user.id)
    planner.notify('用户已删除')
    await load()
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '删除失败'
  }
}

async function submitReset(): Promise<void> {
  if (resetTargetId.value == null || resetPassword.value.length < 8) return
  resetting.value = true
  try {
    await updateUser(resetTargetId.value, { newPassword: resetPassword.value })
    planner.notify('密码已重置，该用户所有设备需要重新登录')
    resetTargetId.value = null
    resetPassword.value = ''
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '重置失败'
  } finally {
    resetting.value = false
  }
}

onMounted(load)
</script>

<template>
  <section class="admin-users-card">
    <header>
      <div class="backup-action-icon"><i class="pi pi-users" /></div>
      <div><strong>用户管理（管理员）</strong><span>创建、禁用或删除账号，每个账号的地图/AI 配置互相独立。</span></div>
      <ElButton size="small" type="primary" @click="createOpen = true">新增用户</ElButton>
    </header>
    <p v-if="error" class="auth-gate-error">{{ error }}</p>
    <ElTable :data="users" v-loading="loading" size="small">
      <ElTableColumn prop="username" label="用户名" />
      <ElTableColumn label="角色">
        <template #default="{ row }: { row: AdminUser }">
          <ElButton size="small" text @click="toggleRole(row)">{{ row.role === 'admin' ? '管理员' : '普通用户' }}</ElButton>
        </template>
      </ElTableColumn>
      <ElTableColumn label="状态">
        <template #default="{ row }: { row: AdminUser }">
          <ElSwitch :model-value="!row.disabled" @change="toggleDisabled(row)" />
        </template>
      </ElTableColumn>
      <ElTableColumn label="操作">
        <template #default="{ row }: { row: AdminUser }">
          <ElButton size="small" text @click="resetTargetId = row.id">重置密码</ElButton>
          <ElButton v-if="row.totp_enabled" size="small" text @click="resetTwoFactor(row)">重置两步验证</ElButton>
          <ElButton size="small" text type="danger" @click="removeUser(row)">删除</ElButton>
        </template>
      </ElTableColumn>
    </ElTable>

    <ElDialog v-model="createOpen" title="新增用户" width="360px" append-to-body>
      <ElForm label-position="top">
        <ElFormItem label="用户名"><ElInput v-model="newUsername" /></ElFormItem>
        <ElFormItem label="密码（至少 8 位）"><ElInput v-model="newPassword" type="password" show-password /></ElFormItem>
        <ElFormItem label="角色">
          <ElSelect v-model="newRole">
            <ElOption value="member" label="普通用户" />
            <ElOption value="admin" label="管理员" />
          </ElSelect>
        </ElFormItem>
      </ElForm>
      <template #footer><ElButton @click="createOpen = false">取消</ElButton><ElButton type="primary" :loading="creating" @click="submitCreate">创建</ElButton></template>
    </ElDialog>

    <ElDialog :model-value="resetTargetId != null" title="重置密码" width="320px" append-to-body @update:model-value="!$event && (resetTargetId = null)">
      <ElForm label-position="top">
        <ElFormItem label="新密码（至少 8 位）"><ElInput v-model="resetPassword" type="password" show-password /></ElFormItem>
      </ElForm>
      <template #footer><ElButton @click="resetTargetId = null">取消</ElButton><ElButton type="primary" :loading="resetting" @click="submitReset">确认重置</ElButton></template>
    </ElDialog>
  </section>
</template>

<style scoped>
.admin-users-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
  margin-top: 16px;
}
.admin-users-card header { display: flex; align-items: center; gap: 12px; }
.admin-users-card header > div:nth-child(2) { flex: 1; display: flex; flex-direction: column; }
.auth-gate-error { color: var(--el-color-danger, #f56c6c); font-size: 13px; margin: 0; }
</style>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput } from 'element-plus'
import { isTauri } from '@tauri-apps/api/core'
import { clearServerBaseUrl, fetchSignupStatus, login, register, verifyTwoFactor } from '../../auth/client'

const emit = defineEmits<{ success: [] }>()
const mode = ref<'login' | 'register' | 'twoFactor'>('login')
const allowSignup = ref(false)
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const twoFactorCode = ref('')
const challengeId = ref('')
const error = ref('')
const info = ref('')
const submitting = ref(false)

onMounted(async () => {
  try {
    const status = await fetchSignupStatus()
    allowSignup.value = status.allowSignup
  } catch {
    allowSignup.value = false
  }
})

async function submitLogin(): Promise<void> {
  if (!username.value || !password.value || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    const result = await login(username.value, password.value)
    if (result.requiresTwoFactor && result.challengeId) {
      challengeId.value = result.challengeId
      twoFactorCode.value = ''
      mode.value = 'twoFactor'
      return
    }
    emit('success')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '登录失败'
  } finally {
    submitting.value = false
  }
}

async function submitTwoFactor(): Promise<void> {
  if (!twoFactorCode.value || submitting.value) return
  submitting.value = true
  error.value = ''
  try {
    await verifyTwoFactor(challengeId.value, twoFactorCode.value)
    emit('success')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '验证码不正确'
  } finally {
    submitting.value = false
  }
}

async function submitRegister(): Promise<void> {
  if (!username.value || password.value.length < 8 || submitting.value) return
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }
  submitting.value = true
  error.value = ''
  try {
    await register(username.value, password.value)
    info.value = '注册成功，请登录'
    mode.value = 'login'
    password.value = ''
    confirmPassword.value = ''
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '注册失败'
  } finally {
    submitting.value = false
  }
}

function submit(): void {
  if (mode.value === 'login') submitLogin()
  else if (mode.value === 'twoFactor') submitTwoFactor()
  else submitRegister()
}

function switchMode(next: 'login' | 'register'): void {
  mode.value = next
  error.value = ''
  info.value = ''
}

// 只有桌面版会显示这个入口——网页版的地址就是浏览器地址栏里那个，没有"换一个"的概念。
// 桌面版填错服务器地址、或者要换一台服务器时，清掉存的地址再整个重新加载页面，
// main.ts 的 bootstrap() 会重新走一遍，从填地址这一步开始。
function changeServer(): void {
  clearServerBaseUrl()
  window.location.reload()
}
</script>

<template>
  <div class="auth-gate-login">
    <form class="auth-gate-card" @submit.prevent="submit">
      <h2>行途规划</h2>
      <p v-if="mode === 'login'">请登录后继续</p>
      <p v-else-if="mode === 'register'">创建一个新账号</p>
      <p v-else>请输入身份验证器 App 里的 6 位验证码，或使用一个恢复代码</p>
      <p v-if="info" class="auth-gate-info">{{ info }}</p>
      <p v-if="error" class="auth-gate-error">{{ error }}</p>

      <ElForm v-if="mode !== 'twoFactor'" label-position="top">
        <ElFormItem label="用户名"><ElInput v-model="username" autocomplete="username" /></ElFormItem>
        <ElFormItem label="密码"><ElInput v-model="password" type="password" show-password autocomplete="current-password" @keyup.enter="submit" /></ElFormItem>
        <ElFormItem v-if="mode === 'register'" label="确认密码"><ElInput v-model="confirmPassword" type="password" show-password @keyup.enter="submit" /></ElFormItem>
      </ElForm>
      <ElForm v-else label-position="top">
        <ElFormItem label="验证码"><ElInput v-model="twoFactorCode" autocomplete="one-time-code" @keyup.enter="submit" /></ElFormItem>
      </ElForm>

      <ElButton type="primary" native-type="submit" :loading="submitting" style="width: 100%">
        {{ mode === 'login' ? '登录' : mode === 'twoFactor' ? '验证' : '注册' }}
      </ElButton>
      <ElButton v-if="mode === 'login' && allowSignup" text style="width: 100%" @click="switchMode('register')">没有账号？去注册</ElButton>
      <ElButton v-if="mode === 'register'" text style="width: 100%" @click="switchMode('login')">已有账号？去登录</ElButton>
      <ElButton v-if="isTauri() && mode !== 'twoFactor'" text style="width: 100%" @click="changeServer">连错服务器了？点这里重新填地址</ElButton>
    </form>
  </div>
</template>

<style scoped>
.auth-gate-login {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100vh;
  background: var(--el-bg-color-page, #f5f7fa);
}
.auth-gate-card {
  width: 320px;
  padding: 32px;
  border-radius: 12px;
  background: var(--el-bg-color, #fff);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.auth-gate-card h2 { margin: 0; }
.auth-gate-card p { margin: 0 0 8px; color: var(--el-text-color-secondary); font-size: 13px; }
.auth-gate-error { color: var(--el-color-danger, #f56c6c); font-size: 13px; margin: 0; }
.auth-gate-info { color: var(--el-color-success, #67c23a); font-size: 13px; margin: 0; }
</style>

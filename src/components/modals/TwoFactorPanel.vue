<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput } from 'element-plus'
import { disableTwoFactor, enableTwoFactor, fetchSession, setupTwoFactor } from '../../auth/client'
import { usePlannerStore } from '../../stores/planner'

const planner = usePlannerStore()
const enabled = ref(false)
const step = ref<'idle' | 'setup' | 'recoveryCodes'>('idle')
const qrCodeDataUrl = ref('')
const secret = ref('')
const confirmCode = ref('')
const recoveryCodes = ref<string[]>([])
const disablePassword = ref('')
const disableCode = ref('')
const error = ref('')
const busy = ref(false)

async function refreshStatus(): Promise<void> {
  try {
    const session = await fetchSession()
    enabled.value = session.totpEnabled
  } catch {
    enabled.value = false
  }
}

async function startSetup(): Promise<void> {
  busy.value = true
  error.value = ''
  try {
    const result = await setupTwoFactor()
    qrCodeDataUrl.value = result.qrCodeDataUrl
    secret.value = result.secret
    step.value = 'setup'
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '生成失败'
  } finally {
    busy.value = false
  }
}

async function confirmSetup(): Promise<void> {
  if (!confirmCode.value) return
  busy.value = true
  error.value = ''
  try {
    const result = await enableTwoFactor(confirmCode.value)
    recoveryCodes.value = result.recoveryCodes
    step.value = 'recoveryCodes'
    enabled.value = true
    confirmCode.value = ''
    planner.notify('两步验证已启用')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '验证码不正确'
  } finally {
    busy.value = false
  }
}

async function submitDisable(): Promise<void> {
  if (!disablePassword.value || !disableCode.value) return
  busy.value = true
  error.value = ''
  try {
    await disableTwoFactor(disablePassword.value, disableCode.value)
    enabled.value = false
    step.value = 'idle'
    disablePassword.value = ''
    disableCode.value = ''
    planner.notify('两步验证已关闭')
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : '操作失败'
  } finally {
    busy.value = false
  }
}

function finishSetup(): void {
  step.value = 'idle'
  qrCodeDataUrl.value = ''
  secret.value = ''
  recoveryCodes.value = []
}

onMounted(refreshStatus)
</script>

<template>
  <section class="two-factor-card">
    <header>
      <div class="backup-action-icon"><i class="pi pi-shield" /></div>
      <div><strong>两步验证</strong><span>{{ enabled ? '已启用，登录时需要额外输入验证码' : '未启用，建议开启以提升账号安全' }}</span></div>
    </header>
    <p v-if="error" class="auth-gate-error">{{ error }}</p>

    <template v-if="!enabled && step === 'idle'">
      <ElButton type="primary" :loading="busy" @click="startSetup">启用两步验证</ElButton>
    </template>

    <template v-if="step === 'setup'">
      <p>用身份验证器 App（如 Google Authenticator、Authy）扫描下面的二维码，或手动输入密钥：</p>
      <img :src="qrCodeDataUrl" alt="两步验证二维码" width="180" height="180" />
      <p class="two-factor-secret">{{ secret }}</p>
      <ElForm label-position="top">
        <ElFormItem label="输入 App 里显示的 6 位验证码"><ElInput v-model="confirmCode" /></ElFormItem>
      </ElForm>
      <ElButton type="primary" :loading="busy" @click="confirmSetup">确认启用</ElButton>
    </template>

    <template v-if="step === 'recoveryCodes'">
      <p class="two-factor-warning">请把下面这些一次性恢复代码保存好，手机丢失或换设备时可以用它登录。每个代码只能用一次，这个页面关掉后不会再显示。</p>
      <ul class="two-factor-codes">
        <li v-for="code in recoveryCodes" :key="code">{{ code }}</li>
      </ul>
      <ElButton type="primary" @click="finishSetup">我已保存好</ElButton>
    </template>

    <template v-if="enabled && step === 'idle'">
      <p>关闭两步验证需要输入当前密码和一个当前验证码：</p>
      <ElForm label-position="top">
        <ElFormItem label="当前密码"><ElInput v-model="disablePassword" type="password" show-password /></ElFormItem>
        <ElFormItem label="验证码"><ElInput v-model="disableCode" /></ElFormItem>
      </ElForm>
      <ElButton type="danger" :loading="busy" @click="submitDisable">关闭两步验证</ElButton>
    </template>
  </section>
</template>

<style scoped>
.two-factor-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 16px;
  border-top: 1px solid var(--el-border-color-lighter, #ebeef5);
  margin-top: 16px;
}
.two-factor-secret {
  font-family: monospace;
  letter-spacing: 1px;
  background: var(--el-fill-color-light, #f5f7fa);
  padding: 8px;
  border-radius: 6px;
  word-break: break-all;
}
.two-factor-warning { color: var(--el-color-warning, #e6a23c); font-size: 13px; }
.two-factor-codes { font-family: monospace; columns: 2; gap: 12px; }
.auth-gate-error { color: var(--el-color-danger, #f56c6c); font-size: 13px; margin: 0; }
</style>

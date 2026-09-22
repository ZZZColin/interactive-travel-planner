<script setup lang="ts">
import { ref } from 'vue'
import { ElButton, ElForm, ElFormItem, ElInput } from 'element-plus'
import { fetchSignupStatus, setServerBaseUrl } from '../../auth/client'

// 桌面版第一次启动时用来填后端地址的界面。只有 main.ts 判断出"这是桌面版
// 并且本地还没存过服务器地址"的时候才会挂载它，填完并验证通过之后 emit success，
// main.ts 才会继续往下走正常的登录流程。
const emit = defineEmits<{ success: [] }>()
const url = ref('')
const error = ref('')
const checking = ref(false)

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

async function submit(): Promise<void> {
  const trimmed = url.value.trim()
  if (!trimmed) return
  if (!isValidHttpUrl(trimmed)) {
    error.value = '请输入完整地址，包含 http:// 或 https://，例如 https://trippath.example.com'
    return
  }
  checking.value = true
  error.value = ''
  setServerBaseUrl(trimmed)
  try {
    // 用一个不需要登录、不改数据的接口探测一下这个地址是不是真的能连到 TripPath 后端，
    // 而不是等用户填完密码提交登录才发现地址填错了。
    await fetchSignupStatus()
    emit('success')
  } catch (reason) {
    error.value = reason instanceof Error
      ? `连接失败：${reason.message}。请确认地址正确、服务器已启动，并且允许来自桌面版的跨域访问`
      : '连接失败，请检查地址是否正确'
  } finally {
    checking.value = false
  }
}
</script>

<template>
  <div class="auth-gate-login">
    <form class="auth-gate-card" @submit.prevent="submit">
      <h2>连接到 TripPath 服务器</h2>
      <p>桌面版需要先连接到你部署的 TripPath 服务器才能登录，请输入服务器地址（管理员提供）。</p>
      <p v-if="error" class="auth-gate-error">{{ error }}</p>

      <ElForm label-position="top">
        <ElFormItem label="服务器地址">
          <ElInput v-model="url" placeholder="https://trippath.example.com" @keyup.enter="submit" />
        </ElFormItem>
      </ElForm>

      <ElButton type="primary" native-type="submit" :loading="checking" style="width: 100%">连接</ElButton>
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
  width: 360px;
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
</style>

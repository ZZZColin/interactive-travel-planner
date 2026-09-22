import { createApp } from 'vue'
import { createPinia } from 'pinia'
import 'element-plus/es/components/autocomplete/style/css'
import 'element-plus/es/components/avatar/style/css'
import 'element-plus/es/components/button/style/css'
import 'element-plus/es/components/card/style/css'
import 'element-plus/es/components/date-picker/style/css'
import 'element-plus/es/components/dialog/style/css'
import 'element-plus/es/components/input/style/css'
import 'element-plus/es/components/input-number/style/css'
import 'element-plus/es/components/message-box/style/css'
import 'element-plus/es/components/popconfirm/style/css'
import 'element-plus/es/components/radio/style/css'
import 'element-plus/es/components/select/style/css'
import 'element-plus/es/components/skeleton/style/css'
import 'element-plus/es/components/switch/style/css'
import 'element-plus/es/components/table/style/css'
import 'element-plus/es/components/tag/style/css'
import 'element-plus/es/components/time-picker/style/css'
import 'primeicons/primeicons.css'
import './style.css'
import './styles/experience.css'
import LoginScreen from './components/auth/LoginScreen.vue'
import { i18n, installLegacyDomLocalization } from './i18n'
import { fetchSession, fetchServerConfig } from './auth/client'
import { importServiceConfigBackup } from './config/serviceConfigBackup'

// 注意：这里故意不在文件顶部用静态 import 引入 './App.vue'。
// App.vue 会连带引入 map/provider.ts，那个模块在被加载的那一刻就会立即从
// localStorage 读取地图运行方案并创建单例（不是等到组件渲染才读）。
// 如果在这里用静态 import，App.vue 这条依赖链会在 hydrateFromServer()
// 执行之前就被加载执行，读到的还是旧的/空的 localStorage。所以必须改成
// 动态 import()，确保只有在服务器配置写入 localStorage 之后才去加载它。

const PRELOAD_RECOVERY_KEY = 'interactiveTravel.preloadRecoveryAt'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const now = Date.now()
  const lastRecoveryAt = Number(sessionStorage.getItem(PRELOAD_RECOVERY_KEY) ?? 0)
  if (now - lastRecoveryAt < 10_000) return
  sessionStorage.setItem(PRELOAD_RECOVERY_KEY, String(now))
  window.location.reload()
})

// 在挂载真正的应用之前，先确认已经登录：
// 1. 检查已有会话（cookie）是否有效
// 2. 没有的话，临时挂载一个只包含登录表单的迷你 Vue 应用，等登录成功再卸载
async function waitForLogin(): Promise<void> {
  try {
    await fetchSession()
    return
  } catch {
    // 未登录，继续往下走，展示登录界面
  }
  await new Promise<void>((resolve) => {
    const loginApp = createApp(LoginScreen, {
      onSuccess: () => {
        loginApp.unmount()
        resolve()
      },
    })
    loginApp.mount('#app')
  })
}

// 登录成功后，把服务器上保存的全局服务配置（地图/天气/AI 的 Key 等）
// 拉回来写进 localStorage，这样不管换哪个浏览器/设备登录，配置都是一致的。
// 这一步必须在创建真正的 App 之前完成，因为地图/AI 相关的模块会在被
// import 的那一刻就从 localStorage 读取配置到内存里，之后再改 localStorage 不会生效。
async function hydrateFromServer(): Promise<void> {
  try {
    const { data } = await fetchServerConfig()
    if (data) importServiceConfigBackup(data, 'replace')
  } catch {
    // 服务器上还没有保存过配置，或者拉取失败，就继续使用本地已有的配置
  }
}

async function bootstrap(): Promise<void> {
  await waitForLogin()
  await hydrateFromServer()

  const { default: App } = await import('./App.vue')

  createApp(App)
    .use(createPinia())
    .use(i18n)
    .mount('#app')

  const appRoot = document.getElementById('app')
  if (appRoot) installLegacyDomLocalization(appRoot)
}

bootstrap()

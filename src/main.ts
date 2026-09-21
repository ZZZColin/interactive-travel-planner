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
import 'element-plus/es/components/tag/style/css'
import 'element-plus/es/components/time-picker/style/css'
import 'primeicons/primeicons.css'
import './style.css'
import './styles/experience.css'
import App from './App.vue'
import { i18n, installLegacyDomLocalization } from './i18n'

const PRELOAD_RECOVERY_KEY = 'interactiveTravel.preloadRecoveryAt'

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault()
  const now = Date.now()
  const lastRecoveryAt = Number(sessionStorage.getItem(PRELOAD_RECOVERY_KEY) ?? 0)
  if (now - lastRecoveryAt < 10_000) return
  sessionStorage.setItem(PRELOAD_RECOVERY_KEY, String(now))
  window.location.reload()
})

createApp(App)
  .use(createPinia())
  .use(i18n)
  .mount('#app')

const appRoot = document.getElementById('app')
if (appRoot) installLegacyDomLocalization(appRoot)

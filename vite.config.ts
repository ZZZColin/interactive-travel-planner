import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
 
export default defineConfig({
  define: {
    CESIUM_BASE_URL: JSON.stringify('/cesiumStatic'),
  },
  plugins: [
    vue(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/cesium/Build/Cesium/Workers/**/*', dest: 'cesiumStatic/Workers', rename: { stripBase: 5 } },
        { src: 'node_modules/cesium/Build/Cesium/ThirdParty/**/*', dest: 'cesiumStatic/ThirdParty', rename: { stripBase: 5 } },
        { src: 'node_modules/cesium/Build/Cesium/Assets/**/*', dest: 'cesiumStatic/Assets', rename: { stripBase: 5 } },
        { src: 'node_modules/cesium/Build/Cesium/Widgets/**/*', dest: 'cesiumStatic/Widgets', rename: { stripBase: 5 } },
      ],
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 8765,
    strictPort: true,
    // 本地开发时前端(这个 vite dev server, 8765 端口)和后端(server/index.js, 默认 3000 端口)
    // 是两个独立进程，浏览器发到 /api/* 的请求不会自动找到后端。没有这个代理，登录、
    // 两步验证、服务器同步这些功能在 `pnpm dev` 下全部连不上，只有 Docker 构建出的
    // 单进程版本才能用。加上这个代理之后，前端还是用相对路径 /api/xxx 请求，
    // vite 会把它转发到后端，浏览器看到的是同源请求，不会触发 CORS。
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 8765,
    strictPort: true,
  },
})

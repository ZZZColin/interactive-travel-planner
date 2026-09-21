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
  },
  preview: {
    host: '127.0.0.1',
    port: 8765,
    strictPort: true,
  },
})

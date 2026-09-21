/// <reference types="vite/client" />

declare global {
  interface Window {
    AMapLoader?: {
      load(options: {
        key: string
        version: string
        plugins: string[]
      }): Promise<any>
    }
    _AMapSecurityConfig?: {
      securityJsCode: string
    }
    TMap?: any
    CESIUM_BASE_URL?: string
  }
}

export {}

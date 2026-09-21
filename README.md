# 互动式旅行路线规划器

TripPath 是一个面向多日旅行的路线规划器，支持行程、地点、交通、预算、天气、风险和 AI 辅助规划。

<p align="center">
  <img src="./docs/screenshots/restored-home.png" alt="TripPath 行程规划首页" width="100%" />
</p>

## 功能

- 多日行程、地点池、住宿和交通段管理；
- 高德、腾讯、Google Maps、Mapbox 与 Cesium 的可扩展地图运行时；
- 路线候选、地图拾取、时间冲突和出发前检查；
- 预算、费用明细、自驾成本和票务信息；
- OpenAI / Anthropic 兼容的 AI 行程导入与路线优化；
- 自动保存、历史版本、回收站和 JSON 备份恢复；
- 简体中文与英文界面。

## 技术栈

Vue 3、TypeScript、Vite、Pinia、Element Plus、Tauri 2、Vitest、Playwright、pnpm。

地图和在线服务通过运行时 Provider 接入；当前具体能力取决于已配置的服务和 API Key。

## 快速开始

要求：Node.js、pnpm。桌面版还需要 Rust、Visual Studio C++ Build Tools 和 WebView2。

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

访问 <http://127.0.0.1:8765/>。

## 配置与安全

地图、天气和 AI 服务凭据在应用内配置，不会写入源码或生产构建。静态 Web 版本会在浏览器中直接请求服务商；如果服务商不支持 CORS，需要使用兼容网关。

`.env.example` 仅用于本地 E2E 测试：

```text
AMAP_TEST_KEY=
AMAP_TEST_SECURITY_CODE=
```

不要提交 `.env`、API Key、Token、私钥或服务器凭据。

## 桌面版

GitHub Actions 会在推送 `v*.*.*` 标签或手动运行“桌面版发布”工作流时发布安装包：

- Windows x64：`.msi` / `.exe` 安装包和 `-portable.exe` 可移植版；
- macOS arm64 / x64：`.dmg`；
- Linux x64：`.AppImage` / `.deb`。

下载：[GitHub Releases](https://github.com/pedoc/interactive-travel-planner/releases/latest)

本地构建：

```powershell
pnpm desktop:dev
pnpm desktop:build:portable
pnpm desktop:build:installer
```

可移植版输出：`src-tauri/target/release/trippath.exe`。它不创建安装器注册信息，但仍依赖系统中的 WebView2。

## 开发命令

```powershell
pnpm type-check
pnpm test
pnpm test:e2e
pnpm build
```

生产静态文件输出到 `dist/`，可部署到任意静态文件托管平台。通用部署说明见 [`docs/operations/DEPLOYMENT.md`](./docs/operations/DEPLOYMENT.md)。

## 文档与目录

- [项目文档索引](./docs/README.md)
- [地图运行时架构](./docs/architecture/MAP_ARCHITECTURE.md)
- [Tauri 桌面版说明](./docs/development/TAURI_DESKTOP.md)
- [国际化说明](./docs/development/INTERNATIONALIZATION.md)

```text
src/
├── domain/       领域模型与业务规则
├── stores/       Pinia 状态、历史与持久化
├── map/          地图 Provider 与运行时
└── components/   页面和业务组件
```

## 许可证

本项目采用 [GNU GPL-3.0-or-later](./LICENSE)。
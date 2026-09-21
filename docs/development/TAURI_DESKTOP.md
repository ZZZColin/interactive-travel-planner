# TripPath Tauri 桌面版验证说明

## 当前阶段

当前先只包装为 Tauri 桌面应用，不引入 SQLite，也不修改现有 Web 端的 localStorage 数据结构。

- 桌面端与 Web 端共用 Vue 业务代码；
- 计划继续保存在当前 WebView 的 localStorage 中；
- AI、地图、路线和天气仍然通过网络在线调用；
- 尚未实现离线地图、离线路线和本地 AI；
- 当前优先验证桌面窗口、地图 SDK、Cesium、国际化和现有计划流程是否可用。

## 环境要求

- Windows 10/11
- Rust stable MSVC
- Visual Studio C++ Build Tools
- WebView2
- Node.js + pnpm

## 命令

```powershell
# 桌面开发模式
pnpm desktop:dev

# 生成不带安装器的便携 EXE
pnpm desktop:build:portable

# 生成 NSIS 安装器
pnpm desktop:build:installer
```

便携 EXE 输出位置：

```text
src-tauri/target/release/trippath.exe
```

GitHub Actions 会将该原始可执行文件发布为 `TripPath-<版本>-windows-x64-portable.exe`。它不包含安装器，也不会写入安装器注册信息，但运行时仍要求 Windows 已安装 WebView2。

当前 Tauri 配置：

```text
应用名：TripPath
窗口标题：TripPath · Interactive Travel Planner
应用标识：cn.pedoc.trippath
默认窗口：1440 × 900
最小窗口：1024 × 640
```

## 当前验证结果

已验证：

```text
pnpm tauri info       通过
cargo check           通过
pnpm tauri build --no-bundle 通过
```

当前机器已经生成可运行的便携 EXE。NSIS/MSI 安装器需要额外下载 WiX/NSIS 工具链，本次构建过程中 GitHub 下载依赖出现网络中断，因此安装器没有完成；这不影响便携 EXE 的生成。

## 当前限制

### 数据

桌面版暂时继续使用 localStorage：

- 重装应用或清理 WebView 数据会影响计划；
- 计划不能直接通过 SQLite 文件迁移；
- 仍然使用现有计划备份和完整迁移功能。

后续再引入 SQLite 时，建议先增加 Repository 抽象，不直接修改 Vue 业务组件。

### 在线服务

桌面应用本身可以打开和编辑本地计划，但以下能力仍然需要网络：

- 高德、腾讯、Google、Mapbox 地图；
- POI 搜索；
- 路线查询；
- 天气更新；
- AI 识别和路线优化；
- Cesium World Imagery、World Terrain 和 3D 建筑。

### Provider Key

Tauri 桌面应用会使用不同于网页的 WebView Origin。高德、腾讯、Google 和 Mapbox 的 Key 域名限制需要单独验证，不能直接假设线上域名白名单在桌面应用中同样有效。

## 后续存储迁移建议

桌面版验证通过后再执行：

1. 抽象 `PlanRepository`；
2. Web 端继续使用 localStorage；
3. Tauri 端增加 SQLite JSON 文档表；
4. 首次启动自动迁移旧 localStorage；
5. 使用 `.tripplan` 作为跨 Web/桌面的单计划交换格式；
6. 后续再考虑 SQLCipher 或系统凭据库。

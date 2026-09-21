# 构建与部署说明

## 本地构建

```powershell
pnpm install --frozen-lockfile
pnpm type-check
pnpm test
pnpm build
```

生产静态文件输出在 `dist/`，可以部署到任意支持静态文件服务的托管平台。项目不包含任何正式 API Key、服务器凭据或固定生产环境配置；地图、天气和 AI 服务凭据由用户在应用内配置。

## Tauri 桌面版

```powershell
pnpm desktop:build:portable
```

该命令生成不带安装器的 Windows x64 可执行文件：

```text
src-tauri/target/release/trippath.exe
```

### GitHub Releases

`.github/workflows/release.yml` 在发布安装包后，会额外运行一次 `tauri build --no-bundle`，并将原始可执行文件发布为：

```text
TripPath-<版本>-windows-x64-portable.exe
```

该绿色版不创建安装器注册信息，但仍依赖 Windows 系统中的 WebView2；它不是包含运行时的完全离线单文件包。推送 `v*.*.*` 标签或手动运行“桌面版发布”工作流即可触发发布。

桌面端构建要求见 [Tauri 桌面版验证说明](../development/TAURI_DESKTOP.md)。

## 安全边界

- 不要把 `.env`、API Key、Token、私钥或服务器登录信息提交到仓库。
- 线上部署脚本和服务器配置不属于本开源项目，应该放在私有运维仓库中。
- 发布前请执行 `gitleaks dir .` 和 `trufflehog filesystem . --no-update`。

# 贡献指南

## 开发环境

- Node.js
- pnpm 12+
- Rust stable MSVC（仅构建 Tauri 桌面版时需要）

安装依赖并启动：

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

## 提交前检查

```powershell
pnpm type-check
pnpm test
pnpm build
```

如需运行 E2E 测试，请只通过当前终端的临时环境变量提供测试凭据，不要把凭据写入文件：

```powershell
$env:AMAP_TEST_KEY="测试 Key"
$env:AMAP_TEST_SECURITY_CODE="测试安全码"
pnpm test:e2e
```

## 提交规范

- 保持修改范围小而明确；
- 不提交 `node_modules`、`dist`、测试结果、`.env` 或任何服务凭据；
- 修改用户可见文案时同步检查中英文界面；
- 新增 Provider 时补充配置、测试和文档；
- Pull Request 请说明变更内容、验证命令和已知限制。

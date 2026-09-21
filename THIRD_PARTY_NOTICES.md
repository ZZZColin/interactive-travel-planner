# 第三方依赖说明

本项目通过 `pnpm-lock.yaml` 固定前端依赖版本，通过 `src-tauri/Cargo.lock` 固定 Rust 依赖版本。第三方依赖继续按照各自许可证发布，发布二进制或重新分发构建产物时应保留其许可证和版权声明。

主要直接依赖包括：

- Vue、Pinia、Element Plus、Vue I18n、Vite、Vitest、Vue TSC、PrimeIcons：以各自 npm 包内的许可证文件为准；
- OpenAI JavaScript SDK、Anthropic SDK、Google Maps API Loader：以各自包内的许可证和官方服务条款为准；
- Cesium：Apache-2.0；
- Mapbox GL JS：以包内 `LICENSE.txt` 及 Mapbox 服务条款为准；
- Tauri：Apache-2.0 或 MIT；
- Rust 依赖：以 `Cargo.lock` 对应 crate 的许可证和版权声明为准。

本文件不是对全部传递依赖许可证的替代清单。发布安装包前，请重新生成完整的依赖许可证清单并核对随包分发的 NOTICE 文件。

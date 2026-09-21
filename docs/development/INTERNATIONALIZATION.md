# 国际化实现说明

更新时间：2026-09-20

## 已支持语言

- 简体中文：`zh-CN`
- English：`en-US`

应用首次打开时优先读取 `interactiveTravel.locale.v1`，没有保存值时根据浏览器语言选择。首页和计划详情页顶部均提供语言切换按钮。

## 技术结构

- `vue-i18n`：应用级 locale、Element Plus locale 和后续结构化翻译入口；
- `src/i18n/index.ts`：语言状态、持久化、文档语言、标题、动态文本规则和兼容层；
- `src/i18n/legacy.en.json`：现有界面的静态英文词条；
- `LocaleSwitcher.vue`：全局语言切换入口；
- Element Plus：随应用语言在中文和英文包之间切换；
- AI：英文界面下自动要求模型使用英文输出用户可见字段；
- 天气和日期：请求语言及日期格式跟随当前 locale；
- 完整配置迁移：包含当前界面语言。

## 兼容现有界面

项目早期存在大量直接写在 Vue 模板和 TypeScript 中的中文文案。为了在不一次性重写所有业务组件的情况下完成可用的国际化，本项目提供 DOM 兼容翻译层：

1. 仅翻译已收录的静态界面词条和明确的动态格式；
2. 监听 Element Plus 弹层和异步组件；
3. 切回中文时恢复原始文本；
4. 不翻译计划名称、地点名称、用户备注、地点介绍和文本输入内容；
5. 新增界面应优先使用 `vue-i18n` 结构化 key，不应继续依赖兼容层。

## 新增文案规范

推荐：

```vue
<script setup lang="ts">
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
</script>

<template>
  <button>{{ t('module.action') }}</button>
</template>
```

并同时在 `src/i18n/index.ts` 的中英文 messages 中增加对应 key。

兼容层只用于已有文案迁移，新功能必须使用结构化翻译。

## 不应翻译的数据

以下内容应保持用户或服务商返回的原文：

- 用户创建的计划名称；
- POI 和行政区名称；
- 用户备注；
- 地点介绍和攻略原文；
- API Key、模型名称和 Provider 名称；
- AI 系统提示词的用户自定义内容。

## 验证

- 单元测试：`src/i18n/__tests__/i18n.test.ts`
- E2E：`tests/e2e/i18n.spec.ts`

E2E 覆盖：

- 中英文切换；
- locale 持久化；
- 页面标题和 `html[lang]`；
- 首页核心界面；
- 计划详情页核心界面；
- 用户计划和地点内容保持原文。

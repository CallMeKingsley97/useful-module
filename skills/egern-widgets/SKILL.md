---
name: egern-widgets
description: 为 Egern generic 小组件提供设计、实现、重构与排错工作流。用于根据需求文档、接口说明或现有脚本生成或修改 Egern Widget DSL、模块 YAML 与多尺寸布局，特别适合需要同时兼容 systemSmall、systemMedium、systemLarge 以及锁屏 accessory 规格，并要求避免文本挤压、区域重叠和信息层级失衡的场景。
---

# Egern Widgets

## 概述

使用这个 skill 处理 Egern 小组件的完整交付：

- 新建一个小组件脚本与对应模块配置
- 把已有需求文档落成 `modules/*.js` 与 `*.yaml`
- 重构已有小组件，使其真正适配小、中、大尺寸
- 修复文本过长、布局挤压、区域重叠、锁屏显示不清晰等问题

优先交付可运行的 Egern `generic` 脚本。若用户没有特别说明，默认同时产出：

- 小组件脚本：`modules/<name>.js`
- 模块配置：`<name>.yaml`
- 需求文档或设计说明：仅在用户明确要求，或仓库已有同类习惯时补充

## 工作流

### 1. 先确认组件信息层级

在编码前先把信息按优先级分成三层：

- 核心信息：用户第一眼必须看到的结论、数值或状态
- 次级信息：辅助理解核心信息的上下文
- 可牺牲信息：装饰、补充指标、长描述、次要列表

如果需求很多，不要尝试把所有信息塞进每个尺寸。先删减低优先级内容，再设计布局。

### 2. 先建视图模型，再写 DSL

先整理一个稳定的视图模型，再生成 Widget DSL。推荐至少拆成：

- 数据层：请求、解析、缓存、容错
- 视图模型层：把原始数据转成标题、主指标、标签、状态文案
- 布局层：按 `ctx.widgetFamily` 输出不同 DSL

不要在 `buildSmall/buildMedium/buildLarge` 里直接混写复杂请求逻辑。

### 3. 按 family 分流，不要硬缩放

至少显式实现以下布局：

- `systemSmall`
- `systemMedium`
- `systemLarge`

锁屏规格单独降级：

- `accessoryCircular`
- `accessoryRectangular`
- `accessoryInline`

如果未单独处理 `systemExtraLarge`，默认复用 `systemLarge` 思路，但要先确认信息密度是否需要扩展。

### 4. 用安全布局规则避免重叠

Egern Widget DSL 没有复杂绝对定位系统，布局安全依赖内容约束，而不是“叠层修补”。始终遵守：

- 每个尺寸只保留一个视觉主角
- 动态文本默认加 `maxLines`，必要时补 `minScale`
- 横向布局里，文本区尽量使用 `flex: 1`
- 用 `spacer` 吃掉剩余空间，不要靠魔法数字硬顶
- 容器只在图标、分隔条、卡片等明确场景使用固定 `width/height`
- 信息放不下时，优先删掉低优先级模块，不要继续压缩主信息

详细规则见 [layout-playbook.md](./references/layout-playbook.md)。

### 5. 优先用组件工厂减少重复

在脚本里优先抽这些基础工厂函数：

- `txt`
- `icon`
- `hstack`
- `vstack`
- `sp`
- `shell` 或其他统一外壳函数

这样做的目的不是抽象而抽象，而是统一：

- 间距
- 字号层级
- 背景风格
- 状态栏样式
- 错误卡样式

参考起步模板：[widget-starter.js](./assets/widget-starter.js)。

### 6. 数据层必须自带韧性

默认把以下能力视为标准配置，而不是可选增强：

- 环境变量校验
- 网络异常兜底
- `ctx.storage` 缓存
- `refreshAfter` 刷新建议
- 无数据时的错误卡或空状态

如果接口容易失败，优先保证“小组件还能显示”，其次才是“显示最新数据”。

### 7. 同步输出模块 YAML

如果是仓库内的小组件，通常需要同时维护：

- `scriptings` 中的 `generic` 脚本声明
- `widgets` 中的小组件注册
- `env` 的默认示例

参考模板：[module-starter.yaml](./assets/module-starter.yaml)。

## 尺寸策略

### `systemSmall`

只展示一个核心结论，加最多两组辅助信息。常见结构：

- 标题行
- 主指标或主文案
- 1 到 2 行摘要
- 底部状态

不要在 small 里做双栏、长列表或超过两层卡片嵌套。

### `systemMedium`

优先使用以下两种结构之一：

- 左右双区：左侧主叙事，右侧辅助指标
- 上下双区：上部主结论，下部列表或状态

如果有多项列表，通常最多展示 4 个；再多就截断、分组或汇总。

### `systemLarge`

把 large 当成“信息扩展版”，不是“medium 放大版”。常见结构：

- 顶部总览
- 中部 1 到 2 个重点卡片
- 底部补充指标、说明或状态

large 可以增加细节，但仍然要保证第一屏重点明确。

### accessory 规格

锁屏规格只保留极少信息：

- `accessoryCircular`：单指标或单图标 + 短文本
- `accessoryRectangular`：两行以内摘要
- `accessoryInline`：单行短句

不要把主屏信息原样挤进 accessory。

## 交付规则

### 默认文件组织

- 业务脚本放在 `modules/`
- 模块配置放在仓库根目录
- 需求说明放在 `prd/`，仅在需要时新增

### 默认命名

- 文件名使用 kebab-case
- `scriptings[].generic.name` 与 `widgets[].name` 尽量一致
- 环境变量名使用全大写下划线风格

### 代码风格

- 用普通 JavaScript，避免依赖 Egern 环境外不可用的库
- 注释只解释关键流程、缓存策略、尺寸分流原因
- 文案、报错、提示统一使用中文

## 完成前检查

交付前逐项检查：

- 是否显式处理了 `systemSmall/systemMedium/systemLarge`
- 是否给所有动态长文本设置了 `maxLines`，必要时补了 `minScale`
- 是否存在会被挤压的横向文本区；若有，是否用了 `flex: 1` 或降级文案
- 是否给无数据、配置缺失、网络失败提供了兜底
- 是否同步更新了模块 YAML
- 是否保留了统一的 `shell/footer/errorWidget` 风格入口

## 资源

按需读取这些资源，不要一次性全部载入：

- DSL 与 API 速查： [egern-dsl-cheatsheet.md](./references/egern-dsl-cheatsheet.md)
- 多尺寸与防重叠策略： [layout-playbook.md](./references/layout-playbook.md)
- 通用脚本起步模板： [widget-starter.js](./assets/widget-starter.js)
- 通用模块配置模板： [module-starter.yaml](./assets/module-starter.yaml)

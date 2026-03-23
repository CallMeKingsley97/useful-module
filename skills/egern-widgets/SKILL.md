---
name: egern-widgets
description: 为 Egern generic 小组件提供设计、实现、重构与排错工作流。用于根据需求文档、接口说明或现有脚本生成或修改 Egern Widget DSL、模块 YAML 与多尺寸布局，特别适合需要同时兼容 systemSmall、systemMedium、systemLarge 以及锁屏 accessory 规格，并要求默认采用克制、平铺、可读性优先的 UI，避免文本挤压、区域重叠和信息层级失衡的场景。
---

# Egern Widgets

## 概述

使用这个 skill 处理 Egern 小组件的完整交付：

- 新建一个小组件脚本与对应模块配置
- 把已有需求文档落成 `modules/*.js` 与 `*.yaml`
- 重构已有小组件，使其真正适配小、中、大尺寸
- 修复文本过长、布局挤压、区域重叠、锁屏显示不清晰等问题
- 默认采用简单、平铺、单层信息区的 UI，不做花哨视觉堆叠

优先交付可运行且遵循标准 DSL 约束的 Egern `generic` 脚本。若用户没有特别说明，默认同时产出：

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

### 3.1 布局必须落在标准 DSL 能力内

布局描述必须能直接映射到标准文档定义的元素与属性，不要假设不存在的渲染能力。始终遵守：

- 根节点返回 `type: 'widget'`
- 布局只使用标准元素：`widget`、`stack`、`text`、`image`、`spacer`、`date`
- 排版优先依赖 `direction`、`alignItems`、`gap`、`padding`、`flex`
- 文本收敛优先依赖 `maxLines` 与 `minScale`
- 分隔效果、页脚、标签行都要用标准元素组合实现，不要发明 `separator` 之类的额外元素
- 固定尺寸只用于图标、图片或稳定视觉，不用于长文本容器
- 不要假设绝对定位、z-index、grid、overlay、自由拖拽坐标等标准文档未定义的能力

### 4. 用安全布局规则避免重叠

Egern Widget DSL 没有复杂绝对定位系统，布局安全依赖内容约束，而不是“叠层修补”。始终遵守：

- 每个尺寸只保留一个视觉主角
- 动态文本默认加 `maxLines`，必要时补 `minScale`
- 横向布局里，文本区尽量使用 `flex: 1`
- 用 `spacer` 吃掉剩余空间，不要靠魔法数字硬顶
- 头部行下方如果紧接主标题、状态文案或 summary，必须显式留出纵向间距，避免图标圆块、时间胶囊与下一行内容视觉贴边
- 固定 `width/height` 只留给图标、分隔条、数值徽标等稳定元素，不给动态文本容器和大块信息区
- 小组件里的 `stack` / 背景块只用于排版，不得包装成外层卡片再塞内层卡片、摘要卡、明细卡或状态卡
- 信息放不下时，优先删掉低优先级模块，不要继续压缩主信息

详细规则见 [layout-playbook.md](./references/layout-playbook.md)。

### 4.1 主屏尺寸默认采用平铺模式，且禁止卡片式嵌套

除非需求明确要求特定视觉风格，否则 `systemSmall`、`systemMedium`、`systemLarge` 默认都走平铺布局，不做花哨视觉，也不允许任何卡片式嵌套。不要引入：

- hero card
- 环形进度
- 多张摘要卡并列
- 大面积背景图或图片主视觉
- 卡片内再嵌卡片
- 外层卡片包裹摘要卡、明细卡、状态卡
- 用多个独立背景块把内容包装成卡片矩阵或卡片组
- 依赖阴影、渐变、装饰块制造层级

判断标准：

- 只要一个主屏 family 里出现两层独立的 card-like 背景分区，就视为高风险结构，应回退为平铺行/列
- `stack`、`padding`、`backgroundColor` 只能用于信息分组和留白，不能组合成“外卡包内卡”的视觉结构

平铺模式的默认策略：

- `systemSmall`：标题行 + 简单分隔效果 + 1 个主指标或 2 条紧凑行 + 底部状态
- `systemMedium`：标题行 + 简单分隔效果 + 单列平铺列表或轻量双列 + 底部状态
- `systemLarge`：标题行 + 简单分隔效果 + 1 条 summary + 展开列表 + 底部状态

选择规则：

- 当列表项 `<= 2` 或单项文案偏长时，`systemMedium` 优先单列平铺
- 当列表项 `>= 3` 且字段较短时，`systemMedium` 可拆成轻量双列，但每列仍保持单层结构
- 任一 family 只允许一个外壳层级：`widget` 根节点 + 平铺行/列，不再额外包“主卡壳”
- `systemLarge` 只增加行数、分组或 summary，不恢复复杂卡片层级
- 背景默认优先 `backgroundColor`；只有确有必要时才使用克制的 `backgroundGradient`，避免把 `backgroundImage` 当主视觉

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

不要在 small 里做双栏、长列表、多层卡片或复杂图片主视觉。

### `systemMedium`

中尺寸附加规则：
- medium 默认保持单层结构，优先单列或轻量双列平铺
- 任何信息分组只能表现为平铺行/列，不得包装成左右双卡、主卡 + 副卡、卡片中再套卡片
- 避免在 row 里面再套复杂 row，尤其不要左右区里再各自塞多组复合区块
- 同一屏最多保留一个主信息区，其他内容只能是辅助行或轻量指标
- fixed width 只允许用于图标、时间、数值徽标等稳定区域，不用于混合文本容器
- 当 medium 变拥挤时，先删次要文案、标签和额外统计，再考虑缩小文本

优先使用以下两种结构之一：

- 单列平铺：`header + 3~4 行列表/状态`
- 轻量双列：每列 1~2 组短字段，列内仍保持平铺行，不做复杂卡片

如果有多项列表，通常最多展示 4 个；再多就截断、分组或汇总。

### `systemLarge`

把 large 当成“信息扩展版”，不是“medium 放大版”。常见结构：

- 顶部总览
- 中部 summary + 展开平铺行
- 底部补充说明或状态

large 可以增加细节，但仍然要保持平铺、单层和第一屏重点明确，不得恢复主卡、摘要卡、明细卡或任何卡中卡结构。

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
- 是否彻底消除了卡片内嵌卡片、并列卡片抢高度、外层背景块包内层背景块等高风险结构
- 是否给无数据、配置缺失、网络失败提供了兜底
- 是否同步更新了模块 YAML
- 是否保留了统一的 `shell/footer/errorWidget` 风格入口

## 资源

按需读取这些资源，不要一次性全部载入：

- DSL 与 API 速查： [egern-dsl-cheatsheet.md](./references/egern-dsl-cheatsheet.md)
- 多尺寸与防重叠策略： [layout-playbook.md](./references/layout-playbook.md)
- 通用脚本起步模板： [widget-starter.js](./assets/widget-starter.js)
- 通用模块配置模板： [module-starter.yaml](./assets/module-starter.yaml)

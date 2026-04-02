# Egern 多尺寸布局手册

当任务涉及 `systemSmall / systemMedium / systemLarge` 兼容，或用户明确提到“不要挤压、不要重叠、要自适应”时，优先读取本文件。

## 设计目标

Egern 小组件的布局目标不是“放进更多内容”，而是：

- 一眼读懂
- 不挤压主信息
- 动态文本不会撞到其他区域
- 不同尺寸的信息密度合理递增

## 信息密度分配

### `systemSmall`

适合：

- 1 个主指标
- 1 个核心结论
- 1 到 2 行辅助信息

不适合：

- 双栏
- 长列表
- 复杂卡片网格
- 超过两层的嵌套分区

推荐模式：

- 标题 + 主数字 + 摘要 + 状态
- 图标 + 结论 + 次级说明

### `systemMedium`

适合：

- 单列平铺列表
- 轻量双列短字段
- 上主下辅

核心认知：

- medium 增加的主要是宽度，不是高度
- 不要把 medium 当成 `systemSmall` 再多塞几行的版本
- 只要文案长度不稳定，medium 默认优先单列平铺

推荐控制：

- 同屏最多 2 个平铺分区
- 单个列表通常不超过 4 项
- 每个分区只保留一个重点
- 不允许左右双卡、上下叠卡、主卡包副卡等卡片式组织方式
- `结果` 摘要最多 2 行，其他正文默认单行

### `systemLarge`

适合：

- 顶部总览
- 中部 summary + 展开平铺行
- 底部补充明细或状态

large 的本质是“可解释性增强”，不是“内容堆满”，也不是恢复多层卡片容器。

## 统一标准模板

本手册现将中小尺寸防重叠方案提升为统一标准，后续主屏小组件默认遵守以下模板。

### `systemSmall` 统一模板

只允许保留 `5` 个视觉块：

1. 标题
2. 主状态或主指标
3. 结果摘要，最多 `2` 行
4. 单条元信息，如连签或最近时间，二选一
5. 短尾注

强制规则：

- 不再额外保留分隔区、双 footer、重复时间
- 不展示脚本名、长操作提示、长调度说明
- 一旦发生挤压，先删低优先级行，不靠更小字号硬塞

### `systemMedium` 统一模板

默认结构：

1. 标题
2. 可选分隔
3. 状态
4. 结果摘要，最多 `2` 行
5. `1` 到 `2` 条元信息
6. 可选短尾注

强制规则：

- 总业务信息控制在 `4` 到 `5` 条以内
- 默认优先单列平铺，只有字段很短时才允许轻量双列
- 不展示完整脚本名、长操作文案、调试提示
- footer 不得与正文重复显示相同时间或说明

### `systemLarge` 统一模板

- 把扩展说明、脚本名、定时信息下放到 large
- large 增加的是解释性与行数，不是卡片层级
- 即使是 large，也只允许单层平铺展开

## 防挤压与防重叠规则

### 1. 任何动态文本都必须可收缩

默认动作：

- 单行文本加 `maxLines: 1`
- 可能变长的标题和数值加 `minScale`
- 允许换行的说明控制最大行数

示例：

```javascript
txt(vm.title, 12, "semibold", "#FFFFFF", {
  maxLines: 1,
  minScale: 0.7
})
```

### 2. 横向布局优先给文本留弹性空间

如果一行内有：

- 图标
- 文本
- 右侧指标

则中间文本区优先使用 `flex: 1`，右侧指标保持自然宽度或短文本。

示例：

```javascript
hstack([
  icon("star.fill", 12, accent),
  vstack([
    txt(vm.name, 11, "medium", "#FFFFFF", { maxLines: 1, minScale: 0.7 })
  ], { flex: 1 }),
  txt(vm.value, 11, "bold", "#FFFFFF")
], { gap: 6 })
```

### 3. 用 `spacer` 分配余量，不用硬编码顶开

优先：

```javascript
hstack([
  txt("标题", 12, "bold"),
  sp(),
  txt("状态", 10, "medium")
])
```

不要依赖大量固定宽度去“猜”剩余空间。

### 4. 固定尺寸只给稳定元素

适合固定 `width/height` 的元素：

- 图标
- 图片
- 分隔线
- 数值徽标
- 明确大小的装饰块

不适合轻易固定尺寸的元素：

- 动态标题
- 动态摘要
- 可变数字组合
- 承载多行信息的大块容器

### 5. 内容超载时先降级，不要硬塞

优先降级顺序：

1. 缩短文案
2. 减少列表项数量
3. 隐藏低优先级统计
4. 把复杂信息移到 larger family

不要把所有东西都保留，再靠更小字号硬塞进去。

### 6. 用户明确要求“简单、铺平、不花哨”时，直接切平铺模式

这是主屏尺寸的安全降级模板，优先级高于“继续优化复杂卡片”：

- `systemSmall`：`header + separator + 2 条紧凑行 + footer`
- `systemMedium`：`header + separator + 单列或双列平铺行 + footer`
- `systemLarge`：`header + separator + 1 条 summary + 展开平铺行 + footer`

适用场景：

- 已出现重叠
- 用户明确说不要复杂视觉
- 主体区存在多个卡片模块互相争抢高度
- 文案长度本身不稳定，继续保留卡片会反复出问题

平铺模式下应主动删除：

- hero card
- 环形主视觉
- 进度条主视觉
- 摘要卡 + 明细卡并列
- 卡片内再嵌套卡片
- 外层卡包内层卡
- 卡片矩阵、卡片组、左右双卡对抗布局

替代策略：

- 把“卡片标题 + 卡片内容”改成 1 条标签行 + 1~2 条平铺信息行
- 把“左右双卡”改成单列平铺，或仅在字段很短时改成轻量双列
- 把“摘要卡 + 明细卡”改成 summary 行 + 明细列表
- 把“状态卡”改成 footer 或尾部状态行

`systemMedium` 选型规则：

- 列表项少、文案长：单列平铺
- 列表项多、字段短：双列平铺
- 如果还在犹豫，默认单列，因为更稳

各尺寸额外限制：

- `systemSmall`：禁止任何大背景块分区，最多只保留标题、主体、尾部三段
- `systemMedium`：允许双列，但每列只能是短字段平铺，不能把每列做成独立卡片
- `systemLarge`：增加的是行数和解释信息，不是卡片层级；summary 下方只接平铺列表或分组行

## family 设计建议

### `buildSmall`

先回答三个问题：

- 用户第一眼必须看到什么
- 哪一行可以删
- 哪一行必须只占一行

经验规则：

- 标题一般 1 行
- 主数值尽量 1 行
- 摘要最多 2 行
- 底部状态保持极简

### `buildMedium`

适合这些模式：

- 对比两路数据
- 左侧主结论 + 右侧细节
- 顶部标题 + 下方分组列表

经验规则：

- 左右两区尽量平衡
- 如果一侧内容明显更长，改成上下布局
- 分隔条只用于加强结构，不要堆太多边框

### `buildLarge`

large 常见安全结构：

- 顶部：标题、状态、标签
- 中部：summary + 3 到 5 条平铺明细行
- 底部：注释、时间信息

经验规则：

- 主标题不要超过 1 行
- 中部不再拆成多张卡，而是保持单层展开
- 底部明细最好控制在 3 到 5 行

## accessory 设计建议

### `accessoryCircular`

只保留：

- 单个图标
- 单个数字
- 极短标签

### `accessoryRectangular`

只保留：

- 第一行结论
- 第二行摘要

### `accessoryInline`

输出单句：

- 结论 + 数值
- 标题词 + 核心状态

控制在一行可读范围，不要拼接太多字段。

## 推荐代码结构

```javascript
export default async function (ctx) {
  var vm = await loadViewModel(ctx);
  var family = ctx.widgetFamily || "systemMedium";

  if (family === "accessoryCircular") return buildCircular(vm);
  if (family === "accessoryRectangular") return buildRectangular(vm);
  if (family === "accessoryInline") return buildInline(vm);
  if (family === "systemSmall") return buildSmall(vm);
  if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(vm);
  return buildMedium(vm);
}
```

## 发布前自检

发布前至少检查：

- `systemSmall/systemMedium/systemLarge` 是否都保持单层平铺，不存在卡中卡
- 是否还有多个独立背景块在同一主屏内争抢高度
- 是否把可变文本塞进了固定宽高容器
- `systemMedium` 双列是否只是短字段平铺，而不是双卡布局
- `systemLarge` 是否通过增加行数扩展信息，而不是恢复卡片层级

- small 是否仍能一眼看懂
- medium 是否存在左右区域争抢宽度
- large 是否只是 medium 放大
- accessory 是否做了真正降级
- 标题、数值、标签、状态是否都做了长度控制

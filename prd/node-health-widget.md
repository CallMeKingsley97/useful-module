# 需求文档：节点体检卡小组件

## 1. 背景与目标
对代理用户来说，“延迟 78ms”远远不够。真正影响体验的是：**稳不稳、会不会抖、是否该切换**。节点体检卡要把节点或策略的健康度浓缩成一张 Apple 风格的小组件，既适合长期驻留，也能在出现波动时快速示警。

**核心目标：**
- 展示当前体检对象的延迟、抖动、丢包与综合健康状态
- 用趋势而不是单次 ping 告诉用户“稳定度”
- 在节点名无法直接读取时，仍能以“当前体检策略”作为可靠替代
- 通过克制的图形和留白体现苹果式专业感

## 2. 用户画像与使用场景
### 2.1 用户画像
- 重视稳定性的代理用户：不只是看快，还要看稳
- 流媒体和 AI 用户：需要避免高抖动和高丢包
- 喜欢长期放置状态卡的用户：希望小组件像 Apple Stocks 一样自然融入主屏

### 2.2 使用场景
- 出门前看一眼：当前策略是否健康，是否值得继续用
- 网络体验变差时：先看抖动和丢包，而不是盲目切节点
- 切换配置后：观察最近 10 分钟趋势是否稳定下来

## 3. Egern 能力边界与数据来源
### 3.1 能力边界
- Egern 公开 JavaScript API 未明确提供“当前实际活动节点名称”读取能力
- 因此 v1 把体检对象定义为：**用户指定的策略或节点标识**
- 如果用户使用策略组自动切换但无法取到真实落点，界面文案必须写“当前策略”而不是“当前节点”

### 3.2 数据采集方案
- companion `schedule` 脚本按固定频率使用 `ctx.http.get(url, { policy })` 主动探测
- 每轮探测对 `PROBE_URLS` 中的目标执行多次请求
- 记录：
  - 延迟：成功请求的平均耗时
  - 抖动：成功请求耗时的标准差
  - 丢包：超时或失败请求占比
  - 历史：最近 10 分钟窗口样本

### 3.3 推荐 storage key
- `node-health-summary`

## 4. 产品定义
### 4.1 一句话卖点
把“这个节点到底稳不稳”翻译成一张可长期驻留的玻璃体检卡。

### 4.2 核心输出
- 当前延迟
- 当前抖动
- 当前丢包率
- 综合健康评级
- 最近 10 分钟趋势
- 最近切换或最近成功探测时间

## 5. 数据契约
### 5.1 推荐 storage 结构
```json
{
  "policyName": "Proxy",
  "displayName": "东京-01",
  "targetKind": "policy",
  "probeWindowMinutes": 10,
  "sampleCount": 18,
  "updatedAt": "2026-03-18T10:00:00+08:00",
  "lastSwitchAt": "2026-03-18T09:42:00+08:00",
  "metrics": {
    "latencyMs": 86,
    "jitterMs": 14,
    "packetLossRate": 0.03,
    "healthScore": 84,
    "healthLevel": "healthy"
  },
  "history": [
    { "ts": "09:50", "latencyMs": 78, "packetLossRate": 0.00 },
    { "ts": "09:55", "latencyMs": 92, "packetLossRate": 0.05 },
    { "ts": "10:00", "latencyMs": 86, "packetLossRate": 0.03 }
  ],
  "flags": {
    "stale": false,
    "insufficientHistory": false,
    "probeFailed": false,
    "consecutiveFailures": 0
  }
}
```

### 5.2 字段定义
- `targetKind`：`policy` 或 `node`
- `displayName`：优先展示名；没有则回退 `policyName`
- `packetLossRate`：`0 ~ 1`
- `healthLevel`：`healthy` / `unstable` / `risk`
- `history`：Large 与 Medium 趋势使用；建议最多保留 12 个点

## 6. 指标口径与阈值
### 6.1 延迟分级
- 优：`0 - 120ms`
- 中：`121 - 220ms`
- 风险：`> 220ms`

### 6.2 抖动分级
- 优：`0 - 20ms`
- 中：`21 - 45ms`
- 风险：`> 45ms`

### 6.3 丢包分级
- 优：`0% - 2%`
- 中：`> 2% - 8%`
- 风险：`> 8%`

### 6.4 综合健康分计算
默认公式：
```text
healthScore = 100
  - latencyPenalty
  - jitterPenalty
  - packetLossPenalty
```

其中：
- `latencyPenalty = min(35, latencyMs / 8)`
- `jitterPenalty = min(25, jitterMs / 2)`
- `packetLossPenalty = min(40, packetLossRate * 200)`

评级规则：
- `healthy`：`score >= 75`
- `unstable`：`45 <= score < 75`
- `risk`：`score < 45`

## 7. 功能需求
### 7.1 核心功能
- 读取健康数据并展示主指标
- 生成综合状态文案，如“稳定”“轻微波动”“建议切换”
- 输出最近 10 分钟趋势
- 在无法确认真实节点时显示“当前策略体检”

### 7.2 增强功能
- 支持多探测目标地址，降低单站点波动误判
- 支持显示最近切换时间
- 支持点击跳转到 Egern 指定策略页或测速页

### 7.3 不纳入 v1
- 小组件内直接执行切换
- 自动触发节点更换
- 历史 24 小时曲线

## 8. 信息架构与多尺寸布局
### 8.1 统一信息层级
- 主焦点：当前延迟
- 辅助指标：抖动、丢包、综合评级
- 状态提示：健康等级与最近探测状态

### 8.2 `systemSmall`
- 顶部：标题 + 体检对象短名
- 中部：主指标延迟值，如 `86 ms`
- 底部：`稳定` / `轻微波动` + 一个次级指标

### 8.3 `systemMedium`
- 左侧：延迟大号数字 + 健康评级
- 右侧：迷你趋势线 + 抖动/丢包两行指标
- 底部：更新时间或最近切换信息

### 8.4 `systemLarge`
- 顶部：标题、对象、状态徽标
- 中部：主指标卡 + 四象限小结
  - 延迟
  - 抖动
  - 丢包
  - 健康分
- 底部：最近 10 分钟趋势与诊断文案

### 8.5 `accessoryCircular`
- 中心：延迟值或健康分
- 环形颜色：健康蓝绿、波动暖黄、风险柔红

### 8.6 `accessoryRectangular`
- 第一行：`东京-01 · 86 ms`
- 第二行：`抖动 14 · 丢包 3%`

### 8.7 `accessoryInline`
- 单行：`节点体检：86 ms，稳定`

## 9. 视觉规范
### 9.1 视觉方向
- 参考 Apple Fitness / Stocks 的轻量趋势感
- 不使用粗重仪表盘和炫彩速度表

### 9.2 主色板
- 健康：`#5CC48D`
- 波动：`#F4B65F`
- 风险：`#FF7D6E`
- 冷静主色：`#7AA7FF`
- 玻璃背景：低饱和海军蓝到石墨蓝渐变

### 9.3 图形语言
- 趋势线细、克制、留白充分
- 主数字是焦点，图形只是辅助理解
- 状态色只点亮关键标签和趋势节点

### 9.4 留白与字体
- 主数字优先大而稳，避免挤压
- 次级指标采用 `caption`/`footnote`
- 说明文案最多两行

## 10. 环境变量（Env）
- `TITLE`：默认 `节点体检`
- `REFRESH_MINUTES`：默认 `10`
- `OPEN_URL`：点击跳转地址
- `ACCENT_MODE`：`auto` / `cool` / `calm`
- `STORAGE_KEY`：默认 `node-health-summary`
- `POLICY_NAME`：体检策略名
- `DISPLAY_NAME`：可选展示名
- `PROBE_URLS`：逗号分隔，默认建议 `https://cp.cloudflare.com/,https://www.gstatic.com/generate_204`
- `PROBE_TIMEOUT_MS`：默认 `2500`
- `SAMPLES_PER_ROUND`：默认 `3`
- `WINDOW_MINUTES`：默认 `10`
- `SHOW_LAST_SWITCH`：默认 `true`

## 11. 状态与异常处理
### 11.1 单次探测失败
- 保留历史成功值
- 状态文案改为：`本轮探测失败`

### 11.2 连续失败
- `consecutiveFailures >= 3` 时进入风险态
- 主文案：`体检中断`
- 次文案：`请检查策略或目标站点`

### 11.3 当前节点名缺失
- 回退展示 `DISPLAY_NAME` 或 `POLICY_NAME`
- 文案使用“当前策略”而不是“当前节点”

### 11.4 历史样本不足
- Medium 不绘制完整趋势线，改为“样本积累中”
- Large 保留指标卡，不展示趋势分析结论

## 12. 验收标准
### 12.1 尺寸验收
- Small 一眼看懂主延迟与状态
- Medium 趋势线不与右侧指标抢空间
- Large 不是 Medium 放大版，而是增加解释能力

### 12.2 数据验收
- 成功探测：各指标正确计算
- 部分失败：丢包率和状态正确反映
- 连续失败：出现风险态与降级文案
- 节点名缺失：文案不误导

### 12.3 审美验收
- 视觉重心稳定，不显得像测速 App 截图
- 截图放在 iOS 主屏时与系统卡片气质相容

### 12.4 实现验收
- 渲染脚本只消费健康摘要，不承担探测逻辑
- 阈值、评分、状态口径在 companion 脚本与 widget 中保持一致

## 13. 开发拆解建议
1. 实现 schedule 探测脚本，输出统一健康摘要
2. 落地评分公式与阈值分级
3. 实现 view model 层，输出数字、评级、状态文案
4. 实现各尺寸布局与趋势图降级方案
5. 覆盖单次失败、连续失败、样本不足、策略名缺失

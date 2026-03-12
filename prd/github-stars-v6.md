# GitHub Stars 小组件 V6 需求说明

## 背景与问题
- 现有版本存在“历史曲线不出现”的问题，虽然逻辑已写，但渲染表现不稳定。
- 需要同时展示总 Star 数与历史增长趋势，并增强视觉效果与配置能力。

## 目标
- 展示实时总 Star 数。
- 展示 Star 历史增长趋势（默认曲线，支持柱状切换）。
- 在弱网/限流时可回退缓存数据。
- 提供可配置项，兼顾美观与性能。

## 非目标
- 不做完整时间序列精确统计（依赖 GitHub API 的分页采样）。
- 不引入外部依赖或图形库。

## 数据来源与策略
- 使用 GitHub REST API：
  - `GET /repos/{owner}/{repo}` 获取 `stargazers_count`。
  - `GET /repos/{owner}/{repo}/stargazers` 携带 `Accept: application/vnd.github.v3.star+json` 获取 `starred_at`。
- 采样策略：
  - 按分页等距抽样页面。
  - 每页抽样多个点位，构建趋势点（带 `count` 与 `time`）。
- 缓存策略：
  - `ctx.storage` 进行缓存；请求失败回退缓存并标注“缓存数据”。

## 交互与展示
- 标题栏：图标 + 标题 + 仓库名。
- 主数据：总 Star 数，右侧显示近期增量标签。
- 趋势图：
  - 默认曲线点位（line 模式）。
  - 可切换柱状（bar 模式）。
- 底部：时间范围 + 数据来源状态。

## 配置项
- `GITHUB_REPO`：仓库（必填）。
- `GITHUB_TOKEN`：可选，避免 API 限流。
- `TITLE`：标题。
- `CHART_COLOR`：图表主色。
- `CHART_STYLE`：`line` 或 `bar`。
- `SAMPLE_POINTS`：采样点数量（6-36）。
- `SAMPLES_PER_PAGE`：每页采样点（1-6）。
- `CHART_HEIGHT`：图表高度（28-80）。
- `DOT_SIZE`：曲线点大小（3-8）。
- `SHOW_RANGE`：是否展示时间范围（true/false）。
- `RENDER_STAGE`：调试阶段（0-3）。

## 边界与异常
- 仓库不存在/无权限：显示错误组件。
- API 限流：使用缓存并提示。
- 数据量过小：渲染占位点。

## 安全与合规
- 不在代码中硬编码 Token。
- 所有网络请求均捕获异常并提示。

## 验证方法
- 正常数据：指定热门仓库（如 `vuejs/vue`），应显示总数与趋势。
- 限流场景：不设置 Token，触发 403 时回退缓存。
- 空仓库：应显示 0 与占位图。

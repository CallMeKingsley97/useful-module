# 需求文档：GitHub Stars 多仓库追踪小组件

## 1. 背景
根据用户要求，废弃原有的单仓库+增长趋势方案，重构为：
- 仅展示当前 Star 数量
- 支持多仓库同时展示
- 科技感暗黑 UI

## 2. 技术方案
- 严格使用 Egern 官方 API: `ctx.http.get()`, `ctx.storage`, `ctx.widgetFamily`
- 支持 7 种 `widgetFamily` 尺寸自适应
- 10 分钟本地缓存 + 离线兜底

## 3. 创意亮点
- 编程语言色点标识 (18 种语言映射)
- 里程碑进度条 (Large 布局自动计算下一目标)
- Featured 仓库展示卡片 (Large 布局前 2 名)

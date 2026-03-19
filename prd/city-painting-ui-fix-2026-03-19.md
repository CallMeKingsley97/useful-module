# City Painting UI 修复计划

## 1. 修改目标
- 修复 `modules/city-painting.js` 中与现有 PRD 不一致的布局实现
- 优先提升 `systemMedium` 的可读性与空间利用率
- 同步修复 `systemSmall` 焦点错误、`accessory*` 文案过载、底部更新时间语义错误

## 2. 修改范围
- 目标文件：`modules/city-painting.js`
- 留痕文件：`prd/city-painting-ui-audit-2026-03-19.md`

## 3. 实施方案
1. `systemSmall`
- 去掉通用长标题主导地位
- 让“像《某幅画》”成为首焦点
- 压缩标签化列表感，保留城市、结论、天气/气质摘要、状态

2. `systemMedium`
- 改为左右双栏
- 左栏承载叙事：城市、结论、匹配理由、状态
- 右栏承载结构化信息：作品卡、天气卡

3. `systemLarge`
- 改为顶部概览 + 中部双卡 + 底部指标区
- 允许作品名和理由展示多行，避免主叙事被单行截断

4. `accessoryCircular/accessoryRectangular/accessoryInline`
- 降低文案密度
- 锁屏优先展示“像哪幅画”的结论，不再拼接过多天气细节

5. 时间与状态
- 底部相对时间改为使用真实数据时间
- 优先使用 `data.ts`，无值时退回天气观测时间

## 4. 边界情况
- 长城市名：需要缩放或截断，不能挤爆头部
- 长作品名：主屏允许 2 行，锁屏保守截断
- 天气字段为空：继续渲染占位文本，不中断布局
- 缓存态：相对时间必须反映缓存生成时刻，而不是脚本执行时刻

## 5. 验收标准
- `systemMedium` 明显呈现双栏结构
- `systemLarge` 可展示多行叙事，不再是单列列表放大版
- `systemSmall` 首屏焦点是作品结论
- `accessoryInline` 在长作品名场景下仍可 glance 阅读
- 缓存态底部时间与真实数据时间一致

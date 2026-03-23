# 主屏平铺化重构说明

## 1. 目标

本次重构统一处理以下文件的主屏 UI：

- `modules/moon-astronomical-night.js`
- `modules/city-painting.js`
- `modules/commute-eta.js`

同时将“平铺防重叠”规则沉淀到：

- `skills/egern-widgets/SKILL.md`
- `skills/egern-widgets/references/layout-playbook.md`

## 2. 核心规则

当用户明确要求：

- 不要花哨
- 不要重叠
- 改成 `github-stars.js` 那种简单结构
- 主屏先保证稳定
- 不准在小组件中内嵌任何卡片

则主屏尺寸统一切换到：

- `header`
- `separator`
- 平铺信息行
- `footer`

并强制执行以下一票否决规则：

- 任一主屏 family 不允许出现卡片内嵌卡片
- 不允许外层背景块再包摘要卡、明细卡、状态卡
- 不允许左右双卡、上下叠卡、卡片矩阵争抢高度
- 不允许把动态文本塞进固定宽高的大块容器

不再使用：

- hero card
- 环形主视觉
- 进度条主视觉
- 主卡 + 摘要卡 + 明细卡的嵌套结构
- 外卡包内卡
- 多张独立卡片并列抢高度

## 3. 各组件重构策略

### 3.1 月相与天文夜

- `systemSmall`：只保留 `月相`、`夜窗`
- `systemMedium`：使用一条夜间状态 summary，加两列短信息，但列内仍是平铺字段，不做双卡
- `systemLarge`：改成地点、月相、今晚夜窗、纯暗时长、日出日落的展开行，不恢复月相主卡

### 3.2 城市像哪幅画

- `systemSmall`：只保留 `作品`、`天气`
- `systemMedium`：只保留 `作品`、`天气`、`气质`，改为单列平铺或轻量双列
- `systemLarge`：增加 `作品注释`、`城市说明`，但只扩充平铺行数，不拆叙事卡

### 3.3 通勤 ETA

- `systemSmall`：只保留 `去公司`、`回家` 两条路线
- `systemMedium`：增加一条往返 summary，再展示两条展开路线，不再使用 route card
- `systemLarge`：增加 `往返综合` 行，但仍保持平铺，不恢复 route card

## 4. Mermaid 结构图

```mermaid
flowchart TD
    A["主屏平铺规则"] --> B["Header"]
    B --> C["Separator"]
    C --> D["Small: 2 条紧凑行"]
    C --> E["Medium: Summary + 平铺行"]
    C --> F["Large: Summary + 展开行"]
    D --> G["Footer"]
    E --> G
    F --> G
```

## 5. 验证要求

### 5.1 结构校验

- 主屏尺寸不再依赖 hero card / progress / circular visual 作为主体
- `systemMedium` 和 `systemLarge` 不再出现多卡片并排抢高度
- 任一主屏 family 不存在卡中卡、外层背景包内层背景、卡片矩阵
- 平铺行中的动态文本都带 `maxLines` 和 `minScale`
- 可变文本不落进固定宽高的大块容器

### 5.2 人工视觉校验

- `moon-astronomical-night` 主屏不再出现月相图占满主体区
- `city-painting` 主屏不再出现作品卡、天气卡、叙事卡并列
- `commute-eta` 主屏不再出现 route card 和 info banner 抢高度

### 5.3 替代模板

当历史实现已经形成卡片结构时，统一按以下方式替换：

- `主卡 + 摘要卡` → `summary 行 + 2~4 条平铺信息行`
- `左右双卡` → `单列平铺`，仅在短字段场景下降级为 `轻量双列`
- `状态卡` → `footer 状态行`
- `叙事卡 / 注释卡` → `底部说明文本`，并限制 `maxLines`

# 小组件

Egern 支持 iOS 小组件（Widget），允许用户在主屏幕和锁定屏幕上显示自定义内容。小组件通过 JavaScript 脚本生成 JSON 格式的 DSL 描述，由 Egern 渲染为原生小组件视图。

## 使用模块中的小组件

最简单的方式是安装包含小组件的模块，无需编写任何代码。

### 步骤

1. 进入 **工具** → **模块**，点击右上角 **+** 添加模块
2. 填入模块 URL，保存
3. 打开底部 **分析** 标签页，点击左上角按钮进入 **小组件画廊**，模块提供的小组件会自动出现在「模块小组件」区域
4. 如果模块需要参数（如 API Key），回到模块编辑页面，在 **Env** 区域添加对应的键值对

### 添加到 iOS 主屏幕

1. 长按主屏幕空白处，点击左上角 **+**
2. 搜索 **Egern**，选择小组件尺寸
3. 添加后长按小组件 → **编辑小组件**，选择要显示的小组件名称

## 自建小组件

如果你想创建自己的小组件，需要先有一个 **generic 类型**的脚本，然后创建小组件关联它。

### 1. 创建脚本

进入 **工具** → **脚本**，点击 **+**：

| 字段     | 填写内容                                        |
| -------- | ----------------------------------------------- |
| 名称     | 例如 `my-widget`                              |
| 类型     | 选择 `generic`                                |
| 文件位置 | 选**本地**，填写文件名如 `my-widget.js` |

点击 **编辑文件**，写入以下最简脚本：

```
export default async function(ctx) {  
  return {  
    type: 'widget',  
    children: [  
      {  
        type: 'text',  
        text: 'Hello, Widget!',  
        font: { size: 'title2', weight: 'bold' },  
        textColor: '#FFFFFF',  
      },  
    ],  
    backgroundColor: '#2D6A4F',  
    padding: 16,  
  };  
}
```

保存脚本。

### 2. 创建小组件

在 **分析** 标签页点击左上角按钮进入 **小组件画廊**，点击 **+**：

| 字段     | 填写内容                     |
| -------- | ---------------------------- |
| 名称     | 例如 `我的小组件`          |
| 脚本名称 | 选择刚才创建的 `my-widget` |

保存后，小组件会出现在画廊中并自动运行。

## 小组件配置

在主配置文件的 `widgets` 字段中定义小组件：

* **name** (string), 必填

  小组件名称，必须唯一。
* **script\_name** (string), 可选

  关联的通用脚本（`generic` 类型）名称。未设置时默认使用与小组件同名的脚本。
* **env** (object), 可选

  传递给脚本的环境变量（键值对）。详见 [环境变量](/zh-CN/docs/configuration/env)。

### 配置示例

```
scriptings:  
  - generic:  
      name: "weather-widget"  
      script_url: "https://example.com/scripts/weather.js"  
      timeout: 20  
  - generic:  
      name: "net-status-script"  
      script_url: "https://example.com/scripts/net-status.js"  
      timeout: 20  
  
widgets:  
  # name 与脚本同名，无需设置 script_name  
  - name: "weather-widget"  
    env:  
      CITY: "Shanghai"  
      UNIT: "celsius"  
  # name 与脚本不同名，需通过 script_name 指定关联脚本  
  - name: "network-monitor"  
    script_name: "net-status-script"
```

## 小组件 DSL

小组件脚本是一个 `generic` 类型的脚本，通过 `return` 返回 JSON 格式的 DSL 描述。DSL 采用树状结构，由嵌套的元素组成。

### 脚本上下文

小组件脚本执行时，可通过 `ctx` 对象获取上下文信息：

| 变量                 | 说明           |
| -------------------- | -------------- |
| `ctx.widgetFamily` | 小组件尺寸系列 |
| `ctx.env`          | 环境变量键值对 |

**小组件尺寸系列（widgetFamily）：**

| 值                       | 说明                   |
| ------------------------ | ---------------------- |
| `systemSmall`          | 主屏幕小尺寸           |
| `systemMedium`         | 主屏幕中尺寸           |
| `systemLarge`          | 主屏幕大尺寸           |
| `systemExtraLarge`     | 主屏幕超大尺寸（iPad） |
| `accessoryCircular`    | 锁定屏幕圆形           |
| `accessoryRectangular` | 锁定屏幕矩形           |
| `accessoryInline`      | 锁定屏幕内联           |

### 元素类型 (`type`)

| 值         | 说明                                       |
| ---------- | ------------------------------------------ |
| `widget` | 根容器，必须作为最外层元素。内部为垂直布局 |
| `stack`  | 弹性容器，支持水平 / 垂直方向              |
| `text`   | 文本                                       |
| `image`  | 图片（SF Symbol 或 Base64 图片）           |
| `spacer` | 弹性/固定间距                              |
| `date`   | 实时日期/时间显示（由系统自动更新）        |

### 通用属性

| 属性                   | 类型                                    | 适用范围                                             | 说明                                                                |
| ---------------------- | --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------- |
| `url`                | `string`                              | `widget`, `stack`, `text`, `image`, `date` | 点击后打开的 URL（deep link 或网页）                                |
| `opacity`            | `number`                              | `text`, `image`, `date`                        | 不透明度，`0.0` ~ `1.0`，默认 `1.0`                           |
| `width`              | `number`                              | `stack`, `image`                                 | 元素宽度，`0` 或不设置表示不限制                                  |
| `height`             | `number`                              | `stack`, `image`                                 | 元素高度，`0` 或不设置表示不限制                                  |
| `flex`               | `number`                              | 所有元素                                             | 弹性比例值。在父容器中按 flex 比例分配剩余空间                      |
| `padding`            | `number \| [top, right, bottom, left]` | `widget`, `stack`                                | 内边距。单个数值为四边等距，数组为 CSS 顺时针方向分别指定           |
| `gap`                | `number`                              | `widget`, `stack`                                | 子元素间距，默认 `0`                                              |
| `backgroundColor`    | `Color`                               | `widget`, `stack`                                | 背景颜色                                                            |
| `backgroundGradient` | `Gradient`                            | `widget`, `stack`                                | 背景渐变，优先级高于 `backgroundColor`                            |
| `backgroundImage`    | `string`                              | `widget`, `stack`                                | 背景图片 data URI（如 `"data:image/png;base64,..."`），优先级最高 |
| `borderRadius`       | `number \| "auto"`                     | `stack`, `image`                                 | 圆角半径。设为 `"auto"` 时自动匹配 Widget 容器的圆角形状          |
| `borderWidth`        | `number`                              | `stack`, `image`                                 | 边框宽度                                                            |
| `borderColor`        | `Color`                               | `stack`, `image`                                 | 边框颜色                                                            |
| `shadowColor`        | `Color`                               | `text`, `image`, `date`, `stack`             | 阴影颜色                                                            |
| `shadowRadius`       | `number`                              | `text`, `image`, `date`, `stack`             | 阴影模糊半径（设置此值才会生效）                                    |
| `shadowOffset`       | `Point`                               | `text`, `image`, `date`, `stack`             | 阴影偏移 `{x, y}`，默认 `{0, 0}`                                |

### widget（根容器）

根容器内部默认为**垂直布局**，子元素从上到下排列，对齐方式为左上角。

| 属性             | 类型       | 说明                                      |
| ---------------- | ---------- | ----------------------------------------- |
| `refreshAfter` | `string` | ISO 8601 时间，指示 Widget 在此时间后刷新 |

```
{  
  "type": "widget",  
  "children": [ ... ],  
  "gap": 8,  
  "padding": 16,  
  "backgroundColor": "#1A1A2E"  
}
```

### stack（弹性容器）

| 属性           | 类型          | 可选值                  | 说明                              |
| -------------- | ------------- | ----------------------- | --------------------------------- |
| `direction`  | `string`    | `"row"`, `"column"` | 排列方向，默认 `"row"`          |
| `alignItems` | `string`    | 见下表                  | 交叉轴对齐方式，默认 `"center"` |
| `children`   | `[Element]` | —                      | 子元素数组                        |

**alignItems 可选值：**

| 值           | row stack 中的含义 | column stack 中的含义 |
| ------------ | ------------------ | --------------------- |
| `"start"`  | 子元素顶部对齐     | 子元素左对齐          |
| `"end"`    | 子元素底部对齐     | 子元素右对齐          |
| `"center"` | 子元素垂直居中     | 子元素水平居中        |

```
{  
  "type": "stack",  
  "direction": "row",  
  "alignItems": "center",  
  "gap": 6,  
  "children": [  
    {"type": "text", "text": "CPU"},  
    {"type": "spacer"},  
    {"type": "text", "text": "42%"}  
  ]  
}
```

### text（文本）

| 属性          | 类型       | 说明                                                        |
| ------------- | ---------- | ----------------------------------------------------------- |
| `text`      | `string` | 显示的文本内容，支持 `\n` 换行                            |
| `font`      | `Font`   | 字体配置                                                    |
| `textColor` | `Color`  | 文本颜色，默认为系统主色                                    |
| `textAlign` | `string` | 文本对齐方式：`"left"`（默认）、`"center"`、`"right"` |
| `maxLines`  | `number` | 最大行数限制                                                |
| `minScale`  | `number` | 文本最小缩放比例（`0.0` ~ `1.0`），用于自适应缩小       |

```
{  
  "type": "text",  
  "text": "Hello, Widget!",  
  "font": {"size": "title2", "weight": "semibold"},  
  "textColor": "#FFFFFF",  
  "maxLines": 1,  
  "minScale": 0.5  
}
```

### image（图片）

通过 `src` 属性指定图片来源，支持两种 URI scheme：

* **SF Symbol** — `sf-symbol:<name>`，如 `"sf-symbol:wifi"`
* **Base64 图片** — `data:<mime>;base64,<data>`，如 `"data:image/png;base64,iVBORw0KGgo..."`

| 属性           | 类型        | 说明                                                                                                     |
| -------------- | ----------- | -------------------------------------------------------------------------------------------------------- |
| `src`        | `string`  | 图片来源 URI                                                                                             |
| `color`      | `Color`   | SF Symbol 着色（仅对 SF Symbol 生效）                                                                    |
| `resizeMode` | `string`  | `"contain"`（默认）或 `"cover"`                                                                      |
| `resizable`  | `boolean` | 是否可调整大小。设为 `false` 时使用原始尺寸，默认 `true`（当设置了 `width`/`height` 时自动启用） |

> 当未提供 `src` 或 URI 无法解析时，将显示一个占位图标。

```
{  
  "type": "image",  
  "src": "sf-symbol:wifi",  
  "width": 16,  
  "height": 16,  
  "color": "#FFFFFF"  
}
```

```
{  
  "type": "image",  
  "src": "data:image/png;base64,iVBORw0KGgo...",  
  "width": 40,  
  "height": 40,  
  "resizeMode": "cover",  
  "borderRadius": 8  
}
```

### spacer（间距）

| 属性       | 类型       | 说明                                            |
| ---------- | ---------- | ----------------------------------------------- |
| `length` | `number` | 固定长度。省略时为弹性 spacer，自动填充剩余空间 |

```
{"type": "spacer"}  
{"type": "spacer", "length": 10}
```

### date（日期）

系统会实时更新日期显示，无需 Widget 刷新。

| 属性          | 类型       | 说明                                                        |
| ------------- | ---------- | ----------------------------------------------------------- |
| `date`      | `string` | ISO 8601 格式的日期时间，如 `"2026-03-04T12:00:00Z"`      |
| `format`    | `string` | 显示样式，见下表。默认 `"date"`                           |
| `font`      | `Font`   | 字体配置                                                    |
| `textColor` | `Color`  | 文本颜色                                                    |
| `textAlign` | `string` | 文本对齐方式：`"left"`（默认）、`"center"`、`"right"` |
| `maxLines`  | `number` | 最大行数                                                    |
| `minScale`  | `number` | 最小缩放比例                                                |

**format 可选值：**

| 值             | 说明     | 示例输出      |
| -------------- | -------- | ------------- |
| `"date"`     | 日期     | March 4, 2026 |
| `"time"`     | 时间     | 12:00 PM      |
| `"relative"` | 相对时间 | 2 hours ago   |
| `"offset"`   | 偏移量   | +2 hours      |
| `"timer"`    | 计时器   | 2:30:15       |

```
{  
  "type": "date",  
  "date": "2026-03-04T12:00:00Z",  
  "format": "relative",  
  "font": {"size": "caption1", "weight": "medium"},  
  "textColor": "#FFFFFFDD"  
}
```

## 复合类型定义

### Color（颜色）

颜色支持两种模式：

**固定颜色** — 直接使用字符串：

```
"textColor": "#FF5733"  
"textColor": "#FF573380"  
"textColor": "rgba(255, 87, 51, 1.0)"
```

**自适应颜色** — 根据浅色/深色模式自动切换：

```
"textColor": {"light": "#000000", "dark": "#FFFFFF"}
```

**支持的颜色格式：**

| 格式     | 示例                 | 说明                                 |
| -------- | -------------------- | ------------------------------------ |
| 6 位 Hex | `#RRGGBB`          | 不透明颜色                           |
| 8 位 Hex | `#RRGGBBAA`        | 带透明度（最后两位为 Alpha）         |
| rgba()   | `rgba(R, G, B, A)` | R/G/B 为 `0~255`，A 为 `0.0~1.0` |

### Font（字体）

```
{"size": "headline", "weight": "bold"}  
{"size": 14, "weight": "bold"}  
{"size": 14, "weight": "bold", "family": "Menlo"}
```

所有字段均为可选。省略时默认使用 `body` 样式。

**size（字号）：** 支持语义样式名称（`string`，随系统字号动态缩放）或精确数值（`number`）。

| 语义样式          | 默认字号 |
| ----------------- | -------- |
| `"largeTitle"`  | 34       |
| `"title"`       | 28       |
| `"title2"`      | 22       |
| `"title3"`      | 20       |
| `"headline"`    | 17       |
| `"body"`        | 17       |
| `"callout"`     | 16       |
| `"subheadline"` | 15       |
| `"footnote"`    | 13       |
| `"caption1"`    | 12       |
| `"caption2"`    | 11       |

**weight（字重）：** `"ultraLight"`, `"thin"`, `"light"`, `"regular"`, `"medium"`, `"semibold"`, `"bold"`, `"heavy"`, `"black"`

**family：** 自定义字体名称（如 `"Menlo"`）。使用 `family` 时必须配合 `size` 来确定字号。

### Gradient（渐变）

```
{  
  "type": "linear",  
  "colors": ["#1A1A2E", "#16213E", "#0F3460"],  
  "stops": [0, 0.5, 1.0],  
  "startPoint": {"x": 0, "y": 0},  
  "endPoint": {"x": 1, "y": 1}  
}
```

**type：** `"linear"`（默认）, `"radial"`, `"angular"`

**通用属性：**

| 属性       | 类型         | 说明                                                 |
| ---------- | ------------ | ---------------------------------------------------- |
| `colors` | `[Color]`  | 渐变颜色数组（必填）                                 |
| `stops`  | `[number]` | 每个颜色的位置 `0.0~1.0`，数量须与 `colors` 一致 |

**linear 专用属性：**

| 属性           | 类型      | 默认值           | 说明           |
| -------------- | --------- | ---------------- | -------------- |
| `startPoint` | `Point` | `{x: 0, y: 0}` | 起点（左上角） |
| `endPoint`   | `Point` | `{x: 1, y: 1}` | 终点（右下角） |

**radial 专用属性：**

| 属性            | 类型       | 默认值               | 说明     |
| --------------- | ---------- | -------------------- | -------- |
| `center`      | `Point`  | `{x: 0.5, y: 0.5}` | 中心点   |
| `startRadius` | `number` | `0`                | 起始半径 |
| `endRadius`   | `number` | `100`              | 结束半径 |

**angular 专用属性：**

| 属性           | 类型       | 默认值               | 说明           |
| -------------- | ---------- | -------------------- | -------------- |
| `center`     | `Point`  | `{x: 0.5, y: 0.5}` | 中心点         |
| `startAngle` | `number` | `0`                | 起始角度（度） |
| `endAngle`   | `number` | `360`              | 结束角度（度） |

### Point（坐标点）

```
{"x": 0.5, "y": 0.5}
```

### flex（弹性布局）

当子元素设置了 `flex` 属性时，父容器（`widget` 或 `stack`）会将剩余空间按 `flex` 比例分配给这些子元素。未设置 `flex` 的子元素保持自然大小。

**等分布局（1:1）：**

```
{  
  "type": "stack",  
  "direction": "row",  
  "gap": 8,  
  "children": [  
    {"type": "text", "text": "Left", "flex": 1},  
    {"type": "text", "text": "Right", "flex": 1}  
  ]  
}
```

**比例布局（1:2）：**

```
{  
  "type": "stack",  
  "direction": "row",  
  "gap": 8,  
  "children": [  
    {"type": "text", "text": "Sidebar", "flex": 1},  
    {"type": "text", "text": "Content", "flex": 2}  
  ]  
}
```

**固定 + 弹性混合：**

```
{  
  "type": "stack",  
  "direction": "row",  
  "gap": 8,  
  "children": [  
    {"type": "image", "src": "sf-symbol:star.fill", "width": 20, "height": 20},  
    {"type": "text", "text": "Fills remaining space", "flex": 1}  
  ]  
}
```

### Padding（内边距）

```
16  
[8, 12]  
[8, 12, 8, 12]
```

单个数值为四边等距；数组支持以下格式：

| 元素数 | 格式                           | 说明                   |
| ------ | ------------------------------ | ---------------------- |
| 2      | `[vertical, horizontal]`     | 上下、左右分别等距     |
| 4      | `[top, right, bottom, left]` | CSS 顺时针方向分别指定 |

## 完整示例

### 配置文件

```
scriptings:  
  - generic:  
      name: "server-status"  
      script_url: "https://example.com/scripts/server-status.js"  
      timeout: 20  
      env:  
        API_URL: "https://api.example.com/status"  
  
widgets:  
  - name: "server-status"  
    env:  
      REGION: "Asia"
```

### 小组件脚本

```
export default async function(ctx) {  
  const apiUrl = ctx.env.API_URL;  
  const region = ctx.env.REGION;  
  
  let result;  
  try {  
    const resp = await ctx.http.get(apiUrl + '?region=' + region);  
    result = await resp.json();  
  } catch (e) {  
    return {  
      type: 'widget',  
      padding: 16,  
      children: [{  
        type: 'text',  
        text: 'Failed to load',  
        textColor: '#FF3B30'  
      }]  
    };  
  }  
  
  // 根据小组件尺寸调整布局  
  if (ctx.widgetFamily === 'accessoryRectangular') {  
    return {  
      type: 'widget',  
      children: [{  
        type: 'text',  
        text: result.name + ': ' + result.status,  
        font: { size: 'headline', weight: 'semibold' }  
      }]  
    };  
  }  
  
  return {  
    type: 'widget',  
    backgroundGradient: {  
      type: 'linear',  
      colors: ['#1a1a2e', '#16213e'],  
      startPoint: { x: 0, y: 0 },  
      endPoint: { x: 1, y: 1 }  
    },  
    padding: 16,  
    children: [  
      {  
        type: 'stack',  
        direction: 'row',  
        alignItems: 'center',  
        gap: 8,  
        children: [  
          {  
            type: 'image',  
            src: 'sf-symbol:server.rack',  
            color: '#007AFF',  
            width: 20,  
            height: 20  
          },  
          {  
            type: 'text',  
            text: result.name,  
            font: { size: 'headline', weight: 'bold' },  
            textColor: '#FFFFFF'  
          }  
        ]  
      },  
      { type: 'spacer' },  
      {  
        type: 'stack',  
        direction: 'column',  
        gap: 4,  
        children: [  
          {  
            type: 'text',  
            text: 'Region: ' + region,  
            font: { size: 'subheadline' },  
            textColor: { light: '#666666', dark: '#AAAAAA' }  
          },  
          {  
            type: 'text',  
            text: 'Status: ' + result.status,  
            font: { size: 'subheadline', weight: 'semibold' },  
            textColor: result.status === 'OK' ? '#34C759' : '#FF3B30'  
          }  
        ]  
      },  
      {  
        type: 'date',  
        date: new Date().toISOString(),  
        format: 'relative',  
        font: { size: 'caption2' },  
        textColor: '#888888'  
      }  
    ]  
  };  
}
```

## 模块中的小组件

模块文件也可以包含 `widgets` 字段来定义小组件。模块中定义的小组件在模块启用后自动生效。

```
name: "网络监控模块"  
description: "在小组件中显示网络状态"  
author: "module-author"  
  
scriptings:  
  - generic:  
      name: "net-monitor"  
      script_url: "https://example.com/scripts/net-monitor.js"  
      timeout: 20  
  
widgets:  
  - name: "net-monitor"
```

在主配置中引用模块时，可通过 `env` 为模块中的小组件传递环境变量：

```
modules:  
  - url: "https://example.com/net-monitor.yaml"  
    enabled: true  
    env:  
      REFRESH_INTERVAL: "300"  
      ALERT_THRESHOLD: "90"
```

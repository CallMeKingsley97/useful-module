# Egern DSL 与 API 速查

当你需要确认 Egern 小组件脚本的可用上下文、DSL 节点或属性时，读取本文件。

## 运行入口

Egern 小组件脚本使用 `generic` 类型，入口固定为：

```javascript
export default async function (ctx) {
  return { type: "widget", children: [] };
}
```

小组件脚本的根节点必须是：

```json
{ "type": "widget" }
```

## 常用 `ctx`

### `ctx.widgetFamily`

用于识别尺寸。常见值：

- `systemSmall`
- `systemMedium`
- `systemLarge`
- `systemExtraLarge`
- `accessoryCircular`
- `accessoryRectangular`
- `accessoryInline`

推荐写法：

```javascript
var family = ctx.widgetFamily || "systemMedium";

if (family === "accessoryCircular") return buildCircular(vm);
if (family === "accessoryRectangular") return buildRectangular(vm);
if (family === "accessoryInline") return buildInline(vm);
if (family === "systemSmall") return buildSmall(vm);
if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(vm);
return buildMedium(vm);
```

### `ctx.env`

读取环境变量。常用于：

- API Key
- 标题
- 强调色
- 刷新频率
- 坐标、城市、仓库名等业务参数

### `ctx.http`

用于请求接口：

```javascript
var resp = await ctx.http.get(url, {
  headers: { "User-Agent": "Egern-Widget" },
  timeout: 10000
});
```

常见注意点：

- `resp.status` 不是 `200` 时要主动报错或降级
- `resp.json()` / `resp.text()` 的 `body` 只能消费一次
- 网络失败时优先回退缓存

### `ctx.storage`

用于本地缓存：

```javascript
ctx.storage.setJSON("cache_key", data);
var cached = ctx.storage.getJSON("cache_key");
```

推荐缓存结构：

```json
{
  "data": {},
  "ts": 1710000000000
}
```

### `refreshAfter`

用于建议 Egern 在某个时间点后刷新：

```javascript
return {
  type: "widget",
  refreshAfter: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  children: []
};
```

## 常用 DSL 节点

### `widget`

根容器，默认垂直布局。常用属性：

- `children`
- `padding`
- `gap`
- `backgroundColor`
- `backgroundGradient`
- `backgroundImage`
- `refreshAfter`
- `url`

### `stack`

用于水平或垂直排版。常用属性：

- `direction: "row" | "column"`
- `alignItems: "start" | "center" | "end"`
- `children`
- `gap`
- `padding`
- `flex`
- `width`
- `height`
- `backgroundColor`
- `backgroundGradient`
- `borderRadius`
- `borderWidth`
- `borderColor`

### `text`

动态文本最容易引发挤压。默认补这些属性：

- `font`
- `textColor`
- `maxLines`
- `minScale`
- `textAlign`

安全示例：

```javascript
{
  type: "text",
  text: vm.title,
  font: { size: 12, weight: "semibold" },
  textColor: "#FFFFFF",
  maxLines: 1,
  minScale: 0.7
}
```

### `image`

主要用于 SF Symbol 和 Base64 图片：

```javascript
{
  type: "image",
  src: "sf-symbol:star.fill",
  width: 14,
  height: 14,
  color: "#FFD166"
}
```

### `spacer`

用于安全分配剩余空间：

```javascript
{ type: "spacer" }
{ type: "spacer", length: 8 }
```

### `date`

用于实时显示时间、相对时间，不必等下次刷新才更新：

```javascript
{
  type: "date",
  date: new Date().toISOString(),
  format: "relative",
  font: { size: 9, weight: "medium" },
  textColor: "rgba(255,255,255,0.35)"
}
```

## 常用样式策略

### 颜色

支持：

- `#RRGGBB`
- `#RRGGBBAA`
- `rgba(r,g,b,a)`
- `{ light: "...", dark: "..." }`

### 字体

推荐优先使用系统语义字号：

- `title2`
- `headline`
- `body`
- `subheadline`
- `caption1`
- `caption2`

需要精确控制时再用数字字号。

## 通用 helper 建议

推荐在每个组件脚本内保留这些 helper：

```javascript
function txt(text, size, weight, color, opts) {}
function icon(name, size, color) {}
function hstack(children, opts) {}
function vstack(children, opts) {}
function sp(length) {}
```

好处：

- 减少重复 DSL 片段
- 统一字号和颜色
- 更容易做多尺寸重构

## 关键限制

- 不要假设存在 DOM、CSS 或浏览器布局引擎
- 不要依赖绝对定位来修复重叠
- 不要让动态长文本裸奔
- 不要把主屏布局直接复制给锁屏规格

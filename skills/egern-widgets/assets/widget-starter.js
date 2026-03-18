// Egern 小组件通用起步模板
// 这个模板保持可运行，同时示范多尺寸分流、缓存骨架与安全布局写法。

var CACHE_KEY = "widget_starter_cache_v1";
var DEFAULT_REFRESH_MINUTES = 15;

export default async function (ctx) {
  var env = ctx.env || {};
  var family = ctx.widgetFamily || "systemMedium";
  var title = env.TITLE || "示例组件";
  var accent = env.ACCENT_COLOR || "#4F8CFF";
  var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 1, 1440);
  var refreshAfter = new Date(Date.now() + refreshMinutes * 60 * 1000).toISOString();

  var vm;
  try {
    vm = await loadViewModel(ctx, env);
  } catch (e) {
    return errorWidget("加载失败", safeMsg(e));
  }

  if (family === "accessoryCircular") return buildCircular(vm, accent);
  if (family === "accessoryRectangular") return buildRectangular(vm, accent);
  if (family === "accessoryInline") return buildInline(vm, accent);
  if (family === "systemSmall") return buildSmall(vm, title, accent, refreshAfter);
  if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(vm, title, accent, refreshAfter);
  return buildMedium(vm, title, accent, refreshAfter);
}

async function loadViewModel(ctx, env) {
  var forceRefresh = isTrue(env.FORCE_REFRESH);
  var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 1, 1440);
  var refreshMs = refreshMinutes * 60 * 1000;
  var now = Date.now();

  var cached = loadCache(ctx);
  var cacheFresh = cached && cached.ts && (now - cached.ts < refreshMs);
  if (cacheFresh && !forceRefresh) return normalizeViewModel(cached.data, false);

  // 按业务替换这里的数据获取逻辑。
  var data = {
    headline: env.HEADLINE || "核心结论",
    value: env.VALUE || "128",
    unit: env.UNIT || "pts",
    summary: env.SUMMARY || "这里放摘要说明，默认展示一条可读的简短文案。",
    detailA: env.DETAIL_A || "辅助信息 A",
    detailB: env.DETAIL_B || "辅助信息 B",
    trend: env.TREND || "稳定",
    openUrl: env.OPEN_URL || "",
    updatedAt: new Date().toISOString()
  };

  saveCache(ctx, { data: data, ts: now });
  return normalizeViewModel(data, true);
}

function normalizeViewModel(data, isLive) {
  return {
    headline: String(data.headline || "核心结论"),
    value: String(data.value || "--"),
    unit: String(data.unit || ""),
    summary: String(data.summary || ""),
    detailA: String(data.detailA || ""),
    detailB: String(data.detailB || ""),
    trend: String(data.trend || ""),
    openUrl: String(data.openUrl || ""),
    updatedAt: data.updatedAt || new Date().toISOString(),
    statusText: isLive ? "实时" : "缓存",
    statusColor: isLive ? "#34D39988" : "#FBBF2488"
  };
}

function buildSmall(vm, title, accent, refreshAfter) {
  return shell([
    header(title, accent, false),
    sp(6),
    txt(vm.headline, 12, "semibold", accent, { maxLines: 1, minScale: 0.7 }),
    hstack([
      txt(vm.value, 30, "bold", "#FFFFFF", { minScale: 0.55 }),
      txt(vm.unit, 11, "medium", "rgba(255,255,255,0.65)", { padding: [0, 0, 4, 0], maxLines: 1 })
    ], { alignItems: "end", gap: 4 }),
    txt(vm.summary, 10, "medium", "rgba(255,255,255,0.72)", { maxLines: 2, minScale: 0.7 }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, [14, 16, 12, 16]);
}

function buildMedium(vm, title, accent, refreshAfter) {
  return shell([
    header(title, accent, true),
    sp(6),
    separator(),
    sp(8),
    hstack([
      vstack([
        txt(vm.headline, 13, "semibold", accent, { maxLines: 1, minScale: 0.7 }),
        hstack([
          txt(vm.value, 34, "bold", "#FFFFFF", { minScale: 0.55 }),
          txt(vm.unit, 12, "medium", "rgba(255,255,255,0.65)", { padding: [0, 0, 6, 0], maxLines: 1 })
        ], { alignItems: "end", gap: 4 }),
        txt(vm.summary, 10, "medium", "rgba(255,255,255,0.7)", { maxLines: 3, minScale: 0.75 })
      ], { flex: 1, gap: 4, alignItems: "start" }),
      vstack([
        infoRow("趋势", vm.trend, accent),
        infoRow("信息 A", vm.detailA),
        infoRow("信息 B", vm.detailB)
      ], {
        flex: 1,
        gap: 6,
        padding: [10, 12, 10, 12],
        backgroundColor: "rgba(255,255,255,0.05)",
        borderRadius: 12
      })
    ], { gap: 10, alignItems: "start" }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl);
}

function buildLarge(vm, title, accent, refreshAfter) {
  return shell([
    header(title, accent, true),
    sp(6),
    separator(),
    sp(10),
    hstack([
      metricCard(vm.headline, vm.value, vm.unit, accent),
      summaryCard(vm.summary, vm.trend)
    ], { gap: 10, alignItems: "start" }),
    sp(10),
    vstack([
      infoRow("信息 A", vm.detailA),
      infoRow("信息 B", vm.detailB),
      infoRow("更新时间", vm.updatedAt)
    ], {
      gap: 6,
      padding: [10, 12, 10, 12],
      backgroundColor: "rgba(255,255,255,0.04)",
      borderRadius: 12
    }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, [16, 18, 14, 18]);
}

function buildCircular(vm, accent) {
  return {
    type: "widget",
    gap: 2,
    url: vm.openUrl || undefined,
    children: [
      sp(),
      icon("gauge.with.dots.needle.33percent", 16, accent),
      txt(vm.value, 13, "bold", "#FFFFFF", { minScale: 0.6, maxLines: 1 }),
      txt(vm.unit || vm.trend, 9, "medium", "rgba(255,255,255,0.65)", { maxLines: 1, minScale: 0.6 }),
      sp()
    ]
  };
}

function buildRectangular(vm, accent) {
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    gap: 3,
    children: [
      hstack([
        icon("gauge.with.dots.needle.33percent", 10, accent),
        txt(vm.headline, 10, "medium", "rgba(255,255,255,0.75)", { maxLines: 1, minScale: 0.7 }),
        sp(),
        txt(vm.statusText, 9, "bold", vm.statusColor, { maxLines: 1 })
      ], { gap: 4 }),
      txt(vm.value + (vm.unit ? " " + vm.unit : ""), 13, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.6 }),
      txt(vm.summary, 10, "medium", "rgba(255,255,255,0.55)", { maxLines: 1, minScale: 0.7 })
    ]
  };
}

function buildInline(vm, accent) {
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    children: [
      icon("gauge.with.dots.needle.33percent", 12, accent),
      txt(" " + vm.headline + " " + vm.value + (vm.unit ? " " + vm.unit : ""), 12, "medium", "#FFFFFF", {
        maxLines: 1,
        minScale: 0.6
      })
    ]
  };
}

function metricCard(headline, value, unit, accent) {
  return vstack([
    txt(headline, 12, "semibold", accent, { maxLines: 1, minScale: 0.75 }),
    hstack([
      txt(value, 32, "bold", "#FFFFFF", { minScale: 0.55 }),
      txt(unit, 11, "medium", "rgba(255,255,255,0.65)", { padding: [0, 0, 6, 0], maxLines: 1 })
    ], { alignItems: "end", gap: 4 })
  ], {
    flex: 1,
    gap: 6,
    padding: [12, 14, 12, 14],
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 14
  });
}

function summaryCard(summary, trend) {
  return vstack([
    txt("摘要", 11, "semibold", "rgba(255,255,255,0.75)"),
    txt(summary, 11, "medium", "#FFFFFF", { maxLines: 4, minScale: 0.75 }),
    sp(),
    txt("趋势：" + trend, 10, "medium", "rgba(255,255,255,0.55)", { maxLines: 1, minScale: 0.7 })
  ], {
    flex: 1,
    gap: 6,
    padding: [12, 14, 12, 14],
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 14
  });
}

function infoRow(label, value, accent) {
  return hstack([
    txt(label, 10, "medium", accent || "rgba(255,255,255,0.45)", { maxLines: 1, minScale: 0.7 }),
    sp(8),
    txt(value || "--", 10, "semibold", "#FFFFFF", { maxLines: 1, minScale: 0.65 })
  ], { gap: 4 });
}

function shell(children, refreshAfter, url, padding) {
  var widget = {
    type: "widget",
    padding: padding || [14, 16, 12, 16],
    gap: 0,
    refreshAfter: refreshAfter,
    backgroundGradient: {
      type: "linear",
      colors: ["#0F172A", "#111827", "#1E293B"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: children
  };
  if (url) widget.url = url;
  return widget;
}

function header(title, accent, showTime) {
  var children = [
    icon("square.grid.2x2.fill", 14, accent),
    txt(title, 12, "bold", accent, { maxLines: 1, minScale: 0.7 }),
    sp()
  ];
  if (showTime) {
    children.push({
      type: "date",
      date: new Date().toISOString(),
      format: "time",
      font: { size: 9, weight: "medium" },
      textColor: "rgba(255,255,255,0.35)"
    });
  }
  return hstack(children, { gap: 5 });
}

function footer(vm) {
  return hstack([
    txt(vm.statusText, 9, "bold", vm.statusColor, { maxLines: 1 }),
    sp(),
    {
      type: "date",
      date: vm.updatedAt,
      format: "relative",
      font: { size: 9, weight: "medium" },
      textColor: "rgba(255,255,255,0.3)"
    }
  ], { gap: 4 });
}

function separator() {
  return hstack([sp()], {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)"
  });
}

function errorWidget(title, message) {
  return {
    type: "widget",
    padding: 16,
    gap: 8,
    backgroundColor: "#111827",
    children: [
      hstack([
        icon("exclamationmark.triangle.fill", 14, "#F59E0B"),
        txt(title, 13, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 })
      ], { gap: 6 }),
      txt(message || "未知错误", 11, "medium", "rgba(255,255,255,0.7)", {
        maxLines: 4,
        minScale: 0.75
      })
    ]
  };
}

function txt(text, size, weight, color, opts) {
  var el = {
    type: "text",
    text: String(text == null ? "" : text),
    font: { size: size || "body", weight: weight || "regular" }
  };
  if (color) el.textColor = color;
  if (opts) {
    for (var k in opts) el[k] = opts[k];
  }
  return el;
}

function icon(name, size, color) {
  var el = {
    type: "image",
    src: "sf-symbol:" + name,
    width: size,
    height: size
  };
  if (color) el.color = color;
  return el;
}

function hstack(children, opts) {
  var el = {
    type: "stack",
    direction: "row",
    alignItems: "center",
    children: children
  };
  if (opts) {
    for (var k in opts) el[k] = opts[k];
  }
  return el;
}

function vstack(children, opts) {
  var el = {
    type: "stack",
    direction: "column",
    alignItems: "start",
    children: children
  };
  if (opts) {
    for (var k in opts) el[k] = opts[k];
  }
  return el;
}

function sp(length) {
  var el = { type: "spacer" };
  if (length != null) el.length = length;
  return el;
}

function clampNumber(value, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) n = min;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function isTrue(value) {
  var v = String(value || "").toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
}

function loadCache(ctx) {
  try {
    return ctx.storage.getJSON(CACHE_KEY);
  } catch (e) {
    return null;
  }
}

function saveCache(ctx, data) {
  try {
    ctx.storage.setJSON(CACHE_KEY, data);
  } catch (e) {
  }
}

function safeMsg(error) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  return String(error.message || error);
}

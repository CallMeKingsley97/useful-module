// 路由命中卡小组件
// 数据来源：
// 1. 观察脚本持续写入原始分桶数据
// 2. 汇总脚本定时写入 routing-hit-summary
// 3. 本脚本只负责读取摘要并做多尺寸玻璃卡渲染

var DEFAULT_STORAGE_KEY = "routing-hit-summary";
var DEFAULT_REFRESH_MINUTES = 15;

export default async function (ctx) {
  var env = ctx.env || {};
  var family = ctx.widgetFamily || "systemMedium";
  var title = env.TITLE || "路由命中";
  var storageKey = env.STORAGE_KEY || DEFAULT_STORAGE_KEY;
  var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 1, 1440);
  var maxRules = clampNumber(env.MAX_RULES || 3, 1, 8);
  var allowCircular = isTrue(env.ALLOW_CIRCULAR);
  var openUrl = String(env.OPEN_URL || "").trim();
  var refreshAfter = new Date(Date.now() + refreshMinutes * 60 * 1000).toISOString();

  var summary = ctx.storage.getJSON(storageKey);
  var vm = buildViewModel(summary, maxRules, refreshMinutes, openUrl);

  if (family === "accessoryCircular") return allowCircular ? buildCircular(vm) : buildRectangular(vm, title);
  if (family === "accessoryRectangular") return buildRectangular(vm, title);
  if (family === "accessoryInline") return buildInline(vm, title);
  if (family === "systemSmall") return buildSmall(vm, title, refreshAfter);
  if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(vm, title, refreshAfter);
  return buildMedium(vm, title, refreshAfter);
}

function buildViewModel(summary, maxRules, refreshMinutes, openUrl) {
  var empty = !summary || !summary.totals;
  var directCount = empty ? 0 : safeCount(summary.totals.directCount);
  var proxyCount = empty ? 0 : safeCount(summary.totals.proxyCount);
  var rejectCount = empty ? 0 : safeCount(summary.totals.rejectCount);
  var totalCount = directCount + proxyCount + rejectCount;

  var directPct = totalCount > 0 ? Math.round(directCount * 100 / totalCount) : 0;
  var proxyPct = totalCount > 0 ? Math.round(proxyCount * 100 / totalCount) : 0;
  var rejectPct = totalCount > 0 ? Math.round(rejectCount * 100 / totalCount) : 0;

  var recentRules = Array.isArray(summary && summary.recentRules) ? summary.recentRules.slice(0, maxRules) : [];
  recentRules = recentRules.map(function (item) {
    return {
      name: truncateText(item && item.name ? item.name : "--", 16),
      count: safeCount(item && item.count),
      route: normalizeRoute(item && item.route)
    };
  });

  var trend = Array.isArray(summary && summary.trend) ? summary.trend.slice(-6) : [];
  var mode = String(summary && summary.mode || "observed");
  var updatedAt = summary && summary.updatedAt ? summary.updatedAt : null;
  var flags = summary && summary.flags ? summary.flags : {};
  var stale = !!flags.stale;
  var lowSample = !!flags.lowSample;
  var rejectSpike = !!flags.rejectSpike;
  var status = deriveStatus(mode, totalCount, stale, lowSample, rejectSpike, proxyPct, directPct, rejectPct);

  return {
    totalCount: totalCount,
    directCount: directCount,
    proxyCount: proxyCount,
    rejectCount: rejectCount,
    directPct: directPct,
    proxyPct: proxyPct,
    rejectPct: rejectPct,
    recentRules: recentRules,
    trend: trend,
    mode: mode,
    updatedAt: updatedAt,
    sampleWindow: Number(summary && summary.windowMinutes) || refreshMinutes * 2,
    statusTitle: status.title,
    statusSubtitle: status.subtitle,
    statusColor: status.color,
    openUrl: openUrl,
    footerText: buildFooterText(mode, summary),
    updatedText: formatUpdatedText(updatedAt),
    hasData: totalCount > 0
  };
}

function buildSmall(vm, title, refreshAfter) {
  var headline = vm.hasData ? (vm.proxyPct + "%") : "--";
  var bottomText = vm.hasData
    ? ("直连 " + vm.directPct + "% · 拒绝 " + vm.rejectPct + "%")
    : "等待 companion script 写入";

  return shell([
    header(title, vm.statusColor, false),
    sp(8),
    metricBadge("代理占比", headline, vm.statusColor),
    sp(8),
    segmentedBar(vm, 10),
    sp(8),
    txt(vm.statusTitle, 12, "semibold", "#F5F7FA", { maxLines: 1, minScale: 0.7 }),
    txt(bottomText, 10, "medium", "rgba(231,237,245,0.72)", { maxLines: 2, minScale: 0.75 }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, [14, 15, 12, 15]);
}

function buildMedium(vm, title, refreshAfter) {
  return shell([
    header(title, vm.statusColor, true),
    sp(6),
    separator(),
    sp(10),
    hstack([
      vstack([
        metricBadge("代理占比", vm.hasData ? (vm.proxyPct + "%") : "--", vm.statusColor),
        sp(8),
        segmentedBar(vm, 12),
        sp(8),
        statTriplet(vm)
      ], { flex: 1, gap: 0, alignItems: "start" }),
      vstack([
        txt("最近命中", 11, "semibold", "rgba(231,237,245,0.84)", { maxLines: 1 }),
        sp(6),
        ruleTags(vm.recentRules, 3),
        sp(8),
        infoCard(vm.statusTitle, vm.statusSubtitle, vm.statusColor)
      ], {
        flex: 1,
        gap: 0,
        padding: [12, 12, 12, 12],
        backgroundColor: "rgba(255,255,255,0.05)",
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)"
      })
    ], { gap: 10, alignItems: "start" }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl);
}

function buildLarge(vm, title, refreshAfter) {
  return shell([
    header(title, vm.statusColor, true),
    sp(6),
    separator(),
    sp(10),
    hstack([
      vstack([
        metricBadge("代理占比", vm.hasData ? (vm.proxyPct + "%") : "--", vm.statusColor),
        sp(8),
        segmentedBar(vm, 12),
        sp(8),
        statTriplet(vm)
      ], {
        flex: 1,
        gap: 0,
        padding: [14, 14, 14, 14],
        backgroundColor: "rgba(255,255,255,0.05)",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.08)"
      }),
      vstack([
        txt("最近命中规则", 11, "semibold", "rgba(231,237,245,0.84)", { maxLines: 1 }),
        sp(6),
        ruleRows(vm.recentRules),
        sp(),
        infoCard(vm.statusTitle, vm.statusSubtitle, vm.statusColor)
      ], {
        flex: 1,
        gap: 0,
        padding: [14, 14, 14, 14],
        backgroundColor: "rgba(255,255,255,0.04)",
        borderRadius: 18,
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.07)"
      })
    ], { gap: 10, alignItems: "start" }),
    sp(10),
    trendCard(vm.trend),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, [16, 18, 14, 18]);
}

function buildCircular(vm) {
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    gap: 2,
    children: [
      sp(),
      icon("waveform.path.ecg", 14, vm.statusColor),
      txt(vm.hasData ? (vm.proxyPct + "%") : "--", 13, "bold", "#F5F7FA", { maxLines: 1, minScale: 0.6 }),
      txt("代理", 9, "medium", "rgba(231,237,245,0.72)", { maxLines: 1, minScale: 0.6 }),
      sp()
    ]
  };
}

function buildRectangular(vm, title) {
  var firstLine = vm.hasData
    ? ("代理 " + vm.proxyPct + "% · 直连 " + vm.directPct + "%")
    : "等待样本写入";
  var secondLine = vm.recentRules.length > 0
    ? ("最近：" + vm.recentRules.map(function (item) { return item.name; }).join(" / "))
    : vm.statusTitle;

  return {
    type: "widget",
    url: vm.openUrl || undefined,
    gap: 3,
    children: [
      hstack([
        icon("waveform.path.ecg", 10, vm.statusColor),
        txt(title, 10, "semibold", "rgba(231,237,245,0.84)", { maxLines: 1, minScale: 0.7 }),
        sp(),
        txt(vm.mode === "sampled" ? "采样" : "观察", 9, "bold", vm.statusColor, { maxLines: 1 })
      ], { gap: 4 }),
      txt(firstLine, 11, "bold", "#F5F7FA", { maxLines: 1, minScale: 0.7 }),
      txt(secondLine, 10, "medium", "rgba(231,237,245,0.65)", { maxLines: 1, minScale: 0.7 })
    ]
  };
}

function buildInline(vm, title) {
  var text = vm.hasData
    ? (title + "：代理 " + vm.proxyPct + "%，拒绝 " + vm.rejectPct + "%")
    : (title + "：等待样本");
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    children: [
      icon("waveform.path.ecg", 12, vm.statusColor),
      txt(" " + text, 12, "medium", "#F5F7FA", { maxLines: 1, minScale: 0.6 })
    ]
  };
}

function metricBadge(label, value, color) {
  return vstack([
    txt(label, 11, "medium", "rgba(231,237,245,0.68)", { maxLines: 1, minScale: 0.7 }),
    hstack([
      txt(value, 32, "bold", "#F5F7FA", { maxLines: 1, minScale: 0.55 }),
      txt("路由", 11, "medium", "rgba(231,237,245,0.55)", { maxLines: 1, padding: [0, 0, 5, 0] })
    ], { gap: 4, alignItems: "end" })
  ], {
    gap: 4,
    padding: [12, 12, 12, 12],
    backgroundGradient: {
      type: "linear",
      colors: ["rgba(255,255,255,0.08)", colorAlpha(color, 0.16)],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)"
  });
}

function segmentedBar(vm, height) {
  var total = Math.max(1, vm.totalCount);
  var directWidth = Math.max(0, Math.round(100 * vm.directCount / total));
  var proxyWidth = Math.max(0, Math.round(100 * vm.proxyCount / total));
  var rejectWidth = Math.max(0, 100 - directWidth - proxyWidth);

  return hstack([
    segmentBox(directWidth, height, "#5CC48D"),
    segmentBox(proxyWidth, height, "#5B8CFF"),
    segmentBox(rejectWidth, height, "#FF7D6E")
  ], {
    gap: 4,
    alignItems: "center"
  });
}

function segmentBox(weight, height, color) {
  return {
    type: "stack",
    flex: Math.max(1, weight),
    height: height,
    backgroundColor: colorAlpha(color, 0.92),
    borderRadius: height / 2,
    children: []
  };
}

function statTriplet(vm) {
  return hstack([
    smallStat("直连", vm.directPct + "%", "#5CC48D"),
    smallStat("代理", vm.proxyPct + "%", "#5B8CFF"),
    smallStat("拒绝", vm.rejectPct + "%", "#FF7D6E")
  ], { gap: 8, alignItems: "start" });
}

function smallStat(label, value, color) {
  return vstack([
    txt(label, 9, "medium", "rgba(231,237,245,0.58)", { maxLines: 1 }),
    txt(value, 12, "bold", color, { maxLines: 1, minScale: 0.75 })
  ], { flex: 1, gap: 2, alignItems: "start" });
}

function ruleTags(rules, max) {
  var list = rules && rules.length ? rules.slice(0, max) : [];
  if (list.length === 0) {
    return txt("暂无规则样本", 10, "medium", "rgba(231,237,245,0.55)", { maxLines: 1 });
  }
  return vstack(list.map(function (item) {
    return tag(item.name + " · " + item.count, routeColor(item.route));
  }), { gap: 6, alignItems: "start" });
}

function ruleRows(rules) {
  if (!rules || rules.length === 0) {
    return txt("暂无规则样本", 10, "medium", "rgba(231,237,245,0.55)", { maxLines: 1 });
  }
  return vstack(rules.map(function (item) {
    return hstack([
      tagDot(routeColor(item.route)),
      txt(item.name, 11, "medium", "#F5F7FA", { maxLines: 1, minScale: 0.75, flex: 1 }),
      sp(),
      txt(String(item.count), 11, "bold", "rgba(231,237,245,0.82)", { maxLines: 1 })
    ], { gap: 6, alignItems: "center" });
  }), { gap: 8, alignItems: "start" });
}

function infoCard(title, subtitle, color) {
  return vstack([
    txt(title || "--", 11, "semibold", color, { maxLines: 1, minScale: 0.75 }),
    txt(subtitle || "--", 10, "medium", "rgba(231,237,245,0.72)", { maxLines: 2, minScale: 0.75 })
  ], {
    gap: 4,
    padding: [10, 10, 10, 10],
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 14
  });
}

function trendCard(trend) {
  var items = trend && trend.length ? trend : [];
  return vstack([
    txt("最近趋势", 11, "semibold", "rgba(231,237,245,0.84)", { maxLines: 1 }),
    sp(8),
    items.length > 0 ? trendBars(items) : txt("样本积累中", 10, "medium", "rgba(231,237,245,0.55)", { maxLines: 1 })
  ], {
    gap: 0,
    padding: [12, 14, 12, 14],
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.07)"
  });
}

function trendBars(items) {
  var maxTotal = 1;
  for (var i = 0; i < items.length; i++) {
    var total = safeCount(items[i].direct) + safeCount(items[i].proxy) + safeCount(items[i].reject);
    if (total > maxTotal) maxTotal = total;
  }

  return hstack(items.map(function (item) {
    var total = safeCount(item.direct) + safeCount(item.proxy) + safeCount(item.reject);
    var barHeight = Math.max(10, Math.round(34 * total / maxTotal));
    return vstack([
      {
        type: "stack",
        width: 16,
        height: 36,
        alignItems: "end",
        children: [{
          type: "stack",
          width: 16,
          height: barHeight,
          backgroundGradient: {
            type: "linear",
            colors: ["rgba(91,140,255,0.95)", "rgba(92,196,141,0.9)"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 0, y: 1 }
          },
          borderRadius: 8,
          children: []
        }]
      },
      txt(item.slot || "--", 8, "medium", "rgba(231,237,245,0.55)", { maxLines: 1, minScale: 0.6 })
    ], { gap: 4, alignItems: "center", flex: 1 });
  }), { gap: 8, alignItems: "end" });
}

function footer(vm) {
  return hstack([
    txt(vm.footerText, 9, "medium", "rgba(231,237,245,0.48)", { maxLines: 1, minScale: 0.7 }),
    sp(),
    txt(vm.updatedText, 9, "medium", vm.statusColor, { maxLines: 1, minScale: 0.7 })
  ], { gap: 6, alignItems: "center" });
}

function tag(text, color) {
  return {
    type: "stack",
    padding: [5, 8, 5, 8],
    backgroundColor: colorAlpha(color, 0.12),
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colorAlpha(color, 0.22),
    children: [
      txt(text, 9, "semibold", color, { maxLines: 1, minScale: 0.72 })
    ]
  };
}

function tagDot(color) {
  return {
    type: "stack",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: color,
    children: []
  };
}

function shell(children, refreshAfter, url, padding) {
  var widget = {
    type: "widget",
    padding: padding || [14, 16, 12, 16],
    gap: 0,
    refreshAfter: refreshAfter,
    backgroundGradient: {
      type: "linear",
      colors: ["#0C1424", "#122033", "#1B2A40"],
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
    icon("waveform.path.ecg", 14, accent),
    txt(title, 12, "bold", accent, { maxLines: 1, minScale: 0.72 }),
    sp()
  ];
  if (showTime) {
    children.push({
      type: "date",
      date: new Date().toISOString(),
      format: "time",
      font: { size: 9, weight: "medium" },
      textColor: "rgba(231,237,245,0.35)"
    });
  }
  return hstack(children, { gap: 5, alignItems: "center" });
}

function separator() {
  return {
    type: "stack",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    children: []
  };
}

function txt(text, size, weight, color, opts) {
  var node = {
    type: "text",
    text: String(text == null ? "" : text),
    font: { size: size, weight: weight || "regular" }
  };
  if (color) node.textColor = color;
  opts = opts || {};
  assign(node, opts);
  return node;
}

function icon(name, size, color) {
  return {
    type: "image",
    src: "sf-symbol:" + name,
    width: size,
    height: size,
    color: color || "#FFFFFF"
  };
}

function hstack(children, opts) {
  return stack("row", children, opts);
}

function vstack(children, opts) {
  return stack("column", children, opts);
}

function stack(direction, children, opts) {
  var node = {
    type: "stack",
    direction: direction,
    children: children || []
  };
  assign(node, opts || {});
  return node;
}

function sp(length) {
  if (length) return { type: "spacer", length: length };
  return { type: "spacer" };
}

function assign(target, source) {
  var keys = Object.keys(source || {});
  for (var i = 0; i < keys.length; i++) {
    target[keys[i]] = source[keys[i]];
  }
  return target;
}

function deriveStatus(mode, totalCount, stale, lowSample, rejectSpike, proxyPct, directPct, rejectPct) {
  if (totalCount <= 0) {
    return {
      title: "还没有可用样本",
      subtitle: "等待观察或采样脚本写入统计",
      color: "rgba(199,208,221,0.88)"
    };
  }
  if (stale) {
    return {
      title: "数据已过期",
      subtitle: "当前展示的是上一次聚合结果",
      color: "rgba(199,208,221,0.88)"
    };
  }
  if (rejectSpike) {
    return {
      title: "拒绝偏高",
      subtitle: "优先检查拦截规则或误伤域名",
      color: "#FF7D6E"
    };
  }
  if (lowSample) {
    return {
      title: "样本偏少",
      subtitle: mode === "sampled" ? "当前为采样视角，建议继续积累样本" : "继续观察可得到更稳定结果",
      color: "#F4B65F"
    };
  }
  if (proxyPct >= directPct && proxyPct >= rejectPct) {
    return {
      title: "大多数请求正走代理",
      subtitle: mode === "sampled" ? "当前结果来自采样探测" : "规则分流看起来保持稳定",
      color: "#5B8CFF"
    };
  }
  if (directPct > proxyPct && directPct >= rejectPct) {
    return {
      title: "当前以直连为主",
      subtitle: "适合检查是否有更多站点未进入代理路径",
      color: "#5CC48D"
    };
  }
  return {
    title: "当前拒绝占比可见",
    subtitle: "建议关注规则命中是否符合预期",
    color: "#FF7D6E"
  };
}

function buildFooterText(mode, summary) {
  var windowMinutes = Number(summary && summary.windowMinutes) || 30;
  var prefix = mode === "sampled" ? "采样视角" : "观察视角";
  return prefix + " · " + windowMinutes + " 分钟窗口";
}

function formatUpdatedText(updatedAt) {
  if (!updatedAt) return "未更新";
  try {
    var date = new Date(updatedAt);
    var hh = String(date.getHours()).padStart(2, "0");
    var mm = String(date.getMinutes()).padStart(2, "0");
    return "更新 " + hh + ":" + mm;
  } catch (e) {
    return "已更新";
  }
}

function routeColor(route) {
  if (route === "direct") return "#5CC48D";
  if (route === "reject") return "#FF7D6E";
  return "#5B8CFF";
}

function colorAlpha(color, alpha) {
  if (String(color).indexOf("rgba(") === 0) return color;
  var hex = String(color || "").replace("#", "");
  if (hex.length !== 6) return color;
  var r = parseInt(hex.slice(0, 2), 16);
  var g = parseInt(hex.slice(2, 4), 16);
  var b = parseInt(hex.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

function truncateText(text, max) {
  var value = String(text || "");
  return value.length > max ? value.slice(0, max) : value;
}

function normalizeRoute(value) {
  var route = String(value || "").trim().toLowerCase();
  if (route === "direct" || route === "proxy" || route === "reject") return route;
  return "proxy";
}

function safeCount(value) {
  var n = Number(value);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function clampNumber(value, min, max) {
  var n = Number(value);
  if (!isFinite(n)) n = min;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function isTrue(value) {
  var text = String(value || "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

// 机场订阅监控小组件
// 设计重点：
// 1. 数据层负责多订阅请求、响应头解析、缓存回退与容错。
// 2. 视图模型层统一输出风险等级、进度、文案和配色。
// 3. 布局层严格按尺寸分流，避免在小尺寸里堆叠过多内容。

var DEFAULT_REFRESH_MINUTES = 30;
var DEFAULT_TIMEOUT_MS = 10000;
var DEFAULT_CACHE_PREFIX = "airport_subscribe_cache_v1_";
var DAY_MS = 24 * 60 * 60 * 1000;

export default async function (ctx) {
  var env = ctx.env || {};
  var family = ctx.widgetFamily || "systemMedium";
  var title = String(env.TITLE || "机场订阅洞察").trim() || "机场订阅洞察";
  var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 5, 1440);
  var timeoutMs = clampNumber(env.TIMEOUT_MS || DEFAULT_TIMEOUT_MS, 3000, 30000);
  var forceRefresh = isTrue(env.FORCE_REFRESH);
  var hideSensitive = isTrue(env.HIDE_SENSITIVE);
  var insecureTls = isTrue(env.INSECURE_TLS);
  var allowCircular = !isFalse(env.ALLOW_CIRCULAR);
  var refreshAfter = new Date(Date.now() + refreshMinutes * 60 * 1000).toISOString();

  var subscriptions;
  try {
    subscriptions = parseSubscriptions(env.SUBSCRIPTIONS_JSON || "[]");
  } catch (e) {
    return errorWidget("配置错误", safeMsg(e));
  }

  if (subscriptions.length === 0) {
    return errorWidget("缺少订阅", "请在 SUBSCRIPTIONS_JSON 中配置至少一个订阅链接");
  }

  var cacheKey = buildCacheKey(env.CACHE_KEY, subscriptions);
  var cached = loadCache(ctx, cacheKey);
  var cacheReady = hasUsableItems(cached && cached.items);
  var now = Date.now();
  var refreshMs = refreshMinutes * 60 * 1000;
  var cacheFresh = !!(cached && cached.ts && (now - cached.ts < refreshMs));

  var snapshot = null;
  var source = "live";

  if (cacheFresh && !forceRefresh) {
    snapshot = cached;
    source = "cached";
  } else {
    try {
      snapshot = await fetchSnapshot(ctx, subscriptions, {
        timeoutMs: timeoutMs,
        insecureTls: insecureTls,
        now: now,
        fallbackItems: cached && Array.isArray(cached.items) ? cached.items : []
      });
      if (hasUsableItems(snapshot.items)) {
        saveCache(ctx, cacheKey, snapshot);
      } else if (cacheReady) {
        snapshot = cached;
        source = "cached";
      } else {
        var errs = [];
        for (var i = 0; i < snapshot.items.length; i++) {
          errs.push(snapshot.items[i].name + ": " + (snapshot.items[i].error || "无信息"));
        }
        return errorWidget("获取失败", "所有订阅都未返回可用的用量信息。\n原因: " + errs.join(" | "));
      }
      if (source !== "cached") source = snapshot.source || "live";
    } catch (e) {
      if (cacheReady) {
        snapshot = cached;
        source = "cached";
      } else {
        return errorWidget("获取失败", safeMsg(e));
      }
    }
  }

  var vm = buildViewModel(snapshot, {
    title: title,
    hideSensitive: hideSensitive,
    source: source,
    refreshMinutes: refreshMinutes,
    now: Date.now()
  });

  if (family === "accessoryCircular") {
    return allowCircular ? buildCircular(vm) : buildRectangular(vm);
  }
  if (family === "accessoryRectangular") return buildRectangular(vm);
  if (family === "accessoryInline") return buildInline(vm);
  if (family === "systemSmall") return buildSmall(vm, refreshAfter);
  if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(vm, refreshAfter);
  return buildMedium(vm, refreshAfter);
}

// ============== 数据层 ==============

async function fetchSnapshot(ctx, subscriptions, opts) {
  var fallbackMap = toItemMap(opts.fallbackItems || []);
  var liveCount = 0;
  var fallbackCount = 0;
  var errorCount = 0;
  var items = await Promise.all(subscriptions.map(async function (sub) {
    try {
      var liveItem = await fetchSubscription(ctx, sub, opts);
      liveCount += 1;
      return liveItem;
    } catch (e) {
      var cachedItem = fallbackMap[sub.id];
      if (cachedItem && cachedItem.isUsable) {
        fallbackCount += 1;
        return assign({}, cachedItem, {
          source: "cached",
          lastError: safeMsg(e)
        });
      }
      errorCount += 1;
      return buildUnavailableItem(sub, safeMsg(e), opts.now);
    }
  }));

  var source = "live";
  if (liveCount === 0 && fallbackCount > 0) source = "cached";
  else if (liveCount > 0 && (fallbackCount > 0 || errorCount > 0)) source = "mixed";

  return {
    ts: Date.now(),
    source: source,
    items: items
  };
}

async function fetchSubscription(ctx, sub, opts) {
  var request = null;
  var header = "";
  try {
    request = await requestSubscriptionHead(ctx, sub.url, opts);
    header = getHeaderValue(request.response.headers, "subscription-userinfo");
  } catch (e) {
  }
  if (!header) {
    request = await requestSubscriptionRange(ctx, sub.url, opts);
    header = getHeaderValue(request.response.headers, "subscription-userinfo");
  }
  if (!header) throw new Error("响应头缺少 subscription-userinfo");

  var parsed = parseSubscriptionUserinfo(header);
  if (!isFinite(parsed.total) || parsed.total <= 0) {
    throw new Error("订阅总流量字段无效");
  }

  var usedBytes = Math.max(0, parsed.upload + parsed.download);
  var totalBytes = Math.max(usedBytes, parsed.total);
  var expireAt = parsed.expireAt;
  var fetchedAt = Date.now();
  var openUrl = sub.siteUrl || inferOpenUrl(sub.url);

  return {
    id: sub.id,
    name: sub.name,
    note: sub.note,
    url: sub.url,
    openUrl: openUrl,
    siteUrl: sub.siteUrl || "",
    uploadBytes: parsed.upload,
    downloadBytes: parsed.download,
    usedBytes: usedBytes,
    totalBytes: totalBytes,
    remainingBytes: Math.max(0, totalBytes - usedBytes),
    expireAt: expireAt,
    fetchedAt: fetchedAt,
    requestMode: request.mode,
    source: "live",
    isUsable: true
  };
}

async function requestSubscriptionHead(ctx, url, opts) {
  var resp = await ctx.http.head(url, {
    headers: {
      "User-Agent": "ClashMeta",
      "Accept": "*/*"
    },
    timeout: opts.timeoutMs,
    insecureTls: opts.insecureTls,
    credentials: "omit"
  });
  if (resp.status < 200 || resp.status >= 400) {
    throw new Error("HEAD HTTP " + resp.status);
  }
  return { response: resp, mode: "head" };
}

async function requestSubscriptionRange(ctx, url, opts) {
  var resp = await ctx.http.get(url, {
    headers: {
      "User-Agent": "ClashMeta",
      "Accept": "*/*",
      "Range": "bytes=0-0"
    },
    timeout: opts.timeoutMs,
    insecureTls: opts.insecureTls,
    credentials: "omit"
  });
  if (resp.status < 200 || resp.status >= 400) {
    throw new Error("GET HTTP " + resp.status);
  }
  return { response: resp, mode: "get" };
}

function parseSubscriptions(raw) {
  var list;
  try {
    list = JSON.parse(String(raw || "[]"));
  } catch (e) {
    throw new Error("SUBSCRIPTIONS_JSON 不是合法 JSON");
  }
  if (!Array.isArray(list)) {
    throw new Error("SUBSCRIPTIONS_JSON 必须是数组");
  }

  var normalized = [];
  var seen = {};
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (typeof item === "string") item = { url: item };
    item = item || {};
    var url = normalizeUrl(item.url || item.subscriptionUrl || item.subscribeUrl || "");
    if (!url) continue;

    var name = String(item.name || item.remark || item.alias || "").trim();
    if (!name) name = inferAirportName(url);
    var siteUrl = normalizeUrl(item.siteUrl || item.homepage || item.openUrl || item.website || "");
    var note = String(item.note || item.description || "").trim();
    var id = simpleHash(url + "|" + name + "|" + siteUrl);
    if (seen[id]) continue;
    seen[id] = true;

    normalized.push({
      id: id,
      url: url,
      name: name || "未命名机场",
      siteUrl: siteUrl,
      note: note
    });
  }

  return normalized;
}

function parseSubscriptionUserinfo(raw) {
  var parts = String(raw || "").split(";");
  var map = {};
  for (var i = 0; i < parts.length; i++) {
    var part = parts[i];
    var idx = part.indexOf("=");
    if (idx < 0) continue;
    var key = String(part.slice(0, idx)).trim().toLowerCase();
    var value = String(part.slice(idx + 1)).trim();
    map[key] = value;
  }

  var upload = toNumber(map.upload);
  var download = toNumber(map.download);
  var total = toNumber(map.total);
  var expire = toNumber(map.expire);

  return {
    upload: isFinite(upload) ? upload : 0,
    download: isFinite(download) ? download : 0,
    total: isFinite(total) ? total : NaN,
    expireAt: normalizeExpire(expire)
  };
}

function normalizeExpire(value) {
  if (!isFinite(value) || value <= 0) return null;
  if (value > 1000000000000) return value;
  if (value > 1000000000) return value * 1000;
  return null;
}

function buildUnavailableItem(sub, message, now) {
  return {
    id: sub.id,
    name: sub.name,
    note: sub.note,
    url: sub.url,
    openUrl: sub.siteUrl || inferOpenUrl(sub.url),
    siteUrl: sub.siteUrl || "",
    isUsable: false,
    fetchedAt: now,
    source: "error",
    error: message || "未知错误"
  };
}

function toItemMap(items) {
  var map = {};
  var list = Array.isArray(items) ? items : [];
  for (var i = 0; i < list.length; i++) {
    var item = list[i];
    if (!item || !item.id) continue;
    map[item.id] = item;
  }
  return map;
}

function hasUsableItems(items) {
  if (!Array.isArray(items)) return false;
  for (var i = 0; i < items.length; i++) {
    if (items[i] && items[i].isUsable) return true;
  }
  return false;
}

// ============== 视图模型层 ==============

function buildViewModel(snapshot, opts) {
  var items = Array.isArray(snapshot && snapshot.items) ? snapshot.items : [];
  var decorated = items.map(function (item) {
    return decorateItem(item, opts.now, opts.hideSensitive);
  }).sort(function (a, b) {
    return b.priorityScore - a.priorityScore;
  });

  var focus = decorated[0] || decorateItem(null, opts.now, opts.hideSensitive);
  var usableCount = 0;
  var alertCount = 0;
  var warningCount = 0;
  var expiredCount = 0;
  var totalRemaining = 0;
  var mixedCacheCount = 0;

  for (var i = 0; i < decorated.length; i++) {
    var item = decorated[i];
    if (!item.isUsable) continue;
    usableCount += 1;
    totalRemaining += item.remainingBytes;
    if (item.level === "danger") alertCount += 1;
    else if (item.level === "warning") warningCount += 1;
    if (item.isExpired) expiredCount += 1;
    if (item.source !== "live") mixedCacheCount += 1;
  }

  var sourceMeta = deriveSourceMeta(opts.source, usableCount, mixedCacheCount);
  var subtitle = usableCount > 0
    ? (decorated.length + " 个订阅 · " + alertCount + " 个告警")
    : "暂无可用订阅数据";
  var remainingSummary = opts.hideSensitive
    ? (usableCount > 0 ? "已隐藏具体流量" : "等待拉取")
    : (usableCount > 0 ? ("剩余总量 " + formatBytes(totalRemaining)) : "等待拉取");

  return {
    title: opts.title,
    subtitle: subtitle,
    remainingSummary: remainingSummary,
    focus: focus,
    items: decorated,
    overview: {
      total: decorated.length,
      usable: usableCount,
      alert: alertCount,
      warning: warningCount,
      expired: expiredCount
    },
    footerText: sourceMeta.footerText,
    footerColor: sourceMeta.color,
    statusText: sourceMeta.label,
    statusColor: sourceMeta.color,
    refreshedText: formatClockTime(findLatestFetchedAt(decorated)),
    refreshMinutes: opts.refreshMinutes
  };
}

function decorateItem(item, now, hideSensitive) {
  if (!item) {
    return {
      name: "暂无订阅",
      isUsable: false,
      statusText: "无数据",
      statusColor: "rgba(214,222,235,0.7)",
      priorityScore: -1,
      subtitle: "请检查配置",
      compactText: "暂无可用订阅",
      openUrl: ""
    };
  }

  if (!item.isUsable) {
    return {
      id: item.id,
      name: item.name || "未命名机场",
      note: item.note || "",
      openUrl: item.openUrl || "",
      source: item.source || "error",
      isUsable: false,
      isExpired: false,
      level: "error",
      percentText: "--",
      progress: 0,
      statusText: "拉取失败",
      statusColor: "#F26D6D",
      accent: "#F26D6D",
      trackColor: "rgba(242,109,109,0.14)",
      gradient: ["rgba(255,138,138,0.95)", "rgba(242,109,109,0.82)"],
      trafficText: hideSensitive ? "流量已隐藏" : "暂无可用流量数据",
      expiryText: item.error || "请求失败",
      metaText: "请稍后重试",
      compactText: "拉取失败",
      subtitle: item.error || "请求失败",
      priorityScore: 20
    };
  }

  var totalBytes = toNumber(item.totalBytes);
  if (!isFinite(totalBytes) || totalBytes <= 0) totalBytes = 1;
  var usedBytes = clampFloat(toNumber(item.usedBytes), 0, totalBytes);
  var remainingBytes = Math.max(0, totalBytes - usedBytes);
  var progress = clampFloat(usedBytes / totalBytes, 0, 1);
  var percent = Math.round(progress * 100);
  var expireAt = item.expireAt;
  var daysLeft = expireAt ? Math.ceil((expireAt - now) / DAY_MS) : null;
  var isExpired = expireAt ? expireAt <= now : false;
  var remainingRatio = remainingBytes / totalBytes;
  var level = "normal";
  var accent = "#67E8D6";
  var gradient = ["rgba(103,232,214,0.98)", "rgba(70,122,255,0.92)"];
  var trackColor = "rgba(255,255,255,0.08)";
  var statusText = "状态平稳";
  var metaText = "余量健康";

  if (isExpired) {
    level = "danger";
    accent = "#FF6B6B";
    gradient = ["rgba(255,150,120,0.98)", "rgba(255,107,107,0.88)"];
    trackColor = "rgba(255,107,107,0.14)";
    statusText = "已到期";
    metaText = "请尽快续订";
  } else if (remainingRatio <= 0.1 || (daysLeft != null && daysLeft <= 3) || progress >= 0.9) {
    level = "danger";
    accent = "#FF955C";
    gradient = ["rgba(255,190,116,0.96)", "rgba(255,125,92,0.9)"];
    trackColor = "rgba(255,149,92,0.14)";
    statusText = daysLeft != null && daysLeft <= 3 ? "即将到期" : "流量告急";
    metaText = remainingRatio <= 0.1 ? "剩余不足 10%" : "建议尽快处理";
  } else if (remainingRatio <= 0.25 || (daysLeft != null && daysLeft <= 7) || progress >= 0.75) {
    level = "warning";
    accent = "#F6C26A";
    gradient = ["rgba(255,223,132,0.96)", "rgba(246,194,106,0.88)"];
    trackColor = "rgba(246,194,106,0.12)";
    statusText = daysLeft != null && daysLeft <= 7 ? "到期临近" : "余量偏紧";
    metaText = "建议关注使用趋势";
  }

  var trafficText = hideSensitive
    ? ("已用 " + percent + "%")
    : (formatBytes(usedBytes) + " / " + formatBytes(totalBytes));
  var expiryText = formatExpiryText(daysLeft, expireAt, isExpired);
  var compactText = percent + "% · " + compactExpiry(daysLeft, isExpired);
  var priorityScore = buildPriorityScore(level, percent, daysLeft, isExpired);

  return {
    id: item.id,
    name: item.name || "未命名机场",
    note: item.note || "",
    openUrl: item.openUrl || "",
    source: item.source || "live",
    isUsable: true,
    isExpired: isExpired,
    level: level,
    percent: percent,
    percentText: percent + "%",
    progress: progress,
    statusText: statusText,
    statusColor: accent,
    accent: accent,
    gradient: gradient,
    trackColor: trackColor,
    usedBytes: usedBytes,
    totalBytes: totalBytes,
    remainingBytes: remainingBytes,
    trafficText: trafficText,
    expiryText: expiryText,
    metaText: metaText,
    compactText: compactText,
    subtitle: hideSensitive
      ? ("剩余 " + Math.max(0, 100 - percent) + "%")
      : ("剩余 " + formatBytes(remainingBytes)),
    requestMode: item.requestMode || "head",
    fetchedAt: item.fetchedAt || null,
    daysLeft: daysLeft,
    priorityScore: priorityScore
  };
}

function deriveSourceMeta(source, usableCount, cacheCount) {
  if (usableCount <= 0) {
    return {
      label: "无数据",
      color: "rgba(214,222,235,0.7)",
      footerText: "等待订阅返回可用信息"
    };
  }
  if (source === "cached") {
    return {
      label: "缓存",
      color: "#F4B65F",
      footerText: "当前显示缓存快照"
    };
  }
  if (source === "mixed" || cacheCount > 0) {
    return {
      label: "混合",
      color: "#8AB4FF",
      footerText: "部分订阅使用缓存回退"
    };
  }
  return {
    label: "实时",
    color: "#5CD6B2",
    footerText: "全部订阅已实时刷新"
  };
}

function buildPriorityScore(level, percent, daysLeft, isExpired) {
  var base = 100;
  if (level === "warning") base = 400;
  if (level === "danger") base = 700;
  if (isExpired) base = 1000;
  var score = base + percent;
  if (daysLeft != null) score += Math.max(0, 40 - Math.min(daysLeft, 40));
  return score;
}

function findLatestFetchedAt(items) {
  var latest = null;
  for (var i = 0; i < items.length; i++) {
    if (!items[i] || !items[i].fetchedAt) continue;
    if (!latest || items[i].fetchedAt > latest) latest = items[i].fetchedAt;
  }
  return latest;
}

// ============== 布局层 ==============

function buildSmall(vm, refreshAfter) {
  var items = vm.items.slice(0, 2);
  if (items.length === 0) items = [vm.focus];
  return shell([
    header(vm.title, vm.statusColor, false),
    sp(4),
    separator(),
    sp(6),
    vstack(items.map(function (item) {
      return subscriptionCompactRow(item, true);
    }), { gap: 5, alignItems: "start" }),
    sp(8),
    footer(vm)
  ], refreshAfter, [12, 14, 10, 14]);
}

function buildMedium(vm, refreshAfter) {
  var items = vm.items.slice(0, 4);
  if (items.length === 0) items = [vm.focus];
  var half = Math.ceil(items.length / 2);
  var left = items.slice(0, half);
  var right = items.slice(half);
  var columns = [
    vstack(left.map(function (item) {
      return subscriptionCompactRow(item, false);
    }), { gap: 6, flex: 1, alignItems: "start" })
  ];

  if (right.length > 0) {
    columns.push(vstack([], { width: 1, backgroundColor: "rgba(255,255,255,0.06)" }));
    columns.push(vstack(right.map(function (item) {
      return subscriptionCompactRow(item, false);
    }), { gap: 6, flex: 1, alignItems: "start" }));
  }

  return shell([
    header(vm.title, vm.statusColor, true),
    sp(4),
    separator(),
    sp(6),
    hstack(columns, { gap: 8, alignItems: "start" }),
    sp(8),
    footer(vm)
  ], refreshAfter);
}

function buildLarge(vm, refreshAfter) {
  var list = vm.items.slice(0, 6);
  if (list.length === 0) list = [vm.focus];
  return shell([
    header(vm.title, vm.statusColor, true),
    sp(6),
    separator(),
    sp(8),
    summaryLine(vm),
    sp(8),
    vstack(list.map(function (item) {
      return subscriptionExpandedRow(item);
    }), { gap: 6, alignItems: "start" }),
    sp(8),
    footer(vm)
  ], refreshAfter, [14, 16, 12, 16]);
}

function buildCircular(vm) {
  var focus = vm.focus;
  return {
    type: "widget",
    url: focus.openUrl || undefined,
    gap: 2,
    children: [
      sp(),
      icon("airplane.circle.fill", 15, focus.accent || vm.statusColor),
      txt(focus.percentText, 12, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.6 }),
      txt(circularCaption(focus), 9, "medium", "rgba(235,240,248,0.7)", { maxLines: 1, minScale: 0.6 }),
      sp()
    ]
  };
}

function buildRectangular(vm) {
  var focus = vm.focus;
  return {
    type: "widget",
    url: focus.openUrl || undefined,
    gap: 3,
    children: [
      hstack([
        icon("airplane.circle.fill", 10, focus.accent || vm.statusColor),
        txt(focus.name, 10, "semibold", "rgba(235,240,248,0.84)", { maxLines: 1, minScale: 0.72, flex: 1 }),
        txt(vm.statusText, 9, "bold", vm.statusColor, { maxLines: 1 })
      ], { gap: 4, alignItems: "center" }),
      txt(focus.percentText + " · " + focus.statusText, 12, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.65 }),
      txt(focus.expiryText, 10, "medium", "rgba(235,240,248,0.62)", { maxLines: 1, minScale: 0.68 })
    ]
  };
}

function buildInline(vm) {
  var focus = vm.focus;
  var text = vm.overview.alert > 0
    ? (vm.overview.alert + " 个订阅告警")
    : (focus.name + " " + focus.percentText + " · " + compactExpiry(focus.daysLeft, focus.isExpired));
  return {
    type: "widget",
    url: focus.openUrl || undefined,
    children: [
      icon("airplane.circle.fill", 12, focus.accent || vm.statusColor),
      txt(" " + text, 12, "medium", "#F7FAFF", { maxLines: 1, minScale: 0.62 })
    ]
  };
}

function summaryLine(vm) {
  return txt(vm.subtitle + " · " + vm.remainingSummary, 10, "medium", "rgba(235,240,248,0.62)", {
    maxLines: 1,
    minScale: 0.64
  });
}

function subscriptionCompactRow(item, compact) {
  var trailing = item.compactText || item.statusText || "--";
  return hstack([
    tagDot(item.accent || item.statusColor || "#8AB4FF"),
    txt(item.name, compact ? 11 : 12, "medium", "#F7FAFF", { flex: 1, maxLines: 1, minScale: 0.64 }),
    txt(trailing, compact ? 9 : 10, "semibold", item.accent || item.statusColor || "#8AB4FF", { maxLines: 1, minScale: 0.58 })
  ], {
    url: item.openUrl || undefined,
    gap: compact ? 4 : 5,
    alignItems: "center"
  });
}

function subscriptionExpandedRow(item) {
  var detailText = item.isUsable
    ? (item.trafficText + " · " + item.expiryText)
    : item.expiryText;
  return vstack([
    hstack([
      tagDot(item.accent || item.statusColor || "#8AB4FF"),
      txt(item.name, 12, "semibold", "#F7FAFF", { flex: 1, maxLines: 1, minScale: 0.68 }),
      txt(item.percentText, 12, "bold", item.accent || item.statusColor || "#F7FAFF", { maxLines: 1, minScale: 0.68 })
    ], { gap: 6, alignItems: "center" }),
    txt(detailText, 10, "medium", "rgba(235,240,248,0.62)", { maxLines: 1, minScale: 0.64 })
  ], {
    url: item.openUrl || undefined,
    gap: 6,
    alignItems: "start"
  });
}

function header(title, accent, showTime) {
  var children = [
    icon("airplane.circle.fill", 15, accent),
    txt(title, 12, "bold", accent, { maxLines: 1, minScale: 0.72 }),
    sp()
  ];
  if (showTime) {
    children.push(txt(formatClockTime(Date.now()), 9, "medium", "rgba(235,240,248,0.35)", { maxLines: 1 }));
  }
  return hstack(children, { gap: 5, alignItems: "center" });
}

function footer(vm) {
  return hstack([
    txt(vm.footerText, 9, "medium", "rgba(235,240,248,0.48)", { maxLines: 1, minScale: 0.72, flex: 1 }),
    txt(vm.statusText + " · " + vm.refreshedText, 9, "medium", vm.footerColor, { maxLines: 1, minScale: 0.72 })
  ], { gap: 6, alignItems: "center" });
}

function tagDot(color) {
  return {
    type: "stack",
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: color || "#8AB4FF",
    children: []
  };
}

function shell(children, refreshAfter, padding) {
  return {
    type: "widget",
    gap: 0,
    padding: padding || [14, 16, 12, 16],
    refreshAfter: refreshAfter,
    backgroundGradient: {
      type: "linear",
      colors: ["#091320", "#102235", "#172C43"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: children
  };
}

function separator() {
  return {
    type: "stack",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    children: []
  };
}

function errorWidget(title, message) {
  return {
    type: "widget",
    padding: 16,
    gap: 8,
    backgroundGradient: {
      type: "linear",
      colors: ["#1A2232", "#141C2A"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: [
      hstack([
        icon("exclamationmark.triangle.fill", 14, "#F6C26A"),
        txt(title, 13, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.72 })
      ], { gap: 6 }),
      txt(message || "未知错误", 11, "medium", "rgba(235,240,248,0.72)", {
        maxLines: 4,
        minScale: 0.72
      })
    ]
  };
}

// ============== 基础工具 ==============

function txt(text, size, weight, color, opts) {
  var node = {
    type: "text",
    text: String(text == null ? "" : text),
    font: { size: size, weight: weight || "regular" }
  };
  if (color) node.textColor = color;
  return assign(node, opts || {});
}

function icon(name, size, color) {
  return {
    type: "image",
    src: "sf-symbol:" + name,
    width: size,
    height: size,
    color: color || "#F7FAFF"
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
  return assign(node, opts || {});
}

function sp(length) {
  if (length != null) return { type: "spacer", length: length };
  return { type: "spacer" };
}

function loadCache(ctx, key) {
  try {
    return ctx.storage.getJSON(key);
  } catch (e) {
    return null;
  }
}

function saveCache(ctx, key, data) {
  try {
    ctx.storage.setJSON(key, data);
  } catch (e) {
  }
}

function buildCacheKey(raw, subscriptions) {
  var direct = String(raw || "").trim();
  if (direct) return direct;
  var seed = subscriptions.map(function (item) {
    return item.url + "|" + item.name + "|" + item.siteUrl;
  }).join(";");
  return DEFAULT_CACHE_PREFIX + simpleHash(seed);
}

function inferAirportName(url) {
  try {
    var parsed = new URL(url);
    var namedKeys = ["name", "title", "remark", "remarks", "tag", "label"];
    for (var i = 0; i < namedKeys.length; i++) {
      var fromQuery = parsed.searchParams.get(namedKeys[i]);
      if (fromQuery) return sanitizeAirportName(fromQuery);
    }

    var segments = parsed.pathname.split("/").filter(Boolean);
    for (var j = segments.length - 1; j >= 0; j--) {
      var seg = sanitizeAirportName(decodeURIComponent(segments[j]));
      if (seg && !isGenericSegment(seg)) return seg;
    }

    return sanitizeAirportName(parsed.hostname.replace(/^www\./i, ""));
  } catch (e) {
    return "未命名机场";
  }
}

function inferOpenUrl(url) {
  try {
    var parsed = new URL(url);
    return parsed.origin;
  } catch (e) {
    return "";
  }
}

function sanitizeAirportName(name) {
  return String(name || "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGenericSegment(seg) {
  var text = String(seg || "").toLowerCase();
  return text === "sub" || text === "subscribe" || text === "subscription" || text === "api";
}

function normalizeUrl(url) {
  var text = String(url || "").trim();
  if (!text) return "";
  if (!/^https?:\/\//i.test(text)) text = "https://" + text;
  return text;
}

function getHeaderValue(headers, name) {
  if (!headers) return "";
  try {
    if (typeof headers.get === "function") {
      var val = headers.get(name);
      if (val != null && val !== "") return String(val).trim();
    }
  } catch (e) {}

  var lowerName = String(name).toLowerCase();
  for (var key in headers) {
    if (String(key).toLowerCase() === lowerName) {
      var direct = headers[key];
      if (Array.isArray(direct)) return String(direct[0] || "").trim();
      return String(direct || "").trim();
    }
  }
  return "";
}

function formatBytes(bytes) {
  var num = toNumber(bytes);
  if (!isFinite(num) || num < 0) num = 0;
  var units = ["B", "KB", "MB", "GB", "TB", "PB"];
  var idx = 0;
  while (num >= 1024 && idx < units.length - 1) {
    num = num / 1024;
    idx += 1;
  }
  var digits = num >= 100 || idx === 0 ? 0 : (num >= 10 ? 1 : 2);
  return trimZeros(num.toFixed(digits)) + " " + units[idx];
}

function formatExpiryText(daysLeft, expireAt, isExpired) {
  if (!expireAt) return "未提供到期时间";
  if (isExpired) {
    var overdue = Math.max(1, Math.abs(daysLeft || 0));
    return "已过期 " + overdue + " 天";
  }
  if (daysLeft === 0) return "今天到期";
  if (daysLeft === 1) return "1 天后到期";
  return daysLeft + " 天后到期";
}

function compactExpiry(daysLeft, isExpired) {
  if (daysLeft == null) return "无到期";
  if (isExpired) return "已过期";
  if (daysLeft <= 0) return "今天到期";
  return daysLeft + " 天";
}

function circularCaption(item) {
  if (!item || !item.isUsable) return "失败";
  if (item.isExpired) return "到期";
  if (item.daysLeft != null && item.daysLeft <= 9) return item.daysLeft + " 天";
  return "已用";
}

function formatClockTime(value) {
  if (!value) return "未更新";
  var d = new Date(value);
  if (isNaN(d.getTime())) return "已更新";
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function trimZeros(text) {
  return String(text || "").replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function simpleHash(text) {
  var input = String(text || "");
  var hash = 2166136261;
  for (var i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function assign(target, source) {
  var keys = Object.keys(source || {});
  for (var i = 0; i < keys.length; i++) {
    target[keys[i]] = source[keys[i]];
  }
  return target;
}

function toNumber(value) {
  var n = Number(value);
  return isFinite(n) ? n : NaN;
}

function clampNumber(value, min, max) {
  var n = parseInt(value, 10);
  if (!isFinite(n)) n = min;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function clampFloat(value, min, max) {
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

function isFalse(value) {
  var text = String(value || "").trim().toLowerCase();
  return text === "0" || text === "false" || text === "no" || text === "off";
}

function pad2(num) {
  return num < 10 ? "0" + num : String(num);
}

function safeMsg(error) {
  if (!error) return "未知错误";
  if (typeof error === "string") return error;
  if (error.message) return error.message;
  return String(error);
}

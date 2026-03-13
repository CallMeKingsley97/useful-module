// 通勤时间预测小组件
// 特性：双向 ETA + 拥堵等级 + 多尺寸布局 + 缓存 + 失败降级

var CACHE_KEY = "commute_eta_cache_v1";
var DEFAULT_REFRESH_MINUTES = 10;

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";

    var title = env.TITLE || "通勤时间预测";
    var accent = env.ACCENT_COLOR || "#3B82F6";
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 5, 1440);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);

    var apiKey = (env.API_KEY || "").trim();
    var home = parseLngLat(env.HOME);
    var work = parseLngLat(env.WORK);
    var strategy = clampNumber(env.STRATEGY || 0, 0, 9);

    if (!apiKey) return errorWidget("缺少配置", "请设置 API_KEY (高德)");
    if (!home || !work) return errorWidget("缺少坐标", "请设置 HOME/WORK (lng,lat)");

    var cached = loadCache(ctx);
    var data = null;
    var now = Date.now();
    var cacheReady = cached && cached.toWork && cached.toHome;
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            var toWork = await fetchRoute(ctx, apiKey, home, work, strategy);
            var toHome = await fetchRoute(ctx, apiKey, work, home, strategy);
            data = { toWork: toWork, toHome: toHome, ts: Date.now() };
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("commute fetch error: " + safeMsg(e));
            if (cacheReady) {
                data = cached;
            } else {
                return errorWidget("获取失败", safeMsg(e));
            }
        }
    }

    var nextRefresh = new Date(Date.now() + refreshIntervalMs).toISOString();
    var status = fetched ? "live" : "cached";

    if (family === "accessoryCircular") return buildCircular(data.toWork, accent);
    if (family === "accessoryRectangular") return buildRectangular(data.toWork, accent);
    if (family === "accessoryInline") return buildInline(data.toWork, accent);
    if (family === "systemSmall") return buildSmall(data.toWork, title, accent, status, nextRefresh);
    if (family === "systemLarge") return buildLarge(data, title, accent, status, nextRefresh);
    return buildMedium(data, title, accent, status, nextRefresh);
}

// ============== 数据层 ==============

async function fetchRoute(ctx, apiKey, origin, dest, strategy) {
    var url = "https://restapi.amap.com/v3/direction/driving"
        + "?origin=" + origin.lng + "," + origin.lat
        + "&destination=" + dest.lng + "," + dest.lat
        + "&key=" + encodeURIComponent(apiKey)
        + "&extensions=base"
        + "&strategy=" + strategy;

    var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 10000 });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    var body = await resp.json();
    if (body.status !== "1" || !body.route || !body.route.paths || body.route.paths.length === 0) {
        throw new Error("API 返回异常");
    }
    var p = body.route.paths[0];
    return {
        duration: parseInt(p.duration || 0, 10),
        distance: parseInt(p.distance || 0, 10)
    };
}

// ============== UI 布局 ==============

function buildSmall(r, title, accent, status, nextRefresh) {
    var eta = formatDuration(r.duration);
    var level = trafficLevel(r.duration, r.distance);
    return shell([
        hstack([icon("car.fill", 12, accent), txt(title, 12, "bold", accent)], { gap: 4 }),
        sp(),
        vstack([
            txt(eta, 30, "bold", "#FFFFFF", { minScale: 0.5, shadowColor: accent + "66", shadowRadius: 8 }),
            txt(level.text, 11, "semibold", level.color)
        ], { alignItems: "center", width: "100%" }),
        sp(),
        txt("距离 " + formatDistance(r.distance), 11, "medium", "rgba(255,255,255,0.6)"),
        footer(status)
    ], nextRefresh);
}

function buildMedium(data, title, accent, status, nextRefresh) {
    var toWork = data.toWork;
    var toHome = data.toHome;
    var levelA = trafficLevel(toWork.duration, toWork.distance);
    var levelB = trafficLevel(toHome.duration, toHome.distance);
    return shell([
        hstack([
            vstack([
                txt("去公司", 11, "semibold", "rgba(255,255,255,0.6)"),
                txt(formatDuration(toWork.duration), 20, "bold", "#FFFFFF"),
                txt(levelA.text, 10, "medium", levelA.color)
            ], { gap: 2, alignItems: "start" }),
            sp(16),
            vstack([
                txt("回家", 11, "semibold", "rgba(255,255,255,0.6)"),
                txt(formatDuration(toHome.duration), 20, "bold", "#FFFFFF"),
                txt(levelB.text, 10, "medium", levelB.color)
            ], { gap: 2, alignItems: "start" })
        ]),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildLarge(data, title, accent, status, nextRefresh) {
    var toWork = data.toWork;
    var toHome = data.toHome;
    var levelA = trafficLevel(toWork.duration, toWork.distance);
    var levelB = trafficLevel(toHome.duration, toHome.distance);
    return shell([
        hstack([icon("car.fill", 14, accent), txt(title, 13, "bold", accent), sp(), txt("实时交通", 10, "medium", "rgba(255,255,255,0.5)")], { gap: 6 }),
        sp(10),
        vstack([
            hstack([
                txt("去公司", 12, "bold", "#FFFFFF"),
                sp(),
                txt(formatDuration(toWork.duration), 16, "bold", "#FFFFFF"),
                txt(formatDistance(toWork.distance), 12, "medium", "rgba(255,255,255,0.6)"),
                txt(levelA.text, 11, "semibold", levelA.color)
            ], { gap: 6 }),
            hstack([
                txt("回家", 12, "bold", "#FFFFFF"),
                sp(),
                txt(formatDuration(toHome.duration), 16, "bold", "#FFFFFF"),
                txt(formatDistance(toHome.distance), 12, "medium", "rgba(255,255,255,0.6)"),
                txt(levelB.text, 11, "semibold", levelB.color)
            ], { gap: 6 })
        ], { gap: 8 }),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildCircular(r, accent) {
    var m = Math.max(1, Math.round(r.duration / 60));
    return {
        type: "widget",
        gap: 2,
        children: [
            sp(),
            icon("car.fill", 16, accent),
            txt(m + "分", 12, "bold"),
            sp()
        ]
    };
}

function buildRectangular(r, accent) {
    var eta = formatDuration(r.duration);
    var level = trafficLevel(r.duration, r.distance);
    return {
        type: "widget",
        gap: 3,
        children: [
            hstack([icon("car.fill", 10, accent), txt("通勤 ETA", 10, "medium", "rgba(255,255,255,0.7)")], { gap: 4 }),
            txt("去公司 " + eta, 14, "bold"),
            txt(level.text + " · " + formatDistance(r.distance), 10, "medium", "rgba(255,255,255,0.5)")
        ]
    };
}

function buildInline(r, accent) {
    var eta = formatDuration(r.duration);
    return {
        type: "widget",
        children: [
            icon("car.fill", 12, accent),
            txt(" 去公司 " + eta, 12, "medium")
        ]
    };
}

// ============== UI 组件 ==============

function shell(children, nextRefresh) {
    return {
        type: "widget",
        padding: [16, 16, 16, 16],
        backgroundGradient: {
            type: "linear",
            colors: ["#0B0F1A", "#1A2233"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        refreshAfter: nextRefresh,
        children: children
    };
}

function footer(status) {
    var isLive = status === "live";
    return hstack([
        icon("clock", 8, "rgba(255,255,255,0.3)"),
        {
            type: "date",
            date: new Date().toISOString(),
            format: "relative",
            font: { size: 9 },
            textColor: "rgba(255,255,255,0.3)"
        },
        sp(),
        txt(isLive ? "实时" : "缓存", 8, "bold", isLive ? "#10B98166" : "#F59E0B66")
    ], { gap: 4 });
}

function errorWidget(title, msg) {
    return {
        type: "widget",
        padding: 16,
        backgroundColor: "#0B0E14",
        children: [
            txt(title, "headline", "bold", "#EF4444"),
            sp(8),
            txt(msg || "未知错误", "caption1", "regular", "rgba(255,255,255,0.6)", { maxLines: 5 })
        ]
    };
}

// ============== 辅助函数 ==============

function parseLngLat(raw) {
    var s = String(raw || "").trim();
    if (!s) return null;
    var parts = s.split(",");
    if (parts.length !== 2) return null;
    var lng = parseFloat(parts[0]);
    var lat = parseFloat(parts[1]);
    if (!isFinite(lng) || !isFinite(lat)) return null;
    return { lng: lng, lat: lat };
}

function formatDuration(sec) {
    var s = Math.max(0, parseInt(sec || 0, 10));
    var m = Math.round(s / 60);
    if (m < 60) return m + " 分";
    var h = Math.floor(m / 60);
    var r = m % 60;
    return h + " 小时" + (r > 0 ? (r + " 分") : "");
}

function formatDistance(meter) {
    var m = Math.max(0, parseInt(meter || 0, 10));
    if (m < 1000) return m + " 米";
    return (m / 1000).toFixed(1) + " 公里";
}

function trafficLevel(durationSec, distanceMeter) {
    var speed = 0;
    if (durationSec > 0) speed = distanceMeter / durationSec; // m/s
    if (speed >= 8) return { text: "通畅", color: "#10B981" };
    if (speed >= 4) return { text: "一般", color: "#F59E0B" };
    return { text: "拥堵", color: "#EF4444" };
}

function txt(text, size, weight, color, opts) {
    var el = { type: "text", text: String(text), font: { size: size || "body", weight: weight || "regular" } };
    if (color) el.textColor = color;
    if (opts) { for (var k in opts) el[k] = opts[k]; }
    return el;
}

function icon(name, size, color) {
    var el = { type: "image", src: "sf-symbol:" + name, width: size, height: size };
    if (color) el.color = color;
    return el;
}

function hstack(children, opts) {
    var el = { type: "stack", direction: "row", alignItems: "center", children: children };
    if (opts) { for (var k in opts) el[k] = opts[k]; }
    return el;
}

function vstack(children, opts) {
    var el = { type: "stack", direction: "column", alignItems: "start", children: children };
    if (opts) { for (var k in opts) el[k] = opts[k]; }
    return el;
}

function sp(len) {
    var el = { type: "spacer" };
    if (len != null) el.length = len;
    return el;
}

function clampNumber(val, min, max) {
    var n = parseInt(val, 10);
    if (!isFinite(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
}

function isTrue(val) {
    var v = String(val || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
}

function loadCache(ctx) {
    try { return ctx.storage.getJSON(CACHE_KEY); } catch (e) { return null; }
}

function saveCache(ctx, data) {
    try { ctx.storage.setJSON(CACHE_KEY, data); } catch (e) { }
}

function safeMsg(e) {
    if (!e) return "未知错误";
    if (typeof e === "string") return e;
    if (e.message) return e.message;
    return "未知错误";
}

// 卫星过境提醒小组件
// 特性：获取可见过境 + 倒计时 + 多尺寸布局 + 缓存 + 失败降级

var CACHE_KEY = "satellite_pass_cache_v1";
var DEFAULT_REFRESH_MINUTES = 30;
var DEFAULT_SATELLITE_ID = 25544; // ISS

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";

    var title = env.TITLE || "卫星过境提醒";
    var accent = env.ACCENT_COLOR || "#22C55E";
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 5, 1440);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);

    var apiKey = (env.API_KEY || "").trim();
    var satId = clampNumber(env.SATELLITE_ID || DEFAULT_SATELLITE_ID, 1, 999999);
    var lat = parseFloat(env.LAT);
    var lon = parseFloat(env.LON);
    var alt = clampNumber(env.ALT || 0, 0, 9000);
    var days = clampNumber(env.DAYS || 2, 1, 10);
    var minVisibility = clampNumber(env.MIN_VISIBILITY || 60, 10, 600);

    if (!apiKey) return errorWidget("缺少配置", "请设置 API_KEY (N2YO)");
    if (!isFinite(lat) || !isFinite(lon)) return errorWidget("缺少位置", "请设置 LAT/LON");

    var cached = loadCache(ctx);
    var data = null;
    var now = Date.now();
    var cacheReady = cached && cached.pass;
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            var pass = await fetchNextPass(ctx, {
                apiKey: apiKey,
                satId: satId,
                lat: lat,
                lon: lon,
                alt: alt,
                days: days,
                minVisibility: minVisibility
            });
            data = { pass: pass, ts: Date.now() };
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("satellite pass fetch error: " + safeMsg(e));
            if (cacheReady) {
                data = cached;
            } else {
                return errorWidget("获取失败", safeMsg(e));
            }
        }
    }

    var passInfo = data.pass;
    if (!passInfo) {
        return errorWidget("暂无过境", "未来 " + days + " 天无可见过境");
    }

    var status = fetched ? "live" : "cached";
    var nextRefresh = new Date(Date.now() + refreshIntervalMs).toISOString();

    if (family === "accessoryCircular") return buildCircular(passInfo, accent);
    if (family === "accessoryRectangular") return buildRectangular(passInfo, accent, title);
    if (family === "accessoryInline") return buildInline(passInfo, accent);
    if (family === "systemSmall") return buildSmall(passInfo, title, accent, status, nextRefresh);
    if (family === "systemLarge") return buildLarge(passInfo, title, accent, status, nextRefresh);
    return buildMedium(passInfo, title, accent, status, nextRefresh);
}

// ============== 数据层 ==============

async function fetchNextPass(ctx, opts) {
    var url = "https://api.n2yo.com/rest/v1/satellite/visualpasses/"
        + opts.satId + "/" + opts.lat + "/" + opts.lon + "/" + opts.alt
        + "/" + opts.days + "/" + opts.minVisibility + "?apiKey=" + encodeURIComponent(opts.apiKey);

    var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 10000 });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    var body = await resp.json();
    var passes = body.passes || [];
    if (!passes || passes.length === 0) return null;

    var p = passes[0];
    return {
        startUTC: p.startUTC,
        endUTC: p.endUTC,
        duration: p.duration,
        maxEl: p.maxEl,
        startAz: p.startAzCompass,
        endAz: p.endAzCompass,
        info: body.info || {}
    };
}

// ============== UI 布局 ==============

function buildSmall(p, title, accent, status, nextRefresh) {
    var cd = parseCountdown(p.startUTC);
    return shell([
        hstack([icon("sparkles", 12, accent), txt(title, 12, "bold", accent)], { gap: 4 }),
        sp(),
        vstack([
            txt("T-" + cd.text, 30, "bold", "#FFFFFF", { minScale: 0.5, shadowColor: accent + "66", shadowRadius: 8 }),
            txt("最大仰角 " + p.maxEl + "°", 11, "semibold", "rgba(255,255,255,0.7)")
        ], { alignItems: "center", width: "100%" }),
        sp(),
        txt("方位 " + p.startAz + " → " + p.endAz, 11, "medium", "rgba(255,255,255,0.6)", { maxLines: 1 }),
        footer(status)
    ], nextRefresh);
}

function buildMedium(p, title, accent, status, nextRefresh) {
    var cd = parseCountdown(p.startUTC);
    return shell([
        hstack([
            vstack([
                txt("T-" + cd.text, 34, "bold", "#FFFFFF", { minScale: 0.6, shadowColor: accent + "66", shadowRadius: 10 }),
                txt("最大仰角 " + p.maxEl + "°", 12, "bold", "#FFFFFF", {
                    padding: [2, 6, 2, 6],
                    backgroundColor: accent + "33",
                    borderRadius: 4
                })
            ], { gap: 6, alignItems: "center" }),
            sp(16),
            vstack([
                hstack([icon("sparkles", 12, accent), txt(title, 12, "bold", accent)], { gap: 6 }),
                txt("起始方位：" + p.startAz, 11, "medium", "rgba(255,255,255,0.7)", { maxLines: 1 }),
                txt("结束方位：" + p.endAz, 11, "medium", "rgba(255,255,255,0.7)", { maxLines: 1 }),
                txt("持续时长：" + formatDuration(p.duration), 11, "medium", "rgba(255,255,255,0.7)")
            ], { gap: 3 })
        ], { alignItems: "center" }),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildLarge(p, title, accent, status, nextRefresh) {
    var cd = parseCountdown(p.startUTC);
    return shell([
        hstack([
            icon("sparkles", 16, accent),
            txt(title, 13, "bold", accent),
            sp(),
            txt("最大仰角 " + p.maxEl + "°", 11, "bold", "#FFFFFF", { padding: [2, 6, 2, 6], backgroundColor: accent + "33", borderRadius: 4 })
        ]),
        sp(12),
        vstack([
            txt("T-" + cd.text, 40, "bold", "#FFFFFF", { minScale: 0.5, shadowColor: accent + "66", shadowRadius: 12 }),
            sp(6),
            hstack([icon("location.north.line", 12, accent), txt("起始方位：" + p.startAz, 12, "semibold", "rgba(255,255,255,0.8)")], { gap: 6 }),
            hstack([icon("location.north", 12, accent), txt("结束方位：" + p.endAz, 12, "semibold", "rgba(255,255,255,0.8)")], { gap: 6 }),
            hstack([icon("timer", 12, accent), txt("持续时长：" + formatDuration(p.duration), 12, "medium", "rgba(255,255,255,0.7)")], { gap: 6 })
        ], { gap: 6 }),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildCircular(p, accent) {
    var cd = parseCountdown(p.startUTC);
    var text = cd.isTBD ? "待定" : (cd.days > 0 ? cd.days + "天" : cd.hours + "时");
    return {
        type: "widget",
        gap: 2,
        children: [
            sp(),
            icon("sparkles", 16, accent),
            txt(text, 12, "bold"),
            sp()
        ]
    };
}

function buildRectangular(p, accent, title) {
    var cd = parseCountdown(p.startUTC);
    var text = cd.isTBD ? "待定" : (cd.days > 0 ? cd.days + "天" + cd.hours + "时" : cd.hours + "时" + cd.mins + "分");
    return {
        type: "widget",
        gap: 3,
        children: [
            hstack([icon("sparkles", 10, accent), txt(title, 10, "medium", "rgba(255,255,255,0.7)")], { gap: 4 }),
            txt("T-" + text, 14, "bold"),
            txt("仰角 " + p.maxEl + "°  方位 " + p.startAz, 10, "medium", "rgba(255,255,255,0.5)", { maxLines: 1 })
        ]
    };
}

function buildInline(p, accent) {
    var cd = parseCountdown(p.startUTC);
    var text = cd.isTBD ? "待定" : (cd.days > 0 ? cd.days + "天" + cd.hours + "时" : cd.hours + "时" + cd.mins + "分");
    return {
        type: "widget",
        children: [
            icon("sparkles", 12, accent),
            txt(" 过境 T-" + text + " 最大仰角 " + p.maxEl + "°", 12, "medium")
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
            colors: ["#0B0E14", "#17212B"],
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

function parseCountdown(startUTC) {
    if (!startUTC) return { isTBD: true, text: "待定" };
    var start = Number(startUTC) * 1000;
    var now = Date.now();
    var diff = start - now;

    if (diff <= 0) return { isTBD: false, days: 0, hours: 0, mins: 0, text: "正在过境" };

    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    var hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    var mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    var text = days > 0 ? (days + "天" + hours + "时") : (hours + ":" + String(mins).padStart(2, "0"));
    return { isTBD: false, days: days, hours: hours, mins: mins, text: text };
}

function formatDuration(sec) {
    var s = Math.max(0, parseInt(sec || 0, 10));
    var m = Math.floor(s / 60);
    var r = s % 60;
    if (m <= 0) return r + " 秒";
    return m + " 分" + (r > 0 ? (r + " 秒") : "");
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

// 最近天体小组件
// 特性：AstronomyAPI 获取太阳系天体 + 内置亮星星表 + 可见中仰角最高优先 + 多尺寸布局 + 缓存 + 失败降级

var CACHE_KEY = "nearest_celestial_cache_v1";
var DEFAULT_REFRESH_MINUTES = 30;

var BODY_LIST = ["sun", "moon", "mercury", "venus", "mars", "jupiter", "saturn", "uranus", "neptune"];

var BODY_META = {
    sun: { cn: "太阳", type: "sun", icon: "sun.max.fill", color: "#F59E0B", feature: "恒星" },
    moon: { cn: "月球", type: "moon", icon: "moon.stars.fill", color: "#E5E7EB", feature: "月相" },
    mercury: { cn: "水星", type: "planet", icon: "globe.asia.australia.fill", color: "#94A3B8" },
    venus: { cn: "金星", type: "planet", icon: "globe.asia.australia.fill", color: "#F472B6" },
    mars: { cn: "火星", type: "planet", icon: "globe.asia.australia.fill", color: "#F87171" },
    jupiter: { cn: "木星", type: "planet", icon: "globe.asia.australia.fill", color: "#FBBF24" },
    saturn: { cn: "土星", type: "planet", icon: "globe.asia.australia.fill", color: "#FDE68A" },
    uranus: { cn: "天王星", type: "planet", icon: "globe.asia.australia.fill", color: "#60A5FA" },
    neptune: { cn: "海王星", type: "planet", icon: "globe.asia.australia.fill", color: "#38BDF8" }
};

var STAR_CATALOG = [
    { id: "sirius", name: "Sirius", cn: "天狼星", ra: 6.75247, dec: -16.7161, mag: -1.46, distanceLy: 8.6 },
    { id: "vega", name: "Vega", cn: "织女星", ra: 18.61564, dec: 38.7837, mag: 0.03, distanceLy: 25.0 },
    { id: "betelgeuse", name: "Betelgeuse", cn: "参宿四", ra: 5.91953, dec: 7.4071, mag: 0.42, distanceLy: 642 },
    { id: "rigel", name: "Rigel", cn: "参宿七", ra: 5.24230, dec: -8.2017, mag: 0.12, distanceLy: 863 }
];

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";

    var title = env.TITLE || "最近天体";
    var accentOverride = String(env.ACCENT_COLOR || "").trim();
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 5, 1440);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);

    var appId = String(env.APP_ID || "").trim();
    var appSecret = String(env.APP_SECRET || "").trim();
    var lat = parseFloat(env.LAT);
    var lon = parseFloat(env.LON);
    var alt = clampNumber(env.ALT || 0, 0, 9000);

    if (!appId || !appSecret) return errorWidget("缺少配置", "请设置 APP_ID/APP_SECRET (AstronomyAPI)");
    if (!isFinite(lat) || !isFinite(lon)) return errorWidget("缺少位置", "请设置 LAT/LON");

    var cached = loadCache(ctx);
    var data = null;
    var now = Date.now();
    var cacheReady = cached && cached.items && cached.items.length > 0;
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            data = await fetchAllBodies(ctx, {
                appId: appId,
                appSecret: appSecret,
                lat: lat,
                lon: lon,
                alt: alt
            });
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("nearest celestial fetch error: " + safeMsg(e));
            if (cacheReady) {
                data = cached;
            } else {
                return errorWidget("获取失败", safeMsg(e));
            }
        }
    }

    data = normalizeData(data);
    if (!data.items || data.items.length === 0) return errorWidget("暂无数据", "未解析到天体位置");

    var view = analyzeItems(data.items);
    if (!view.closest) return errorWidget("暂无数据", "未找到可用天体");

    var accent = accentOverride || colorForBody(view.closest) || "#A78BFA";
    var status = fetched ? "live" : "cached";
    var nextRefresh = new Date(Date.now() + refreshIntervalMs).toISOString();

    if (family === "accessoryCircular") return buildCircular(view, accent);
    if (family === "accessoryRectangular") return buildRectangular(view, accent, title);
    if (family === "accessoryInline") return buildInline(view, accent);
    if (family === "systemSmall") return buildSmall(view, title, accent, status, nextRefresh);
    if (family === "systemLarge") return buildLarge(view, title, accent, status, nextRefresh);
    return buildMedium(view, title, accent, status, nextRefresh);
}

// ============== 数据层 ==============

async function fetchAllBodies(ctx, opts) {
    var now = new Date();
    var dateStr = formatDateUTC(now);
    var timeStr = formatTimeUTC(now);
    var headers = {
        "User-Agent": "Egern-Widget",
        "Authorization": buildAuthHeader(opts.appId, opts.appSecret)
    };

    var solar = await fetchSolarSystemPositions(ctx, headers, opts.lat, opts.lon, opts.alt, dateStr, timeStr);
    var stars = computeStarPositions(opts.lat, opts.lon, now);
    var items = solar.concat(stars);

    return { items: items, ts: Date.now() };
}

async function fetchSolarSystemPositions(ctx, headers, lat, lon, alt, dateStr, timeStr) {
    var url = "https://api.astronomyapi.com/api/v2/bodies/positions"
        + "?latitude=" + encodeURIComponent(lat)
        + "&longitude=" + encodeURIComponent(lon)
        + "&elevation=" + encodeURIComponent(alt)
        + "&from_date=" + encodeURIComponent(dateStr)
        + "&to_date=" + encodeURIComponent(dateStr)
        + "&time=" + encodeURIComponent(timeStr)
        + "&bodies=" + encodeURIComponent(BODY_LIST.join(","));

    var resp = await ctx.http.get(url, { headers: headers, timeout: 10000 });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    var body = await resp.json();

    var bodies = extractBodies(body);
    if (!bodies || bodies.length === 0) {
        throw new Error((body && body.error && body.error.message) || "API 返回异常");
    }

    var results = [];
    for (var i = 0; i < bodies.length; i++) {
        var item = normalizeSolarBody(bodies[i]);
        if (item) results.push(item);
    }
    return results;
}

function extractBodies(body) {
    if (!body) return [];
    var dates = body.data && body.data.dates ? body.data.dates : [];
    if (dates.length > 0 && dates[0].bodies) return dates[0].bodies;
    if (body.data && body.data.bodies) return body.data.bodies;
    if (body.data && body.data.table && body.data.table.rows) return body.data.table.rows;
    return [];
}

function normalizeSolarBody(raw) {
    var body = raw.body || raw;
    var id = String(body.id || body.name || "").toLowerCase();
    var meta = BODY_META[id] || {};

    var altitude = pickNumber(raw, [
        "position.horizontal.altitude.degrees",
        "position.horizontal.altitude",
        "position.altitude.degrees",
        "position.altitude",
        "altitude.degrees",
        "altitude"
    ]);
    var azimuth = pickNumber(raw, [
        "position.horizontal.azimuth.degrees",
        "position.horizontal.azimuth",
        "position.azimuth.degrees",
        "position.azimuth",
        "azimuth.degrees",
        "azimuth"
    ]);

    var distanceKm = pickNumber(raw, [
        "distance.fromEarth.km",
        "distance.km",
        "distance.fromEarth.value"
    ]);
    var distanceAu = pickNumber(raw, [
        "distance.fromEarth.au",
        "distance.au"
    ]);

    var magnitude = pickNumber(raw, ["extraInfo.magnitude", "extra_info.magnitude", "magnitude"]);
    var illumination = pickNumber(raw, ["extraInfo.illumination", "extraInfo.fractionIlluminated", "extra_info.illumination", "illumination"]);
    var phase = pickString(raw, ["extraInfo.phase.name", "extraInfo.phase", "extra_info.phase", "phase"]);

    var name = body.name || id || "未知天体";
    var item = {
        id: id,
        name: name,
        cnName: meta.cn || name,
        enName: meta.cn ? name : "",
        type: meta.type || "planet",
        icon: meta.icon || "globe.asia.australia.fill",
        color: meta.color || "#60A5FA",
        altitude: altitude,
        azimuth: azimuth,
        distanceKm: distanceKm,
        distanceAu: distanceAu,
        magnitude: magnitude,
        illumination: illumination,
        phase: phase,
        feature: meta.feature || ""
    };

    return normalizeItem(item);
}

function computeStarPositions(lat, lon, now) {
    var lstDeg = calcLocalSiderealDegrees(now, lon);
    var results = [];

    for (var i = 0; i < STAR_CATALOG.length; i++) {
        var star = STAR_CATALOG[i];
        var raDeg = star.ra * 15;
        var haDeg = normalizeDegree(lstDeg - raDeg);
        var altAz = calcAltAz(lat, star.dec, haDeg);
        results.push(normalizeItem({
            id: star.id,
            name: star.name,
            cnName: star.cn,
            enName: star.name,
            type: "star",
            icon: "sparkles",
            color: "#A78BFA",
            altitude: altAz.alt,
            azimuth: altAz.az,
            magnitude: star.mag,
            distanceLy: star.distanceLy,
            feature: "亮星"
        }));
    }

    return results;
}

// ============== UI 布局 ==============

function buildSmall(view, title, accent, status, nextRefresh) {
    var item = view.closest;
    return shell([
        header(title, accent, view.visibleCount, view.total),
        sp(6),
        heroBlock(item, accent, true),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildMedium(view, title, accent, status, nextRefresh) {
    var item = view.closest;
    var list = view.list;
    return shell([
        header(title, accent, view.visibleCount, view.total),
        sp(6),
        separator(),
        sp(8),
        heroBlock(item, accent, false),
        sp(8),
        vstack(list.map(function (r) { return listRow(r, accent); }), { gap: 6 }),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildLarge(view, title, accent, status, nextRefresh) {
    var item = view.closest;
    var list = view.list;
    return shell([
        header(title, accent, view.visibleCount, view.total),
        sp(6),
        separator(),
        sp(8),
        heroBlock(item, accent, false),
        sp(8),
        hstack([
            vstack(list.slice(0, 3).map(function (r) { return listRow(r, accent); }), { gap: 6, flex: 1 }),
            vstack(list.slice(3, 6).map(function (r) { return listRow(r, accent); }), { gap: 6, flex: 1 })
        ], { gap: 10, alignItems: "start" }),
        sp(),
        footer(status)
    ], nextRefresh, [14, 16, 12, 16]);
}

function buildCircular(view, accent) {
    var item = view.closest;
    var altText = formatAngle(item.altitude);
    return {
        type: "widget",
        gap: 2,
        children: [
            sp(),
            icon(item.icon, 16, accent),
            txt(altText, 12, "bold", item.visible ? "#FFFFFF" : "rgba(255,255,255,0.5)"),
            sp()
        ]
    };
}

function buildRectangular(view, accent, title) {
    var item = view.closest;
    return {
        type: "widget",
        gap: 3,
        children: [
            hstack([icon(item.icon, 10, accent), txt(title, 10, "medium", "rgba(255,255,255,0.7)")], { gap: 4 }),
            txt(bodyDisplayName(item) + " · " + bodyTypeLabel(item), 12, "bold"),
            txt("高度 " + formatAngle(item.altitude) + " · 方向 " + formatAzimuth(item.azimuth), 10, "medium", "rgba(255,255,255,0.5)")
        ]
    };
}

function buildInline(view, accent) {
    var item = view.closest;
    return {
        type: "widget",
        children: [
            icon(item.icon, 12, accent),
            txt(" " + bodyDisplayName(item) + " 高度 " + formatAngle(item.altitude), 12, "medium", null, { maxLines: 1, minScale: 0.6 })
        ]
    };
}

// ============== UI 组件 ==============

function shell(children, nextRefresh, padding) {
    return {
        type: "widget",
        gap: 0,
        padding: padding || [14, 16, 12, 16],
        backgroundGradient: {
            type: "linear",
            colors: ["#0B1220", "#0F172A", "#111827"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        refreshAfter: nextRefresh,
        children: children
    };
}

function header(title, accent, visibleCount, totalCount) {
    var visibleText = visibleCount > 0 ? (visibleCount + "/" + totalCount + " 可见") : "暂无可见";
    return hstack([
        icon("sparkles", 14, accent),
        txt(title, 12, "bold", accent),
        sp(),
        tag(visibleText, visibleCount > 0 ? "#A7F3D0" : "#F59E0B", visibleCount > 0 ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.16)", 9)
    ], { gap: 6 });
}

function heroBlock(item, accent, compact) {
    var name = bodyDisplayName(item);
    var subtitle = bodyTypeLabel(item) + (item.enName ? " · " + item.enName : "");
    var visibility = item.visible ? "可见" : "地平线下";
    var feature = buildFeatureText(item);

    var tags = [
        tag(visibility, item.visible ? "#10B981" : "#F59E0B", item.visible ? "rgba(16,185,129,0.18)" : "rgba(245,158,11,0.18)", 9),
        tag("高度 " + formatAngle(item.altitude), "#FFFFFFCC", "rgba(255,255,255,0.08)", 9)
    ];

    if (!compact) {
        tags.push(tag("方向 " + formatAzimuth(item.azimuth), "#FFFFFFCC", "rgba(255,255,255,0.08)", 9));
    }

    if (feature) {
        tags.push(tag(feature, accent, accent + "26", 9));
    }

    return vstack([
        txt(name, compact ? 22 : 26, "bold", "#FFFFFF", { minScale: 0.6, maxLines: 1 }),
        txt(subtitle, 10, "medium", "rgba(255,255,255,0.6)", { maxLines: 1, minScale: 0.7 }),
        hstack(tags, { gap: 6, alignItems: "center" })
    ], { gap: 6 });
}

function listRow(item, accent) {
    return hstack([
        colorDot(colorForBody(item), 6),
        txt(bodyDisplayName(item), 11, "medium", "#FFFFFFCC", { maxLines: 1, minScale: 0.7 }),
        sp(),
        txt(formatAngle(item.altitude), 11, "bold", item.visible ? "#FFFFFF" : "rgba(255,255,255,0.4)")
    ], { gap: 6 });
}

function separator() {
    return hstack([sp()], { height: 1, backgroundColor: "rgba(255,255,255,0.08)" });
}

function footer(status) {
    var isLive = status === "live";
    return hstack([
        icon("clock.arrow.circlepath", 8, "rgba(255,255,255,0.25)"),
        {
            type: "date",
            date: new Date().toISOString(),
            format: "relative",
            font: { size: 9, weight: "medium" },
            textColor: "rgba(255,255,255,0.25)"
        },
        sp(),
        tag(isLive ? "实时" : "缓存", isLive ? "#10B981" : "#F59E0B", isLive ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.16)", 8)
    ], { gap: 4 });
}

function tag(text, color, bg, size) {
    return hstack([txt(text, size || 9, "semibold", color || "#FFFFFFCC", { maxLines: 1, minScale: 0.6 })], {
        padding: [2, 6, 2, 6],
        backgroundColor: bg || "rgba(255,255,255,0.08)",
        borderRadius: 6
    });
}

function colorDot(color, size) {
    return {
        type: "stack",
        width: size || 6,
        height: size || 6,
        borderRadius: (size || 6) / 2,
        backgroundColor: color || "#FFFFFF",
        children: []
    };
}

function errorWidget(title, msg) {
    return {
        type: "widget",
        padding: 16,
        gap: 8,
        backgroundGradient: {
            type: "linear",
            colors: ["#0B1220", "#111827"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        children: [
            hstack([icon("exclamationmark.triangle.fill", 14, "#F87171"), txt(title, "headline", "bold", "#FFFFFF")], { gap: 6 }),
            sp(4),
            txt(msg || "未知错误", "caption1", "regular", "rgba(255,255,255,0.7)", { maxLines: 5 })
        ]
    };
}

// ============== 数据分析 ==============

function analyzeItems(items) {
    var list = (items || []).slice();
    list.sort(function (a, b) { return b.altitude - a.altitude; });

    var visible = list.filter(function (i) { return i.visible; });
    var primary = visible.length > 0 ? visible : list;
    var closest = primary.length > 0 ? primary[0] : null;

    return {
        closest: closest,
        visibleCount: visible.length,
        total: list.length,
        list: primary.slice(1, 7)
    };
}

function normalizeData(data) {
    var d = data || {};
    var items = Array.isArray(d.items) ? d.items : [];
    var normalized = [];

    for (var i = 0; i < items.length; i++) {
        var item = normalizeItem(items[i]);
        if (item) normalized.push(item);
    }

    return { items: normalized, ts: d.ts || Date.now() };
}

function normalizeItem(item) {
    if (!item) return null;
    var alt = toFloat(item.altitude);
    var az = toFloat(item.azimuth);

    item.altitude = isFinite(alt) ? alt : -90;
    item.azimuth = isFinite(az) ? normalizeDegree(az) : 0;
    item.visible = item.altitude > 0;

    if (item.illumination != null) {
        var illum = toFloat(item.illumination);
        if (illum > 0 && illum <= 1) illum = illum * 100;
        item.illumination = illum;
    }

    return item;
}

// ============== 计算辅助 ==============

function calcLocalSiderealDegrees(date, lon) {
    var jd = toJulianDate(date);
    var d = jd - 2451545.0;
    var gmst = 280.46061837 + 360.98564736629 * d;
    var lst = normalizeDegree(gmst + lon);
    return lst;
}

function calcAltAz(latDeg, decDeg, hourAngleDeg) {
    var lat = degToRad(latDeg);
    var dec = degToRad(decDeg);
    var ha = degToRad(hourAngleDeg);

    var sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
    var alt = Math.asin(clamp(sinAlt, -1, 1));

    var cosAz = (Math.sin(dec) - Math.sin(alt) * Math.sin(lat)) / (Math.cos(alt) * Math.cos(lat));
    var az = Math.acos(clamp(cosAz, -1, 1));

    if (Math.sin(ha) > 0) az = 2 * Math.PI - az;

    return { alt: radToDeg(alt), az: radToDeg(az) };
}

function toJulianDate(date) {
    return date.getTime() / 86400000 + 2440587.5;
}

function degToRad(d) {
    return d * Math.PI / 180;
}

function radToDeg(r) {
    return r * 180 / Math.PI;
}

function normalizeDegree(d) {
    var n = d % 360;
    return n < 0 ? n + 360 : n;
}

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

// ============== 文本/格式化 ==============

function bodyDisplayName(item) {
    return item.cnName || item.name || item.id || "未知天体";
}

function bodyTypeLabel(item) {
    if (item.id === "sun") return "恒星";
    if (item.id === "moon") return "卫星";
    if (item.type === "star") return "恒星";
    return "行星";
}

function colorForBody(item) {
    if (!item) return "#A78BFA";
    if (item.color) return item.color;
    if (BODY_META[item.id] && BODY_META[item.id].color) return BODY_META[item.id].color;
    return item.type === "star" ? "#A78BFA" : "#60A5FA";
}

function buildFeatureText(item) {
    if (item.id === "sun") return "恒星 · 太阳系中心";
    if (item.id === "moon" && isFinite(item.illumination)) return "月相 " + formatPercent(item.illumination);
    if (item.type === "star") {
        var mag = isFinite(item.magnitude) ? ("星等 " + formatNumber(item.magnitude, 2)) : "亮星";
        var dist = item.distanceLy ? ("距离 " + item.distanceLy + " 光年") : "";
        return dist ? (mag + " · " + dist) : mag;
    }

    var distText = formatDistance(item);
    if (distText !== "--") return "距离 " + distText;
    if (isFinite(item.magnitude)) return "星等 " + formatNumber(item.magnitude, 2);
    return item.feature || "";
}

function formatAngle(deg) {
    var n = toFloat(deg);
    if (!isFinite(n)) return "--";
    return n.toFixed(1) + "°";
}

function formatAzimuth(deg) {
    var n = toFloat(deg);
    if (!isFinite(n)) return "--";
    return azimuthToCompass(n) + " " + n.toFixed(0) + "°";
}

function azimuthToCompass(deg) {
    var dirs = ["北", "北偏东", "东北", "东偏北", "东", "东偏南", "东南", "南偏东", "南", "南偏西", "西南", "西偏南", "西", "西偏北", "西北", "北偏西"];
    var idx = Math.round(normalizeDegree(deg) / 22.5) % 16;
    return dirs[idx];
}

function formatDistance(item) {
    var km = toFloat(item.distanceKm);
    var au = toFloat(item.distanceAu);
    if (km > 0) {
        if (km >= 100000000) return (km / 100000000).toFixed(2) + " 亿 km";
        if (km >= 10000) return (km / 10000).toFixed(1) + " 万 km";
        return km.toFixed(0) + " km";
    }
    if (au > 0) return au.toFixed(3) + " AU";
    return "--";
}

function formatPercent(val) {
    var n = toFloat(val);
    if (!isFinite(n)) return "--";
    return n.toFixed(0) + "%";
}

function formatNumber(val, fixed) {
    var n = toFloat(val);
    if (!isFinite(n)) return "--";
    return n.toFixed(fixed || 1);
}

function formatDateUTC(d) {
    return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}

function formatTimeUTC(d) {
    return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()) + ":" + pad2(d.getUTCSeconds());
}

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

// ============== 网络/鉴权 ==============

function buildAuthHeader(appId, appSecret) {
    var raw = appId + ":" + appSecret;
    if (typeof btoa === "function") return "Basic " + btoa(raw);
    return "Basic " + base64Encode(raw);
}

function base64Encode(str) {
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var bytes = [];
    for (var i = 0; i < str.length; i++) {
        bytes.push(str.charCodeAt(i) & 0xff);
    }

    var out = "";
    for (var j = 0; j < bytes.length; j += 3) {
        var b1 = bytes[j];
        var b2 = j + 1 < bytes.length ? bytes[j + 1] : NaN;
        var b3 = j + 2 < bytes.length ? bytes[j + 2] : NaN;

        var enc1 = b1 >> 2;
        var enc2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : (b2 >> 4));
        var enc3 = isNaN(b2) ? 64 : (((b2 & 15) << 2) | (isNaN(b3) ? 0 : (b3 >> 6)));
        var enc4 = isNaN(b3) ? 64 : (b3 & 63);

        out += chars.charAt(enc1);
        out += chars.charAt(enc2);
        out += enc3 === 64 ? "=" : chars.charAt(enc3);
        out += enc4 === 64 ? "=" : chars.charAt(enc4);
    }
    return out;
}

// ============== DSL 简写 ==============

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

// ============== 通用工具 ==============

function pickNumber(obj, paths) {
    for (var i = 0; i < paths.length; i++) {
        var v = getByPath(obj, paths[i]);
        if (v != null && v !== "") return toFloat(v);
    }
    return NaN;
}

function pickString(obj, paths) {
    for (var i = 0; i < paths.length; i++) {
        var v = getByPath(obj, paths[i]);
        if (v != null && v !== "") return String(v);
    }
    return "";
}

function getByPath(obj, path) {
    if (!obj || !path) return undefined;
    var parts = path.split(".");
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
        if (cur && typeof cur === "object" && parts[i] in cur) cur = cur[parts[i]];
        else return undefined;
    }
    return cur;
}

function clampNumber(val, min, max) {
    var n = parseInt(val, 10);
    if (!isFinite(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
}

function toFloat(val) {
    var n = parseFloat(val);
    return isFinite(n) ? n : NaN;
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

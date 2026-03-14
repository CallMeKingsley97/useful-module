// 通勤时间预测小组件
// 特性：双向 ETA + 自驾/公共交通 + 到达时间/距离/均速/红绿灯/收费/限行/换乘 + 多尺寸布局 + 缓存 + 失败降级

var CACHE_KEY = "commute_eta_cache_v2";
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
    var mode = normalizeMode(env.MODE || env.TRAVEL_MODE || "driving");
    var drivingStrategy = clampNumber(env.STRATEGY || 0, 0, 9);
    var transitStrategy = clampNumber(env.TRANSIT_STRATEGY || env.STRATEGY || 0, 0, 5);
    var city = String(env.CITY || "").trim();
    var cityd = String(env.CITYD || "").trim();
    var nightFlag = isTrue(env.NIGHT_FLAG);

    if (!apiKey) return errorWidget("缺少配置", "请设置 API_KEY (高德)");
    if (!home || !work) return errorWidget("缺少坐标", "请设置 HOME/WORK (lng,lat)");
    if (isTransitMode(mode) && !city) return errorWidget("缺少配置", "公共交通模式需要 CITY（城市名或城市编码）");

    var cached = loadCache(ctx);
    var data = null;
    var now = Date.now();
    var cacheReady = cached && cached.toWork && cached.toHome && (!cached.mode || cached.mode === mode);
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            var toWork = null;
            var toHome = null;

            if (isTransitMode(mode)) {
                var originCity = city;
                var destCity = cityd || city;
                toWork = await fetchTransit(ctx, apiKey, home, work, originCity, destCity, transitStrategy, nightFlag);
                toHome = await fetchTransit(ctx, apiKey, work, home, destCity, originCity, transitStrategy, nightFlag);
            } else {
                toWork = await fetchRoute(ctx, apiKey, home, work, drivingStrategy);
                toHome = await fetchRoute(ctx, apiKey, work, home, drivingStrategy);
            }

            data = { mode: mode, toWork: toWork, toHome: toHome, ts: Date.now() };
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

    data = normalizeData(data, mode);
    var nowTs = Date.now();
    var nextRefresh = new Date(nowTs + refreshIntervalMs).toISOString();
    var status = fetched ? "live" : "cached";

    if (family === "accessoryCircular") return buildCircular(data.toWork, accent);
    if (family === "accessoryRectangular") return buildRectangular(data.toWork, accent, nowTs);
    if (family === "accessoryInline") return buildInline(data.toWork, accent);
    if (family === "systemSmall") return buildSmall(data.toWork, title, accent, status, nextRefresh, nowTs);
    if (family === "systemLarge") return buildLarge(data, title, accent, status, nextRefresh, nowTs);
    return buildMedium(data, title, accent, status, nextRefresh, nowTs);
}

// ============== 数据层 ==============

async function fetchRoute(ctx, apiKey, origin, dest, strategy) {
    var url = "https://restapi.amap.com/v3/direction/driving"
        + "?origin=" + origin.lng + "," + origin.lat
        + "&destination=" + dest.lng + "," + dest.lat
        + "&key=" + encodeURIComponent(apiKey)
        + "&extensions=all"
        + "&strategy=" + strategy;

    var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 10000 });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    var body = await resp.json();
    if (body.status !== "1" || !body.route || !body.route.paths || body.route.paths.length === 0) {
        throw new Error(body.info || "API 返回异常");
    }
    var p = body.route.paths[0] || {};
    return normalizeRoute({
        duration: p.duration,
        distance: p.distance,
        tolls: p.tolls,
        tollDistance: p.toll_distance,
        trafficLights: p.traffic_lights,
        restriction: p.restriction,
        steps: Array.isArray(p.steps) ? p.steps.length : 0
    });
}

async function fetchTransit(ctx, apiKey, origin, dest, city, cityd, strategy, nightFlag) {
    var url = "https://restapi.amap.com/v3/direction/transit/integrated"
        + "?origin=" + origin.lng + "," + origin.lat
        + "&destination=" + dest.lng + "," + dest.lat
        + "&key=" + encodeURIComponent(apiKey)
        + "&city=" + encodeURIComponent(city)
        + (cityd ? ("&cityd=" + encodeURIComponent(cityd)) : "")
        + "&strategy=" + strategy
        + "&nightflag=" + (nightFlag ? 1 : 0);

    var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 10000 });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    var body = await resp.json();
    if (body.status !== "1" || !body.route || !body.route.transits || body.route.transits.length === 0) {
        throw new Error(body.info || "API 返回异常");
    }
    var t = body.route.transits[0] || {};
    var segments = Array.isArray(t.segments) ? t.segments : [];
    var lineInfo = collectTransitLines(segments);

    return normalizeTransitRoute({
        duration: t.duration,
        distance: t.distance,
        walkingDistance: t.walking_distance,
        cost: t.cost,
        transferCount: t.transit_count,
        lineNames: lineInfo.lineNames,
        lineSummary: lineInfo.lineSummary,
        busCount: lineInfo.busCount,
        subwayCount: lineInfo.subwayCount,
        railwayCount: lineInfo.railwayCount
    });
}

// ============== UI 布局 ==============

function buildSmall(r, title, accent, status, nextRefresh, nowTs) {
    if (isTransitMode(r.mode)) {
        var eta = formatDuration(r.duration);
        var arrive = formatClock(nowTs + r.duration * 1000);
        var distance = formatDistance(r.distance);
        var walking = formatDistance(r.walkingDistance);
        var lineText = transitLineText(r);

        return shell([
            header(title, accent, false, r.mode),
            sp(6),
            txt(eta, 26, "bold", "#FFFFFF", { minScale: 0.5, shadowColor: accent + "66", shadowRadius: 6 }),
            txt("到达 " + arrive, 11, "medium", "rgba(255,255,255,0.75)"),
            txt(lineText, 10, "medium", "rgba(255,255,255,0.6)", { maxLines: 1, minScale: 0.6 }),
            txt(distance + " · 步行 " + walking, 10, "medium", "rgba(255,255,255,0.55)", { maxLines: 1, minScale: 0.7 }),
            hstack([
                tag(formatTransfers(r.transferCount), "#A7F3D0", "rgba(16,185,129,0.12)"),
                tag(formatTransitCost(r.cost), "#93C5FD", "rgba(59,130,246,0.12)")
            ], { gap: 6 }),
            sp(),
            footer(status)
        ], nextRefresh, [14, 16, 12, 16]);
    }

    var etaDrive = formatDuration(r.duration);
    var level = trafficLevel(r.duration, r.distance);
    var arriveDrive = formatClock(nowTs + r.duration * 1000);
    var distanceDrive = formatDistance(r.distance);
    var speed = formatSpeed(r.duration, r.distance);
    var tollText = formatTollInfo(r, true);
    var tollColor = r.tolls > 0 ? "#FDE68A" : "#A7F3D0";
    var tollBg = r.tolls > 0 ? "rgba(253,224,71,0.15)" : "rgba(16,185,129,0.12)";

    return shell([
        header(title, accent, false, r.mode),
        sp(6),
        txt(etaDrive, 28, "bold", "#FFFFFF", { minScale: 0.5, shadowColor: accent + "66", shadowRadius: 6 }),
        txt("到达 " + arriveDrive, 11, "medium", "rgba(255,255,255,0.75)"),
        txt(distanceDrive + " · 均速 " + speed, 10, "medium", "rgba(255,255,255,0.6)", { maxLines: 1, minScale: 0.7 }),
        hstack([levelTag(level), tag(tollText, tollColor, tollBg)], { gap: 6 }),
        sp(),
        footer(status)
    ], nextRefresh, [14, 16, 12, 16]);
}

function buildMedium(data, title, accent, status, nextRefresh, nowTs) {
    var toWork = data.toWork;
    var toHome = data.toHome;
    return shell([
        header(title, accent, true, data.mode),
        sp(6),
        separator(),
        sp(8),
        hstack([
            routeCard("去公司", toWork, accent, nowTs, true),
            routeCard("回家", toHome, accent, nowTs, true)
        ], { gap: 8, alignItems: "start" }),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildLarge(data, title, accent, status, nextRefresh, nowTs) {
    var toWork = data.toWork;
    var toHome = data.toHome;
    var compare = compareDuration(toWork.duration, toHome.duration);

    var bannerText = "";
    var badgeText = "";

    if (isTransitMode(data.mode)) {
        var walkingTotal = formatDistance(toWork.walkingDistance + toHome.walkingDistance);
        var costTotal = formatMoney(toWork.cost + toHome.cost);
        bannerText = compare + " · 票价 ¥" + costTotal;
        badgeText = "步行 " + walkingTotal;
    } else {
        var avgSpeed = formatSpeedByDistanceDuration(toWork.distance + toHome.distance, toWork.duration + toHome.duration);
        var avgText = avgSpeed === "--" ? "平均 --" : ("平均 " + avgSpeed);
        bannerText = compare;
        badgeText = avgText;
    }

    return shell([
        header(title, accent, true, data.mode),
        sp(6),
        separator(),
        sp(8),
        vstack([
            routeCard("去公司", toWork, accent, nowTs, false),
            routeCard("回家", toHome, accent, nowTs, false)
        ], { gap: 8 }),
        sp(6),
        infoBanner(bannerText, badgeText),
        sp(),
        footer(status)
    ], nextRefresh, [14, 16, 12, 16]);
}

function buildCircular(r, accent) {
    var minutes = r.duration > 0 ? (Math.max(1, Math.round(r.duration / 60)) + "分") : "—";
    var color = isTransitMode(r.mode) ? accent : trafficLevel(r.duration, r.distance).color;
    return {
        type: "widget",
        gap: 2,
        children: [
            sp(),
            icon(modeIcon(r.mode), 16, accent),
            txt(minutes, 12, "bold", color),
            sp()
        ]
    };
}

function buildRectangular(r, accent, nowTs) {
    if (isTransitMode(r.mode)) {
        var eta = formatDuration(r.duration);
        var arrive = formatClock(nowTs + r.duration * 1000);
        return {
            type: "widget",
            gap: 3,
            children: [
                hstack([icon(modeIcon(r.mode), 10, accent), txt("公共交通", 10, "medium", "rgba(255,255,255,0.7)"), sp(), txt(formatTransfers(r.transferCount), 10, "bold", "#A7F3D0")], { gap: 4 }),
                txt(eta + " · 到达 " + arrive, 12, "bold"),
                txt("步行 " + formatDistance(r.walkingDistance) + " · " + formatTransitCost(r.cost), 10, "medium", "rgba(255,255,255,0.5)")
            ]
        };
    }

    var etaDrive = formatDuration(r.duration);
    var level = trafficLevel(r.duration, r.distance);
    var arriveDrive = formatClock(nowTs + r.duration * 1000);
    var speed = formatSpeed(r.duration, r.distance);
    return {
        type: "widget",
        gap: 3,
        children: [
            hstack([icon(modeIcon(r.mode), 10, accent), txt("通勤 ETA", 10, "medium", "rgba(255,255,255,0.7)"), sp(), txt(level.text, 10, "bold", level.color)], { gap: 4 }),
            txt(etaDrive + " · 到达 " + arriveDrive, 12, "bold"),
            txt(formatDistance(r.distance) + " · " + speed, 10, "medium", "rgba(255,255,255,0.5)")
        ]
    };
}

function buildInline(r, accent) {
    if (isTransitMode(r.mode)) {
        var eta = formatDuration(r.duration);
        return {
            type: "widget",
            children: [
                icon(modeIcon(r.mode), 12, accent),
                txt(" 去公司 " + eta + " · " + formatTransfers(r.transferCount) + " · " + formatTransitCost(r.cost), 12, "medium", null, { minScale: 0.6, maxLines: 1 })
            ]
        };
    }

    var etaDrive = formatDuration(r.duration);
    var distance = formatDistance(r.distance);
    var speed = formatSpeed(r.duration, r.distance);
    return {
        type: "widget",
        children: [
            icon(modeIcon(r.mode), 12, accent),
            txt(" 去公司 " + etaDrive + " · " + distance + " · " + speed, 12, "medium", null, { minScale: 0.6, maxLines: 1 })
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

function header(title, accent, showTime, mode) {
    var right = [];
    if (showTime) {
        right.push({
            type: "date",
            date: new Date().toISOString(),
            format: "time",
            font: { size: 10, weight: "medium" },
            textColor: "rgba(255,255,255,0.35)"
        });
    }
    if (isTransitMode(mode)) {
        right.push(tag(modeLabel(mode), "#93C5FD", "rgba(59,130,246,0.16)", 8));
    }

    return hstack([
        icon(modeIcon(mode), 14, accent),
        txt(title, 12, "bold", accent, {
            shadowColor: accent + "66",
            shadowRadius: 4,
            shadowOffset: { x: 0, y: 0 }
        }),
        sp(),
        hstack(right, { gap: 6 })
    ], { gap: 6 });
}

function separator() {
    return hstack([sp()], { height: 1, backgroundColor: "rgba(255,255,255,0.08)" });
}

function routeCard(label, r, accent, nowTs, compact) {
    if (isTransitMode(r.mode)) {
        var eta = formatDuration(r.duration);
        var arrive = formatClock(nowTs + r.duration * 1000);
        var distance = formatDistance(r.distance);
        var walking = formatDistance(r.walkingDistance);
        var lineText = transitLineText(r);
        var metaLine = "到达 " + arrive + " · 步行 " + walking + " · " + formatTransitCost(r.cost);

        var tags = [
            tag(formatTransfers(r.transferCount), "#A7F3D0", "rgba(16,185,129,0.12)"),
            tag(transitBadgeText(r), "#93C5FD", "rgba(59,130,246,0.12)")
        ];
        if (!compact) {
            tags.push(tag("距离 " + distance, "#FBBF24", "rgba(245,158,11,0.12)"));
        }

        return vstack([
            hstack([txt(label, 11, "semibold", "rgba(255,255,255,0.75)"), sp(), tag("公共交通", "#93C5FD", "rgba(59,130,246,0.12)", 8)], { gap: 6 }),
            txt(eta, compact ? 18 : 20, "bold", "#FFFFFF"),
            txt(lineText, 10, "medium", "rgba(255,255,255,0.6)", { maxLines: 1, minScale: 0.6 }),
            txt(metaLine, 10, "medium", "rgba(255,255,255,0.6)", { maxLines: 1, minScale: 0.6 }),
            hstack(tags, { gap: 4, alignItems: "center" })
        ], {
            flex: 1,
            gap: 5,
            padding: compact ? [8, 10, 8, 10] : [10, 12, 10, 12],
            backgroundGradient: {
                type: "linear",
                colors: [accent + "22", "rgba(255,255,255,0.04)"],
                startPoint: { x: 0, y: 0 },
                endPoint: { x: 1, y: 1 }
            },
            borderRadius: 12,
            borderWidth: 0.5,
            borderColor: "rgba(255,255,255,0.08)"
        });
    }

    var level = trafficLevel(r.duration, r.distance);
    var etaDrive = formatDuration(r.duration);
    var arriveDrive = formatClock(nowTs + r.duration * 1000);
    var distanceDrive = formatDistance(r.distance);
    var speed = formatSpeed(r.duration, r.distance);
    var metaLine = "到达 " + arriveDrive + " · " + distanceDrive + " · 均速 " + speed;

    var tollText = formatTollInfo(r, compact);
    var tollColor = r.tolls > 0 ? "#FDE68A" : "#A7F3D0";
    var tollBg = r.tolls > 0 ? "rgba(253,224,71,0.12)" : "rgba(16,185,129,0.12)";
    var lightsText = r.trafficLights > 0 ? ("红绿灯 " + r.trafficLights) : "红绿灯 --";
    var restrictionText = r.restriction ? "限行" : "不限行";

    var tagsDrive = [
        tag(lightsText, "#FFFFFFCC", "rgba(255,255,255,0.08)"),
        tag(tollText, tollColor, tollBg)
    ];
    if (!compact) {
        tagsDrive.push(tag(restrictionText, r.restriction ? "#FCA5A5" : "#93C5FD", r.restriction ? "rgba(239,68,68,0.12)" : "rgba(59,130,246,0.12)"));
    }

    return vstack([
        hstack([txt(label, 11, "semibold", "rgba(255,255,255,0.75)"), sp(), levelTag(level)], { gap: 6 }),
        txt(etaDrive, compact ? 18 : 20, "bold", "#FFFFFF"),
        txt(metaLine, 10, "medium", "rgba(255,255,255,0.6)", { maxLines: 1, minScale: 0.6 }),
        hstack(tagsDrive, { gap: 4, alignItems: "center" })
    ], {
        flex: 1,
        gap: 5,
        padding: compact ? [8, 10, 8, 10] : [10, 12, 10, 12],
        backgroundGradient: {
            type: "linear",
            colors: [accent + "22", "rgba(255,255,255,0.04)"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        borderRadius: 12,
        borderWidth: 0.5,
        borderColor: "rgba(255,255,255,0.08)"
    });
}

function infoBanner(text, badgeText) {
    return hstack([
        icon("sparkles", 10, "#A78BFA"),
        txt(text, 10, "medium", "rgba(255,255,255,0.7)", { maxLines: 1, minScale: 0.6 }),
        sp(),
        tag(badgeText, "#A78BFA", "rgba(167,139,250,0.18)", 9)
    ], {
        gap: 6,
        padding: [6, 8, 6, 8],
        backgroundColor: "rgba(255,255,255,0.04)",
        borderRadius: 10,
        borderWidth: 0.5,
        borderColor: "rgba(255,255,255,0.08)"
    });
}

function footer(status) {
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
        statusTag(status)
    ], { gap: 4 });
}

function tag(text, color, bg, size) {
    return hstack([txt(text, size || 9, "semibold", color || "#FFFFFFCC", { maxLines: 1, minScale: 0.6 })], {
        padding: [2, 6, 2, 6],
        backgroundColor: bg || "rgba(255,255,255,0.08)",
        borderRadius: 6
    });
}

function levelTag(level) {
    return tag(level.text, level.color, level.color + "22");
}

function statusTag(status) {
    var isLive = status === "live";
    return tag(isLive ? "实时" : "缓存", isLive ? "#10B981" : "#F59E0B", isLive ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.16)", 8);
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

function normalizeMode(raw) {
    var v = String(raw || "driving").toLowerCase();
    if (v === "transit" || v === "public" || v === "bus" || v === "pt") return "transit";
    return "driving";
}

function isTransitMode(mode) {
    return normalizeMode(mode) === "transit";
}

function modeIcon(mode) {
    return isTransitMode(mode) ? "bus.fill" : "car.fill";
}

function modeLabel(mode) {
    return isTransitMode(mode) ? "公共交通" : "自驾";
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

function compareDuration(aSec, bSec) {
    var diff = (aSec || 0) - (bSec || 0);
    if (diff === 0) return "往返耗时相当";
    var text = formatDuration(Math.abs(diff));
    return diff > 0 ? ("去公司比回家多 " + text) : ("回家比去公司多 " + text);
}

function formatClock(ts) {
    var d = new Date(ts);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

function formatSpeed(durationSec, distanceMeter) {
    return formatSpeedByDistanceDuration(distanceMeter, durationSec);
}

function formatSpeedByDistanceDuration(distanceMeter, durationSec) {
    var dist = toFloat(distanceMeter);
    var dur = toFloat(durationSec);
    if (dur <= 0 || dist <= 0) return "--";
    var kmh = dist / dur * 3.6;
    var fixed = kmh < 10 ? 1 : 0;
    return kmh.toFixed(fixed) + " km/h";
}

function formatMoney(val) {
    var num = toFloat(val);
    if (num <= 0) return "0";
    return num < 10 ? num.toFixed(1) : num.toFixed(0);
}

function formatTollInfo(r, compact) {
    var tolls = r ? toFloat(r.tolls) : 0;
    if (tolls <= 0) return "免费通行";
    var text = "收费 ¥" + formatMoney(tolls);
    if (!compact && r && toInt(r.tollDistance) > 0) {
        text += " / " + formatDistance(r.tollDistance);
    }
    return text;
}

function formatTransfers(n) {
    var count = toInt(n);
    if (count <= 0) return "直达";
    return "换乘 " + count;
}

function formatTransitCost(cost) {
    return "票价 ¥" + formatMoney(cost);
}

function transitLineText(r) {
    if (r.lineNames && r.lineNames.length > 0) return r.lineNames.join(" / ");
    if (r.lineSummary) return r.lineSummary;
    return "公共交通";
}

function transitBadgeText(r) {
    if (r.lineSummary) return r.lineSummary;
    if (r.lineNames && r.lineNames.length > 0) return r.lineNames.join("/");
    return "公共交通";
}

function collectTransitLines(segments) {
    var names = [];
    var busCount = 0;
    var subwayCount = 0;
    var railwayCount = 0;

    for (var i = 0; i < segments.length; i++) {
        var seg = segments[i] || {};
        var bus = seg.bus || {};
        var lines = Array.isArray(bus.buslines) ? bus.buslines : [];

        for (var j = 0; j < lines.length; j++) {
            var line = lines[j] || {};
            var name = String(line.name || "").trim();
            if (name) names.push(trimLineName(name));
            if (isSubwayLine(name, line.type)) subwayCount += 1;
            else busCount += 1;
        }

        if (seg.railway) {
            railwayCount += 1;
            var rname = String(seg.railway.name || seg.railway.trip || "").trim();
            if (rname) names.push(trimLineName(rname));
        }
    }

    var uniqueNames = uniq(names);
    var shortNames = uniqueNames.slice(0, 2);
    var summary = buildLineSummary(busCount, subwayCount, railwayCount, shortNames);

    return {
        lineNames: shortNames,
        lineSummary: summary,
        busCount: busCount,
        subwayCount: subwayCount,
        railwayCount: railwayCount
    };
}

function buildLineSummary(busCount, subwayCount, railwayCount, lineNames) {
    var parts = [];
    if (subwayCount > 0) parts.push("地铁 " + subwayCount);
    if (busCount > 0) parts.push("公交 " + busCount);
    if (railwayCount > 0) parts.push("铁路 " + railwayCount);
    if (parts.length > 0) return parts.join(" · ");
    if (lineNames && lineNames.length > 0) return lineNames.join(" / ");
    return "步行";
}

function trimLineName(name) {
    var raw = String(name || "").trim();
    if (!raw) return raw;
    var simple = raw.split("(")[0].split("（")[0].trim();
    return simple || raw;
}

function isSubwayLine(name, type) {
    var t = String(type || "").toLowerCase();
    if (t.indexOf("地铁") >= 0 || t.indexOf("metro") >= 0) return true;
    var n = String(name || "");
    return n.indexOf("地铁") >= 0 || n.indexOf("轨道") >= 0 || n.indexOf("Metro") >= 0 || n.indexOf("线") >= 0 && n.indexOf("地铁") >= 0;
}

function uniq(arr) {
    var out = [];
    var seen = {};
    for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (!v || seen[v]) continue;
        seen[v] = 1;
        out.push(v);
    }
    return out;
}

function normalizeData(data, mode) {
    var d = data || {};
    var m = normalizeMode(d.mode || mode || "driving");
    return {
        mode: m,
        toWork: normalizeRouteByMode(d.toWork, m),
        toHome: normalizeRouteByMode(d.toHome, m),
        ts: d.ts || Date.now()
    };
}

function normalizeRouteByMode(r, mode) {
    if (isTransitMode(mode)) return normalizeTransitRoute(r);
    return normalizeRoute(r);
}

function normalizeRoute(r) {
    var obj = r || {};
    return {
        mode: "driving",
        duration: toInt(obj.duration),
        distance: toInt(obj.distance),
        tolls: toFloat(obj.tolls),
        tollDistance: toInt(obj.tollDistance || obj.toll_distance),
        trafficLights: toInt(obj.trafficLights || obj.traffic_lights),
        restriction: isTrue(obj.restriction),
        steps: toInt(obj.steps)
    };
}

function normalizeTransitRoute(r) {
    var obj = r || {};
    var lineNames = Array.isArray(obj.lineNames) ? obj.lineNames : [];
    var busCount = toInt(obj.busCount);
    var subwayCount = toInt(obj.subwayCount);
    var railwayCount = toInt(obj.railwayCount);
    var summary = String(obj.lineSummary || "");

    if (!summary) summary = buildLineSummary(busCount, subwayCount, railwayCount, lineNames);

    return {
        mode: "transit",
        duration: toInt(obj.duration),
        distance: toInt(obj.distance),
        walkingDistance: toInt(obj.walkingDistance || obj.walking_distance),
        cost: toFloat(obj.cost),
        transferCount: toInt(obj.transferCount || obj.transit_count),
        lineNames: lineNames,
        lineSummary: summary,
        busCount: busCount,
        subwayCount: subwayCount,
        railwayCount: railwayCount
    };
}

function toInt(val) {
    var n = parseInt(val || 0, 10);
    return isFinite(n) ? n : 0;
}

function toFloat(val) {
    var n = parseFloat(val || 0);
    return isFinite(n) ? n : 0;
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

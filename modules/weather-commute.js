// 天气通勤舒适度小组件
// 特性：和风天气实况/逐小时/7日 + 昨日对比 + 通勤舒适度指数 + 多尺寸布局 + 缓存 + 失败降级

var CACHE_KEY = "weather_commute_cache_v1";
var DEFAULT_REFRESH_MINUTES = 30;

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";

    var title = env.TITLE || "天气通勤舒适度";
    var accent = env.ACCENT_COLOR || "#60A5FA";
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 5, 1440);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);

    var host = normalizeHost(env.HOST || "");
    var apiKey = String(env.API_KEY || "").trim();
    var location = String(env.LOCATION || "").trim();
    var locationNameInput = String(env.LOCATION_NAME || "").trim();

    if (!host) return errorWidget("缺少配置", "请设置 HOST (和风天气)");
    if (!apiKey) return errorWidget("缺少配置", "请设置 API_KEY (和风天气)");
    if (!location) return errorWidget("缺少位置", "请设置 LOCATION (经纬度/LocationID)");

    var cached = loadCache(ctx);
    var data = null;
    var now = Date.now();
    var cacheReady = cached && cached.now;
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            data = await fetchAllWeather(ctx, {
                host: host,
                apiKey: apiKey,
                location: location
            });
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("weather fetch error: " + safeMsg(e));
            if (cacheReady) {
                data = cached;
            } else {
                return errorWidget("获取失败", safeMsg(e));
            }
        }
    }

    var locationName = resolveLocationName(locationNameInput, data.locationInfo, location);
    var view = buildView(data, locationName, accent);
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

async function fetchAllWeather(ctx, opts) {
    var locationId = isValidLocationId(opts.location) ? opts.location : null;
    var locationInfo = await fetchLocationInfo(ctx, opts);
    if (locationInfo && locationInfo.id) locationId = locationInfo.id;

    var now = await fetchNow(ctx, opts);
    var hourly = await fetchHourly(ctx, opts);
    var daily = await fetchDaily(ctx, opts);
    var yesterday = null;

    if (locationId) {
        yesterday = await fetchYesterday(ctx, {
            host: opts.host,
            apiKey: opts.apiKey,
            locationId: locationId
        });
    }

    return { now: now, hourly: hourly, daily: daily, yesterday: yesterday, locationInfo: locationInfo, ts: Date.now() };
}

async function fetchNow(ctx, opts) {
    var url = opts.host + "/v7/weather/now?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
    var body = await fetchJson(ctx, url);
    if (body.code !== "200") throw new Error("当前天气异常: " + body.code);
    return body;
}

async function fetchHourly(ctx, opts) {
    var url = opts.host + "/v7/weather/24h?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
    var body = await fetchJson(ctx, url);
    if (body.code !== "200") throw new Error("逐小时天气异常: " + body.code);
    return body;
}

async function fetchDaily(ctx, opts) {
    var url = opts.host + "/v7/weather/7d?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
    var body = await fetchJson(ctx, url);
    if (body.code !== "200") throw new Error("7日天气异常: " + body.code);
    return body;
}

async function fetchYesterday(ctx, opts) {
    var date = formatDateCompact(new Date(Date.now() - 86400000));
    var url = opts.host + "/v7/historical/weather?location=" + encodeURIComponent(opts.locationId) + "&date=" + date + "&key=" + encodeURIComponent(opts.apiKey);
    var body = await fetchJson(ctx, url);
    if (body.code !== "200") throw new Error("历史天气异常: " + body.code);
    body.requestDate = date;
    return body;
}

async function fetchJson(ctx, url) {
    var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 10000 });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    return await resp.json();
}

async function fetchLocationInfo(ctx, opts) {
    var url = opts.host + "/v2/city/lookup?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
    try {
        var body = await fetchJson(ctx, url);
        if (body.code !== "200" || !body.location || body.location.length === 0) return null;
        var loc = body.location[0];
        return {
            id: loc.id || "",
            name: formatLocationName(loc)
        };
    } catch (e) {
        console.log("location lookup error: " + safeMsg(e));
        return null;
    }
}

function formatLocationName(loc) {
    if (!loc) return "";
    var city = loc.adm2 || loc.adm1 || "";
    var district = loc.name || "";
    if (city && district && city !== district) return city + "·" + district;
    return district || city || loc.adm1 || "";
}

function resolveLocationName(input, locationInfo, fallback) {
    if (input) return input;
    if (locationInfo && locationInfo.name) return locationInfo.name;
    return fallback || "--";
}

// ============== 视图模型 ==============

function buildView(data, locationName, accent) {
    var nowRaw = data.now ? data.now.now : null;
    var hourlyRaw = data.hourly ? data.hourly.hourly : [];
    var dailyRaw = data.daily ? data.daily.daily : [];
    var yesterdayRaw = data.yesterday;

    var now = normalizeNow(nowRaw, data.now ? data.now.updateTime : "");
    var hourly = normalizeHourly(hourlyRaw);
    var daily = normalizeDaily(dailyRaw);
    var yesterday = normalizeYesterday(yesterdayRaw);

    var today = daily.length > 0 ? daily[0] : null;
    var isNight = computeIsNight(today);
    var iconName = iconForWeather(now.icon, isNight);

    var comfort = calcComfort(now, hourly[0]);
    var yesterdayDiff = calcYesterdayDiff(now, yesterday);

    return {
        location: locationName,
        now: now,
        hourly: hourly,
        daily: daily,
        today: today,
        isNight: isNight,
        iconName: iconName,
        comfort: comfort,
        yesterdayDiff: yesterdayDiff,
        accent: accent
    };
}

function normalizeNow(now, updateTime) {
    if (!now) return { temp: NaN, feelsLike: NaN, text: "--", icon: "100" };
    return {
        obsTime: now.obsTime || updateTime || "",
        temp: toFloat(now.temp),
        feelsLike: toFloat(now.feelsLike),
        text: now.text || "--",
        icon: now.icon || "100",
        windDir: now.windDir || "--",
        windScale: now.windScale || "--",
        windSpeed: toFloat(now.windSpeed),
        humidity: toFloat(now.humidity),
        precip: toFloat(now.precip),
        pressure: toFloat(now.pressure),
        vis: toFloat(now.vis),
        cloud: toFloat(now.cloud),
        dew: toFloat(now.dew)
    };
}

function normalizeHourly(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (h) {
        return {
            time: h.fxTime,
            temp: toFloat(h.temp),
            icon: h.icon || "100",
            text: h.text || "",
            windSpeed: toFloat(h.windSpeed),
            humidity: toFloat(h.humidity),
            pop: toFloat(h.pop),
            precip: toFloat(h.precip)
        };
    });
}

function normalizeDaily(arr) {
    if (!Array.isArray(arr)) return [];
    return arr.map(function (d) {
        return {
            date: d.fxDate,
            tempMax: toFloat(d.tempMax),
            tempMin: toFloat(d.tempMin),
            iconDay: d.iconDay || "100",
            textDay: d.textDay || "--",
            iconNight: d.iconNight || "100",
            textNight: d.textNight || "--",
            sunrise: d.sunrise,
            sunset: d.sunset
        };
    });
}

function normalizeYesterday(yesterday) {
    if (!yesterday || !yesterday.weatherDaily) return null;
    var hourly = Array.isArray(yesterday.weatherHourly) ? yesterday.weatherHourly : [];
    return {
        date: yesterday.weatherDaily.date,
        tempMax: toFloat(yesterday.weatherDaily.tempMax),
        tempMin: toFloat(yesterday.weatherDaily.tempMin),
        hourly: hourly.map(function (h) {
            return { time: h.time, temp: toFloat(h.temp) };
        })
    };
}

// ============== UI 布局 ==============

function buildSmall(view, title, accent, status, nextRefresh) {
    var now = view.now;
    var comfort = view.comfort;
    var diff = view.yesterdayDiff;
    var today = view.today;

    return shell([
        header(view.location, now, view.iconName, accent, title, true),
        sp(6),
        hstack([
            txt(formatTemp(now.temp), 30, "bold", "#FFFFFF"),
            sp(6),
            vstack([
                txt(now.text, 11, "semibold", "rgba(255,255,255,0.8)", { maxLines: 1 }),
                txt("体感 " + formatTemp(now.feelsLike), 10, "medium", "rgba(255,255,255,0.6)")
            ], { gap: 2, alignItems: "start" })
        ], { gap: 6, alignItems: "center" }),
        sp(6),
        hstack([
            comfortTag(comfort),
            tag(diff.text, diff.color, diff.bg)
        ], { gap: 6 }),
        sp(6),
        hstack([
            metricInline("风速", formatWind(now.windSpeed)),
            metricInline("湿度", formatPercent(now.humidity))
        ], { gap: 8 }),
        sp(),
        footer(status)
    ], nextRefresh, [14, 16, 12, 16]);
}

function buildMedium(view, title, accent, status, nextRefresh) {
    var now = view.now;
    var today = view.today;
    var hourly = view.hourly.slice(0, 6);
    var daily = view.daily.slice(0, 3);

    return shell([
        header(view.location, now, view.iconName, accent, title, false),
        sp(8),
        hstack([
            vstack([
                txt(now.text, 12, "semibold", "rgba(255,255,255,0.8)"),
                txt("最高 " + formatTemp(today ? today.tempMax : NaN) + " / 最低 " + formatTemp(today ? today.tempMin : NaN), 10, "medium", "rgba(255,255,255,0.6)"),
                sp(6),
                comfortCard(view.comfort)
            ], { gap: 2, flex: 1 }),
            sp(),
            vstack([
                icon(view.iconName, 28, accent),
                txt(formatTemp(now.temp), 40, "bold", "#FFFFFF", { minScale: 0.6 })
            ], { gap: 4, alignItems: "center" })
        ], { alignItems: "center" }),
        sp(8),
        hstack([
            metricBlock("体感", formatTemp(now.feelsLike)),
            metricBlock("湿度", formatPercent(now.humidity)),
            metricBlock("风速", formatWind(now.windSpeed)),
            metricBlock("降水", formatPrecip(now.precip))
        ], { gap: 6 }),
        sp(8),
        hourlyStrip(hourly, accent),
        sp(8),
        hstack(daily.map(function (d) { return dailyCard(d, accent); }), { gap: 6 }),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildLarge(view, title, accent, status, nextRefresh) {
    var now = view.now;
    var today = view.today;
    var hourly = view.hourly.slice(0, 8);
    var daily = view.daily.slice(0, 6);

    return shell([
        header(view.location, now, view.iconName, accent, title, false),
        sp(8),
        hstack([
            vstack([
                txt(now.text, 12, "semibold", "rgba(255,255,255,0.8)"),
                txt("最高 " + formatTemp(today ? today.tempMax : NaN) + " / 最低 " + formatTemp(today ? today.tempMin : NaN), 10, "medium", "rgba(255,255,255,0.6)"),
                sp(6),
                comfortCard(view.comfort),
                sp(6),
                hstack([
                    infoChip("日出", today ? today.sunrise : "--"),
                    infoChip("日落", today ? today.sunset : "--")
                ], { gap: 6 })
            ], { gap: 2, flex: 1 }),
            sp(),
            vstack([
                icon(view.iconName, 30, accent),
                txt(formatTemp(now.temp), 44, "bold", "#FFFFFF", { minScale: 0.6 }),
                tag(view.yesterdayDiff.text, view.yesterdayDiff.color, view.yesterdayDiff.bg)
            ], { gap: 6, alignItems: "center" })
        ], { alignItems: "center" }),
        sp(10),
        hstack([
            metricBlock("体感", formatTemp(now.feelsLike)),
            metricBlock("湿度", formatPercent(now.humidity)),
            metricBlock("风速", formatWind(now.windSpeed)),
            metricBlock("能见度", formatVis(now.vis))
        ], { gap: 6 }),
        sp(10),
        hourlyStrip(hourly, accent),
        sp(10),
        hstack([
            vstack(daily.slice(0, 3).map(function (d) { return dailyCard(d, accent); }), { gap: 6, flex: 1 }),
            vstack(daily.slice(3, 6).map(function (d) { return dailyCard(d, accent); }), { gap: 6, flex: 1 })
        ], { gap: 8, alignItems: "start" }),
        sp(),
        footer(status)
    ], nextRefresh, [14, 16, 12, 16]);
}

function buildCircular(view, accent) {
    var now = view.now;
    return {
        type: "widget",
        gap: 2,
        children: [
            sp(),
            icon(view.iconName, 16, accent),
            txt(formatTemp(now.temp), 12, "bold"),
            sp()
        ]
    };
}

function buildRectangular(view, accent, title) {
    var now = view.now;
    return {
        type: "widget",
        gap: 3,
        children: [
            hstack([icon(view.iconName, 10, accent), txt(title, 10, "medium", "rgba(255,255,255,0.7)")], { gap: 4 }),
            txt(formatTemp(now.temp) + " · " + now.text, 12, "bold"),
            txt(view.comfort.level + " · " + view.yesterdayDiff.text, 10, "medium", "rgba(255,255,255,0.5)")
        ]
    };
}

function buildInline(view, accent) {
    var now = view.now;
    return {
        type: "widget",
        children: [
            icon(view.iconName, 12, accent),
            txt(" " + formatTemp(now.temp) + " " + view.comfort.level, 12, "medium", null, { maxLines: 1, minScale: 0.6 })
        ]
    };
}

// ============== UI 组件 ==============

function shell(children, nextRefresh, padding) {
    return {
        type: "widget",
        gap: 0,
        padding: padding || [12, 14, 10, 14],
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

function header(location, now, iconName, accent, title, compact) {
    var timeText = formatClock(now.obsTime);
    return hstack([
        icon("location.fill", 10, accent),
        txt(location, 12, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 }),
        sp(),
        txt(timeText, 10, "medium", "rgba(255,255,255,0.5)")
    ], { gap: 6 });
}

function comfortCard(comfort) {
    return vstack([
        hstack([
            txt("通勤舒适度", 10, "medium", "rgba(255,255,255,0.6)"),
            sp(),
            tag(comfort.level, comfort.color, comfort.bg)
        ], { gap: 6 }),
        txt(comfort.score + "分", 22, "bold", "#FFFFFF"),
        progressBar(comfort.score / 100, comfort.color)
    ], { gap: 4 });
}

function comfortTag(comfort) {
    return tag("舒适度 " + comfort.level + " " + comfort.score + "分", comfort.color, comfort.bg);
}

function hourlyStrip(hourly, accent) {
    if (!hourly || hourly.length === 0) return sp();
    var temps = hourly.map(function (h) { return h.temp; });
    var min = minOf(temps);
    var max = maxOf(temps);

    return hstack(hourly.map(function (h) {
        var ratio = max === min ? 0.5 : (h.temp - min) / (max - min);
        var barHeight = 6 + ratio * 20;
        return vstack([
            txt(formatHour(h.time), 8, "medium", "rgba(255,255,255,0.5)"),
            sp(2),
            { type: "stack", width: 6, height: barHeight, borderRadius: 3, backgroundColor: "rgba(255,255,255,0.35)", children: [] },
            txt(formatTemp(h.temp), 9, "semibold", "#FFFFFFCC", { minScale: 0.6 })
        ], { gap: 3, alignItems: "center", width: 30 });
    }), { gap: 6, alignItems: "end" });
}

function dailyCard(d, accent) {
    return vstack([
        txt(formatWeekday(d.date), 9, "medium", "rgba(255,255,255,0.6)"),
        icon(iconForWeather(d.iconDay, false), 14, accent),
        txt(formatTemp(d.tempMax) + "/" + formatTemp(d.tempMin), 9, "semibold", "#FFFFFFCC")
    ], {
        gap: 4,
        padding: [6, 8, 6, 8],
        backgroundColor: "rgba(255,255,255,0.06)",
        borderRadius: 8
    });
}

function metricBlock(label, value) {
    return vstack([
        txt(label, 9, "medium", "rgba(255,255,255,0.5)"),
        txt(value, 12, "bold", "#FFFFFF")
    ], {
        gap: 2,
        padding: [6, 8, 6, 8],
        backgroundColor: "rgba(255,255,255,0.06)",
        borderRadius: 8
    });
}

function metricInline(label, value) {
    return hstack([
        txt(label, 9, "medium", "rgba(255,255,255,0.5)"),
        txt(value, 10, "semibold", "#FFFFFF")
    ], { gap: 4 });
}

function infoChip(label, value) {
    return hstack([
        txt(label, 9, "medium", "rgba(255,255,255,0.5)"),
        txt(value || "--", 10, "semibold", "#FFFFFF")
    ], {
        gap: 4,
        padding: [4, 6, 4, 6],
        backgroundColor: "rgba(255,255,255,0.06)",
        borderRadius: 8
    });
}

function progressBar(ratio, color) {
    var safe = clamp(ratio, 0, 1);
    return {
        type: "stack",
        direction: "row",
        height: 6,
        borderRadius: 3,
        backgroundColor: "rgba(255,255,255,0.12)",
        children: [
            { type: "stack", flex: Math.max(0.02, safe), height: 6, borderRadius: 3, backgroundColor: color, children: [] },
            { type: "stack", flex: 1 - safe, children: [] }
        ]
    };
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

// ============== 舒适度算法 ==============

function calcComfort(now, nextHour) {
    var temp = toFloat(now.temp);
    var humidity = toFloat(now.humidity);
    var wind = toFloat(now.windSpeed);
    var precip = toFloat(now.precip);
    var vis = toFloat(now.vis);
    var pop = nextHour ? toFloat(nextHour.pop) : 0;

    var score = 100;
    var diff = Math.abs(temp - 22);
    score -= diff * 1.6;
    if (temp < 10) score -= (10 - temp) * 2;
    if (temp > 30) score -= (temp - 30) * 2.2;
    if (humidity > 70) score -= (humidity - 70) * 0.6;
    if (humidity < 30) score -= (30 - humidity) * 0.4;
    if (wind > 20) score -= (wind - 20) * 0.8;
    if (precip > 0) score -= 10 + precip * 4;
    if (vis > 0 && vis < 8) score -= (8 - vis) * 2;
    score = clampNumber(score, 0, 100);

    var level = "一般";
    var color = "#F59E0B";
    var bg = "rgba(245,158,11,0.16)";
    if (score >= 85) { level = "舒适"; color = "#10B981"; bg = "rgba(16,185,129,0.16)"; }
    else if (score >= 70) { level = "不错"; color = "#34D399"; bg = "rgba(52,211,153,0.16)"; }
    else if (score >= 55) { level = "一般"; color = "#F59E0B"; bg = "rgba(245,158,11,0.16)"; }
    else { level = "不适"; color = "#EF4444"; bg = "rgba(239,68,68,0.16)"; }

    return {
        score: Math.round(score),
        level: level,
        color: color,
        bg: bg
    };
}

function calcYesterdayDiff(now, yesterday) {
    if (!yesterday || !Array.isArray(yesterday.hourly) || yesterday.hourly.length === 0) {
        return { diff: NaN, text: "较昨 --", color: "#94A3B8", bg: "rgba(148,163,184,0.16)" };
    }

    var nowHour = new Date().getHours();
    var best = null;
    var bestGap = 24;

    for (var i = 0; i < yesterday.hourly.length; i++) {
        var h = yesterday.hourly[i];
        var hour = new Date(h.time).getHours();
        var gap = Math.abs(hour - nowHour);
        if (gap < bestGap) { best = h; bestGap = gap; }
    }

    if (!best || !isFinite(best.temp)) {
        return { diff: NaN, text: "较昨 --", color: "#94A3B8", bg: "rgba(148,163,184,0.16)" };
    }

    var diff = toFloat(now.temp) - toFloat(best.temp);
    var sign = diff > 0 ? "+" : diff < 0 ? "-" : "±";
    var text = "较昨 " + sign + Math.abs(diff).toFixed(0) + "°";

    var color = diff > 0 ? "#F97316" : diff < 0 ? "#60A5FA" : "#A7F3D0";
    var bg = diff > 0 ? "rgba(249,115,22,0.16)" : diff < 0 ? "rgba(96,165,250,0.16)" : "rgba(167,243,208,0.16)";

    return { diff: diff, text: text, color: color, bg: bg };
}

// ============== 图标与格式化 ==============

function iconForWeather(code, isNight) {
    var c = parseInt(code || "100", 10);
    if (c === 100) return isNight ? "moon.stars.fill" : "sun.max.fill";
    if (c >= 101 && c <= 103) return isNight ? "cloud.moon.fill" : "cloud.sun.fill";
    if (c === 104) return "cloud.fill";
    if (c >= 300 && c <= 399) return c >= 310 ? "cloud.heavyrain.fill" : "cloud.rain.fill";
    if (c >= 400 && c <= 499) return "cloud.snow.fill";
    if (c >= 500 && c <= 599) return "sun.haze.fill";
    if (c >= 700 && c <= 799) return "wind";
    if (c >= 800 && c <= 899) return "cloud.fog.fill";
    return "cloud.fill";
}

function computeIsNight(today) {
    if (!today || !today.sunrise || !today.sunset || !today.date) return false;
    var sunrise = new Date(today.date + "T" + today.sunrise + ":00");
    var sunset = new Date(today.date + "T" + today.sunset + ":00");
    var now = new Date();
    return now < sunrise || now > sunset;
}

function formatTemp(val) {
    var n = toFloat(val);
    if (!isFinite(n)) return "--";
    return Math.round(n) + "°";
}

function formatWind(val) {
    var n = toFloat(val);
    if (!isFinite(n)) return "--";
    return Math.round(n) + " km/h";
}

function formatPercent(val) {
    var n = toFloat(val);
    if (!isFinite(n)) return "--";
    return Math.round(n) + "%";
}

function formatPrecip(val) {
    var n = toFloat(val);
    if (!isFinite(n)) return "--";
    return n.toFixed(1) + " mm";
}

function formatVis(val) {
    var n = toFloat(val);
    if (!isFinite(n)) return "--";
    return n.toFixed(0) + " km";
}

function formatClock(iso) {
    if (!iso) return "--";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "--";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function formatHour(iso) {
    if (!iso) return "--";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "--";
    return pad2(d.getHours()) + ":00";
}

function formatWeekday(dateStr) {
    if (!dateStr) return "--";
    var d = new Date(dateStr + "T00:00:00");
    if (isNaN(d.getTime())) return "--";
    var days = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return days[d.getDay()];
}

function formatDateCompact(d) {
    return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
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

function clampNumber(val, min, max) {
    var n = parseFloat(val);
    if (!isFinite(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
}

function clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
}

function minOf(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce(function (a, b) { return Math.min(a, b); }, arr[0]);
}

function maxOf(arr) {
    if (!arr || arr.length === 0) return 0;
    return arr.reduce(function (a, b) { return Math.max(a, b); }, arr[0]);
}

function toFloat(val) {
    var n = parseFloat(val);
    return isFinite(n) ? n : NaN;
}

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

function isTrue(val) {
    var v = String(val || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
}

function isValidLocationId(val) {
    return /^\d+$/.test(String(val || ""));
}

function normalizeHost(raw) {
    var h = String(raw || "").trim();
    if (!h) return "";
    if (!/^https?:\/\//i.test(h)) h = "https://" + h;
    return h.replace(/\/$/, "");
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

// 天气通勤舒适度小组件
// 特性：和风天气实况/逐小时/7日 + 昨日对比 + 通勤舒适度指数 + 多尺寸布局 + 缓存 + 失败降级

var CACHE_KEY = "weather_commute_cache_v1";
var DEFAULT_REFRESH_MINUTES = 30;
var HISTORY_DAYS = 7;

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";

    var title = env.TITLE || "天气通勤舒适度";
    var accentInput = String(env.ACCENT_COLOR || "").trim();
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
            data = attachHistory(cached, data);
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
    var view = buildView(data, locationName, accentInput);
    var accent = view.theme.accent;
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
        try {
            yesterday = await fetchYesterday(ctx, {
                host: opts.host,
                apiKey: opts.apiKey,
                locationId: locationId
            });
        } catch (e) {
            console.log("yesterday fetch error: " + safeMsg(e));
        }
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
    var host = normalizeHost(opts.host);
    if (!host) return null;
    var url = host + "/geo/v2/city/lookup?location=" + encodeURIComponent(opts.location) + "&key=" + encodeURIComponent(opts.apiKey);
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
    if (looksLikeCoordinate(fallback)) return "当前位置";
    return fallback || "--";
}

function attachHistory(cached, data) {
    var history = cached && cached.history ? cached.history : null;
    var nowRaw = data && data.now ? data.now.now : null;
    var updateTime = data && data.now ? data.now.updateTime : "";
    history = updateHistory(history, nowRaw, updateTime);
    if (data) data.history = history;
    return data;
}

function updateHistory(history, nowRaw, updateTime) {
    if (!nowRaw) return history || null;
    var temp = toFloat(nowRaw.temp);
    if (!isFinite(temp)) return history || null;
    var obsDate = parseObsDate(nowRaw, updateTime);
    var dateKey = formatDateKey(obsDate);
    var hour = obsDate.getHours();
    history = history && typeof history === "object" ? history : { days: {}, updatedAt: Date.now() };
    if (!history.days) history.days = {};
    var day = history.days[dateKey] || { points: {}, updatedAt: Date.now() };
    if (!day.points || typeof day.points !== "object") day.points = {};
    day.points[pad2(hour)] = temp;
    day.updatedAt = Date.now();
    history.days[dateKey] = day;
    history.updatedAt = Date.now();
    return trimHistory(history);
}

function parseObsDate(nowRaw, updateTime) {
    var ts = nowRaw && nowRaw.obsTime ? nowRaw.obsTime : updateTime;
    var d = ts ? new Date(ts) : new Date();
    if (isNaN(d.getTime())) d = new Date();
    return d;
}

function getObsDateKey(nowRaw, updateTime) {
    return formatDateKey(parseObsDate(nowRaw, updateTime));
}

function formatDateKey(d) {
    return formatDateCompact(d);
}

function trimHistory(history) {
    if (!history || !history.days) return history;
    var keys = Object.keys(history.days).sort();
    if (keys.length <= HISTORY_DAYS) return history;
    var cut = keys.slice(0, keys.length - HISTORY_DAYS);
    for (var i = 0; i < cut.length; i++) {
        delete history.days[cut[i]];
    }
    return history;
}

// ============== 视图模型 ==============

function buildView(data, locationName, accentInput) {
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
    var advice = calcClothingAdvice(now, hourly[0]);
    var yesterdayDiff = calcYesterdayDiff(now, yesterday, data.history);
    var theme = resolveTheme(now, isNight, accentInput);

    return {
        location: locationName,
        now: now,
        hourly: hourly,
        daily: daily,
        today: today,
        isNight: isNight,
        iconName: iconName,
        comfort: comfort,
        advice: advice,
        yesterdayDiff: yesterdayDiff,
        accent: theme.accent,
        theme: theme
    };
}

function resolveTheme(now, isNight, accentInput) {
    var theme = {
        accent: "#60A5FA",
        gradient: ["#0B1220", "#0F172A", "#111827"],
        card: "rgba(255,255,255,0.06)",
        cardStrong: "rgba(255,255,255,0.1)",
        tagBg: "rgba(255,255,255,0.08)",
        barBg: "rgba(255,255,255,0.28)",
        textMuted: "rgba(255,255,255,0.78)",
        textSubtle: "rgba(255,255,255,0.55)",
        highlight: "rgba(255,255,255,0.12)"
    };

    var code = parseInt(now.icon || "100", 10);
    var temp = toFloat(now.temp);

    if (isNight) {
        theme.accent = "#8B5CF6";
        theme.gradient = ["#0B1020", "#111827", "#1E1B4B"];
    }

    if (code >= 300 && code <= 399) {
        theme.accent = "#38BDF8";
        theme.gradient = ["#0B1220", "#0F172A", "#1E3A8A"];
    } else if (code >= 400 && code <= 499) {
        theme.accent = "#A5F3FC";
        theme.gradient = ["#0B1220", "#0F172A", "#334155"];
    } else if (code >= 500 && code <= 599) {
        theme.accent = "#FCD34D";
        theme.gradient = ["#0B1220", "#1F2937", "#78350F"];
    } else if (code >= 700 && code <= 799) {
        theme.accent = "#94A3B8";
        theme.gradient = ["#0B1220", "#111827", "#334155"];
    } else if (temp >= 30) {
        theme.accent = "#F97316";
        theme.gradient = ["#0B1220", "#1F2937", "#7C2D12"];
    } else if (temp <= 5) {
        theme.accent = "#60A5FA";
        theme.gradient = ["#0B1220", "#0F172A", "#1D4ED8"];
    }

    if (accentInput) theme.accent = accentInput;
    return theme;
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
    var advice = view.advice;
    var theme = view.theme;

    return shell([
        header(view.location, now, view.iconName, accent, title, true),
        sp(6),
        hstack([
            txt(formatTemp(now.temp), 30, "bold", "#FFFFFF"),
            sp(6),
            vstack([
                txt(now.text, 11, "semibold", theme.textMuted, { maxLines: 1 }),
                txt("体感 " + formatTemp(now.feelsLike), 10, "medium", theme.textSubtle)
            ], { gap: 2, alignItems: "start" })
        ], { gap: 6, alignItems: "center" }),
        sp(6),
        hstack([
            comfortTag(comfort),
            tag(diff.text, diff.color, diff.bg)
        ], { gap: 6 }),
        sp(6),
        tag("穿衣 " + advice.short, advice.color, advice.bg, 9),
        sp(6),
        hstack([
            metricInline("风速", formatWind(now.windSpeed)),
            metricInline("湿度", formatPercent(now.humidity))
        ], { gap: 8 }),
        sp(),
        footer(status, theme)
    ], nextRefresh, [14, 16, 12, 16], theme);
}

function buildMedium(view, title, accent, status, nextRefresh) {
    var now = view.now;
    var today = view.today;
    var hourly = view.hourly.slice(0, 6);
    var theme = view.theme;

    return shell([
        header(view.location, now, view.iconName, accent, title, false),
        sp(4),
        hstack([
            vstack([
                txt(now.text, 12, "semibold", theme.textMuted),
                txt("最高 " + formatTemp(today ? today.tempMax : NaN) + " / 最低 " + formatTemp(today ? today.tempMin : NaN), 10, "medium", theme.textSubtle),
                sp(4),
                hstack([
                    metricBlock("体感", formatTemp(now.feelsLike), theme),
                    metricBlock("湿度", formatPercent(now.humidity), theme),
                    metricBlock("风速", formatWind(now.windSpeed), theme),
                    metricBlock("降水", formatPrecip(now.precip), theme)
                ], { gap: 4 })
            ], { gap: 2, flex: 1 }),
            vstack([
                icon(view.iconName, 24, accent),
                txt(formatTemp(now.temp), 34, "bold", "#FFFFFF", { minScale: 0.6 })
            ], { gap: 2, alignItems: "center" })
        ], { alignItems: "start" }),
        sp(4),
        comfortRow(view.comfort, theme),
        sp(4),
        hourlyStrip(hourly, accent, theme),
        sp(4),
        clothingRow(view.advice, theme),
        sp(),
        footer(status, theme)
    ], nextRefresh, [10, 14, 8, 14], theme);
}

function buildLarge(view, title, accent, status, nextRefresh) {
    var now = view.now;
    var today = view.today;
    var hourly = view.hourly.slice(0, 8);
    var daily = view.daily.slice(0, 6);
    var theme = view.theme;

    var dailyRow1 = daily.slice(0, 2);
    var dailyRow2 = daily.slice(2, 4);

    return shell([
        header(view.location, now, view.iconName, accent, title, false),
        sp(6),
        hstack([
            vstack([
                txt(now.text, 12, "semibold", theme.textMuted),
                txt("最高 " + formatTemp(today ? today.tempMax : NaN) + " / 最低 " + formatTemp(today ? today.tempMin : NaN), 10, "medium", theme.textSubtle)
            ], { gap: 2, flex: 1 }),
            vstack([
                icon(view.iconName, 28, accent),
                txt(formatTemp(now.temp), 40, "bold", "#FFFFFF", { minScale: 0.6 }),
                tag(view.yesterdayDiff.text, view.yesterdayDiff.color, view.yesterdayDiff.bg)
            ], { gap: 4, alignItems: "center" })
        ], { alignItems: "start" }),
        sp(6),
        comfortRow(view.comfort, theme),
        sp(6),
        hstack([
            metricBlock("体感", formatTemp(now.feelsLike), theme),
            metricBlock("湿度", formatPercent(now.humidity), theme),
            metricBlock("风速", formatWind(now.windSpeed), theme),
            metricBlock("能见度", formatVis(now.vis), theme)
        ], { gap: 6 }),
        sp(6),
        clothingRow(view.advice, theme),
        sp(6),
        hourlyStrip(hourly, accent, theme),
        sp(4),
        hstack([
            infoChip("日出", today ? today.sunrise : "--", theme),
            infoChip("日落", today ? today.sunset : "--", theme),
            sp()
        ], { gap: 6 }),
        sp(6),
        hstack(dailyRow1.map(function (d) { return dailyCardLarge(d, accent, theme); }), { gap: 6 }),
        sp(4),
        hstack(dailyRow2.map(function (d) { return dailyCardLarge(d, accent, theme); }), { gap: 6 }),
        sp(),
        footer(status, theme)
    ], nextRefresh, [12, 14, 10, 14], theme);
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

function shell(children, nextRefresh, padding, theme) {
    var bg = theme && theme.gradient ? theme.gradient : ["#0B1220", "#0F172A", "#111827"];
    return {
        type: "widget",
        gap: 0,
        padding: padding || [12, 14, 10, 14],
        backgroundGradient: {
            type: "linear",
            colors: bg,
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

function comfortCard(comfort, theme) {
    return vstack([
        hstack([
            txt("通勤舒适度", 10, "medium", theme ? theme.textSubtle : "rgba(255,255,255,0.6)"),
            sp(),
            tag(comfort.level, comfort.color, comfort.bg)
        ], { gap: 6 }),
        txt(comfort.score + "分", 22, "bold", "#FFFFFF"),
        progressBar(comfort.score / 100, comfort.color, theme)
    ], { gap: 4 });
}

function comfortRow(comfort, theme) {
    return hstack([
        txt("通勤舒适度", 10, "medium", theme ? theme.textSubtle : "rgba(255,255,255,0.6)"),
        txt(comfort.score + "分", 16, "bold", "#FFFFFF"),
        tag(comfort.level, comfort.color, comfort.bg),
        sp(),
        { type: "stack", flex: 1, height: 4, borderRadius: 2, backgroundColor: theme ? theme.highlight : "rgba(255,255,255,0.12)", children: [
            { type: "stack", flex: Math.max(0.02, comfort.score / 100), height: 4, borderRadius: 2, backgroundColor: comfort.color, children: [] },
            { type: "stack", flex: 1 - comfort.score / 100, children: [] }
        ], direction: "row" }
    ], {
        gap: 6,
        alignItems: "center",
        padding: [6, 10, 6, 10],
        backgroundColor: theme ? theme.cardStrong : "rgba(255,255,255,0.1)",
        borderRadius: 8
    });
}

function clothingRow(advice, theme) {
    return hstack([
        txt("穿衣建议", 10, "medium", theme ? theme.textSubtle : "rgba(255,255,255,0.6)"),
        txt(advice.detail, 11, "semibold", "#FFFFFF", { maxLines: 1, minScale: 0.7 })
    ], {
        gap: 6,
        alignItems: "center",
        padding: [5, 10, 5, 10],
        backgroundColor: theme ? theme.cardStrong : "rgba(255,255,255,0.1)",
        borderRadius: 8
    });
}

function comfortTag(comfort) {
    return tag("舒适度 " + comfort.level + " " + comfort.score + "分", comfort.color, comfort.bg);
}

function hourlyStrip(hourly, accent, theme) {
    if (!hourly || hourly.length === 0) return sp();
    var temps = hourly.map(function (h) { return h.temp; });
    var min = minOf(temps);
    var max = maxOf(temps);
    var barBg = theme ? theme.barBg : "rgba(255,255,255,0.35)";
    var textSubtle = theme ? theme.textSubtle : "rgba(255,255,255,0.5)";

    var itemCount = hourly.length;
    var itemWidth = itemCount > 6 ? 24 : (itemCount > 4 ? 28 : 30);
    var itemGap = itemCount > 6 ? 4 : 6;
    var stripHeight = 48;

    return hstack(hourly.map(function (h) {
        var ratio = max === min ? 0.5 : (h.temp - min) / (max - min);
        var barHeight = 4 + ratio * 16;
        return vstack([
            txt(formatHour(h.time), 8, "medium", textSubtle),
            sp(1),
            { type: "stack", width: 5, height: barHeight, borderRadius: 2.5, backgroundColor: barBg, children: [] },
            txt(formatTemp(h.temp), 9, "semibold", "#FFFFFFCC", { minScale: 0.6 })
        ], { gap: 2, alignItems: "center", width: itemWidth });
    }), { gap: itemGap, alignItems: "end", height: stripHeight });
}

function dailyCard(d, accent, theme) {
    return vstack([
        txt(formatWeekday(d.date), 9, "medium", theme ? theme.textSubtle : "rgba(255,255,255,0.6)"),
        icon(iconForWeather(d.iconDay, false), 14, accent),
        txt(formatTemp(d.tempMax) + "/" + formatTemp(d.tempMin), 9, "semibold", "#FFFFFFCC")
    ], {
        gap: 4,
        padding: [6, 8, 6, 8],
        backgroundColor: theme ? theme.card : "rgba(255,255,255,0.06)",
        borderRadius: 8
    });
}

function dailyCardLarge(d, accent, theme) {
    // 大尺寸预报卡片，更大的图标和文字
    return vstack([
        txt(formatWeekday(d.date), 10, "medium", theme ? theme.textSubtle : "rgba(255,255,255,0.6)"),
        icon(iconForWeather(d.iconDay, false), 18, accent),
        txt(formatTemp(d.tempMax) + "/" + formatTemp(d.tempMin), 10, "semibold", "#FFFFFFCC")
    ], {
        gap: 4,
        padding: [8, 12, 8, 12],
        backgroundColor: theme ? theme.card : "rgba(255,255,255,0.06)",
        borderRadius: 10,
        flex: 1
    });
}

function metricBlock(label, value, theme) {
    return vstack([
        txt(label, 8, "medium", theme ? theme.textSubtle : "rgba(255,255,255,0.5)"),
        txt(value, 11, "bold", "#FFFFFF", { minScale: 0.7 })
    ], {
        gap: 1,
        padding: [4, 6, 4, 6],
        backgroundColor: theme ? theme.card : "rgba(255,255,255,0.06)",
        borderRadius: 8,
        flex: 1
    });
}

function metricInline(label, value) {
    return hstack([
        txt(label, 9, "medium", "rgba(255,255,255,0.5)"),
        txt(value, 10, "semibold", "#FFFFFF")
    ], { gap: 4 });
}

function infoChip(label, value, theme) {
    return hstack([
        txt(label, 9, "medium", theme ? theme.textSubtle : "rgba(255,255,255,0.5)"),
        txt(value || "--", 10, "semibold", "#FFFFFF")
    ], {
        gap: 4,
        padding: [4, 6, 4, 6],
        backgroundColor: theme ? theme.card : "rgba(255,255,255,0.06)",
        borderRadius: 8
    });
}

function progressBar(ratio, color, theme) {
    var safe = clamp(ratio, 0, 1);
    return {
        type: "stack",
        direction: "row",
        height: 6,
        borderRadius: 3,
        backgroundColor: theme ? theme.highlight : "rgba(255,255,255,0.12)",
        children: [
            { type: "stack", flex: Math.max(0.02, safe), height: 6, borderRadius: 3, backgroundColor: color, children: [] },
            { type: "stack", flex: 1 - safe, children: [] }
        ]
    };
}

function footer(status, theme) {
    var isLive = status === "live";
    var muted = theme ? theme.textSubtle : "rgba(255,255,255,0.25)";
    return hstack([
        icon("clock.arrow.circlepath", 8, muted),
        {
            type: "date",
            date: new Date().toISOString(),
            format: "relative",
            font: { size: 9, weight: "medium" },
            textColor: muted
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

function clothingCard(advice, theme) {
    return vstack([
        txt("穿衣建议", 10, "medium", theme ? theme.textSubtle : "rgba(255,255,255,0.6)"),
        txt(advice.detail, 12, "semibold", "#FFFFFF", { maxLines: 2, minScale: 0.7 })
    ], {
        gap: 2,
        padding: [6, 8, 6, 8],
        backgroundColor: theme ? theme.cardStrong : "rgba(255,255,255,0.1)",
        borderRadius: 8
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

function calcClothingAdvice(now, nextHour) {
    var feel = toFloat(now.feelsLike);
    var temp = isFinite(feel) ? feel : toFloat(now.temp);
    var wind = toFloat(now.windSpeed);
    var humidity = toFloat(now.humidity);
    var precip = toFloat(now.precip);
    var pop = nextHour ? toFloat(nextHour.pop) : 0;

    var short = "薄外套";
    var color = "#34D399";
    var bg = "rgba(52,211,153,0.16)";

    if (temp >= 30) { short = "短袖为主"; color = "#F97316"; bg = "rgba(249,115,22,0.16)"; }
    else if (temp >= 24) { short = "短袖/薄长袖"; color = "#F59E0B"; bg = "rgba(245,158,11,0.16)"; }
    else if (temp >= 18) { short = "薄外套/卫衣"; color = "#34D399"; bg = "rgba(52,211,153,0.16)"; }
    else if (temp >= 12) { short = "夹克/针织衫"; color = "#60A5FA"; bg = "rgba(96,165,250,0.16)"; }
    else if (temp >= 5) { short = "厚外套/毛衣"; color = "#93C5FD"; bg = "rgba(147,197,253,0.16)"; }
    else { short = "羽绒/保暖内衣"; color = "#A78BFA"; bg = "rgba(167,139,250,0.16)"; }

    var tips = [];
    if (precip > 0 || pop >= 50) tips.push("带伞");
    if (wind > 20) tips.push("防风");
    if (temp <= 8) tips.push("注意保暖");
    if (temp >= 28 && humidity >= 75) tips.push("防闷热");

    var detail = tips.length ? short + " · " + tips.join(" / ") : short;

    return {
        short: short,
        detail: detail,
        color: color,
        bg: bg
    };
}

function pickHistoryTemp(points, targetHour) {
    if (!points) return NaN;
    var keys = Object.keys(points);
    if (keys.length === 0) return NaN;
    var direct = points[pad2(targetHour)];
    if (direct != null && isFinite(toFloat(direct))) return toFloat(direct);
    var bestKey = null;
    var bestGap = 24;
    for (var i = 0; i < keys.length; i++) {
        var hour = parseInt(keys[i], 10);
        if (!isFinite(hour)) continue;
        var gap = Math.abs(hour - targetHour);
        if (gap < bestGap) { bestKey = keys[i]; bestGap = gap; }
    }
    if (!bestKey) return NaN;
    return toFloat(points[bestKey]);
}

function calcYesterdayDiff(now, yesterday, history) {
    var nowTemp = toFloat(now && now.temp);
    if (!isFinite(nowTemp)) {
        return { diff: NaN, text: "较昨 --", color: "#94A3B8", bg: "rgba(148,163,184,0.16)" };
    }

    var nowDate = parseObsDate(now, "");
    var nowHour = nowDate.getHours();
    var bestTemp = NaN;

    if (yesterday && Array.isArray(yesterday.hourly) && yesterday.hourly.length > 0) {
        var best = null;
        var bestGap = 24;

        for (var i = 0; i < yesterday.hourly.length; i++) {
            var h = yesterday.hourly[i];
            var time = new Date(h.time);
            if (isNaN(time.getTime())) continue;
            var hour = time.getHours();
            var gap = Math.abs(hour - nowHour);
            if (gap < bestGap) { best = h; bestGap = gap; }
        }

        if (best && isFinite(toFloat(best.temp))) {
            bestTemp = toFloat(best.temp);
        }
    }

    if (!isFinite(bestTemp) && history && history.days) {
        var yDate = new Date(nowDate.getTime() - 86400000);
        var yKey = formatDateKey(yDate);
        var day = history.days[yKey];
        if (day && day.points) {
            bestTemp = pickHistoryTemp(day.points, nowHour);
        }
    }

    if (!isFinite(bestTemp)) {
        return { diff: NaN, text: "较昨 --", color: "#94A3B8", bg: "rgba(148,163,184,0.16)" };
    }

    var diff = nowTemp - bestTemp;
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

function looksLikeCoordinate(val) {
    var text = String(val || "").trim();
    if (!text) return false;
    if (!/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(text)) return false;
    var parts = text.split(",");
    var a = parseFloat(parts[0]);
    var b = parseFloat(parts[1]);
    if (!isFinite(a) || !isFinite(b)) return false;
    var latOk = Math.abs(a) <= 90 && Math.abs(b) <= 180;
    var lonOk = Math.abs(a) <= 180 && Math.abs(b) <= 90;
    return latOk || lonOk;
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

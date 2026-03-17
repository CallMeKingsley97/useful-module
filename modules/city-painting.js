// 城市像哪幅画小组件
// 特性：Open-Meteo 城市解析 + 实时天气 + 城市气质标签 + 本地作品池 + Met 详情增强 + 多尺寸布局 + 缓存兜底

var CACHE_KEY = "city_painting_cache_v1";
var DEFAULT_REFRESH_MINUTES = 30;
var DEFAULT_ART_REFRESH_HOURS = 12;
var OPEN_METEO_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search";
var OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
var MET_SEARCH_URL = "https://collectionapi.metmuseum.org/public/collection/v1/search";
var MET_OBJECT_URL = "https://collectionapi.metmuseum.org/public/collection/v1/objects/";
var MAX_MET_OBJECT_CANDIDATES = 6;

var MOOD_META = {
    "金色午后": { accent: "#D6A968", gradient: ["#111215", "#1C1915", "#382E24"], icon: "sun.max.fill" },
    "晴蓝留白": { accent: "#7BA7D9", gradient: ["#0F1217", "#161F2C", "#27384A"], icon: "cloud.sun.fill" },
    "安静暮色": { accent: "#9D94C7", gradient: ["#0E1016", "#171B2B", "#2B3045"], icon: "moon.stars.fill" },
    "玻璃雨夜": { accent: "#73A8C8", gradient: ["#0C1116", "#13202A", "#233847"], icon: "cloud.rain.fill" },
    "雨幕灰城": { accent: "#9EABB7", gradient: ["#101317", "#1E2630", "#394655"], icon: "cloud.drizzle.fill" },
    "冷蓝薄雾": { accent: "#B8C8D9", gradient: ["#101317", "#1B222A", "#404C5A"], icon: "cloud.fog.fill" },
    "风暴前夕": { accent: "#C98B62", gradient: ["#111214", "#1E1D21", "#3A2E2A"], icon: "cloud.bolt.rain.fill" },
    "雪地静场": { accent: "#D8E7F5", gradient: ["#0F1216", "#17202A", "#334555"], icon: "snowflake" },
    "沉灰冬晨": { accent: "#C5CED8", gradient: ["#111317", "#1A1F27", "#323A46"], icon: "cloud.fill" }
};

var ARTWORK_POOL = [
    { id: "water-lilies", tag: "金色午后", title: "Bridge over a Pond of Water Lilies", artist: "Claude Monet", year: "1899", styles: ["impressionism", "light"], query: "Bridge over a Pond of Water Lilies Claude Monet", note: "光线是暖的，边缘也更柔和。" },
    { id: "wheat-field", tag: "金色午后", title: "Wheat Field with Cypresses", artist: "Vincent van Gogh", year: "1889", styles: ["impressionism", "light"], query: "Wheat Field with Cypresses Vincent van Gogh", note: "颜色很满，但节奏并不急。" },
    { id: "seine-vetheuil", tag: "晴蓝留白", title: "The Seine at Vetheuil", artist: "Claude Monet", year: "1880", styles: ["impressionism", "day"], query: "The Seine at Vetheuil Claude Monet", note: "天空很轻，画面有足够多的留白。" },
    { id: "regatta-argenteuil", tag: "晴蓝留白", title: "The Regatta at Argenteuil", artist: "Claude Monet", year: "1872", styles: ["impressionism", "day"], query: "The Regatta at Argenteuil Claude Monet", note: "空气干净，蓝色显得很克制。" },
    { id: "boulevard-night", tag: "安静暮色", title: "Boulevard Montmartre at Night", artist: "Camille Pissarro", year: "1897", styles: ["night", "city"], query: "Boulevard Montmartre at Night Camille Pissarro", note: "夜色是深的，但并不沉重。" },
    { id: "blue-nocturne", tag: "安静暮色", title: "Nocturne in Blue and Silver", artist: "James McNeill Whistler", year: "约 1871", styles: ["night", "quiet"], query: "Nocturne in Blue and Silver Whistler", note: "色温偏冷，画面收得很安静。" },
    { id: "nighthawks", tag: "玻璃雨夜", title: "Nighthawks", artist: "Edward Hopper", year: "1942", styles: ["night", "realism"], query: "Nighthawks Edward Hopper", note: "路面有反光，街景也更孤单。" },
    { id: "paris-rainy-day", tag: "玻璃雨夜", title: "Paris Street, Rainy Day", artist: "Gustave Caillebotte", year: "1877", styles: ["city", "rain"], query: "Paris Street Rainy Day Gustave Caillebotte", note: "行人和街道都被雨磨得更干净。" },
    { id: "pissarro-rain", tag: "雨幕灰城", title: "The Boulevard Montmartre on a Winter Morning", artist: "Camille Pissarro", year: "1897", styles: ["city", "rain"], query: "Boulevard Montmartre Winter Morning Pissarro", note: "潮湿感把轮廓压得更平。" },
    { id: "place-francaise", tag: "雨幕灰城", title: "Place du Theatre Francais", artist: "Camille Pissarro", year: "1898", styles: ["city", "rain"], query: "Place du Theatre Francais Pissarro", note: "颜色偏灰，层次都在细节里。" },
    { id: "whistler-fog", tag: "冷蓝薄雾", title: "Nocturne: Blue and Gold", artist: "James McNeill Whistler", year: "约 1872", styles: ["mist", "night"], query: "Nocturne Blue and Gold Whistler", note: "边界不清，但气氛很完整。" },
    { id: "turner-harbor", tag: "冷蓝薄雾", title: "Harbor of Dieppe", artist: "J. M. W. Turner", year: "1826", styles: ["mist", "sea"], query: "Harbor of Dieppe Turner", note: "层次被雾藏起来了，只剩冷色调。" },
    { id: "storm-sea", tag: "风暴前夕", title: "A Storm at Sea", artist: "Claude Joseph Vernet", year: "1770s", styles: ["storm", "dramatic"], query: "A Storm at Sea Vernet", note: "空气发紧，风暴感已经出现。" },
    { id: "tempest", tag: "风暴前夕", title: "The Tempest", artist: "Giorgione", year: "约 1508", styles: ["storm", "dramatic"], query: "The Tempest Giorgione", note: "画面还没失控，但已经不平静。" },
    { id: "magpie", tag: "雪地静场", title: "The Magpie", artist: "Claude Monet", year: "1868", styles: ["snow", "quiet"], query: "The Magpie Claude Monet", note: "雪会把声音一起收进去。" },
    { id: "hunters-snow", tag: "雪地静场", title: "Hunters in the Snow", artist: "Pieter Bruegel the Elder", year: "1565", styles: ["snow", "quiet"], query: "Hunters in the Snow Bruegel", note: "冷色很深，但画面反而更静。" },
    { id: "winter-landscape", tag: "沉灰冬晨", title: "Winter Landscape", artist: "Caspar David Friedrich", year: "1811", styles: ["winter", "quiet"], query: "Winter Landscape Caspar David Friedrich", note: "光线偏灰，节奏也更慢。" },
    { id: "monk-by-sea", tag: "沉灰冬晨", title: "The Monk by the Sea", artist: "Caspar David Friedrich", year: "1808-1810", styles: ["winter", "quiet"], query: "The Monk by the Sea Caspar David Friedrich", note: "空间很空，情绪被压低了。" }
];

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";

    var title = env.TITLE || "你的城市像哪幅画";
    var city = String(env.CITY || "").trim();
    var locationName = String(env.LOCATION_NAME || "").trim();
    var lat = parseFloat(env.LAT);
    var lon = parseFloat(env.LON);
    var accentInput = String(env.ACCENT_COLOR || "").trim();
    var preferredStyle = String(env.PREFERRED_STYLE || "").trim().toLowerCase();
    var showImage = isTrue(env.SHOW_IMAGE);
    var enhanceArt = env.ENHANCE_ART == null ? true : isTrue(env.ENHANCE_ART);
    var randomness = isTrue(env.RANDOMNESS);
    var openUrl = String(env.OPEN_URL || "").trim();
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 5, 1440);
    var artRefreshHours = clampNumber(env.ART_REFRESH_HOURS || DEFAULT_ART_REFRESH_HOURS, 1, 168);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var artRefreshMs = artRefreshHours * 60 * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);

    if (!city && (!isFinite(lat) || !isFinite(lon))) {
        return errorWidget("缺少配置", "请设置 CITY 或 LAT/LON");
    }

    var inputKey = buildInputKey({
        city: city,
        lat: lat,
        lon: lon,
        style: preferredStyle,
        showImage: showImage
    });

    var cached = loadCache(ctx);
    var data = null;
    var now = Date.now();
    var cacheReady = cached && cached.inputKey === inputKey && cached.location && cached.weather && cached.mood && cached.artwork;
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            data = await fetchWidgetData(ctx, {
                city: city,
                locationName: locationName,
                lat: lat,
                lon: lon,
                preferredStyle: preferredStyle,
                showImage: showImage,
                enhanceArt: enhanceArt,
                randomness: randomness,
                artRefreshMs: artRefreshMs,
                inputKey: inputKey
            }, cached);
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("city painting fetch error: " + safeMsg(e));
            if (cacheReady) {
                data = cached;
            } else {
                return errorWidget("获取失败", safeMsg(e));
            }
        }
    }

    var view = buildView(data, title, accentInput, openUrl);
    var status = fetched ? "live" : "cached";
    var nextRefresh = new Date(Date.now() + refreshIntervalMs).toISOString();

    if (family === "accessoryCircular") return buildCircular(view, status, nextRefresh);
    if (family === "accessoryRectangular") return buildRectangular(view, status, nextRefresh);
    if (family === "accessoryInline") return buildInline(view, status, nextRefresh);
    if (family === "systemSmall") return buildSmall(view, status, nextRefresh);
    if (family === "systemLarge") return buildLarge(view, status, nextRefresh);
    return buildMedium(view, status, nextRefresh);
}

// ============== 数据层 ==============

async function fetchWidgetData(ctx, opts, cached) {
    var location = await resolveLocation(ctx, opts);
    var weather = await fetchCurrentWeather(ctx, location);
    var mood = deriveMoodTag(weather);
    var artKey = buildArtKey(location.name, mood.tag, opts.preferredStyle, opts.randomness);
    var now = Date.now();

    var canReuseArtwork = cached
        && cached.inputKey === opts.inputKey
        && cached.artKey === artKey
        && cached.artTs
        && (now - cached.artTs < opts.artRefreshMs)
        && cached.artwork;

    var artwork = canReuseArtwork
        ? cached.artwork
        : await resolveArtwork(ctx, mood.tag, opts.preferredStyle, artKey, opts.showImage || opts.enhanceArt);

    return {
        inputKey: opts.inputKey,
        artKey: artKey,
        location: location,
        weather: weather,
        mood: mood,
        artwork: artwork,
        ts: now,
        artTs: canReuseArtwork && cached.artTs ? cached.artTs : now
    };
}

async function resolveLocation(ctx, opts) {
    if (isFinite(opts.lat) && isFinite(opts.lon)) {
        return {
            name: opts.locationName || opts.city || "当前城市",
            latitude: opts.lat,
            longitude: opts.lon,
            timezone: "",
            country: "",
            admin1: ""
        };
    }

    var url = OPEN_METEO_GEOCODE_URL
        + "?name=" + encodeURIComponent(opts.city)
        + "&count=1&language=zh&format=json";

    var body = await fetchJson(ctx, url);
    var results = body && Array.isArray(body.results) ? body.results : [];
    if (results.length === 0) throw new Error("未找到可用城市");

    var item = results[0];
    return {
        name: opts.locationName || formatGeoName(item),
        latitude: toFloat(item.latitude),
        longitude: toFloat(item.longitude),
        timezone: item.timezone || "",
        country: item.country || "",
        admin1: item.admin1 || ""
    };
}

async function fetchCurrentWeather(ctx, location) {
    var url = OPEN_METEO_FORECAST_URL
        + "?latitude=" + encodeURIComponent(location.latitude)
        + "&longitude=" + encodeURIComponent(location.longitude)
        + "&current=temperature_2m,is_day,weather_code,cloud_cover,wind_speed_10m,precipitation"
        + "&timezone=auto";

    var body = await fetchJson(ctx, url);
    var current = body && body.current ? body.current : null;
    if (!current) throw new Error("天气数据为空");

    return {
        time: current.time || "",
        temperature: toFloat(current.temperature_2m),
        isDay: parseInt(current.is_day || 0, 10) === 1,
        code: parseInt(current.weather_code || 0, 10),
        cloudCover: toFloat(current.cloud_cover),
        windSpeed: toFloat(current.wind_speed_10m),
        precipitation: toFloat(current.precipitation),
        timezone: body.timezone || location.timezone || ""
    };
}

async function resolveArtwork(ctx, tag, preferredStyle, artKey, shouldEnhance) {
    var artwork = pickArtworkByMood(tag, preferredStyle, artKey);
    if (!artwork) throw new Error("未找到匹配作品");
    if (!shouldEnhance) return artwork;

    try {
        var enhanced = await enhanceArtwork(ctx, artwork);
        return mergeArtwork(artwork, enhanced);
    } catch (e) {
        console.log("art enhance error: " + safeMsg(e));
        return artwork;
    }
}

function pickArtworkByMood(tag, preferredStyle, seed) {
    var candidates = ARTWORK_POOL.filter(function (item) { return item.tag === tag; });
    if (preferredStyle) {
        var styled = candidates.filter(function (item) {
            return Array.isArray(item.styles) && item.styles.indexOf(preferredStyle) >= 0;
        });
        if (styled.length > 0) candidates = styled;
    }

    if (candidates.length === 0) {
        candidates = ARTWORK_POOL.filter(function (item) { return item.tag === "安静暮色"; });
    }

    var idx = stableHash(seed) % candidates.length;
    return cloneObject(candidates[idx]);
}

async function enhanceArtwork(ctx, artwork) {
    var query = artwork.query || (artwork.title + " " + artwork.artist);
    var searchUrl = MET_SEARCH_URL + "?hasImages=true&q=" + encodeURIComponent(query);
    var searchBody = await fetchJson(ctx, searchUrl);
    var ids = searchBody && Array.isArray(searchBody.objectIDs) ? searchBody.objectIDs : [];
    if (ids.length === 0) return {};

    var fallback = null;
    for (var i = 0; i < Math.min(ids.length, MAX_MET_OBJECT_CANDIDATES); i++) {
        var detailUrl = MET_OBJECT_URL + ids[i];
        var detail = await fetchJson(ctx, detailUrl);
        var normalized = {
            image: detail.primaryImageSmall || detail.primaryImage || "",
            museumUrl: detail.objectURL || "",
            department: detail.department || "",
            medium: detail.medium || "",
            objectDate: detail.objectDate || artwork.year || "",
            title: detail.title || artwork.title,
            artist: detail.artistDisplayName || artwork.artist
        };
        if (!fallback) fallback = normalized;
        if (normalized.image) return normalized;
    }

    return fallback || {};
}

async function fetchJson(ctx, url) {
    var resp = await ctx.http.get(url, {
        headers: { "User-Agent": "Egern-Widget", "Accept": "application/json" },
        timeout: 10000
    });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    return await resp.json();
}

// ============== 视图模型 ==============

function buildView(data, title, accentInput, openUrl) {
    var moodMeta = MOOD_META[data.mood.tag] || MOOD_META["安静暮色"];
    var theme = {
        accent: accentInput || moodMeta.accent,
        gradient: moodMeta.gradient,
        icon: moodMeta.icon,
        card: "rgba(255,255,255,0.08)",
        cardStrong: "rgba(255,255,255,0.12)",
        textMuted: "rgba(255,255,255,0.78)",
        textSubtle: "rgba(255,255,255,0.56)"
    };

    var reason = buildReason(data.mood.tag, data.weather, data.location.name, data.artwork);
    var weatherText = weatherLabel(data.weather.code);
    var weatherSummary = weatherText + " " + formatTemp(data.weather.temperature);
    var detailLine = "云量 " + formatPercent(data.weather.cloudCover) + " · 风 " + formatWind(data.weather.windSpeed);

    return {
        title: title,
        location: data.location,
        weather: data.weather,
        mood: data.mood,
        artwork: data.artwork,
        theme: theme,
        reason: reason,
        weatherSummary: weatherSummary,
        detailLine: detailLine,
        openUrl: openUrl || data.artwork.museumUrl || ""
    };
}

function deriveMoodTag(weather) {
    var code = weather.code;
    var isDay = weather.isDay;
    var cloud = isFinite(weather.cloudCover) ? weather.cloudCover : 0;
    var wind = isFinite(weather.windSpeed) ? weather.windSpeed : 0;
    var temp = isFinite(weather.temperature) ? weather.temperature : 20;
    var tag = "安静暮色";

    if (isThunder(code) || (wind >= 28 && cloud >= 75)) tag = "风暴前夕";
    else if (isSnow(code)) tag = "雪地静场";
    else if (isFog(code)) tag = "冷蓝薄雾";
    else if (isRain(code) && !isDay) tag = "玻璃雨夜";
    else if (isRain(code)) tag = "雨幕灰城";
    else if (!isDay) tag = "安静暮色";
    else if (temp <= 5 && cloud >= 65) tag = "沉灰冬晨";
    else if (code === 0 && cloud < 18 && temp >= 20) tag = "金色午后";
    else if (code <= 2 && cloud < 45) tag = "晴蓝留白";
    else if (cloud >= 80) tag = "沉灰冬晨";

    return {
        tag: tag,
        accent: MOOD_META[tag] ? MOOD_META[tag].accent : "#A78BFA"
    };
}

function buildReason(tag, weather, city, artwork) {
    var temp = formatTemp(weather.temperature);
    var wind = formatWind(weather.windSpeed);
    var cloud = formatPercent(weather.cloudCover);
    var rain = formatPrecip(weather.precipitation);

    var reasons = {
        "金色午后": city + " 今天更像《" + artwork.title + "》。",
        "晴蓝留白": city + " 今天更像《" + artwork.title + "》。",
        "安静暮色": city + " 今晚更像《" + artwork.title + "》。",
        "玻璃雨夜": city + " 今晚更像《" + artwork.title + "》。",
        "雨幕灰城": city + " 今天更像《" + artwork.title + "》。",
        "冷蓝薄雾": city + " 现在更像《" + artwork.title + "》。",
        "风暴前夕": city + " 现在更像《" + artwork.title + "》。",
        "雪地静场": city + " 今天更像《" + artwork.title + "》。",
        "沉灰冬晨": city + " 今天更像《" + artwork.title + "》。"
    };
    var moodLine = artwork.note || "画面的情绪和现在的天气很接近。";
    var tail = " 当前 " + weatherLabel(weather.code) + "，" + temp + "，云量 " + cloud + "，风速 " + wind;
    if (isFinite(weather.precipitation) && weather.precipitation > 0) tail += "，降水 " + rain;
    return (reasons[tag] || reasons["安静暮色"]) + moodLine + tail + "。";
}

// ============== UI 布局 ==============

function buildSmall(view, status, nextRefresh) {
    return shell([
        header(view, false),
        sp(8),
        txt("像《" + view.artwork.title + "》", 20, "bold", "#FFFFFF", { maxLines: 2, minScale: 0.55 }),
        sp(4),
        txt(view.mood.tag, 11, "semibold", view.theme.accent, { maxLines: 1 }),
        txt(view.weatherSummary, 10, "medium", view.theme.textMuted, { maxLines: 1 }),
        sp(),
        footer(status, view.theme)
    ], nextRefresh, view.theme, view.openUrl);
}

function buildMedium(view, status, nextRefresh) {
    var left = vstack([
        header(view, true),
        sp(10),
        tag(view.mood.tag, view.theme.accent, view.theme.accent + "22", 9),
        sp(6),
        txt("像《" + view.artwork.title + "》", 18, "bold", "#FFFFFF", { maxLines: 2, minScale: 0.6 }),
        txt(view.artwork.artist, 11, "medium", view.theme.textMuted, { maxLines: 1, minScale: 0.7 }),
        sp(6),
        txt(view.reason, 10, "regular", view.theme.textSubtle, { maxLines: 4, minScale: 0.7 })
    ], { flex: 1, alignItems: "start", gap: 0 });

    var right = artworkPane(view, 84, 116);

    return shell([
        hstack([left, sp(10), right], { alignItems: "start" }),
        sp(8),
        infoStrip(view),
        sp(),
        footer(status, view.theme)
    ], nextRefresh, view.theme, view.openUrl, [14, 16, 12, 16]);
}

function buildLarge(view, status, nextRefresh) {
    return shell([
        header(view, true),
        sp(8),
        hstack([
            vstack([
                tag(view.mood.tag, view.theme.accent, view.theme.accent + "22", 9),
                sp(6),
                txt("像《" + view.artwork.title + "》", 24, "bold", "#FFFFFF", { maxLines: 2, minScale: 0.6 }),
                txt(view.artwork.artist + (view.artwork.objectDate ? " · " + view.artwork.objectDate : ""), 11, "medium", view.theme.textMuted, { maxLines: 1 }),
                sp(8),
                txt(view.reason, 11, "regular", view.theme.textMuted, { maxLines: 5, minScale: 0.7 }),
                sp(8),
                hstack([
                    infoChip("天气", view.weatherSummary, view.theme),
                    infoChip("风格", styleLabel(view.artwork.styles), view.theme)
                ], { gap: 6 })
            ], { flex: 1, alignItems: "start", gap: 0 }),
            sp(12),
            artworkPane(view, 122, 148)
        ], { alignItems: "start" }),
        sp(10),
        hstack([
            metricCard("云量", formatPercent(view.weather.cloudCover), view.theme),
            metricCard("风速", formatWind(view.weather.windSpeed), view.theme),
            metricCard("降水", formatPrecip(view.weather.precipitation), view.theme)
        ], { gap: 6 }),
        sp(),
        footer(status, view.theme)
    ], nextRefresh, view.theme, view.openUrl, [16, 18, 14, 18]);
}

function buildCircular(view, status, nextRefresh) {
    return {
        type: "widget",
        refreshAfter: nextRefresh,
        url: view.openUrl || undefined,
        gap: 2,
        children: [
            sp(),
            icon(view.theme.icon, 16, view.theme.accent),
            txt(shortMood(view.mood.tag), 11, "bold", "#FFFFFF", { minScale: 0.6, maxLines: 1 }),
            txt(status === "live" ? "live" : "cache", 8, "medium", view.theme.textSubtle),
            sp()
        ]
    };
}

function buildRectangular(view, status, nextRefresh) {
    return {
        type: "widget",
        refreshAfter: nextRefresh,
        url: view.openUrl || undefined,
        gap: 3,
        children: [
            hstack([icon(view.theme.icon, 10, view.theme.accent), txt(view.location.name, 10, "medium", "rgba(255,255,255,0.72)")], { gap: 4 }),
            txt("像《" + view.artwork.title + "》", 12, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 }),
            txt(view.mood.tag + " · " + (status === "live" ? "live" : "cached"), 10, "medium", "rgba(255,255,255,0.55)", { maxLines: 1, minScale: 0.7 })
        ]
    };
}

function buildInline(view, status, nextRefresh) {
    return {
        type: "widget",
        refreshAfter: nextRefresh,
        url: view.openUrl || undefined,
        children: [
            icon(view.theme.icon, 12, view.theme.accent),
            txt(" " + view.location.name + "像《" + truncateText(view.artwork.title, 16) + "》", 12, "medium", "#FFFFFF", { maxLines: 1, minScale: 0.55 }),
            txt(" · " + (status === "live" ? "live" : "cached"), 11, "medium", view.theme.textSubtle)
        ]
    };
}

// ============== UI 组件 ==============

function shell(children, nextRefresh, theme, url, padding) {
    return {
        type: "widget",
        gap: 0,
        padding: padding || [14, 16, 12, 16],
        backgroundGradient: {
            type: "linear",
            colors: theme.gradient,
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        refreshAfter: nextRefresh,
        url: url || undefined,
        children: children
    };
}

function header(view, showTime) {
    var children = [
        icon(view.theme.icon, 14, view.theme.accent),
        txt(view.title, 12, "bold", view.theme.accent, { minScale: 0.7 }),
        sp(),
        txt(view.location.name, 10, "medium", view.theme.textMuted, { maxLines: 1, minScale: 0.7 })
    ];
    if (showTime) {
        children.push(sp(6));
        children.push({
            type: "date",
            date: new Date().toISOString(),
            format: "time",
            font: { size: 9, weight: "medium" },
            textColor: view.theme.textSubtle
        });
    }
    return hstack(children, { gap: 5, alignItems: "center" });
}

function artworkPane(view, width, height) {
    if (view.artwork.image) {
        return vstack([
            {
                type: "image",
                src: view.artwork.image,
                width: width,
                height: height,
                cornerRadius: 12
            },
            sp(4),
            txt(view.artwork.title, 9, "semibold", "#FFFFFFCC", { maxLines: 2, minScale: 0.6, width: width })
        ], { gap: 0, width: width, alignItems: "center" });
    }

    return {
        type: "stack",
        width: width,
        height: height,
        borderRadius: 14,
        padding: [10, 10, 10, 10],
        backgroundColor: "rgba(255,255,255,0.1)",
        borderWidth: 1,
        borderColor: "rgba(255,255,255,0.15)",
        children: [
            vstack([
                txt("《" + view.artwork.title + "》", 12, "bold", "#FFFFFF", { maxLines: 4, minScale: 0.6 }),
                sp(6),
                txt(view.artwork.artist, 10, "medium", view.theme.textMuted, { maxLines: 2, minScale: 0.7 }),
                sp(),
                txt(view.mood.tag, 9, "semibold", view.theme.accent)
            ], { gap: 0, alignItems: "start", height: height - 20, width: width - 20 })
        ]
    };
}

function infoStrip(view) {
    return hstack([
        infoChip("天气", view.weatherSummary, view.theme),
        infoChip("空气", cloudTone(view.weather.cloudCover), view.theme),
        infoChip("风速", formatWind(view.weather.windSpeed), view.theme)
    ], { gap: 6 });
}

function metricCard(label, value, theme) {
    return vstack([
        txt(label, 9, "medium", theme.textSubtle),
        txt(value, 12, "bold", "#FFFFFF", { minScale: 0.7, maxLines: 1 })
    ], {
        flex: 1,
        gap: 2,
        padding: [8, 10, 8, 10],
        backgroundColor: theme.card,
        borderRadius: 10
    });
}

function infoChip(label, value, theme) {
    return hstack([
        txt(label, 9, "medium", theme.textSubtle),
        txt(value, 10, "semibold", "#FFFFFF", { maxLines: 1, minScale: 0.7 })
    ], {
        gap: 4,
        padding: [4, 8, 4, 8],
        backgroundColor: theme.card,
        borderRadius: 8
    });
}

function footer(status, theme) {
    var isLive = status === "live";
    return hstack([
        icon("clock.arrow.circlepath", 8, theme.textSubtle),
        {
            type: "date",
            date: new Date().toISOString(),
            format: "relative",
            font: { size: 9, weight: "medium" },
            textColor: theme.textSubtle
        },
        sp(),
        tag(isLive ? "实时" : "缓存", isLive ? "#10B981" : "#F59E0B", isLive ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.16)", 8)
    ], { gap: 4, alignItems: "center" });
}

function tag(text, color, bg, size) {
    return hstack([txt(text, size || 9, "semibold", color, { maxLines: 1, minScale: 0.6 })], {
        padding: [2, 6, 2, 6],
        backgroundColor: bg,
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
            colors: ["#101826", "#1F2937"],
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

// ============== 文本与规则 ==============

function weatherLabel(code) {
    if (code === 0) return "晴";
    if (code === 1) return "大部晴朗";
    if (code === 2) return "局部多云";
    if (code === 3) return "阴";
    if (code === 45 || code === 48) return "雾";
    if (code === 51 || code === 53 || code === 55) return "毛毛雨";
    if (code === 56 || code === 57) return "冻雨";
    if (code === 61 || code === 63 || code === 65) return "雨";
    if (code === 66 || code === 67) return "冻雨";
    if (code === 71 || code === 73 || code === 75 || code === 77) return "雪";
    if (code === 80 || code === 81 || code === 82) return "阵雨";
    if (code === 85 || code === 86) return "阵雪";
    if (code === 95 || code === 96 || code === 99) return "雷暴";
    return "天气未知";
}

function styleLabel(styles) {
    if (!Array.isArray(styles) || styles.length === 0) return "馆藏匹配";
    var map = {
        impressionism: "印象派",
        light: "明亮",
        day: "日景",
        night: "夜景",
        city: "城市",
        rain: "雨景",
        mist: "雾景",
        storm: "风暴",
        quiet: "静场",
        snow: "雪景",
        winter: "冬景",
        realism: "现实主义",
        dramatic: "戏剧感",
        sea: "海景"
    };
    return styles.slice(0, 2).map(function (item) { return map[item] || item; }).join(" · ");
}

function cloudTone(cloudCover) {
    var n = toFloat(cloudCover);
    if (!isFinite(n)) return "--";
    if (n < 20) return "通透";
    if (n < 50) return "留白";
    if (n < 80) return "柔灰";
    return "厚云";
}

function shortMood(tag) {
    var map = {
        "金色午后": "金午",
        "晴蓝留白": "晴蓝",
        "安静暮色": "暮色",
        "玻璃雨夜": "雨夜",
        "雨幕灰城": "灰城",
        "冷蓝薄雾": "薄雾",
        "风暴前夕": "风暴",
        "雪地静场": "雪静",
        "沉灰冬晨": "冬晨"
    };
    return map[tag] || "像画";
}

function isRain(code) {
    return [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].indexOf(code) >= 0;
}

function isSnow(code) {
    return [71, 73, 75, 77, 85, 86].indexOf(code) >= 0;
}

function isFog(code) {
    return code === 45 || code === 48;
}

function isThunder(code) {
    return code === 95 || code === 96 || code === 99;
}

// ============== DSL 工具 ==============

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

function mergeArtwork(base, extra) {
    var merged = cloneObject(base);
    if (!extra) return merged;
    for (var k in extra) {
        if (extra[k] != null && extra[k] !== "") merged[k] = extra[k];
    }
    return merged;
}

function cloneObject(obj) {
    var out = {};
    for (var k in obj) out[k] = obj[k];
    return out;
}

function buildInputKey(opts) {
    return [
        (opts.city || "").toLowerCase(),
        isFinite(opts.lat) ? opts.lat.toFixed(4) : "",
        isFinite(opts.lon) ? opts.lon.toFixed(4) : "",
        opts.style || "",
        opts.showImage ? "img" : "text"
    ].join("|");
}

function buildArtKey(locationName, tag, preferredStyle, randomness) {
    var date = new Date();
    var seed = date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
    if (randomness) seed += "-" + pad2(date.getHours());
    return [locationName, tag, preferredStyle || "", seed].join("|");
}

function stableHash(text) {
    var str = String(text || "");
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
}

function truncateText(text, maxLen) {
    var str = String(text || "");
    if (str.length <= maxLen) return str;
    return str.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function formatGeoName(item) {
    if (!item) return "当前城市";
    var parts = [];
    if (item.name) parts.push(item.name);
    if (item.admin1 && item.admin1 !== item.name) parts.push(item.admin1);
    return parts.length > 0 ? parts.join(" · ") : "当前城市";
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
    if (n === 0) return "0 mm";
    return n.toFixed(1) + " mm";
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

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
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

// 城市像哪幅画小组件
// 特性：和风天气实时天气 + 城市气质标签 + 本地作品池 + Met 详情增强 + 多尺寸布局 + 缓存兜底

var CACHE_KEY = "city_painting_cache_v2";
var DEFAULT_REFRESH_MINUTES = 30;
var DEFAULT_ART_REFRESH_HOURS = 12;
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
    var host = normalizeHost(env.HOST || "");
    var apiKey = String(env.API_KEY || "").trim();
    var locationNameInput = String(env.LOCATION_NAME || "").trim();
    var city = String(env.CITY || "").trim();
    var locationInput = String(env.LOCATION || "").trim();
    var lat = parseFloat(env.LAT);
    var lon = parseFloat(env.LON);
    var accentInput = String(env.ACCENT_COLOR || "").trim();
    var preferredStyle = String(env.PREFERRED_STYLE || "").trim().toLowerCase();
    var enhanceArt = env.ENHANCE_ART == null ? true : isTrue(env.ENHANCE_ART);
    var randomness = isTrue(env.RANDOMNESS);
    var openUrl = String(env.OPEN_URL || "").trim();
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 5, 1440);
    var artRefreshHours = clampNumber(env.ART_REFRESH_HOURS || DEFAULT_ART_REFRESH_HOURS, 1, 168);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var artRefreshMs = artRefreshHours * 60 * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);

    if (!host) return errorWidget("缺少配置", "请设置 HOST（和风天气）");
    if (!apiKey) return errorWidget("缺少配置", "请设置 API_KEY（和风天气）");
    if (!locationInput && !(isFinite(lat) && isFinite(lon)) && !city) return errorWidget("缺少位置", "请设置 LOCATION、LAT/LON 或 CITY");
    if ((isFinite(lat) && !isValidLatitude(lat)) || (isFinite(lon) && !isValidLongitude(lon))) return errorWidget("坐标无效", "LAT 需在 -90 到 90，LON 需在 -180 到 180");

    var locationConfig = resolveLocationConfig(locationInput, lat, lon, city);
    var inputKey = [host, locationConfig.cacheKey, locationNameInput, preferredStyle, enhanceArt ? "enhance" : "plain"].join("|");
    var cached = loadCache(ctx);
    var now = Date.now();
    var cacheReady = cached && cached.inputKey === inputKey && cached.location && cached.weather && cached.mood && cached.artwork;
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var data = null;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            data = await fetchWidgetData(ctx, {
                host: host,
                apiKey: apiKey,
                locationConfig: locationConfig,
                locationNameInput: locationNameInput,
                preferredStyle: preferredStyle,
                randomness: randomness,
                artRefreshMs: artRefreshMs,
                inputKey: inputKey,
                enhanceArt: enhanceArt
            }, cached);
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("city painting fetch error: " + safeMsg(e));
            if (cacheReady) data = cached;
            else return errorWidget("获取失败", safeMsg(e));
        }
    }

    var view = buildView(data, title, accentInput, openUrl);
    var status = fetched ? "live" : "cached";
    var nextRefresh = new Date(Date.now() + refreshIntervalMs).toISOString();

    if (family === "accessoryCircular") return buildCircular(view, status, nextRefresh);
    if (family === "accessoryRectangular") return buildRectangular(view, status, nextRefresh);
    if (family === "accessoryInline") return buildInline(view, status, nextRefresh);
    if (family === "systemSmall") return buildSmall(view, status, nextRefresh);
    if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(view, status, nextRefresh);
    return buildMedium(view, status, nextRefresh);
}

async function fetchWidgetData(ctx, opts, cached) {
    var locationInfo = await fetchLocationInfo(ctx, opts.host, opts.apiKey, opts.locationConfig);
    var weatherLocation = resolveWeatherLocation(opts.locationConfig, locationInfo);
    var weatherBody = await fetchNow(ctx, opts.host, opts.apiKey, weatherLocation);
    var weather = normalizeNow(weatherBody);
    var location = {
        id: locationInfo && locationInfo.id ? locationInfo.id : "",
        name: resolveLocationName(opts.locationNameInput, locationInfo, opts.locationConfig.displayFallback),
        rawLocation: weatherLocation
    };
    var mood = deriveMoodTag(weather);
    var artKey = buildArtKey(location.name, mood.tag, opts.preferredStyle, opts.randomness);
    var now = Date.now();
    var canReuseArtwork = cached && cached.inputKey === opts.inputKey && cached.artKey === artKey && cached.artTs && (now - cached.artTs < opts.artRefreshMs) && cached.artwork;
    var artwork = canReuseArtwork ? cached.artwork : await resolveArtwork(ctx, mood.tag, opts.preferredStyle, artKey, opts.enhanceArt);

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

async function fetchLocationInfo(ctx, host, apiKey, locationConfig) {
    if (!locationConfig || !locationConfig.lookupQueries || locationConfig.lookupQueries.length === 0 || locationConfig.source === "locationId") return null;

    var geoHosts = buildGeoHostCandidates(host);
    var urls = [];
    for (var i = 0; i < locationConfig.lookupQueries.length; i++) {
        for (var j = 0; j < geoHosts.length; j++) {
            urls.push(geoHosts[j] + "/geo/v2/city/lookup?location=" + encodeURIComponent(locationConfig.lookupQueries[i]) + "&key=" + encodeURIComponent(apiKey));
            urls.push(geoHosts[j] + "/v2/city/lookup?location=" + encodeURIComponent(locationConfig.lookupQueries[i]) + "&key=" + encodeURIComponent(apiKey));
        }
    }

    try {
        var body = await fetchJsonWithFallback(ctx, uniqueUrls(urls), "地理查询");
        if (body.code !== "200" || !Array.isArray(body.location) || body.location.length === 0) return null;
        var loc = body.location[0] || {};
        return {
            id: loc.id || "",
            name: formatLocationName(loc),
            lat: loc.lat || "",
            lon: loc.lon || ""
        };
    } catch (e) {
        console.log("location lookup error: " + safeMsg(e));
        return null;
    }
}

async function fetchNow(ctx, host, apiKey, location) {
    var weatherHosts = buildWeatherHostCandidates(host);
    var locations = Array.isArray(location) ? location : [location];
    var urls = [];
    for (var i = 0; i < locations.length; i++) {
        for (var j = 0; j < weatherHosts.length; j++) {
            urls.push(weatherHosts[j] + "/v7/weather/now?location=" + encodeURIComponent(locations[i]) + "&key=" + encodeURIComponent(apiKey));
        }
    }
    var body = await fetchJsonWithFallback(ctx, urls, "实时天气");
    if (body.code !== "200" || !body.now) throw new Error("和风天气异常: " + (body.code || "unknown"));
    return body;
}

function normalizeNow(body) {
    var now = body && body.now ? body.now : {};
    return {
        obsTime: now.obsTime || body.updateTime || "",
        temp: toFloat(now.temp),
        feelsLike: toFloat(now.feelsLike),
        text: now.text || "--",
        icon: String(now.icon || "100"),
        windSpeed: toFloat(now.windSpeed),
        humidity: toFloat(now.humidity),
        precip: toFloat(now.precip),
        cloud: toFloat(now.cloud),
        isNight: computeIsNightByIcon(now.icon)
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
        var styled = candidates.filter(function (item) { return Array.isArray(item.styles) && item.styles.indexOf(preferredStyle) >= 0; });
        if (styled.length > 0) candidates = styled;
    }
    if (candidates.length === 0) candidates = ARTWORK_POOL.filter(function (item) { return item.tag === "安静暮色"; });
    return cloneObject(candidates[stableHash(seed) % candidates.length]);
}

async function enhanceArtwork(ctx, artwork) {
    var searchUrl = "https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&q=" + encodeURIComponent(artwork.query || (artwork.title + " " + artwork.artist));
    var searchBody = await fetchJson(ctx, searchUrl);
    var ids = searchBody && Array.isArray(searchBody.objectIDs) ? searchBody.objectIDs : [];
    if (ids.length === 0) return {};

    var fallback = null;
    for (var i = 0; i < Math.min(ids.length, MAX_MET_OBJECT_CANDIDATES); i++) {
        var detail = await fetchJson(ctx, "https://collectionapi.metmuseum.org/public/collection/v1/objects/" + ids[i]);
        var normalized = {
            museumUrl: detail.objectURL || "",
            department: detail.department || "",
            medium: detail.medium || "",
            objectDate: detail.objectDate || artwork.year || "",
            title: detail.title || artwork.title,
            artist: detail.artistDisplayName || artwork.artist
        };
        if (!fallback) fallback = normalized;
        if (detail.primaryImageSmall || detail.primaryImage) return normalized;
    }
    return fallback || {};
}

async function fetchJson(ctx, url) {
    var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget", "Accept": "application/json" }, timeout: 10000 });
    if (resp.status !== 200) {
        var bodyText = "";
        try { bodyText = await resp.text(); } catch (e) { }
        throw new Error("HTTP " + resp.status + " [" + shortenUrl(url) + "]" + (bodyText ? (": " + truncateText(bodyText, 120)) : ""));
    }
    return await resp.json();
}

async function fetchJsonWithFallback(ctx, urls, label) {
    var errors = [];
    for (var i = 0; i < urls.length; i++) {
        try {
            return await fetchJson(ctx, urls[i]);
        } catch (e) {
            errors.push(shortenUrl(urls[i]) + " -> " + safeMsg(e));
        }
    }
    throw new Error((label || "接口请求") + "失败: " + errors.join(" | "));
}

function buildView(data, title, accentInput, openUrl) {
    var moodMeta = MOOD_META[data.mood.tag] || MOOD_META["安静暮色"];
    var accent = accentInput || moodMeta.accent;
    var artworkMeta = data.artwork.artist + (data.artwork.objectDate ? " · " + data.artwork.objectDate : "");
    var reason = buildReason(data.location.name, data.weather, data.mood.tag, data.artwork);
    return {
        title: title,
        location: data.location,
        weather: data.weather,
        mood: data.mood,
        artwork: data.artwork,
        artworkMeta: artworkMeta,
        artworkNote: data.artwork.note || "画面情绪与当下天气接近。",
        styleText: styleLabel(data.artwork.styles),
        reason: reason,
        reasonShort: truncateText(reason, 96),
        theme: {
            accent: accent,
            accentSoft: colorWithAlpha(accent, 0.16),
            accentGlass: colorWithAlpha(accent, 0.24),
            accentGlow: colorWithAlpha(accent, 0.36),
            accentLine: colorWithAlpha(accent, 0.52),
            gradient: moodMeta.gradient,
            icon: moodMeta.icon,
            card: "rgba(255,255,255,0.08)",
            cardStrong: "rgba(255,255,255,0.14)",
            cardSoft: "rgba(255,255,255,0.05)",
            glass: "rgba(255,255,255,0.10)",
            glassStrong: "rgba(255,255,255,0.16)",
            hairline: "rgba(255,255,255,0.12)",
            hairlineStrong: colorWithAlpha(accent, 0.40),
            textMuted: "rgba(255,255,255,0.78)",
            textSubtle: "rgba(255,255,255,0.58)",
            textFaint: "rgba(255,255,255,0.40)"
        },
        weatherSummary: data.weather.text + " " + formatTemp(data.weather.temp),
        detailLine: "湿度 " + formatPercent(data.weather.humidity) + " · 风 " + formatWind(data.weather.windSpeed),
        openUrl: openUrl || data.artwork.museumUrl || ""
    };
}

function deriveMoodTag(weather) {
    var code = parseInt(weather.icon || "100", 10);
    var cloud = isFinite(weather.cloud) ? weather.cloud : 0;
    var wind = isFinite(weather.windSpeed) ? weather.windSpeed : 0;
    var temp = isFinite(weather.temp) ? weather.temp : 20;
    var precip = isFinite(weather.precip) ? weather.precip : 0;
    var isNight = weather.isNight;
    var tag = "安静暮色";

    if (code >= 300 && code <= 399 && isNight) tag = "玻璃雨夜";
    else if (code >= 300 && code <= 399) tag = "雨幕灰城";
    else if (code >= 400 && code <= 499) tag = "雪地静场";
    else if (code >= 500 && code <= 599) tag = "冷蓝薄雾";
    else if (wind >= 28 || (code === 104 && cloud >= 85 && precip > 0)) tag = "风暴前夕";
    else if (isNight) tag = "安静暮色";
    else if (temp <= 5 && cloud >= 65) tag = "沉灰冬晨";
    else if (code === 100 && cloud < 20 && temp >= 20) tag = "金色午后";
    else if ((code === 100 || code === 101 || code === 102 || code === 103) && cloud < 45) tag = "晴蓝留白";
    else if (cloud >= 80) tag = "沉灰冬晨";

    return { tag: tag };
}

function buildReason(cityName, weather, tag, artwork) {
    var intro = cityName + " 现在像《" + artwork.title + "》。";
    var moodLine = artwork.note || "画面的情绪和现在的天气很接近。";
    var weatherLine = "当前" + weather.text + "，" + formatTemp(weather.temp) + "，湿度 " + formatPercent(weather.humidity) + "，风速 " + formatWind(weather.windSpeed);
    if (isFinite(weather.precip) && weather.precip > 0) weatherLine += "，降水 " + formatPrecip(weather.precip);
    return intro + moodLine + weatherLine + "。";
}

function buildSmall(view, status, nextRefresh) {
    return shell([
        heroCard(view, status, {
            compact: true,
            titleSize: 16,
            titleScale: 0.58,
            noteLines: 1,
            showMeta: false,
            showWeatherDetail: false,
            showStyleTag: false,
            padding: [10, 10, 10, 10]
        }),
        sp(6),
        hstack([
            signalMetric("天气", formatTemp(view.weather.temp), view.theme, { valueSize: 12, padding: [7, 8, 7, 8] }),
            signalMetric("湿度", formatPercent(view.weather.humidity), view.theme, { valueSize: 11, padding: [7, 8, 7, 8] }),
            signalMetric("云层", cloudTone(view.weather.cloud), view.theme, { valueSize: 11, padding: [7, 8, 7, 8] })
        ], { gap: 5 })
    ], nextRefresh, view.theme, view.openUrl, [12, 12, 12, 12]);
}

function buildMedium(view, status, nextRefresh) {
    return shell([
        header(view, false),
        sp(8),
        hstack([
            heroCard(view, status, {
                flex: 1.08,
                titleSize: 20,
                titleScale: 0.60,
                noteLines: 1,
                reasonLines: 0,
                padding: [12, 12, 12, 12]
            }),
            weatherPanel(view, true)
        ], { gap: 10, alignItems: "start" }),
        sp(8),
        hstack([
            signalMetric("体感", compactFeelsLike(view.weather), view.theme),
            signalMetric("湿度", formatPercent(view.weather.humidity), view.theme),
            signalMetric("云层", cloudTone(view.weather.cloud), view.theme)
        ], { gap: 6 })
    ], nextRefresh, view.theme, view.openUrl, [12, 13, 12, 13]);
}

function buildLarge(view, status, nextRefresh) {
    var artworkCard = artworkPane(view, null, 116);
    artworkCard.flex = 1;
    return shell([
        header(view, true),
        sp(8),
        hstack([
            heroCard(view, status, {
                flex: 1.12,
                titleSize: 24,
                titleScale: 0.64,
                noteLines: 2,
                reasonLines: 2,
                padding: [14, 14, 14, 14]
            }),
            weatherPanel(view, false)
        ], { gap: 10, alignItems: "start" }),
        sp(8),
        hstack([
            artworkCard,
            insightPanel(view)
        ], { gap: 10, alignItems: "start" }),
        sp(8),
        hstack([
            signalMetric("湿度", formatPercent(view.weather.humidity), view.theme, { valueSize: 12, padding: [7, 9, 7, 9] }),
            signalMetric("风速", formatWind(view.weather.windSpeed), view.theme, { valueSize: 11, valueScale: 0.62, padding: [7, 9, 7, 9] }),
            signalMetric("降水", formatPrecip(view.weather.precip), view.theme, { valueSize: 11, valueScale: 0.62, padding: [7, 9, 7, 9] }),
            signalMetric("云层", cloudTone(view.weather.cloud), view.theme, { valueSize: 12, padding: [7, 9, 7, 9] })
        ], { gap: 6 }),
        sp(),
        footer(status, view.theme)
    ], nextRefresh, view.theme, view.openUrl, [15, 16, 12, 16]);
}

function buildCircular(view, status, nextRefresh) {
    return {
        type: "widget",
        refreshAfter: nextRefresh,
        url: view.openUrl || undefined,
        gap: 2,
        children: [sp(), icon(view.theme.icon, 16, view.theme.accent), txt(shortMood(view.mood.tag), 11, "bold", "#FFFFFF", { minScale: 0.6, maxLines: 1 }), txt(statusLabel(status), 8, "medium", view.theme.textSubtle), sp()]
    };
}

function buildRectangular(view, status, nextRefresh) {
    return {
        type: "widget",
        refreshAfter: nextRefresh,
        url: view.openUrl || undefined,
        gap: 4,
        children: [
            hstack([icon(view.theme.icon, 10, view.theme.accent), txt(view.location.name, 10, "medium", "rgba(255,255,255,0.72)"), sp(), tag(shortMood(view.mood.tag), view.theme.accent, view.theme.accentSoft, 8)], { gap: 4 }),
            txt("像《" + view.artwork.title + "》", 12, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 }),
            txt(view.weather.text + " · " + formatTemp(view.weather.temp) + " · " + statusLabel(status), 9, "medium", "rgba(255,255,255,0.55)", { maxLines: 1, minScale: 0.7 })
        ]
    };
}

function buildInline(view, status, nextRefresh) {
    return {
        type: "widget",
        refreshAfter: nextRefresh,
        url: view.openUrl || undefined,
        children: [icon(view.theme.icon, 12, view.theme.accent), txt(" " + view.location.name + "像《" + truncateText(view.artwork.title, 14) + "》", 12, "medium", "#FFFFFF", { maxLines: 1, minScale: 0.55 }), txt(" · " + shortMood(view.mood.tag), 11, "medium", view.theme.textSubtle)]
    };
}

function shell(children, nextRefresh, theme, url, padding) {
    return {
        type: "widget",
        gap: 0,
        padding: padding || [14, 16, 12, 16],
        backgroundGradient: { type: "linear", colors: theme.gradient, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
        refreshAfter: nextRefresh,
        url: url || undefined,
        children: children
    };
}

function header(view, showTime) {
    var children = [
        accentOrb(view.theme, 24),
        vstack([
            txt(view.title, 11, "bold", view.theme.accent, { maxLines: 1, minScale: 0.62 }),
            txt(view.location.name + " · " + shortMood(view.mood.tag), 9, "medium", view.theme.textMuted, { maxLines: 1, minScale: 0.72 })
        ], { gap: 1, flex: 1 })
    ];
    if (showTime) {
        children.push(hstack([
            icon("clock", 8, view.theme.accent),
            { type: "date", date: new Date().toISOString(), format: "time", font: { size: 9, weight: "medium" }, textColor: view.theme.textSubtle }
        ], {
            gap: 4,
            padding: [4, 8, 4, 8],
            backgroundColor: view.theme.cardSoft,
            borderRadius: 99,
            borderWidth: 1,
            borderColor: view.theme.hairline
        }));
    }
    return hstack(children, { gap: 8, alignItems: "center" });
}

function heroCard(view, status, opts) {
    opts = opts || {};
    var children = [];
    var tags = [];

    children.push(
        hstack([
            sectionLabel(opts.compact ? "CITY PALETTE" : "CITY / PAINTING", view.theme),
            sp(),
            statusTag(status, view.theme)
        ], { gap: 6, alignItems: "center" })
    );

    children.push(sp(opts.compact ? 6 : 8));

    children.push(
        hstack([
            accentOrb(view.theme, opts.compact ? 28 : 34),
            vstack([
                txt(view.location.name, opts.compact ? 10 : 11, "semibold", "#FFFFFF", { maxLines: 1, minScale: 0.72 }),
                txt(view.weatherSummary, 10, "medium", view.theme.textMuted, { maxLines: 1, minScale: 0.72 }),
                opts.showWeatherDetail === false ? null : txt(view.detailLine, 9, "medium", view.theme.textSubtle, {
                    maxLines: opts.compact ? 1 : 2,
                    minScale: 0.72
                })
            ].filter(Boolean), { gap: 2, flex: 1 })
        ], { gap: 8, alignItems: "center" })
    );

    children.push(sp(opts.compact ? 7 : 10));

    children.push(txt("像《" + view.artwork.title + "》", opts.titleSize || 24, "bold", "#FFFFFF", {
        maxLines: opts.titleLines || 2,
        minScale: opts.titleScale || 0.58
    }));

    if (opts.showMeta !== false) {
        children.push(sp(4));
        children.push(txt(view.artworkMeta, opts.compact ? 10 : 11, "medium", view.theme.textMuted, { maxLines: 1, minScale: 0.72 }));
    }

    if ((opts.noteLines || 0) > 0) {
        children.push(sp(6));
        children.push(txt(view.artworkNote, 10, "regular", opts.compact ? view.theme.textMuted : "#FFFFFF", {
            maxLines: opts.noteLines || 2,
            minScale: 0.72
        }));
    }

    if (opts.showMoodTag !== false) tags.push(tag(view.mood.tag, view.theme.accent, view.theme.accentSoft, 8));
    if (opts.showStyleTag !== false) tags.push(tag(view.styleText, "#FFFFFF", view.theme.cardSoft, 8));
    if (tags.length > 0) {
        children.push(sp(8));
        children.push(hstack(tags, { gap: 6, alignItems: "center" }));
    }

    if (opts.reasonLines) {
        children.push(sp(8));
        children.push(txt(truncateText(view.reason, opts.reasonLines > 1 ? 64 : 42), 10, "regular", view.theme.textMuted, {
            maxLines: opts.reasonLines,
            minScale: 0.74
        }));
    }

    return panel(children, view.theme, {
        flex: opts.flex,
        padding: opts.padding || [12, 13, 12, 13],
        borderRadius: opts.compact ? 16 : 20,
        backgroundColor: view.theme.cardStrong,
        backgroundGradient: linearGradient([
            colorWithAlpha(view.theme.accent, opts.compact ? 0.22 : 0.18),
            colorWithAlpha(view.theme.accent, 0.08),
            view.theme.card
        ]),
        borderColor: view.theme.hairlineStrong,
        shadowColor: view.theme.accentGlow,
        shadowRadius: opts.compact ? 14 : 18,
        shadowOffset: { x: 0, y: 8 }
    });
}

function artworkPane(view, width, height) {
    var compact = isFinite(height) && height <= 100;
    var card = panel([], view.theme, {
        borderRadius: compact ? 18 : 20,
        padding: compact ? [10, 11, 10, 11] : [12, 12, 12, 12],
        backgroundColor: view.theme.cardStrong,
        backgroundGradient: linearGradient([
            view.theme.cardStrong,
            colorWithAlpha(view.theme.accent, 0.10),
            view.theme.cardSoft
        ]),
        borderColor: view.theme.hairlineStrong
    });
    if (isFinite(width)) card.width = width;

    card.children = [vstack([
        hstack([
            sectionLabel("ART INDEX", view.theme),
            sp(),
            tag(view.styleText, view.theme.accent, view.theme.accentSoft, 8)
        ], { gap: 6, alignItems: "center" }),
        sp(5),
        txt("《" + view.artwork.title + "》", compact ? 13 : 14, "bold", "#FFFFFF", { maxLines: 2, minScale: 0.60 }),
        sp(3),
        txt(view.artworkNote, 10, "regular", view.theme.textMuted, { maxLines: compact ? 1 : 2, minScale: 0.72 }),
        sp(6),
        detailRow("作者", view.artwork.artist, view.theme),
        compact ? null : sp(4),
        compact ? null : detailRow("年代", view.artwork.objectDate || "馆藏信息", view.theme)
    ].filter(Boolean), { gap: 0, alignItems: "start" })];

    return card;
}

function weatherPanel(view, compact) {
    var children = [
        hstack([
            sectionLabel(compact ? "WEATHER GRID" : "ATMOSPHERE DATA", view.theme),
            sp(),
            tag(cloudTone(view.weather.cloud), "#FFFFFF", view.theme.cardSoft, 8)
        ], { gap: 6, alignItems: "center" }),
        sp(8),
        hstack([
            vstack([
                txt(formatTemp(view.weather.temp), compact ? 22 : 26, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.72 }),
                txt(view.weather.text, 10, "medium", view.theme.textMuted, { maxLines: 1, minScale: 0.72 }),
                compact ? null : txt("体感 " + compactFeelsLike(view.weather), 10, "medium", view.theme.textSubtle, { maxLines: 1, minScale: 0.72 })
            ].filter(Boolean), { gap: 2, flex: 1 }),
            compact ? icon(view.theme.icon, 16, view.theme.accent) : accentOrb(view.theme, 34)
        ], { gap: 8, alignItems: "center" }),
        compact ? null : sp(6),
        compact ? null : txt(view.detailLine, 10, "medium", view.theme.textMuted, { maxLines: 1, minScale: 0.72 }),
        sp(8),
        hstack([
            compactMetric("湿度", formatPercent(view.weather.humidity), view.theme),
            compact ? compactMetric("云层", cloudTone(view.weather.cloud), view.theme) : compactMetric("风速", formatWind(view.weather.windSpeed), view.theme)
        ], { gap: 6 })
    ].filter(Boolean);

    if (!compact) {
        children.push(
            sp(6),
            hstack([
                compactMetric("降水", formatPrecip(view.weather.precip), view.theme),
                compactMetric("云层", cloudTone(view.weather.cloud), view.theme)
            ], { gap: 6 })
        );
    }

    return panel(children, view.theme, {
        flex: compact ? undefined : 0.9,
        padding: compact ? [10, 11, 10, 11] : [12, 13, 12, 13],
        borderRadius: compact ? 16 : 20,
        backgroundColor: view.theme.card,
        backgroundGradient: linearGradient([
            colorWithAlpha(view.theme.accent, 0.14),
            "rgba(255,255,255,0.04)",
            view.theme.card
        ]),
        borderColor: view.theme.hairlineStrong
    });
}

function insightPanel(view) {
    return panel([
        sectionLabel("CITY ANALYSIS", view.theme),
        sp(6),
        txt(view.reasonShort, 10, "regular", "#FFFFFF", { maxLines: 4, minScale: 0.76 }),
        sp(8),
        detailRow("情绪标签", view.mood.tag, view.theme),
        sp(5),
        detailRow("作品风格", view.styleText, view.theme),
        sp(5),
        detailRow("空气状态", cloudTone(view.weather.cloud), view.theme)
    ], view.theme, {
        flex: 1,
        padding: [11, 13, 11, 13],
        borderRadius: 18,
        backgroundColor: view.theme.card,
        backgroundGradient: linearGradient([
            colorWithAlpha(view.theme.accent, 0.10),
            view.theme.card,
            view.theme.cardSoft
        ])
    });
}

function infoStrip(view, compact) {
    var chips = [
        infoChip("空气", cloudTone(view.weather.cloud), view.theme),
        infoChip("湿度", formatPercent(view.weather.humidity), view.theme),
        infoChip("风速", formatWind(view.weather.windSpeed), view.theme)
    ];
    if (!compact) chips.push(infoChip("降水", formatPrecip(view.weather.precip), view.theme));
    return hstack(chips, { gap: 6 });
}

function metricCard(label, value, theme) {
    return signalMetric(label, value, theme);
}

function compactMetric(label, value, theme) {
    return signalMetric(label, value, theme, { valueSize: 11, valueScale: 0.60 });
}

function signalMetric(label, value, theme, opts) {
    opts = opts || {};
    return vstack([
        txt(label, 8, "medium", theme.textSubtle),
        sp(2),
        txt(value, opts.valueSize || 12, "bold", "#FFFFFF", {
            minScale: opts.valueScale || 0.70,
            maxLines: 1
        })
    ], {
        flex: opts.flex == null ? 1 : opts.flex,
        gap: 2,
        padding: opts.padding || [7, 9, 7, 9],
        backgroundColor: theme.cardSoft,
        backgroundGradient: linearGradient([
            colorWithAlpha(theme.accent, 0.10),
            theme.cardSoft
        ], { x: 0, y: 0 }, { x: 1, y: 1 }),
        borderRadius: opts.borderRadius || 12,
        borderWidth: 1,
        borderColor: theme.hairline
    });
}

function sectionLabel(text, theme) {
    return hstack([
        microBar(theme),
        txt(text, 8, "semibold", theme.textSubtle, { maxLines: 1, minScale: 0.72 })
    ], { gap: 6, alignItems: "center" });
}

function accentOrb(theme, size) {
    return vstack([sp(), icon(theme.icon, Math.max(12, Math.round(size * 0.4)), theme.accent), sp()], {
        width: size,
        height: size,
        alignItems: "center",
        borderRadius: size / 2,
        borderWidth: 1,
        borderColor: theme.hairlineStrong,
        backgroundColor: theme.cardStrong,
        backgroundGradient: linearGradient([
            colorWithAlpha(theme.accent, 0.34),
            colorWithAlpha(theme.accent, 0.10),
            "rgba(255,255,255,0.03)"
        ]),
        shadowColor: theme.accentGlow,
        shadowRadius: Math.round(size * 0.45),
        shadowOffset: { x: 0, y: 6 }
    });
}

function microBar(theme) {
    return {
        type: "stack",
        width: 16,
        height: 4,
        borderRadius: 99,
        backgroundGradient: linearGradient([
            theme.accent,
            colorWithAlpha(theme.accent, 0.22)
        ], { x: 0, y: 0.5 }, { x: 1, y: 0.5 })
    };
}

function infoChip(label, value, theme) {
    return hstack([
        txt(label, 8, "medium", theme.textSubtle),
        txt(value, 10, "semibold", "#FFFFFF", { maxLines: 1, minScale: 0.68 })
    ], {
        gap: 4,
        padding: [4, 8, 4, 8],
        backgroundColor: theme.cardSoft,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: theme.hairline
    });
}

function detailRow(label, value, theme) {
    return hstack([
        txt(label, 9, "medium", theme.textSubtle, { maxLines: 1, minScale: 0.72 }),
        sp(),
        txt(value, 10, "semibold", "#FFFFFF", { maxLines: 1, minScale: 0.64, textAlign: "right" })
    ], { gap: 8, alignItems: "center" });
}

function footer(status, theme) {
    return hstack([
        hstack([
            icon("clock.arrow.circlepath", 8, theme.textSubtle),
            { type: "date", date: new Date().toISOString(), format: "relative", font: { size: 9, weight: "medium" }, textColor: theme.textSubtle }
        ], { gap: 4, flex: 1, alignItems: "center" }),
        statusTag(status, theme)
    ], { gap: 6, alignItems: "center" });
}

function tag(text, color, bg, size) {
    return hstack([txt(text, size || 9, "semibold", color, { maxLines: 1, minScale: 0.55 })], {
        padding: [3, 7, 3, 7],
        backgroundColor: bg,
        borderRadius: 99,
        borderWidth: 1,
        borderColor: colorWithAlpha(color, 0.28)
    });
}

function statusTag(status, theme) {
    var isLive = status === "live";
    return tag(statusLabel(status), isLive ? "#10B981" : "#F59E0B", isLive ? "rgba(16,185,129,0.16)" : "rgba(245,158,11,0.16)", 8);
}

function statusLabel(status) {
    return status === "live" ? "实时" : "缓存";
}

function panel(children, theme, opts) {
    var el = {
        type: "stack",
        direction: "column",
        alignItems: "start",
        children: children,
        padding: [10, 12, 10, 12],
        backgroundColor: theme.card,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: theme.hairline,
        shadowColor: "rgba(0,0,0,0.18)",
        shadowRadius: 12,
        shadowOffset: { x: 0, y: 6 }
    };
    if (opts) {
        for (var k in opts) if (opts[k] !== undefined) el[k] = opts[k];
    }
    return el;
}

function linearGradient(colors, startPoint, endPoint) {
    return {
        type: "linear",
        colors: colors,
        startPoint: startPoint || { x: 0, y: 0 },
        endPoint: endPoint || { x: 1, y: 1 }
    };
}

function colorWithAlpha(color, alpha) {
    var str = String(color || "").trim();
    var opacity = clampUnit(alpha);
    var hex = str.match(/^#([0-9a-f]{6}|[0-9a-f]{8})$/i);
    if (hex) {
        var value = hex[1].slice(0, 6);
        var r = parseInt(value.slice(0, 2), 16);
        var g = parseInt(value.slice(2, 4), 16);
        var b = parseInt(value.slice(4, 6), 16);
        return "rgba(" + r + ", " + g + ", " + b + ", " + trimOpacity(opacity) + ")";
    }

    var rgba = str.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([0-9.]+))?\s*\)$/i);
    if (rgba) {
        return "rgba(" + rgba[1] + ", " + rgba[2] + ", " + rgba[3] + ", " + trimOpacity(opacity) + ")";
    }

    return str;
}

function clampUnit(val) {
    var n = parseFloat(val);
    if (!isFinite(n)) return 1;
    if (n < 0) return 0;
    if (n > 1) return 1;
    return n;
}

function trimOpacity(val) {
    return String(Math.round(val * 1000) / 1000);
}

function errorWidget(title, msg) {
    return {
        type: "widget",
        padding: 16,
        gap: 8,
        backgroundGradient: { type: "linear", colors: ["#101826", "#1F2937"], startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 1 } },
        children: [hstack([icon("exclamationmark.triangle.fill", 14, "#F87171"), txt(title, "headline", "bold", "#FFFFFF")], { gap: 6 }), sp(4), txt(msg || "未知错误", "caption1", "regular", "rgba(255,255,255,0.7)", { maxLines: 5 })]
    };
}

function txt(text, size, weight, color, opts) {
    var el = {
        type: "text",
        text: String(text),
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

function sp(len) {
    var el = { type: "spacer" };
    if (len != null) el.length = len;
    return el;
}

function styleLabel(styles) {
    if (!Array.isArray(styles) || styles.length === 0) return "馆藏匹配";
    var map = { impressionism: "印象派", light: "明亮", day: "日景", night: "夜景", city: "城市", rain: "雨景", mist: "雾景", storm: "风暴", quiet: "静场", snow: "雪景", winter: "冬景", realism: "现实主义", dramatic: "戏剧感", sea: "海景" };
    return styles.slice(0, 2).map(function (item) { return map[item] || item; }).join(" · ");
}

function cloudTone(cloud) {
    var n = toFloat(cloud);
    if (!isFinite(n)) return "--";
    if (n < 20) return "通透";
    if (n < 50) return "留白";
    if (n < 80) return "柔灰";
    return "厚云";
}

function shortMood(tag) {
    var map = { "金色午后": "金午", "晴蓝留白": "晴蓝", "安静暮色": "暮色", "玻璃雨夜": "雨夜", "雨幕灰城": "灰城", "冷蓝薄雾": "薄雾", "风暴前夕": "风暴", "雪地静场": "雪静", "沉灰冬晨": "冬晨" };
    return map[tag] || "像画";
}

function computeIsNightByIcon(icon) {
    var code = parseInt(icon || "100", 10);
    return code >= 150 && code < 200;
}

function resolveLocationConfig(locationInput, lat, lon, city) {
    if (locationInput) {
        var raw = String(locationInput || "").trim();
        var source = isLocationId(raw) ? "locationId" : (looksLikeCoordinate(raw) ? "coordinate" : "text");
        var coordinateCandidates = source === "coordinate" ? buildCoordinateCandidates(raw) : [raw];
        return {
            source: source,
            weatherLocation: coordinateCandidates,
            lookupQueries: source === "locationId" ? [] : coordinateCandidates,
            displayFallback: looksLikeCoordinate(raw) ? "当前位置" : raw,
            cacheKey: raw
        };
    }

    if (isFinite(lat) && isFinite(lon)) {
        var coordinate = lon + "," + lat;
        return {
            source: "coordinate",
            weatherLocation: [coordinate],
            lookupQueries: [coordinate],
            displayFallback: "当前位置",
            cacheKey: coordinate
        };
    }

    var cityText = String(city || "").trim();
    return {
        source: "city",
        weatherLocation: "",
        lookupQueries: cityText ? [cityText] : [],
        displayFallback: cityText || "--",
        cacheKey: cityText
    };
}

function resolveWeatherLocation(locationConfig, locationInfo) {
    if (!locationConfig) throw new Error("位置配置缺失");
    if (locationConfig.source === "city" || locationConfig.source === "text") {
        if (locationInfo && locationInfo.id) return [locationInfo.id];
        if (locationConfig.source === "city") {
            throw new Error("城市解析失败，请检查 CITY");
        }
        if (Array.isArray(locationConfig.weatherLocation) && locationConfig.weatherLocation.length > 0) {
            return locationConfig.weatherLocation;
        }
        throw new Error("位置解析失败，请检查 LOCATION");
    }
    return locationConfig.weatherLocation;
}

function resolveLocationName(input, locationInfo, fallback) {
    if (input) return input;
    if (locationInfo && locationInfo.name) return locationInfo.name;
    if (looksLikeCoordinate(fallback)) return "当前位置";
    return fallback || "--";
}

function formatLocationName(loc) {
    if (!loc) return "";
    var city = loc.adm2 || loc.adm1 || "";
    var district = loc.name || "";
    if (city && district && city !== district) return city + "·" + district;
    return district || city || loc.adm1 || "";
}

function mergeArtwork(base, extra) {
    var merged = cloneObject(base);
    if (!extra) return merged;
    for (var k in extra) if (extra[k] != null && extra[k] !== "") merged[k] = extra[k];
    return merged;
}

function cloneObject(obj) {
    var out = {};
    for (var k in obj) out[k] = obj[k];
    return out;
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
    for (var i = 0; i < str.length; i++) hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    return Math.abs(hash);
}

function truncateText(text, maxLen) {
    var str = String(text || "");
    if (str.length <= maxLen) return str;
    return str.slice(0, Math.max(0, maxLen - 3)) + "...";
}

function formatTemp(val) {
    var n = toFloat(val);
    if (!isFinite(n)) return "--";
    return Math.round(n) + "°";
}

function feelsLikeText(weather) {
    var feelsLike = weather ? toFloat(weather.feelsLike) : NaN;
    if (isFinite(feelsLike)) return "体感 " + formatTemp(feelsLike);
    return "体感 " + formatTemp(weather ? weather.temp : NaN);
}

function compactFeelsLike(weather) {
    var feelsLike = weather ? toFloat(weather.feelsLike) : NaN;
    if (isFinite(feelsLike)) return formatTemp(feelsLike);
    return formatTemp(weather ? weather.temp : NaN);
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

function normalizeHost(raw) {
    var h = String(raw || "").trim();
    if (!h) return "";
    if (!/^https?:\/\//i.test(h)) h = "https://" + h;
    return h.replace(/\/$/, "");
}

function looksLikeCoordinate(val) {
    return /^-?\d+(?:\.\d+)?,\s*-?\d+(?:\.\d+)?$/.test(String(val || "").trim());
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

function isLocationId(val) {
    return /^\d+$/.test(String(val || "").trim());
}

function isValidLatitude(val) {
    return isFinite(val) && val >= -90 && val <= 90;
}

function isValidLongitude(val) {
    return isFinite(val) && val >= -180 && val <= 180;
}

function pad2(n) {
    return n < 10 ? "0" + n : String(n);
}

function shortenUrl(url) {
    var text = String(url || "");
    return text.replace(/^https?:\/\//i, "");
}

function buildGeoHostCandidates(host) {
    return uniqueHosts([
        replaceHostPrefix(host, "geoapi."),
        host,
        replaceHostPrefix(host, "api."),
        replaceHostPrefix(host, "devapi.")
    ]);
}

function buildWeatherHostCandidates(host) {
    return uniqueHosts([
        replaceHostPrefix(host, "devapi."),
        replaceHostPrefix(host, "api."),
        host,
        replaceHostPrefix(host, "geoapi.")
    ]);
}

function replaceHostPrefix(host, prefix) {
    var normalized = normalizeHost(host);
    if (!normalized) return "";
    return normalized.replace(/^(https?:\/\/)(?:devapi|geoapi|api)\./i, "$1" + prefix);
}

function uniqueHosts(hosts) {
    var map = {};
    var list = [];
    for (var i = 0; i < hosts.length; i++) {
        var item = normalizeHost(hosts[i]);
        if (!item || map[item]) continue;
        map[item] = true;
        list.push(item);
    }
    return list;
}

function uniqueUrls(urls) {
    var map = {};
    var list = [];
    for (var i = 0; i < urls.length; i++) {
        var item = String(urls[i] || "");
        if (!item || map[item]) continue;
        map[item] = true;
        list.push(item);
    }
    return list;
}

function buildCoordinateCandidates(raw) {
    var list = [raw];
    var parts = String(raw || "").split(",");
    if (parts.length !== 2) return list;

    var first = parseFloat(parts[0]);
    var second = parseFloat(parts[1]);
    if (!isFinite(first) || !isFinite(second)) return list;

    var swapped = second + "," + first;
    if (swapped !== raw) list.push(swapped);
    return uniqueUrls(list);
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

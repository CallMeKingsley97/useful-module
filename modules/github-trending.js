// GitHub Trending 热点仓库小组件
// 特性：榜单抓取 + 语言筛选 + 多尺寸布局 + 缓存 + 失败降级

var CACHE_KEY = "gh_trending_cache";
var DEFAULT_REFRESH_MINUTES = 10;

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";
    var title = env.TITLE || "GitHub Trending";
    var accent = env.ACCENT_COLOR || "#F97316";
    var language = (env.LANGUAGE || "").trim();
    var since = normalizeSince(env.SINCE || "daily");
    var spoken = (env.SPOKEN_LANGUAGE || "").trim();
    var limit = clampNumber(env.LIMIT || 8, 1, 20);
    var token = (env.GITHUB_TOKEN || "").trim();
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 1, 1440);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);

    // 读取缓存
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
        // 拉取最新数据
        try {
            var result = await fetchTrending(ctx, {
                language: language,
                since: since,
                spoken: spoken,
                limit: limit,
                token: token
            });
            data = { items: result.items, ts: Date.now(), source: result.source };
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("trending fetch error: " + safeMsg(e));
            if (cacheReady) {
                data = cached;
            } else {
                return errorWidget("获取失败", safeMsg(e));
            }
        }
    }

    var repoList = (data.items || []).slice(0, limit);
    if (repoList.length === 0) {
        return errorWidget("暂无数据", "未解析到热门仓库");
    }

    now = Date.now();
    var refreshAfter = new Date(now + refreshIntervalMs).toISOString();
    var status = fetched ? "live" : "cached";
    var sinceLabel = sinceLabelText(since);
    var source = data.source || "trending";

    if (family === "accessoryCircular") return buildCircular(repoList, accent);
    if (family === "accessoryRectangular") return buildRectangular(repoList, accent, sinceLabel);
    if (family === "accessoryInline") return buildInline(repoList, accent);
    if (family === "systemSmall") return buildSmall(repoList, title, accent, sinceLabel, refreshAfter, status, source);
    if (family === "systemLarge") return buildLarge(repoList, title, accent, sinceLabel, refreshAfter, status, source);
    return buildMedium(repoList, title, accent, sinceLabel, refreshAfter, status, source);
}

// ============== 数据层 ==============

async function fetchTrending(ctx, opts) {
    try {
        var html = await fetchTrendingHtml(ctx, opts);
        var items = parseTrending(html, opts.limit);
        if (items.length > 0) return { items: items, source: "trending" };
        throw new Error("解析失败");
    } catch (e) {
        var fallback = await fetchFallbackSearch(ctx, opts);
        if (fallback.length > 0) return { items: fallback, source: "search" };
        throw e;
    }
}

async function fetchTrendingHtml(ctx, opts) {
    var url = buildTrendingUrl(opts.language, opts.since, opts.spoken);
    var headers = { "User-Agent": "Egern-Widget" };
    var resp = await ctx.http.get(url, { headers: headers, timeout: 10000 });
    if (resp.status !== 200) throw new Error("HTTP " + resp.status);
    return await resp.text();
}

async function fetchFallbackSearch(ctx, opts) {
    var headers = { "User-Agent": "Egern-Widget" };
    if (opts.token) headers["Authorization"] = "Bearer " + opts.token;

    var q = "stars:>1";
    if (opts.language) q += " language:" + opts.language;

    var url = "https://api.github.com/search/repositories?q=" + encodeURIComponent(q)
        + "&sort=stars&order=desc&per_page=" + opts.limit;

    var resp = await ctx.http.get(url, { headers: headers, timeout: 10000 });
    if (resp.status !== 200) throw new Error("GitHub API HTTP " + resp.status);
    var data = await resp.json();
    var arr = data.items || [];
    var items = [];

    for (var i = 0; i < arr.length; i++) {
        var r = arr[i] || {};
        var full = r.full_name || "";
        var parts = full.split("/");
        items.push({
            owner: parts[0] || (r.owner ? r.owner.login : ""),
            name: parts[1] || r.name || "",
            full: full,
            stars: r.stargazers_count || 0,
            forks: r.forks_count || 0,
            lang: r.language || "",
            desc: r.description || "",
            starsToday: 0,
            url: r.html_url || (full ? "https://github.com/" + full : "")
        });
    }
    return items.slice(0, opts.limit);
}

function parseTrending(html, limit) {
    if (!html) return [];
    var items = [];
    var articles = html.match(/<article[\s\S]*?<\/article>/g) || [];

    for (var i = 0; i < articles.length; i++) {
        var article = articles[i];
        var full = extractRepoFullName(article);
        if (!full) continue;

        var parts = full.split("/");
        var owner = parts[0] || "";
        var name = parts[1] || "";

        var desc = extractDescription(article);
        var lang = extractLanguage(article);
        var stars = extractCount(article, "stargazers");
        var forks = extractCount(article, "forks");
        var trend = extractTrend(article);

        items.push({
            owner: owner,
            name: name,
            full: full,
            stars: stars,
            forks: forks,
            lang: lang,
            desc: desc,
            starsToday: trend.count || 0,
            url: "https://github.com/" + full
        });

        if (items.length >= limit) break;
    }

    return items;
}

function buildTrendingUrl(language, since, spoken) {
    var url = "https://github.com/trending";
    if (language) url += "/" + encodeURIComponent(language);
    var qs = [];
    if (since) qs.push("since=" + encodeURIComponent(since));
    if (spoken) qs.push("spoken_language_code=" + encodeURIComponent(spoken));
    if (qs.length > 0) url += "?" + qs.join("&");
    return url;
}

// ============== 各布局构建 ==============

function buildMedium(repos, title, accent, sinceLabel, refreshAfter, status, source) {
    var items = repos.slice(0, 6);
    return shell([
        header(title, accent, sinceLabel, true),
        sp(4),
        separator(),
        sp(6),
        vstack(items.map(function (r) { return repoRow(r, accent, false); }), { gap: 6 }),
        sp(),
        footer(status, source)
    ], refreshAfter);
}

function buildSmall(repos, title, accent, sinceLabel, refreshAfter, status, source) {
    var items = repos.slice(0, 3);
    return shell([
        header(title, accent, sinceLabel, false),
        sp(4),
        separator(),
        sp(),
        vstack(items.map(function (r) { return repoRow(r, accent, true); }), { gap: 5 }),
        sp(),
        footer(status, source)
    ], refreshAfter, [14, 16, 12, 16]);
}

function buildLarge(repos, title, accent, sinceLabel, refreshAfter, status, source) {
    var featured = repos.slice(0, 3);
    var rest = repos.slice(3, 10);

    var children = [
        header(title, accent, sinceLabel, true),
        sp(6),
        separator(),
        sp(6)
    ];

    for (var i = 0; i < featured.length; i++) {
        children.push(repoBlock(featured[i], accent));
        if (i < featured.length - 1) children.push(sp(6));
    }

    if (rest.length > 0) {
        children.push(sp(8));
        children.push(txt("更多", "caption2", "semibold", "rgba(255,255,255,0.35)"));
        children.push(sp(4));
        children.push(vstack(rest.map(function (r) { return repoRow(r, accent, false); }), { gap: 5 }));
    }

    children.push(sp());
    children.push(footer(status, source));

    return shell(children, refreshAfter, [16, 18, 12, 18]);
}

function buildCircular(repos, accent) {
    var r = repos[0];
    if (!r) return { type: "widget", children: [txt("N/A", "caption1", "bold")] };
    var hot = r.starsToday > 0 ? r.starsToday : r.stars;
    return {
        type: "widget",
        gap: 2,
        children: [
            sp(),
            icon("flame.fill", 16, accent),
            txt(fmtK(hot), 14, "bold", null, { minScale: 0.5 }),
            txt(r.name, 9, "medium", null, { minScale: 0.5, maxLines: 1 }),
            sp()
        ]
    };
}

function buildRectangular(repos, accent, sinceLabel) {
    var items = repos.slice(0, 2);
    return {
        type: "widget",
        gap: 3,
        children: [
            hstack([icon("flame.fill", 9, accent), txt("Trending " + sinceLabel, 10, "medium", "rgba(255,255,255,0.7)")], { gap: 4 }),
            sp(2)
        ].concat(items.map(function (r) {
            return hstack([
                txt(r.name, 10, "medium", null, { maxLines: 1, minScale: 0.7 }),
                sp(),
                txt("+" + fmtK(r.starsToday || r.stars), 10, "bold", accent)
            ], { gap: 3 });
        }))
    };
}

function buildInline(repos, accent) {
    var r = repos[0];
    var text = r ? (r.name + " +" + fmtK(r.starsToday || r.stars)) : "N/A";
    return {
        type: "widget",
        children: [
            icon("flame.fill", 12, accent),
            txt(text, 12, "medium", null, { minScale: 0.5, maxLines: 1 })
        ]
    };
}

// ============== UI 组件工厂 ==============

function repoRow(r, accent, compact) {
    var sz = compact ? 11 : 12;
    var name = (r.owner && r.name) ? (r.owner + "/" + r.name) : (r.full || r.name || "N/A");
    var trendText = trendTextOf(r);
    var trendColor = r.starsToday > 0 ? accent : "rgba(255,255,255,0.35)";
    var langDot = r.lang ? [
        { type: "stack", width: 6, height: 6, borderRadius: 3, backgroundColor: langColor(r.lang), children: [] }
    ] : [];

    return hstack(
        [icon("flame.fill", compact ? 10 : 11, accent)]
            .concat(langDot)
            .concat([
                txt(name, sz, "medium", "#FFFFFFCC", { maxLines: 1, minScale: 0.6 }),
                sp(),
                txt(fmtK(r.stars), sz, "bold", "#FFFFFF"),
                txt(trendText, sz - 1, "semibold", trendColor)
            ]),
        { gap: compact ? 4 : 5 }
    );
}

function repoBlock(r, accent) {
    var name = (r.owner && r.name) ? (r.owner + "/" + r.name) : (r.full || r.name || "N/A");
    var trendText = trendTextOf(r);
    var trendColor = r.starsToday > 0 ? accent : "rgba(255,255,255,0.35)";

    var children = [
        hstack([
            icon("flame.fill", 12, accent),
            txt(name, 12, "semibold", "#FFFFFFCC", { maxLines: 1, minScale: 0.6 }),
            sp(),
            txt(fmtK(r.stars), 12, "bold", "#FFFFFF"),
            txt(trendText, 10, "semibold", trendColor)
        ], { gap: 5 })
    ];

    if (r.desc) {
        children.push(txt(r.desc, 10, "regular", "rgba(255,255,255,0.55)", { maxLines: 2, minScale: 0.7 }));
    }

    return vstack(children, { gap: 2 });
}

function shell(children, refreshAfter, padding) {
    return {
        type: "widget",
        gap: 0,
        padding: padding || [14, 16, 12, 16],
        backgroundGradient: {
            type: "linear",
            colors: ["#0D1117", "#161B22", "#1C2333"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 0.5, y: 1 }
        },
        refreshAfter: refreshAfter,
        children: children
    };
}

function header(title, accent, sinceLabel, showTime) {
    var children = [
        icon("flame.fill", 16, accent),
        txt(title, 13, "bold", accent, {
            shadowColor: accent + "66",
            shadowRadius: 4,
            shadowOffset: { x: 0, y: 0 }
        }),
        txt(sinceLabel, 10, "semibold", "rgba(255,255,255,0.5)"),
        sp()
    ];
    if (showTime) {
        children.push({
            type: "date",
            date: new Date().toISOString(),
            format: "time",
            font: { size: 10, weight: "medium" },
            textColor: "rgba(255,255,255,0.35)"
        });
    }
    return hstack(children, { gap: 5 });
}

function footer(status, source) {
    var isLive = status === "live";
    var sourceText = source === "search" ? "search" : "trend";
    var sourceColor = source === "search" ? "#FFD16666" : "#3FB95066";
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
        txt(sourceText, 8, "medium", sourceColor),
        txt(isLive ? "live" : "cached", 8, "medium", isLive ? "#3FB95066" : "#FFC10766")
    ], { gap: 3 });
}

function separator() {
    return hstack([sp()], { height: 1, backgroundColor: "rgba(255,255,255,0.06)" });
}

function errorWidget(title, msg) {
    return {
        type: "widget",
        padding: 16,
        gap: 8,
        backgroundColor: "#0D1117",
        children: [
            hstack([icon("exclamationmark.triangle.fill", 14, "#FFC107"), txt(title, "subheadline", "bold", "#FFFFFF")], { gap: 6 }),
            sp(),
            txt(msg || "未知错误", "caption1", null, "#FFFFFFAA", { maxLines: 4 })
        ]
    };
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

// ============== 工具函数 ==============

function normalizeSince(raw) {
    var v = String(raw || "").toLowerCase();
    if (v === "weekly" || v === "week") return "weekly";
    if (v === "monthly" || v === "month") return "monthly";
    return "daily";
}

function sinceLabelText(since) {
    if (since === "weekly") return "本周";
    if (since === "monthly") return "本月";
    return "今日";
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

function fmtK(n) {
    if (!isFinite(n) || n < 0) return "0";
    if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
}

function langColor(lang) {
    var colors = {
        JavaScript: "#F1E05A", TypeScript: "#3178C6", Python: "#3572A5",
        Java: "#B07219", Go: "#00ADD8", Rust: "#DEA584",
        "C++": "#F34B7D", C: "#555555", Ruby: "#701516",
        Swift: "#F05138", Kotlin: "#A97BFF", Dart: "#00B4AB",
        PHP: "#4F5D95", Shell: "#89E051", Scala: "#C22D40",
        Vue: "#41B883", HTML: "#E34C26", CSS: "#563D7C"
    };
    return colors[lang] || "#8B949E";
}

function trendTextOf(r) {
    if (r && r.starsToday && r.starsToday > 0) return "+" + fmtK(r.starsToday);
    return "—";
}

function extractRepoFullName(article) {
    var m = article.match(/href="\/([^\/"]+\/[^\/"]+)"[^>]*>/i);
    return m ? m[1] : "";
}

function extractDescription(article) {
    var m = article.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    return m ? cleanText(m[1]) : "";
}

function extractLanguage(article) {
    var m = article.match(/itemprop="programmingLanguage"[^>]*>([^<]+)</i);
    return m ? cleanText(m[1]) : "";
}

function extractCount(article, type) {
    // 允许链接内包含 SVG/Span 等嵌套标签
    var re = new RegExp("href=\"/[^\"]+/" + type + "\"[^>]*>([\\s\\S]*?)</a>", "i");
    var m = article.match(re);
    if (!m) return 0;
    return parseNumber(m[1]);
}

function extractTrend(article) {
    var m = article.match(/([\d,]+)\s+stars?\s+(today|this week|this month)/i);
    if (!m) return { count: 0, label: "" };
    return { count: parseNumber(m[1]), label: m[2] };
}

function parseNumber(raw) {
    if (!raw) return 0;
    var n = parseInt(String(raw).replace(/[^\d]/g, ""), 10);
    return isFinite(n) ? n : 0;
}

function cleanText(str) {
    return decodeHtml(String(str)
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim());
}

function decodeHtml(str) {
    return String(str)
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}

function loadCache(ctx) {
    try { return ctx.storage.getJSON(CACHE_KEY); } catch (e) { return null; }
}

function saveCache(ctx, data) {
    try { ctx.storage.setJSON(CACHE_KEY, data); } catch (e) { /* ignore */ }
}

function safeMsg(e) {
    if (!e) return "未知错误";
    if (typeof e === "string") return e;
    if (e.message) return e.message;
    return "未知错误";
}

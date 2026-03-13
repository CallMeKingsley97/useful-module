// Rocket Launch Countdown Widget Module
// Features: Fetch next launch, countdown calculation, caching, multi-size UI rendering

var CACHE_KEY = "rocket_launch_cache_v4";
var DEFAULT_REFRESH_MINUTES = 10;
var API_URL = "https://ll.thespacedevs.com/2.2.0/launch/upcoming/?mode=detailed&status=1";

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";
    var title = env.TITLE || "Next Launch";
    var accent = env.ACCENT_COLOR || "#22D3EE";
    var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 1, 1440);
    var refreshIntervalMs = refreshMinutes * 60 * 1000;
    var forceRefresh = isTrue(env.FORCE_REFRESH);
    var customApiUrl = env.API_URL || API_URL;

    // Load Cache
    var cached = loadCache(ctx);
    var data = null;
    var now = Date.now();
    var cacheReady = cached && cached.launch;
    var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshIntervalMs);
    var useCacheOnly = cacheFresh && !forceRefresh;
    var fetched = false;

    if (useCacheOnly) {
        data = cached;
    } else {
        try {
            var result = await fetchNextLaunch(ctx, customApiUrl);
            data = { launch: result, ts: Date.now() };
            saveCache(ctx, data);
            fetched = true;
        } catch (e) {
            console.log("Launch fetch error: " + safeMsg(e));
            if (cacheReady) {
                data = cached;
            } else {
                return errorWidget("Fetch failed", safeMsg(e));
            }
        }
    }

    var launch = data.launch;
    if (!launch) return errorWidget("No Data", "No upcoming launches found.");

    var status = fetched ? "live" : "cached";
    var nextRefresh = new Date(Date.now() + refreshIntervalMs).toISOString();

    // Mapping different sizes
    if (family === "accessoryCircular") return buildCircular(launch, accent);
    if (family === "accessoryRectangular") return buildRectangular(launch, accent);
    if (family === "accessoryInline") return buildInline(launch, accent);
    if (family === "systemSmall") return buildSmall(launch, title, accent, status, nextRefresh);
    if (family === "systemLarge") return buildLarge(launch, title, accent, status, nextRefresh);
    return buildMedium(launch, title, accent, status, nextRefresh);
}

// ============== Data Layer ==============

async function fetchNextLaunch(ctx, url) {
    var headers = {
        "User-Agent": "Egern-Widget",
        "Accept": "application/json"
    };
    // Ensure limit=5 and status=1 to filter accurately
    var paginatedUrl = url;
    if (!paginatedUrl.includes("status=")) {
        paginatedUrl += (paginatedUrl.includes("?") ? "&" : "?") + "status=1";
    }
    if (paginatedUrl.includes("limit=")) {
        paginatedUrl = paginatedUrl.replace(/limit=\d+/, "limit=5");
    } else {
        paginatedUrl += (paginatedUrl.includes("?") ? "&" : "?") + "limit=5";
    }
    var resp = await ctx.http.get(paginatedUrl, { headers: headers, timeout: 10000 });
    if (resp.status !== 200) {
        var bodyText = "";
        try { bodyText = await resp.text(); } catch (e) { }
        throw new Error("HTTP " + resp.status + ": " + (bodyText || "No body"));
    }
    var body = await resp.json();
    var results = body.results || [];
    if (results.length === 0) throw new Error("No launch results");
    
    // Find the first launch that isn't Success/Failure
    var l = results[0];
    for (var i = 0; i < results.length; i++) {
        var statusAbbr = (results[i].status ? results[i].status.abbrev : "").toUpperCase();
        if (statusAbbr !== "SUCCESS" && statusAbbr !== "FAILURE") {
            l = results[i];
            break;
        }
    }

    return {
        name: l.name || "Unknown Mission",
        net: l.net, // ISO 8601
        status: l.status ? l.status.name : "Unknown",
        statusType: l.status ? l.status.abbrev : "TBD",
        rocket: l.rocket && l.rocket.configuration ? l.rocket.configuration.full_name : "Unknown Rocket",
        pad: l.pad ? l.pad.name : "Unknown Pad",
        location: l.pad && l.pad.location ? l.pad.location.name : "Unknown Location",
        desc: l.mission ? l.mission.description : "",
        image: l.image,
        url: "https://spacelaunchnow.me/launch/" + l.id
    };
}

// ============== UI Layouts ==============

function buildSmall(l, title, accent, status, nextRefresh) {
    var cd = parseCountdown(l.net);
    var countdownText = cd.text;
    
    return shell([
        hstack([icon("rocket.fill", 14, accent), txt(title, 12, "bold", accent)], { gap: 4 }),
        sp(),
        vstack([
            txt(countdownText, 32, "bold", "#FFFFFF", { shadowColor: accent + "88", shadowRadius: 10, minScale: 0.5 }),
            txt(l.statusType, 12, "semibold", statusColor(l.statusType))
        ], { alignItems: "center", width: "100%" }),
        sp(),
        txt(l.name, 11, "medium", "rgba(255,255,255,0.7)", { maxLines: 1 }),
        footer(status)
    ], nextRefresh);
}

function buildMedium(l, title, accent, status, nextRefresh) {
    var cd = parseCountdown(l.net);
    var countdownText = cd.text;

    return shell([
        hstack([
            vstack([
                txt(countdownText, 36, "bold", "#FFFFFF", { shadowColor: accent + "88", shadowRadius: 10, minScale: 0.6 }),
                txt(l.statusType, 12, "bold", "#FFFFFF", { 
                    padding: [2, 6, 2, 6], 
                    backgroundColor: statusColor(l.statusType), 
                    borderRadius: 4,
                    minScale: 0.8
                })
            ], { gap: 6, alignItems: "center", layoutPriority: 1 }),
            sp(16),
            vstack([
                txt(l.name, 14, "bold", "#FFFFFF", { maxLines: 2, minScale: 0.8 }),
                sp(4),
                hstack([icon("info.circle", 10, "rgba(255,255,255,0.5)"), txt(l.rocket, 11, "medium", "rgba(255,255,255,0.6)", { minScale: 0.8, maxLines: 1 })], { gap: 4 }),
                hstack([icon("mappin.and.ellipse", 10, "rgba(255,255,255,0.5)"), txt(l.location, 11, "medium", "rgba(255,255,255,0.6)", { minScale: 0.8, maxLines: 1 })], { gap: 4 })
            ], { gap: 2, layoutPriority: 0 })
        ], { alignItems: "center" }),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildLarge(l, title, accent, status, nextRefresh) {
    var cd = parseCountdown(l.net);
    var countdownText = cd.text;

    return shell([
        hstack([
            icon("rocket.fill", 16, accent),
            txt(l.name, 15, "bold", "#FFFFFF", { minScale: 0.8 }),
            sp(),
            txt(l.statusType, 12, "bold", "#FFFFFF", { padding: [2, 6, 2, 6], backgroundColor: statusColor(l.statusType), borderRadius: 4 })
        ]),
        sp(12),
        vstack([
            txt(countdownText, 40, "bold", "#FFFFFF", { shadowColor: accent + "88", shadowRadius: 12, minScale: 0.5 }),
            sp(8),
            hstack([icon("info.circle.fill", 12, accent), txt(l.rocket, 13, "semibold", "rgba(255,255,255,0.8)", { minScale: 0.8 })], { gap: 6 }),
            hstack([icon("mappin.circle.fill", 12, accent), txt(l.pad, 13, "medium", "rgba(255,255,255,0.6)", { minScale: 0.8 })], { gap: 6 }),
        ], { gap: 6 }),
        sp(16),
        separator(),
        sp(12),
        txt(l.desc || "No description available.", 12, "regular", "rgba(255,255,255,0.5)", { maxLines: 4, minScale: 0.8 }),
        sp(),
        footer(status)
    ], nextRefresh);
}

function buildCircular(l, accent) {
    var cd = parseCountdown(l.net);
    var text = cd.isTBD ? "TBD" : (cd.days > 0 ? cd.days + "d" : cd.hours + "h");
    return {
        type: "widget",
        children: [
            sp(),
            icon("rocket.fill", 16, accent),
            txt(text, 12, "bold"),
            sp()
        ]
    };
}

function buildRectangular(l, accent) {
    var cd = parseCountdown(l.net);
    var text = cd.isTBD ? "TBD" : (cd.days > 0 ? cd.days + "d " + cd.hours + "h" : cd.hours + "h " + cd.mins + "m");
    return {
        type: "widget",
        children: [
            hstack([icon("rocket.fill", 10, accent), txt("Next Launch", 10, "medium", "rgba(255,255,255,0.7)")], { gap: 4 }),
            txt(text, 14, "bold"),
            txt(l.name, 10, "medium", "rgba(255,255,255,0.5)", { maxLines: 1 })
        ]
    };
}

function buildInline(l, accent) {
    var cd = parseCountdown(l.net);
    var text = cd.isTBD ? "TBD" : (cd.days > 0 ? cd.days + "d " + cd.hours + "h" : cd.hours + "h " + cd.mins + "m");
    return {
        type: "widget",
        children: [
            icon("rocket.fill", 12, accent),
            txt(" T-" + text + " " + (l.name.split('|')[0].trim()), 12, "medium")
        ]
    };
}

// ============== UI Components ==============

function shell(children, nextRefresh) {
    return {
        type: "widget",
        padding: [16, 16, 16, 16],
        backgroundGradient: {
            type: "linear",
            colors: ["#0B0E14", "#1A1F2B"],
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
        txt(isLive ? "LIVE" : "CACHED", 8, "bold", isLive ? "#10B98166" : "#F59E0B66")
    ], { gap: 4 });
}

function separator() {
    return { type: "stack", height: 1, backgroundColor: "rgba(255,255,255,0.1)", children: [] };
}

function errorWidget(title, msg) {
    return {
        type: "widget",
        padding: 16,
        backgroundColor: "#0B0E14",
        children: [
            txt(title, "headline", "bold", "#EF4444"),
            sp(8),
            txt(msg, "caption1", "regular", "rgba(255,255,255,0.6)", { maxLines: 5 })
        ]
    };
}

// ============== Helper Functions ==============

function parseCountdown(netStr) {
    if (!netStr) return { isTBD: true, text: "TBD" };
    var net = new Date(netStr).getTime();
    var now = Date.now();
    var diff = net - now;
    
    if (diff <= 0) {
        return { isTBD: false, days: 0, hours: 0, mins: 0, text: "LIFT OFF" };
    }
    
    var days = Math.floor(diff / (1000 * 60 * 60 * 24));
    var hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    var mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    var text = "";
    if (days > 0) {
        text = days + "d " + hours + "h";
    } else {
        text = hours + ":" + String(mins).padStart(2, '0');
    }
    
    return { isTBD: false, days: days, hours: hours, mins: mins, text: text };
}

function statusColor(abbrev) {
    if (!abbrev) return "#94A3B8";
    var a = abbrev.toUpperCase();
    if (a === "GO") return "#10B981";
    if (a === "TBD" || a === "TBC") return "#F59E0B";
    if (a === "SUCCESS") return "#10B981";
    if (a === "FAILURE") return "#EF4444";
    if (a === "HOLD") return "#F43F5E";
    return "#94A3B8";
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
    return Math.min(Math.max(n, min), max);
}

function isTrue(val) {
    var v = String(val || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "on";
}

function loadCache(ctx) {
    try { return ctx.storage.getJSON(CACHE_KEY); } catch (e) { return null; }
}

function saveCache(ctx, data) {
    try { ctx.storage.setJSON(CACHE_KEY, data); } catch (e) { }
}

function safeMsg(e) {
    return (e && e.message) ? e.message : String(e);
}

var STORAGE_KEY = "ninebot_checkin_v2";
var STATUS_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/status";
var SIGN_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/sign";

var DEFAULT_TITLE = "Ninebot 签到";
var DEFAULT_OPEN_URL = "https://h5-bj.ninebot.com/";
var DEFAULT_TIMEOUT_MS = 15000;
var DEFAULT_REFRESH_MINUTES = 30;
var DEFAULT_ACCENT_COLOR = "#34D399";
var DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Segway v6 C 609033420";

export default async function (ctx) {
    if (ctx && ctx.cron) {
        return await runScheduledCheckin(ctx);
    }
    return await renderWidget(ctx || {});
}

async function runScheduledCheckin(ctx) {
    var config = readConfig(ctx);
    var result;

    try {
        ensureRequiredConfig(config);
        result = await executeCheckinFlow(ctx, config, "schedule");
    } catch (e) {
        result = createFailureRecord(config, "schedule", safeMsg(e), null);
        saveRecord(ctx, result);
    }

    await maybeNotify(ctx, config, result);
    return result;
}

async function renderWidget(ctx) {
    var config = readConfig(ctx);
    var family = ctx.widgetFamily || "systemMedium";
    var record = loadRecord(ctx);

    try {
        ensureRequiredConfig(config);
    } catch (e) {
        return buildWidget(buildViewModel(createConfigErrorRecord(config, safeMsg(e)), config), family);
    }

    if (!record) {
        record = createPendingRecord(config);
    }

    return buildWidget(buildViewModel(record, config), family);
}

async function executeCheckinFlow(ctx, config, source) {
    var cached = loadRecord(ctx);
    if (!config.forceCheckin && isSuccessfulToday(cached)) {
        return cached;
    }

    var statusBefore = await fetchStatus(ctx, config);
    if (!resultOk(statusBefore)) {
        var precheckFailure = createFailureRecord(config, source, extractMessage(statusBefore) || "获取签到状态失败", {
            statusBefore: statusBefore
        });
        saveRecord(ctx, precheckFailure);
        return precheckFailure;
    }

    var statusData = ensureObject(statusBefore.data);
    if (toInt(statusData.currentSignStatus) === 1) {
        var alreadyRecord = createRecord({
            dateKey: todayKey(),
            status: "already_signed",
            title: "今日已签到",
            message: buildAlreadySignedMessage(statusData),
            consecutiveDays: toIntOrNull(statusData.consecutiveDays),
            checkedAt: nowIso(),
            source: source,
            lastError: "",
            raw: {
                statusBefore: statusBefore
            }
        });
        saveRecord(ctx, alreadyRecord);
        return alreadyRecord;
    }

    var signPayload = await postSign(ctx, config);
    if (!resultOk(signPayload)) {
        var signFailure = createFailureRecord(config, source, extractMessage(signPayload) || "签到失败", {
            statusBefore: statusBefore,
            sign: signPayload
        });
        saveRecord(ctx, signFailure);
        return signFailure;
    }

    var statusAfter = null;
    var refreshError = "";
    try {
        statusAfter = await fetchStatus(ctx, config);
        if (!resultOk(statusAfter)) {
            refreshError = extractMessage(statusAfter) || "签到成功，但刷新状态失败";
        }
    } catch (e2) {
        refreshError = safeMsg(e2);
    }

    var statusAfterData = resultOk(statusAfter) ? ensureObject(statusAfter.data) : {};
    var successRecord = createRecord({
        dateKey: todayKey(),
        status: "success",
        title: "签到成功",
        message: buildSuccessMessage(signPayload, statusAfterData, refreshError),
        consecutiveDays: pickFirstNumber([
            toIntOrNull(statusAfterData.consecutiveDays),
            toIntOrNull(statusData.consecutiveDays)
        ]),
        checkedAt: nowIso(),
        source: source,
        lastError: refreshError,
        raw: {
            statusBefore: statusBefore,
            sign: signPayload,
            statusAfter: statusAfter
        }
    });

    saveRecord(ctx, successRecord);
    return successRecord;
}

async function fetchStatus(ctx, config) {
    return await requestJson(ctx, "GET", STATUS_URL + "?t=" + Date.now(), null, buildHeaders(config), config.timeoutMs);
}

async function postSign(ctx, config) {
    return await requestJson(ctx, "POST", SIGN_URL, {
        deviceId: config.deviceId
    }, buildHeaders(config), config.timeoutMs);
}

async function requestJson(ctx, method, url, body, headers, timeoutMs) {
    var maxAttempts = 3;
    var lastError = null;

    for (var attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            var response = method === "GET"
                ? await ctx.http.get(url, {
                    headers: headers,
                    timeout: timeoutMs
                })
                : await ctx.http.post(url, {
                    headers: headers,
                    body: body,
                    timeout: timeoutMs
                });

            var text = await response.text();
            var data = parseJson(text);

            if (!response || response.status !== 200) {
                throw new Error(extractMessage(data) || ("HTTP " + (response ? response.status : "--")));
            }

            return data;
        } catch (e) {
            lastError = e;
            if (attempt >= maxAttempts) break;
            await delay(attempt * 1200);
        }
    }

    throw new Error("请求 Ninebot 接口失败：" + safeMsg(lastError));
}

function readConfig(ctx) {
    var env = (ctx && ctx.env) || {};
    return {
        title: trim(env.TITLE) || DEFAULT_TITLE,
        authorization: trim(env.AUTHORIZATION) || trim(env.NINEBOT_AUTHORIZATION),
        deviceId: trim(env.DEVICE_ID) || trim(env.NINEBOT_DEVICE_ID),
        openUrl: trim(env.OPEN_URL) || DEFAULT_OPEN_URL,
        timeoutMs: clampInt(env.TIMEOUT_MS, 3000, 60000, DEFAULT_TIMEOUT_MS),
        refreshMinutes: clampInt(env.REFRESH_MINUTES, 5, 1440, DEFAULT_REFRESH_MINUTES),
        accentColor: trim(env.ACCENT_COLOR) || DEFAULT_ACCENT_COLOR,
        language: trim(env.LANGUAGE) || "zh",
        userAgent: trim(env.USER_AGENT) || DEFAULT_USER_AGENT,
        notifyOnSuccess: isTrue(env.NOTIFY_ON_SUCCESS),
        notifyOnFailure: isTrue(env.NOTIFY_ON_FAILURE),
        forceCheckin: isTrue(env.FORCE_CHECKIN)
    };
}

function ensureRequiredConfig(config) {
    var missing = [];
    if (!config.authorization) missing.push("AUTHORIZATION");
    if (!config.deviceId) missing.push("DEVICE_ID");
    if (missing.length) {
        throw new Error("请设置 " + missing.join(" / "));
    }
}

function buildHeaders(config) {
    return {
        Accept: "application/json, text/plain, */*",
        Authorization: config.authorization,
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "zh-CN,zh-Hans;q=0.9",
        "Content-Type": "application/json",
        Host: "cn-cbu-gateway.ninebot.com",
        Origin: "https://h5-bj.ninebot.com",
        Referer: "https://h5-bj.ninebot.com/",
        from_platform_1: "1",
        language: config.language,
        device_id: config.deviceId,
        deviceId: config.deviceId,
        "User-Agent": config.userAgent
    };
}

async function maybeNotify(ctx, config, record) {
    if (!ctx || typeof ctx.notify !== "function" || !record) return;

    var shouldNotify = false;
    if (record.status === "success" || record.status === "already_signed") {
        shouldNotify = !!config.notifyOnSuccess;
    } else if (record.status === "failed") {
        shouldNotify = !!config.notifyOnFailure;
    }

    if (!shouldNotify) return;

    var body = record.message || record.title || "Ninebot 签到任务已执行";
    var options = {
        title: config.title,
        subtitle: record.title || statusText(record.status),
        body: body,
        sound: true,
        duration: 6
    };

    if (config.openUrl) {
        options.action = {
            type: "openUrl",
            url: config.openUrl
        };
    }

    try {
        await ctx.notify(options);
    } catch (_) {
    }
}

function loadRecord(ctx) {
    try {
        var raw = ctx && ctx.storage && typeof ctx.storage.getJSON === "function"
            ? ctx.storage.getJSON(STORAGE_KEY)
            : null;
        return raw ? createRecord(raw) : null;
    } catch (_) {
        return null;
    }
}

function saveRecord(ctx, record) {
    if (!ctx || !ctx.storage || typeof ctx.storage.setJSON !== "function") return;
    ctx.storage.setJSON(STORAGE_KEY, createRecord(record));
}

function createRecord(input) {
    var data = ensureObject(input);
    return {
        dateKey: trim(data.dateKey) || todayKey(),
        status: trim(data.status) || "pending",
        title: trim(data.title) || statusText(data.status),
        message: trim(data.message),
        consecutiveDays: toIntOrNull(data.consecutiveDays),
        checkedAt: trim(data.checkedAt) || nowIso(),
        source: trim(data.source),
        lastError: trim(data.lastError),
        raw: data.raw || null
    };
}

function createPendingRecord(config) {
    return createRecord({
        dateKey: todayKey(),
        status: "pending",
        title: "等待签到",
        message: "等待今日 09:00 自动执行签到",
        consecutiveDays: null,
        checkedAt: nowIso(),
        source: "widget",
        lastError: "",
        raw: null
    });
}

function createConfigErrorRecord(config, message) {
    return createRecord({
        dateKey: todayKey(),
        status: "failed",
        title: "配置缺失",
        message: message || "缺少签到配置",
        consecutiveDays: null,
        checkedAt: nowIso(),
        source: "widget",
        lastError: message || "",
        raw: null
    });
}

function createFailureRecord(config, source, message, raw) {
    return createRecord({
        dateKey: todayKey(),
        status: "failed",
        title: "签到失败",
        message: message || "未知错误",
        consecutiveDays: null,
        checkedAt: nowIso(),
        source: source || "schedule",
        lastError: message || "未知错误",
        raw: raw || null
    });
}

function isSuccessfulToday(record) {
    return !!record
        && record.dateKey === todayKey()
        && (record.status === "success" || record.status === "already_signed");
}

function buildViewModel(record, config) {
    var theme = resolveTheme(config.accentColor);
    var currentKey = todayKey();
    var isToday = record && record.dateKey === currentKey;
    var primary = "等待签到";
    var secondary = "等待今日 09:00 自动执行签到";
    var badge = "待执行";
    var symbol = "sf-symbol:clock.badge.questionmark.fill";
    var statusColor = "#FBBF24";
    var statusBg = "rgba(251,191,36,0.16)";

    if (record.status === "success" || record.status === "already_signed") {
        primary = "今日已签到";
        secondary = record.message || buildAlreadySignedMessage(record);
        badge = "成功";
        symbol = "sf-symbol:checkmark.seal.fill";
        statusColor = config.accentColor;
        statusBg = "rgba(52,211,153,0.16)";
    } else if (record.status === "failed") {
        primary = isToday ? "签到失败" : "上次签到失败";
        secondary = record.message || record.lastError || "未知错误";
        badge = "失败";
        symbol = "sf-symbol:exclamationmark.triangle.fill";
        statusColor = "#FB923C";
        statusBg = "rgba(251,146,60,0.16)";
    } else if (!isToday) {
        primary = "今日未执行";
        secondary = record.checkedAt
            ? "上次：" + formatMonthDayTime(record.checkedAt) + " · " + (record.title || statusText(record.status))
            : "等待今日 09:00 自动执行签到";
        badge = "等待";
        symbol = "sf-symbol:clock.fill";
        statusColor = "#60A5FA";
        statusBg = "rgba(96,165,250,0.16)";
    }

    if ((record.status === "success" || record.status === "already_signed") && !isToday) {
        primary = "今日未执行";
        secondary = record.checkedAt
            ? "上次：" + formatMonthDayTime(record.checkedAt) + " · 已签到"
            : "等待今日 09:00 自动执行签到";
        badge = "等待";
        symbol = "sf-symbol:clock.fill";
        statusColor = "#60A5FA";
        statusBg = "rgba(96,165,250,0.16)";
    }

    return {
        title: config.title,
        badge: badge,
        primary: primary,
        secondary: secondary,
        symbol: symbol,
        statusColor: statusColor,
        statusBg: statusBg,
        theme: theme,
        streakText: record.consecutiveDays ? ("连续 " + record.consecutiveDays + " 天") : "连续天数 --",
        updatedText: record.checkedAt ? formatMonthDayTime(record.checkedAt) : "--",
        footerText: isToday ? "今日 09:00 定时签到" : "等待今日 09:00 自动签到",
        openUrl: config.openUrl,
        refreshAfter: new Date(Date.now() + config.refreshMinutes * 60000).toISOString(),
        isToday: isToday,
        status: record.status
    };
}

function buildWidget(vm, family) {
    if (family === "accessoryInline") return buildInline(vm);
    if (family === "accessoryCircular") return buildCircular(vm);
    if (family === "accessoryRectangular") return buildRectangular(vm);
    if (family === "systemSmall") return buildSmall(vm);
    if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(vm);
    return buildMedium(vm);
}

function buildInline(vm) {
    return {
        type: "widget",
        url: vm.openUrl,
        refreshAfter: vm.refreshAfter,
        children: [
            {
                type: "text",
                text: buildInlineText(vm),
                font: { size: 13, weight: "semibold" },
                textColor: vm.statusColor
            }
        ]
    };
}

function buildCircular(vm) {
    return shell([
        spacer(),
        centeredColumn([
            image(vm.symbol, 24, vm.statusColor),
            spacer(4),
            text(vm.status === "failed" ? "失败" : (vm.isToday ? "已签" : "等待"), 12, "bold", "#FFFFFF"),
            spacer(2),
            text(compactStreak(vm.streakText), 10, "medium", vm.theme.muted)
        ]),
        spacer()
    ], vm, [12, 12, 12, 12]);
}

function buildRectangular(vm) {
    return shell([
        row([
            text(vm.title, 12, "bold", "#FFFFFF", { flex: 1, maxLines: 1 }),
            badge(vm.badge, vm.statusColor, vm.statusBg)
        ], { alignItems: "center", gap: 6 }),
        spacer(8),
        row([
            image(vm.symbol, 18, vm.statusColor),
            text(vm.primary, 14, "bold", "#FFFFFF", { flex: 1, maxLines: 1 })
        ], { alignItems: "center", gap: 8 }),
        spacer(4),
        text(vm.secondary, 11, "medium", vm.theme.muted, { maxLines: 2 }),
        spacer(),
        text(vm.streakText + " · " + shortUpdated(vm.updatedText), 10, "medium", vm.theme.subtle, { maxLines: 1 })
    ], vm, [12, 12, 12, 12]);
}

function buildSmall(vm) {
    return shell([
        row([
            text(vm.title, 13, "bold", "#FFFFFF", { flex: 1, maxLines: 1 }),
            badge(vm.badge, vm.statusColor, vm.statusBg)
        ], { alignItems: "center", gap: 8 }),
        spacer(10),
        row([
            image(vm.symbol, 22, vm.statusColor),
            column([
                text(vm.primary, 18, "bold", "#FFFFFF", { maxLines: 1 }),
                spacer(2),
                text(vm.secondary, 11, "medium", vm.theme.muted, { maxLines: 3 })
            ], { flex: 1, gap: 0 })
        ], { alignItems: "start", gap: 10 }),
        spacer(),
        statBlock("连续签到", vm.streakText, vm.theme),
        spacer(8),
        footer(vm)
    ], vm, [14, 14, 14, 14]);
}

function buildMedium(vm) {
    return shell([
        row([
            column([
                text(vm.title, 15, "bold", "#FFFFFF", { maxLines: 1 }),
                spacer(2),
                text(vm.footerText, 10, "medium", vm.theme.subtle, { maxLines: 1 })
            ], { flex: 1, gap: 0 }),
            badge(vm.badge, vm.statusColor, vm.statusBg)
        ], { alignItems: "start", gap: 10 }),
        spacer(12),
        row([
            card([
                image(vm.symbol, 22, vm.statusColor),
                spacer(8),
                text(vm.primary, 18, "bold", "#FFFFFF", { maxLines: 1 }),
                spacer(4),
                text(vm.secondary, 11, "medium", vm.theme.muted, { maxLines: 4 })
            ], vm.theme, { flex: 2 }),
            card([
                statBlock("连续签到", vm.streakText, vm.theme),
                spacer(10),
                statBlock("最近执行", shortUpdated(vm.updatedText), vm.theme)
            ], vm.theme, { flex: 1 })
        ], { gap: 10, alignItems: "stretch" }),
        spacer(),
        footer(vm)
    ], vm, [14, 14, 14, 14]);
}

function buildLarge(vm) {
    return shell([
        row([
            column([
                text(vm.title, 16, "bold", "#FFFFFF", { maxLines: 1 }),
                spacer(2),
                text("每日 09:00 自动签到", 11, "medium", vm.theme.subtle)
            ], { flex: 1, gap: 0 }),
            badge(vm.badge, vm.statusColor, vm.statusBg)
        ], { alignItems: "center", gap: 10 }),
        spacer(12),
        card([
            row([
                image(vm.symbol, 24, vm.statusColor),
                column([
                    text(vm.primary, 20, "bold", "#FFFFFF", { maxLines: 1 }),
                    spacer(4),
                    text(vm.secondary, 12, "medium", vm.theme.muted, { maxLines: 4 })
                ], { flex: 1, gap: 0 })
            ], { gap: 10, alignItems: "start" })
        ], vm.theme),
        spacer(10),
        row([
            card([statBlock("连续签到", vm.streakText, vm.theme)], vm.theme, { flex: 1 }),
            card([statBlock("最近执行", shortUpdated(vm.updatedText), vm.theme)], vm.theme, { flex: 1 }),
            card([statBlock("状态", vm.isToday ? vm.badge : "等待", vm.theme)], vm.theme, { flex: 1 })
        ], { gap: 10, alignItems: "stretch" }),
        spacer(),
        footer(vm)
    ], vm, [16, 16, 16, 16]);
}

function shell(children, vm, padding) {
    return {
        type: "widget",
        url: vm.openUrl,
        refreshAfter: vm.refreshAfter,
        padding: padding || 14,
        gap: 0,
        backgroundGradient: {
            type: "linear",
            colors: vm.theme.gradient,
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        children: children
    };
}

function footer(vm) {
    return row([
        text(vm.footerText, 10, "medium", vm.theme.subtle, { flex: 1, maxLines: 1 }),
        text(shortUpdated(vm.updatedText), 10, "medium", vm.theme.subtle, { maxLines: 1 })
    ], { alignItems: "center", gap: 8 });
}

function statBlock(label, value, theme) {
    return column([
        text(label, 10, "medium", theme.subtle, { maxLines: 1 }),
        spacer(4),
        text(value, 13, "bold", "#FFFFFF", { maxLines: 2 })
    ], { gap: 0, alignItems: "start" });
}

function card(children, theme, extra) {
    var options = extra || {};
    return {
        type: "stack",
        direction: "column",
        gap: 0,
        padding: 12,
        borderRadius: 14,
        backgroundColor: theme.panel,
        borderWidth: 1,
        borderColor: theme.line,
        flex: options.flex || 0,
        children: children
    };
}

function badge(textValue, color, backgroundColor) {
    return {
        type: "stack",
        direction: "row",
        padding: [4, 8, 4, 8],
        borderRadius: 999,
        backgroundColor: backgroundColor,
        children: [
            text(textValue, 10, "bold", color, { maxLines: 1 })
        ]
    };
}

function row(children, options) {
    options = options || {};
    return {
        type: "stack",
        direction: "row",
        gap: options.gap || 0,
        alignItems: options.alignItems || "center",
        flex: options.flex || 0,
        children: children
    };
}

function column(children, options) {
    options = options || {};
    return {
        type: "stack",
        direction: "column",
        gap: options.gap || 0,
        alignItems: options.alignItems || "start",
        flex: options.flex || 0,
        children: children
    };
}

function centeredColumn(children) {
    return {
        type: "stack",
        direction: "column",
        gap: 0,
        alignItems: "center",
        children: children
    };
}

function text(value, size, weight, color, extra) {
    var node = {
        type: "text",
        text: String(value == null ? "" : value),
        font: {
            size: size,
            weight: weight || "regular"
        },
        textColor: color || "#FFFFFF"
    };

    extra = extra || {};
    var keys = Object.keys(extra);
    for (var i = 0; i < keys.length; i++) {
        node[keys[i]] = extra[keys[i]];
    }
    return node;
}

function image(src, size, color) {
    return {
        type: "image",
        src: src,
        width: size,
        height: size,
        color: color
    };
}

function spacer(value) {
    if (value == null) return { type: "spacer" };
    return { type: "spacer", length: value };
}

function resolveTheme(accent) {
    return {
        accent: accent,
        gradient: ["#09111F", "#0F172A", "#1B263B"],
        panel: "rgba(255,255,255,0.06)",
        text: "#FFFFFF",
        muted: "rgba(255,255,255,0.78)",
        subtle: "rgba(255,255,255,0.50)",
        line: "rgba(255,255,255,0.08)"
    };
}

function buildInlineText(vm) {
    if (vm.status === "failed" && vm.isToday) {
        return clipText(vm.title + " 失败: " + vm.secondary, 28);
    }
    if (vm.isToday && (vm.status === "success" || vm.status === "already_signed")) {
        return clipText(vm.title + " 已签到 · " + compactStreak(vm.streakText), 28);
    }
    return clipText(vm.title + " 等待 09:00 自动签到", 28);
}

function buildAlreadySignedMessage(data) {
    var days = pickFirstNumber([
        toIntOrNull(data && data.consecutiveDays),
        toIntOrNull(data && data.continuousDays)
    ]);
    if (days) return "服务器显示今日已签到，连续 " + days + " 天";
    return "服务器显示今日已完成签到";
}

function buildSuccessMessage(signPayload, statusAfterData, refreshError) {
    var parts = [];
    var days = pickFirstNumber([
        toIntOrNull(statusAfterData && statusAfterData.consecutiveDays),
        toIntOrNull(statusAfterData && statusAfterData.continuousDays)
    ]);
    var reward = extractRewardText(signPayload);

    if (days) {
        parts.push("连续签到 " + days + " 天");
    }
    if (reward) {
        parts.push(reward);
    }
    if (!parts.length) {
        parts.push("服务器已确认今日签到成功");
    }
    if (refreshError) {
        parts.push("状态刷新提示：" + refreshError);
    }
    return parts.join(" · ");
}

function extractRewardText(payload) {
    var data = ensureObject(payload && payload.data);
    var candidates = [
        trim(data.rewardDesc),
        trim(data.rewardName),
        trim(data.reward),
        trim(data.awardDesc),
        trim(data.prizeName)
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i]) return candidates[i];
    }

    var score = pickFirstNumber([
        toIntOrNull(data.integral),
        toIntOrNull(data.points),
        toIntOrNull(data.score),
        toIntOrNull(data.growthValue)
    ]);
    if (score) return "奖励 " + score;
    return "";
}

function resultOk(payload) {
    return Number(payload && payload.code) === 0;
}

function extractMessage(payload) {
    if (!payload) return "";
    return trim(payload.msg) || trim(payload.message) || trim(payload.errorMsg) || trim(payload.error_message);
}

function parseJson(text) {
    if (!text) return {};
    try {
        return JSON.parse(text);
    } catch (_) {
        throw new Error("接口返回不是有效 JSON");
    }
}

function ensureObject(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function trim(value) {
    return String(value == null ? "" : value).trim();
}

function isTrue(value) {
    var normalized = trim(value).toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function clampInt(value, min, max, fallback) {
    var num = parseInt(value, 10);
    if (!isFinite(num)) return fallback;
    if (num < min) return min;
    if (num > max) return max;
    return num;
}

function toInt(value) {
    var num = parseInt(value, 10);
    return isFinite(num) ? num : 0;
}

function toIntOrNull(value) {
    var num = parseInt(value, 10);
    return isFinite(num) ? num : null;
}

function pickFirstNumber(values) {
    for (var i = 0; i < values.length; i++) {
        if (typeof values[i] === "number" && isFinite(values[i])) return values[i];
    }
    return null;
}

function safeMsg(error) {
    if (!error) return "未知错误";
    if (typeof error === "string") return error;
    if (error instanceof Error) return trim(error.message) || "未知错误";
    if (typeof error.message === "string") return trim(error.message) || "未知错误";
    return trim(String(error)) || "未知错误";
}

function nowIso() {
    return new Date().toISOString();
}

function todayKey() {
    var now = new Date();
    return now.getFullYear() + "-" + pad2(now.getMonth() + 1) + "-" + pad2(now.getDate());
}

function formatMonthDayTime(iso) {
    var date = new Date(iso);
    if (isNaN(date.getTime())) return "--";
    return pad2(date.getMonth() + 1) + "-" + pad2(date.getDate()) + " " + pad2(date.getHours()) + ":" + pad2(date.getMinutes());
}

function shortUpdated(value) {
    return clipText(value || "--", 18);
}

function compactStreak(textValue) {
    return clipText(String(textValue || "--").replace("连续 ", "连签").replace(" 天", "天"), 10);
}

function clipText(value, maxLength) {
    var textValue = String(value == null ? "" : value);
    if (textValue.length <= maxLength) return textValue;
    return textValue.slice(0, Math.max(0, maxLength - 1)) + "…";
}

function statusText(status) {
    if (status === "success") return "签到成功";
    if (status === "already_signed") return "今日已签到";
    if (status === "failed") return "签到失败";
    return "等待签到";
}

function pad2(value) {
    return value < 10 ? "0" + value : String(value);
}

function delay(ms) {
    return new Promise(function (resolve) {
        setTimeout(resolve, ms);
    });
}

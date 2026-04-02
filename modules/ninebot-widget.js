var STORAGE_KEY = "ninebot_checkin_v2";
var STATUS_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/status";
var SIGN_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/sign";

var DEFAULT_TITLE = "Ninebot 签到";
var DEFAULT_OPEN_URL = "https://h5-bj.ninebot.com/";
var DEFAULT_TIMEOUT_MS = 15000;
var DEFAULT_REFRESH_MINUTES = 30;
var DEFAULT_ACCENT_COLOR = "#34D399";
var DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Segway v6 C 609033420";
var DEFAULT_DAILY_CRON = "0 9 * * *";
var DEFAULT_MANUAL_CHECKIN_SCRIPT = "ninebot-checkin-manual";
var DEFAULT_MANUAL_STATUS_SCRIPT = "ninebot-checkin-query";

export default async function (ctx) {
    if (ctx && ctx.cron) {
        return await runScheduledAction(ctx);
    }
    return await renderWidget(ctx || {});
}

async function runScheduledAction(ctx) {
    var config = readConfig(ctx);
    var result;
    var source = trim(ctx && ctx.script && ctx.script.name) || (config.action === "status" ? "manual-query" : "schedule");

    try {
        ensureRequiredConfig(config);
        if (config.action === "status") {
            result = await executeStatusQuery(ctx, config, source);
        } else {
            result = await executeCheckinFlow(ctx, config, source);
        }
    } catch (e) {
        result = createFailureRecord(config, source, safeMsg(e), null);
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
            consecutiveDays: pickFirstNumber([
                toIntOrNull(statusData.consecutiveDays),
                toIntOrNull(statusData.continuousDays)
            ]),
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
            toIntOrNull(statusAfterData.continuousDays),
            toIntOrNull(statusData.consecutiveDays),
            toIntOrNull(statusData.continuousDays)
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

async function executeStatusQuery(ctx, config, source) {
    var statusPayload = await fetchStatus(ctx, config);
    if (!resultOk(statusPayload)) {
        var queryFailure = createFailureRecord(config, source, extractMessage(statusPayload) || "查询签到状态失败", {
            status: statusPayload
        });
        saveRecord(ctx, queryFailure);
        return queryFailure;
    }

    var statusData = ensureObject(statusPayload.data);
    var signed = toInt(statusData.currentSignStatus) === 1;
    var record = createRecord({
        dateKey: todayKey(),
        status: signed ? "already_signed" : "not_signed",
        title: signed ? "今日已签到" : "今日未签到",
        message: signed ? buildAlreadySignedMessage(statusData) : buildNotSignedMessage(statusData),
        consecutiveDays: pickFirstNumber([
            toIntOrNull(statusData.consecutiveDays),
            toIntOrNull(statusData.continuousDays)
        ]),
        checkedAt: nowIso(),
        source: source,
        lastError: "",
        raw: {
            status: statusPayload
        }
    });

    saveRecord(ctx, record);
    return record;
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
        forceCheckin: isTrue(env.FORCE_CHECKIN),
        action: normalizeAction(env.ACTION),
        dailyCronText: trim(env.DAILY_CRON_TEXT) || DEFAULT_DAILY_CRON,
        manualCheckinScriptName: trim(env.MANUAL_CHECKIN_SCRIPT_NAME) || DEFAULT_MANUAL_CHECKIN_SCRIPT,
        manualStatusScriptName: trim(env.MANUAL_STATUS_SCRIPT_NAME) || DEFAULT_MANUAL_STATUS_SCRIPT
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
    var statusColor = "#FBBF24";
    var symbol = "sf-symbol:clock.badge.questionmark.fill";
    var footerText = "等待今日 09:00 自动签到";

    if (record.status === "success" || record.status === "already_signed") {
        primary = "今日已签到";
        secondary = record.message || buildAlreadySignedMessage(record);
        statusColor = config.accentColor;
        symbol = "sf-symbol:checkmark.seal.fill";
        footerText = "今日签到结果已写入缓存";
    } else if (record.status === "failed") {
        primary = isToday ? "签到失败" : "上次签到失败";
        secondary = record.message || record.lastError || "未知错误";
        statusColor = "#FB923C";
        symbol = "sf-symbol:exclamationmark.triangle.fill";
        footerText = "可手动运行签到脚本重试";
    } else if (record.status === "not_signed") {
        primary = "今日未签到";
        secondary = record.message || "服务器显示今日尚未签到";
        statusColor = "#FBBF24";
        symbol = "sf-symbol:xmark.seal.fill";
        footerText = "可手动运行签到脚本立即补签";
    } else if (!isToday) {
        primary = "今日未执行";
        secondary = record.checkedAt
            ? "上次：" + formatMonthDayTime(record.checkedAt) + " · " + (record.title || statusText(record.status))
            : "等待今日 09:00 自动执行签到";
        statusColor = "#60A5FA";
        symbol = "sf-symbol:clock.fill";
        footerText = "等待今日 09:00 自动签到";
    }

    if ((record.status === "success" || record.status === "already_signed") && !isToday) {
        primary = "今日未执行";
        secondary = record.checkedAt
            ? "上次：" + formatMonthDayTime(record.checkedAt) + " · 已签到"
            : "等待今日 09:00 自动执行签到";
        statusColor = "#60A5FA";
        symbol = "sf-symbol:clock.fill";
        footerText = "等待今日 09:00 自动签到";
    }

    return {
        title: config.title,
        primary: primary,
        secondary: secondary,
        symbol: symbol,
        statusColor: statusColor,
        theme: theme,
        streakText: record.consecutiveDays ? ("连续 " + record.consecutiveDays + " 天") : "连续天数 --",
        updatedText: record.checkedAt ? formatMonthDayTime(record.checkedAt) : "--",
        footerText: footerText,
        openUrl: config.openUrl,
        refreshAfter: new Date(Date.now() + config.refreshMinutes * 60000).toISOString(),
        isToday: isToday,
        status: record.status,
        scheduleText: "每天 " + config.dailyCronText,
        manualCheckinText: "工具→脚本：运行 " + config.manualCheckinScriptName,
        manualStatusText: "工具→脚本：运行 " + config.manualStatusScriptName
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
            image(vm.symbol, 24, vm.statusColor, { shadowColor: vm.theme.iconGlow, shadowRadius: 8 }),
            spacer(4),
            text(resolveCompactStatus(vm), 12, "bold", vm.theme.text, { shadowColor: vm.theme.titleShadow, shadowRadius: 6 }),
            spacer(2),
            text(compactStreak(vm.streakText), 10, "medium", vm.theme.muted)
        ]),
        spacer()
    ], vm, [12, 12, 12, 12]);
}

function buildRectangular(vm) {
    return shell([
        text(vm.title, 12, "bold", vm.theme.text, { maxLines: 1, shadowColor: vm.theme.titleShadow, shadowRadius: 5 }),
        spacer(4),
        separator(vm.theme),
        spacer(6),
        infoRow("状态", vm.primary, vm.theme, { valueColor: vm.statusColor, valueWeight: "bold", maxLines: 1 }),
        spacer(4),
        infoRow("结果", vm.secondary, vm.theme, { maxLines: 2 }),
        spacer(4),
        infoRow("最近", vm.updatedText, vm.theme, { maxLines: 1 })
    ], vm, [12, 12, 12, 12]);
}

function buildSmall(vm) {
    return shell([
        text(vm.title, 12, "bold", vm.theme.text, { maxLines: 1, minScale: 0.78, shadowColor: vm.theme.titleShadow, shadowRadius: 5 }),
        spacer(6),
        row([
            image(vm.symbol, 15, vm.statusColor, { shadowColor: vm.theme.iconGlow, shadowRadius: 6 }),
            text(vm.primary, 13, "bold", vm.statusColor, { flex: 1, maxLines: 1, minScale: 0.78, shadowColor: vm.theme.titleShadow, shadowRadius: 4 })
        ], { alignItems: "center", gap: 6 }),
        spacer(6),
        text(compactSecondary(vm, 34), 11, "medium", vm.theme.text, { maxLines: 2, minScale: 0.78 }),
        spacer(6),
        text(buildSmallMetaText(vm), 10, "medium", vm.theme.muted, { maxLines: 1, minScale: 0.8 }),
        spacer(),
        text(buildCompactFooterText(vm, "small"), 10, "medium", vm.theme.footer, { maxLines: 1, minScale: 0.8 })
    ], vm, [12, 12, 12, 12]);
}

function buildMedium(vm) {
    return shell([
        text(vm.title, 15, "bold", vm.theme.text, { maxLines: 1, minScale: 0.78, shadowColor: vm.theme.titleShadow, shadowRadius: 6 }),
        spacer(4),
        separator(vm.theme),
        spacer(6),
        infoRow("状态", vm.primary, vm.theme, {
            labelWidth: 32,
            valueColor: vm.statusColor,
            valueWeight: "bold",
            valueSize: 13,
            maxLines: 1,
            minScale: 0.76
        }),
        spacer(4),
        infoRow("结果", compactSecondary(vm, 48), vm.theme, {
            labelWidth: 32,
            valueSize: 11,
            maxLines: 2,
            minScale: 0.78
        }),
        spacer(4),
        infoRow("连签", compactStreak(vm.streakText), vm.theme, {
            labelWidth: 32,
            valueSize: 11,
            maxLines: 1,
            minScale: 0.8
        }),
        spacer(4),
        infoRow("最近", vm.updatedText, vm.theme, {
            labelWidth: 32,
            valueSize: 11,
            maxLines: 1,
            minScale: 0.82
        })
    ], vm, [14, 14, 14, 14]);
}

function buildLarge(vm) {
    return shell([
        text(vm.title, 16, "bold", vm.theme.text, { maxLines: 1, shadowColor: vm.theme.titleShadow, shadowRadius: 6 }),
        spacer(2),
        spacer(8),
        separator(vm.theme),
        spacer(10),
        infoRow("状态", vm.primary, vm.theme, { valueColor: vm.statusColor, valueWeight: "bold", maxLines: 1 }),
        spacer(6),
        infoRow("结果", vm.secondary, vm.theme, { maxLines: 4 }),
        spacer(6),
        infoRow("连签", vm.streakText, vm.theme, { maxLines: 1 }),
        spacer(6),
        infoRow("最近", vm.updatedText, vm.theme, { maxLines: 1 }),
        spacer(6),
        infoRow("定时", vm.scheduleText, vm.theme, { maxLines: 1 }),
        spacer(6),
        infoRow("手动签", vm.manualCheckinText, vm.theme, { maxLines: 2 }),
        spacer(6),
        infoRow("手动查", vm.manualStatusText, vm.theme, { maxLines: 2 }),
        spacer(6),
        infoRow("说明", vm.footerText, vm.theme, { maxLines: 2 }),
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
        backgroundColor: vm.theme.base,
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
        text(vm.footerText, 10, "medium", vm.theme.footer, { flex: 1, maxLines: 1, minScale: 0.78 }),
        text(vm.updatedText, 10, "medium", vm.theme.subtle, { maxLines: 1, minScale: 0.82 })
    ], { alignItems: "center", gap: 8 });
}

function buildSmallMetaText(vm) {
    var streak = compactStreak(vm.streakText);
    if ((vm.status === "success" || vm.status === "already_signed" || vm.status === "not_signed") && streak !== "连签 --") {
        return streak;
    }
    return "更新 " + vm.updatedText;
}

function buildCompactFooterText(vm, family) {
    if (vm.status === "success" || vm.status === "already_signed") {
        return vm.isToday ? "今日签到已完成" : "等待今日签到";
    }
    if (vm.status === "failed") {
        return family === "small" ? "可手动重试" : "稍后可手动重试";
    }
    if (vm.status === "not_signed") {
        return "可手动补签";
    }
    return "09:00 自动签到";
}

function compactSecondary(vm, maxLength) {
    var value = trim(vm && vm.secondary);
    if (!value) return "--";
    value = value
        .replace(/^服务器显示/, "")
        .replace(/^等待今日 09:00 自动执行签到$/, "等待 09:00 自动签到")
        .replace(/^状态刷新提示：/, "刷新提示：");
    return clipText(value, maxLength || 40);
}

function infoRow(label, value, theme, options) {
    options = options || {};
    return row([
        {
            type: "stack",
            direction: "row",
            width: options.labelWidth || 44,
            children: [
                text(label, 10, "medium", theme.subtle, { maxLines: 1 })
            ]
        },
        text(value, options.valueSize || 12, options.valueWeight || "semibold", options.valueColor || theme.text, {
            flex: 1,
            maxLines: options.maxLines || 2,
            minScale: options.minScale || 0.72
        })
    ], { alignItems: options.alignItems || "start", gap: 8 });
}

function separator(theme) {
    return {
        type: "stack",
        height: 1,
        backgroundGradient: {
            type: "linear",
            colors: [theme.lineFade, theme.line, theme.lineFade],
            startPoint: { x: 0, y: 0.5 },
            endPoint: { x: 1, y: 0.5 }
        },
        children: []
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

function image(src, size, color, extra) {
    var node = {
        type: "image",
        src: src,
        width: size,
        height: size,
        color: color
    };

    extra = extra || {};
    var keys = Object.keys(extra);
    for (var i = 0; i < keys.length; i++) {
        node[keys[i]] = extra[keys[i]];
    }
    return node;
}

function spacer(value) {
    if (value == null) return { type: "spacer" };
    return { type: "spacer", length: value };
}

function resolveTheme(accent) {
    var accentGlow = hexToRgba(accent, 0.34, "rgba(52,211,153,0.34)");
    var accentSoft = hexToRgba(accent, 0.18, "rgba(52,211,153,0.18)");
    var accentLine = hexToRgba(accent, 0.28, "rgba(52,211,153,0.28)");
    return {
        accent: accent,
        base: "#060B16",
        gradient: ["#08101C", "#0D1524", accentSoft],
        text: "#F8FAFC",
        muted: "rgba(226,232,240,0.82)",
        subtle: "rgba(203,213,225,0.62)",
        footer: "rgba(148,163,184,0.88)",
        line: accentLine,
        lineFade: "rgba(255,255,255,0.02)",
        titleShadow: accentGlow,
        iconGlow: accentGlow
    };
}

function hexToRgba(color, alpha, fallback) {
    var value = trim(color).replace("#", "");
    if (value.length === 3) {
        value = value.charAt(0) + value.charAt(0)
            + value.charAt(1) + value.charAt(1)
            + value.charAt(2) + value.charAt(2);
    }
    if (!/^[0-9a-fA-F]{6}$/.test(value)) {
        return fallback || color;
    }
    return "rgba(" + parseInt(value.slice(0, 2), 16)
        + "," + parseInt(value.slice(2, 4), 16)
        + "," + parseInt(value.slice(4, 6), 16)
        + "," + alpha + ")";
}

function buildInlineText(vm) {
    if (vm.status === "failed" && vm.isToday) {
        return clipText(vm.title + " 失败: " + vm.secondary, 28);
    }
    if (vm.status === "not_signed" && vm.isToday) {
        return clipText(vm.title + " 未签到 · 可手动补签", 28);
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

function buildNotSignedMessage(data) {
    var days = pickFirstNumber([
        toIntOrNull(data && data.consecutiveDays),
        toIntOrNull(data && data.continuousDays)
    ]);
    if (days) return "服务器显示今日未签到，当前连签记录 " + days + " 天";
    return "服务器显示今日尚未签到";
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

function resolveCompactStatus(vm) {
    if (vm.status === "failed") return "失败";
    if (vm.status === "not_signed") return "未签";
    if (vm.isToday && (vm.status === "success" || vm.status === "already_signed")) return "已签";
    return "等待";
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

function compactStreak(textValue) {
    var normalized = String(textValue || "--");
    if (normalized === "连续天数 --") return "连签 --";
    return clipText(normalized.replace("连续 ", "连签").replace(" 天", "天"), 10);
}

function clipText(value, maxLength) {
    var textValue = String(value == null ? "" : value);
    if (textValue.length <= maxLength) return textValue;
    return textValue.slice(0, Math.max(0, maxLength - 1)) + "…";
}

function normalizeAction(value) {
    var normalized = trim(value).toLowerCase();
    if (normalized === "status" || normalized === "query" || normalized === "query-status") return "status";
    return "checkin";
}

function statusText(status) {
    if (status === "success") return "签到成功";
    if (status === "already_signed") return "今日已签到";
    if (status === "not_signed") return "今日未签到";
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

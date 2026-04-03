var STORAGE_KEY = "ninebot_checkin_v2";
var HISTORY_STORAGE_KEY = "ninebot_checkin_history_v1";
var HISTORY_DAYS = 7;
var STATUS_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/status";
var SIGN_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/sign";

var DEFAULT_TITLE = "Ninebot 签到";
var DEFAULT_OPEN_URL = "https://h5-bj.ninebot.com/";
var DEFAULT_TIMEOUT_MS = 15000;
var DEFAULT_REFRESH_MINUTES = 30;
var DEFAULT_ACCENT_COLOR = "#34D399";
var DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Segway v6 C 609033420";
var DEFAULT_DAILY_CRON = "0 9 * * *";

export default async function (ctx) {
    if (ctx && ctx.cron) {
        return await runScheduledAction(ctx);
    }
    return await renderWidget(ctx || {});
}

async function runScheduledAction(ctx) {
    var config = readConfig(ctx);
    var result;
    var source = trim(ctx && ctx.script && ctx.script.name) || "schedule";

    try {
        ensureRequiredConfig(config);
        result = await executeCheckinFlow(ctx, config, source);
    } catch (e) {
        result = createErrorRecord(config, source, e, {
            unhandledError: serializeFailureInput(e)
        }, "任务执行失败");
        saveRecord(ctx, result);
    }

    await maybeNotify(ctx, config, result);
    return result;
}

async function renderWidget(ctx) {
    var config = readConfig(ctx);
    var family = ctx.widgetFamily || "systemMedium";
    var record = loadRecord(ctx);
    var history = loadHistory(ctx);

    try {
        ensureRequiredConfig(config);
    } catch (e) {
        return buildWidget(buildViewModel(createConfigErrorRecord(config, safeMsg(e)), config, history), family);
    }

    if (!record) {
        record = createPendingRecord(config);
    }

    return buildWidget(buildViewModel(record, config, history), family);
}

async function executeCheckinFlow(ctx, config, source) {
    var cached = loadRecord(ctx);
    if (!config.forceCheckin && isSuccessfulToday(cached)) {
        return cached;
    }

    var statusBefore;
    try {
        statusBefore = await fetchStatus(ctx, config);
    } catch (statusError) {
        var precheckTransportFailure = createErrorRecord(config, source, statusError, {
            statusBeforeError: serializeFailureInput(statusError)
        }, "获取签到状态失败");
        saveRecord(ctx, precheckTransportFailure);
        return precheckTransportFailure;
    }

    if (!resultOk(statusBefore)) {
        var precheckFailure = createErrorRecord(config, source, statusBefore, {
            statusBefore: statusBefore
        }, "获取签到状态失败");
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
            verificationState: "precheck",
            errorCategory: "",
            raw: {
                statusBefore: statusBefore
            }
        });
        saveRecord(ctx, alreadyRecord);
        return alreadyRecord;
    }

    var signPayload = null;
    var signError = null;
    try {
        signPayload = await postSign(ctx, config);
    } catch (e) {
        signError = e;
    }

    if (signError || !resultOk(signPayload)) {
        var statusVerify = null;
        var statusVerifyError = null;
        try {
            statusVerify = await fetchStatus(ctx, config);
        } catch (e2) {
            statusVerifyError = e2;
        }

        var verifyData = resultOk(statusVerify) ? ensureObject(statusVerify.data) : {};
        if (resultOk(statusVerify) && toInt(verifyData.currentSignStatus) === 1) {
            var recoveredRecord = createRecord({
                dateKey: todayKey(),
                status: "success",
                title: "签到成功",
                message: buildRecoveredSuccessMessage(signPayload, verifyData),
                consecutiveDays: pickFirstNumber([
                    toIntOrNull(verifyData.consecutiveDays),
                    toIntOrNull(verifyData.continuousDays),
                    toIntOrNull(statusData.consecutiveDays),
                    toIntOrNull(statusData.continuousDays)
                ]),
                checkedAt: nowIso(),
                source: source,
                lastError: signError ? safeMsg(signError) : extractMessage(signPayload),
                verificationState: "post_failure_recheck",
                errorCategory: signError ? normalizeErrorCategory(signError) : normalizeErrorCategory(signPayload),
                raw: {
                    statusBefore: statusBefore,
                    sign: signPayload,
                    signError: serializeFailureInput(signError),
                    statusAfter: statusVerify,
                    statusAfterError: serializeFailureInput(statusVerifyError)
                }
            });
            saveRecord(ctx, recoveredRecord);
            return recoveredRecord;
        }

        var signFailureInput = pickBestFailureInput([
            statusVerifyError,
            statusVerify,
            signError,
            signPayload
        ]);
        var signFailure = createErrorRecord(config, source, signFailureInput, {
            statusBefore: statusBefore,
            sign: signPayload,
            signError: serializeFailureInput(signError),
            statusAfter: statusVerify,
            statusAfterError: serializeFailureInput(statusVerifyError)
        }, extractMessage(signPayload) || "签到失败");
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
    } catch (e3) {
        refreshError = safeMsg(e3);
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
        verificationState: "direct",
        errorCategory: "",
        raw: {
            statusBefore: statusBefore,
            sign: signPayload,
            statusAfter: statusAfter,
            statusAfterError: refreshError ? { message: refreshError } : null
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
                throw buildHttpError(response ? response.status : 0, data);
            }

            return data;
        } catch (e) {
            lastError = normalizeRequestError(e);
            if (attempt >= maxAttempts || !shouldRetryRequestError(lastError)) break;
            await delay(attempt * 1200);
        }
    }

    if (lastError && /^请求 Ninebot 接口失败：/.test(safeMsg(lastError))) {
        throw lastError;
    }
    throw decorateError(new Error("请求 Ninebot 接口失败：" + safeMsg(lastError)), lastError);
}

function normalizeRequestError(error) {
    if (error instanceof Error || (error && typeof error === "object")) {
        if (!error.errorCategory) {
            error.errorCategory = normalizeErrorCategory(error);
        }
        return error;
    }
    var wrapped = new Error(safeMsg(error));
    wrapped.errorCategory = normalizeErrorCategory(error);
    return wrapped;
}

function buildHttpError(status, payload) {
    var error = new Error(extractMessage(payload) || ("HTTP " + (status || "--")));
    error.httpStatus = status || 0;
    error.responsePayload = payload || null;
    error.responseMessage = extractMessage(payload);
    error.errorCategory = normalizeErrorCategory({
        httpStatus: status,
        responseMessage: extractMessage(payload)
    });
    return error;
}

function shouldRetryRequestError(error) {
    var status = toIntOrNull(error && error.httpStatus);
    if (status === 401 || status === 403) return false;
    if (status != null && status >= 400 && status < 500) return false;
    var category = normalizeErrorCategory(error);
    if (category === "auth_expired" || category === "invalid_json") return false;
    return true;
}

function decorateError(target, source) {
    if (!target || !source) return target;
    if (source.httpStatus != null) target.httpStatus = source.httpStatus;
    if (source.responsePayload != null) target.responsePayload = source.responsePayload;
    if (source.responseMessage != null) target.responseMessage = source.responseMessage;
    if (source.errorCategory != null) target.errorCategory = source.errorCategory;
    return target;
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
        dailyCronText: trim(env.DAILY_CRON_TEXT) || DEFAULT_DAILY_CRON
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
    } else if (record.status === "failed" || record.status === "auth_expired") {
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

function loadHistory(ctx) {
    try {
        var raw = ctx && ctx.storage && typeof ctx.storage.getJSON === "function"
            ? ctx.storage.getJSON(HISTORY_STORAGE_KEY)
            : null;
        return normalizeHistoryEntries(raw);
    } catch (_) {
        return [];
    }
}

function saveRecord(ctx, record) {
    if (!ctx || !ctx.storage || typeof ctx.storage.setJSON !== "function") return;
    var normalized = createRecord(record);
    ctx.storage.setJSON(STORAGE_KEY, normalized);
    updateHistory(ctx, normalized);
}

function saveHistory(ctx, history) {
    if (!ctx || !ctx.storage || typeof ctx.storage.setJSON !== "function") return;
    ctx.storage.setJSON(HISTORY_STORAGE_KEY, normalizeHistoryEntries(history));
}

function updateHistory(ctx, record) {
    if (!shouldTrackHistory(record)) return;
    var history = loadHistory(ctx);
    var entry = createHistoryEntry(record);
    if (!entry) return;

    var next = [entry];
    for (var i = 0; i < history.length; i++) {
        if (history[i].dateKey !== entry.dateKey) {
            next.push(history[i]);
        }
    }
    saveHistory(ctx, next);
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
        verificationState: trim(data.verificationState) || "direct",
        errorCategory: trim(data.errorCategory),
        raw: data.raw || null
    };
}

function createHistoryEntry(input) {
    var data = ensureObject(input);
    var dateKey = trim(data.dateKey);
    var status = trim(data.status);
    if (!dateKey || !status) return null;
    return {
        dateKey: dateKey,
        status: status,
        checkedAt: trim(data.checkedAt) || nowIso(),
        verificationState: trim(data.verificationState)
    };
}

function normalizeHistoryEntries(input) {
    if (!Array.isArray(input)) return [];
    var latestByDate = {};
    for (var i = 0; i < input.length; i++) {
        var entry = createHistoryEntry(input[i]);
        if (!entry) continue;
        var prev = latestByDate[entry.dateKey];
        if (!prev || timeValue(entry.checkedAt) >= timeValue(prev.checkedAt)) {
            latestByDate[entry.dateKey] = entry;
        }
    }

    var keys = Object.keys(latestByDate).sort(function (a, b) {
        if (a === b) return 0;
        return a < b ? 1 : -1;
    });

    var list = [];
    for (var j = 0; j < keys.length && j < HISTORY_DAYS; j++) {
        list.push(latestByDate[keys[j]]);
    }
    return list;
}

function shouldTrackHistory(record) {
    return !!record && (
        record.status === "success"
        || record.status === "already_signed"
        || record.status === "failed"
        || record.status === "auth_expired"
        || record.status === "not_signed"
    );
}

function buildHistorySummary(history) {
    var items = normalizeHistoryEntries(history);
    var map = {};
    for (var i = 0; i < items.length; i++) {
        map[items[i].dateKey] = historyStatusSymbol(items[i].status);
    }

    var parts = [];
    var now = new Date();
    for (var offset = HISTORY_DAYS - 1; offset >= 0; offset--) {
        var day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
        parts.push(map[dateKeyFromDate(day)] || "·");
    }
    return parts.join("");
}

function historyStatusSymbol(status) {
    if (status === "success" || status === "already_signed") return "✓";
    if (status === "auth_expired") return "!";
    if (status === "failed") return "✕";
    if (status === "not_signed") return "○";
    return "·";
}

function createPendingRecord(config) {
    var scheduleInfo = resolveScheduleInfo(config && config.dailyCronText);
    return createRecord({
        dateKey: todayKey(),
        status: "pending",
        title: "等待签到",
        message: scheduleInfo.nextRunText !== "未知"
            ? ("下次执行：" + scheduleInfo.nextRunDetailText)
            : "等待自动执行签到",
        consecutiveDays: null,
        checkedAt: nowIso(),
        source: "widget",
        lastError: "",
        verificationState: "direct",
        errorCategory: "",
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
        verificationState: "direct",
        errorCategory: "config_error",
        raw: null
    });
}

function createFailureRecord(config, source, message, raw, errorCategory) {
    return createRecord({
        dateKey: todayKey(),
        status: "failed",
        title: "签到失败",
        message: message || "未知错误",
        consecutiveDays: null,
        checkedAt: nowIso(),
        source: source || "schedule",
        lastError: message || "未知错误",
        verificationState: "direct",
        errorCategory: trim(errorCategory) || "unknown",
        raw: raw || null
    });
}

function createAuthExpiredRecord(config, source, message, raw) {
    return createRecord({
        dateKey: todayKey(),
        status: "auth_expired",
        title: "授权已失效",
        message: message || "Authorization 可能已过期，需要重新抓包更新",
        consecutiveDays: null,
        checkedAt: nowIso(),
        source: source || "schedule",
        lastError: message || "Authorization 可能已过期，需要重新抓包更新",
        verificationState: "direct",
        errorCategory: "auth_expired",
        raw: raw || null
    });
}

function createErrorRecord(config, source, failureInput, raw, fallbackMessage) {
    var info = resolveFailureInfo(failureInput, fallbackMessage);
    if (info.status === "auth_expired") {
        return createAuthExpiredRecord(config, source, info.message, raw);
    }
    return createFailureRecord(config, source, info.message, raw, info.errorCategory);
}

function resolveFailureInfo(failureInput, fallbackMessage) {
    var message = extractFailureMessage(failureInput) || fallbackMessage || "未知错误";
    var status = isAuthExpiredInput(failureInput, message) ? "auth_expired" : "failed";
    return {
        status: status,
        message: message,
        errorCategory: status === "auth_expired" ? "auth_expired" : normalizeErrorCategory(failureInput, message)
    };
}

function pickBestFailureInput(inputs) {
    for (var i = 0; i < inputs.length; i++) {
        if (inputs[i] && isAuthExpiredInput(inputs[i])) return inputs[i];
    }
    for (var j = 0; j < inputs.length; j++) {
        if (inputs[j]) return inputs[j];
    }
    return null;
}

function serializeFailureInput(input) {
    if (!input) return null;
    if (typeof input === "string") {
        return {
            message: trim(input)
        };
    }
    if (input instanceof Error || typeof input.message === "string" || input.httpStatus != null) {
        return {
            message: safeMsg(input),
            httpStatus: toIntOrNull(input.httpStatus),
            responseMessage: trim(input.responseMessage),
            errorCategory: trim(input.errorCategory)
        };
    }
    if (typeof input === "object") {
        return {
            code: toIntOrNull(input.code),
            message: extractMessage(input),
            errorCategory: trim(input.errorCategory)
        };
    }
    return {
        message: safeMsg(input)
    };
}

function isSuccessfulToday(record) {
    return !!record
        && record.dateKey === todayKey()
        && (record.status === "success" || record.status === "already_signed");
}

function buildViewModel(record, config, history) {
    var theme = resolveTheme(config.accentColor);
    var currentKey = todayKey();
    var isToday = record && record.dateKey === currentKey;
    var scheduleInfo = resolveScheduleInfo(config.dailyCronText);
    var historyText = buildHistorySummary(history);
    var primary = "等待签到";
    var secondary = record.message || (scheduleInfo.nextRunText !== "未知"
        ? ("下次执行：" + scheduleInfo.nextRunDetailText)
        : "等待自动执行签到");
    var statusColor = "#FBBF24";
    var symbol = "sf-symbol:clock.badge.questionmark.fill";
    var footerText = scheduleInfo.nextRunText !== "未知" ? ("下次 " + scheduleInfo.nextRunText) : "等待自动签到";

    if (record.status === "success" || record.status === "already_signed") {
        primary = "今日已签到";
        secondary = record.message || buildAlreadySignedMessage(record);
        statusColor = config.accentColor;
        symbol = "sf-symbol:checkmark.seal.fill";
        footerText = scheduleInfo.nextRunText !== "未知" ? ("下次 " + scheduleInfo.nextRunText) : "今日签到结果已写入缓存";
    } else if (record.status === "auth_expired") {
        primary = "授权失效";
        secondary = record.message || "Authorization 可能已过期，需要重新抓包更新";
        statusColor = "#F87171";
        symbol = "sf-symbol:lock.fill";
        footerText = "更新授权后可重新执行";
    } else if (record.status === "failed") {
        primary = isToday ? "签到失败" : "上次签到失败";
        secondary = record.message || record.lastError || "未知错误";
        statusColor = "#FB923C";
        symbol = "sf-symbol:exclamationmark.triangle.fill";
        footerText = scheduleInfo.nextRunText !== "未知"
            ? ("可重新执行，或等待 " + scheduleInfo.nextRunText)
            : "重新执行即可重试";
    } else if (record.status === "not_signed") {
        primary = "今日未签到";
        secondary = record.message || "服务器显示今日尚未签到";
        statusColor = "#FBBF24";
        symbol = "sf-symbol:xmark.seal.fill";
        footerText = scheduleInfo.nextRunText !== "未知"
            ? ("可重新执行，或等待 " + scheduleInfo.nextRunText)
            : "重新执行即可补签";
    } else if (!isToday) {
        primary = "今日未执行";
        secondary = record.checkedAt
            ? "上次：" + formatMonthDayTime(record.checkedAt) + " · " + (record.title || statusText(record.status))
            : (scheduleInfo.nextRunText !== "未知" ? ("下次执行：" + scheduleInfo.nextRunDetailText) : "等待自动执行签到");
        statusColor = "#60A5FA";
        symbol = "sf-symbol:clock.fill";
        footerText = scheduleInfo.nextRunText !== "未知" ? ("下次 " + scheduleInfo.nextRunText) : "等待自动签到";
    }

    if ((record.status === "success" || record.status === "already_signed") && !isToday) {
        primary = "今日未执行";
        secondary = record.checkedAt
            ? "上次：" + formatMonthDayTime(record.checkedAt) + " · 已签到"
            : (scheduleInfo.nextRunText !== "未知" ? ("下次执行：" + scheduleInfo.nextRunDetailText) : "等待自动执行签到");
        statusColor = "#60A5FA";
        symbol = "sf-symbol:clock.fill";
        footerText = scheduleInfo.nextRunText !== "未知" ? ("下次 " + scheduleInfo.nextRunText) : "等待自动签到";
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
        scheduleText: scheduleInfo.scheduleText,
        nextRunText: scheduleInfo.nextRunText,
        countdownText: scheduleInfo.countdownText,
        nextRunDetailText: scheduleInfo.nextRunDetailText,
        historyText: historyText,
        historySummaryText: "近7天 " + historyText,
        verificationState: record.verificationState
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
        text(buildCompactFooterText(vm, "small"), 10, "medium", vm.theme.footer, { maxLines: 1, minScale: 0.78 })
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
        }),
        spacer(),
        text(buildMediumFooterText(vm), 10, "medium", vm.theme.footer, { maxLines: 1, minScale: 0.72 })
    ], vm, [14, 14, 14, 14]);
}

function buildLarge(vm) {
    return shell([
        text(vm.title, 16, "bold", vm.theme.text, { maxLines: 1, shadowColor: vm.theme.titleShadow, shadowRadius: 6 }),
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
        infoRow("下次", vm.nextRunDetailText, vm.theme, { maxLines: 2 }),
        spacer(6),
        infoRow("近7天", vm.historyText, vm.theme, { maxLines: 1 }),
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
        text(vm.nextRunText && vm.nextRunText !== "未知" ? vm.nextRunText : vm.updatedText, 10, "medium", vm.theme.subtle, { maxLines: 1, minScale: 0.82 })
    ], { alignItems: "center", gap: 8 });
}

function buildSmallMetaText(vm) {
    var streak = compactStreak(vm.streakText);
    if ((vm.status === "success" || vm.status === "already_signed" || vm.status === "not_signed") && streak !== "连签 --") {
        return streak;
    }
    if (vm.status === "success" && vm.verificationState === "post_failure_recheck") {
        return "复查确认成功";
    }
    return "更新 " + vm.updatedText;
}

function buildMediumFooterText(vm) {
    var parts = [];
    if (vm.historyText) {
        parts.push("近7天 " + vm.historyText);
    }
    if (vm.status === "auth_expired") {
        parts.push("更新授权后重试");
    } else if (vm.nextRunText && vm.nextRunText !== "未知") {
        parts.push("下次 " + buildShortNextRunText(vm.nextRunText));
    } else if (vm.scheduleText) {
        parts.push(vm.scheduleText);
    }
    return clipText(parts.join(" · "), 34);
}

function buildCompactFooterText(vm, family) {
    if (vm.status === "auth_expired") {
        return "更新授权后重试";
    }
    if (vm.nextRunText && vm.nextRunText !== "未知") {
        return clipText("下次 " + buildShortNextRunText(vm.nextRunText), family === "small" ? 14 : 20);
    }
    if (vm.status === "failed") {
        return family === "small" ? "可重新执行" : "稍后可重新执行";
    }
    if (vm.status === "not_signed") {
        return "可重新执行";
    }
    return "等待自动签到";
}

function compactSecondary(vm, maxLength) {
    var value = trim(vm && vm.secondary);
    if (!value) return "--";
    value = value
        .replace(/^服务器显示/, "")
        .replace(/^下次执行：/, "下次 ")
        .replace(/^状态刷新提示：/, "刷新提示：");
    return clipText(value, maxLength || 40);
}

function buildShortNextRunText(value) {
    var textValue = trim(value);
    if (!textValue || textValue === "未知") return "待定";
    return textValue.replace(/\s+/g, "");
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
    if (vm.status === "auth_expired") {
        return clipText(vm.title + " 授权失效", 28);
    }
    if (vm.status === "failed" && vm.isToday) {
        return clipText(vm.title + " 失败 · 下次 " + buildShortNextRunText(vm.nextRunText), 28);
    }
    if (vm.status === "not_signed" && vm.isToday) {
        return clipText(vm.title + " 未签到 · 可重试", 28);
    }
    if (vm.isToday && (vm.status === "success" || vm.status === "already_signed")) {
        return clipText(vm.title + " 已签到 · " + compactStreak(vm.streakText), 28);
    }
    return clipText(vm.title + " 下次 " + buildShortNextRunText(vm.nextRunText), 28);
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

function buildRecoveredSuccessMessage(signPayload, statusAfterData) {
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
    parts.push("接口响应异常，但状态复查确认已签到");
    return parts.join(" · ");
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
    if (vm.status === "auth_expired") return "过期";
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
    return trim(payload.msg) || trim(payload.message) || trim(payload.errorMsg) || trim(payload.error_message) || trim(payload.responseMessage);
}

function extractFailureMessage(input) {
    if (!input) return "";
    if (typeof input === "string") return trim(input);
    if (input instanceof Error || typeof input.message === "string" || input.httpStatus != null) {
        return trim(input.responseMessage) || trim(input.message);
    }
    return extractMessage(input);
}

function isAuthExpiredInput(input, providedMessage) {
    var status = toIntOrNull(input && input.httpStatus);
    if (status === 401 || status === 403) return true;
    return containsAuthExpiredToken(providedMessage || extractFailureMessage(input));
}

function containsAuthExpiredToken(message) {
    var value = trim(message).toLowerCase();
    if (!value) return false;
    return /unauthorized|authorization.+(expired|invalid|fail)|token\s*expired|token已过期|token过期|登录失效|授权失效|授权过期|鉴权失败|鉴权过期|认证失败|请重新登录|重新登录|登录状态已失效/.test(value);
}

function normalizeErrorCategory(input, providedMessage) {
    var explicit = trim(input && input.errorCategory);
    if (explicit) return explicit;

    var status = toIntOrNull(input && input.httpStatus);
    var message = trim(providedMessage || extractFailureMessage(input)).toLowerCase();

    if (status === 401 || status === 403 || containsAuthExpiredToken(message)) return "auth_expired";
    if (status >= 500) return "http_5xx";
    if (status >= 400) return "http_" + status;
    if (/timeout|timed out|超时/.test(message)) return "network_timeout";
    if (/json/.test(message)) return "invalid_json";
    if (/network|socket|connection|连接|中断|断开|dns/.test(message)) return "network_error";
    if (input && typeof input === "object" && Number(input.code) !== 0 && isFinite(Number(input.code))) return "biz_" + Number(input.code);
    return "unknown";
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
    return dateKeyFromDate(new Date());
}

function dateKeyFromDate(date) {
    return date.getFullYear() + "-" + pad2(date.getMonth() + 1) + "-" + pad2(date.getDate());
}

function resolveScheduleInfo(cronText) {
    var rawText = trim(cronText) || DEFAULT_DAILY_CRON;
    var parsed = parseDailyCron(rawText);
    if (!parsed) {
        return {
            scheduleText: "每天 " + rawText,
            nextRunText: "未知",
            countdownText: "",
            nextRunDetailText: "下次执行未知"
        };
    }

    var timeText = pad2(parsed.hour) + ":" + pad2(parsed.minute);
    var now = new Date();
    var target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), parsed.hour, parsed.minute, 0, 0);
    var label = "今天";
    if (now.getTime() >= target.getTime()) {
        target.setDate(target.getDate() + 1);
        label = "明天";
    }

    var nextRunText = label + " " + timeText;
    var countdownText = formatCountdown(target.getTime() - now.getTime());
    return {
        scheduleText: "每天 " + timeText + " 自动签到",
        nextRunText: nextRunText,
        countdownText: countdownText,
        nextRunDetailText: countdownText ? (nextRunText + " · " + countdownText) : nextRunText
    };
}

function parseDailyCron(value) {
    var match = trim(value).match(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/);
    if (!match) return null;
    var minute = parseInt(match[1], 10);
    var hour = parseInt(match[2], 10);
    if (!isFinite(minute) || !isFinite(hour)) return null;
    if (minute < 0 || minute > 59 || hour < 0 || hour > 23) return null;
    return {
        minute: minute,
        hour: hour
    };
}

function formatCountdown(ms) {
    if (!isFinite(ms)) return "";
    if (ms <= 0) return "即将执行";
    var totalMinutes = Math.ceil(ms / 60000);
    if (totalMinutes < 60) return "还有" + totalMinutes + "分";
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    return "还有" + hours + "小时" + (minutes ? (minutes + "分") : "");
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

function timeValue(value) {
    var date = new Date(value);
    var time = date.getTime();
    return isNaN(time) ? 0 : time;
}

function statusText(status) {
    if (status === "success") return "签到成功";
    if (status === "already_signed") return "今日已签到";
    if (status === "not_signed") return "今日未签到";
    if (status === "auth_expired") return "授权已失效";
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

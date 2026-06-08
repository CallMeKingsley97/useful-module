var STORAGE_KEY = "ninebot_checkin_v2";
var HISTORY_STORAGE_KEY = "ninebot_checkin_history_v1";
var HISTORY_DAYS = 7;
var STATUS_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/status";
var SIGN_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/sign";
var BLIND_BOX_LIST_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/blind-box/list";
var BLIND_BOX_RECEIVE_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/blind-box/receive";
var BLIND_BOX_OPEN_URL = "https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/blind-box/open";

var DEFAULT_TITLE = "Ninebot 签到";
var DEFAULT_OPEN_URL = "https://h5-bj.ninebot.com/";
var DEFAULT_TIMEOUT_MS = 15000;
var DEFAULT_REFRESH_MINUTES = 30;
var DEFAULT_ACCENT_COLOR = "#34D399";
var DEFAULT_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 15_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Segway v6 C 609033420";
var DEFAULT_DAILY_CRON = "0 */2 * * *";
var STATUS_COLORS = {
    success: "#34D399",
    waiting: "#60A5FA",
    pending: "#FBBF24",
    notSigned: "#FBBF24",
    failed: "#FB923C",
    authExpired: "#F87171"
};

export default async function (ctx) {
    var scriptName = trim(ctx && ctx.script && ctx.script.name);
    if (scriptName === "ninebot-checkin") {
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
        var cachedBlindBox = shouldReuseBlindBoxResult(cached.blindBox)
            ? normalizeBlindBoxResult(cached.blindBox)
            : await executeBlindBoxFlow(ctx, config, {
                receive: true
            });
        var cachedRecord = createRecord({
            dateKey: todayKey(),
            status: "already_signed",
            title: "今日已签到",
            message: "本地记录显示今日已签到，本次未重复提交签到请求",
            consecutiveDays: cached.consecutiveDays,
            checkedAt: nowIso(),
            source: source,
            lastError: "",
            verificationState: "local_success_cache",
            errorCategory: "",
            blindBox: cachedBlindBox,
            raw: {
                cachedRecord: cached
            }
        });
        saveRecord(ctx, cachedRecord);
        return cachedRecord;
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
        var alreadyBlindBox = await executeBlindBoxFlow(ctx, config, {
            receive: true
        });
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
            blindBox: alreadyBlindBox,
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
            var recoveredBlindBox = await executeBlindBoxFlow(ctx, config, {
                receive: true
            });
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
                blindBox: recoveredBlindBox,
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
    var successBlindBox = await executeBlindBoxFlow(ctx, config, {
        receive: true
    });
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
        blindBox: successBlindBox,
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

async function fetchBlindBoxList(ctx, config) {
    return await requestJson(ctx, "GET", BLIND_BOX_LIST_URL, null, buildHeaders(config), config.timeoutMs);
}

async function receiveBlindBox(ctx, config) {
    return await requestJson(ctx, "POST", BLIND_BOX_RECEIVE_URL, {}, buildHeaders(config), config.timeoutMs);
}

async function openBlindBox(ctx, config, boxId) {
    return await requestJson(ctx, "POST", BLIND_BOX_OPEN_URL, {
        boxId: boxId
    }, buildHeaders(config), config.timeoutMs);
}

async function executeBlindBoxFlow(ctx, config, options) {
    options = options || {};
    var receiveStatus = "skipped";
    var receiveMessage = "";
    var receivePayload = null;
    var receiveError = null;

    if (options.receive !== false) {
        try {
            receivePayload = await receiveBlindBox(ctx, config);
            if (resultOk(receivePayload)) {
                receiveStatus = "received";
                receiveMessage = "当日盲盒领取成功";
            } else {
                receiveStatus = "not_received";
                receiveMessage = extractMessage(receivePayload) || "当日盲盒已领取或暂不可领";
            }
        } catch (e) {
            receiveError = e;
            receiveStatus = "receive_failed";
            receiveMessage = safeMsg(e);
        }
    }

    var listPayload = null;
    try {
        listPayload = await fetchBlindBoxList(ctx, config);
    } catch (listError) {
        return createBlindBoxResult({
            dateKey: todayKey(),
            status: "query_failed",
            title: "盲盒查询失败",
            openedToday: false,
            checkedAt: nowIso(),
            receiveStatus: receiveStatus,
            receiveMessage: receiveMessage,
            lastError: safeMsg(listError),
            raw: {
                receive: receivePayload,
                receiveError: serializeFailureInput(receiveError),
                listError: serializeFailureInput(listError)
            }
        });
    }

    if (!resultOk(listPayload)) {
        return createBlindBoxResult({
            dateKey: todayKey(),
            status: "query_failed",
            title: "盲盒查询失败",
            openedToday: false,
            checkedAt: nowIso(),
            receiveStatus: receiveStatus,
            receiveMessage: receiveMessage,
            lastError: extractMessage(listPayload) || "盲盒列表接口返回失败",
            raw: {
                receive: receivePayload,
                receiveError: serializeFailureInput(receiveError),
                list: listPayload
            }
        });
    }

    var summary = summarizeBlindBoxList(listPayload);
    if (!config.autoOpenBlindBox) {
        return createBlindBoxResult({
            dateKey: todayKey(),
            status: "disabled",
            title: "自动开盒已关闭",
            openedToday: false,
            checkedAt: nowIso(),
            receiveStatus: receiveStatus,
            receiveMessage: receiveMessage,
            pendingCount: summary.pendingCount,
            availableCount: summary.availableCount,
            openedTotal: summary.openedTotal,
            nextOpenDays: summary.nextOpenDays,
            nextOpenText: summary.nextOpenText,
            raw: {
                receive: receivePayload,
                receiveError: serializeFailureInput(receiveError),
                list: listPayload
            }
        });
    }

    if (!summary.availableBoxes.length) {
        return createBlindBoxResult({
            dateKey: todayKey(),
            status: summary.pendingCount > 0 ? "not_ready" : "no_box",
            title: summary.pendingCount > 0 ? "盲盒暂不可开" : "暂无待开盲盒",
            openedToday: false,
            checkedAt: nowIso(),
            receiveStatus: receiveStatus,
            receiveMessage: receiveMessage,
            pendingCount: summary.pendingCount,
            availableCount: 0,
            openedTotal: summary.openedTotal,
            nextOpenDays: summary.nextOpenDays,
            nextOpenText: summary.nextOpenText,
            raw: {
                receive: receivePayload,
                receiveError: serializeFailureInput(receiveError),
                list: listPayload
            }
        });
    }

    var openResults = [];
    var openedCount = 0;
    var rewardParts = [];
    for (var i = 0; i < summary.availableBoxes.length; i++) {
        var box = summary.availableBoxes[i];
        var boxId = box && box.boxId;
        var boxIdText = trim(boxId);
        var awardDays = pickFirstNumber([
            toIntOrNull(box && box.awardDays),
            toIntOrNull(box && box.days),
            toIntOrNull(box && box.signDays)
        ]);
        if (!boxIdText) {
            openResults.push(createBlindBoxOpenResult(false, boxIdText, awardDays, "", "盲盒缺少 boxId"));
            continue;
        }

        try {
            var openPayload = await openBlindBox(ctx, config, boxId);
            if (resultOk(openPayload)) {
                var rewardText = extractBlindBoxRewardText(openPayload);
                openedCount += 1;
                if (rewardText) rewardParts.push(rewardText);
                openResults.push(createBlindBoxOpenResult(true, boxIdText, awardDays, rewardText, "开启成功"));
            } else {
                openResults.push(createBlindBoxOpenResult(false, boxIdText, awardDays, "", extractMessage(openPayload) || "开启失败"));
            }
        } catch (openError) {
            openResults.push(createBlindBoxOpenResult(false, boxIdText, awardDays, "", safeMsg(openError)));
        }

        if (summary.availableBoxes.length > 1 && i < summary.availableBoxes.length - 1) {
            await delay(300);
        }
    }

    var finalSummary = summary;
    try {
        var refreshedList = await fetchBlindBoxList(ctx, config);
        if (resultOk(refreshedList)) finalSummary = summarizeBlindBoxList(refreshedList);
    } catch (_) {}

    return createBlindBoxResult({
        dateKey: todayKey(),
        status: openedCount > 0 ? "opened" : "open_failed",
        title: openedCount > 0 ? "盲盒开启成功" : "盲盒开启失败",
        openedToday: openedCount > 0,
        openedCount: openedCount,
        checkedAt: nowIso(),
        receiveStatus: receiveStatus,
        receiveMessage: receiveMessage,
        pendingCount: finalSummary.pendingCount,
        availableCount: finalSummary.availableCount,
        openedTotal: finalSummary.openedTotal,
        nextOpenDays: finalSummary.nextOpenDays,
        nextOpenText: finalSummary.nextOpenText,
        rewardText: rewardParts.join("、"),
        openResults: openResults,
        raw: {
            receive: receivePayload,
            receiveError: serializeFailureInput(receiveError),
            list: listPayload
        }
    });
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
        notifyOnSuccess: readBool(env.NOTIFY_ON_SUCCESS, true),
        notifyOnFailure: readBool(env.NOTIFY_ON_FAILURE, true),
        forceCheckin: isTrue(env.FORCE_CHECKIN),
        autoOpenBlindBox: readBool(trim(env.AUTO_OPEN_BOX) || trim(env.AUTO_OPEN_BLIND_BOX), true),
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
        platform: "h5",
        aid: "10000004",
        sys_language: "zh-CN",
        device_id: config.deviceId,
        deviceId: config.deviceId,
        "User-Agent": config.userAgent
    };
}

async function maybeNotify(ctx, config, record) {
    if (!ctx || typeof ctx.notify !== "function" || !record) {
        if (ctx && typeof ctx.notify !== "function") {
            console.log("ninebot notify skipped: ctx.notify is not a function, type=" + typeof ctx.notify);
        }
        return;
    }

    var shouldNotify = false;
    if (record.status === "success" || record.status === "already_signed") {
        shouldNotify = !!config.notifyOnSuccess;
    } else if (record.status === "failed" || record.status === "auth_expired" || record.status === "not_signed") {
        shouldNotify = !!config.notifyOnFailure;
    }

    if (!shouldNotify) return;

    var notifyText = buildNotifyText(record);
    var options = {
        title: config.title,
        subtitle: notifyText.subtitle,
        body: notifyText.body,
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
        console.log("ninebot notify sent: " + JSON.stringify({ status: record.status, title: options.title, subtitle: options.subtitle }));
    } catch (e) {
        console.log("ninebot notify failed: " + (e && e.message ? e.message : String(e)));
    }
}

function buildNotifyText(record) {
    if (record.status === "success") {
        if (record.verificationState === "post_failure_recheck") {
            return {
                subtitle: "本次签到已确认成功" + buildBlindBoxNotifySubtitle(record),
                body: appendBlindBoxNotifyBody(record.message || "接口响应异常，但状态复查确认今日已签到", record)
            };
        }
        return {
            subtitle: "本次签到成功" + buildBlindBoxNotifySubtitle(record),
            body: appendBlindBoxNotifyBody(record.message || buildStreakNotifyText(record), record)
        };
    }

    if (record.status === "already_signed") {
        return {
            subtitle: "今日已签到" + buildBlindBoxNotifySubtitle(record),
            body: appendBlindBoxNotifyBody(record.message || "本次执行未重复提交签到请求", record)
        };
    }

    if (record.status === "auth_expired") {
        return {
            subtitle: "本次签到失败",
            body: record.message || "授权已失效，需要更新 Authorization"
        };
    }

    if (record.status === "failed") {
        return {
            subtitle: "本次签到失败",
            body: record.message || record.lastError || "请稍后等待下一次自动重试"
        };
    }

    if (record.status === "not_signed") {
        return {
            subtitle: "今日未签到",
            body: record.message || "状态查询显示今日尚未签到"
        };
    }

    return {
        subtitle: record.title || statusText(record.status),
        body: appendBlindBoxNotifyBody(record.message || "Ninebot 签到任务已执行", record)
    };
}

function buildBlindBoxNotifySubtitle(record) {
    var box = normalizeBlindBoxResult(record && record.blindBox);
    if (!box || box.dateKey !== todayKey()) return " · 盲盒未查询";
    if (box.openedToday) return " · 盲盒已开";
    if (box.status === "not_ready" || box.status === "no_box") return " · 盲盒未开";
    if (box.status === "open_failed" || box.status === "query_failed") return " · 盲盒异常";
    if (box.status === "disabled") return " · 盲盒未开";
    return " · 盲盒未知";
}

function appendBlindBoxNotifyBody(body, record) {
    var box = normalizeBlindBoxResult(record && record.blindBox);
    if (!box || box.dateKey !== todayKey()) return body + "\n盲盒：今日未查询";
    return body + "\n盲盒：" + buildBlindBoxResultMessage(box);
}

function buildStreakNotifyText(record) {
    if (typeof record.consecutiveDays === "number" && isFinite(record.consecutiveDays)) {
        return "连续签到 " + record.consecutiveDays + " 天";
    }
    return "签到接口已返回成功";
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
        blindBox: normalizeBlindBoxResult(data.blindBox),
        raw: data.raw || null
    };
}

function createBlindBoxResult(input) {
    var result = normalizeBlindBoxResult(input) || normalizeBlindBoxResult({
        status: "unknown",
        title: "盲盒状态未知",
        openedToday: false
    });
    if (!result.message) {
        result.message = buildBlindBoxResultMessage(result);
    }
    return result;
}

function normalizeBlindBoxResult(input) {
    var data = ensureObject(input);
    if (!Object.keys(data).length) return null;

    var openResults = [];
    if (Array.isArray(data.openResults)) {
        for (var i = 0; i < data.openResults.length; i++) {
            var item = ensureObject(data.openResults[i]);
            openResults.push({
                success: !!item.success,
                boxId: trim(item.boxId),
                awardDays: toIntOrNull(item.awardDays),
                rewardText: trim(item.rewardText),
                message: trim(item.message)
            });
        }
    }

    return {
        dateKey: trim(data.dateKey) || todayKey(),
        status: trim(data.status) || "unknown",
        title: trim(data.title) || "盲盒状态",
        message: trim(data.message),
        openedToday: !!data.openedToday,
        openedCount: toIntOrNull(data.openedCount) || 0,
        pendingCount: toIntOrNull(data.pendingCount),
        availableCount: toIntOrNull(data.availableCount),
        openedTotal: toIntOrNull(data.openedTotal),
        nextOpenDays: toIntOrNull(data.nextOpenDays),
        nextOpenText: trim(data.nextOpenText),
        rewardText: trim(data.rewardText),
        checkedAt: trim(data.checkedAt) || nowIso(),
        receiveStatus: trim(data.receiveStatus),
        receiveMessage: trim(data.receiveMessage),
        lastError: trim(data.lastError),
        openResults: openResults,
        raw: data.raw || null
    };
}

function createBlindBoxOpenResult(success, boxId, awardDays, rewardText, message) {
    return {
        success: !!success,
        boxId: trim(boxId),
        awardDays: toIntOrNull(awardDays),
        rewardText: trim(rewardText),
        message: trim(message)
    };
}

function summarizeBlindBoxList(payload) {
    var data = ensureObject(payload && payload.data);
    var notOpened = Array.isArray(data.notOpenedBoxes) ? data.notOpenedBoxes : [];
    var opened = Array.isArray(data.openedBoxes) ? data.openedBoxes : [];
    var available = [];
    var waitDays = [];

    for (var i = 0; i < notOpened.length; i++) {
        var box = ensureObject(notOpened[i]);
        var waitDay = pickFirstNumber([
            toIntOrNull(box.waitDay),
            toIntOrNull(box.leftDaysToOpen),
            toIntOrNull(box.waitDays)
        ]);
        if (waitDay == null) waitDay = 0;
        if (waitDay === 0) {
            available.push(box);
        } else if (waitDay > 0) {
            waitDays.push(waitDay);
        }
    }

    var nextOpenDays = null;
    for (var j = 0; j < waitDays.length; j++) {
        if (nextOpenDays == null || waitDays[j] < nextOpenDays) {
            nextOpenDays = waitDays[j];
        }
    }

    return {
        notOpenedBoxes: notOpened,
        openedBoxes: opened,
        availableBoxes: available,
        pendingCount: notOpened.length,
        availableCount: available.length,
        openedTotal: opened.length,
        nextOpenDays: nextOpenDays,
        nextOpenText: formatBlindBoxNextOpenText(nextOpenDays, notOpened.length, available.length)
    };
}

function formatBlindBoxNextOpenText(days, pendingCount, availableCount) {
    if (availableCount > 0) return "已有盲盒可开";
    if (days == null) return pendingCount > 0 ? "等待盲盒解锁" : "暂无待开盲盒";
    if (days <= 0) return "已有盲盒可开";
    return days + "天后可开";
}

function shouldReuseBlindBoxResult(input) {
    var result = normalizeBlindBoxResult(input);
    if (!result || result.dateKey !== todayKey()) return false;
    if (result.receiveStatus === "receive_failed") return false;
    if (result.openedToday) return true;
    return result.status === "not_ready" || result.status === "no_box";
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
    var blindBox = normalizeBlindBoxResult(record && record.blindBox);
    var primary = "等待签到";
    var secondary = record.message || (scheduleInfo.nextRunText !== "未知"
        ? ("下次执行：" + scheduleInfo.nextRunDetailText)
        : "等待自动执行签到");
    var statusColor = STATUS_COLORS.pending;
    var symbol = "sf-symbol:clock.badge.questionmark.fill";
    var footerText = scheduleInfo.nextRunText !== "未知" ? ("下次 " + scheduleInfo.nextRunText) : "等待自动签到";

    if (record.status === "success" || record.status === "already_signed") {
        primary = "今日已签到";
        secondary = record.message || buildAlreadySignedMessage(record);
        statusColor = config.accentColor || STATUS_COLORS.success;
        symbol = "sf-symbol:checkmark.seal.fill";
        footerText = scheduleInfo.nextRunText !== "未知" ? ("下次 " + scheduleInfo.nextRunText) : "今日签到结果已写入缓存";
    } else if (record.status === "auth_expired") {
        primary = "授权失效";
        secondary = record.message || "Authorization 可能已过期，需要重新抓包更新";
        statusColor = STATUS_COLORS.authExpired;
        symbol = "sf-symbol:lock.fill";
        footerText = "更新授权后可重新执行";
    } else if (record.status === "failed") {
        primary = isToday ? "签到失败" : "上次签到失败";
        secondary = record.message || record.lastError || "未知错误";
        statusColor = STATUS_COLORS.failed;
        symbol = "sf-symbol:exclamationmark.triangle.fill";
        footerText = scheduleInfo.nextRunText !== "未知"
            ? ("可重新执行，或等待 " + scheduleInfo.nextRunText)
            : "重新执行即可重试";
    } else if (record.status === "not_signed") {
        primary = "今日未签到";
        secondary = record.message || "服务器显示今日尚未签到";
        statusColor = STATUS_COLORS.notSigned;
        symbol = "sf-symbol:xmark.seal.fill";
        footerText = scheduleInfo.nextRunText !== "未知"
            ? ("可重新执行，或等待 " + scheduleInfo.nextRunText)
            : "重新执行即可补签";
    } else if (!isToday) {
        primary = "今日未执行";
        secondary = record.checkedAt
            ? "上次：" + formatMonthDayTime(record.checkedAt) + " · " + (record.title || statusText(record.status))
            : (scheduleInfo.nextRunText !== "未知" ? ("下次执行：" + scheduleInfo.nextRunDetailText) : "等待自动执行签到");
        statusColor = STATUS_COLORS.waiting;
        symbol = "sf-symbol:clock.fill";
        footerText = scheduleInfo.nextRunText !== "未知" ? ("下次 " + scheduleInfo.nextRunText) : "等待自动签到";
    }

    if ((record.status === "success" || record.status === "already_signed") && !isToday) {
        primary = "今日未执行";
        secondary = record.checkedAt
            ? "上次：" + formatMonthDayTime(record.checkedAt) + " · 已签到"
            : (scheduleInfo.nextRunText !== "未知" ? ("下次执行：" + scheduleInfo.nextRunDetailText) : "等待自动执行签到");
        statusColor = STATUS_COLORS.waiting;
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
        nextRunCompactText: buildNextRunCompactText(scheduleInfo.nextRunText, scheduleInfo.countdownText),
        nextRunShortText: buildShortNextRunText(scheduleInfo.nextRunText),
        nextRunMetaText: buildCompactCountdownText(scheduleInfo.countdownText),
        historyText: historyText,
        historySummaryText: buildHistoryCaptionText(historyText),
        historyDetailText: buildHistoryDetailText(historyText),
        blindBox: blindBox,
        blindBoxText: buildBlindBoxWidgetText(blindBox, isToday, false),
        blindBoxCompactText: buildBlindBoxWidgetText(blindBox, isToday, true),
        blindBoxInlineText: buildBlindBoxInlineStatus(blindBox, isToday),
        statusSummaryText: buildStatusSummaryText(record, scheduleInfo, blindBox, isToday),
        compactResultText: buildCompactResultText(record, blindBox, isToday),
        compactActionText: buildCompactActionText(record, scheduleInfo, blindBox, isToday),
        mediumMetaText: buildMediumMetaText(record, scheduleInfo, historyText, blindBox, isToday),
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
            text(resolveCircularMeta(vm), 10, "medium", vm.theme.muted)
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
        infoRow("盲盒", vm.blindBoxCompactText, vm.theme, { maxLines: 1 })
    ], vm, [12, 12, 12, 12]);
}

function buildSmall(vm) {
    return shell([
        text(vm.title, 12, "bold", vm.theme.text, { maxLines: 1, minScale: 0.78, shadowColor: vm.theme.titleShadow, shadowRadius: 5 }),
        spacer(6),
        row([
            image(vm.symbol, 16, vm.statusColor, { shadowColor: vm.theme.iconGlow, shadowRadius: 6 }),
            text(resolveCompactStatus(vm), 16, "bold", vm.statusColor, { flex: 1, maxLines: 1, minScale: 0.78, shadowColor: vm.theme.titleShadow, shadowRadius: 4 })
        ], { alignItems: "center", gap: 6 }),
        spacer(8),
        text(vm.compactResultText, 11, "semibold", vm.theme.text, { maxLines: 1, minScale: 0.76 }),
        spacer(4),
        text(vm.compactActionText, 10, "medium", vm.theme.muted, { maxLines: 1, minScale: 0.78 }),
        spacer(),
        text(buildCompactFooterText(vm, "small"), 10, "medium", vm.theme.footer, { maxLines: 1, minScale: 0.78 })
    ], vm, [12, 12, 12, 12]);
}

function buildMedium(vm) {
    return shell([
        row([
            text(vm.title, 14, "bold", vm.theme.text, { flex: 1, maxLines: 1, minScale: 0.78, shadowColor: vm.theme.titleShadow, shadowRadius: 6 }),
            image(vm.symbol, 18, vm.statusColor, { shadowColor: vm.theme.iconGlow, shadowRadius: 6 })
        ], { alignItems: "center", gap: 8 }),
        spacer(7),
        text(vm.primary, 18, "bold", vm.statusColor, {
            maxLines: 1,
            minScale: 0.74,
            shadowColor: vm.theme.titleShadow,
            shadowRadius: 6
        }),
        spacer(4),
        text(vm.statusSummaryText, 11, "medium", vm.theme.text, { maxLines: 1, minScale: 0.78 }),
        spacer(8),
        separator(vm.theme),
        spacer(7),
        infoRow("盲盒", vm.blindBoxCompactText, vm.theme, {
            labelWidth: 32,
            valueColor: vm.statusColor,
            valueWeight: "semibold",
            valueSize: 12,
            maxLines: 1,
            minScale: 0.8
        }),
        spacer(4),
        infoRow("连签", compactStreak(vm.streakText), vm.theme, {
            labelWidth: 32,
            valueSize: 11,
            maxLines: 1,
            minScale: 0.8
        }),
        spacer(4),
        infoRow("下次", vm.nextRunCompactText, vm.theme, {
            labelWidth: 32,
            valueSize: 11,
            maxLines: 1,
            minScale: 0.8
        }),
        spacer(),
        text(vm.mediumMetaText, 10, "medium", vm.theme.footer, { maxLines: 1, minScale: 0.72 })
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
        infoRow("盲盒", vm.blindBoxText, vm.theme, { maxLines: 2 }),
        spacer(6),
        infoRow("连签", vm.streakText, vm.theme, { maxLines: 1 }),
        spacer(6),
        infoRow("最近", vm.updatedText, vm.theme, { maxLines: 1 }),
        spacer(6),
        infoRow("下次", vm.nextRunDetailText, vm.theme, { maxLines: 2 }),
        spacer(6),
        infoRow("近7天", vm.historyDetailText, vm.theme, { maxLines: 2 }),
        spacer(6),
        infoRow("定时", vm.scheduleText, vm.theme, { maxLines: 1 }),
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
        text(vm.nextRunMetaText || vm.scheduleText || vm.updatedText, 10, "medium", vm.theme.subtle, { maxLines: 1, minScale: 0.82 })
    ], { alignItems: "center", gap: 8 });
}

function buildCompactFooterText(vm, family) {
    if (family === "small") {
        if (vm.isToday && (vm.status === "success" || vm.status === "already_signed")) {
            return vm.nextRunShortText && vm.nextRunShortText !== "待定" ? ("下次 " + vm.nextRunShortText) : compactStreak(vm.streakText);
        }
        if (vm.status === "auth_expired") {
            return "需更新授权";
        }
        if (vm.status === "failed") {
            return "可重试";
        }
        if (vm.status === "not_signed") {
            return "可补签";
        }
        if (vm.nextRunShortText && vm.nextRunShortText !== "待定") {
            return clipText(vm.nextRunShortText, 8);
        }
        return "待自动签到";
    }
    if (vm.status === "auth_expired") {
        return "更新授权后重试";
    }
    if (vm.nextRunCompactText && vm.nextRunCompactText !== "待定") {
        return clipText("下次 " + vm.nextRunCompactText, 24);
    }
    if (vm.status === "failed") {
        return "稍后可重新执行";
    }
    if (vm.status === "not_signed") {
        return "可重新执行";
    }
    return "等待自动签到";
}

function buildStatusSummaryText(record, scheduleInfo, blindBox, isToday) {
    var status = record && record.status;
    if ((status === "success" || status === "already_signed") && isToday) {
        return joinCompactParts([formatStreakDays(record && record.consecutiveDays), buildBlindBoxInlineStatus(blindBox, isToday)], " · ") || "今日已签";
    }
    if (status === "auth_expired") {
        return "更新 Authorization 后重试";
    }
    if (status === "failed") {
        return clipText(shortenWidgetMessage(record.message || record.lastError || "稍后可重试"), 36);
    }
    if (status === "not_signed") {
        return "服务器显示未签，可重新执行";
    }
    return scheduleInfo.nextRunText !== "未知"
        ? ("下次 " + buildNextRunCompactText(scheduleInfo.nextRunText, scheduleInfo.countdownText))
        : "等待自动执行";
}

function buildCompactResultText(record, blindBox, isToday) {
    var status = record && record.status;
    if ((status === "success" || status === "already_signed") && isToday) {
        return buildBlindBoxInlineStatus(blindBox, isToday) || formatStreakDays(record && record.consecutiveDays) || "今日已签";
    }
    if (status === "auth_expired") return "授权过期";
    if (status === "failed") return "签到失败";
    if (status === "not_signed") return "今日未签";
    return "等待执行";
}

function buildCompactActionText(record, scheduleInfo, blindBox, isToday) {
    var status = record && record.status;
    if ((status === "success" || status === "already_signed") && isToday) {
        return formatStreakDays(record && record.consecutiveDays) || "结果已缓存";
    }
    if (status === "auth_expired") return "更新授权后重试";
    if (status === "failed") return "可重试";
    if (status === "not_signed") return "可补签";
    var nextRunShortText = buildShortNextRunText(scheduleInfo.nextRunText);
    return nextRunShortText !== "待定" ? ("下次 " + nextRunShortText) : "待自动签到";
}

function buildMediumMetaText(record, scheduleInfo, historyText, blindBox, isToday) {
    var parts = [];
    var status = record && record.status;
    if (hasHistoryMarks(historyText)) {
        parts.push("近7天 " + historyText);
    }
    if (status === "auth_expired") {
        parts.push("需更新授权");
    } else if (status === "failed") {
        parts.push("可重试");
    } else if (status === "not_signed") {
        parts.push("可补签");
    } else if ((status === "success" || status === "already_signed") && isToday) {
        parts.push(buildBlindBoxInlineStatus(blindBox, isToday));
    } else if (scheduleInfo.countdownText) {
        parts.push(scheduleInfo.countdownText);
    }
    return clipText(joinCompactParts(parts, " · ") || "等待自动签到", 34);
}

function formatStreakDays(days) {
    return days ? ("连签 " + days + " 天") : "";
}

function joinCompactParts(parts, separator) {
    var compact = [];
    for (var i = 0; i < parts.length; i++) {
        var value = trim(parts[i]);
        if (value) compact.push(value);
    }
    return compact.join(separator || " · ");
}

function shortenWidgetMessage(value) {
    return trim(value)
        .replace(/^服务器显示今日已签到，连续\s*/, "连签 ")
        .replace(/^服务器显示今日已完成签到$/, "今日已签")
        .replace(/^服务器显示今日尚未签到$/, "今日未签")
        .replace(/^服务器显示今日未签到，当前连签记录\s*/, "未签 · 连签 ")
        .replace(/^Authorization 可能已过期，需要重新抓包更新$/, "授权过期，需更新")
        .replace(/^今日盲盒已成功开启/, "盲盒已开")
        .replace(/^今日盲盒未开启，/, "")
        .replace(/^服务器显示/, "")
        .replace(/^下次执行：/, "下次 ")
        .replace(/^状态刷新提示：/, "刷新提示：");
}

function buildShortNextRunText(value) {
    var textValue = trim(value);
    if (!textValue || textValue === "未知") return "待定";
    return textValue
        .replace(/^今天\s*/, "今")
        .replace(/^明天\s*/, "明")
        .replace(/\s+/g, "");
}

function buildCompactCountdownText(value) {
    var textValue = trim(value);
    if (!textValue) return "";
    if (textValue === "即将执行") return "即将";
    return textValue.replace(/^还有/, "") + "后";
}

function buildNextRunCompactText(nextRunText, countdownText) {
    var shortText = buildShortNextRunText(nextRunText);
    if (shortText === "待定") return shortText;
    var countdown = buildCompactCountdownText(countdownText);
    return countdown ? (shortText + " · " + countdown) : shortText;
}

function buildHistoryCaptionText(historyText) {
    if (!hasHistoryMarks(historyText)) return "近7天暂无记录";
    return "近7天 " + historyText;
}

function buildHistoryDetailText(historyText) {
    if (!hasHistoryMarks(historyText)) return "暂无记录";
    return historyText + " · 左旧右新";
}

function hasHistoryMarks(historyText) {
    return /[✓✕!○]/.test(String(historyText || ""));
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
        return clipText(vm.title + " 已签到 · " + vm.blindBoxInlineText, 28);
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

function buildBlindBoxResultMessage(blindBox) {
    var box = normalizeBlindBoxResult(blindBox);
    if (!box) return "今日盲盒未查询";

    var nextText = box.nextOpenText || formatBlindBoxNextOpenText(box.nextOpenDays, box.pendingCount || 0, box.availableCount || 0);
    if (box.status === "opened" || box.openedToday) {
        var reward = box.rewardText ? ("：" + box.rewardText) : "";
        var countText = box.openedCount > 1 ? (" " + box.openedCount + " 个") : "";
        var suffix = nextText && nextText !== "暂无待开盲盒" ? ("，" + nextText) : "";
        return "今日盲盒已成功开启" + countText + reward + suffix;
    }
    if (box.status === "not_ready") {
        return "今日盲盒未开启，待开 " + safeCount(box.pendingCount) + " 个，" + nextText;
    }
    if (box.status === "no_box") {
        return "今日盲盒未开启，暂无待开盲盒";
    }
    if (box.status === "disabled") {
        if (box.availableCount > 0) return "今日盲盒未开启，有 " + box.availableCount + " 个可开，自动开盒已关闭";
        return "今日盲盒未开启，自动开盒已关闭，" + nextText;
    }
    if (box.status === "open_failed") {
        return "今日盲盒未成功开启：" + summarizeBlindBoxOpenFailures(box);
    }
    if (box.status === "query_failed") {
        return "今日盲盒未开启，查询失败：" + (box.lastError || "未知错误");
    }
    return box.message || "今日盲盒状态未知";
}

function summarizeBlindBoxOpenFailures(blindBox) {
    var box = normalizeBlindBoxResult(blindBox);
    if (!box || !box.openResults.length) return "未知错误";
    var parts = [];
    for (var i = 0; i < box.openResults.length; i++) {
        if (!box.openResults[i].success) {
            parts.push(box.openResults[i].message || "开启失败");
        }
    }
    return clipText(parts.join("；") || "开启失败", 42);
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

function extractBlindBoxRewardText(payload) {
    var data = ensureObject(payload && payload.data);
    if (Array.isArray(data.rewardList) && data.rewardList.length) {
        var parts = [];
        for (var i = 0; i < data.rewardList.length; i++) {
            var item = ensureObject(data.rewardList[i]);
            var itemText = formatBlindBoxReward(item.rewardType, item.rewardValue);
            if (itemText) parts.push(itemText);
        }
        if (parts.length) return parts.join("、");
    }

    var direct = formatBlindBoxReward(data.rewardType, data.rewardValue);
    if (direct) return direct;

    var candidates = [
        trim(data.rewardDesc),
        trim(data.rewardName),
        trim(data.reward),
        trim(data.awardDesc),
        trim(data.prizeName)
    ];
    for (var j = 0; j < candidates.length; j++) {
        if (candidates[j]) return candidates[j];
    }
    return "";
}

function formatBlindBoxReward(type, value) {
    if (value == null || value === "") return "";
    var rewardType = toIntOrNull(type);
    var unit = rewardType === 1 ? "经验" : rewardType === 2 ? "N币" : "奖励";
    return "+" + value + unit;
}

function resolveCompactStatus(vm) {
    if (vm.status === "auth_expired") return "过期";
    if (vm.status === "failed") return "失败";
    if (vm.status === "not_signed") return "未签";
    if (vm.isToday && (vm.status === "success" || vm.status === "already_signed")) return "已签";
    return "等待";
}

function resolveCircularMeta(vm) {
    if (vm.isToday && (vm.status === "success" || vm.status === "already_signed")) {
        return clipText(vm.blindBoxInlineText || "盒未查", 10);
    }
    return compactStreak(vm.streakText);
}

function buildBlindBoxWidgetText(blindBox, isToday, compact) {
    var box = normalizeBlindBoxResult(blindBox);
    if (!box || !isToday) return compact ? "盲盒未查" : "今日盲盒未查询";
    if (box.openedToday) {
        var reward = box.rewardText ? (" " + box.rewardText) : "";
        return compact ? clipText("已开" + reward, 12) : buildBlindBoxResultMessage(box);
    }
    if (box.status === "not_ready") {
        var next = box.nextOpenText || formatBlindBoxNextOpenText(box.nextOpenDays, box.pendingCount || 0, 0);
        return compact ? clipText(next, 12) : buildBlindBoxResultMessage(box);
    }
    if (box.status === "no_box") return compact ? "暂无待开" : buildBlindBoxResultMessage(box);
    if (box.status === "open_failed") return compact ? "开盒失败" : buildBlindBoxResultMessage(box);
    if (box.status === "query_failed") return compact ? "查询失败" : buildBlindBoxResultMessage(box);
    if (box.status === "disabled") return compact ? "开盒关闭" : buildBlindBoxResultMessage(box);
    return compact ? "盲盒未知" : buildBlindBoxResultMessage(box);
}

function buildBlindBoxInlineStatus(blindBox, isToday) {
    var box = normalizeBlindBoxResult(blindBox);
    if (!box || !isToday) return "盒未查";
    if (box.openedToday) return "盒已开";
    if (box.status === "not_ready") return box.nextOpenText || "盒待开";
    if (box.status === "no_box") return "无待开";
    if (box.status === "open_failed") return "盒失败";
    if (box.status === "query_failed") return "盒异常";
    if (box.status === "disabled") return "盒关闭";
    return "盒未知";
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

function readBool(value, fallback) {
    var normalized = trim(value).toLowerCase();
    if (!normalized) return !!fallback;
    if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") return false;
    return !!fallback;
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
    var parsed = parseCronSchedule(rawText);
    if (!parsed) {
        return {
            scheduleText: rawText + " 自动签到",
            nextRunText: "未知",
            countdownText: "",
            nextRunDetailText: "下次执行未知"
        };
    }

    var now = new Date();
    var target = resolveNextRunTarget(now, parsed);
    var nextRunText = formatNextRunText(now, target);
    var countdownText = formatCountdown(target.getTime() - now.getTime());
    return {
        scheduleText: parsed.scheduleText,
        nextRunText: nextRunText,
        countdownText: countdownText,
        nextRunDetailText: countdownText ? (nextRunText + " · " + countdownText) : nextRunText
    };
}

function parseCronSchedule(value) {
    var parts = trim(value).split(/\s+/);
    if (parts.length !== 5) return null;
    if (parts[2] !== "*" || parts[3] !== "*" || parts[4] !== "*") return null;

    if (!/^\d{1,2}$/.test(parts[0])) return null;
    var minute = parseInt(parts[0], 10);
    if (!isFinite(minute)) return null;
    if (minute < 0 || minute > 59) return null;

    if (parts[1] === "*") {
        return {
            type: "hourly",
            minute: minute,
            scheduleText: minute === 0 ? "每小时整点自动签到" : ("每小时 " + pad2(minute) + " 分自动签到")
        };
    }

    if (!/^\d{1,2}$/.test(parts[1])) return null;
    var hour = parseInt(parts[1], 10);
    if (!isFinite(hour)) return null;
    if (hour < 0 || hour > 23) return null;
    return {
        type: "daily",
        minute: minute,
        hour: hour,
        scheduleText: "每天 " + pad2(hour) + ":" + pad2(minute) + " 自动签到"
    };
}

function resolveNextRunTarget(now, schedule) {
    if (schedule.type === "hourly") {
        var hourlyTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), schedule.minute, 0, 0);
        if (now.getTime() >= hourlyTarget.getTime()) {
            hourlyTarget.setHours(hourlyTarget.getHours() + 1);
        }
        return hourlyTarget;
    }

    var dailyTarget = new Date(now.getFullYear(), now.getMonth(), now.getDate(), schedule.hour, schedule.minute, 0, 0);
    if (now.getTime() >= dailyTarget.getTime()) {
        dailyTarget.setDate(dailyTarget.getDate() + 1);
    }
    return dailyTarget;
}

function formatNextRunText(now, target) {
    var timeText = pad2(target.getHours()) + ":" + pad2(target.getMinutes());
    if (dateKeyFromDate(now) === dateKeyFromDate(target)) return "今天 " + timeText;

    var tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (dateKeyFromDate(tomorrow) === dateKeyFromDate(target)) return "明天 " + timeText;

    return pad2(target.getMonth() + 1) + "-" + pad2(target.getDate()) + " " + timeText;
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

function safeCount(value) {
    var num = toIntOrNull(value);
    return num == null ? 0 : num;
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

var AUTH_KEY = "ninebot_auth_v1";
var DEVICES_KEY = "ninebot_devices_v1";
var DYNAMIC_KEY = "ninebot_dynamic_v1";
var META_KEY = "ninebot_meta_v1";

var LOGIN_BASE_URL = "https://api-passport-bj.ninebot.com";
var LOGIN_PATH = "/v3/openClaw/user/login";
var DEVICE_BASE_URL = "https://cn-cbu-gateway.ninebot.com";
var DEVICES_PATH = "/app-api/inner/device/ai/get-device-list";
var DEVICE_DYNAMIC_INFO_PATH = "/app-api/inner/device/ai/get-device-dynamic-info";

var DEFAULT_TIMEOUT_MS = 15000;
var DEFAULT_REFRESH_MINUTES = 15;
var DEFAULT_DEVICE_LIST_REFRESH_HOURS = 24;
var DEFAULT_TOKEN_REFRESH_HOURS = 24;
var DEFAULT_MAX_VEHICLES = 5;

export default async function (ctx) {
    var env = ctx.env || {};
    var family = ctx.widgetFamily || "systemMedium";
    var title = trim(env.TITLE) || "Ninebot";
    var accent = trim(env.ACCENT_COLOR) || "#34D399";
    var refreshMinutes = clampInt(env.REFRESH_MINUTES, 5, 1440, DEFAULT_REFRESH_MINUTES);
    var deviceListRefreshHours = clampInt(env.DEVICE_LIST_REFRESH_HOURS, 1, 168, DEFAULT_DEVICE_LIST_REFRESH_HOURS);
    var tokenRefreshHours = clampInt(env.TOKEN_REFRESH_HOURS, 1, 168, DEFAULT_TOKEN_REFRESH_HOURS);
    var maxVehicles = clampInt(env.MAX_VEHICLES, 1, 10, DEFAULT_MAX_VEHICLES);
    var timeoutMs = clampInt(env.TIMEOUT_MS, 3000, 60000, DEFAULT_TIMEOUT_MS);
    var lang = trim(env.LANG) || "zh";
    var username = trim(env.USERNAME);
    var password = String(env.PASSWORD || "");
    var primaryDeviceId = trim(env.PRIMARY_DEVICE_ID) || trim(env.PRIMARY_SN);
    var forceRefresh = isTrue(env.FORCE_REFRESH);
    var openUrl = trim(env.OPEN_URL);
    var refreshAfter = new Date(Date.now() + refreshMinutes * 60 * 1000).toISOString();

    if (!username) return errorWidget("缺少配置", "请设置 USERNAME");
    if (!password) return errorWidget("缺少配置", "请设置 PASSWORD");

    var config = {
        family: family,
        title: title,
        accent: accent,
        refreshMinutes: refreshMinutes,
        deviceListRefreshHours: deviceListRefreshHours,
        tokenRefreshHours: tokenRefreshHours,
        maxVehicles: maxVehicles,
        timeoutMs: timeoutMs,
        lang: lang,
        username: username,
        password: password,
        primaryDeviceId: primaryDeviceId,
        forceRefresh: forceRefresh,
        openUrl: openUrl
    };

    try {
        var state = await loadAccountState(ctx, config);
        var vm = buildViewModel(state, config);

        if (family === "accessoryCircular") return buildCircular(vm, accent);
        if (family === "accessoryRectangular") return buildRectangular(vm, accent, title);
        if (family === "accessoryInline") return buildInline(vm, accent);
        if (family === "systemSmall") return buildSmall(vm, title, accent, refreshAfter);
        if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(vm, title, accent, refreshAfter);
        return buildMedium(vm, title, accent, refreshAfter);
    } catch (e) {
        return errorWidget("Ninebot 加载失败", safeMsg(e));
    }
}

async function loadAccountState(ctx, config) {
    var auth = ensureObject(loadJSON(ctx, AUTH_KEY));
    var devicesCache = ensureObject(loadJSON(ctx, DEVICES_KEY));
    var dynamicCache = ensureObject(loadJSON(ctx, DYNAMIC_KEY));
    var meta = ensureObject(loadJSON(ctx, META_KEY));

    var devices = toObjectArray(devicesCache.items);
    var dynamicItems = ensureObject(dynamicCache.items);
    var errors = [];
    var usedNetwork = false;
    var now = Date.now();

    var shouldRefreshDevices = config.forceRefresh || devices.length === 0 || isExpired(devicesCache.ts, config.deviceListRefreshHours * 3600000);
    if (shouldRefreshDevices) {
        try {
            devices = await withAuthRetry(ctx, config, auth, async function (token) {
                return await fetchDevices(ctx, config, token);
            });
            devicesCache = {
                ts: now,
                updatedAt: new Date(now).toISOString(),
                items: devices
            };
            saveJSON(ctx, DEVICES_KEY, devicesCache);
            usedNetwork = true;
        } catch (e) {
            errors.push("车辆列表：" + safeMsg(e));
            if (!devices.length) throw new Error("无法获取车辆列表：" + safeMsg(e));
        }
    }

    devices = orderDevices(devices, config.primaryDeviceId || meta.primarySn);
    if (!devices.length) throw new Error("当前账号下没有可展示车辆");

    var displayCount = resolveDisplayCount(config.family, config.maxVehicles);
    var targetDevices = devices.slice(0, displayCount);
    var staleSns = [];

    for (var i = 0; i < targetDevices.length; i++) {
        var sn = normalizeDeviceSN(targetDevices[i]);
        if (!sn) continue;
        if (needsDynamicRefresh(dynamicItems[sn], config.refreshMinutes, config.forceRefresh)) {
            staleSns.push(sn);
        }
    }

    if (staleSns.length) {
        try {
            var batch = await withAuthRetry(ctx, config, auth, async function (token) {
                return await fetchDynamicMany(ctx, config, staleSns, token);
            });
            var fetchedAt = new Date().toISOString();
            var okKeys = Object.keys(batch.items);
            if (okKeys.length > 0) usedNetwork = true;

            for (var j = 0; j < okKeys.length; j++) {
                var key = okKeys[j];
                dynamicItems[key] = {
                    ts: Date.now(),
                    updatedAt: fetchedAt,
                    data: batch.items[key]
                };
            }

            if (okKeys.length > 0) {
                saveJSON(ctx, DYNAMIC_KEY, {
                    updatedAt: fetchedAt,
                    items: dynamicItems
                });
            }

            var errorKeys = Object.keys(batch.errors);
            for (var k = 0; k < errorKeys.length && k < 2; k++) {
                errors.push(errorKeys[k] + "：" + safeMsg(batch.errors[errorKeys[k]]));
            }
        } catch (e) {
            errors.push("车辆状态：" + safeMsg(e));
        }
    }

    var vehicles = devices.map(function (device, index) {
        var sn = normalizeDeviceSN(device);
        return normalizeVehicle(device, dynamicItems[sn], {
            isPrimary: index === 0,
            accent: config.accent
        });
    });

    var displayVehicles = vehicles.slice(0, displayCount);
    var primary = vehicles[0];
    var latestUpdatedAt = latestVehicleUpdate(displayVehicles) || parseDateInput(devicesCache.updatedAt) || new Date().toISOString();

    meta.primarySn = primary ? primary.sn : "";
    meta.lastUpdatedAt = latestUpdatedAt;
    saveJSON(ctx, META_KEY, meta);

    return {
        usedNetwork: usedNetwork,
        errors: errors,
        vehicles: vehicles,
        displayVehicles: displayVehicles,
        primary: primary,
        updatedAt: latestUpdatedAt,
        counts: buildCounts(displayVehicles, vehicles.length),
        openUrl: config.openUrl
    };
}

async function withAuthRetry(ctx, config, auth, work) {
    try {
        var token = await ensureToken(ctx, config, auth, false);
        return await work(token);
    } catch (e) {
        if (!isAuthError(e)) throw e;
        clearAuth(auth);
        saveJSON(ctx, AUTH_KEY, auth);
        var nextToken = await ensureToken(ctx, config, auth, true);
        return await work(nextToken);
    }
}

async function ensureToken(ctx, config, auth, forceLogin) {
    auth = ensureObject(auth);
    var now = Date.now();
    var sameUser = trim(auth.username) === config.username;
    var hasToken = sameUser && trim(auth.accessToken);
    var expired = hasToken && auth.expiresAt && now >= Number(auth.expiresAt) - 30000;
    var unchecked = !auth.tokenCheckedAt;
    var outdated = auth.tokenCheckedAt && (now - Number(auth.tokenCheckedAt) >= config.tokenRefreshHours * 3600000);

    if (!forceLogin && hasToken && !expired && !unchecked && !outdated) {
        return auth.accessToken;
    }

    return await login(ctx, config, auth);
}

async function login(ctx, config, auth) {
    var response = await postJson(ctx, LOGIN_BASE_URL + LOGIN_PATH, {
        username: config.username,
        password: config.password
    }, {
        "Content-Type": "application/json",
        clientId: "open_claw_client",
        timestamp: String(Date.now())
    }, config.timeoutMs);

    var data = ensureObject(response.data);
    var token = trim(data.access_token);
    if (!token) {
        var loginMessage = resultMessage(response) || "登录失败";
        if (isAuthMessage(loginMessage)) throw makeError("AUTH", loginMessage);
        if (!resultOk(response)) throw makeError("API", "登录失败：" + loginMessage);
        throw makeError("API", "登录返回缺少 access_token");
    }

    var validity = toNumber(data.accessTokenValidity);
    auth.username = config.username;
    auth.accessToken = token;
    auth.refreshToken = trim(data.refresh_token);
    auth.tokenCheckedAt = Date.now();
    auth.expiresAt = isFiniteNumber(validity) ? (Date.now() + validity * 1000) : null;
    saveJSON(ctx, AUTH_KEY, auth);
    return token;
}

async function fetchDevices(ctx, config, token) {
    var response = await postJson(ctx, DEVICE_BASE_URL + DEVICES_PATH, {
        access_token: token,
        lang: config.lang
    }, {
        "Content-Type": "application/json"
    }, config.timeoutMs);

    if (!resultOk(response)) {
        var message = resultMessage(response) || "车辆列表请求失败";
        if (isAuthMessage(message)) throw makeError("AUTH", message);
        throw makeError("API", message);
    }

    var data = Array.isArray(response.data) ? response.data : null;
    if (!data) throw makeError("API", "车辆列表返回格式异常");

    return data.filter(function (item) {
        return isObject(item) && !!normalizeDeviceSN(item);
    });
}

async function fetchDynamicMany(ctx, config, sns, token) {
    var items = {};
    var errors = {};
    var tasks = sns.map(async function (sn) {
        try {
            items[sn] = await fetchDynamic(ctx, config, token, sn);
        } catch (e) {
            errors[sn] = e;
        }
    });
    await Promise.all(tasks);
    return { items: items, errors: errors };
}

async function fetchDynamic(ctx, config, token, sn) {
    var response = await postJson(ctx, DEVICE_BASE_URL + DEVICE_DYNAMIC_INFO_PATH, {
        access_token: token,
        sn: sn
    }, {
        "Content-Type": "application/json"
    }, config.timeoutMs);

    if (!resultOk(response)) {
        var message = resultMessage(response) || (sn + " 状态请求失败");
        if (isAuthMessage(message)) throw makeError("AUTH", message);
        throw makeError("API", message);
    }

    var data = ensureObject(response.data);
    if (!Object.keys(data).length) throw makeError("API", sn + " 返回了空状态");
    return data;
}

async function postJson(ctx, url, payload, headers, timeoutMs) {
    var response;
    try {
        response = await ctx.http.post(url, {
            headers: headers || { "Content-Type": "application/json" },
            body: payload,
            timeout: timeoutMs || DEFAULT_TIMEOUT_MS
        });
    } catch (e) {
        throw makeError("NETWORK", "连接 Ninebot 云端失败：" + safeMsg(e));
    }

    if (!response || response.status !== 200) {
        throw makeError("HTTP", "HTTP " + (response ? response.status : "--"));
    }

    try {
        return await response.json();
    } catch (e2) {
        throw makeError("PARSE", "接口返回不是有效 JSON");
    }
}

function buildViewModel(state, config) {
    var theme = resolveTheme(config.accent);
    var status = resolveAccountStatus(state);
    var displayVehicles = Array.isArray(state.displayVehicles) ? state.displayVehicles : [];
    var primary = state.primary || displayVehicles[0];

    return {
        title: config.title,
        accent: config.accent,
        theme: theme,
        primary: primary,
        displayVehicles: displayVehicles,
        secondaryVehicles: displayVehicles.slice(1),
        summary: {
            total: state.counts.total,
            loadedText: state.counts.available + "/" + state.counts.display,
            averageBatteryText: state.counts.averageBattery == null ? "--" : state.counts.averageBattery + "%",
            chargingText: String(state.counts.charging)
        },
        updatedAt: parseDateInput(state.updatedAt) || new Date().toISOString(),
        statusText: status.text,
        statusColor: status.color,
        statusBg: status.bg,
        errorText: state.errors && state.errors.length ? state.errors[0] : "",
        openUrl: config.openUrl || ""
    };
}

function resolveTheme(accent) {
    return {
        accent: accent || "#34D399",
        gradient: ["#08111F", "#0F172A", "#172033"],
        text: "#FFFFFF",
        muted: "rgba(255,255,255,0.72)",
        subtle: "rgba(255,255,255,0.45)",
        highlight: "rgba(255,255,255,0.08)",
        line: "rgba(255,255,255,0.06)",
        rowBg: "rgba(255,255,255,0.04)"
    };
}

function resolveAccountStatus(state) {
    var hasErrors = state.errors && state.errors.length > 0;
    if (hasErrors && state.displayVehicles && state.displayVehicles.length > 0) {
        return {
            text: state.usedNetwork ? "部分实时" : "缓存降级",
            color: "#FBBF24",
            bg: "rgba(251,191,36,0.16)"
        };
    }
    if (state.usedNetwork) {
        return {
            text: "实时",
            color: "#34D399",
            bg: "rgba(52,211,153,0.16)"
        };
    }
    return {
        text: "缓存",
        color: "#FBBF24",
        bg: "rgba(251,191,36,0.16)"
    };
}

function buildSmall(vm, title, accent, refreshAfter) {
    var v = vm.primary;
    var children = [
        header(title, vm, accent, false),
        sp(8),
        txt(v.name, 13, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 }),
        txt(v.model || v.sn, 10, "medium", vm.theme.subtle, { maxLines: 1, minScale: 0.7 }),
        sp(8),
        hstack([
            icon(batteryIcon(v.battery), 16, batteryColor(v.battery, accent)),
            txt(v.batteryText, 32, "bold", "#FFFFFF", { minScale: 0.55, maxLines: 1 }),
            sp(6),
            vstack([
                txt(v.lockText, 11, "semibold", v.lockColor, { maxLines: 1 }),
                txt(v.charging ? v.chargingText : v.onlineText, 10, "medium", v.charging ? "#A78BFA" : vm.theme.muted, { maxLines: 1, minScale: 0.7 })
            ], { gap: 2, alignItems: "start", flex: 1 })
        ], { gap: 6, alignItems: "center" }),
        sp(6),
        batteryBar(v.battery, accent, vm.theme),
        sp(6),
        hstack([
            lockTag(v),
            stateTag(v)
        ], { gap: 6 }),
        sp(6),
        hstack([
            metricInline("信号", v.signalShort),
            sp(8),
            metricInline("续航", compactRange(v.rangeKm))
        ], { gap: 0 })
    ];

    if (vm.errorText) {
        children.push(sp(6));
        children.push(warningLine(vm.errorText, vm.theme));
    }

    children.push(sp());
    children.push(footer(vm));
    return shell(children, refreshAfter, vm.openUrl, [14, 16, 12, 16], vm.theme);
}

function buildMedium(vm, title, accent, refreshAfter) {
    var secondary = vm.secondaryVehicles.slice(0, 2);
    var children = [
        header(title, vm, accent, true),
        sp(6),
        separator(vm.theme),
        sp(8),
        hstack([
            vstack([
                txt("主车", 10, "medium", vm.theme.subtle),
                sp(2),
                txt(vm.primary.name, 14, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 }),
                txt(vm.primary.model || vm.primary.sn, 10, "medium", vm.theme.subtle, { maxLines: 1, minScale: 0.7 }),
                sp(6),
                hstack([
                    icon(batteryIcon(vm.primary.battery), 16, batteryColor(vm.primary.battery, accent)),
                    txt(vm.primary.batteryText, 28, "bold", "#FFFFFF", { minScale: 0.55, maxLines: 1 }),
                    sp(6),
                    txt(vm.primary.rangeText, 10, "medium", vm.theme.muted, { maxLines: 1, minScale: 0.7 })
                ], { gap: 6, alignItems: "center" }),
                sp(4),
                batteryBar(vm.primary.battery, accent, vm.theme),
                sp(6),
                hstack([
                    lockTag(vm.primary),
                    stateTag(vm.primary)
                ], { gap: 6 }),
                sp(6),
                hstack([
                    metricInline("信号", vm.primary.signalShort),
                    sp(8),
                    metricInline("更新", vm.primary.updatedText)
                ], { gap: 0 })
            ], { flex: 1, gap: 0, alignItems: "start" }),
            sp(10),
            vstack([
                txt("其他车辆", 10, "medium", vm.theme.subtle),
                sp(2),
                secondary.length ? vstack(secondary.map(function (item) {
                    return compactVehicleRow(item, vm.theme, accent);
                }), { gap: 6, alignItems: "start" }) : txt("仅 1 辆车", 11, "medium", vm.theme.muted)
            ], { flex: 1, gap: 0, alignItems: "start" })
        ], { gap: 0, alignItems: "start" })
    ];

    if (vm.errorText) {
        children.push(sp(8));
        children.push(warningLine(vm.errorText, vm.theme));
    }

    children.push(sp());
    children.push(footer(vm));
    return shell(children, refreshAfter, vm.openUrl, [12, 14, 10, 14], vm.theme);
}

function buildLarge(vm, title, accent, refreshAfter) {
    var secondary = vm.secondaryVehicles.slice(0, 4);
    var children = [
        header(title, vm, accent, true),
        sp(6),
        hstack([
            summaryPill("车辆", String(vm.summary.total), vm.theme),
            summaryPill("已载入", vm.summary.loadedText, vm.theme),
            summaryPill("均电", vm.summary.averageBatteryText, vm.theme),
            summaryPill("充电", vm.summary.chargingText, vm.theme)
        ], { gap: 6 }),
        sp(10),
        primaryHero(vm.primary, vm.theme, accent),
        sp(8),
        separator(vm.theme),
        sp(8),
        txt("车辆列表", 10, "medium", vm.theme.subtle)
    ];

    if (secondary.length) {
        children.push(sp(4));
        children.push(vstack(secondary.map(function (item, index) {
            return detailedVehicleRow(item, vm.theme, accent, index === secondary.length - 1);
        }), { gap: 0, alignItems: "start" }));
    } else {
        children.push(sp(6));
        children.push(txt("当前账号仅有 1 辆车", 11, "medium", vm.theme.muted));
    }

    if (vm.errorText) {
        children.push(sp(8));
        children.push(warningLine(vm.errorText, vm.theme));
    }

    children.push(sp());
    children.push(footer(vm));
    return shell(children, refreshAfter, vm.openUrl, [14, 16, 12, 16], vm.theme);
}

function buildCircular(vm, accent) {
    var v = vm.primary;
    return {
        type: "widget",
        url: vm.openUrl || undefined,
        gap: 2,
        children: [
            sp(),
            icon(v.lockRaw === 0 ? "lock.fill" : "lock.open.fill", 14, v.lockRaw === 0 ? "#60A5FA" : accent),
            txt(v.batteryShort, 13, "bold", "#FFFFFF", { minScale: 0.6, maxLines: 1 }),
            txt("电量", 8, "medium", "rgba(255,255,255,0.65)", { maxLines: 1 }),
            sp()
        ]
    };
}

function buildRectangular(vm, accent, title) {
    var v = vm.primary;
    return {
        type: "widget",
        url: vm.openUrl || undefined,
        gap: 3,
        children: [
            hstack([
                icon("bolt.circle.fill", 10, accent),
                txt(title, 10, "medium", "rgba(255,255,255,0.72)", { maxLines: 1, minScale: 0.7 }),
                sp(),
                txt(vm.statusText, 9, "bold", vm.statusColor, { maxLines: 1 })
            ], { gap: 4 }),
            txt(v.name + " · " + v.batteryText, 12, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.6 }),
            txt(v.lockText + " · " + (v.charging ? v.chargingText : v.onlineText), 10, "medium", "rgba(255,255,255,0.55)", { maxLines: 1, minScale: 0.7 })
        ]
    };
}

function buildInline(vm, accent) {
    var v = vm.primary;
    return {
        type: "widget",
        url: vm.openUrl || undefined,
        children: [
            icon("bolt.circle.fill", 12, accent),
            txt(" " + v.name + " " + v.batteryText + " " + v.lockText, 12, "medium", "#FFFFFF", {
                maxLines: 1,
                minScale: 0.6
            })
        ]
    };
}

function shell(children, refreshAfter, url, padding, theme) {
    var widget = {
        type: "widget",
        padding: padding || [14, 16, 12, 16],
        gap: 0,
        refreshAfter: refreshAfter,
        backgroundGradient: {
            type: "linear",
            colors: theme && theme.gradient ? theme.gradient : ["#08111F", "#0F172A", "#172033"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        children: children
    };
    if (url) widget.url = url;
    return widget;
}

function header(title, vm, accent, showCount) {
    var children = [
        icon("bolt.circle.fill", 12, accent),
        txt(title, 12, "bold", accent, { maxLines: 1, minScale: 0.7 }),
        sp()
    ];
    if (showCount) {
        children.push(txt(vm.summary.total + " 辆", 10, "medium", vm.theme.subtle, { maxLines: 1 }));
    }
    return hstack(children, { gap: 6 });
}

function footer(vm) {
    return hstack([
        tag(vm.statusText, vm.statusColor, vm.statusBg, 8),
        sp(),
        {
            type: "date",
            date: vm.updatedAt,
            format: "relative",
            font: { size: 9, weight: "medium" },
            textColor: vm.theme.subtle
        }
    ], { gap: 4 });
}

function primaryHero(vehicle, theme, accent) {
    return hstack([
        vstack([
            txt("主车", 10, "medium", theme.subtle),
            sp(2),
            txt(vehicle.name, 16, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 }),
            txt(vehicle.model || vehicle.sn, 10, "medium", theme.subtle, { maxLines: 1, minScale: 0.7 }),
            sp(6),
            hstack([
                lockTag(vehicle),
                stateTag(vehicle),
                signalTag(vehicle)
            ], { gap: 6 }),
            sp(6),
            hstack([
                metricInline("续航", compactRange(vehicle.rangeKm)),
                sp(10),
                metricInline("更新", vehicle.updatedText)
            ], { gap: 0 })
        ], { flex: 1, gap: 0, alignItems: "start" }),
        sp(10),
        vstack([
            icon(batteryIcon(vehicle.battery), 18, batteryColor(vehicle.battery, accent)),
            txt(vehicle.batteryText, 34, "bold", "#FFFFFF", { minScale: 0.55, maxLines: 1 }),
            txt(vehicle.charging ? vehicle.chargingText : vehicle.onlineText, 10, "medium", vehicle.charging ? "#A78BFA" : theme.muted, { maxLines: 1, minScale: 0.7 })
        ], { gap: 2, alignItems: "center" })
    ], { gap: 0, alignItems: "center" });
}

function compactVehicleRow(vehicle, theme, accent) {
    return vstack([
        hstack([
            txt(vehicle.name, 11, "semibold", "#FFFFFF", { maxLines: 1, minScale: 0.65 }),
            sp(),
            txt(vehicle.batteryText, 11, "bold", batteryColor(vehicle.battery, accent), { maxLines: 1 })
        ], { gap: 4 }),
        hstack([
            txt(vehicle.lockText, 9, "medium", vehicle.lockColor, { maxLines: 1 }),
            sp(6),
            txt(vehicle.charging ? vehicle.chargingText : vehicle.onlineText, 9, "medium", vehicle.charging ? "#A78BFA" : theme.muted, { maxLines: 1, minScale: 0.7 }),
            sp(),
            txt(vehicle.updatedText, 9, "medium", theme.subtle, { maxLines: 1 })
        ], { gap: 4 })
    ], {
        gap: 4,
        padding: [8, 10, 8, 10],
        backgroundColor: theme.rowBg,
        borderRadius: 10,
        width: 0
    });
}

function detailedVehicleRow(vehicle, theme, accent, isLast) {
    return vstack([
        hstack([
            vstack([
                txt(vehicle.name, 12, "semibold", "#FFFFFF", { maxLines: 1, minScale: 0.7 }),
                txt(vehicle.model || vehicle.sn, 9, "medium", theme.subtle, { maxLines: 1, minScale: 0.7 })
            ], { flex: 1, gap: 2, alignItems: "start" }),
            sp(10),
            txt(vehicle.batteryText, 11, "bold", batteryColor(vehicle.battery, accent), { maxLines: 1 }),
            sp(8),
            txt(vehicle.lockText, 9, "medium", vehicle.lockColor, { maxLines: 1 }),
            sp(8),
            txt(vehicle.charging ? "充电" : vehicle.onlineText, 9, "medium", vehicle.charging ? "#A78BFA" : vehicle.onlineColor, { maxLines: 1 }),
            sp(8),
            txt(compactRange(vehicle.rangeKm), 9, "medium", theme.muted, { maxLines: 1 }),
            sp(8),
            txt(vehicle.updatedText, 9, "medium", theme.subtle, { maxLines: 1 })
        ], { gap: 0, alignItems: "center" }),
        isLast ? sp(0) : separator(theme)
    ], { gap: 8, alignItems: "start", width: 0 });
}

function warningLine(text, theme) {
    return hstack([
        icon("exclamationmark.triangle.fill", 10, "#FBBF24"),
        txt(text, 10, "medium", theme.muted, { maxLines: 1, minScale: 0.65 })
    ], { gap: 6 });
}

function summaryPill(label, value, theme) {
    return hstack([
        txt(label, 9, "medium", theme.subtle, { maxLines: 1 }),
        txt(value || "--", 10, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 })
    ], {
        gap: 4,
        padding: [4, 8, 4, 8],
        backgroundColor: theme.highlight,
        borderRadius: 8
    });
}

function lockTag(vehicle) {
    return tag(vehicle.lockText, vehicle.lockColor, vehicle.lockBg, 9);
}

function stateTag(vehicle) {
    if (vehicle.charging) return tag(vehicle.chargingText, "#A78BFA", "rgba(167,139,250,0.18)", 9);
    return tag(vehicle.onlineText, vehicle.onlineColor, vehicle.onlineBg, 9);
}

function signalTag(vehicle) {
    return tag(vehicle.signalShort, "rgba(255,255,255,0.82)", "rgba(255,255,255,0.08)", 9);
}

function metricInline(label, value) {
    return hstack([
        txt(label, 9, "medium", "rgba(255,255,255,0.5)"),
        txt(value || "--", 10, "semibold", "#FFFFFF")
    ], { gap: 4 });
}

function batteryBar(value, accent, theme) {
    var safe = isFiniteNumber(value) ? clampNumber(value / 100, 0, 1) : 0.02;
    return {
        type: "stack",
        direction: "row",
        height: 6,
        borderRadius: 3,
        backgroundColor: theme.highlight,
        children: [
            {
                type: "stack",
                flex: Math.max(0.02, safe),
                height: 6,
                borderRadius: 3,
                backgroundColor: batteryColor(value, accent),
                children: []
            },
            {
                type: "stack",
                flex: Math.max(0, 1 - safe),
                children: []
            }
        ]
    };
}

function separator(theme) {
    return hstack([sp()], {
        height: 1,
        backgroundColor: theme.line
    });
}

function errorWidget(title, message) {
    return {
        type: "widget",
        padding: 16,
        gap: 8,
        backgroundGradient: {
            type: "linear",
            colors: ["#08111F", "#0F172A"],
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 1, y: 1 }
        },
        children: [
            hstack([
                icon("exclamationmark.triangle.fill", 14, "#F87171"),
                txt(title, 13, "bold", "#FFFFFF", { maxLines: 1, minScale: 0.7 })
            ], { gap: 6 }),
            txt(message || "未知错误", 11, "medium", "rgba(255,255,255,0.72)", {
                maxLines: 5,
                minScale: 0.75
            })
        ]
    };
}

function normalizeVehicle(device, entry, opts) {
    opts = opts || {};
    var raw = entry && isObject(entry.data) ? entry.data : {};
    var state = normalizeState(raw);
    var battery = toNumber(state.battery);
    var lockRaw = toInt(state.status);
    var chargingRaw = toInt(state.chargingState);
    var powerRaw = toInt(state.pwr);
    var rangeKm = toNumber(state.estimateMileage);
    var remainChargeTime = toNumber(state.remainChargeTime);
    var updatedAt = parseDateInput(entry && entry.updatedAt) || normalizeTimestampToIso(state.gsmTime) || "";
    var online = powerRaw === 1 ? true : (powerRaw === 0 ? false : null);

    return {
        id: normalizeDeviceIdentity(device) || normalizeDeviceSN(device),
        sn: normalizeDeviceSN(device),
        name: trim(device.deviceName) || trim(device.name) || trim(device.productName) || normalizeDeviceSN(device) || "未知车辆",
        model: trim(device.model) || trim(device.productName) || "",
        image: trim(device.img) || trim(device.image) || "",
        isPrimary: !!opts.isPrimary,
        battery: isFiniteNumber(battery) ? clampNumber(battery, 0, 100) : null,
        batteryText: isFiniteNumber(battery) ? (Math.round(clampNumber(battery, 0, 100)) + "%") : "--",
        batteryShort: isFiniteNumber(battery) ? String(Math.round(clampNumber(battery, 0, 100))) : "--",
        lockRaw: lockRaw,
        lockText: lockText(lockRaw),
        lockColor: lockColor(lockRaw),
        lockBg: lockBg(lockRaw),
        charging: chargingRaw === 1,
        chargingText: chargingRaw === 1 ? "充电中" : "未充电",
        online: online,
        onlineText: online === true ? "在线" : (online === false ? "离线" : "未知"),
        onlineColor: online === true ? "#34D399" : (online === false ? "#94A3B8" : "#CBD5E1"),
        onlineBg: online === true ? "rgba(52,211,153,0.16)" : "rgba(148,163,184,0.16)",
        signal: toInt(state.gsm),
        signalText: formatSignal(state.gsm),
        signalShort: signalLevel(state.gsm),
        rangeKm: isFiniteNumber(rangeKm) ? roundNumber(rangeKm, 1) : null,
        rangeText: isFiniteNumber(rangeKm) ? ("续航 " + compactRange(rangeKm)) : "续航 --",
        remainChargeTime: isFiniteNumber(remainChargeTime) ? remainChargeTime : null,
        remainChargeText: isFiniteNumber(remainChargeTime) ? formatMinutes(remainChargeTime) : "--",
        updatedAt: updatedAt,
        updatedText: updatedAt ? formatClock(updatedAt) : "--",
        locationText: formatLocation(state.locationInfo)
    };
}

function normalizeState(raw) {
    raw = ensureObject(raw);
    return {
        battery: firstPresent(raw.battery, raw.dumpEnergy),
        status: firstPresent(raw.status, raw.powerStatus),
        chargingState: raw.chargingState,
        pwr: raw.pwr,
        gsm: raw.gsm,
        estimateMileage: firstPresent(raw.estimateMileage, raw.mileage),
        remainChargeTime: raw.remainChargeTime,
        gsmTime: raw.gsmTime,
        locationInfo: ensureObject(raw.locationInfo)
    };
}

function buildCounts(displayVehicles, totalVehicles) {
    var available = 0;
    var charging = 0;
    var batterySum = 0;
    var batteryCount = 0;

    for (var i = 0; i < displayVehicles.length; i++) {
        var item = displayVehicles[i];
        if (item && item.updatedAt) available += 1;
        if (item && item.charging) charging += 1;
        if (item && isFiniteNumber(item.battery)) {
            batterySum += Number(item.battery);
            batteryCount += 1;
        }
    }

    return {
        total: totalVehicles,
        display: displayVehicles.length,
        available: available,
        charging: charging,
        averageBattery: batteryCount ? Math.round(batterySum / batteryCount) : null
    };
}

function latestVehicleUpdate(vehicles) {
    var latest = 0;
    for (var i = 0; i < vehicles.length; i++) {
        var iso = vehicles[i] && vehicles[i].updatedAt;
        var ts = iso ? new Date(iso).getTime() : 0;
        if (isFiniteNumber(ts) && ts > latest) latest = ts;
    }
    return latest > 0 ? new Date(latest).toISOString() : "";
}

function resolveDisplayCount(family, maxVehicles) {
    if (family === "systemSmall" || family === "accessoryCircular" || family === "accessoryRectangular" || family === "accessoryInline") {
        return 1;
    }
    if (family === "systemLarge" || family === "systemExtraLarge") {
        return Math.min(5, maxVehicles);
    }
    return Math.min(3, maxVehicles);
}

function needsDynamicRefresh(entry, refreshMinutes, forceRefresh) {
    if (forceRefresh) return true;
    if (!isObject(entry) || !isObject(entry.data)) return true;
    return isExpired(entry.ts, refreshMinutes * 60 * 1000);
}

function orderDevices(devices, preferredId) {
    var list = devices.filter(function (item) {
        return isObject(item) && !!normalizeDeviceSN(item);
    });
    if (!preferredId) return list;

    var target = String(preferredId).trim().toLowerCase();
    var index = -1;
    for (var i = 0; i < list.length; i++) {
        if (matchesDevice(list[i], target)) {
            index = i;
            break;
        }
    }
    if (index <= 0) return list;
    var first = list.splice(index, 1)[0];
    list.unshift(first);
    return list;
}

function matchesDevice(device, preferred) {
    if (!preferred) return false;
    var candidates = [
        device.sn,
        device.deviceId,
        device.id,
        device.vehicleId,
        device.uuid,
        device.serialNumber
    ];
    for (var i = 0; i < candidates.length; i++) {
        var value = String(candidates[i] == null ? "" : candidates[i]).trim().toLowerCase();
        if (value && value === preferred) return true;
    }
    return false;
}

function normalizeDeviceSN(device) {
    return trim(device && device.sn);
}

function normalizeDeviceIdentity(device) {
    var candidates = [
        device && device.deviceId,
        device && device.id,
        device && device.vehicleId,
        device && device.sn
    ];
    for (var i = 0; i < candidates.length; i++) {
        var value = trim(candidates[i]);
        if (value) return value;
    }
    return "";
}

function resultOk(payload) {
    payload = ensureObject(payload);
    var code = payload.resultCode;
    if (code == null) code = payload.code;
    if (code == null) return true;
    var n = parseInt(code, 10);
    return n === 0 || n === 1;
}

function resultMessage(payload) {
    payload = ensureObject(payload);
    return trim(payload.resultDesc) || trim(payload.desc) || trim(payload.message) || "unknown error";
}

function isAuthError(error) {
    if (!error) return false;
    if (error.code === "AUTH") return true;
    return isAuthMessage(safeMsg(error));
}

function isAuthMessage(message) {
    var text = String(message || "");
    var lowered = text.toLowerCase();
    return lowered.indexOf("token") >= 0
        || lowered.indexOf("auth") >= 0
        || lowered.indexOf("login") >= 0
        || lowered.indexOf("password") >= 0
        || lowered.indexOf("username") >= 0
        || lowered.indexOf("account") >= 0
        || text.indexOf("登录") >= 0
        || text.indexOf("认证") >= 0
        || text.indexOf("密码") >= 0
        || text.indexOf("账号") >= 0
        || text.indexOf("用户名") >= 0;
}

function clearAuth(auth) {
    auth = ensureObject(auth);
    auth.accessToken = "";
    auth.refreshToken = "";
    auth.expiresAt = null;
    auth.tokenCheckedAt = null;
}

function lockText(raw) {
    if (raw === 0) return "已锁";
    if (raw === 1) return "未锁";
    return "锁态未知";
}

function lockColor(raw) {
    if (raw === 0) return "#60A5FA";
    if (raw === 1) return "#F59E0B";
    return "#CBD5E1";
}

function lockBg(raw) {
    if (raw === 0) return "rgba(96,165,250,0.16)";
    if (raw === 1) return "rgba(245,158,11,0.16)";
    return "rgba(203,213,225,0.16)";
}

function batteryIcon(percent) {
    if (!isFiniteNumber(percent)) return "battery.0";
    if (percent >= 90) return "battery.100";
    if (percent >= 65) return "battery.75";
    if (percent >= 35) return "battery.50";
    if (percent >= 10) return "battery.25";
    return "battery.0";
}

function batteryColor(percent, accent) {
    if (!isFiniteNumber(percent)) return "#CBD5E1";
    if (percent >= 60) return accent || "#34D399";
    if (percent >= 30) return "#FBBF24";
    return "#F87171";
}

function signalLevel(value) {
    var n = toNumber(value);
    if (!isFiniteNumber(n)) return "信号 --";
    if (n > 31) {
        if (n >= 75) return "信号强";
        if (n >= 45) return "信号中";
        return "信号弱";
    }
    if (n >= 24) return "信号强";
    if (n >= 12) return "信号中";
    return "信号弱";
}

function formatSignal(value) {
    var n = toNumber(value);
    if (!isFiniteNumber(n)) return "信号 --";
    return signalLevel(n) + " (" + roundNumber(n, 0) + ")";
}

function compactRange(value) {
    return isFiniteNumber(value) ? (roundNumber(value, 0) + "km") : "--";
}

function formatMinutes(value) {
    var n = toNumber(value);
    if (!isFiniteNumber(n)) return "--";
    if (n >= 60) {
        var hours = Math.floor(n / 60);
        var minutes = Math.round(n % 60);
        if (minutes === 0) return hours + "h";
        return hours + "h" + minutes + "m";
    }
    return Math.round(n) + "m";
}

function formatClock(input) {
    var d = input instanceof Date ? input : new Date(input);
    if (isNaN(d.getTime())) return "--";
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}

function formatLocation(locationInfo) {
    locationInfo = ensureObject(locationInfo);
    var parts = [
        trim(locationInfo.city),
        trim(locationInfo.district),
        trim(locationInfo.addr)
    ].filter(Boolean);
    return parts.slice(0, 2).join(" · ");
}

function normalizeTimestampToIso(value) {
    var n = toNumber(value);
    if (!isFiniteNumber(n) || n <= 0) return "";
    if (n < 100000000000) n = n * 1000;
    var d = new Date(n);
    if (isNaN(d.getTime())) return "";
    return d.toISOString();
}

function parseDateInput(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d.getTime())) return "";
    return d.toISOString();
}

function makeError(code, message) {
    var err = new Error(message || "未知错误");
    err.code = code;
    return err;
}

function txt(text, size, weight, color, opts) {
    var el = {
        type: "text",
        text: String(text == null ? "" : text),
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

function tag(text, color, bg, size) {
    return hstack([
        txt(text, size || 9, "semibold", color || "#FFFFFF", { maxLines: 1, minScale: 0.6 })
    ], {
        padding: [2, 6, 2, 6],
        backgroundColor: bg || "rgba(255,255,255,0.08)",
        borderRadius: 6
    });
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

function sp(length) {
    var el = { type: "spacer" };
    if (length != null) el.length = length;
    return el;
}

function isExpired(ts, ttlMs) {
    var value = toNumber(ts);
    if (!isFiniteNumber(value) || value <= 0) return true;
    return Date.now() - value >= ttlMs;
}

function loadJSON(ctx, key) {
    try {
        return ctx.storage.getJSON(key);
    } catch (e) {
        return null;
    }
}

function saveJSON(ctx, key, value) {
    try {
        ctx.storage.setJSON(key, value);
    } catch (e) {
    }
}

function ensureObject(value) {
    return isObject(value) ? value : {};
}

function toObjectArray(value) {
    if (!Array.isArray(value)) return [];
    return value.filter(isObject);
}

function isObject(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function firstPresent() {
    for (var i = 0; i < arguments.length; i++) {
        if (arguments[i] != null && String(arguments[i]).trim() !== "") return arguments[i];
    }
    return null;
}

function trim(value) {
    return String(value == null ? "" : value).trim();
}

function toNumber(value) {
    if (typeof value === "number") return value;
    if (typeof value === "string") {
        var text = value.trim();
        if (!text) return NaN;
        var n = Number(text);
        return n;
    }
    if (typeof value === "boolean") return value ? 1 : 0;
    return NaN;
}

function toInt(value) {
    var n = toNumber(value);
    return isFiniteNumber(n) ? parseInt(n, 10) : null;
}

function clampInt(value, min, max, fallback) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) n = fallback;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
}

function clampNumber(value, min, max) {
    var n = toNumber(value);
    if (!isFiniteNumber(n)) n = min;
    if (n < min) n = min;
    if (n > max) n = max;
    return n;
}

function roundNumber(value, digits) {
    var n = toNumber(value);
    if (!isFiniteNumber(n)) return "--";
    var factor = Math.pow(10, digits || 0);
    return Math.round(n * factor) / factor;
}

function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
}

function isTrue(value) {
    var v = String(value || "").toLowerCase();
    return v === "1" || v === "true" || v === "yes" || v === "y" || v === "on";
}

function pad2(value) {
    var n = parseInt(value, 10);
    if (!isFinite(n)) n = 0;
    return n < 10 ? ("0" + n) : String(n);
}

function safeMsg(error) {
    if (!error) return "未知错误";
    if (typeof error === "string") return error;
    return String(error.message || error);
}

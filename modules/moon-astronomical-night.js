// 月相与天文夜卡
// 数据来源：
// 1. Sunrise-Sunset API：天文夜、日出日落、暮光时间（无需 API Key）
// 2. Open-Meteo Geocoding：城市名转经纬度（无需 API Key）
// 3. AstronomyAPI Studio Moon Phase：高质量月相图（可选，需要 APP_ID/APP_SECRET）

var CACHE_KEY = "moon_astronomical_night_v1";
var DEFAULT_REFRESH_MINUTES = 60;
var DEFAULT_IMAGE_REFRESH_HOURS = 12;

export default async function (ctx) {
  var env = ctx.env || {};
  var family = ctx.widgetFamily || "systemMedium";

  var title = env.TITLE || "月相与天文夜";
  var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 15, 1440);
  var refreshMs = refreshMinutes * 60 * 1000;
  var imageRefreshHours = clampNumber(env.IMAGE_REFRESH_HOURS || DEFAULT_IMAGE_REFRESH_HOURS, 1, 168);
  var forceRefresh = isTrue(env.FORCE_REFRESH);

  var city = String(env.CITY || "").trim();
  var locationNameInput = String(env.LOCATION_NAME || "").trim();
  var tzid = String(env.TZID || "").trim();
  var lat = toFloat(env.LAT);
  var lon = toFloat(env.LON);
  var appId = String(env.APP_ID || "").trim();
  var appSecret = String(env.APP_SECRET || "").trim();
  var showMoonImage = !isFalse(env.SHOW_MOON_IMAGE);
  var moonStyle = normalizeMoonStyle(env.MOON_STYLE || "shaded");
  var moonView = normalizeMoonView(env.MOON_VIEW || "portrait-simple");
  var openUrl = String(env.OPEN_URL || "").trim();
  var locationSignature = buildLocationSignature(city, lat, lon, tzid);

  if ((!isFinite(lat) || !isFinite(lon)) && !city) {
    return errorWidget("缺少位置", "请配置 LAT/LON，或设置 CITY");
  }

  var cached = loadCache(ctx);
  var now = Date.now();
  var cacheReady = cached && cached.data && cached.signature === locationSignature;
  var cacheFresh = cacheReady && cached.ts && (now - cached.ts < refreshMs);
  var vm;

  if (cacheFresh && !forceRefresh) {
    vm = buildViewModel(reviveCachedData(cached.data), openUrl, showMoonImage);
  } else {
    try {
      var resolved = await resolveLocation(ctx, city, lat, lon, locationNameInput, tzid);
      var astro = await fetchAstronomicalWindows(ctx, resolved);
      var moon = computeMoonData(new Date(), resolved.latitude, resolved.longitude);
      var moonImage = null;

      if (showMoonImage && appId && appSecret) {
        moonImage = await fetchMoonImageWithCache(ctx, {
          appId: appId,
          appSecret: appSecret,
          latitude: resolved.latitude,
          longitude: resolved.longitude,
          date: moon.dateKey,
          orientation: moon.orientation,
          moonStyle: moonStyle,
          moonView: moonView
        }, imageRefreshHours);
      } else if (cacheReady && cached.data && cached.data.moonImage) {
        moonImage = cached.data.moonImage;
      }

      var data = {
        location: resolved,
        astro: astro,
        moon: moon,
        moonImage: moonImage,
        fetchedAt: new Date().toISOString()
      };
      saveCache(ctx, { data: data, ts: now, signature: locationSignature });
      vm = buildViewModel(data, openUrl, showMoonImage);
    } catch (e) {
      console.log("moon astronomical fetch error: " + safeMsg(e));
      if (cacheReady) {
        vm = buildViewModel(reviveCachedData(cached.data), openUrl, showMoonImage);
        vm.statusText = "缓存";
      } else {
        return errorWidget("加载失败", safeMsg(e));
      }
    }
  }

  var refreshAfter = new Date(Date.now() + refreshMs).toISOString();

  if (family === "accessoryCircular") return buildCircular(vm);
  if (family === "accessoryRectangular") return buildRectangular(vm, title);
  if (family === "accessoryInline") return buildInline(vm, title);
  if (family === "systemSmall") return buildSmall(vm, title, refreshAfter);
  if (family === "systemLarge" || family === "systemExtraLarge") return buildLarge(vm, title, refreshAfter);
  return buildMedium(vm, title, refreshAfter);
}

async function resolveLocation(ctx, city, lat, lon, locationNameInput, tzidInput) {
  if (isFinite(lat) && isFinite(lon)) {
    return {
      latitude: lat,
      longitude: lon,
      name: resolveCoordinateLocationName(city, locationNameInput),
      tzid: tzidInput || "Asia/Shanghai"
    };
  }

  var url = "https://geocoding-api.open-meteo.com/v1/search?name="
    + encodeURIComponent(city)
    + "&count=1&language=zh&format=json";
  var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 10000 });
  if (resp.status !== 200) throw new Error("地理编码失败: HTTP " + resp.status);
  var data = await resp.json();
  if (!data.results || data.results.length === 0) throw new Error("未找到城市: " + city);

  var item = data.results[0];
  var name = locationNameInput || formatGeoName(item);
  return {
    latitude: Number(item.latitude),
    longitude: Number(item.longitude),
    name: name,
    tzid: tzidInput || item.timezone || "Asia/Shanghai"
  };
}

function resolveCoordinateLocationName(city, locationNameInput) {
  // 传入坐标时，默认忽略 YAML 里为了 CITY 模式准备的城市名，避免“坐标已变但标题还写上海”
  // 如果用户想给坐标模式自定义名称，可以把 CITY 留空，只传 LOCATION_NAME。
  if (locationNameInput && !city) return locationNameInput;
  return "当前地点";
}

function buildLocationSignature(city, lat, lon, tzid) {
  if (isFinite(lat) && isFinite(lon)) {
    return "coords:" + roundCoord(lat) + "," + roundCoord(lon) + "|" + String(tzid || "");
  }
  return "city:" + String(city || "").trim().toLowerCase() + "|" + String(tzid || "");
}

function roundCoord(value) {
  return Math.round(Number(value) * 10000) / 10000;
}

async function fetchAstronomicalWindows(ctx, loc) {
  var today = formatDateLocal(new Date());
  var tomorrow = formatDateLocal(new Date(Date.now() + 86400000));
  var todayData = await fetchSunWindow(ctx, loc, today);
  var tomorrowData = await fetchSunWindow(ctx, loc, tomorrow);

  return {
    today: todayData,
    tomorrow: tomorrowData,
    state: deriveNightState(todayData, tomorrowData, Date.now()),
    darkDurationMinutes: calcDurationMinutes(todayData.astronomicalTwilightEnd, tomorrowData.astronomicalTwilightBegin)
  };
}

async function fetchSunWindow(ctx, loc, dateStr) {
  var url = "https://api.sunrise-sunset.org/json"
    + "?lat=" + encodeURIComponent(loc.latitude)
    + "&lng=" + encodeURIComponent(loc.longitude)
    + "&date=" + encodeURIComponent(dateStr)
    + "&formatted=0"
    + "&tzid=" + encodeURIComponent(loc.tzid || "UTC");

  var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 10000 });
  if (resp.status !== 200) throw new Error("天文窗口请求失败: HTTP " + resp.status);
  var data = await resp.json();
  if (data.status !== "OK" || !data.results) {
    throw new Error("天文窗口返回异常: " + (data.status || "UNKNOWN_ERROR"));
  }

  var r = data.results;
  return {
    date: dateStr,
    sunrise: parseTime(r.sunrise),
    sunset: parseTime(r.sunset),
    civilTwilightBegin: parseTime(r.civil_twilight_begin),
    civilTwilightEnd: parseTime(r.civil_twilight_end),
    nauticalTwilightBegin: parseTime(r.nautical_twilight_begin),
    nauticalTwilightEnd: parseTime(r.nautical_twilight_end),
    astronomicalTwilightBegin: parseTime(r.astronomical_twilight_begin),
    astronomicalTwilightEnd: parseTime(r.astronomical_twilight_end),
    solarNoon: parseTime(r.solar_noon),
    dayLengthSeconds: Number(r.day_length) || 0
  };
}

function deriveNightState(today, tomorrow, nowTs) {
  var begin = today.astronomicalTwilightBegin;
  var end = today.astronomicalTwilightEnd;
  var tomorrowBegin = tomorrow.astronomicalTwilightBegin;

  if (begin && nowTs < begin.getTime()) {
    return {
      key: "in_night_before_dawn",
      title: "正在天文夜中",
      subtitle: "将于 " + formatClock(begin) + " 结束",
      color: "#D8E2FF"
    };
  }
  if (end && tomorrowBegin && nowTs >= end.getTime()) {
    return {
      key: "in_night_evening",
      title: "正在天文夜中",
      subtitle: "将于明晨 " + formatClock(tomorrowBegin) + " 结束",
      color: "#D8E2FF"
    };
  }
  if (end && nowTs < end.getTime()) {
    return {
      key: "before_night",
      title: "今晚将进入天文夜",
      subtitle: formatClock(end) + " 开始",
      color: "#89A9FF"
    };
  }
  return {
    key: "unknown",
    title: "等待天文窗口",
    subtitle: "请稍后刷新",
    color: "#B6C2D9"
  };
}

function computeMoonData(now, latitude, longitude) {
  var julian = toJulian(now);
  var knownNewMoon = 2451550.1;
  var synodicMonth = 29.53058867;
  var age = normalizeCycle(julian - knownNewMoon, synodicMonth);
  var phase = age / synodicMonth;
  var illumination = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  var waxing = phase < 0.5;
  var phaseInfo = phaseLabel(phase);
  var hemisphere = latitude < 0 ? "south-up" : "north-up";

  return {
    phase: phase,
    ageDays: age,
    illumination: illumination,
    illuminationPct: Math.round(illumination * 100),
    label: phaseInfo.label,
    summary: phaseInfo.summary,
    icon: phaseInfo.icon,
    waxing: waxing,
    dateKey: formatDateLocal(now),
    orientation: hemisphere,
    latitude: latitude,
    longitude: longitude
  };
}

async function fetchMoonImageWithCache(ctx, opts, imageRefreshHours) {
  var imageKey = "moon_phase_image_" + opts.date + "_" + opts.moonStyle + "_" + opts.moonView + "_" + opts.orientation;
  var cached = ctx.storage.getJSON(imageKey);
  var ttlMs = imageRefreshHours * 60 * 60 * 1000;
  if (cached && cached.ts && Date.now() - cached.ts < ttlMs && cached.dataUri) {
    return cached.dataUri;
  }

  var moonImageUrl = await fetchMoonImageUrl(ctx, opts);
  if (!moonImageUrl) return cached && cached.dataUri ? cached.dataUri : null;
  var dataUri = await downloadAsDataUri(ctx, moonImageUrl, "image/png");
  if (dataUri) {
    ctx.storage.setJSON(imageKey, { ts: Date.now(), dataUri: dataUri });
    return dataUri;
  }
  return cached && cached.dataUri ? cached.dataUri : null;
}

async function fetchMoonImageUrl(ctx, opts) {
  var body = {
    format: "png",
    style: {
      moonStyle: opts.moonStyle,
      backgroundStyle: "solid",
      backgroundColor: "#0F172A",
      headingColor: "#FFFFFF",
      textColor: "#FFFFFF"
    },
    observer: {
      latitude: opts.latitude,
      longitude: opts.longitude,
      date: opts.date
    },
    view: {
      type: opts.moonView,
      orientation: opts.orientation
    }
  };

  var resp = await ctx.http.post("https://api.astronomyapi.com/api/v2/studio/moon-phase", {
    headers: {
      "User-Agent": "Egern-Widget",
      "Authorization": buildAuthHeader(opts.appId, opts.appSecret)
    },
    body: body,
    timeout: 15000
  });

  if (resp.status !== 200) {
    throw new Error("月相图生成失败: HTTP " + resp.status);
  }
  var data = await resp.json();
  return data && data.data ? data.data.imageUrl : null;
}

async function downloadAsDataUri(ctx, url, mimeType) {
  try {
    var resp = await ctx.http.get(url, { headers: { "User-Agent": "Egern-Widget" }, timeout: 15000 });
    if (resp.status !== 200) return null;
    var buf = await resp.arrayBuffer();
    var bytes = new Uint8Array(buf);
    return "data:" + mimeType + ";base64," + base64EncodeBytes(bytes);
  } catch (e) {
    console.log("download moon image error: " + safeMsg(e));
    return null;
  }
}

function buildViewModel(data, openUrl, showMoonImage) {
  data = reviveCachedData(data);
  var moon = data.moon;
  var astro = data.astro;
  var theme = buildTheme(moon.phase, astro.state.key);
  var moonImage = showMoonImage ? data.moonImage : null;
  var darkDurationText = astro.darkDurationMinutes > 0 ? formatDurationMinutes(astro.darkDurationMinutes) : "--";
  var tonightWindow = formatNightWindow(astro);

  return {
    location: data.location.name,
    tzid: data.location.tzid,
    moonLabel: moon.label,
    moonSummary: moon.summary,
    moonIcon: moon.icon,
    illuminationPct: moon.illuminationPct,
    ageDays: moon.ageDays,
    moonImage: moonImage,
    nightTitle: astro.state.title,
    nightSubtitle: astro.state.subtitle,
    tonightWindow: tonightWindow,
    darkDurationText: darkDurationText,
    sunrise: formatClock(data.astro.today.sunrise),
    sunset: formatClock(data.astro.today.sunset),
    astroEnd: formatClock(data.astro.today.astronomicalTwilightEnd),
    astroBegin: formatClock(data.astro.tomorrow.astronomicalTwilightBegin),
    phaseDate: moon.dateKey,
    theme: theme,
    openUrl: openUrl,
    statusText: "实时"
  };
}

function reviveCachedData(data) {
  if (!data || typeof data !== "object") return data;
  if (!data.astro || typeof data.astro !== "object") return data;

  reviveSunWindow(data.astro.today);
  reviveSunWindow(data.astro.tomorrow);
  return data;
}

function reviveSunWindow(win) {
  if (!win || typeof win !== "object") return;
  win.sunrise = reviveDate(win.sunrise);
  win.sunset = reviveDate(win.sunset);
  win.civilTwilightBegin = reviveDate(win.civilTwilightBegin);
  win.civilTwilightEnd = reviveDate(win.civilTwilightEnd);
  win.nauticalTwilightBegin = reviveDate(win.nauticalTwilightBegin);
  win.nauticalTwilightEnd = reviveDate(win.nauticalTwilightEnd);
  win.astronomicalTwilightBegin = reviveDate(win.astronomicalTwilightBegin);
  win.astronomicalTwilightEnd = reviveDate(win.astronomicalTwilightEnd);
  win.solarNoon = reviveDate(win.solarNoon);
}

function reviveDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function buildSmall(vm, title, refreshAfter) {
  return shell([
    starfield(3),
    header(title, vm.theme.accent, false),
    sp(6),
    moonHero(vm, true),
    sp(6),
    txt(vm.nightTitle, 12, "semibold", "#F7FAFF", { maxLines: 1, minScale: 0.72 }),
    txt(vm.nightSubtitle, 10, "medium", "rgba(228,235,245,0.72)", { maxLines: 2, minScale: 0.72 }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, vm.theme, [14, 16, 12, 16]);
}

function buildMedium(vm, title, refreshAfter) {
  return shell([
    starfield(5),
    header(title, vm.theme.accent, true),
    sp(6),
    separator(),
    sp(10),
    hstack([
      moonPanel(vm, false),
      vstack([
        txt(vm.location, 12, "semibold", "#F7FAFF", { maxLines: 1, minScale: 0.75 }),
        txt(vm.nightTitle, 16, "bold", vm.theme.accent, { maxLines: 1, minScale: 0.72 }),
        txt(vm.nightSubtitle, 10, "medium", "rgba(228,235,245,0.72)", { maxLines: 2, minScale: 0.75 }),
        sp(8),
        infoPill("今晚窗口", vm.tonightWindow),
        sp(6),
        infoPill("纯暗时长", vm.darkDurationText),
        sp(6),
        infoPill("月面照亮", vm.illuminationPct + "%")
      ], { flex: 1, gap: 0, alignItems: "start" })
    ], { gap: 12, alignItems: "start" }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, vm.theme, [15, 17, 13, 17]);
}

function buildLarge(vm, title, refreshAfter) {
  return shell([
    starfield(7),
    header(title, vm.theme.accent, true),
    sp(6),
    separator(),
    sp(10),
    hstack([
      moonPanel(vm, false),
      vstack([
        txt(vm.location, 12, "semibold", "#F7FAFF", { maxLines: 1, minScale: 0.75 }),
        txt(vm.moonLabel, 22, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.65 }),
        txt(vm.moonSummary, 10, "medium", "rgba(228,235,245,0.72)", { maxLines: 2, minScale: 0.75 }),
        sp(8),
        infoPill("今晚天文夜", vm.tonightWindow),
        sp(6),
        infoPill("纯暗时长", vm.darkDurationText),
        sp(6),
        infoPill("月面照亮", vm.illuminationPct + "%")
      ], { flex: 1, gap: 0, alignItems: "start" })
    ], { gap: 14, alignItems: "start" }),
    sp(10),
    hstack([
      detailCard("日出 / 日落", vm.sunrise + " · " + vm.sunset),
      detailCard("天文夜边界", vm.astroEnd + " → " + vm.astroBegin)
    ], { gap: 10, alignItems: "start" }),
    sp(10),
    detailCard(vm.nightTitle, vm.nightSubtitle, true),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, vm.theme, [16, 18, 14, 18]);
}

function buildCircular(vm) {
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    gap: 2,
    children: [
      sp(),
      icon(vm.moonIcon, 16, vm.theme.accent),
      txt(vm.illuminationPct + "%", 12, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.7 }),
      txt("月面", 9, "medium", "rgba(228,235,245,0.68)", { maxLines: 1, minScale: 0.7 }),
      sp()
    ]
  };
}

function buildRectangular(vm, title) {
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    gap: 3,
    children: [
      hstack([
        icon(vm.moonIcon, 10, vm.theme.accent),
        txt(title, 10, "semibold", "rgba(228,235,245,0.82)", { maxLines: 1, minScale: 0.75 }),
        sp(),
        txt(vm.illuminationPct + "%", 9, "bold", vm.theme.accent)
      ], { gap: 4 }),
      txt(vm.moonLabel, 12, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.7 }),
      txt(vm.nightTitle + " · " + vm.astroEnd, 10, "medium", "rgba(228,235,245,0.68)", { maxLines: 1, minScale: 0.7 })
    ]
  };
}

function buildInline(vm, title) {
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    children: [
      icon(vm.moonIcon, 12, vm.theme.accent),
      txt(" " + title + "：" + vm.moonLabel + "，" + vm.nightTitle, 12, "medium", "#F7FAFF", {
        maxLines: 1,
        minScale: 0.6
      })
    ]
  };
}

function moonHero(vm, compact) {
  if (vm.moonImage) {
    return hstack([
      {
        type: "image",
        src: vm.moonImage,
        width: compact ? 66 : 90,
        height: compact ? 66 : 90,
        resizeMode: "contain"
      },
      vstack([
        txt(vm.moonLabel, compact ? 16 : 18, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.7 }),
        txt(vm.moonSummary, 10, "medium", "rgba(228,235,245,0.72)", { maxLines: compact ? 2 : 3, minScale: 0.72 }),
        sp(4),
        txt("照亮 " + vm.illuminationPct + "%", 10, "semibold", vm.theme.accent, { maxLines: 1 })
      ], { flex: 1, gap: 0, alignItems: "start" })
    ], { gap: 10, alignItems: "center" });
  }

  return hstack([
    {
      type: "stack",
      width: compact ? 62 : 84,
      height: compact ? 62 : 84,
      borderRadius: 999,
      backgroundGradient: {
        type: "linear",
        colors: ["rgba(248,250,255,0.95)", "rgba(184,198,229,0.82)"],
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 1, y: 1 }
      },
      children: [
        icon(vm.moonIcon, compact ? 20 : 24, "#0B1020")
      ],
      alignItems: "center"
    },
    vstack([
      txt(vm.moonLabel, compact ? 16 : 18, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.7 }),
      txt(vm.moonSummary, 10, "medium", "rgba(228,235,245,0.72)", { maxLines: compact ? 2 : 3, minScale: 0.72 }),
      sp(4),
      txt("照亮 " + vm.illuminationPct + "%", 10, "semibold", vm.theme.accent, { maxLines: 1 })
    ], { flex: 1, gap: 0, alignItems: "start" })
  ], { gap: 10, alignItems: "center" });
}

function moonPanel(vm, compact) {
  return vstack([
    moonHero(vm, compact),
    sp(8),
    txt(vm.phaseDate, 9, "medium", "rgba(228,235,245,0.5)", { maxLines: 1 })
  ], {
    width: compact ? 120 : 138,
    padding: [12, 12, 12, 12],
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)"
  });
}

function detailCard(title, value, emphasize) {
  return vstack([
    txt(title, 10, "medium", emphasize ? "rgba(228,235,245,0.82)" : "rgba(228,235,245,0.6)", { maxLines: 1 }),
    sp(4),
    txt(value, emphasize ? 12 : 11, emphasize ? "semibold" : "medium", "#F7FAFF", {
      maxLines: emphasize ? 2 : 1,
      minScale: 0.72
    })
  ], {
    flex: 1,
    padding: [12, 12, 12, 12],
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)"
  });
}

function infoPill(label, value) {
  return hstack([
    txt(label, 10, "medium", "rgba(228,235,245,0.58)", { maxLines: 1, minScale: 0.72 }),
    sp(),
    txt(value, 10, "semibold", "#F7FAFF", { maxLines: 1, minScale: 0.72 })
  ], {
    gap: 6,
    padding: [8, 10, 8, 10],
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)"
  });
}

function footer(vm) {
  return hstack([
    txt(vm.location, 9, "medium", "rgba(228,235,245,0.48)", { maxLines: 1, minScale: 0.7 }),
    sp(),
    txt(vm.statusText, 9, "medium", vm.theme.accent, { maxLines: 1 })
  ], { gap: 6 });
}

function starfield(count) {
  var children = [];
  var names = ["sparkle", "sparkles", "star.fill"];
  for (var i = 0; i < count; i++) {
    children.push(icon(names[i % names.length], i % 2 === 0 ? 6 : 8, i % 2 === 0 ? "rgba(255,255,255,0.16)" : "rgba(180,200,255,0.22)"));
  }
  return hstack(children, { gap: 6, alignItems: "center" });
}

function shell(children, refreshAfter, url, theme, padding) {
  var widget = {
    type: "widget",
    padding: padding || [14, 16, 12, 16],
    gap: 0,
    refreshAfter: refreshAfter,
    backgroundGradient: {
      type: "linear",
      colors: theme.gradient,
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: children
  };
  if (url) widget.url = url;
  return widget;
}

function header(title, accent, showTime) {
  var children = [
    icon("moonphase.waxing.gibbous", 14, accent),
    txt(title, 12, "bold", accent, { maxLines: 1, minScale: 0.72 }),
    sp()
  ];
  if (showTime) {
    children.push({
      type: "date",
      date: new Date().toISOString(),
      format: "time",
      font: { size: 9, weight: "medium" },
      textColor: "rgba(228,235,245,0.35)"
    });
  }
  return hstack(children, { gap: 5, alignItems: "center" });
}

function separator() {
  return {
    type: "stack",
    height: 1,
    backgroundColor: "rgba(255,255,255,0.08)",
    children: []
  };
}

function buildTheme(phase, stateKey) {
  var accent = "#AABFFF";
  var gradient = ["#08101F", "#111A31", "#1B2144"];

  if (phase < 0.1 || phase > 0.9) {
    accent = "#E7ECFF";
    gradient = ["#080B15", "#10172A", "#1A2336"];
  } else if (phase < 0.25) {
    accent = "#9DB7FF";
    gradient = ["#08101F", "#111A31", "#23345E"];
  } else if (phase < 0.5) {
    accent = "#C9D7FF";
    gradient = ["#0A1020", "#1A203B", "#313868"];
  } else if (phase < 0.75) {
    accent = "#F2F4FF";
    gradient = ["#101522", "#262C45", "#41486D"];
  }

  if (stateKey === "in_night_before_dawn" || stateKey === "in_night_evening") {
    accent = "#DDE6FF";
  }

  return {
    accent: accent,
    gradient: gradient
  };
}

function phaseLabel(phase) {
  if (phase < 0.03 || phase >= 0.97) return { label: "朔月", summary: "夜空最暗，适合等待群星显形。", icon: "moonphase.new.moon" };
  if (phase < 0.22) return { label: "娥眉月", summary: "细月悬空，夜色开始变得有层次。", icon: "moonphase.waxing.crescent" };
  if (phase < 0.28) return { label: "上弦月", summary: "月面半明，天空正在从深蓝过渡到银灰。", icon: "moonphase.first.quarter" };
  if (phase < 0.47) return { label: "盈凸月", summary: "月光正在增强，夜色更明亮也更柔和。", icon: "moonphase.waxing.gibbous" };
  if (phase < 0.53) return { label: "满月", summary: "月光最盛，夜空像一块被抛光的玻璃。", icon: "moonphase.full.moon" };
  if (phase < 0.72) return { label: "亏凸月", summary: "月光依旧饱满，但深夜会慢慢重新变暗。", icon: "moonphase.waning.gibbous" };
  if (phase < 0.78) return { label: "下弦月", summary: "月面半明，适合安静地等黎明靠近。", icon: "moonphase.last.quarter" };
  return { label: "残月", summary: "天亮前更能感到夜空的深度与留白。", icon: "moonphase.waning.crescent" };
}

function formatNightWindow(astro) {
  var start = astro.today.astronomicalTwilightEnd;
  var end = astro.tomorrow.astronomicalTwilightBegin;
  if (!start || !end) return "--";
  return formatClock(start) + " - " + formatClock(end);
}

function calcDurationMinutes(start, end) {
  if (!start || !end) return 0;
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function formatDurationMinutes(minutes) {
  var h = Math.floor(minutes / 60);
  var m = minutes % 60;
  if (h <= 0) return m + " 分钟";
  if (m === 0) return h + " 小时";
  return h + " 小时 " + m + " 分";
}

function parseTime(value) {
  if (!value) return null;
  var d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function formatClock(date) {
  if (!date) return "--:--";
  var hh = String(date.getHours()).padStart(2, "0");
  var mm = String(date.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

function formatDateLocal(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1).padStart(2, "0");
  var d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function formatGeoName(item) {
  var parts = [];
  if (item.name) parts.push(item.name);
  if (item.admin1 && item.admin1 !== item.name) parts.push(item.admin1);
  return parts.join(" · ") || "当前地点";
}

function normalizeMoonStyle(value) {
  var text = String(value || "").trim().toLowerCase();
  if (text === "default" || text === "sketch" || text === "shaded") return text;
  return "shaded";
}

function normalizeMoonView(value) {
  var text = String(value || "").trim().toLowerCase();
  if (text === "portrait-simple" || text === "landscape-simple") return text;
  return "portrait-simple";
}

function isFalse(value) {
  var text = String(value || "").trim().toLowerCase();
  return text === "0" || text === "false" || text === "no" || text === "off";
}

function isTrue(value) {
  var text = String(value || "").trim().toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function loadCache(ctx) {
  return ctx.storage.getJSON(CACHE_KEY);
}

function saveCache(ctx, data) {
  ctx.storage.setJSON(CACHE_KEY, data);
}

function toJulian(date) {
  return date.getTime() / 86400000 + 2440587.5;
}

function normalizeCycle(value, period) {
  var v = value % period;
  return v < 0 ? v + period : v;
}

function toFloat(value) {
  var n = Number(value);
  return isFinite(n) ? n : NaN;
}

function clampNumber(value, min, max) {
  var n = Number(value);
  if (!isFinite(n)) n = min;
  if (n < min) n = min;
  if (n > max) n = max;
  return n;
}

function safeMsg(err) {
  if (!err) return "unknown";
  return err.message ? String(err.message) : String(err);
}

function buildAuthHeader(appId, appSecret) {
  var raw = appId + ":" + appSecret;
  if (typeof btoa === "function") return "Basic " + btoa(raw);
  return "Basic " + base64Encode(raw);
}

function base64Encode(str) {
  var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var bytes = [];
  for (var i = 0; i < str.length; i++) bytes.push(str.charCodeAt(i) & 0xff);
  return base64EncodeBytes(bytes, chars);
}

function base64EncodeBytes(bytes, chars) {
  chars = chars || "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  var out = "";
  for (var i = 0; i < bytes.length; i += 3) {
    var b1 = bytes[i];
    var b2 = i + 1 < bytes.length ? bytes[i + 1] : NaN;
    var b3 = i + 2 < bytes.length ? bytes[i + 2] : NaN;

    var enc1 = b1 >> 2;
    var enc2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : (b2 >> 4));
    var enc3 = isNaN(b2) ? 64 : (((b2 & 15) << 2) | (isNaN(b3) ? 0 : (b3 >> 6)));
    var enc4 = isNaN(b3) ? 64 : (b3 & 63);

    out += chars.charAt(enc1);
    out += chars.charAt(enc2);
    out += enc3 === 64 ? "=" : chars.charAt(enc3);
    out += enc4 === 64 ? "=" : chars.charAt(enc4);
  }
  return out;
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

function hstack(children, opts) {
  var el = { type: "stack", direction: "row", alignItems: "center", children: children };
  if (opts) {
    for (var k in opts) el[k] = opts[k];
  }
  return el;
}

function vstack(children, opts) {
  var el = { type: "stack", direction: "column", alignItems: "start", children: children };
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

function truncate(text, max) {
  var value = String(text || "");
  return value.length > max ? value.slice(0, max) : value;
}

function errorWidget(title, message) {
  return {
    type: "widget",
    padding: [14, 16, 12, 16],
    gap: 8,
    backgroundGradient: {
      type: "linear",
      colors: ["#101827", "#1F2937", "#111827"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: [
      txt(title, 14, "bold", "#F7FAFF", { maxLines: 1 }),
      txt(message, 11, "medium", "rgba(228,235,245,0.72)", { maxLines: 3, minScale: 0.72 })
    ]
  };
}

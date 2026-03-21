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

  if (!vm) {
    return errorWidget("加载失败", "渲染模型为空");
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
    var resolvedName = locationNameInput || await fetchReverseLocationName(ctx, lat, lon);
    return {
      latitude: lat,
      longitude: lon,
      name: resolvedName || formatCoordinateLabel(lat, lon),
      nameSource: locationNameInput ? "manual" : resolvedName ? "reverse" : "coords",
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
    nameSource: locationNameInput ? "manual" : "city",
    tzid: tzidInput || item.timezone || "Asia/Shanghai"
  };
}

async function fetchReverseLocationName(ctx, lat, lon) {
  try {
    var url = "https://nominatim.openstreetmap.org/reverse"
      + "?format=jsonv2"
      + "&lat=" + encodeURIComponent(lat)
      + "&lon=" + encodeURIComponent(lon)
      + "&zoom=12"
      + "&addressdetails=1"
      + "&accept-language=zh-CN";
    var resp = await ctx.http.get(url, {
      headers: {
        "User-Agent": "Egern-Widget",
        "Accept-Language": "zh-CN"
      },
      timeout: 10000
    });
    if (resp.status !== 200) return "";

    var data = await resp.json();
    return formatReverseGeoName(data);
  } catch (e) {
    console.log("reverse geocoding error: " + safeMsg(e));
    return "";
  }
}

function formatReverseGeoName(data) {
  if (!data || typeof data !== "object") return "";
  var addr = data.address || {};

  var city = firstNonEmpty(
    addr.city,
    addr.town,
    addr.county,
    addr.city_district,
    addr.state_district,
    addr.state,
    addr.province,
    addr.municipality
  );
  var district = firstNonEmpty(addr.suburb, addr.city_district, addr.borough, addr.village, addr.township);

  if (city && district && city !== district) return city + " · " + district;
  if (city) return city;
  if (district) return district;

  var display = String(data.display_name || "").trim();
  if (!display) return "";
  return truncate(display.split(",")[0], 24);
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
  var locationLine = formatLocationLine(data.location);

  return {
    location: data.location.name,
    locationLine: locationLine,
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
    moonAgeText: formatAgeDays(moon.ageDays),
    updatedAt: data.fetchedAt || new Date().toISOString(),
    stateKey: astro.state.key,
    theme: theme,
    openUrl: openUrl,
    statusText: data.location.nameSource === "coords" ? "经纬度" : "实时"
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
    header(title, vm, false),
    sp(8),
    heroCard(vm, {
      compact: true,
      titleSize: 17,
      subtitleLines: 1,
      moonSize: 54,
      showSummary: false,
      showAgeTag: false,
      padding: [12, 12, 12, 12],
      borderRadius: 20
    }),
    sp(8),
    hstack([
      metricCard("夜窗", vm.tonightWindow, "今晚主窗口", vm.theme, { compact: true }),
      metricCard("纯暗", vm.darkDurationText, "边界 " + vm.astroEnd + " 起", vm.theme, { compact: true })
    ], { gap: 8, alignItems: "start" }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, vm.theme, [12, 14, 10, 14]);
}

function buildMedium(vm, title, refreshAfter) {
  return shell([
    header(title, vm, true),
    sp(8),
    heroCard(vm, {
      titleSize: 20,
      subtitleLines: 2,
      moonSize: 76,
      showSummary: true,
      padding: [13, 14, 13, 14],
      borderRadius: 22
    }),
    sp(8),
    hstack([
      metricCard("月相", vm.moonLabel, "照亮 " + vm.illuminationPct + "%", vm.theme),
      metricCard("夜窗", vm.tonightWindow, vm.nightSubtitle, vm.theme)
    ], { gap: 8, alignItems: "start" }),
    sp(8),
    hstack([
      metricCard("纯暗", vm.darkDurationText, "边界 " + vm.astroEnd + " → " + vm.astroBegin, vm.theme),
      metricCard("日出 / 日落", vm.sunrise + " · " + vm.sunset, vm.moonAgeText, vm.theme)
    ], { gap: 8, alignItems: "start" }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, vm.theme, [14, 16, 12, 16]);
}

function buildLarge(vm, title, refreshAfter) {
  return shell([
    header(title, vm, true),
    sp(10),
    hstack([
      heroCard(vm, {
        flex: 1.08,
        titleSize: 22,
        subtitleLines: 2,
        moonSize: 88,
        showSummary: true,
        padding: [14, 15, 14, 15],
        borderRadius: 24
      }),
      moonVisualCard(vm, {
        flex: 0.92,
        imageSize: 98,
        padding: [14, 14, 14, 14],
        borderRadius: 24
      })
    ], { gap: 10, alignItems: "start" }),
    sp(10),
    hstack([
      metricGroupPanel("今夜窗口", [
        detailRow("夜窗", vm.tonightWindow, vm.theme),
        detailRow("纯暗", vm.darkDurationText, vm.theme),
        detailRow("边界", vm.astroEnd + " → " + vm.astroBegin, vm.theme)
      ], vm.theme, { flex: 1 }),
      metricGroupPanel("观测参考", [
        detailRow("月相", vm.moonLabel, vm.theme),
        detailRow("日出 / 日落", vm.sunrise + " · " + vm.sunset, vm.theme),
        detailRow("位置", vm.locationLine, vm.theme)
      ], vm.theme, { flex: 1 })
    ], { gap: 10, alignItems: "start" }),
    sp(),
    footer(vm)
  ], refreshAfter, vm.openUrl, vm.theme, [14, 16, 12, 16]);
}

function buildCircular(vm) {
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    gap: 2,
    children: [
      sp(),
      moonStage(vm, 30),
      txt(vm.illuminationPct + "%", 11, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.7 }),
      txt(shortNightState(vm.stateKey), 8, "medium", vm.theme.textMuted, { maxLines: 1, minScale: 0.7 }),
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
        txt(title, 10, "semibold", vm.theme.textMuted, { maxLines: 1, minScale: 0.75 }),
        sp(),
        txt(vm.illuminationPct + "%", 9, "bold", vm.theme.accent)
      ], { gap: 4 }),
      txt(vm.nightTitle, 12, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.7 }),
      txt(vm.moonLabel + " · " + vm.tonightWindow, 10, "medium", vm.theme.textMuted, { maxLines: 1, minScale: 0.7 })
    ]
  };
}

function buildInline(vm, title) {
  return {
    type: "widget",
    url: vm.openUrl || undefined,
    children: [
      icon(vm.moonIcon, 12, vm.theme.accent),
      txt(" " + vm.moonLabel + " · " + shortNightState(vm.stateKey), 12, "medium", "#F7FAFF", {
        maxLines: 1,
        minScale: 0.6
      })
    ]
  };
}

function moonStage(vm, size) {
  var visual = vm.moonImage ? {
    type: "image",
    src: vm.moonImage,
    width: Math.round(size * 0.78),
    height: Math.round(size * 0.78),
    resizeMode: "contain"
  } : icon(vm.moonIcon, Math.max(22, Math.round(size * 0.34)), "#09111F");

  return vstack([
    sp(),
    visual,
    sp()
  ], {
    width: size,
    height: size,
    alignItems: "center",
    borderRadius: size / 2,
    borderWidth: 1,
    borderColor: vm.theme.hairlineStrong,
    backgroundColor: vm.theme.cardStrong,
    backgroundGradient: linearGradient([
      colorWithAlpha(vm.theme.accent, 0.34),
      colorWithAlpha(vm.theme.accent, 0.12),
      "rgba(255,255,255,0.04)"
    ]),
    shadowColor: vm.theme.accentGlow,
    shadowRadius: Math.round(size * 0.32),
    shadowOffset: { x: 0, y: 8 }
  });
}

function moonVisualCard(vm, opts) {
  opts = opts || {};
  return panel([
    hstack([
      sectionLabel("月面观感", vm.theme),
      sp(),
      nightStateTag(vm)
    ], { gap: 6, alignItems: "center" }),
    sp(12),
    hstack([sp(), moonStage(vm, opts.imageSize || 96), sp()], { alignItems: "center" }),
    sp(10),
    txt(vm.moonLabel, 15, "bold", "#F7FAFF", { maxLines: 1, minScale: 0.72, textAlign: "center" }),
    sp(4),
    txt(vm.moonSummary, 10, "medium", vm.theme.textMuted, {
      maxLines: 3,
      minScale: 0.72,
      textAlign: "center"
    }),
    sp(10),
    hstack([
      tag("照亮 " + vm.illuminationPct + "%", vm.theme.accent, vm.theme.accentSoft, 8),
      tag(vm.moonAgeText, "#FFFFFF", vm.theme.cardSoft, 8)
    ], { gap: 6, alignItems: "center" }),
    sp(6),
    txt(vm.phaseDate, 9, "medium", vm.theme.textSubtle, { maxLines: 1, minScale: 0.72 })
  ], vm.theme, {
    flex: opts.flex,
    alignItems: "center",
    padding: opts.padding || [14, 14, 14, 14],
    borderRadius: opts.borderRadius || 22,
    backgroundColor: vm.theme.cardStrong,
    backgroundGradient: linearGradient([
      colorWithAlpha(vm.theme.accent, 0.18),
      vm.theme.cardStrong,
      vm.theme.card
    ]),
    borderColor: vm.theme.hairlineStrong
  });
}

function heroCard(vm, opts) {
  opts = opts || {};
  var compact = !!opts.compact;
  var tags = [
    nightStateTag(vm),
    tag(vm.moonLabel, vm.theme.accent, vm.theme.accentSoft, compact ? 8 : 9),
    tag("照亮 " + vm.illuminationPct + "%", "#FFFFFF", vm.theme.cardSoft, compact ? 8 : 9)
  ];

  if (!compact && opts.showAgeTag !== false) {
    tags.push(tag(vm.moonAgeText, "#FFFFFF", vm.theme.cardSoft, 8));
  }

  return panel([
    hstack([
      vstack([
        sectionLabel("月相与夜窗", vm.theme),
        sp(compact ? 6 : 8),
        txt(vm.nightTitle, opts.titleSize || (compact ? 18 : 21), "bold", "#F7FAFF", {
          maxLines: compact ? 2 : 1,
          minScale: 0.58
        }),
        sp(4),
        txt(vm.nightSubtitle, compact ? 10 : 11, "medium", vm.theme.textMuted, {
          maxLines: opts.subtitleLines || (compact ? 1 : 2),
          minScale: 0.72
        }),
        sp(compact ? 7 : 9),
        hstack(tags, { gap: 6, alignItems: "center" }),
        opts.showSummary === false ? null : sp(8),
        opts.showSummary === false ? null : txt(vm.moonSummary, 10, "regular", compact ? vm.theme.textMuted : "#F7FAFF", {
          maxLines: compact ? 2 : 3,
          minScale: 0.72
        })
      ].filter(Boolean), { gap: 0, flex: 1, alignItems: "start" }),
      moonStage(vm, opts.moonSize || (compact ? 56 : 78))
    ], { gap: compact ? 10 : 12, alignItems: "center" })
  ], vm.theme, {
    flex: opts.flex,
    padding: opts.padding || [13, 14, 13, 14],
    borderRadius: opts.borderRadius || 22,
    backgroundColor: vm.theme.cardStrong,
    backgroundGradient: linearGradient([
      colorWithAlpha(vm.theme.accent, compact ? 0.20 : 0.18),
      colorWithAlpha(vm.theme.accent, 0.08),
      vm.theme.card
    ]),
    borderColor: vm.theme.hairlineStrong,
    shadowColor: vm.theme.accentGlow,
    shadowRadius: compact ? 12 : 16,
    shadowOffset: { x: 0, y: 8 }
  });
}

function metricCard(title, value, detail, theme, opts) {
  opts = opts || {};
  var compact = !!opts.compact;
  return panel([
    txt(title, compact ? 8 : 9, "medium", theme.textSubtle, { maxLines: 1, minScale: 0.72 }),
    sp(3),
    txt(value, compact ? 11 : 13, "bold", "#F7FAFF", {
      maxLines: compact ? 1 : 2,
      minScale: 0.58
    }),
    detail ? sp(3) : null,
    detail ? txt(detail, compact ? 8 : 9, "medium", theme.textMuted, {
      maxLines: compact ? 1 : 2,
      minScale: 0.64
    }) : null
  ].filter(Boolean), theme, {
    flex: opts.flex == null ? 1 : opts.flex,
    padding: compact ? [9, 10, 9, 10] : [10, 12, 10, 12],
    borderRadius: compact ? 16 : 18,
    backgroundColor: compact ? theme.cardSoft : theme.card,
    backgroundGradient: linearGradient([
      colorWithAlpha(theme.accent, compact ? 0.10 : 0.12),
      theme.cardSoft,
      theme.card
    ]),
    borderColor: compact ? theme.hairline : theme.hairlineStrong
  });
}

function metricGroupPanel(title, rows, theme, opts) {
  opts = opts || {};
  return panel([
    sectionLabel(title, theme),
    sp(8),
    vstack(rows, { gap: 7, alignItems: "start" })
  ], theme, {
    flex: opts.flex,
    padding: opts.padding || [12, 13, 12, 13],
    borderRadius: opts.borderRadius || 20,
    backgroundColor: theme.card,
    backgroundGradient: linearGradient([
      colorWithAlpha(theme.accent, 0.10),
      theme.cardSoft,
      theme.card
    ]),
    borderColor: theme.hairlineStrong
  });
}

function detailRow(label, value, theme) {
  return hstack([
    txt(label, 9, "medium", theme.textSubtle, { maxLines: 1, minScale: 0.72 }),
    sp(8),
    vstack([
      txt(value, 10, "semibold", "#F7FAFF", {
        maxLines: 1,
        minScale: 0.6,
        textAlign: "right"
      })
    ], { flex: 1, alignItems: "end" })
  ], { gap: 8, alignItems: "center" });
}

function shell(children, refreshAfter, url, theme, padding) {
  var widget = {
    type: "widget",
    padding: padding || [14, 16, 12, 16],
    gap: 0,
    refreshAfter: refreshAfter,
    backgroundGradient: linearGradient(theme.gradient),
    children: children
  };
  if (url) widget.url = url;
  return widget;
}

function header(title, vm, showTime) {
  var children = [
    accentOrb(vm.theme, showTime ? 26 : 24, vm.moonIcon),
    vstack([
      txt(title, 11, "bold", vm.theme.accent, { maxLines: 1, minScale: 0.68 }),
      txt(vm.locationLine, 9, "medium", vm.theme.textMuted, { maxLines: 1, minScale: 0.72 })
    ], { gap: 1, flex: 1 })
  ];

  if (showTime) children.push(timePill(vm.theme));

  return hstack(children, { gap: 8, alignItems: "center" });
}

function timePill(theme) {
  return hstack([
    icon("clock", 8, theme.accent),
    {
      type: "date",
      date: new Date().toISOString(),
      format: "time",
      font: { size: 9, weight: "medium" },
      textColor: theme.textSubtle
    }
  ], {
    gap: 4,
    padding: [4, 8, 4, 8],
    backgroundColor: theme.cardSoft,
    borderRadius: 99,
    borderWidth: 1,
    borderColor: theme.hairline
  });
}

function footer(vm) {
  return hstack([
    hstack([
      icon("clock.arrow.circlepath", 8, vm.theme.textSubtle),
      {
        type: "date",
        date: vm.updatedAt || new Date().toISOString(),
        format: "relative",
        font: { size: 9, weight: "medium" },
        textColor: vm.theme.textSubtle
      }
    ], { gap: 4, flex: 1, alignItems: "center" }),
    sourceTag(vm)
  ], { gap: 6, alignItems: "center" });
}

function accentOrb(theme, size, symbol) {
  return vstack([
    sp(),
    icon(symbol || "moonphase.waxing.gibbous", Math.max(12, Math.round(size * 0.42)), theme.accent),
    sp()
  ], {
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
    shadowRadius: Math.round(size * 0.42),
    shadowOffset: { x: 0, y: 6 }
  });
}

function sectionLabel(text, theme) {
  return hstack([
    microBar(theme),
    txt(text, 8, "semibold", theme.textSubtle, { maxLines: 1, minScale: 0.72 })
  ], { gap: 6, alignItems: "center" });
}

function microBar(theme) {
  return {
    type: "stack",
    width: 16,
    height: 4,
    borderRadius: 99,
    backgroundGradient: linearGradient([
      theme.accent,
      colorWithAlpha(theme.accent, 0.24)
    ], { x: 0, y: 0.5 }, { x: 1, y: 0.5 })
  };
}

function tag(text, color, bg, size) {
  return hstack([
    txt(text, size || 9, "semibold", color || "#F7FAFF", { maxLines: 1, minScale: 0.55 })
  ], {
    padding: [3, 7, 3, 7],
    backgroundColor: bg || "rgba(255,255,255,0.08)",
    borderRadius: 99,
    borderWidth: 1,
    borderColor: colorWithAlpha(color || "#F7FAFF", 0.28)
  });
}

function panel(children, theme, opts) {
  var el = {
    type: "stack",
    direction: "column",
    alignItems: "start",
    children: children,
    padding: [10, 12, 10, 12],
    backgroundColor: theme.card,
    borderRadius: 18,
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

function sourceTag(vm) {
  var tone = sourceTone(vm.statusText, vm.theme);
  return tag(vm.statusText, tone.color, tone.bg, 8);
}

function sourceTone(statusText, theme) {
  if (statusText === "缓存") {
    return { color: "#F6C96B", bg: "rgba(246,201,107,0.16)" };
  }
  if (statusText === "经纬度") {
    return { color: "#9CC4FF", bg: "rgba(156,196,255,0.16)" };
  }
  return { color: theme.accent, bg: theme.accentSoft };
}

function nightStateTag(vm) {
  var tone = nightStateTone(vm.stateKey, vm.theme);
  return tag(shortNightState(vm.stateKey), tone.color, tone.bg, 8);
}

function nightStateTone(stateKey, theme) {
  if (stateKey === "in_night_before_dawn" || stateKey === "in_night_evening") {
    return { color: theme.accent, bg: theme.accentSoft };
  }
  if (stateKey === "before_night") {
    return { color: "#8FB9FF", bg: "rgba(143,185,255,0.16)" };
  }
  return { color: theme.textMuted, bg: theme.cardSoft };
}

function shortNightState(stateKey) {
  if (stateKey === "in_night_before_dawn" || stateKey === "in_night_evening") return "天文夜中";
  if (stateKey === "before_night") return "今晚开启";
  return "等待中";
}

function buildTheme(phase, stateKey) {
  var accent = "#D4E1FF";
  var gradient = ["#04070F", "#0A1220", "#121B31"];

  if (phase < 0.1 || phase > 0.9) {
    accent = "#F1F5FF";
    gradient = ["#05070E", "#0A1220", "#111A2D"];
  } else if (phase < 0.25) {
    accent = "#9FC2FF";
    gradient = ["#050A13", "#0C1730", "#18325B"];
  } else if (phase < 0.5) {
    accent = "#C8DAFF";
    gradient = ["#060913", "#111B34", "#243559"];
  } else if (phase < 0.75) {
    accent = "#F4F7FF";
    gradient = ["#070A12", "#151C2E", "#2A3552"];
  }

  if (stateKey === "in_night_before_dawn" || stateKey === "in_night_evening") {
    accent = phase < 0.25 ? "#B9D3FF" : "#E6EEFF";
  }

  return {
    accent: accent,
    accentSoft: colorWithAlpha(accent, 0.18),
    accentGlow: colorWithAlpha(accent, 0.34),
    gradient: gradient,
    card: "rgba(12,18,30,0.64)",
    cardStrong: "rgba(17,24,40,0.82)",
    cardSoft: "rgba(255,255,255,0.07)",
    textMuted: "rgba(236,240,247,0.72)",
    textSubtle: "rgba(236,240,247,0.42)",
    hairline: "rgba(255,255,255,0.10)",
    hairlineStrong: "rgba(255,255,255,0.15)"
  };
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

function formatAgeDays(days) {
  var value = Math.round(Number(days) * 10) / 10;
  if (!isFinite(value)) return "月龄 --";
  return "月龄 " + value.toFixed(1) + " 天";
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
  return parts.join(" · ") || "当前位置";
}

function formatCoordinateLabel(lat, lon) {
  return "坐标 " + roundCoord(lat).toFixed(4) + ", " + roundCoord(lon).toFixed(4);
}

function formatLocationLine(loc) {
  var text = String(loc && loc.name ? loc.name : "").trim();
  var source = String(loc && loc.nameSource ? loc.nameSource : "");
  if (!text) return "当前位置";
  if (source === "coords") return text + " · 坐标定位";
  return text;
}

function firstNonEmpty() {
  for (var i = 0; i < arguments.length; i++) {
    var v = arguments[i];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  return "";
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

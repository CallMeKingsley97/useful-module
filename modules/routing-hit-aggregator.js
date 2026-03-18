// 路由命中汇总脚本
// 职责：
// 1. 汇总观察脚本写入的分桶数据
// 2. 计算 Top 规则组、趋势、异常标记
// 3. 在没有足够观察数据时，可选执行采样探测作为降级

var DEFAULT_RAW_KEY = "routing-hit-observed-state";
var DEFAULT_SUMMARY_KEY = "routing-hit-summary";
var DEFAULT_WINDOW_MINUTES = 30;
var DEFAULT_BUCKET_MINUTES = 5;
var DEFAULT_MIN_SAMPLE_COUNT = 40;
var DEFAULT_MAX_RULES = 3;
var DEFAULT_REJECT_THRESHOLD = 0.15;
var DEFAULT_REFRESH_MINUTES = 15;

export default async function (ctx) {
  var env = ctx.env || {};
  var rawKey = String(env.RAW_STORAGE_KEY || DEFAULT_RAW_KEY);
  var summaryKey = String(env.STORAGE_KEY || DEFAULT_SUMMARY_KEY);
  var dataMode = String(env.DATA_MODE || "auto").trim().toLowerCase();
  var windowMinutes = clampNumber(env.SAMPLE_WINDOW_MINUTES || DEFAULT_WINDOW_MINUTES, 5, 180);
  var bucketMinutes = clampNumber(env.BUCKET_SIZE_MINUTES || DEFAULT_BUCKET_MINUTES, 1, 30);
  var minSampleCount = clampNumber(env.MIN_SAMPLE_COUNT || DEFAULT_MIN_SAMPLE_COUNT, 1, 100000);
  var maxRules = clampNumber(env.MAX_RULES || DEFAULT_MAX_RULES, 1, 12);
  var rejectAlertThreshold = clampNumber(env.REJECT_ALERT_THRESHOLD || DEFAULT_REJECT_THRESHOLD, 0, 1);
  var refreshMinutes = clampNumber(env.REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES, 1, 1440);

  var observedSummary = buildObservedSummary(ctx, rawKey, windowMinutes, bucketMinutes, minSampleCount, maxRules, rejectAlertThreshold, refreshMinutes);
  var shouldUseObserved = dataMode === "observed" || (dataMode === "auto" && observedSummary.totalCount > 0);

  var summary = observedSummary;
  if (!shouldUseObserved && (dataMode === "sampled" || dataMode === "auto")) {
    var sampledSummary = await buildSampledSummary(ctx, env, windowMinutes, maxRules, rejectAlertThreshold, minSampleCount, refreshMinutes);
    if (sampledSummary.totalCount > 0 || dataMode === "sampled") {
      summary = sampledSummary;
    }
  }

  ctx.storage.setJSON(summaryKey, summary);
}

function buildObservedSummary(ctx, rawKey, windowMinutes, bucketMinutes, minSampleCount, maxRules, rejectAlertThreshold, refreshMinutes) {
  var now = Date.now();
  var state = ctx.storage.getJSON(rawKey);
  if (!state || typeof state !== "object" || !state.buckets) {
    return emptySummary("observed", windowMinutes, rejectAlertThreshold);
  }

  var bucketKeys = Object.keys(state.buckets || {});
  var startTs = now - windowMinutes * 60 * 1000;
  var directCount = 0;
  var proxyCount = 0;
  var rejectCount = 0;
  var ruleMap = {};
  var trend = [];
  var sampleStartAt = null;
  var sampleEndAt = null;

  for (var i = 0; i < bucketKeys.length; i++) {
    var key = bucketKeys[i];
    var bucket = state.buckets[key];
    if (!bucket) continue;
    var ts = Number(bucket.ts || key);
    if (!ts || ts < startTs) continue;

    directCount += safeCount(bucket.directCount);
    proxyCount += safeCount(bucket.proxyCount);
    rejectCount += safeCount(bucket.rejectCount);
    sampleStartAt = sampleStartAt === null ? ts : Math.min(sampleStartAt, ts);
    sampleEndAt = sampleEndAt === null ? ts : Math.max(sampleEndAt, ts);

    trend.push({
      slot: formatSlot(ts),
      direct: safeCount(bucket.directCount),
      proxy: safeCount(bucket.proxyCount),
      reject: safeCount(bucket.rejectCount)
    });

    var rules = bucket.rules || {};
    var ruleKeys = Object.keys(rules);
    for (var j = 0; j < ruleKeys.length; j++) {
      var ruleName = ruleKeys[j];
      var item = rules[ruleName] || {};
      if (!ruleMap[ruleName]) {
        ruleMap[ruleName] = { name: ruleName, count: 0, route: normalizeRoute(item.route) || "proxy" };
      }
      ruleMap[ruleName].count += safeCount(item.count);
      if (normalizeRoute(item.route)) ruleMap[ruleName].route = normalizeRoute(item.route);
    }
  }

  trend.sort(function (a, b) { return a.slot < b.slot ? -1 : 1; });
  if (trend.length > Math.ceil(windowMinutes / Math.max(1, bucketMinutes))) {
    trend = trend.slice(-Math.ceil(windowMinutes / Math.max(1, bucketMinutes)));
  }

  var recentRules = Object.keys(ruleMap).map(function (key) { return ruleMap[key]; });
  recentRules.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.name < b.name ? -1 : 1;
  });
  recentRules = recentRules.slice(0, maxRules);

  var totalCount = directCount + proxyCount + rejectCount;
  var updatedAt = state.updatedAt || null;
  var staleMs = refreshMinutes * 2 * 60 * 1000;
  var updatedTs = updatedAt ? Date.parse(updatedAt) : 0;
  var stale = !updatedTs || now - updatedTs > staleMs;

  return {
    mode: "observed",
    windowMinutes: windowMinutes,
    sampleStartAt: sampleStartAt ? new Date(sampleStartAt).toISOString() : null,
    sampleEndAt: sampleEndAt ? new Date(sampleEndAt + bucketMinutes * 60 * 1000).toISOString() : null,
    updatedAt: updatedAt || new Date(now).toISOString(),
    totalCount: totalCount,
    totals: {
      directCount: directCount,
      proxyCount: proxyCount,
      rejectCount: rejectCount
    },
    recentRules: recentRules,
    trend: trend,
    flags: {
      stale: stale,
      lowSample: totalCount < minSampleCount,
      rejectSpike: totalCount > 0 && rejectCount / totalCount >= rejectAlertThreshold
    }
  };
}

async function buildSampledSummary(ctx, env, windowMinutes, maxRules, rejectAlertThreshold, minSampleCount, refreshMinutes) {
  var now = Date.now();
  var probes = parseProbeRules(env.PROBE_RULES_JSON || "[]");
  if (probes.length === 0) {
    return emptySummary("sampled", windowMinutes, rejectAlertThreshold);
  }

  var directCount = 0;
  var proxyCount = 0;
  var rejectCount = 0;
  var recentRules = [];
  var trend = [];

  for (var i = 0; i < probes.length; i++) {
    var probe = probes[i];
    var outcome = await runProbe(ctx, probe);
    if (probe.route === "reject") {
      if (outcome.failed) {
        rejectCount += 1;
        recentRules.push({ name: probe.name, count: 1, route: "reject" });
      }
      continue;
    }

    if (!outcome.failed) {
      if (probe.route === "direct") directCount += 1;
      if (probe.route === "proxy") proxyCount += 1;
      recentRules.push({ name: probe.name, count: 1, route: probe.route });
    }
  }

  var totalCount = directCount + proxyCount + rejectCount;
  recentRules = mergeRecentRules(recentRules).slice(0, maxRules);
  trend.push({
    slot: formatSlot(now),
    direct: directCount,
    proxy: proxyCount,
    reject: rejectCount
  });

  return {
    mode: "sampled",
    windowMinutes: windowMinutes,
    sampleStartAt: new Date(now).toISOString(),
    sampleEndAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    totalCount: totalCount,
    totals: {
      directCount: directCount,
      proxyCount: proxyCount,
      rejectCount: rejectCount
    },
    recentRules: recentRules,
    trend: trend,
    flags: {
      stale: false,
      lowSample: totalCount < minSampleCount,
      rejectSpike: totalCount > 0 && rejectCount / totalCount >= rejectAlertThreshold
    }
  };
}

function parseProbeRules(raw) {
  var result = [];
  try {
    var list = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(list)) return [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var url = String(item.url || "").trim();
      var route = normalizeRoute(item.route);
      var name = truncateRuleName(item.name || item.rule || "");
      if (!url || !route || !name) continue;
      result.push({
        name: name,
        route: route,
        url: url,
        policy: String(item.policy || "").trim(),
        policyDescriptor: String(item.policyDescriptor || "").trim(),
        timeout: clampNumber(item.timeout || 2500, 500, 15000)
      });
    }
  } catch (e) {
    console.log("routing-hit-aggregator parseProbeRules: " + safeMsg(e));
  }
  return result;
}

async function runProbe(ctx, probe) {
  try {
    var options = {
      headers: { "User-Agent": "Egern-Routing-Hit" },
      timeout: probe.timeout
    };
    if (probe.policy) options.policy = probe.policy;
    if (probe.policyDescriptor) options.policyDescriptor = probe.policyDescriptor;

    var resp = await ctx.http.get(probe.url, options);
    if (resp.status >= 200 && resp.status < 500) {
      return { failed: false, status: resp.status };
    }
    return { failed: true, status: resp.status };
  } catch (e) {
    return { failed: true, error: safeMsg(e) };
  }
}

function mergeRecentRules(items) {
  var map = {};
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (!map[item.name]) {
      map[item.name] = { name: item.name, count: 0, route: item.route };
    }
    map[item.name].count += safeCount(item.count);
    map[item.name].route = item.route;
  }
  var list = Object.keys(map).map(function (key) { return map[key]; });
  list.sort(function (a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.name < b.name ? -1 : 1;
  });
  return list;
}

function emptySummary(mode, windowMinutes, rejectAlertThreshold) {
  var now = Date.now();
  return {
    mode: mode,
    windowMinutes: windowMinutes,
    sampleStartAt: null,
    sampleEndAt: null,
    updatedAt: new Date(now).toISOString(),
    totalCount: 0,
    totals: {
      directCount: 0,
      proxyCount: 0,
      rejectCount: 0
    },
    recentRules: [],
    trend: [],
    flags: {
      stale: false,
      lowSample: true,
      rejectSpike: false
    }
  };
}

function safeCount(value) {
  var n = Number(value);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function formatSlot(ts) {
  var date = new Date(ts);
  var hh = String(date.getHours()).padStart(2, "0");
  var mm = String(date.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

function normalizeRoute(value) {
  var route = String(value || "").trim().toLowerCase();
  if (route === "direct" || route === "proxy" || route === "reject") return route;
  return "";
}

function truncateRuleName(name) {
  var text = String(name || "").trim();
  if (!text) return "";
  return text.length > 32 ? text.slice(0, 32) : text;
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

// 路由命中观察脚本
// 说明：
// 1. Egern 公开 API 没有直接暴露全局真实路由决策结果
// 2. 这里通过用户提供的规则映射，对请求 URL 做“观察性归类”
// 3. 本脚本只负责轻量记录分桶统计，汇总和异常判断交给 schedule 脚本

var DEFAULT_RAW_KEY = "routing-hit-observed-state";
var DEFAULT_WINDOW_MINUTES = 30;
var DEFAULT_BUCKET_MINUTES = 5;

export default async function (ctx) {
  try {
    if (!ctx || !ctx.request || !ctx.request.url) return;

    var env = ctx.env || {};
    var rawKey = String(env.RAW_STORAGE_KEY || DEFAULT_RAW_KEY);
    var windowMinutes = clampNumber(env.SAMPLE_WINDOW_MINUTES || DEFAULT_WINDOW_MINUTES, 5, 180);
    var bucketMinutes = clampNumber(env.BUCKET_SIZE_MINUTES || DEFAULT_BUCKET_MINUTES, 1, 30);
    var rules = parseRuleMap(env.RULE_MAP_JSON || "[]");
    var defaultRoute = normalizeRoute(env.DEFAULT_ROUTE || "ignore");
    var defaultRuleName = truncateRuleName(env.DEFAULT_RULE_NAME || "其他");

    var observed = classifyRequest(ctx.request.url, rules, defaultRoute, defaultRuleName);
    if (!observed) return;

    var state = loadState(ctx, rawKey, bucketMinutes, windowMinutes);
    var now = Date.now();
    var bucketTs = floorToBucket(now, bucketMinutes);
    var bucketKey = String(bucketTs);
    var bucket = state.buckets[bucketKey] || createBucket(bucketTs);

    bucket.totalCount += 1;
    bucket[observed.route + "Count"] += 1;

    if (!bucket.rules[observed.name]) {
      bucket.rules[observed.name] = { count: 0, route: observed.route };
    }
    bucket.rules[observed.name].count += 1;
    bucket.rules[observed.name].route = observed.route;

    state.buckets[bucketKey] = bucket;
    state.updatedAt = new Date(now).toISOString();
    state.lastUrl = safeString(ctx.request.url, 120);
    state.lastRule = observed.name;
    state.lastRoute = observed.route;
    state.totalObservedCount = (state.totalObservedCount || 0) + 1;

    trimBuckets(state, now, windowMinutes, bucketMinutes);
    ctx.storage.setJSON(rawKey, state);
  } catch (e) {
    // 观察脚本不能影响原始请求，异常时直接吞掉
    console.log("routing-hit-observer: " + safeMsg(e));
  }
}

function parseRuleMap(raw) {
  var parsed = [];
  try {
    var list = JSON.parse(String(raw || "[]"));
    if (!Array.isArray(list)) return [];
    for (var i = 0; i < list.length; i++) {
      var item = list[i] || {};
      var pattern = String(item.pattern || "").trim();
      var name = truncateRuleName(item.name || item.rule || "");
      var route = normalizeRoute(item.route || "");
      if (!pattern || !name || !route) continue;
      parsed.push({
        name: name,
        route: route,
        pattern: pattern,
        target: String(item.target || "host").toLowerCase()
      });
    }
  } catch (e) {
    console.log("routing-hit-observer parseRuleMap: " + safeMsg(e));
  }
  return parsed;
}

function classifyRequest(url, rules, defaultRoute, defaultRuleName) {
  var parsedUrl = safeParseUrl(url);
  if (!parsedUrl) return null;

  var host = String(parsedUrl.host || "").toLowerCase();
  var fullUrl = String(parsedUrl.href || url);

  for (var i = 0; i < rules.length; i++) {
    var rule = rules[i];
    try {
      var re = new RegExp(rule.pattern, "i");
      var targetValue = rule.target === "url" ? fullUrl : host;
      if (re.test(targetValue)) {
        return { name: rule.name, route: rule.route };
      }
    } catch (e) {
      console.log("routing-hit-observer invalid regexp: " + rule.pattern);
    }
  }

  if (defaultRoute === "ignore") return null;
  return { name: defaultRuleName, route: defaultRoute };
}

function loadState(ctx, rawKey, bucketMinutes, windowMinutes) {
  var state = ctx.storage.getJSON(rawKey);
  if (!state || typeof state !== "object") {
    return {
      version: 1,
      bucketSizeMinutes: bucketMinutes,
      windowMinutes: windowMinutes,
      totalObservedCount: 0,
      buckets: {}
    };
  }
  if (!state.buckets || typeof state.buckets !== "object") state.buckets = {};
  state.bucketSizeMinutes = bucketMinutes;
  state.windowMinutes = windowMinutes;
  return state;
}

function createBucket(ts) {
  return {
    ts: ts,
    totalCount: 0,
    directCount: 0,
    proxyCount: 0,
    rejectCount: 0,
    rules: {}
  };
}

function trimBuckets(state, now, windowMinutes, bucketMinutes) {
  var maxAge = (windowMinutes + bucketMinutes * 2) * 60 * 1000;
  var keys = Object.keys(state.buckets || {});
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var bucket = state.buckets[key];
    var ts = bucket && bucket.ts ? Number(bucket.ts) : Number(key);
    if (!ts || now - ts > maxAge) {
      delete state.buckets[key];
    }
  }
}

function floorToBucket(ts, bucketMinutes) {
  var bucketMs = bucketMinutes * 60 * 1000;
  return Math.floor(ts / bucketMs) * bucketMs;
}

function normalizeRoute(value) {
  var route = String(value || "").trim().toLowerCase();
  if (route === "direct" || route === "proxy" || route === "reject" || route === "ignore") return route;
  return "";
}

function truncateRuleName(name) {
  var value = String(name || "").trim();
  if (!value) return "";
  return value.length > 32 ? value.slice(0, 32) : value;
}

function safeParseUrl(url) {
  try {
    return new URL(url);
  } catch (e) {
    return null;
  }
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

function safeString(value, maxLen) {
  var text = String(value || "");
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

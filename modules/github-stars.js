// GitHub Stars 多仓库追踪小组件
// 同时展示多个 GitHub 仓库的实时 Star 数量
// 科技感暗黑 UI，支持多种小组件尺寸

var CACHE_KEY = "gh_stars_multi";
var CACHE_TTL = 10 * 60 * 1000; // 10 分钟缓存

export default async function (ctx) {
  var env = ctx.env || {};
  var family = ctx.widgetFamily || "systemMedium";
  var reposRaw = env.REPOS || "";
  var token = (env.GITHUB_TOKEN || "").trim();
  var accent = env.ACCENT_COLOR || "#58A6FF";
  var title = env.TITLE || "GitHub Stars";

  // 解析仓库列表
  var repos = parseRepos(reposRaw);
  if (repos.length === 0) {
    return errorWidget("请配置 REPOS", "在环境变量中设置仓库\n例如: vuejs/vue,facebook/react");
  }

  // 尝试缓存优先
  var cached = loadCache(ctx);
  var data = null;

  if (cached && cached.repos && cached.repos.length > 0) {
    data = cached;
  }

  // 拉取最新数据
  try {
    var freshData = await fetchAllRepos(ctx, repos, token);
    data = { repos: freshData, ts: Date.now() };
    saveCache(ctx, data);
  } catch (e) {
    console.log("fetch error: " + safeMsg(e));
    if (!data) {
      return errorWidget("获取失败", safeMsg(e));
    }
  }

  var repoList = data.repos || [];
  var stale = data.ts && (Date.now() - data.ts > CACHE_TTL);

  // 刷新时间：15 分钟后
  var refreshAfter = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  // 根据 widgetFamily 选择布局
  if (family === "accessoryCircular") return buildCircular(repoList, accent);
  if (family === "accessoryRectangular") return buildRectangular(repoList, accent);
  if (family === "accessoryInline") return buildInline(repoList);
  if (family === "systemSmall") return buildSmall(repoList, title, accent, refreshAfter, stale);
  if (family === "systemLarge") return buildLarge(repoList, title, accent, refreshAfter, stale);
  return buildMedium(repoList, title, accent, refreshAfter, stale);
}

// ============== 数据层 ==============

async function fetchAllRepos(ctx, repos, token) {
  var results = [];
  var headers = { "User-Agent": "Egern-Widget" };
  if (token) headers["Authorization"] = "Bearer " + token;

  for (var i = 0; i < repos.length; i++) {
    try {
      var resp = await ctx.http.get("https://api.github.com/repos/" + repos[i], { headers: headers, timeout: 10000 });
      if (resp.status === 200) {
        var d = await resp.json();
        results.push({
          repo: repos[i],
          name: d.name || repos[i].split("/")[1],
          owner: d.owner ? d.owner.login : repos[i].split("/")[0],
          stars: d.stargazers_count || 0,
          forks: d.forks_count || 0,
          lang: d.language || "",
          desc: d.description || ""
        });
      } else {
        results.push({ repo: repos[i], name: repos[i].split("/")[1], owner: repos[i].split("/")[0], stars: -1, forks: 0, lang: "", desc: "HTTP " + resp.status });
      }
    } catch (e) {
      results.push({ repo: repos[i], name: repos[i].split("/")[1], owner: repos[i].split("/")[0], stars: -1, forks: 0, lang: "", desc: safeMsg(e) });
    }
  }
  return results;
}

// ============== 各布局构建 ==============

function buildMedium(repos, title, accent, refreshAfter, stale) {
  // 取前 4 个仓库，分左右两列
  var items = repos.slice(0, 8);
  var half = Math.ceil(items.length / 2);
  var left = items.slice(0, half);
  var right = items.slice(half);

  return shell([
    header(title, accent, true),
    sp(4),
    separator(),
    sp(6),
    hstack([
      vstack(left.map(function (r) { return repoRow(r, accent, false); }), { gap: 6, flex: 1 }),
      vstack([], { width: 1, backgroundColor: "rgba(255,255,255,0.06)" }),
      vstack(right.map(function (r) { return repoRow(r, accent, false); }), { gap: 6, flex: 1 })
    ], { gap: 8, alignItems: "start" }),
    sp(),
    footer(stale)
  ], refreshAfter);
}

function buildSmall(repos, title, accent, refreshAfter, stale) {
  var items = repos.slice(0, 4);
  return shell([
    header(title, accent, false),
    sp(4),
    separator(),
    sp(),
    vstack(items.map(function (r) { return repoRow(r, accent, true); }), { gap: 5 }),
    sp(),
    footer(stale)
  ], refreshAfter, [12, 14, 10, 14]);
}

function buildLarge(repos, title, accent, refreshAfter, stale) {
  // 顶部展示前 2 个仓库卡片，下面用列表展示剩余仓库
  var featured = repos.slice(0, 2);
  var rest = repos.slice(2, 10);

  var featuredCards = featured.map(function (r) { return repoCard(r, accent); });

  var children = [
    header(title, accent, true),
    sp(6),
    separator(),
    sp(8),
    hstack(featuredCards, { gap: 8 }),
  ];

  if (rest.length > 0) {
    children.push(sp(8));
    children.push(txt("MORE REPOS", "caption2", "semibold", "rgba(255,255,255,0.3)"));
    children.push(sp(4));
    children.push(vstack(rest.map(function (r) { return repoRow(r, accent, false); }), { gap: 5 }));
  }

  children.push(sp());
  children.push(footer(stale));

  return shell(children, refreshAfter, [14, 16, 10, 16]);
}

function buildCircular(repos, accent) {
  var r = repos[0];
  if (!r) return { type: "widget", children: [txt("N/A", "caption1", "bold")] };
  return {
    type: "widget",
    gap: 2,
    children: [
      sp(),
      icon("star.fill", 16, accent),
      txt(fmtK(r.stars), 14, "bold", null, { minScale: 0.5 }),
      txt(r.name, 9, "medium", null, { minScale: 0.5, maxLines: 1 }),
      sp()
    ]
  };
}

function buildRectangular(repos, accent) {
  var items = repos.slice(0, 3);
  return {
    type: "widget",
    gap: 3,
    children: items.map(function (r) {
      return hstack([
        icon("star.fill", 8, accent),
        txt(r.name, 10, "medium", null, { maxLines: 1 }),
        sp(),
        txt(fmtK(r.stars), 10, "bold")
      ], { gap: 3 });
    })
  };
}

function buildInline(repos) {
  var r = repos[0];
  var text = r ? (r.name + " ⭐ " + fmtK(r.stars)) : "N/A";
  if (repos.length > 1) {
    text += " · " + repos[1].name + " ⭐ " + fmtK(repos[1].stars);
  }
  return {
    type: "widget",
    children: [
      icon("star.fill", 12),
      txt(text, 12, "medium", null, { minScale: 0.5, maxLines: 1 })
    ]
  };
}

// ============== UI 组件工厂 ==============

function repoRow(r, accent, compact) {
  var sz = compact ? 11 : 12;
  var starText = r.stars >= 0 ? fmtK(r.stars) : "N/A";
  var starColor = r.stars >= 0 ? "#FFFFFF" : "#FF453A";

  var langDot = r.lang ? [
    { type: "stack", width: 6, height: 6, borderRadius: 3, backgroundColor: langColor(r.lang), children: [] },
  ] : [];

  return hstack(
    [icon("star.fill", compact ? 10 : 11, accent)]
      .concat(langDot)
      .concat([
        txt(r.name || r.repo, sz, "medium", "#FFFFFFCC", { maxLines: 1, minScale: 0.7 }),
        sp(),
        txt(starText, sz, "bold", starColor, { minScale: 0.7 })
      ]),
    { gap: compact ? 4 : 5 }
  );
}

function repoCard(r, accent) {
  var starText = r.stars >= 0 ? formatNumber(r.stars) : "N/A";

  var langRow = r.lang ? hstack([
    { type: "stack", width: 6, height: 6, borderRadius: 3, backgroundColor: langColor(r.lang), children: [] },
    txt(r.lang, "caption2", "medium", "rgba(255,255,255,0.5)")
  ], { gap: 4 }) : sp(0);

  return vstack([
    hstack([
      icon("star.fill", 14, accent),
      txt(r.owner + "/" + r.name, 11, "semibold", "#FFFFFFCC", { maxLines: 1, minScale: 0.6 }),
    ], { gap: 4 }),
    sp(2),
    txt(starText, 22, "bold", "#FFFFFF"),
    sp(2),
    langRow,
  ], {
    flex: 1,
    gap: 0,
    padding: [10, 12, 10, 12],
    backgroundGradient: {
      type: "linear",
      colors: [accent + "22", accent + "08"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    borderRadius: 12,
    borderWidth: 0.5,
    borderColor: accent + "44"
  });
}

function shell(children, refreshAfter, padding) {
  return {
    type: "widget",
    gap: 0,
    padding: padding || [12, 14, 10, 14],
    backgroundGradient: {
      type: "linear",
      colors: ["#0D1117", "#161B22", "#1C2333"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 0.5, y: 1 }
    },
    refreshAfter: refreshAfter,
    children: children
  };
}

function header(title, accent, showTime) {
  var children = [
    icon("star.circle.fill", 16, accent),
    txt(title, 13, "bold", accent, {
      shadowColor: accent + "66",
      shadowRadius: 4,
      shadowOffset: { x: 0, y: 0 }
    }),
    sp()
  ];
  if (showTime) {
    children.push({
      type: "date",
      date: new Date().toISOString(),
      format: "time",
      font: { size: 10, weight: "medium" },
      textColor: "rgba(255,255,255,0.35)"
    });
  }
  return hstack(children, { gap: 5 });
}

function footer(stale) {
  return hstack([
    icon("clock.arrow.circlepath", 8, "rgba(255,255,255,0.25)"),
    {
      type: "date",
      date: new Date().toISOString(),
      format: "relative",
      font: { size: 9, weight: "medium" },
      textColor: "rgba(255,255,255,0.25)"
    },
    sp(),
    txt(stale ? "cached" : "live", 8, "medium", stale ? "#FFC10766" : "#3FB95066")
  ], { gap: 3 });
}

function separator() {
  return hstack([sp()], { height: 1, backgroundColor: "rgba(255,255,255,0.06)" });
}

function errorWidget(title, msg) {
  return {
    type: "widget",
    padding: 16,
    gap: 8,
    backgroundColor: "#0D1117",
    children: [
      hstack([icon("exclamationmark.triangle.fill", 14, "#FFC107"), txt(title, "subheadline", "bold", "#FFFFFF")], { gap: 6 }),
      sp(),
      txt(msg || "未知错误", "caption1", null, "#FFFFFFAA", { maxLines: 4 })
    ]
  };
}

// ============== DSL 简写 ==============

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

// ============== 工具函数 ==============

function parseRepos(raw) {
  if (!raw) return [];
  return raw.split(",").map(function (s) {
    s = s.trim();
    if (s.indexOf("github.com/") >= 0) s = s.split("github.com/")[1];
    s = s.replace(/^\/+/, "").replace(/\/+$/, "");
    var parts = s.split("/");
    return parts.length >= 2 ? parts[0] + "/" + parts[1] : "";
  }).filter(function (s) { return s.length > 0; });
}

function formatNumber(n) {
  return (Number.isFinite(n) && n >= 0) ? n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0";
}

function fmtK(n) {
  if (!Number.isFinite(n) || n < 0) return "N/A";
  if (n >= 10000) return (n / 1000).toFixed(1) + "K";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function langColor(lang) {
  var colors = {
    JavaScript: "#F1E05A", TypeScript: "#3178C6", Python: "#3572A5",
    Java: "#B07219", Go: "#00ADD8", Rust: "#DEA584",
    "C++": "#F34B7D", C: "#555555", Ruby: "#701516",
    Swift: "#F05138", Kotlin: "#A97BFF", Dart: "#00B4AB",
    PHP: "#4F5D95", Shell: "#89E051", Scala: "#C22D40",
    Vue: "#41B883", HTML: "#E34C26", CSS: "#563D7C"
  };
  return colors[lang] || "#8B949E";
}

function loadCache(ctx) {
  try { return ctx.storage.getJSON(CACHE_KEY); } catch (e) { return null; }
}

function saveCache(ctx, data) {
  try { ctx.storage.setJSON(CACHE_KEY, data); } catch (e) { /* ignore */ }
}

function safeMsg(e) {
  if (!e) return "未知错误";
  if (typeof e === "string") return e;
  if (e.message) return e.message;
  return "未知错误";
}

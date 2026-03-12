// Star-History 小组件（增强版：真实历史曲线 + 总数）
// 1) 采样 GitHub stargazers 的 starred_at 生成历史趋势
// 2) 失败回退缓存，确保不空白
// 3) 结构参考 life-progress，保持线性扁平化布局

const PER_PAGE = 100;
const DEFAULT_SAMPLE_POINTS = 16;

export default async function (ctx) {
  try {
    return await run(ctx);
  } catch (err) {
    return buildErrorWidget("系统繁忙", safeError(err));
  }
}

async function run(ctx) {
  const env = ctx.env || {};
  const repo = normalizeRepo(env.GITHUB_REPO || "");
  const title = env.TITLE || repo || "GitHub Stars";
  const token = (env.GITHUB_TOKEN || "").replace(/['"]/g, "").trim();
  const color1 = env.COLOR_1 || "#24292E";
  const color2 = env.COLOR_2 || "#0D1117";
  const chartColor = env.CHART_COLOR || "#F9A826";
  const samplePoints = clampInt(env.SAMPLE_POINTS, DEFAULT_SAMPLE_POINTS, 6, 30);

  if (!repo) return buildErrorWidget("配置缺失", "请设置 GITHUB_REPO 环境变量");

  const cacheKey = `gh_star_history_${repo.replace("/", "_")}`;
  let data = null;
  let stale = false;
  let warning = "";

  try {
    data = await fetchStarData(ctx, repo, samplePoints, token);
    ctx.storage.setJSON(cacheKey, data);
  } catch (err) {
    warning = safeError(err);
    data = ctx.storage.getJSON(cacheKey);
    stale = true;
    if (!data) return buildErrorWidget("获取失败", warning);
  }

  return renderWidget({ title, repo, data, color1, color2, chartColor, stale, warning });
}

// ============== UI 渲染层 ==============

function renderWidget({ title, repo, data, color1, color2, chartColor, stale, warning }) {
  const total = data.total;
  const records = data.records || [];

  const bars = buildBars(records, chartColor);

  const milestones = [100, 500, 1000, 2000, 5000, 10000, 50000, 100000, 250000, 500000];
  const target = milestones.find((m) => total < m) || (total + 10000);
  const progress = Math.min(1, total / target);
  const progressPercent = (progress * 100).toFixed(1);

  return {
    type: "widget",
    padding: 16,
    gap: 12,
    backgroundGradient: {
      type: "linear",
      colors: [color1, color2],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 },
    },
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          { type: "image", src: "sf-symbol:star.fill", width: 14, height: 14, color: chartColor },
          { type: "text", text: title, font: { size: "subheadline", weight: "semibold" }, textColor: "#FFFFFFCC" },
          { type: "spacer" },
          { type: "text", text: repo, font: { size: "caption2" }, textColor: "#FFFFFF66" }
        ]
      },

      { type: "spacer" },

      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        children: [
          {
            type: "stack",
            direction: "column",
            alignItems: "start",
            children: [
              { type: "text", text: formatNumber(total), font: { size: 36, weight: "bold" }, textColor: "#FFFFFF", minScale: 0.6 },
              { type: "text", text: "Total Stars", font: { size: "caption2" }, textColor: "#8B949E" }
            ]
          },
          { type: "spacer" },
          {
            type: "stack",
            direction: "row",
            alignItems: "end",
            height: 40,
            gap: 3,
            children: bars
          }
        ]
      },

      {
        type: "stack",
        direction: "row",
        children: [
          { type: "text", text: stale ? `缓存 · ${warning || "上次成功"}` : "实时数据", font: { size: "caption2" }, textColor: stale ? "#FFC107" : "#8B949E", maxLines: 2 },
          { type: "spacer" },
          { type: "text", text: "历史增长", font: { size: "caption2" }, textColor: "#8B949E" }
        ]
      },

      {
        type: "stack",
        direction: "column",
        gap: 6,
        children: [
          {
            type: "stack",
            direction: "row",
            height: 6,
            borderRadius: 3,
            backgroundColor: "#FFFFFF20",
            children: [
              {
                type: "stack",
                flex: Math.max(0.001, progress),
                height: 6,
                borderRadius: 3,
                backgroundColor: chartColor,
                children: [],
              },
              { type: "stack", flex: 1 - progress, children: [] }
            ],
          },
          {
            type: "stack",
            direction: "row",
            children: [
              { type: "text", text: `下一里程碑: ${formatNumber(target)}`, font: { size: "caption2" }, textColor: "#8B949E" },
              { type: "spacer" },
              { type: "text", text: `${progressPercent}%`, font: { size: "caption2", weight: "bold" }, textColor: chartColor }
            ]
          }
        ]
      }
    ]
  };
}

// ============== 数据获取 ==============

async function fetchStarData(ctx, repo, samplePoints, token) {
  const headers = { "User-Agent": "Egern-Widget-Client" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const starHeaders = {
    "User-Agent": "Egern-Widget-Client",
    Accept: "application/vnd.github.v3.star+json"
  };
  if (token) starHeaders.Authorization = `Bearer ${token}`;

  const repoResp = await fetchJson(ctx, `https://api.github.com/repos/${repo}`, headers);
  const total = toNonNegativeInt(repoResp.stargazers_count);

  if (total === 0) {
    return { total: 0, records: [{ count: 0, date: new Date().toISOString() }] };
  }

  const firstPageResp = await fetchJson(ctx, `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=1`, starHeaders, true);
  const firstPageData = Array.isArray(firstPageResp.body) ? firstPageResp.body : [];
  const totalPages = parseLastPage(firstPageResp.headers);
  const samplePages = buildSamplePages(totalPages, samplePoints);

  const records = [];

  for (const page of samplePages) {
    try {
      let pageData = null;
      if (page === 1) {
        pageData = firstPageData;
      } else {
        const pageResp = await fetchJson(ctx, `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`, starHeaders, true);
        pageData = Array.isArray(pageResp.body) ? pageResp.body : [];
      }

      const record = buildRecordFromPage(page, pageData, total);
      if (record) records.push(record);
    } catch (pageErr) {
      console.log(`[github-stars] page ${page} skipped: ${safeError(pageErr)}`);
    }
  }

  records.push({ count: total, date: new Date().toISOString() });

  return { total, records: normalizeRecords(records, samplePoints, total) };
}

async function fetchJson(ctx, url, headers, withHeaders) {
  let resp;
  try {
    resp = await ctx.http.get(url, { headers });
  } catch (err) {
    throw new Error(`请求失败: ${url} -> ${safeError(err)}`);
  }

  if (!resp || resp.status !== 200) {
    const status = resp && typeof resp.status === "number" ? resp.status : "unknown";
    throw new Error(`HTTP ${status}: ${url}`);
  }

  const body = await readJson(resp, url);

  if (withHeaders) {
    return { body, headers: resp.headers || {} };
  }

  return body;
}

async function readJson(resp, url) {
  try {
    if (resp && resp.body) return resp.body;
    if (resp && typeof resp.json === "function") return await resp.json();
  } catch (err) {
    throw new Error(`JSON 解析失败: ${url} -> ${safeError(err)}`);
  }
  throw new Error(`JSON 解析失败: ${url}`);
}

function buildRecordFromPage(page, pageData, total) {
  if (!Array.isArray(pageData) || pageData.length === 0) return null;
  const idx = pageData.length - 1;
  const item = pageData[idx];
  if (!item || !item.starred_at) return null;
  const count = Math.max(1, total - (page - 1) * PER_PAGE - idx);
  return { count, date: item.starred_at };
}

function buildSamplePages(totalPages, samplePoints) {
  if (totalPages <= 1) return [1];

  const pages = [];
  const slots = Math.max(2, samplePoints - 1);

  if (totalPages <= slots) {
    for (let p = 1; p <= totalPages; p += 1) pages.push(p);
  } else {
    for (let i = 0; i < slots; i += 1) {
      const ratio = slots === 1 ? 0 : i / (slots - 1);
      const page = 1 + Math.round(ratio * (totalPages - 1));
      pages.push(page);
    }
  }

  return uniqueSortedInts(pages);
}

function normalizeRecords(records, samplePoints, total) {
  const valid = (records || [])
    .filter((r) => r && Number.isFinite(r.count))
    .map((r) => ({
      count: toNonNegativeInt(r.count),
      date: typeof r.date === "string" ? r.date : new Date().toISOString()
    }));

  valid.sort((a, b) => a.count - b.count);

  const dedup = [];
  for (const item of valid) {
    if (dedup.length === 0 || dedup[dedup.length - 1].count !== item.count) {
      dedup.push(item);
    }
  }

  const last = dedup.length > 0 ? dedup[dedup.length - 1] : null;
  if (!last || last.count !== total) {
    dedup.push({ count: total, date: new Date().toISOString() });
  }

  if (dedup.length <= samplePoints) return dedup;

  const sampled = [];
  for (let i = 0; i < samplePoints; i += 1) {
    const idx = Math.round((i * (dedup.length - 1)) / (samplePoints - 1));
    sampled.push(dedup[idx]);
  }

  return sampled;
}

// ============== 组件与工具函数 ==============

function buildBars(records, chartColor) {
  const safe = Array.isArray(records) ? records.filter((r) => r && Number.isFinite(r.count)) : [];
  if (safe.length === 0) {
    return [{ type: "stack", width: 4, height: 4, backgroundColor: "#30363D", borderRadius: 2, children: [] }];
  }

  const max = Math.max(...safe.map((r) => r.count), 1);

  return safe.map((r) => {
    const h = Math.max(4, Math.round((r.count / max) * 40));
    return {
      type: "stack",
      width: 4,
      height: h,
      backgroundColor: chartColor,
      borderRadius: 2,
      children: []
    };
  });
}

function normalizeRepo(input) {
  let r = String(input || "").trim();
  if (r.includes("github.com/")) r = r.split("github.com/")[1];
  r = r.replace(/^\/+/, "").replace(/\/+$/, "");
  return r.split("/").slice(0, 2).join("/");
}

function formatNumber(n) { return (Number.isFinite(n) ? n : 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ","); }

function buildErrorWidget(title, msg) {
  return {
    type: "widget",
    padding: 16,
    backgroundColor: "#0D1117",
    children: [
      { type: "text", text: title, font: { weight: "bold" }, textColor: "#FF3B30" },
      { type: "text", text: msg || "未知错误", font: { size: "caption1" }, textColor: "#FFFFFFCC", maxLines: 3 }
    ]
  };
}

function parseLastPage(headers) {
  const link = (headers && (headers.link || headers.Link)) || "";
  const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/);
  return match ? parseInt(match[1], 10) : 1;
}

function clampInt(n, fb, min, max) {
  const v = parseInt(n, 10);
  return isNaN(v) ? fb : Math.min(Math.max(v, min), max);
}

function toNonNegativeInt(n) { return Math.max(0, parseInt(n, 10) || 0); }

function uniqueSortedInts(arr) { return [...new Set(arr)].sort((a, b) => a - b); }

function safeError(err) {
  if (!err) return "未知错误";
  if (typeof err === "string") return err;
  if (err && typeof err.message === "string") return err.message;
  return "未知错误";
}

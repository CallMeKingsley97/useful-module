// Star-History 小组件 (V6 字符迷你图重构版)
// 1. 彻底抛弃易崩溃的 Flex 色块，使用极客风的 Unicode Sparkline (字符迷你图) 展现增长曲线，100% 保证渲染。
// 2. 整体 UI 升级为 GitHub 暗黑风高质感渐变仪表盘。

const PER_PAGE = 100
const DEFAULT_SAMPLE_POINTS = 18 // 稍微增加采样点，让字符折线更绵长

export default async function (ctx) {
  try {
    return await run(ctx)
  } catch (err) {
    return buildErrorWidget("脚本异常", safeError(err))
  }
}

async function run(ctx) {
  const env = ctx.env || {}
  const repo = normalizeRepo(env.GITHUB_REPO || "")
  const title = env.TITLE || repo || "GitHub Stars"
  const chartColor = env.CHART_COLOR || "#E36209" // 默认 GitHub 橙
  const samplePoints = clampInt(env.SAMPLE_POINTS, DEFAULT_SAMPLE_POINTS, 3, 30)
  const stage = clampInt(env.RENDER_STAGE, 3, 0, 3)

  let token = (env.GITHUB_TOKEN || "").replace(/['"]/g, '').trim()

  if (!repo) {
    return buildErrorWidget("配置缺失", "请设置 GITHUB_REPO，如 egerndaddy/quick-start")
  }

  if (stage === 0) return buildStage0Widget(title)
  if (stage === 1) return buildStage1Widget(title, repo)

  const cacheKey = `github_stars_v6_${repo.replace("/", "_")}`
  let data = null
  let stale = false
  let warning = ""

  try {
    data = await fetchStarData(ctx, repo, samplePoints, token)
    writeCache(ctx, cacheKey, data)
  } catch (err) {
    warning = safeError(err)
    data = readCache(ctx, cacheKey)
    stale = !!data
    if (!data) return buildErrorWidget("数据获取失败", warning)
  }

  if (stage === 2) return buildStage2Widget({ title, repo, total: data.total, stale, warning })

  return buildStage3Widget({ title, repo, total: data.total, records: data.records, chartColor, stale, warning })
}

// ============== 字符迷你图核心算法 ==============

function generateSparkline(records) {
  if (!records || records.length === 0) return '暂无数据';
  // Unicode 阶梯方块字符，完美模拟柱状/折线图
  const ticks = [' ', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  const counts = records.map(r => r.count);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  const range = max - min;

  if (range === 0) return ticks[0].repeat(counts.length);

  return counts.map(c => {
    const ratio = (c - min) / range;
    const tickIndex = Math.floor(ratio * (ticks.length - 1));
    return ticks[tickIndex];
  }).join(''); // 紧密排列，形成连贯波浪
}

// ============== 核心 UI 渲染层 (高质感仪表盘版) ==============

function buildStage3Widget({ title, repo, total, records, chartColor, stale, warning }) {
  const safe = Array.isArray(records) ? records.filter((r) => r && Number.isFinite(r.count)) : []
  const sparklineText = generateSparkline(safe)

  return {
    type: "widget",
    padding: 16,
    // 升级1: 深邃渐变背景，更具现代感
    backgroundGradient: {
      type: "linear",
      colors: ["#1E2228", "#0D1117"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: [
      // 第一行：Icon 与 仓库名
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          { type: "image", src: "sf-symbol:star.circle.fill", width: 16, height: 16, color: "#F9A826" },
          { type: "text", text: repo, font: { size: "subheadline", weight: "medium" }, textColor: "#8B949E" },
        ]
      },
      
      { type: "spacer" },
      
      // 第二行：大数字总数
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        gap: 4,
        children: [
          { type: "text", text: formatNumber(total), font: { size: 40, weight: "heavy" }, textColor: "#FFFFFF" },
          {
            type: "stack",
            padding: [0, 0, 6, 0],
            children: [
              { type: "text", text: "Stars", font: { size: "footnote", weight: "bold" }, textColor: "#F9A826" }
            ]
          }
        ]
      },
      
      // 第三行：迷你趋势图 (通过字体直接渲染)
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        gap: 8,
        children: [
          { 
            type: "text", 
            text: sparklineText, 
            font: { size: 26, weight: "regular" }, 
            textColor: chartColor 
          },
          { type: "spacer" },
          // 升级2: 增加右侧绿色的增长趋势角标
          {
             type: "stack",
             direction: "row",
             alignItems: "center",
             gap: 2,
             children: [
               { type: "image", src: "sf-symbol:arrow.up.forward", width: 10, height: 10, color: "#34C759" },
               { type: "text", text: "Trend", font: { size: "caption2", weight: "bold" }, textColor: "#34C759" }
             ]
          }
        ]
      },

      { type: "spacer", height: 6 },
      
      // 底部：状态栏
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          { type: "text", text: stale ? `缓存 · ${warning}` : "实时数据监控中", font: { size: "caption2" }, textColor: stale ? "#FFC107" : "#6E7681", maxLines: 1 }
        ]
      }
    ]
  }
}

// ============== 网络请求层 ==============

async function fetchJsonWithHeaders(ctx, url, headers) {
  const noCacheUrl = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
  if (ctx && ctx.http && typeof ctx.http.get === 'function') {
    try {
      const resp = await ctx.http.get(noCacheUrl, { headers })
      if (!resp || resp.status !== 200) throw new Error(`HTTP ${resp ? resp.status : "unknown"}`)
      return { body: await resp.json(), headers: resp.headers || {} }
    } catch (err) { throw new Error(`请求失败: ${safeError(err)}`) }
  }
  throw new Error("环境不支持请求")
}

async function fetchStarData(ctx, repo, samplePoints, token) {
  const baseHeaders = { "User-Agent": "Egern-Widget-Client" }
  if (token) baseHeaders.Authorization = `Bearer ${token}`
  const starHeaders = { ...baseHeaders, Accept: "application/vnd.github.v3.star+json" }

  const repoResp = await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}`, baseHeaders)
  const total = toNonNegativeInt(repoResp.body && repoResp.body.stargazers_count)
  if (total === 0) return { total: 0, records: [{ count: 0 }] }

  const firstPageResp = await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=1`, starHeaders)
  const firstPageData = Array.isArray(firstPageResp.body) ? firstPageResp.body : []
  const totalPages = parseLastPage(firstPageResp.headers)
  const samplePages = buildSamplePages(totalPages, samplePoints)

  const records = []
  for (const page of samplePages) {
    try {
      let pageData = page === 1 ? firstPageData : (await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`, starHeaders)).body
      if (Array.isArray(pageData) && pageData.length > 0) {
        const step = Math.max(1, Math.floor(pageData.length / 4))
        for (let i = 0; i < pageData.length; i += step) {
          records.push({ count: (page - 1) * PER_PAGE + i + 1 })
        }
        records.push({ count: (page - 1) * PER_PAGE + pageData.length })
      }
    } catch (pageErr) { }
  }
  records.push({ count: total })
  return { total, records: normalizeRecords(records, samplePoints, total) }
}

// ============== 占位界面与其他工具函数 ==============

function buildErrorWidget(title, message) {
  return { type: "widget", padding: 16, gap: 8, backgroundColor: "#0D1117", children: [{ type: "stack", direction: "row", alignItems: "center", gap: 6, children: [{ type: "image", src: "sf-symbol:exclamationmark.triangle.fill", width: 16, height: 16, color: "#FF6B6B" }, { type: "text", text: title, font: { size: "headline", weight: "bold" }, textColor: "#FF6B6B" }] }, { type: "text", text: message || "未知错误", font: { size: "caption1" }, textColor: "#FFFFFF", maxLines: 4 }] }
}

function buildStage0Widget(title) { return { type: "widget", padding: 16, backgroundColor: "#0D1117", children: [{ type: "text", text: `Ready · ${title}`, font: { size: "subheadline" }, textColor: "#FFFFFF" }] } }
function buildStage1Widget(title, repo) { return { type: "widget", padding: 16, gap: 8, backgroundColor: "#0D1117", children: [{ type: "text", text: title, font: { size: "headline", weight: "bold" }, textColor: "#FFFFFF" }, { type: "text", text: repo, font: { size: "caption1" }, textColor: "#8B949E" }] } }
function buildStage2Widget({ title, repo, total, stale, warning }) { return { type: "widget", padding: 16, gap: 8, backgroundColor: "#0D1117", children: [{ type: "text", text: title, font: { size: "headline", weight: "bold" }, textColor: "#FFFFFF" }, { type: "text", text: repo, font: { size: "caption1" }, textColor: "#8B949E" }, { type: "text", text: formatNumber(total) + " Stars", font: { size: 34, weight: "heavy" }, textColor: "#FFFFFF" }, { type: "text", text: stale ? `缓存数据 · ${warning}` : "实时数据", font: { size: "caption2" }, textColor: stale ? "#FFC107" : "#8B949E" }] } }

function parseLastPage(headers) {
  let linkStr = ""
  if (headers && typeof headers.get === 'function') { linkStr = headers.get('link') || headers.get('Link') || "" } 
  else if (headers) { linkStr = headers.link || headers.Link || "" }
  if (!linkStr) return 1
  const match = linkStr.match(/[?&]page=(\d+)>;\s*rel="last"/)
  if (!match || !match[1]) return 1
  const n = parseInt(match[1], 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function buildSamplePages(totalPages, samplePoints) {
  if (totalPages <= 1) return [1]
  const slots = Math.max(1, samplePoints - 1)
  const pages = []
  if (totalPages <= slots) {
    for (let p = 1; p <= totalPages; p++) pages.push(p)
  } else {
    for (let i = 0; i < slots; i++) { pages.push(1 + Math.round((i / (slots - 1)) * (totalPages - 1))) }
  }
  return uniqueSortedInts(pages)
}

function normalizeRecords(records, samplePoints, total) {
  const valid = records.filter((r) => r && Number.isFinite(r.count)).map((r) => ({ count: toNonNegativeInt(r.count) }))
  valid.sort((a, b) => a.count - b.count)
  const dedup = []
  for (const item of valid) {
    if (dedup.length === 0 || dedup[dedup.length - 1].count !== item.count) dedup.push(item)
  }
  const last = dedup.length > 0 ? dedup[dedup.length - 1] : null
  if (!last || last.count !== total) dedup.push({ count: total })
  if (dedup.length <= samplePoints) return dedup
  const sampled = []
  for (let i = 0; i < samplePoints; i++) { sampled.push(dedup[Math.round((i * (dedup.length - 1)) / (samplePoints - 1))]) }
  return sampled
}

function normalizeRepo(input) {
  let repo = String(input || "").trim()
  if (!repo) return ""
  if (repo.includes("github.com/")) repo = repo.split("github.com/")[1]
  repo = repo.replace(/^\/+/, "").replace(/\/+$/, "")
  const segments = repo.split("/").filter(Boolean)
  return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : ""
}

function formatNumber(n) { return (Number.isFinite(n) ? n : 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") }
function safeError(err) { if (!err) return "未知错误"; if (typeof err === "string") return err; if (err.message) return err.message; return "未知错误" }
function clampInt(input, fallback, min, max) { const n = parseInt(String(input), 10); if (!Number.isFinite(n)) return fallback; return n < min ? min : (n > max ? max : n) }
function toNonNegativeInt(n) { const value = parseInt(String(n), 10); return (!Number.isFinite(value) || value < 0) ? 0 : value }
function uniqueSortedInts(values) { const nums = values.filter(v => Number.isFinite(v)).map(v => parseInt(String(v), 10)).filter(v => v > 0); nums.sort((a, b) => a - b); return nums.filter((n, i) => i === 0 || nums[i - 1] !== n) }
function readCache(ctx, key) { try { const data = ctx.storage.getJSON(key); if (!data || !Number.isFinite(data.total) || !Array.isArray(data.records)) return null; return { total: toNonNegativeInt(data.total), records: data.records } } catch (err) { return null } }
function writeCache(ctx, key, data) { try { ctx.storage.setJSON(key, data) } catch (err) { } }

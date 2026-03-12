// Star-History 小组件 (V7 绝对像素强制渲染 + 里程碑版)
// 1. 彻底根除宽度塌陷：对柱状图强制使用绝对 width 和 height 像素。
// 2. 引入 Life-Progress 的成功设计：在底部增加里程碑进度条，丰富组件下方留白。

const PER_PAGE = 100
const DEFAULT_SAMPLE_POINTS = 15

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
  const chartColor = env.CHART_COLOR || "#F9A826" // 改为更亮眼的 GitHub 金黄色
  const samplePoints = clampInt(env.SAMPLE_POINTS, DEFAULT_SAMPLE_POINTS, 3, 30)
  const stage = clampInt(env.RENDER_STAGE, 3, 0, 3)

  let token = (env.GITHUB_TOKEN || "").replace(/['"]/g, '').trim()

  if (!repo) {
    return buildErrorWidget("配置缺失", "请设置 GITHUB_REPO，如 egerndaddy/quick-start")
  }

  if (stage === 0) return buildStage0Widget(title)
  if (stage === 1) return buildStage1Widget(title, repo)

  const cacheKey = `github_stars_v7_${repo.replace("/", "_")}`
  let data = null
  let stale = false
  let warning = ""

  try {
    // 强制每次刷新加上时间戳，打破 iOS 缓存
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


// ============== 核心 UI 渲染层 (完美 UI 双保险版) ==============

function buildStage3Widget({ title, repo, total, records, chartColor, stale, warning }) {
  let safe = Array.isArray(records) ? records.filter((r) => r && Number.isFinite(r.count)) : []
  
  // 容错：如果数据太少，铺满成平线避免孤零零的一根柱子
  if (safe.length === 1) safe = Array(15).fill(safe[0])
  if (safe.length === 0) safe = Array(15).fill({count: 0})
  
  let minCount = Math.min(...safe.map(r => r.count));
  let maxCount = Math.max(...safe.map(r => r.count));
  let range = maxCount - minCount;
  if (range === 0) range = 1; // 避免除以0
  
  // 关键修复 1：强制设定每一个柱子的绝对 width 和 height (告别 Flex 塌陷)
  const bars = safe.map(item => {
    const ratio = (item.count - minCount) / range;
    const h = 4 + Math.round(ratio * 26); // 基础高度4px，最高30px
    return {
      type: "stack",
      width: 5,        // 【核心秘籍】绝对宽度！
      height: h,       // 【核心秘籍】绝对高度！
      backgroundColor: chartColor,
      borderRadius: 2,
      children: []
    }
  })

  // 关键修复 2：计算下一阶段里程碑目标，并复刻 life-progress 的底部进度条
  const milestones = [100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  let target = milestones.find(m => total < m) || (total + 5000);
  const progressRatio = Math.min(1, Math.max(0, total / target));
  const progressPercent = (progressRatio * 100).toFixed(1);

  return {
    type: "widget",
    padding: 16,
    gap: 12,
    // 质感提升：深邃的 GitHub 暗黑渐变背景
    backgroundGradient: {
      type: "linear",
      colors: ["#1E2228", "#0D1117"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: [
      // 第一行：图标与仓库名
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          { type: "image", src: "sf-symbol:star.fill", width: 14, height: 14, color: chartColor },
          { type: "text", text: repo, font: { size: "subheadline", weight: "semibold" }, textColor: "#FFFFFF" }
        ]
      },
      
      { type: "spacer" },
      
      // 第二行：大数字总数 + 右侧历史趋势柱状图
      {
        type: "stack",
        direction: "row",
        alignItems: "end", 
        children: [
          // 左侧：数字
          {
            type: "stack",
            direction: "row",
            alignItems: "end",
            gap: 4,
            children: [
              { type: "text", text: formatNumber(total), font: { size: 38, weight: "heavy" }, textColor: "#FFFFFF" },
              {
                type: "stack",
                padding: [0, 0, 6, 0],
                children: [
                  { type: "text", text: "Stars", font: { size: "caption1", weight: "bold" }, textColor: "#8B949E" }
                ]
              }
            ]
          },
          { type: "spacer" },
          // 右侧：图表容器 (强锁定高度，内部柱子底部对齐)
          {
            type: "stack",
            direction: "row",
            alignItems: "end",
            height: 32, 
            gap: 3,     
            children: bars
          }
        ]
      },

      // 第三行：目标里程碑进度条 (完美复刻自你的 life-progress 代码)
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
                flex: Math.max(0.001, progressRatio),
                height: 6,
                borderRadius: 3,
                backgroundColor: chartColor,
                children: [],
              },
              {
                type: "stack",
                flex: 1 - progressRatio,
                children: [],
              },
            ],
          },
          {
            type: "stack",
            direction: "row",
            children: [
              {
                type: "text",
                text: `目标里程碑: ${formatNumber(target)}`,
                font: { size: "caption2" },
                textColor: "#8B949E",
              },
              { type: "spacer" },
              {
                type: "text",
                text: `${progressPercent}%`,
                font: { size: "caption2", weight: "bold" },
                textColor: "#8B949E",
              },
            ],
          },
        ],
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

// ============== 占位界面与工具函数 ==============

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

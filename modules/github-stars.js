// Star-History 小组件 (修复重构版)
// 1. 修复了 WidgetKit 底层解析 stretch 的崩溃白屏 Bug
// 2. 完美对齐了 life-progress 的扁平化声明式 UI 规范
// 3. 增强了网络请求的兼容性

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
  const chartColor = env.CHART_COLOR || "#E36209"
  const samplePoints = clampInt(env.SAMPLE_POINTS, DEFAULT_SAMPLE_POINTS, 3, 30)
  const stage = clampInt(env.RENDER_STAGE, 3, 0, 3)
  const token = env.GITHUB_TOKEN || ""

  if (!repo) {
    return buildErrorWidget("配置缺失", "请设置环境变量 GITHUB_REPO，如 vuejs/vue")
  }

  if (stage === 0) return buildStage0Widget(title)
  if (stage === 1) return buildStage1Widget(title, repo)

  const cacheKey = `github_stars_v3_${repo.replace("/", "_")}`
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

// ============== 网络请求层 (增强兼容性) ==============

async function fetchJsonWithHeaders(ctx, url, headers) {
  // 优先尝试使用现代原生的 fetch
  if (typeof fetch !== "undefined") {
    try {
      const resp = await fetch(url, { headers })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      return { body: await resp.json(), headers: resp.headers }
    } catch (err) {
      throw new Error(`Fetch 请求失败: ${safeError(err)}`)
    }
  }

  // 备用：尝试使用 ctx.http
  if (ctx && ctx.http && typeof ctx.http.get === 'function') {
    try {
      const resp = await ctx.http.get(url, { headers })
      if (!resp || resp.status !== 200) throw new Error(`HTTP ${resp ? resp.status : "unknown"}`)
      return { body: await resp.json(), headers: resp.headers || {} }
    } catch (err) {
      throw new Error(`ctx.http 请求失败: ${safeError(err)}`)
    }
  }

  throw new Error("当前环境不支持 fetch 或 ctx.http 网络请求")
}

async function fetchStarData(ctx, repo, samplePoints, token) {
  const baseHeaders = { "User-Agent": "Egern-Widget-Client" }
  if (token) baseHeaders.Authorization = `token ${token}`

  const starHeaders = { ...baseHeaders, Accept: "application/vnd.github.v3.star+json" }

  const repoResp = await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}`, baseHeaders)
  const total = toNonNegativeInt(repoResp.body && repoResp.body.stargazers_count)

  if (total === 0) return { total: 0, records: [{ count: 0, date: new Date().toISOString() }] }

  const firstPageResp = await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=1`, starHeaders)
  const firstPageData = Array.isArray(firstPageResp.body) ? firstPageResp.body : []
  const totalPages = parseLastPage(firstPageResp.headers)
  const samplePages = buildSamplePages(totalPages, samplePoints)

  const records = []
  for (const page of samplePages) {
    try {
      let pageData = page === 1 ? firstPageData : (await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`, starHeaders)).body

      if (Array.isArray(pageData) && pageData.length > 0 && pageData[0].starred_at) {
        records.push({ count: Math.max(0, (page - 1) * PER_PAGE + 1), date: pageData[0].starred_at })
      }
    } catch (pageErr) {
      console.log(`[github-stars] skipped page ${page}: ${safeError(pageErr)}`)
    }
  }

  records.push({ count: total, date: new Date().toISOString() })
  return { total, records: normalizeRecords(records, samplePoints, total) }
}

// ============== 核心 UI 渲染层 (已修复 WidgetKit Bug) ==============

function buildStage3Widget({ title, repo, total, records, chartColor, stale, warning }) {
  const safe = Array.isArray(records) ? records.filter((r) => r && Number.isFinite(r.count)) : []
  let maxCount = safe.reduce((max, item) => Math.max(max, item.count), 1)

  // 修复：移除会引发 stretch 崩溃的跨轴包裹属性，直接用纯粹的 flex 块
  const bars = safe.map(item => {
    const ratio = item.count / maxCount
    return {
      type: "stack",
      direction: "column",
      flex: 1,
      gap: 0,
      children: [
        { type: "stack", flex: Math.max(0.001, 1 - ratio), children: [] },
        { type: "stack", flex: Math.max(0.001, ratio), backgroundColor: chartColor, borderRadius: 2, children: [] }
      ]
    }
  })

  // 如果没有数据，给一个占位符避免空数组崩溃
  if (bars.length === 0) {
    bars.push({ type: "stack", flex: 1, backgroundColor: "#30363D", borderRadius: 2, children: [] })
  }

  return {
    type: "widget",
    padding: 16,
    gap: 12, // 对齐 life-progress 的全局间距
    backgroundColor: "#0D1117",
    children: [
      // 1. 标题区
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          { type: "image", src: "sf-symbol:star.fill", width: 14, height: 14, color: chartColor },
          { type: "text", text: title, font: { size: "subheadline", weight: "semibold" }, textColor: "#FFFFFF" },
          { type: "spacer" },
          { type: "text", text: repo, font: { size: "caption2" }, textColor: "#8B949E" }
        ]
      },

      // 2. 大数字区
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        gap: 4,
        children: [
          { type: "text", text: formatNumber(total), font: { size: 34, weight: "bold" }, textColor: "#FFFFFF" },
          {
            type: "stack",
            padding: [0, 0, 4, 0],
            children: [
              { type: "text", text: "Stars", font: { size: "caption1", weight: "medium" }, textColor: "#8B949E" }
            ]
          }
        ]
      },

      // 3. 柱状图展示区
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        height: 40,
        gap: 4,
        children: bars
      },

      // 4. 底部状态提示
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        children: [
          { type: "text", text: stale ? `缓存数据 · ${warning}` : "实时数据", font: { size: "caption2" }, textColor: stale ? "#FFC107" : "#8B949E", maxLines: 1 }
        ]
      }
    ]
  }
}

function buildErrorWidget(title, message) {
  return {
    type: "widget",
    padding: 16,
    gap: 8,
    backgroundColor: "#0D1117",
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          { type: "image", src: "sf-symbol:exclamationmark.triangle.fill", width: 16, height: 16, color: "#FF6B6B" },
          { type: "text", text: title, font: { size: "headline", weight: "bold" }, textColor: "#FF6B6B" }
        ]
      },
      { type: "text", text: message || "未知错误", font: { size: "caption1" }, textColor: "#FFFFFF", maxLines: 4 }
    ]
  }
}

function buildStage0Widget(title) {
  return {
    type: "widget",
    padding: 16,
    backgroundColor: "#0D1117",
    children: [
      { type: "text", text: `Star-History Ready · ${title}`, font: { size: "subheadline", weight: "semibold" }, textColor: "#FFFFFF" }
    ]
  }
}

function buildStage1Widget(title, repo) {
  return {
    type: "widget",
    padding: 16,
    gap: 8,
    backgroundColor: "#0D1117",
    children: [
      { type: "text", text: title, font: { size: "headline", weight: "bold" }, textColor: "#FFFFFF" },
      { type: "text", text: repo, font: { size: "caption1" }, textColor: "#8B949E" }
    ]
  }
}

function buildStage2Widget({ title, repo, total, stale, warning }) {
  return {
    type: "widget",
    padding: 16,
    gap: 8,
    backgroundColor: "#0D1117",
    children: [
      { type: "text", text: title, font: { size: "headline", weight: "bold" }, textColor: "#FFFFFF" },
      { type: "text", text: repo, font: { size: "caption1" }, textColor: "#8B949E" },
      { type: "text", text: formatNumber(total) + " Stars", font: { size: 34, weight: "heavy" }, textColor: "#FFFFFF" },
      { type: "text", text: stale ? `缓存数据 · ${warning}` : "实时数据", font: { size: "caption2" }, textColor: stale ? "#FFC107" : "#8B949E" }
    ]
  }
}

// ============== 工具函数 ==============

function parseLastPage(headers) {
  // 兼容 fetch Headers 对象和普通 JS Object
  let linkStr = ""
  if (headers && typeof headers.get === 'function') {
    linkStr = headers.get('link') || headers.get('Link') || ""
  } else if (headers) {
    linkStr = headers.link || headers.Link || ""
  }

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
    for (let i = 0; i < slots; i++) {
      pages.push(1 + Math.round((i / (slots - 1)) * (totalPages - 1)))
    }
  }
  return uniqueSortedInts(pages)
}

function normalizeRecords(records, samplePoints, total) {
  const valid = records.filter((r) => r && Number.isFinite(r.count))
    .map((r) => ({ count: toNonNegativeInt(r.count), date: typeof r.date === "string" ? r.date : new Date().toISOString() }))
  valid.sort((a, b) => a.count - b.count)

  const dedup = []
  for (const item of valid) {
    if (dedup.length === 0 || dedup[dedup.length - 1].count !== item.count) dedup.push(item)
  }

  const last = dedup.length > 0 ? dedup[dedup.length - 1] : null
  if (!last || last.count !== total) dedup.push({ count: total, date: new Date().toISOString() })
  if (dedup.length <= samplePoints) return dedup

  const sampled = []
  for (let i = 0; i < samplePoints; i++) {
    sampled.push(dedup[Math.round((i * (dedup.length - 1)) / (samplePoints - 1))])
  }
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

function formatNumber(n) {
  return (Number.isFinite(n) ? n : 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function safeError(err) {
  if (!err) return "未知错误"
  if (typeof err === "string") return err
  if (err.message) return err.message
  return "未知错误"
}

function clampInt(input, fallback, min, max) {
  const n = parseInt(String(input), 10)
  if (!Number.isFinite(n)) return fallback
  return n < min ? min : (n > max ? max : n)
}

function toNonNegativeInt(n) {
  const value = parseInt(String(n), 10)
  return (!Number.isFinite(value) || value < 0) ? 0 : value
}

function uniqueSortedInts(values) {
  const nums = values.filter(v => Number.isFinite(v)).map(v => parseInt(String(v), 10)).filter(v => v > 0)
  nums.sort((a, b) => a - b)
  return nums.filter((n, i) => i === 0 || nums[i - 1] !== n)
}

function readCache(ctx, key) {
  try {
    const data = ctx.storage.getJSON(key)
    if (!data || !Number.isFinite(data.total) || !Array.isArray(data.records)) return null
    return { total: toNonNegativeInt(data.total), records: data.records }
  } catch (err) {
    return null
  }
}

function writeCache(ctx, key, data) {
  try {
    ctx.storage.setJSON(key, data)
  } catch (err) { }
}
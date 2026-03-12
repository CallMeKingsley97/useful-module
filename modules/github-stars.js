// GitHub Stars 小组件 (V6 曲线趋势增强版)
// 1. 使用 starred_at 生成更真实的历史趋势点位。
// 2. 支持曲线/柱状双模式显示，默认曲线。
// 3. 修复柱体高度计算，避免 Flex 兼容问题。

const PER_PAGE = 100
const DEFAULT_SAMPLE_POINTS = 18
const DEFAULT_SAMPLES_PER_PAGE = 3
const DEFAULT_CHART_HEIGHT = 46
const DEFAULT_DOT_SIZE = 4

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
  const samplePoints = clampInt(env.SAMPLE_POINTS, DEFAULT_SAMPLE_POINTS, 6, 36)
  const samplesPerPage = clampInt(env.SAMPLES_PER_PAGE, DEFAULT_SAMPLES_PER_PAGE, 1, 6)
  const chartHeight = clampInt(env.CHART_HEIGHT, DEFAULT_CHART_HEIGHT, 28, 80)
  const dotSize = clampInt(env.DOT_SIZE, DEFAULT_DOT_SIZE, 3, 8)
  const chartStyle = String(env.CHART_STYLE || "line").toLowerCase()
  const showRange = parseBoolean(env.SHOW_RANGE, true)
  const stage = clampInt(env.RENDER_STAGE, 3, 0, 3)

  // 清洗 Token，防止误填引号
  let token = (env.GITHUB_TOKEN || "").replace(/['"]/g, "").trim()

  if (!repo) {
    return buildErrorWidget("配置缺失", "请设置环境变量 GITHUB_REPO，如 egerndaddy/quick-start")
  }

  if (stage === 0) return buildStage0Widget(title)
  if (stage === 1) return buildStage1Widget(title, repo)

  const cacheKey = `github_stars_v6_${repo.replace("/", "_")}`
  let data = null
  let stale = false
  let warning = ""

  try {
    data = await fetchStarData(ctx, repo, samplePoints, samplesPerPage, token)
    writeCache(ctx, cacheKey, data)
  } catch (err) {
    warning = safeError(err)
    data = readCache(ctx, cacheKey)
    stale = !!data
    if (!data) return buildErrorWidget("数据获取失败", warning)
  }

  if (stage === 2) return buildStage2Widget({ title, repo, total: data.total, stale, warning })

  return buildStage3Widget({
    title,
    repo,
    total: data.total,
    records: data.records,
    range: data.range,
    chartColor,
    chartHeight,
    dotSize,
    chartStyle,
    showRange,
    stale,
    warning
  })
}

// ============== 网络请求层 (防缓存强化版) ==============

async function fetchJsonWithHeaders(ctx, url, headers) {
  const noCacheUrl = url + (url.includes("?") ? "&" : "?") + "_t=" + Date.now()

  if (ctx && ctx.http && typeof ctx.http.get === "function") {
    try {
      const resp = await ctx.http.get(noCacheUrl, { headers })
      if (!resp || resp.status !== 200) throw new Error(`HTTP ${resp ? resp.status : "unknown"}`)
      return { body: await resp.json(), headers: resp.headers || {} }
    } catch (err) {
      throw new Error(`请求失败: ${safeError(err)}`)
    }
  }
  throw new Error("当前环境不支持 ctx.http 网络请求")
}

async function fetchStarData(ctx, repo, samplePoints, samplesPerPage, token) {
  const baseHeaders = { "User-Agent": "Egern-Widget-Client" }
  if (token) baseHeaders.Authorization = `Bearer ${token}`

  const starHeaders = { ...baseHeaders, Accept: "application/vnd.github.v3.star+json" }

  const repoResp = await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}`, baseHeaders)
  const total = toNonNegativeInt(repoResp.body && repoResp.body.stargazers_count)

  if (total === 0) return { total: 0, records: [{ count: 0 }], range: null }

  const firstPageResp = await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=1`, starHeaders)
  const firstPageData = Array.isArray(firstPageResp.body) ? firstPageResp.body : []
  const totalPages = parseLastPage(firstPageResp.headers)
  const samplePages = buildSamplePages(totalPages, samplePoints)

  const records = []
  for (const page of samplePages) {
    try {
      const pageData = page === 1 ? firstPageData : (await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`, starHeaders)).body
      collectRecordsFromPage(records, pageData, page, total, samplesPerPage)
    } catch (pageErr) {
      console.log(`[github-stars] skipped page ${page}: ${safeError(pageErr)}`)
    }
  }

  appendLatestRecord(records, firstPageData, total)

  const normalized = normalizeRecords(records, samplePoints, total)
  return { total, records: normalized, range: buildRange(normalized) }
}

function collectRecordsFromPage(records, pageData, page, total, samplesPerPage) {
  if (!Array.isArray(pageData) || pageData.length === 0) return
  const indexes = buildSampleIndexes(pageData.length, samplesPerPage)

  for (const idx of indexes) {
    const item = pageData[idx]
    const absoluteIndex = (page - 1) * PER_PAGE + idx
    const count = Math.max(1, total - absoluteIndex)
    const time = parseStarTime(item && item.starred_at)
    records.push({ count, time })
  }
}

function appendLatestRecord(records, firstPageData, total) {
  const latest = Array.isArray(firstPageData) && firstPageData.length > 0 ? firstPageData[0] : null
  const time = parseStarTime(latest && latest.starred_at)
  records.push({ count: total, time })
}

// ============== 核心 UI 渲染层 ==============

function buildStage3Widget({
  title,
  repo,
  total,
  records,
  range,
  chartColor,
  chartHeight,
  dotSize,
  chartStyle,
  showRange,
  stale,
  warning
}) {
  const trend = buildTrendSummary(records)
  const chart = chartStyle === "bar"
    ? buildBarChart(records, chartColor, chartHeight)
    : buildLineChart(records, chartColor, chartHeight, dotSize)

  return {
    type: "widget",
    padding: 16,
    gap: 12,
    backgroundGradient: {
      type: "linear",
      colors: ["#0D1117", "#111827"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: [
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
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        gap: 8,
        children: [
          { type: "text", text: formatNumber(total), font: { size: 34, weight: "bold" }, textColor: "#FFFFFF" },
          {
            type: "stack",
            padding: [0, 0, 4, 0],
            children: [
              { type: "text", text: "Stars", font: { size: "caption1", weight: "medium" }, textColor: "#8B949E" }
            ]
          },
          { type: "spacer" },
          trend.deltaText
            ? {
              type: "stack",
              padding: [4, 8],
              backgroundColor: trend.deltaColor,
              borderRadius: 10,
              children: [
                { type: "text", text: trend.deltaText, font: { size: "caption2", weight: "semibold" }, textColor: "#FFFFFF" }
              ]
            }
            : { type: "spacer" }
        ]
      },
      {
        type: "stack",
        direction: "row",
        height: chartHeight,
        gap: chartStyle === "bar" ? 3 : 5,
        children: chart
      },
      showRange && range
        ? {
          type: "stack",
          direction: "row",
          alignItems: "center",
          children: [
            { type: "text", text: range, font: { size: "caption2" }, textColor: "#8B949E" },
            { type: "spacer" },
            { type: "text", text: stale ? `缓存数据 · ${warning}` : "实时数据", font: { size: "caption2" }, textColor: stale ? "#FFC107" : "#8B949E", maxLines: 1 }
          ]
        }
        : {
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

function buildLineChart(records, chartColor, chartHeight, dotSize) {
  const safe = normalizeChartRecords(records)
  if (safe.length === 0) return [buildEmptyChartDot(chartColor, chartHeight, dotSize)]

  const minCount = safe.reduce((min, item) => Math.min(min, item.count), safe[0].count)
  const maxCount = safe.reduce((max, item) => Math.max(max, item.count), safe[0].count)
  const range = Math.max(1, maxCount - minCount)

  return safe.map((item) => {
    const ratio = (item.count - minCount) / range
    const topFlex = Math.max(0.001, 1 - ratio)
    const bottomFlex = Math.max(0.001, ratio)

    return {
      type: "stack",
      direction: "column",
      flex: 1,
      alignItems: "center",
      children: [
        { type: "spacer", flex: topFlex },
        {
          type: "stack",
          width: dotSize,
          height: dotSize,
          backgroundColor: chartColor,
          borderRadius: dotSize / 2,
          children: []
        },
        { type: "spacer", flex: bottomFlex }
      ]
    }
  })
}

function buildBarChart(records, chartColor, chartHeight) {
  const safe = normalizeChartRecords(records)
  if (safe.length === 0) return [buildEmptyChartBar(chartColor, chartHeight)]

  const maxCount = safe.reduce((max, item) => Math.max(max, item.count), safe[0].count)

  return safe.map((item) => {
    const ratio = maxCount === 0 ? 0 : item.count / maxCount
    const height = Math.max(2, Math.round(chartHeight * ratio))

    return {
      type: "stack",
      direction: "column",
      alignItems: "center",
      flex: 1,
      children: [
        { type: "spacer" },
        {
          type: "stack",
          width: 6,
          height,
          backgroundColor: chartColor,
          borderRadius: 3,
          children: []
        }
      ]
    }
  })
}

function buildEmptyChartDot(chartColor, chartHeight, dotSize) {
  return {
    type: "stack",
    direction: "column",
    alignItems: "center",
    flex: 1,
    children: [
      { type: "spacer", flex: 0.7 },
      { type: "stack", width: dotSize, height: dotSize, backgroundColor: chartColor, borderRadius: dotSize / 2, children: [] },
      { type: "spacer", flex: 0.3 }
    ]
  }
}

function buildEmptyChartBar(chartColor, chartHeight) {
  return {
    type: "stack",
    direction: "column",
    alignItems: "center",
    flex: 1,
    children: [
      { type: "spacer" },
      { type: "stack", width: 6, height: Math.max(2, Math.round(chartHeight * 0.2)), backgroundColor: chartColor, borderRadius: 3, children: [] }
    ]
  }
}

function buildTrendSummary(records) {
  const safe = normalizeChartRecords(records)
  if (safe.length < 2) return { deltaText: "", deltaColor: "#30363D" }

  const last = safe[safe.length - 1]
  const prev = safe[safe.length - 2]
  const delta = last.count - prev.count
  if (!Number.isFinite(delta) || delta === 0) return { deltaText: "", deltaColor: "#30363D" }

  const text = delta > 0 ? `+${formatNumber(delta)}` : `${formatNumber(delta)}`
  const color = delta > 0 ? "#238636" : "#8B949E"
  return { deltaText: text, deltaColor: color }
}

function buildRange(records) {
  const times = records.filter((r) => Number.isFinite(r.time)).map((r) => r.time)
  if (times.length < 2) return null
  const minTime = Math.min(...times)
  const maxTime = Math.max(...times)
  if (!Number.isFinite(minTime) || !Number.isFinite(maxTime)) return null
  return `${formatDate(minTime)} → ${formatDate(maxTime)}`
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
  return { type: "widget", padding: 16, backgroundColor: "#0D1117", children: [{ type: "text", text: `Ready · ${title}`, font: { size: "subheadline" }, textColor: "#FFFFFF" }] }
}

function buildStage1Widget(title, repo) {
  return { type: "widget", padding: 16, gap: 8, backgroundColor: "#0D1117", children: [{ type: "text", text: title, font: { size: "headline", weight: "bold" }, textColor: "#FFFFFF" }, { type: "text", text: repo, font: { size: "caption1" }, textColor: "#8B949E" }] }
}

function buildStage2Widget({ title, repo, total, stale, warning }) {
  return { type: "widget", padding: 16, gap: 8, backgroundColor: "#0D1117", children: [{ type: "text", text: title, font: { size: "headline", weight: "bold" }, textColor: "#FFFFFF" }, { type: "text", text: repo, font: { size: "caption1" }, textColor: "#8B949E" }, { type: "text", text: formatNumber(total) + " Stars", font: { size: 34, weight: "heavy" }, textColor: "#FFFFFF" }, { type: "text", text: stale ? `缓存数据 · ${warning}` : "实时数据", font: { size: "caption2" }, textColor: stale ? "#FFC107" : "#8B949E" }] }
}

// ============== 工具函数 ==============

function parseLastPage(headers) {
  let linkStr = ""
  if (headers && typeof headers.get === "function") {
    linkStr = headers.get("link") || headers.get("Link") || ""
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

function buildSampleIndexes(length, samples) {
  if (length <= 1) return [0]
  const slots = Math.min(samples, length)
  const indexes = []
  if (slots <= 1) return [0]
  for (let i = 0; i < slots; i++) {
    indexes.push(Math.round((i / (slots - 1)) * (length - 1)))
  }
  return uniqueSortedInts(indexes)
}

function normalizeRecords(records, samplePoints, total) {
  const valid = records
    .filter((r) => r && Number.isFinite(r.count))
    .map((r) => ({ count: toNonNegativeInt(r.count), time: Number.isFinite(r.time) ? r.time : undefined }))

  const withTime = valid.filter((r) => Number.isFinite(r.time))
  const base = withTime.length >= 2 ? withTime.sort((a, b) => a.time - b.time) : valid.sort((a, b) => a.count - b.count)

  const dedup = []
  for (const item of base) {
    if (dedup.length === 0 || dedup[dedup.length - 1].count !== item.count) dedup.push(item)
  }

  const last = dedup.length > 0 ? dedup[dedup.length - 1] : null
  if (!last || last.count !== total) dedup.push({ count: total, time: last && last.time ? last.time : undefined })

  if (dedup.length <= samplePoints) return dedup

  const sampled = []
  for (let i = 0; i < samplePoints; i++) {
    sampled.push(dedup[Math.round((i * (dedup.length - 1)) / (samplePoints - 1))])
  }
  return sampled
}

function normalizeChartRecords(records) {
  return Array.isArray(records) ? records.filter((r) => r && Number.isFinite(r.count)) : []
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

function formatDate(ts) {
  try {
    const date = new Date(ts)
    if (Number.isNaN(date.getTime())) return "未知"
    const y = date.getFullYear()
    const m = `${date.getMonth() + 1}`.padStart(2, "0")
    return `${y}-${m}`
  } catch (err) {
    return "未知"
  }
}

function parseStarTime(value) {
  if (!value) return undefined
  try {
    const ts = Date.parse(value)
    return Number.isFinite(ts) ? ts : undefined
  } catch (err) {
    return undefined
  }
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
  return n < min ? min : n > max ? max : n
}

function parseBoolean(input, fallback) {
  if (input === undefined || input === null || input === "") return fallback
  const value = String(input).toLowerCase().trim()
  if (["1", "true", "yes", "y", "on"].includes(value)) return true
  if (["0", "false", "no", "n", "off"].includes(value)) return false
  return fallback
}

function toNonNegativeInt(n) {
  const value = parseInt(String(n), 10)
  return !Number.isFinite(value) || value < 0 ? 0 : value
}

function uniqueSortedInts(values) {
  const nums = values.filter((v) => Number.isFinite(v)).map((v) => parseInt(String(v), 10)).filter((v) => v >= 0)
  nums.sort((a, b) => a - b)
  return nums.filter((n, i) => i === 0 || nums[i - 1] !== n)
}

function readCache(ctx, key) {
  try {
    const data = ctx.storage.getJSON(key)
    if (!data || !Number.isFinite(data.total) || !Array.isArray(data.records)) return null
    return { total: toNonNegativeInt(data.total), records: data.records, range: data.range || null }
  } catch (err) {
    return null
  }
}

function writeCache(ctx, key, data) {
  try {
    ctx.storage.setJSON(key, data)
  } catch (err) { }
}

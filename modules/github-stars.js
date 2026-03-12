// Star-History 小组件（严格按 Egern Widget DSL 可用属性重构版）
// 设计目标：
// 1) 永不返回空白：任何异常都回退到可视化错误文本
// 2) 支持分阶段渲染验证：RENDER_STAGE=0/1/2/3
//    - 0: 最小模板（仅 widget + text）
//    - 1: 标题行
//    - 2: 标题行 + 数字行
//    - 3: 标题行 + 数字行 + 柱图行（完整）
// 3) 网络请求串行化，避免高内存峰值

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
    return buildErrorWidget("配置缺失", "请设置 GITHUB_REPO，例如 vuejs/vue")
  }

  if (stage === 0) {
    return buildStage0Widget(title)
  }

  if (stage === 1) {
    return buildStage1Widget(title, repo)
  }

  const cacheKey = `github_stars_v2_${repo}`
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

    if (!data) {
      return buildErrorWidget("数据获取失败", warning)
    }
  }

  if (stage === 2) {
    return buildStage2Widget({
      title,
      repo,
      total: data.total,
      stale,
      warning
    })
  }

  return buildStage3Widget({
    title,
    repo,
    total: data.total,
    records: data.records,
    chartColor,
    stale,
    warning
  })
}

async function fetchStarData(ctx, repo, samplePoints, token) {
  const tokenHeader = {}
  if (token) {
    tokenHeader.Authorization = `token ${token}`
  }

  const repoHeaders = {
    "User-Agent": "Egern-Widget-Client",
    ...tokenHeader
  }

  const starHeaders = {
    "User-Agent": "Egern-Widget-Client",
    Accept: "application/vnd.github.v3.star+json",
    ...tokenHeader
  }

  const repoResp = await fetchJsonWithHeaders(ctx, `https://api.github.com/repos/${repo}`, repoHeaders)
  const total = toNonNegativeInt(repoResp.body && repoResp.body.stargazers_count)

  if (total === 0) {
    return {
      total: 0,
      records: [{ count: 0, date: new Date().toISOString() }]
    }
  }

  const firstPageResp = await fetchJsonWithHeaders(
    ctx,
    `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=1`,
    starHeaders
  )

  const firstPageData = Array.isArray(firstPageResp.body) ? firstPageResp.body : []
  const totalPages = parseLastPage(firstPageResp.headers)
  const samplePages = buildSamplePages(totalPages, samplePoints)

  const records = []

  for (const page of samplePages) {
    try {
      let pageData = null
      if (page === 1) {
        pageData = firstPageData
      } else {
        const pageResp = await fetchJsonWithHeaders(
          ctx,
          `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`,
          starHeaders
        )
        pageData = Array.isArray(pageResp.body) ? pageResp.body : []
      }

      if (pageData.length > 0 && pageData[0].starred_at) {
        records.push({
          count: Math.max(0, (page - 1) * PER_PAGE + 1),
          date: pageData[0].starred_at
        })
      }
    } catch (pageErr) {
      console.log(`[github-stars] page ${page} skipped: ${safeError(pageErr)}`)
    }
  }

  records.push({ count: total, date: new Date().toISOString() })

  const normalized = normalizeRecords(records, samplePoints, total)

  return {
    total,
    records: normalized
  }
}

async function fetchJsonWithHeaders(ctx, url, headers) {
  let resp
  try {
    resp = await ctx.http.get(url, { headers })
  } catch (err) {
    throw new Error(`请求失败: ${url} -> ${safeError(err)}`)
  }

  if (!resp || resp.status !== 200) {
    const status = resp && typeof resp.status === "number" ? resp.status : "unknown"
    throw new Error(`HTTP ${status}: ${url}`)
  }

  try {
    return {
      body: await resp.json(),
      headers: resp.headers || {}
    }
  } catch (err) {
    throw new Error(`JSON 解析失败: ${url} -> ${safeError(err)}`)
  }
}

function buildSamplePages(totalPages, samplePoints) {
  const pages = []

  if (totalPages <= 1) {
    return [1]
  }

  const slots = Math.max(1, samplePoints - 1)

  if (totalPages <= slots) {
    for (let p = 1; p <= totalPages; p += 1) {
      pages.push(p)
    }
  } else {
    for (let i = 0; i < slots; i += 1) {
      const ratio = slots === 1 ? 0 : i / (slots - 1)
      const page = 1 + Math.round(ratio * (totalPages - 1))
      pages.push(page)
    }
  }

  return uniqueSortedInts(pages)
}

function normalizeRecords(records, samplePoints, total) {
  const valid = records
    .filter((r) => r && Number.isFinite(r.count))
    .map((r) => ({
      count: toNonNegativeInt(r.count),
      date: typeof r.date === "string" ? r.date : new Date().toISOString()
    }))

  valid.sort((a, b) => a.count - b.count)

  const dedup = []
  for (const item of valid) {
    if (dedup.length === 0 || dedup[dedup.length - 1].count !== item.count) {
      dedup.push(item)
    }
  }

  const last = dedup.length > 0 ? dedup[dedup.length - 1] : null
  if (!last || last.count !== total) {
    dedup.push({ count: total, date: new Date().toISOString() })
  }

  if (dedup.length <= samplePoints) {
    return dedup
  }

  const sampled = []
  for (let i = 0; i < samplePoints; i += 1) {
    const idx = Math.round((i * (dedup.length - 1)) / (samplePoints - 1))
    sampled.push(dedup[idx])
  }

  return sampled
}

function buildStage0Widget(title) {
  return {
    type: "widget",
    padding: 16,
    backgroundColor: "#0D1117",
    children: [
      {
        type: "text",
        text: `Star-History Ready · ${title}`,
        font: { size: "subheadline", weight: "semibold" },
        textColor: "#FFFFFF"
      }
    ]
  }
}

function buildStage1Widget(title, repo) {
  return {
    type: "widget",
    padding: 16,
    backgroundColor: "#0D1117",
    children: [
      {
        type: "stack",
        direction: "column",
        gap: 8,
        children: [
          {
            type: "text",
            text: title,
            font: { size: "headline", weight: "bold" },
            textColor: "#FFFFFF"
          },
          {
            type: "text",
            text: repo,
            font: { size: "caption1" },
            textColor: "#8B949E"
          }
        ]
      }
    ]
  }
}

function buildStage2Widget({ title, repo, total, stale, warning }) {
  return {
    type: "widget",
    padding: 16,
    backgroundColor: "#0D1117",
    children: [
      {
        type: "stack",
        direction: "column",
        gap: 8,
        children: [
          {
            type: "text",
            text: title,
            font: { size: "headline", weight: "bold" },
            textColor: "#FFFFFF"
          },
          {
            type: "text",
            text: repo,
            font: { size: "caption1" },
            textColor: "#8B949E"
          },
          {
            type: "text",
            text: formatNumber(total),
            font: { size: 34, weight: "heavy" },
            textColor: "#FFFFFF",
            minScale: 0.6
          },
          {
            type: "text",
            text: stale ? `缓存数据 · ${warning}` : "实时数据",
            font: { size: "caption2" },
            textColor: stale ? "#FFC107" : "#8B949E",
            maxLines: 2
          }
        ]
      }
    ]
  }
}

function buildStage3Widget({ title, repo, total, records, chartColor, stale, warning }) {
  const bars = buildBars(records, chartColor)

  return {
    type: "widget",
    padding: 16,
    backgroundColor: "#0D1117",
    children: [
      {
        type: "stack",
        direction: "column",
        gap: 10,
        children: [
          {
            type: "text",
            text: title,
            font: { size: "headline", weight: "bold" },
            textColor: "#FFFFFF"
          },
          {
            type: "text",
            text: repo,
            font: { size: "caption1" },
            textColor: "#8B949E"
          },
          {
            type: "text",
            text: `${formatNumber(total)} Stars`,
            font: { size: 28, weight: "heavy" },
            textColor: "#FFFFFF",
            minScale: 0.6
          },
          {
            type: "stack",
            direction: "row",
            alignItems: "end",
            height: 44,
            gap: 3,
            children: bars
          },
          {
            type: "text",
            text: stale ? `缓存数据 · ${warning}` : "实时数据",
            font: { size: "caption2" },
            textColor: stale ? "#FFC107" : "#8B949E",
            maxLines: 2
          }
        ]
      }
    ]
  }
}

function buildBars(records, chartColor) {
  const safe = Array.isArray(records) ? records.filter((r) => r && Number.isFinite(r.count)) : []
  if (safe.length === 0) {
    return [
      {
        type: "stack",
        flex: 1,
        backgroundColor: "#30363D",
        borderRadius: 2,
        children: []
      }
    ]
  }

  let maxCount = 0
  for (const item of safe) {
    if (item.count > maxCount) {
      maxCount = item.count
    }
  }
  if (maxCount <= 0) {
    maxCount = 1
  }

  const bars = []
  for (const item of safe) {
    const ratio = item.count / maxCount
    const filled = Math.max(6, Math.round(ratio * 100))
    const empty = Math.max(1, 100 - filled)

    bars.push({
      type: "stack",
      direction: "column",
      flex: 1,
      children: [
        { type: "stack", flex: empty, children: [] },
        {
          type: "stack",
          flex: filled,
          backgroundColor: chartColor,
          borderRadius: 2,
          children: []
        }
      ]
    })
  }

  return bars
}

function buildErrorWidget(title, message) {
  return {
    type: "widget",
    padding: 16,
    backgroundColor: "#0D1117",
    children: [
      {
        type: "stack",
        direction: "column",
        gap: 8,
        children: [
          {
            type: "text",
            text: title,
            font: { size: "headline", weight: "bold" },
            textColor: "#FF6B6B"
          },
          {
            type: "text",
            text: message || "未知错误",
            font: { size: "caption1" },
            textColor: "#FFFFFF",
            maxLines: 4,
            minScale: 0.6
          }
        ]
      }
    ]
  }
}

function parseLastPage(headers) {
  if (!headers) {
    return 1
  }

  const link = headers.link || headers.Link
  if (!link || typeof link !== "string") {
    return 1
  }

  const match = link.match(/[?&]page=(\d+)>;\s*rel="last"/)
  if (!match || !match[1]) {
    return 1
  }

  const n = parseInt(match[1], 10)
  return Number.isFinite(n) && n > 0 ? n : 1
}

function normalizeRepo(input) {
  let repo = String(input || "").trim()
  if (!repo) {
    return ""
  }

  if (repo.includes("github.com/")) {
    const parts = repo.split("github.com/")
    if (parts.length > 1) {
      repo = parts[1]
    }
  }

  repo = repo.replace(/^\/+/, "").replace(/\/+$/, "")
  const segments = repo.split("/").filter(Boolean)
  if (segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`
  }

  return ""
}

function formatNumber(n) {
  const value = Number.isFinite(n) ? n : 0
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",")
}

function safeError(err) {
  if (!err) {
    return "未知错误"
  }

  if (typeof err === "string") {
    return err
  }

  if (err && typeof err.message === "string") {
    return err.message
  }

  return "未知错误"
}

function clampInt(input, fallback, min, max) {
  const n = parseInt(String(input), 10)
  if (!Number.isFinite(n)) {
    return fallback
  }

  if (n < min) {
    return min
  }

  if (n > max) {
    return max
  }

  return n
}

function toNonNegativeInt(n) {
  const value = parseInt(String(n), 10)
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }
  return value
}

function uniqueSortedInts(values) {
  const nums = values
    .filter((v) => Number.isFinite(v))
    .map((v) => parseInt(String(v), 10))
    .filter((v) => Number.isFinite(v) && v > 0)

  nums.sort((a, b) => a - b)

  const out = []
  for (const n of nums) {
    if (out.length === 0 || out[out.length - 1] !== n) {
      out.push(n)
    }
  }
  return out
}

function readCache(ctx, key) {
  try {
    const data = ctx.storage.getJSON(key)
    if (!data || !Number.isFinite(data.total) || !Array.isArray(data.records)) {
      return null
    }
    return {
      total: toNonNegativeInt(data.total),
      records: data.records
    }
  } catch (err) {
    console.log(`[github-stars] read cache failed: ${safeError(err)}`)
    return null
  }
}

function writeCache(ctx, key, data) {
  try {
    ctx.storage.setJSON(key, data)
  } catch (err) {
    console.log(`[github-stars] write cache failed: ${safeError(err)}`)
  }
}

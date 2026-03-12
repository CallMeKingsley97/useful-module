// Star-History 小组件 (彻底修复白屏与不显示图表版)
// 1. 移除了导致宽度塌陷的 column嵌套逻辑，采用绝对高度 + align-items: end 绘制图表。
// 2. 增强了对小 Star 项目 (如 105 stars) 的微观样本采集，确保图表丰满。
// 3. 增强了 Token 的鲁棒性，自动剔除首尾误填的引号。

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

  // 过滤用户可能不小心复制进去的单双引号或空格
  let token = (env.GITHUB_TOKEN || "").replace(/['"]/g, '').trim()

  if (!repo) {
    return buildErrorWidget("配置缺失", "请设置环境变量 GITHUB_REPO，如 egerndaddy/quick-start")
  }

  if (stage === 0) return buildStage0Widget(title)
  if (stage === 1) return buildStage1Widget(title, repo)

  const cacheKey = `github_stars_v4_${repo.replace("/", "_")}`
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

// ============== 网络请求层 ==============
// ============== 强制使用 Egern 网络通道并禁用缓存 ==============
async function fetchJsonWithHeaders(ctx, url, headers) {
  // 1. 生成时间戳，破坏任何可能存在的系统级 HTTP 缓存
  const noCacheUrl = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();

  // 2. 移除原生 fetch，强制使用 Egern 的 ctx.http，确保能在日志中看到请求
  if (ctx && ctx.http && typeof ctx.http.get === 'function') {
    try {
      const resp = await ctx.http.get(noCacheUrl, { headers });
      if (!resp || resp.status !== 200) throw new Error(`HTTP ${resp ? resp.status : "unknown"}`);
      return { body: await resp.json(), headers: resp.headers || {} };
    } catch (err) {
      throw new Error(`请求失败: ${safeError(err)}`);
    }
  }

  throw new Error("当前环境不支持 ctx.http 网络请求");
}

async function fetchStarData(ctx, repo, samplePoints, token) {
  const baseHeaders = { "User-Agent": "Egern-Widget-Client" }
  if (token) {
    baseHeaders.Authorization = `Bearer ${token}` // 使用 Bearer 对 PATs 更友好
  }

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
        // 微观采样：即便只有一页(比如100个star)，也能从中切片提取多个点位画出丰满的图表
        const step = Math.max(1, Math.floor(pageData.length / 4))
        for (let i = 0; i < pageData.length; i += step) {
          records.push({ count: (page - 1) * PER_PAGE + i + 1 })
        }
        records.push({ count: (page - 1) * PER_PAGE + pageData.length })
      }
    } catch (pageErr) {
      console.log(`[github-stars] skipped page ${page}: ${safeError(pageErr)}`)
    }
  }

  records.push({ count: total }) // 确保最后一点是准确的总量
  return { total, records: normalizeRecords(records, samplePoints, total) }
}

// ============== 核心 UI 渲染层 ==============

function buildStage3Widget({ title, repo, total, records, chartColor, stale, warning }) {
  const safe = Array.isArray(records) ? records.filter((r) => r && Number.isFinite(r.count)) : []
  let maxCount = safe.reduce((max, item) => Math.max(max, item.count), 1)

  // 完美修复 0 宽度塌陷 Bug：直接计算绝对高度，放入 row 布局并底端对齐
  const bars = safe.map(item => {
    const ratio = item.count / maxCount
    const h = Math.max(4, Math.round(ratio * 40)) // 最小高度 4px，最大高度 40px
    return {
      type: "stack",
      flex: 1, // 兄弟元素平分所有水平宽度
      height: h, // 绝对高度
      backgroundColor: chartColor,
      borderRadius: 2,
      children: []
    }
  })

  if (bars.length === 0) {
    bars.push({ type: "stack", flex: 1, height: 40, backgroundColor: "#30363D", borderRadius: 2, children: [] })
  }

  return {
    type: "widget",
    padding: 16,
    gap: 12,
    backgroundColor: "#0D1117",
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
      // 就是这里！依靠 alignItems: "end" 把刚才算好高度的柱形统一按在底部对齐
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        height: 40,
        gap: 4,
        children: bars
      },
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
// Star-History (串行抽样版) 面板小组件
// 纯依靠本地原生 JS 实现，移植了星标历史"均匀截断点抽样"算法。
// 为避免 iOS 小组件内存限制导致 OOM，采用串行请求 + 即时丢弃策略。

export default async function (ctx) {
  const env = ctx.env;
  let repo = env.GITHUB_REPO;

  // 支持传入完整的 repo url 链接，例如 https://github.com/apache/flink-cdc
  if (repo && repo.includes("github.com/")) {
    const parts = repo.split("github.com/");
    if (parts.length > 1) {
      repo = parts[1].split("/").slice(0, 2).join("/");
    }
  }

  const title = env.TITLE || repo;
  const chartColor = env.CHART_COLOR || "#FF7E5F";
  // 抽样点数量：推荐 15 左右即可完美兼容 Egern 横向空间
  const SAMPLE_POINTS = parseInt(env.SAMPLE_POINTS || "15", 10);
  const GITHUB_TOKEN = env.GITHUB_TOKEN || "";

  if (!repo) {
    return buildErrorWidget("未配置环境参数 GITHUB_REPO", "例如 'vuejs/vue'");
  }

  const CACHE_KEY = `github_stars_wave_${repo}`;
  const PER_PAGE = 100;

  let starRecords = [];
  let currentTotalStars = 0;
  let chartLoaded = false;
  let errorMsg = "";

  try {
    // token header 独立提取，按需注入
    const tokenHeader = {};
    if (GITHUB_TOKEN) {
      tokenHeader["Authorization"] = `token ${GITHUB_TOKEN}`;
    }

    // stargazer 专用 header（需要 starred_at 字段）
    const starHeaders = {
      "Accept": "application/vnd.github.v3.star+json",
      "User-Agent": "Egern-Widget-Client",
      ...tokenHeader
    };

    // repo info 请求使用标准 header（不需要 star+json 格式，减少响应体积）
    const repoHeaders = {
      "User-Agent": "Egern-Widget-Client",
      ...tokenHeader
    };

    // 【步骤 1】获取仓库基本信息（含 stargazers_count）
    const repoInfoReq = await ctx.http.get(`https://api.github.com/repos/${repo}`, {
      headers: repoHeaders
    });

    if (repoInfoReq.status !== 200) {
      throw new Error(`API 异常 (Status ${repoInfoReq.status})`);
    }
    const repoInfoData = await repoInfoReq.json();
    currentTotalStars = repoInfoData.stargazers_count;

    if (currentTotalStars === 0) {
      starRecords = [{ count: 0, date: new Date().toISOString() }];
      chartLoaded = true;
    } else {
      // 【步骤 2】请求 stargazers 首页，通过 Link header 获取总页数
      const firstPageReq = await ctx.http.get(
        `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=1`,
        { headers: starHeaders }
      );

      if (firstPageReq.status !== 200) {
        throw new Error(`无法获取 stargazers 列表 (Status ${firstPageReq.status})`);
      }

      let totalPages = 1;
      const linkHeader = firstPageReq.headers && (firstPageReq.headers["link"] || firstPageReq.headers["Link"]);
      if (linkHeader) {
        // 正确提取 rel="last" 对应的 page 值
        const match = linkHeader.match(/[?&]page=(\d+)>;\s*rel="last"/);
        if (match && match[1]) {
          totalPages = parseInt(match[1], 10);
        }
      }

      // 从首页数据中提取第一个抽样点（避免浪费已有数据）
      let firstPageData = null;
      try {
        firstPageData = await firstPageReq.json();
      } catch (e) { /* ignore */ }

      // 【步骤 3】计算抽样页码
      let requestPages = [];
      if (totalPages <= SAMPLE_POINTS) {
        for (let i = 1; i <= totalPages; i++) requestPages.push(i);
      } else {
        for (let i = 1; i < SAMPLE_POINTS; i++) {
          requestPages.push(Math.round((i * totalPages) / SAMPLE_POINTS));
        }
      }

      if (!requestPages.includes(1)) requestPages.unshift(1);
      if (requestPages[requestPages.length - 1] > totalPages) {
        requestPages.pop();
      }
      requestPages = [...new Set(requestPages)];

      // 【步骤 4】串行请求各抽样页，即时提取后丢弃完整数据（控制内存峰值）
      starRecords = [];

      for (const page of requestPages) {
        try {
          let pageData = null;

          // 第 1 页已经请求过了，直接复用
          if (page === 1 && firstPageData) {
            pageData = firstPageData;
            firstPageData = null; // 用完即释放
          } else {
            const req = await ctx.http.get(
              `https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`,
              { headers: starHeaders }
            );
            if (req.status === 200) {
              pageData = await req.json();
            }
          }

          if (pageData && pageData.length > 0) {
            // 只提取需要的两个值，pageData 在块作用域结束后即可被 GC
            starRecords.push({
              count: PER_PAGE * (page - 1),
              date: pageData[0].starred_at
            });
          }
        } catch (e) {
          // 单页失败不影响整体（可能是限流等临时问题）
        }
      }

      // 释放首页数据引用
      firstPageData = null;

      // 追加当前真实总数作为最后一个数据点
      starRecords.push({
        count: currentTotalStars,
        date: new Date().toISOString()
      });

      // 按时间排序（防止抽样乱序）
      starRecords.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

      // 缓存到本地（离线兜底）
      ctx.storage.setJSON(CACHE_KEY, { total: currentTotalStars, records: starRecords });
      chartLoaded = true;
    }
  } catch (err) {
    // 失败时尝试拉取本地缓存兜底
    errorMsg = err.message;
    const fallback = ctx.storage.getJSON(CACHE_KEY);
    if (fallback && fallback.records && fallback.total !== undefined) {
      currentTotalStars = fallback.total;
      starRecords = fallback.records;
      chartLoaded = true;
    }
  }

  // ==== UI 渲染 ====

  if (!chartLoaded) {
    return buildErrorWidget("API 限流或无网络", errorMsg + `\n(可配置 GITHUB_TOKEN 提升限额)`);
  }

  // 计算柱形高度映射
  let maxStar = 0;
  starRecords.forEach(r => { if (r.count > maxStar) maxStar = r.count; });
  if (maxStar === 0) maxStar = 1;

  const normalizedRecords = starRecords.filter(r => r && Number.isFinite(r.count));

  const bars = normalizedRecords.map(record => {
    const heightPercent = record.count / maxStar;
    const barWeight = Math.max(0.08, Math.min(1, heightPercent));
    const topFlex = parseFloat((1 - barWeight).toFixed(3));
    const bottomFlex = parseFloat(barWeight.toFixed(3));

    return {
      type: "stack",
      direction: "column",
      flex: 1,
      children: [
        { type: "spacer", flex: topFlex },
        {
          type: "stack",
          flex: bottomFlex,
          backgroundColor: chartColor,
          borderRadius: 2
        }
      ]
    };
  });

  // 不足抽样数时插入空占位
  while (bars.length < SAMPLE_POINTS) {
    bars.unshift({
      type: "stack",
      direction: "column",
      flex: 1,
      children: [{ type: "spacer", flex: 1 }]
    });
  }

  // 兜底：确保图表区域至少有一个可渲染元素
  if (bars.length === 0) {
    bars.push({
      type: "stack",
      direction: "column",
      flex: 1,
      children: [{ type: "spacer", flex: 1 }]
    });
  }

  return {
    type: "widget",
    padding: 18,
    gap: 12,
    backgroundGradient: {
      type: "linear",
      colors: ["#161B22", "#0D1117"],
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: [
      // 顶部：图标 + 标题
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          {
            type: "image",
            src: "sf-symbol:star.fill",
            width: 14,
            height: 14,
            color: chartColor
          },
          {
            type: "text",
            text: title,
            font: { size: "caption1", weight: "bold" },
            textColor: "#C9D1D9"
          },
          { type: "spacer" }
        ]
      },

      // 中间：Star 总数大字
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        padding: [4, 0, 4, 0],
        gap: 4,
        children: [
          {
            type: "text",
            text: formatNumber(currentTotalStars),
            font: { size: 30, weight: "heavy" },
            textColor: "#FFFFFF",
            minScale: 0.7
          },
          {
            type: "stack",
            padding: [0, 0, 4, 0],
            children: [
              {
                type: "text",
                text: "Stars",
                font: { size: 11, weight: "semibold" },
                textColor: "#8B949E"
              }
            ]
          }
        ]
      },

      // 底部：趋势柱状图
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        flex: 1,
        gap: 4,
        children: bars
      }
    ]
  };
}

// 辅助函数：异常小组件 UI
function buildErrorWidget(title, msg) {
  return {
    type: "widget",
    backgroundColor: "#161B22",
    padding: 16,
    gap: 8,
    children: [
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          { type: "image", src: "sf-symbol:exclamationmark.triangle.fill", width: 14, height: 14, color: "#FFC107" },
          { type: "text", text: title, font: { size: "caption1", weight: "bold" }, textColor: "#FFFFFF" }
        ]
      },
      { type: "spacer" },
      { type: "text", text: msg, font: { size: "caption2" }, textColor: "#AAAAAA", maxLines: 4 }
    ]
  };
}

// 数字千分位 e.g. 100,000
function formatNumber(num) {
  return num ? num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0";
}

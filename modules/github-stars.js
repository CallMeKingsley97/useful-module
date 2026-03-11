// Star-History (原生采样版) 面板小组件
// 纯依靠本地原生 JS 实现，彻底移植了著名的星标历史全尺度“对数截断点抽样”算法！
// 支持数以万计甚至百万计的大型仓库平滑请求和性能优化，最终以动态“渐变短阵列柱状波段 (Wave Chart)”绘制最长达数年的关注增长。

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
  // 品牌高对比图表色
  const chartColor = env.CHART_COLOR || "#FF7E5F";
  // 抽样点数量：推荐 15 左右即可完美兼容 Egern 横向空间
  const SAMPLE_POINTS = parseInt(env.SAMPLE_POINTS || "15", 10);
  const GITHUB_TOKEN = env.GITHUB_TOKEN || ""; // 可选，能增加速率限频

  if (!repo) {
    return buildErrorWidget("未配置环境参数 GITHUB_REPO", "例如 'vuejs/vue'");
  }

  const CACHE_KEY = `github_stars_wave_${repo}`;
  const PER_PAGE = 100;

  let starRecords = []; // 抽样记录 {count: 数字, date: 'yyyy/MM/dd'}
  let currentTotalStars = 0;
  let chartLoaded = false;
  let errorMsg = "";

  try {
    // 【 步骤 1 】请求 Repo 最新实时总状态 (顺便获取总 Stars)
    const baseHeaders = {
      "Accept": "application/vnd.github.v3.star+json",
      "User-Agent": "Egern-Widget-Client"
    };
    if (GITHUB_TOKEN) {
      baseHeaders["Authorization"] = `token ${GITHUB_TOKEN}`;
    }

    const repoInfoReq = await ctx.http.get(`https://api.github.com/repos/${repo}`, {
      headers: baseHeaders
    });

    if (repoInfoReq.status !== 200) {
      throw new Error(`API 异常, 仓库未找到或限流 (Status ${repoInfoReq.status})`);
    }
    const repoInfoData = await repoInfoReq.json();
    currentTotalStars = repoInfoData.stargazers_count;

    // 【 步骤 2 】请求 Stargazers 首页，提取 Link Headers 分页
    // 如果没有任何星星，直接返回
    if (currentTotalStars === 0) {
      starRecords = [{ count: 0, date: new Date().toISOString() }];
      chartLoaded = true;
    } else {
      const firstPageReq = await ctx.http.get(`https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=1`, {
        headers: baseHeaders
      });

      if (firstPageReq.status === 200) {
        let totalPages = 1;
        const linkHeader = firstPageReq.headers && (firstPageReq.headers["link"] || firstPageReq.headers["Link"]);
        if (linkHeader) {
          // 正则嗅探，例如提取 `<url?page=400>; rel="last"` 中的 400
          const match = linkHeader.match(/next.*&page=(\d*).*last/);
          if (match && match[1]) {
            totalPages = parseInt(match[1], 10);
          }
        }
        
        // 【 步骤 3 】对 1 ~ totalPages 进行均匀抽样分布
        let requestPages = [];
        if (totalPages <= SAMPLE_POINTS) {
          for (let i = 1; i <= totalPages; i++) requestPages.push(i);
        } else {
          // Math.round 散列插值
          for (let i = 1; i < SAMPLE_POINTS; i++) {
            requestPages.push(Math.round((i * totalPages) / SAMPLE_POINTS));
          }
        }
        
        // 补充收尾页逻辑
        if (!requestPages.includes(1)) requestPages.unshift(1);
        if (requestPages[requestPages.length - 1] > totalPages) {
           requestPages.pop()
        }

        // 去重
        requestPages = [...new Set(requestPages)];

        // 【 步骤 4 】并发 Promise.all 获取指定页的第一位点兵（抽样）
        const concurrentPromises = requestPages.map(page => {
           // 并发请求不需要 await，我们收集 promise 数组
           return ctx.http.get(`https://api.github.com/repos/${repo}/stargazers?per_page=${PER_PAGE}&page=${page}`, {
            headers: baseHeaders
          }).then(async (req) => {
             let parsedData;
             if (req.status === 200) {
               try {
                 parsedData = await req.json();
               } catch(e) { }
             }
             return {
               page: page,
               status: req.status,
               parsedData: parsedData
             };
          });
        });
        
        const resArray = await Promise.all(concurrentPromises);
        
        // 组装打点数据
        starRecords = [];
        for (const res of resArray) {
           if (res.status === 200) {
             let parsedData = res.parsedData;
             
             if (parsedData && parsedData.length > 0) {
               const firstStargazer = parsedData[0];
               // 基于抽样算法算出此时刻对应的准确数量：(页数 - 1) * 100 加上它处在排头的这一颗星星即可接近宏观。
               const accumulatedCount = PER_PAGE * (res.page - 1);
               starRecords.push({
                  count: accumulatedCount,
                  date: firstStargazer.starred_at
               });
             }
           }
        }
        
        // 强行把当前时刻的真实 Total 数挤进坐标列最后
        starRecords.push({
           count: currentTotalStars,
           date: new Date().toISOString()
        });

        // 按时间排序处理 (防抽样乱序)
        starRecords.sort((a,b) => new Date(a.date).getTime() - new Date(b.date).getTime());

        // 保存到最新缓存以防未来脱机断网
        ctx.storage.setJSON(CACHE_KEY, { total: currentTotalStars, records: starRecords });
        chartLoaded = true;
      } else {
         throw new Error(`无法获取 stargazers 列表`);
      }
    }
  } catch (err) {
    // 失败（如并发风暴被 Github Limit 击穿或者断网），尝试拉取本地平滑兜底缓存
    errorMsg = err.message;
    const fallback = ctx.storage.getJSON(CACHE_KEY);
    if (fallback && fallback.records && fallback.total !== undefined) {
      currentTotalStars = fallback.total;
      starRecords = fallback.records;
      chartLoaded = true;
    }
  }

  // ==== UI 渲染段落 ==== 
  
  if (!chartLoaded) {
     return buildErrorWidget("API 限流或无网络", errorMsg + `\n(您可以前往 Github 申请 Personal Access Token 并配置环境参数 GITHUB_TOKEN)`);
  }

  // 计算波段柱形高度映射 (Bar Chart Generator)
  let maxStar = 0;
  starRecords.forEach(r => { if(r.count > maxStar) maxStar = r.count });
  if (maxStar === 0) maxStar = 1; // 避免除零

  const bars = starRecords.map(record => {
    // 使用非线性或线性 flex 指数占比。此处由于已经是宏观抽样，我们计算百分比高度
    const heightPercent = (record.count / maxStar); 
    // Egern flex 设置：空余（透明）与 实体（波段）比例
    const barWeight = heightPercent > 0.05 ? heightPercent : 0.05; // 预留极低迷情况给点面子
    return {
      type: "stack",
      direction: "column",
      // 这里 flex 值代表整根进度轴占位。由于横向排列，我们需要利用垂直 stack spacer 的比例去打出空隙！
      children: [
        { type: "spacer", flex: parseFloat((1 - barWeight).toFixed(3)) },
        { 
          type: "stack", 
          flex: parseFloat(barWeight.toFixed(3)),
          backgroundColor: chartColor,
          opacity: 0.8 + (barWeight * 0.2), // 数据越高越亮越实！
          borderRadius: 2 // 圆边柱子高级感
        }
      ]
    };
  });

  // 如果没有足够多数据被抓取，插入隐形的填充占位符
  while (bars.length < SAMPLE_POINTS) {
     bars.unshift({
        type: "stack",
        direction: "column",
        flex: 1, // 水平均分
        children: [{ type: "spacer" }]
     });
  }

  return {
    type: "widget",
    padding: 18,
    gap: 12,
    backgroundGradient: {
      type: "linear",
      colors: ["#161B22", "#0D1117"], // Github Dark
      startPoint: { x: 0, y: 0 },
      endPoint: { x: 1, y: 1 }
    },
    children: [
      // 1. 顶部：图标和大标题
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
      
      // 2. 中等部位：巨型事实数字
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
            minScale: 0.5
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
      
      // 3. 原生引擎手撸趋势波阵图！(高占比区展示震撼趋势！)
      {
        type: "stack",
        direction: "row",
        alignItems: "stretch", // 横向拉伸平铺
        flex: 1, 
        gap: 4,               // Bar 之间的间隙宽度
        children: bars.map(bar => {
           // 为所有波段赋上相等的水平权重值，完美分摊桌面空间！
           bar.flex = 1;      
           return bar;
        })
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

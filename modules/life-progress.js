// 人生进度小组件 (Life Progress Widget)
// 使用 date 元素和自定义逻辑计算人生进度。
// 可通过环境变量自定义出生日期、预期寿命和UI样式。
//
// 环境变量：
//   TITLE           - 标题，默认 "人生进度"
//   BIRTH_DATE      - 出生日期，格式 YYYY-MM-DD，默认 "2000-01-01"
//   LIFE_EXPECTANCY - 预期寿命（天），默认 30000 
//   ICON            - SF Symbol 图标名，默认 "hourglass.bottomhalf.filled"
//   COLOR_1         - 渐变起始色，默认 "#FF7E5F"
//   COLOR_2         - 渐变结束色，默认 "#FEB47B"

export default async function (ctx) {
  const env = ctx.env;
  const title = env.TITLE || "人生进度";
  const birthDateStr = env.BIRTH_DATE || "2000-01-01";
  const lifeExpectancyDays = parseInt(env.LIFE_EXPECTANCY || "30000", 10);
  const icon = env.ICON || "hourglass.bottomhalf.filled";
  const color1 = env.COLOR_1 || "#FF7E5F";
  const color2 = env.COLOR_2 || "#FEB47B";

  const now = new Date();
  // 支持 "2000-01-01" 这种简单的 YYYY-MM-DD 格式，在 JS 里会自动按 UTC 时区或本地时区解析为对应的日期（此处不影响相差的天数计算准确度）
  const birthDate = new Date(birthDateStr);

  // 容错：如果出生日期无效，使用默认基准
  if (isNaN(birthDate.getTime())) {
    return {
      type: "widget",
      padding: 16,
      children: [
        {
          type: "text",
          text: "出生日期无效，请检查环境变量配置",
          textColor: "#FF3B30",
          font: { size: "subheadline" }
        }
      ]
    };
  }

  const diffMs = now - birthDate;
  // 计算已经度过的天数，取正值
  const passedDays = Math.max(0, Math.floor(diffMs / 86400000));

  // 计算剩余天数，如果超过预期寿命，剩余天数为0
  const remainingDays = Math.max(0, lifeExpectancyDays - passedDays);

  // 计算进度百分比，最高为 1 
  const progress = Math.min(1, Math.max(0, passedDays / lifeExpectancyDays));
  const progressPercent = (progress * 100).toFixed(2); // 保留两位小数

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
      // 标题行
      {
        type: "stack",
        direction: "row",
        alignItems: "center",
        gap: 6,
        children: [
          {
            type: "image",
            src: `sf-symbol:${icon}`,
            width: 16,
            height: 16,
            color: "#FFFFFFCC",
          },
          {
            type: "text",
            text: title,
            font: { size: "subheadline", weight: "semibold" },
            textColor: "#FFFFFFCC",
          },
        ],
      },

      { type: "spacer" },

      // 数据展示区
      {
        type: "stack",
        direction: "row",
        alignItems: "end",
        gap: 8,
        children: [
          // 已经度过
          {
            type: "stack",
            direction: "column",
            alignItems: "start",
            gap: 2,
            children: [
              {
                type: "text",
                text: "已度过",
                font: { size: "caption1" },
                textColor: "#FFFFFFCC",
              },
              {
                type: "stack",
                direction: "row",
                alignItems: "end",
                gap: 2,
                children: [
                  {
                    type: "text",
                    text: `${passedDays}`,
                    font: { size: 40, weight: "bold" },
                    textColor: "#FFFFFF",
                  },
                  {
                    type: "stack",
                    padding: [0, 0, 8, 0],
                    children: [
                      {
                        type: "text",
                        text: "天",
                        font: { size: "caption1", weight: "medium" },
                        textColor: "#FFFFFFCC",
                      },
                    ],
                  },
                ],
              },
            ],
          },
          { type: "spacer" },
          // 剩余寿命
          {
            type: "stack",
            direction: "column",
            alignItems: "end",
            gap: 2,
            children: [
              {
                type: "text",
                text: "剩余天数",
                font: { size: "caption1" },
                textColor: "#FFFFFFCC",
              },
              {
                type: "stack",
                direction: "row",
                alignItems: "end",
                gap: 2,
                children: [
                  {
                    type: "text",
                    text: `${remainingDays}`,
                    font: { size: 24, weight: "bold" },
                    textColor: "#FFFFFF",
                  },
                  {
                    type: "stack",
                    padding: [0, 0, 4, 0],
                    children: [
                      {
                        type: "text",
                        text: "天",
                        font: { size: "caption1", weight: "medium" },
                        textColor: "#FFFFFFCC",
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },

      // 进度条与百分比
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
            backgroundColor: "#FFFFFF40",
            children: [
              {
                type: "stack",
                flex: Math.max(0.001, progress),
                height: 6,
                borderRadius: 3,
                backgroundColor: "#FFFFFF",
                children: [],
              },
              {
                type: "stack",
                flex: 1 - progress,
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
                text: `目标 ${lifeExpectancyDays} 天`,
                font: { size: "caption2" },
                textColor: "#FFFFFF99",
              },
              { type: "spacer" },
              {
                type: "text",
                text: `${progressPercent}%`,
                font: { size: "caption2", weight: "bold" },
                textColor: "#FFFFFF99",
              },
            ],
          },
        ],
      },
    ],
  };
}

// iOS 内存监控小组件 (Memory Monitor Widget)
// 使用 Egern 的 Widget API 构建
// 特性：动态渐变色背景、精确到 1024 进制的数据换算。

export default async function (ctx) {
    // 1. 获取系统内存数据
    // 适配 Egern 的内置全局对象获取硬件信息
    let mem = null;
    if (typeof $device !== 'undefined' && $device.memory) {
        mem = $device.memory;
    } else if (typeof $environment !== 'undefined' && $environment.memory) {
        mem = $environment.memory;
    }

    // 容错机制：如果在测试环境中无法抓取到实际数据，使用模拟数据占位，保证UI依然能渲染供调试
    if (!mem || !mem.total) {
        mem = {
            total: 8589934592, // 8 GB
            used: 6184752906,  // 约 5.76 GB
            free: 2405181686
        };
    }

    // 2. 数据处理与精确换算 (严格遵守 1024 进制)
    const formatGB = (bytes) => {
        if (!bytes || bytes === 0) return '0.00';
        const gb = bytes / (1024 * 1024 * 1024);
        return gb.toFixed(2); // 保留两位小数
    };

    const totalBytes = mem.total;
    const freeBytes = mem.free || mem.inactive || 0;
    const usedBytes = mem.used || (totalBytes - freeBytes);

    // 计算比率，确保范围在 0 ~ 1 之间
    const usageRatio = Math.min(1, Math.max(0, usedBytes / totalBytes));
    const usagePercent = (usageRatio * 100).toFixed(1);

    const totalGB = formatGB(totalBytes);
    const usedGB = formatGB(usedBytes);
    const freeGB = formatGB(totalBytes - usedBytes);

    // 3. 动态色彩机制 (根据内存压力更换背景渐变色)
    let color1 = "#20BF55"; // 默认起始色：生机绿
    let color2 = "#01BAEF"; // 默认结束色：清新蓝

    if (usageRatio >= 0.90) {
        // 危险高压 (>90%)：红色系
        color1 = "#FF416C";
        color2 = "#FF4B2B";
    } else if (usageRatio >= 0.75) {
        // 警告状态 (>75%)：橙色系
        color1 = "#F2994A";
        color2 = "#F2C94C";
    }

    // 4. 渲染 UI
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
            // --- 顶部：图标与标题 ---
            {
                type: "stack",
                direction: "row",
                alignItems: "center",
                gap: 6,
                children: [
                    {
                        type: "image",
                        src: "sf-symbol:memorychip",
                        width: 16,
                        height: 16,
                        color: "#FFFFFFCC",
                    },
                    {
                        type: "text",
                        text: "系统内存",
                        font: { size: "subheadline", weight: "semibold" },
                        textColor: "#FFFFFFCC",
                    },
                ],
            },

            { type: "spacer" },

            // --- 中部：核心数据展示 ---
            {
                type: "stack",
                direction: "row",
                alignItems: "end",
                children: [
                    // 左侧：使用率大数字
                    {
                        type: "stack",
                        direction: "column",
                        alignItems: "start",
                        gap: 2,
                        children: [
                            {
                                type: "text",
                                text: "当前使用率",
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
                                        text: `${usagePercent}`,
                                        font: { size: 38, weight: "bold" },
                                        textColor: "#FFFFFF",
                                    },
                                    {
                                        type: "stack",
                                        padding: [0, 0, 8, 0],
                                        children: [
                                            {
                                                type: "text",
                                                text: "%",
                                                font: { size: "body", weight: "medium" },
                                                textColor: "#FFFFFFCC",
                                            },
                                        ],
                                    },
                                ],
                            },
                        ],
                    },

                    { type: "spacer" },

                    // 右侧：已用/可用详情列表
                    {
                        type: "stack",
                        direction: "column",
                        alignItems: "end",
                        gap: 4,
                        children: [
                            {
                                type: "text",
                                text: `已用 : ${usedGB} GB`,
                                font: { size: "caption1", weight: "medium" },
                                textColor: "#FFFFFF",
                            },
                            {
                                type: "text",
                                text: `空闲 : ${freeGB} GB`,
                                font: { size: "caption1", weight: "medium" },
                                textColor: "#FFFFFFCC",
                            },
                        ],
                    },
                ],
            },

            // --- 底部：进度条 ---
            {
                type: "stack",
                direction: "column",
                gap: 6,
                children: [
                    // 进度条本身
                    {
                        type: "stack",
                        direction: "row",
                        height: 6,
                        borderRadius: 3,
                        backgroundColor: "#FFFFFF40", // 半透明白作为槽底
                        children: [
                            {
                                type: "stack",
                                flex: Math.max(0.001, usageRatio), // 已使用的比例
                                height: 6,
                                borderRadius: 3,
                                backgroundColor: "#FFFFFF", // 纯白作为进度
                                children: [],
                            },
                            {
                                type: "stack",
                                flex: 1 - usageRatio,
                                children: [],
                            },
                        ],
                    },
                    // 进度条两端标注
                    {
                        type: "stack",
                        direction: "row",
                        children: [
                            {
                                type: "text",
                                text: "0 GB",
                                font: { size: "caption2" },
                                textColor: "#FFFFFF99",
                            },
                            { type: "spacer" },
                            {
                                type: "text",
                                text: `总量 ${totalGB} GB`,
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
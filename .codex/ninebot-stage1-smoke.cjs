const path = require('path');

(async () => {
    const mod = await import('file://' + path.resolve('modules/ninebot-widget.js').replace(/\\/g, '/'));
    const script = mod.default;

    function createStore(seed) {
        const store = new Map(Object.entries(seed || {}));
        return {
            getJSON(key) {
                return store.has(key) ? store.get(key) : null;
            },
            setJSON(key, value) {
                store.set(key, value);
            }
        };
    }

    function createCtx(overrides = {}) {
        return {
            env: {
                TITLE: 'Ninebot 签到',
                AUTHORIZATION: 'Bearer test-token',
                DEVICE_ID: '1234567890',
                OPEN_URL: 'https://h5-bj.ninebot.com/',
                MANUAL_CHECKIN_SCRIPT_NAME: 'ninebot-checkin-manual',
                MANUAL_STATUS_SCRIPT_NAME: 'ninebot-checkin-query'
            },
            widgetFamily: 'systemMedium',
            storage: createStore(),
            http: {
                async get() {
                    return {
                        status: 200,
                        async text() {
                            return JSON.stringify({ code: 0, data: { currentSignStatus: 1, consecutiveDays: 7 } });
                        }
                    };
                },
                async post() {
                    return {
                        status: 200,
                        async text() {
                            return JSON.stringify({ code: 0, data: { rewardDesc: '奖励 5 积分' } });
                        }
                    };
                }
            },
            notify: async () => { },
            ...overrides
        };
    }

    const widgetSeed = {
        ninebot_checkin_v2: {
            dateKey: new Date().toISOString().slice(0, 10),
            status: 'failed',
            title: '签到失败',
            message: 'Authorization 已过期',
            checkedAt: new Date().toISOString(),
            source: 'schedule',
            consecutiveDays: null,
            lastError: 'Authorization 已过期'
        }
    };

    const mediumWidgetCtx = createCtx({
        widgetFamily: 'systemMedium',
        storage: createStore(widgetSeed)
    });
    const mediumWidgetResult = await script(mediumWidgetCtx);
    if (!mediumWidgetResult || mediumWidgetResult.type !== 'widget') {
        throw new Error('medium widget 渲染结果不合法');
    }
    const mediumText = JSON.stringify(mediumWidgetResult);
    if (mediumText.includes('backgroundColor":"rgba(255,255,255,0.06)')) {
        throw new Error('主屏仍存在卡片式背景块');
    }
    if (mediumText.includes('ninebot-checkin-manual') || mediumText.includes('ninebot-checkin-query')) {
        throw new Error('medium widget 仍展示手动脚本提示');
    }
    if (!mediumText.includes('"text":"状态"') || !mediumText.includes('"text":"结果"')) {
        throw new Error('medium widget 未保留核心状态信息');
    }

    const smallWidgetCtx = createCtx({
        widgetFamily: 'systemSmall',
        storage: createStore(widgetSeed)
    });
    const smallWidgetResult = await script(smallWidgetCtx);
    if (!smallWidgetResult || smallWidgetResult.type !== 'widget') {
        throw new Error('small widget 渲染结果不合法');
    }
    const smallText = JSON.stringify(smallWidgetResult);
    if (smallText.includes('ninebot-checkin-manual') || smallText.includes('ninebot-checkin-query')) {
        throw new Error('small widget 仍展示手动脚本提示');
    }
    if (smallText.includes('"text":"最近"') || smallText.includes('"text":"定时"')) {
        throw new Error('small widget 仍保留低优先级信息行');
    }
    if (!smallText.includes('Authorization 已过期')) {
        throw new Error('small widget 未保留核心结果摘要');
    }

    let successNotify = false;
    const scheduleCtx = createCtx({
        cron: '0 9 * * *',
        script: { name: 'ninebot-checkin' },
        notify: async () => {
            successNotify = true;
        },
        env: {
            TITLE: 'Ninebot 签到',
            AUTHORIZATION: 'Bearer test-token',
            DEVICE_ID: '1234567890',
            NOTIFY_ON_SUCCESS: 'true',
            ACTION: 'checkin'
        }
    });

    const scheduleResult = await script(scheduleCtx);
    if (!scheduleResult || (scheduleResult.status !== 'already_signed' && scheduleResult.status !== 'success')) {
        throw new Error('schedule 签到执行结果不符合预期');
    }
    if (!successNotify) {
        throw new Error('schedule 成功后未触发通知');
    }

    const queryCtx = createCtx({
        cron: '1 0 31 2 *',
        script: { name: 'ninebot-checkin-query' },
        env: {
            TITLE: 'Ninebot 签到',
            AUTHORIZATION: 'Bearer test-token',
            DEVICE_ID: '1234567890',
            ACTION: 'status'
        },
        http: {
            async get() {
                return {
                    status: 200,
                    async text() {
                        return JSON.stringify({ code: 0, data: { currentSignStatus: 0, consecutiveDays: 3 } });
                    }
                };
            },
            async post() {
                throw new Error('status 查询不应调用签到接口');
            }
        }
    });

    const queryResult = await script(queryCtx);
    if (!queryResult || queryResult.status !== 'not_signed') {
        throw new Error('手动查询结果不符合预期');
    }

    console.log('ninebot smoke ok');
})();

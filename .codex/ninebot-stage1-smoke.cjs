const path = require('path');

(async () => {
    const mod = await import('file://' + path.resolve('modules/ninebot-widget.js').replace(/\\/g, '/'));
    const script = mod.default;

    function createCtx(overrides = {}) {
        const store = new Map();
        return {
            env: {
                TITLE: 'Ninebot 签到',
                AUTHORIZATION: 'Bearer test-token',
                DEVICE_ID: '1234567890',
                OPEN_URL: 'https://h5-bj.ninebot.com/'
            },
            widgetFamily: 'systemMedium',
            storage: {
                getJSON(key) {
                    return store.has(key) ? store.get(key) : null;
                },
                setJSON(key, value) {
                    store.set(key, value);
                }
            },
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

    const widgetCtx = createCtx({
        storage: {
            getJSON() {
                return {
                    dateKey: new Date().toISOString().slice(0, 10),
                    status: 'failed',
                    title: '签到失败',
                    message: 'Authorization 已过期',
                    checkedAt: new Date().toISOString(),
                    source: 'schedule',
                    consecutiveDays: null,
                    lastError: 'Authorization 已过期'
                };
            },
            setJSON() { }
        }
    });

    const widgetResult = await script(widgetCtx);
    if (!widgetResult || widgetResult.type !== 'widget') {
        throw new Error('widget 渲染结果不合法');
    }

    let notified = false;
    const scheduleCtx = createCtx({
        cron: '0 9 * * *',
        notify: async () => {
            notified = true;
        },
        env: {
            TITLE: 'Ninebot 签到',
            AUTHORIZATION: 'Bearer test-token',
            DEVICE_ID: '1234567890',
            NOTIFY_ON_SUCCESS: 'true'
        }
    });

    const scheduleResult = await script(scheduleCtx);
    if (!scheduleResult || (scheduleResult.status !== 'already_signed' && scheduleResult.status !== 'success')) {
        throw new Error('schedule 执行结果不符合预期');
    }
    if (!notified) {
        throw new Error('schedule 成功后未触发通知');
    }

    console.log('ninebot smoke ok');
})();

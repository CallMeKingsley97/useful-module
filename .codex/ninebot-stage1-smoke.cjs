const fs = require('fs');
const path = require('path');
const assert = require('assert');

function loadWidgetModule() {
    const filePath = path.join(__dirname, '..', 'modules', 'ninebot-widget.js');
    let source = fs.readFileSync(filePath, 'utf8');
    source = source.replace('export default async function (ctx) {', 'async function __default__(ctx) {');
    source += '\nmodule.exports = __default__;\n';
    source += 'module.exports.__internals = { resolveDisplayCount, orderDevices, needsDynamicRefresh };\n';

    const mod = { exports: {} };
    const runner = new Function('module', 'exports', 'require', source);
    runner(mod, mod.exports, require);
    return mod.exports;
}

function createResponse(status, payload) {
    return {
        status,
        async json() {
            return payload;
        }
    };
}

function createCtx(options) {
    options = options || {};
    const store = options.store || {};
    return {
        env: options.env || {},
        widgetFamily: options.family || 'systemMedium',
        storage: {
            getJSON(key) {
                return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
            },
            setJSON(key, value) {
                store[key] = value;
            },
            delete(key) {
                delete store[key];
            }
        },
        http: {
            post: options.post || (async function () {
                throw new Error('post not mocked');
            })
        },
        notify() { }
    };
}

function stringify(widget) {
    return JSON.stringify(widget);
}

async function testMissingUsername(render) {
    const widget = await render(createCtx({ env: {}, family: 'systemSmall' }));
    assert.strictEqual(widget.type, 'widget');
    assert.ok(stringify(widget).includes('请设置 USERNAME'));
}

async function testMissingPassword(render) {
    const widget = await render(createCtx({ env: { USERNAME: 'demo@example.com' }, family: 'systemSmall' }));
    assert.strictEqual(widget.type, 'widget');
    assert.ok(stringify(widget).includes('请设置 PASSWORD'));
}

async function testLoginFailure(render) {
    const widget = await render(createCtx({
        env: { USERNAME: 'demo@example.com', PASSWORD: 'bad-pass' },
        family: 'systemSmall',
        post: async function () {
            return createResponse(200, { resultCode: 403, resultDesc: '登录失败' });
        }
    }));
    assert.strictEqual(widget.type, 'widget');
    assert.ok(stringify(widget).includes('Ninebot 加载失败'));
    assert.ok(stringify(widget).includes('登录失败'));
}

async function testEmptyVehicleList(render) {
    let step = 0;
    const widget = await render(createCtx({
        env: { USERNAME: 'demo@example.com', PASSWORD: 'ok-pass' },
        family: 'systemSmall',
        post: async function () {
            step += 1;
            if (step === 1) {
                return createResponse(200, {
                    resultCode: 0,
                    data: {
                        access_token: 'token-1',
                        refresh_token: 'refresh-1',
                        accessTokenValidity: 3600
                    }
                });
            }
            return createResponse(200, { resultCode: 0, data: [] });
        }
    }));
    assert.strictEqual(widget.type, 'widget');
    assert.ok(stringify(widget).includes('当前账号下没有可展示车辆'));
}

async function testCachedFallback(render) {
    const now = Date.now();
    const store = {
        ninebot_devices_v1: {
            ts: now,
            updatedAt: new Date(now).toISOString(),
            items: [
                { sn: 'SN-001', deviceName: 'MAX G2', model: 'G2', productName: 'Segway MAX G2' }
            ]
        },
        ninebot_dynamic_v1: {
            updatedAt: new Date(now).toISOString(),
            items: {
                'SN-001': {
                    ts: now,
                    updatedAt: new Date(now).toISOString(),
                    data: {
                        battery: 67,
                        status: 0,
                        chargingState: 0,
                        pwr: 1,
                        gsm: 26,
                        estimateMileage: 31
                    }
                }
            }
        }
    };

    const widget = await render(createCtx({
        env: { USERNAME: 'demo@example.com', PASSWORD: 'ok-pass' },
        family: 'systemSmall',
        store,
        post: async function () {
            throw new Error('network should not be called when cache is fresh');
        }
    }));

    assert.strictEqual(widget.type, 'widget');
    const snapshot = stringify(widget);
    assert.ok(snapshot.includes('MAX G2'));
    assert.ok(snapshot.includes('67%'));
}

function testDisplayCount(internals) {
    assert.strictEqual(internals.resolveDisplayCount('systemSmall', 5), 1);
    assert.strictEqual(internals.resolveDisplayCount('accessoryInline', 5), 1);
    assert.strictEqual(internals.resolveDisplayCount('systemMedium', 5), 3);
    assert.strictEqual(internals.resolveDisplayCount('systemLarge', 5), 5);
}

function testPrimaryOrdering(internals) {
    const ordered = internals.orderDevices([
        { sn: 'SN-001', deviceName: 'A' },
        { sn: 'SN-002', deviceName: 'B' },
        { sn: 'SN-003', deviceName: 'C' }
    ], 'sn-002');
    assert.strictEqual(ordered[0].sn, 'SN-002');
}

function testDynamicRefreshDecision(internals) {
    const now = Date.now();
    assert.strictEqual(internals.needsDynamicRefresh({ ts: now, data: {} }, 15, false), false);
    assert.strictEqual(internals.needsDynamicRefresh({ ts: now - 16 * 60 * 1000, data: {} }, 15, false), true);
    assert.strictEqual(internals.needsDynamicRefresh({ ts: now, data: {} }, 15, true), true);
    assert.strictEqual(internals.needsDynamicRefresh(null, 15, false), true);
}

async function main() {
    const render = loadWidgetModule();
    const internals = render.__internals;

    testDisplayCount(internals);
    testPrimaryOrdering(internals);
    testDynamicRefreshDecision(internals);

    await testMissingUsername(render);
    await testMissingPassword(render);
    await testLoginFailure(render);
    await testEmptyVehicleList(render);
    await testCachedFallback(render);

    console.log(JSON.stringify({
        ok: true,
        tests: [
            'display-count',
            'primary-ordering',
            'dynamic-refresh-decision',
            'missing-username',
            'missing-password',
            'login-failure',
            'empty-vehicle-list',
            'cached-fallback'
        ]
    }, null, 2));
}

main().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
});

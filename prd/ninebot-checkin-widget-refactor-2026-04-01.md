# Ninebot 签到小组件重构方案

## 1. 背景

当前 [`modules/ninebot-widget.js`](../modules/ninebot-widget.js) 主要实现车辆列表、动态信息和 token 缓存，但用户已明确要求：

- 去掉原有车辆信息相关代码
- 仅保留签到能力
- 依据参考仓库 `waistu/Ninebot` 的实现方式接入真实签到接口
- 将签到成功 / 失败结果显示在小组件上
- 失败时显示原因
- 每天早上 9 点自动执行签到
- 主屏布局全部改为平铺，不允许内嵌卡片
- 需要额外提供手动触发签到和手动查询签到状态的能力

## 2. 外部证据

参考仓库 `https://github.com/waistu/Ninebot` 中已确认的签到链路：

- 签到状态接口：`GET https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/status?t=<timestamp>`
- 签到接口：`POST https://cn-cbu-gateway.ninebot.com/portal/api/user-sign/v2/sign`
- 请求头核心字段：`Authorization`、`Origin`、`Referer`、`from_platform_1`、`language`、移动端 `User-Agent`
- 请求体核心字段：`deviceId`
- 成功判定：返回 JSON 中 `code === 0`
- 已签到判定：状态接口返回 `data.currentSignStatus === 1`

## 3. 目标

### 3.1 功能目标

1. 小组件只展示“今日签到状态”与“最近一次结果”
2. 每日早上 9 点执行一次签到任务
3. 失败结果持久化，供小组件展示原因
4. 若今日已签到，避免重复提交
5. 不再依赖旧版登录、设备列表、车辆动态接口
6. 主屏使用平铺信息行结构，避免卡中卡与多卡片并列抢高度
7. 提供手动签到脚本入口
8. 提供手动查询签到状态脚本入口

### 3.2 非目标

- 不再展示电量、锁车、在线状态、多车摘要
- 不再使用用户名密码登录换 token
- 不实现额外抓包自动化，仍由用户提供 `Authorization` 与 `Device ID`

## 4. 方案设计

```mermaid
flowchart TD
    A[09:00 定时脚本触发] --> B[读取本地签到缓存]
    B --> C{今天是否已成功签到}
    C -->|是| D[直接返回缓存结果]
    C -->|否| E[请求签到状态接口]
    E --> F{接口显示已签到}
    F -->|是| G[保存 already_signed 状态]
    F -->|否| H[调用签到接口]
    H --> I{code === 0}
    I -->|是| J[再次拉取状态并保存 success]
    I -->|否| K[保存 failed 与 msg]
    E -->|异常| L[保存 failed 与异常原因]
    M[手动签到脚本] --> H
    N[手动查询脚本] --> E
    J --> O[小组件平铺展示结果]
    G --> O
    K --> O
    L --> O
```

## 5. 代码落地

### 5.1 [`modules/ninebot-widget.js`](../modules/ninebot-widget.js)

重写为单文件双入口：

- 当存在 `ctx.cron` 时，按 schedule 脚本执行动作
- 当存在 `ctx.widgetFamily` 时，按 generic 脚本渲染小组件

核心职责：

- 统一封装请求头与 HTTP 请求
- 标准化签到状态结构
- 将结果写入 `ctx.storage`
- 为不同尺寸输出简洁的平铺式 Widget DSL
- 根据 `ACTION` 区分“签到”与“查询状态”两类 schedule 动作

### 5.2 [`ninebot-widget.yaml`](../ninebot-widget.yaml)

调整为：

- 保留一个 generic 脚本注册
- 保留一个每日 09:00 自动签到 schedule
- 新增一个手动签到 schedule 脚本定义
- 新增一个手动查询状态 schedule 脚本定义
- 三个 schedule 与一个 generic 都复用同一份 [`modules/ninebot-widget.js`](../modules/ninebot-widget.js)
- 删除旧版 `USERNAME`、`PASSWORD`、`PRIMARY_DEVICE_ID` 等环境变量说明
- 新增签到所需环境变量说明

## 6. 环境变量

计划保留以下最小环境变量：

- `TITLE`：小组件标题，可选
- `AUTHORIZATION`：抓包得到的 Ninebot `Authorization` 请求头值，必填
- `DEVICE_ID`：抓包得到的设备 ID，必填
- `OPEN_URL`：点击小组件后的跳转链接，可选
- `TIMEOUT_MS`：请求超时，可选
- `NOTIFY_ON_SUCCESS`：定时签到成功后是否通知，可选
- `NOTIFY_ON_FAILURE`：定时签到失败后是否通知，可选
- `FORCE_CHECKIN`：手动强制忽略本地成功缓存，可选
- `ACTION`：schedule 动作，`checkin` 或 `status`
- `MANUAL_CHECKIN_SCRIPT_NAME`：小组件展示的手动签到脚本名
- `MANUAL_STATUS_SCRIPT_NAME`：小组件展示的手动查询脚本名

## 7. 存储结构

计划使用键：`ninebot_checkin_v2`

```json
{
  "dateKey": "2026-04-01",
  "status": "success",
  "title": "签到成功",
  "message": "连续签到 5 天",
  "consecutiveDays": 5,
  "checkedAt": "2026-04-01T09:00:03.000+08:00",
  "source": "schedule",
  "lastError": "",
  "raw": {}
}
```

状态枚举：

- `pending`
- `success`
- `already_signed`
- `not_signed`
- `failed`

## 8. 平铺布局规则

主屏尺寸统一使用：

- 标题
- 分隔线
- 平铺信息行
- 底部说明

明确禁止：

- 卡片内嵌卡片
- 左右双卡并排
- 摘要卡 / 状态卡 / 明细卡矩阵
- 固定高度内容块中塞入动态长文案

## 9. 验收标准

1. [`modules/ninebot-widget.js`](../modules/ninebot-widget.js) 不再包含车辆列表、车辆动态、旧登录逻辑
2. 定时配置改为每天早上 9 点执行签到
3. 主屏布局改为纯平铺，不再出现内嵌卡片
4. 成功后小组件显示成功文案和连续签到信息
5. 失败后小组件显示失败状态和原因
6. 缺少配置时小组件显示明确缺失项
7. 提供手动签到脚本和手动查询脚本，并在小组件中给出脚本名提示
8. 同日重复执行时不会重复签到，除非显式开启 `FORCE_CHECKIN`

## 10. 风险

- `Authorization` 依赖抓包结果，过期后需要用户重新更新
- Ninebot 服务端可能调整风控字段或请求头要求
- 若 Egern schedule 的时区与设备系统时区不一致，可能影响 9 点触发时间
- 手动脚本运行方式依赖 Egern 的脚本执行入口，小组件中仅提示脚本名，不直接在 widget 内发起按钮动作

## 11. 验证计划

1. 做静态语法校验
2. 通过构造 `ctx.storage` 假数据验证 widget 渲染输出
3. 检查 YAML 是否存在自动签到、手动签到、手动查询三个 schedule 定义
4. 人工核对自动签到 cron 是否为 `0 9 * * *`

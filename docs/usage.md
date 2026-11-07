# 用量和费用

按量计费的组件(语音合成、听写、翻译)每调用一次记一笔用量和费用，预装的阿里云组件 `yanuo.aliyun` 把它们按天汇总成账本，在组件详情和仪表盘上显示。这篇讲记账的规则、账本文件、价格表、汇总和显示。

## 组成

用量不在核心里，全部在阿里云组件 `components/aliyun`：清单 `provides: ["aliyun", "usage"]`，有主进程入口和主窗口入口。这个组件关着时没有 `usage` 服务，记账和显示都没有。

| 部分 | 文件 | 做什么 |
|---|---|---|
| 主进程部分 | `components/aliyun/src/main.ts` | 提供 `usage` 服务(记一笔)；把账本推给主窗口；组件卸载后删掉它的用量 |
| 账本文件 | `components/aliyun/src/meter.ts` | 读写 `usage.json`，按天累计，裁剪旧日子 |
| 账本计算 | `components/aliyun/src/book.ts` | 日期、累计的合并、按组件和天汇总、读进来的账本的校验 |
| 主窗口部分 | `components/aliyun/src/window.ts` | 收账本，提供主窗口的 `usage` 服务，往组件详情和仪表盘放内容 |
| 费用数据 | `components/aliyun/src/cost.ts`、`components/aliyun/src/ticks.ts` | 今天、昨天、近 14 天、本月的费用，一个组件的主要用量，柱形图刻度 |
| 界面 | `components/aliyun/src/` 下的 `UsageSection.vue`、`CostToday.vue`、`CostBars.vue`、`CostMonth.vue` | 「用量」一节和三张费用卡片 |
| 频道 | `components/aliyun/src/channels.ts` | 两部分之间的总线频道名 |

单价和计费函数跟着记账的组件走，百炼三个组件的在 `components/_bailian/pricing.ts`。单元测试在 `test/usage.test.ts`、`test/usage-service.test.ts`、`test/bailian-cost.test.ts`。

## 声明和记账

记用量的组件做两件事：

- 清单写 `usage`：币种(三个大写字母)和各用量的单位名，格式见 [组件格式](components.md)。主窗口按它显示；没声明的组件记了账也不显示「用量」一节。
- 主进程代码里每用一次记一笔：`ctx.get('usage')?.add({ item, amount, cost })`，接口见 [SDK](sdk.md)。`usage` 服务在共用的组件进程里；清单写了 `"process": "own"` 的组件拿不到它(见 [SDK](sdk.md) 的「提供和使用服务」)。

`usage` 服务按调用方的组件上下文认出是哪个组件，记到它的 id 下。一笔的校验(`components/aliyun/src/meter.ts`)：

| 字段 | 规则 |
|---|---|
| `item` | 非空字符串，最长 64 字；不合格的整笔忽略 |
| `amount` | 对象(用量名 → 数量)，只留值是有限数字的键；不是对象的整笔忽略 |
| `cost` | 有限数字 = 这一笔的费用；没写或不是有限数字 = 不知道价格 |

每一笔自动记一次 `calls`(次数)，清单的 `usage.units` 里写了 `calls` 时它也能当单位显示。

## 账本文件

账本存在数据文件夹的 `usage.json`，结构是「日期 → 组件 id → 项(item) → 累计」，类型 `UsageBook` 在 `sdk/index.ts`：

```json
{
  "2026-11-10": {
    "yanuo.tts-bailian": {
      "cosyvoice-v3-flash": { "amount": { "chars": 1240 }, "calls": 31, "cost": 0.124 }
    },
    "yanuo.mt-bailian": {
      "qwen-mt-flash": { "amount": { "input": 820, "output": 760 }, "calls": 31, "cost": 0.002056 }
    }
  }
}
```

- 日期是本机时区的 `YYYY-MM-DD`，一笔记在记账那一刻所在的日子。
- 累计的 `cost` 为 `null` 表示这一项有用量但不知道价格。
- 账本变化后 3 秒写盘，这期间的变化一起写；组件停用时马上写一次。写失败时留到下一次写盘。
- 写盘时最多留 400 个日子，超出的删掉最早的。只数有记录的日子，不是自然日。
- 卸载一个组件后，核心在总线频道 `core/component-removed` 上发它的 id，阿里云组件删掉它在所有日子里的用量并马上写盘。
- 读文件和主窗口收账本时都做校验(`parseBook`)：日期格式不对的、不是对象的、`calls` 不是有限数字的、`cost` 既不是有限数字也不是 `null` 的项丢掉，`amount` 里不是有限数字的键丢掉。文件不存在或读不出来时从空账本开始。

## 合并和汇总

`components/aliyun/src/book.ts`：

| 函数 | 规则 |
|---|---|
| `mergeTotal` | 一笔并进累计：各用量、次数相加；费用两边有一边是 `null`，结果就是 `null` |
| `summarize` | 几天里一个组件的汇总：各 `item` 的累计，和总费用(`cost` 为 `null` 的项按 0 算) |
| `dayCosts` | 一天里各组件的费用(同上，`null` 按 0) |
| `lastDays` / `monthDays` | 截至某天的 n 天日期；当月 1 号到某天的日期 |

同一项里只要有一笔没带费用，这一项当天的费用就是「不知道」，不计入合计。

## 价格表

`components/_bailian/pricing.ts`，阿里云百炼中国内地的单价，人民币：

| 组件 | 模型 | 单价 |
|---|---|---|
| 语音合成 | `cosyvoice-v3-flash` | 1 元 / 万字符 |
| | `cosyvoice-v3-plus` | 2 元 / 万字符 |
| | `cosyvoice-v3.5-flash` | 0.8 元 / 万字符 |
| | `cosyvoice-v3.5-plus` | 1.5 元 / 万字符 |
| 听写 | `fun-asr-realtime` | 0.00033 元 / 秒 |
| 翻译 | `qwen-mt-flash` | 输入 0.7、输出 1.95 元 / 百万 Token |
| | `qwen-mt-plus` | 输入 1.8、输出 5.4 元 / 百万 Token |

表里没有的模型(`qwen-mt-lite`、`qwen-mt-turbo`、手填的模型名)只记用量，不算费用。接入域名填别的站点时也按这张表算，所以界面上写明费用是估算、以服务商账单为准。

## 三个百炼组件记什么

| 组件 | `item` | `amount` | 什么时候记 | `usage.units` |
|---|---|---|---|---|
| 语音合成 `yanuo.tts-bailian` | 合成用的模型 | `chars`：计费字符(接口返回的，没返回时按字数) | 每合成成功一句 | `chars` 字符、`calls` 句 |
| 听写 `yanuo.asr-bailian` | 识别模型 | `seconds`：发给服务端的音频时长(字节数 ÷ 32000) | 累计满 10 秒记一笔，停止听写时记余下的 | `seconds` 秒、`calls` 次 |
| 翻译 `yanuo.mt-bailian` | 翻译模型 | `input`、`output`：响应里的输入、输出 Token | 每次请求成功(命中缓存的不记) | `input` 输入 Token、`output` 输出 Token、`calls` 句 |

三个组件的币种都是 `CNY`。各自的流程见 [语音合成、听写、翻译](voice.md)。

## 账本到主窗口

主进程部分和主窗口部分经总线往来(`components/aliyun/src/channels.ts`)：

| 频道 | 方向 | 数据 |
|---|---|---|
| `yanuo.aliyun/usage-book` | 主进程 → 主窗口 | 整本账 |
| `yanuo.aliyun/usage-get` | 主窗口 → 主进程 | 要一份账本 |

- 主进程部分加载时推一次；之后账本每次变化后 1 秒推一次，这 1 秒里的变化并成一次。
- 主窗口部分加载时要一份，收到的账本经校验后放进响应式的 `ledger.book`(`components/aliyun/src/state.ts`)。
- 主窗口部分用 `ctx.provide('usage', …)` 提供主窗口的 `usage` 服务，别的主窗口组件 `inject: ['usage']` 后读 `ctx.usage.book`。
- 「今天」按本机日期算，每 60 秒比对一次，日期变了卡片跟着重算。

## 显示

金额的写法(`src/renderer/money.ts`)：币种符号 `CNY` ¥、`USD` $、`EUR` €、`JPY` ¥，别的币种写代码加空格；用量数字整数原样、小数留 1 位，带千分位。

### 组件详情的「用量」一节

`components/aliyun/src/UsageSection.vue`，放在组件页详情的插槽 `component-details`(`order: 0`，排在设置各节后面)。清单声明了 `usage` 的组件才显示。

三格：今天、最近 7 天、本月(1 号到今天)。每格两个数：

- 费用：这几天各项费用的合计，按组件清单的币种，2 位小数。
- 主要用量：各项的用量按单位合计(次数算在 `calls` 上)，取第一个在清单 `usage.units` 里声明了的单位，如「1,240 字符」；这几天没有用量时显示「还没有用量」。

一节的最后一行是「费用按各组件的价格表估算，以服务商账单为准」。

### 仪表盘的费用卡片

三张卡片经插槽 `dashboard` 放进仪表盘(仪表盘怎么排卡片见 [主窗口](main-window.md))。数据都来自 `components/aliyun/src/cost.ts` 的 `cost`，卡片文件在 `components/aliyun/src/`：

| 卡片 | 文件 | 位置 | 内容 |
|---|---|---|---|
| 今日费用 | `CostToday.vue` | 左列，`order: 0` | 今天的合计(2 位小数)和比昨天多或少多少；按组件的环形图；今天有费用的组件各一行：名字、今天的主要用量、金额(3 位小数) |
| 费用 · 近 14 天 | `CostBars.vue` | 左列，`order: 10` | 14 天每天一根按组件堆叠的柱，两条刻度线；悬停显示这一天的合计和各组件的金额 |
| 本月费用 | `CostMonth.vue` | 右列，`order: 0` | 本月合计、日均、预计全月；本月累计费用的走势线(横轴是整月)；按组件的分条和金额 |

规则和数值：

- 系列：本月和近 14 天里费用大于 0 的组件，按本月费用从高到低排，依次取 7 种颜色(超过 7 个时循环)，名字是组件的显示名。三张卡片用同一组系列和颜色。
- 币种取组件列表里第一个声明了 `usage` 的组件的，没有时是 `CNY`。
- 今日费用：和昨天的差不到 0.005 时显示「持平」；今天没有费用时环形图是一圈空环，明细处显示「还没有费用」。
- 日均 = 本月合计 ÷ 本月已过的天数(含今天)；预计全月 = 日均 × 本月的天数，10 以上显示 1 位小数，其余 2 位。
- 柱形图的刻度间隔是不超过最高柱一半的最大整档(1、2、2.5、5 乘 10 的整数次方)，画一倍和两倍间隔两条线；14 天都没有费用时间隔是 0.05。最后一根柱标「今天」，其余标「月/日」。

# 在线统计

程序开着时隔一段时间往接收地址发一条在线记录(心跳)，接收端按设备标识去重，得到在线数和活跃用户数。这件事不在核心里，全部在预装组件 `yanuo.telemetry`：停用或卸载它就不发。这篇讲组件的组成、一条记录里有什么、设备标识怎么算、什么时候发和不发、开关和组件详情、接收端要做什么。给用户看的说明在 [使用说明](guide.md#在线统计)。

## 组成

组件在 `components/telemetry`，类别 `service`(清单 `provides: ["telemetry"]`，没有服务对象)，有主进程入口和主窗口入口，跑在共用的组件进程里。

| 部分 | 文件 | 做什么 |
|---|---|---|
| 主进程部分 | `src/main.ts` | 取设备标识、按间隔发心跳、把状态经总线给主窗口 |
| 心跳 | `src/beat.ts` | 记录的格式、间隔、发送(POST) |
| 设备标识 | `src/device.ts` | 读 MachineGuid、算设备标识 |
| 状态 | `src/state.ts` | 状态的格式和收窄、发不发的判断(`whyOff`) |
| 接收地址 | `src/endpoint.ts` | 一个常量(`https://beat.foxnature.net/v1/report`)，空着时不发 |
| 总线频道 | `src/channels.ts` | 主进程部分和主窗口部分之间的两个频道 |
| 主窗口部分 | `src/window.ts`、`view.ts` | 登记组件详情里的一节；收状态 |
| 界面 | `src/RecordSection.vue` | 组件详情里的「在线记录」一节 |

核心只给它两样东西：应用信息里的程序版本和是不是安装包里的程序(`ctx.app.info.version`、`packaged`，见 [SDK](sdk.md))。

## 一条记录

```json
[{ "v": 1, "device": "bb140a2a…3b9f", "session": "6f1efcb6-a509-43dc-8fbd-328548cc9090", "app": "0.1.0-beta.2" }]
```

| 字段 | 内容 |
|---|---|
| `v` | 记录格式的版本，值是 1 |
| `device` | 设备标识，64 位十六进制，见下 |
| `session` | 会话标识：组件进程每次启动随机生成的 UUID，只在内存里，不存盘 |
| `app` | 程序版本 |

一次请求是一个 JSON 数组，里面一条记录。没有别的字段：不带输入的文字、语音、密钥、组件列表、系统信息。

### 设备标识

`sha256("foxpanel.telemetry.device\n" + MachineGuid)` 的十六进制。

- MachineGuid 是 Windows 注册表 `HKLM\SOFTWARE\Microsoft\Cryptography` 下的值，装系统时生成，重装本程序不变；用 `reg.exe query` 读(最多等 5 秒)。
- 前面接的那一段让这个值只在本程序里有意义，和别的程序对同一个 MachineGuid 算出的值不同；从设备标识算不回 MachineGuid。
- 读不到 MachineGuid(不是 Windows、`reg.exe` 出错)时用一个随机的 64 位十六进制值，存在组件数据的 `device` 键里，下次接着用；卸载组件时随组件数据删掉。

## 什么时候发

- 开始发送后 1 分钟发第一条(`FIRST_MS`)，之后每 10 分钟一条(`EVERY_MS`)。
- 一次发送最多等 10 秒。发不出去(断网、接收端没回 2xx)的那一条丢掉，不排队、不补发；这次加载里第一次失败记一行警告日志 `heartbeat not sent: …`，之后的失败不再记。
- 组件加载时记一行 `heartbeat on` 或 `heartbeat off: <原因>`。

### 不发的情况

`whyOff` 按下面的顺序看，碰到第一条满足的就不发，状态里的 `off` 是它的名字；都不满足时 `off` 是 `null`，在发送。

| `off` | 什么时候 |
|---|---|
| `unconfigured` | 接收地址(`src/endpoint.ts` 的 `ENDPOINT`)是空的 |
| `dev` | 从源码启动的程序(应用信息的 `packaged` 为假) |
| `env` | 环境变量 `FOXPANEL_NO_TELEMETRY` 或 `DO_NOT_TRACK` 设着(空、`0`、`false` 不算)；冒烟检查启动程序时带着前一个 |
| `disabled` | 组件的设置「发送在线统计」(`enabled`，默认开)关着 |

组件停用或卸载时主进程部分不加载，也就不发。

## 开关和组件详情

开关是组件的设置项「发送在线统计」(`enabled`，默认开)，在 组件 页这个组件的详情里改；没有别的确认，装上后条件都满足就开始发。详情里还有「在线记录」一节(`RecordSection.vue`，插槽 `component-details`，order 10，只在本组件的详情里显示)：

| 行 | 内容 |
|---|---|
| 发送状态 | 「正在发送」，或不发送的原因(此版本不发送、开发版不发送、已由环境变量关闭、已关闭) |
| 设备标识、会话标识 | 默认打码；点下面的「显示」看全文(能选中复制)，再点「隐藏」 |
| 程序版本 | 当前的程序版本 |

主进程部分还没给过状态时(组件进程没在跑)这一节不显示。

## 总线频道和组件数据

| 频道 | 方向 | 数据 |
|---|---|---|
| `yanuo.telemetry/get` | 主窗口 → 主进程 | 要一份状态 |
| `yanuo.telemetry/state` | 主进程 → 主窗口 | 状态 `{ device, session, off }`：设备标识、会话标识、不发送的原因 |

组件数据(`component-data/yanuo.telemetry.json`)只有一个键：`device` 是读不到 MachineGuid 时用的随机设备标识；读得到时什么都不存。

## 接收端

接收端不在这个仓库里。程序对它只有一个约定：

- 一个 https 地址，收 `POST`，`content-type: application/json`，请求体是上面那样的 JSON 数组。
- 收下回 2xx，回什么内容程序不看；别的状态码算没收下。
- 不要记请求的 IP。

在线数是最近 10 分钟里出现过的不同 `device` 的个数，日活、月活是一天、一个月里不同 `device` 的个数；同一个 `session` 最后一条和第一条的时间差是那一次的在线时长。

换接收地址(改 `src/endpoint.ts`)要升组件的版本号，已装的程序才会在启动时换上新地址的那一份。

## 测试

`test/telemetry.test.ts`：设备标识的计算、`whyOff` 的每个原因和顺序、状态的收窄、心跳的间隔、POST 的内容和失败，接收地址的格式，以及装上组件后的几条：按间隔发心跳并把状态给主窗口、开关关着和另外三种情况不发、发不出去只记一行日志、读不到 MachineGuid 时用存着的随机标识。

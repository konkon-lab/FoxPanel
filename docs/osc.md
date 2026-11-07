# OSC 服务

和 VRChat 之间的 OSC 收发由预装服务组件 `yanuo.osc` 做：它提供 `osc` 服务，别的主进程组件用这个服务订阅 VRChat 发来的地址、往 VRChat 发消息。这篇讲发送、接收、OSCQuery、转发、状态栏，以及用它发消息的聊天框输出。

## 组成

| 组件 | 类别 | 位置 | 做什么 |
|---|---|---|---|
| `yanuo.osc` | `service`，`provides: ["osc"]` | `components/osc/` | 收发、OSCQuery、转发、状态栏的 OSC 一项 |
| `yanuo.chatbox` | `output`，`requires: ["osc"]` | `components/chatbox/` | 把发送的文字发到 VRChat 聊天框 |

OSC 组件的源码：

| 文件 | 内容 |
|---|---|
| `components/osc/src/main.ts` | 入口：读设置、提供 `osc` 服务、按订阅和转发开关接收、上报状态栏 |
| `components/osc/src/link.ts` | `OscLink`：一次接收(UDP 套接字、OSCQuery 的 HTTP 说明和 mDNS 广播) |
| `components/osc/src/codec.ts` | 编解码：用 `node-osc` 的 `encode` / `decode`，结果收窄成 `{ address, args }` |

两个组件都跑在共用的组件进程里。Cordis 服务只在同一个进程里能 `inject`，所以用 `osc` 的组件也要在共用进程里(清单不写 `process: own`)。服务的声明和使用方式见 [SDK](sdk.md) 的「提供和使用服务」。

## 设置

OSC 组件的设置(清单 `config`，在组件页改)：

| 键 | 名字 | 默认 | 说明 |
|---|---|---|---|
| `mode` | 接收方式 | `oscquery` | `oscquery`：OSCQuery，VRChat 自动发现；`fixed`：固定端口 |
| `port` | 接收端口 | 9001 | 固定端口模式下监听的端口，1–65535；`mode` 为 `fixed` 时才显示 |
| `sendPort` | 发送端口 | 9000 | 发往 VRChat 的端口，1–65535 |
| `forward` | 转发 | `false` | 把收到的包原样发给别的 OSC 程序 |
| `forwardPorts` | 目标端口 | `[]` | 转发到的本机端口列表，每个 1–65535；`forward` 开着时才显示 |

设置在组件加载时读一次；设置变了组件重新加载，用 `osc` 的组件跟着重新生效。端口值不是 1–65535 的整数时，接收端口按 9001、发送端口按 9000，转发列表里不合格和重复的项丢掉。

聊天框没有自己的设置，发到哪个端口由 OSC 组件的 `sendPort` 决定。

## osc 服务

```ts
ctx.osc.on(address, (...args) => { … });   // 订阅一个地址，返回取消函数
ctx.osc.send(address, args);               // 发往 VRChat
```

- 参数只有三种：字符串、布尔、数字(`OscArg`，类型在 `sdk/index.ts`)。
- `on` 的地址按整串比较，没有通配。同一个地址可以有多个订阅，各收各的；一个订阅的回调抛出异常时记一条错误日志，别的订阅照常收到。
- 组件没开时没有这个服务：清单写了 `requires: ["osc"]` 的组件不加载；可有可无地用它时写 `ctx.inject(['osc'], …)`。

## 发送

`send` 把一条消息编码后用 UDP 发到 `127.0.0.1:<sendPort>`。VRChat 和转发目标都在本机，组件不往别的主机发。

| 参数 | OSC 类型 |
|---|---|
| 字符串 | string |
| 布尔 | true / false |
| 整数 | int32 |
| 小数 | float32 |

每次 `send` 记一个时间，状态栏据此显示最近一小时发出的消息数。转发出去的包不计入。

## 接收

### 什么时候开

有任一地址被订阅、或转发开着且有目标端口时开接收；两样都没有时关掉。开和关排队执行，同一时刻只有一次在进行。组件卸载时关掉接收，随后关发送用的套接字。

接收开不起来(比如固定端口被别的程序占着)时每 10 秒重试；同一个错误连续出现只记一次日志。

### OSCQuery

VRChat 靠 OSCQuery 找到要发给谁，不需要占用 9001，可以和别的 OSC 程序同时开着：

| 部分 | 做法 |
|---|---|
| UDP | 绑 `127.0.0.1` 的随机端口，收 OSC 包 |
| HTTP | 绑 `0.0.0.0` 的随机端口(mDNS 广播的地址是本机网卡的 IP，所以监听所有网卡)，回 JSON |
| mDNS | 用 `bonjour-service` 广播两个服务：`_oscjson._tcp`(HTTP 端口)、`_osc._udp`(UDP 端口) |
| 名字 | `FoxPanel-` 加 6 位随机十六进制，每次开接收重新生成 |

HTTP 的回答：

- 网址里带 `HOST_INFO` → `{ NAME, OSC_IP: "127.0.0.1", OSC_PORT: <UDP 端口>, OSC_TRANSPORT: "UDP", EXTENSIONS: { ACCESS: true, VALUE: true } }`。
- 其余请求 → 参数树：根 `/`(`ACCESS: 0`)下只有一个 `/avatar` 节点(`ACCESS: 2`)。

### 固定端口

绑 `127.0.0.1:<port>`，没有 HTTP 和 mDNS。VRChat 默认把 OSC 发到 9001，所以默认值是 9001；这个端口同一时刻只能有一个程序收。

### 收到一个包

1. 记下收到的时间(状态栏判断「接收中」)。
2. 原包交给转发。
3. 读包开头的地址，不解码参数：既不是 bundle、又没人订这个地址的包到此为止。
4. 解码；bundle 展开成消息列表(嵌套的也展开)。解不出来的坏包丢掉。
5. 每条消息的地址有人订才交给订阅的回调。参数里只留字符串、布尔、有限的数字，别的类型丢掉。

## 转发

`forward` 开着时，收到的每个 UDP 包原样(不解码、不改)发到 `127.0.0.1` 的每个目标端口，给只会监听固定端口的 OSC 程序用。只开转发、没有组件订阅时接收也开着。

## 状态栏

组件每 2 秒上报一次状态栏里的 `OSC` 一项(`ctx.status`，状态栏的显示见 [主窗口](main-window.md))：

| 灯 | 状态文字 | 条件 |
|---|---|---|
| 灰 | 没有组件用到 | 接收没开 |
| 黄 | 等待 VRChat | 接收开着，最近 3 秒没收到包 |
| 绿 | 接收中 | 最近 3 秒内收到过包 |

名字后面的数是 `↑ N/H`：最近一小时 `send` 发出的消息数。悬停卡片里三行：

| 行 | 值 |
|---|---|
| 接收 | `OSCQuery <端口>` / `固定端口 <端口>`；接收没开时 `—` |
| 发送 | `127.0.0.1:<sendPort>` |
| 消息 | `↑ N/H` |

运行日志里的行：`receiver on oscquery <端口>` / `receiver on fixed port <端口>`、`receiver stopped`、`cannot start receiver: <原因>`。

## 聊天框输出

`components/chatbox/src/main.ts` 用 `ctx.output.register` 登记成一个输出(输出的登记和「发送到」见 [组件进程](component-process.md)，什么时候发送、自动送出和 PIN 见 [输入法](input-method.md))，声明 `live: true`，所以也收自动送出和 PIN 的实时内容。

| 回调 | OSC 消息 | 说明 |
|---|---|---|
| `send({ text, spoken, notify })` | `/chatbox/input` `[文字, true, notify]` | 第二个参数 `true` = 立即显示，不进 VRChat 的输入框；第三个是提示音 |
| `typing(on)` | `/chatbox/typing` `[on]` | 「正在输入」的气泡 |
| `clear()` | `/chatbox/input` `["", true, true]` | 发空文字清掉聊天气泡 |

显示的文字(`components/chatbox/src/text.ts` 的 `chatboxText`)：

- 译文和原文相同(没翻译)时只发原文；不同时发「原文（译文）」，括号是全角。
- 超过 144 个字符(按 Unicode 码点数)的部分截掉；144 是 VRChat 聊天框单条消息的上限。

每次发送在运行日志里记一行 `sent: <文字>`。

VRChat 要在动作菜单 → 选项 → OSC 里启用 OSC 才会收。

## 别的用法

预装的听写组件用 `ctx.inject(['osc'], …)` 订阅 `/avatar/parameters/MuteSelf`，跟随 VRChat 的静音键开关听写，见 [语音合成、听写、翻译](voice.md)。

## 测试

| 文件 | 内容 |
|---|---|
| `test/osc.test.ts` | 编解码：float、bool、bundle、聊天框消息、包开头的地址 |
| `test/vrosc-osc-link.test.ts` | 接收的过滤和转发、端口被占时的失败和重试、有订阅才开接收、卸载时关掉 |
| `test/chatbox.test.ts` | 聊天框文字：原文、原文（译文）、截断 |

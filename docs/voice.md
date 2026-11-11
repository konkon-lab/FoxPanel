# 语音合成、听写、翻译

发送时朗读、按听写按钮说话进输入框、发送前翻译，由三个预装组件提供，都接阿里云百炼。这篇讲三个组件的设置、流程和数值，以及它们在媒体页面里怎么播放和用麦克风。

## 三个组件

| 组件 | id | kind | 入口 | 装上时 | 做什么 |
|---|---|---|---|---|---|
| 语音合成 | `yanuo.tts-bailian` | `output` | `main` + `page` | 关着 | 发送时把译文用 CosyVoice 合成 mp3，播放到选定的设备 |
| 语音输入(听写) | `yanuo.asr-bailian` | `input` | `main` + `page` | 开着 | 接管听写按钮：采集麦克风，用 Fun-ASR 实时识别，半句显示、整句插入 |
| 翻译 | `yanuo.mt-bailian` | `translator` | `main` | 关着 | 发送前把原文用 Qwen-MT 翻译成目标语言 |

三个组件的清单都写 `requires: ["aliyun"]`：阿里云组件(`yanuo.aliyun`)关着或没装时它们不加载。`main` 部分跑在组件进程([组件进程](component-process.md))，`page` 部分跑在媒体页面。

接口代码三个组件共用，放在 `components/_bailian/`，打包时内联进各组件：

| 文件 | 内容 |
|---|---|
| `account.ts` | 从设置里取密钥和接口地址；记一笔用量 |
| `endpoints.ts` | 接入域名 → 合成、识别、翻译的接口地址 |
| `tts.ts` | CosyVoice 流式合成(SSE 分事件、帧解析、自定义音色选模型) |
| `asr.ts` | Fun-ASR 实时识别(WebSocket 会话、消息解析、断线重连) |
| `translate.ts` | Qwen-MT 翻译(请求体、取译文、取 Token 用量) |
| `pcm.ts` | 听写音频的格式常量，媒体页部分和主进程部分都按它 |
| `pricing.ts` | 单价和计费函数，见 [用量和费用](usage.md) |

单元测试在 `test/bailian*.test.ts`。

## 密钥和接口地址

密钥和域名是阿里云组件的设置(`components/aliyun/component.json`)，核心把它们并进三个组件主进程部分的 `ctx.config`(规则见 [组件管理](component-manager.md))；媒体页部分拿不到密钥。

| 设置 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `apiKey` | 密钥，`share: "aliyun-bailian"` | 空 | 百炼 API Key |
| `domain` | 文字 | `dashscope.aliyuncs.com` | 接入域名 |

域名取用前去掉首尾空白、协议头和路径并转小写，空的用默认域名。三个接口地址：

| 用途 | 地址 |
|---|---|
| 合成 | `https://<域名>/api/v1/services/audio/tts/SpeechSynthesizer` |
| 识别 | `wss://<域名>/api-ws/v1/inference` |
| 翻译 | `https://<域名>/compatible-mode/v1/chat/completions` |

请求都带 `Authorization: Bearer <密钥>`。没填密钥时不发请求，组件日志里写 `bailian api key not set`：合成跳过这一句，听写马上结束，翻译按失败处理(用原文发送)。

## 语音合成

### 设置

| key | 控件 | 默认 | 说明 |
|---|---|---|---|
| `model` | 下拉，可直接输入 | `cosyvoice-v3-flash` | 选项：`cosyvoice-v3-flash`、`cosyvoice-v3-plus`、`cosyvoice-v3.5-flash`、`cosyvoice-v3.5-plus` |
| `voice` | 下拉，可直接输入 | `longhua_v3` | 系统音色 20 个(名字 · 描述)，后面接自定义音色 |
| `customVoices` | 多行表格 | 空 | 每行 `name`(名字)、`id`(音色 ID)、`model`(模型，可空)；填好的列进音色下拉 |
| `outputDevice` | 音频输出设备 | 系统默认 | 播放到哪个设备 |
| `monitor` | 开关 | 开 | 本地监听：同时在监听设备上播放一份 |
| `monitorDevice` | 音频输出设备 | 系统默认 | 监听设备 |

当前音色是 `customVoices` 里填了 `model` 的那一行时，用那一行的模型合成；否则用 `model`。

清单的 `dashboard` 把 `voice`、`outputDevice`、`monitor`、`monitorDevice` 放成仪表盘上的「语音」卡(右列)。

### 流程

主进程部分 `components/tts-bailian/src/main.ts`，媒体页部分 `components/tts-bailian/src/page.ts`，两边之间的频道在 `components/tts-bailian/src/channels.ts`。

1. 主进程部分登记成输出(`ctx.output.register`)，只收发送，不收自动送出和 PIN 的实时内容。收到发送时取 `spoken`(译文，没翻译时等于原文)，去掉首尾空白，空的跳过。
2. 合成排队，一次一句。一句超过 500 字(`TTS_MAX_CHARS`)时报错不合成。
3. 向合成地址发 POST(请求头 `X-DashScope-SSE: enable`)，请求体是 `{ model, input: { text, voice, format: "mp3", sample_rate: 24000 } }`。响应是 SSE：每个事件里的 base64 音频片段按顺序拼成一段 mp3，`finish_reason` 为 `stop` 的事件表示结束。
4. 连续 15 秒没收到数据算超时。没有音频、没有结束标记、事件里带 `code` / `message`、HTTP 状态不是 2xx 都算失败；响应里有 `error code: 418` 时报「音色不能用于这个模型」。失败写进组件日志(`synthesize failed: …`)，后面的句子照常合成。
5. 合成成功后按计费字符记一笔用量(接口返回的 `usage.characters`，没返回时按字数)，然后把整段 mp3(`Uint8Array`)经总线频道 `yanuo.tts-bailian/play` 发给媒体页部分。
6. 媒体页部分排队播放，一次一句：用 `Audio` 播放到 `outputDevice`(`setSinkId`，空 = 系统默认)；`monitor` 开着且 `monitorDevice` 和 `outputDevice` 不同时，同一段同时在监听设备上播放，两边都播完才播下一句。两个设备相同时只播一份。播放失败写进组件日志(`play failed: …`)。

## 听写

### 设置

| key | 控件 | 默认 | 说明 |
|---|---|---|---|
| `model` | 下拉，可直接输入 | `fun-asr-realtime` | 识别模型 |
| `language` | 下拉 | `zh` | 识别语言：`zh` 中文、`en` 英语、`ja` 日语 |
| `micDevice` | 音频输入设备 | 系统默认 | 麦克风 |
| `followMute` | 开关 | 开 | 跟随 VRChat 静音键，见下 |
| `sendEach` | 开关 | 关 | 说完一句直接发送 |

### 音频格式

`components/_bailian/pcm.ts`：单声道 16 位 PCM，采样率 16000 Hz，每帧 100 毫秒(1600 个采样、3200 字节)，每秒 32000 字节。

### 流程

主进程部分 `components/asr-bailian/src/main.ts`，媒体页部分 `components/asr-bailian/src/page.ts`。两边之间的总线频道(`components/asr-bailian/src/channels.ts`)：

| 频道 | 方向 | 数据 |
|---|---|---|
| `yanuo.asr-bailian/mic` | 主进程 → 媒体页 | `true` 开麦克风，其他值关 |
| `yanuo.asr-bailian/pcm` | 媒体页 → 主进程 | 一帧 PCM |
| `yanuo.asr-bailian/error` | 媒体页 → 主进程 | 麦克风打不开的原因 |

1. 主进程部分登记成输入源(`ctx.input.register`)。有输入源登记时输入状态的 `canDictate` 为真，听写按钮才起作用；有多个输入源时用组件顺序最前的。
2. 按下听写按钮调 `start`：开一次识别会话，让媒体页部分开麦克风。
3. 媒体页部分用 `getUserMedia` 打开 `micDevice`(单声道，开回声消除和降噪)，在 16000 Hz 的 `AudioContext` 里用 AudioWorklet 把浮点采样转成 16 位 PCM，攒满一帧发回主进程部分。开和关排成一队依次做。麦克风打不开时把原因发回去，主进程部分写日志(`cannot open microphone: …`)并结束听写。
4. 识别会话(`AsrStream`)连上识别地址后发 `run-task` 指令：`format: "pcm"`、`sample_rate: 16000`、`language_hints: [语言]`、`max_sentence_silence: 400`(停顿 400 毫秒算一句结束)、`semantic_punctuation_enabled: false`、`heartbeat: true`。收到 `task-started` 后开始发音频帧；在这之前的帧先缓存，最多 50 帧(5 秒)，超出的丢掉最早的。
5. 服务端的 `result-generated` 消息带一句的文字和是否说完(`sentence_end`)：没说完的发 `dictated(text, false)`，显示在输入框光标处；说完的发 `dictated(text, true)`，插入输入框。都经远程服务 `keyboard` 发(`ctx.relay.use('keyboard').tell(…)`，清单写 `uses: ["keyboard"]`)；输入法组件只收登记了听写的输入源发来的听写结果。心跳消息忽略。
6. `sendEach` 开着时每说完一句紧接着发一次「发送」操作，这一句经翻译后交给开着的输出。
7. 再按听写按钮调 `stop`：关麦克风、断开识别、把还没记的识别时长记进用量。组件卸载时也这样停下。

连接断开而听写还开着时，隔 1 秒重连；连续 5 次连接都没进入 `task-started` 就放弃：写日志、关麦克风、发 `dictationEnded` 让键盘结束听写。`task-failed` 的原因写进组件日志(`recognize: …`)，然后断开这条连接，按上面的规则重连。

用量按实际发给服务端的音频字节算时长(缓存里被丢掉的不算)，累计满 10 秒记一笔，停下时记余下的。

### 跟随 VRChat 静音键

`followMute` 开着且有 `osc` 服务时，听写组件订阅 VRChat 的 `/avatar/parameters/MuteSelf`(值为 `true` 或 `1` 表示静音)：

| VRChat | 键盘正在听写 | 动作 |
|---|---|---|
| 取消静音 | 否 | 开始听写 |
| 静音 | 是 | 停止听写 |
| 其他情况 | | 不动 |

开始和停止发的是和听写按钮一样的「听写」操作，手动按按钮照常能用。订阅用 `ctx.inject(['osc'], …)`，OSC 组件关着时这一项不生效，听写的其他部分不受影响。订阅存在时 OSC 组件才开接收，见 [OSC 服务](osc.md)。

`followMute` 和 `sendEach` 都开着时：在 VRChat 里取消静音说话，每句识别出来就发送。

## 翻译

### 设置

| key | 控件 | 默认 | 说明 |
|---|---|---|---|
| `model` | 下拉，可直接输入 | `qwen-mt-flash` | 选项：`qwen-mt-flash`、`qwen-mt-plus`、`qwen-mt-lite`、`qwen-mt-turbo` |
| `target` | 下拉 | `Japanese` | 目标语言(值是英文名)：Japanese、English、Chinese、Korean、Traditional Chinese、Cantonese、French、German、Spanish、Russian |

清单的 `dashboard` 把 `target`、`model` 放成仪表盘上的「翻译」卡(右列)，标题旁带组件开关。

### 流程

`components/mt-bailian/src/main.ts`：

1. 登记翻译函数(`ctx.translator.register`)。输入法组件在发送、自动送出、PIN 之前调它(见 [输入法](input-method.md))；翻译类别同时只开一个，没有翻译组件时原文直接当译文。
2. 原文去掉首尾空白；空的原样返回。最近 50 句的译文有缓存(原文 → 译文，满了删最早放进去的)，命中的直接返回，不发请求、不记用量。
3. 向翻译地址发 POST，请求体是 `{ model, messages: [{ role: "user", content: 原文 }], translation_options: { source_lang: "auto", target_lang: 目标语言 } }`，源语言自动识别。一次请求最多等 15 秒。
4. 译文取响应的 `choices[0].message.content`；HTTP 状态不是 2xx、响应不是 JSON、没有译文都抛出错误，原因写进组件日志(`request failed: …`)。
5. 成功后按响应里的 `prompt_tokens`、`completion_tokens` 记一笔用量，译文放进缓存。

宿主一侧等翻译结果最多 15 秒(`src/main/components/host.ts` 的 `TRANSLATE_MS`)。翻译出错或超时时这一句用原文发送。

输出组件收到的 `spoken` 就是译文：聊天框显示「原文（译文）」(见 [OSC 服务](osc.md))，语音合成读译文。

## 媒体页面里的播放和麦克风

播放音频和打开麦克风要在浏览器环境里做，所以语音合成和听写各有一个 `page` 入口，跑在媒体页面：一个不显示的窗口，专门跑输出、输入源、翻译组件的页面代码。窗口什么时候开和重载、麦克风权限、页面里有哪些服务见 [面板页面](panel-page.md#媒体页面)，和这三个组件有关的几点：

- 页面部分和主进程部分只经 `ctx.bus` 往来：合成好的 mp3 从组件进程发到页面，PCM 帧从页面发到组件进程，都由核心转发。这些频道以各自的组件 id 开头，只有媒体页面(加载了这个组件)登记得了、收得到；面板页面登记不了别的组件的频道，听不到麦克风的音频和合成的语音。
- 页面部分拿到的 `ctx.config` 只有组件自己的设置，不含密钥和阿里云组件的设置。
- 改了语音合成或听写的设置、开关了这类组件时页面重载，正在播放的声音和开着的麦克风随之停下；面板页面重载(换皮肤、换布局)不影响它。
- 窗口不显示时播放和采集照常进行；SteamVR 没开时也在。

## 用量

三个组件每次调用都经阿里云组件提供的 `usage` 服务记一笔，记什么、单价多少、在哪里显示见 [用量和费用](usage.md)。

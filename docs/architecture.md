# 总体结构

FoxPanel 是可拔插的桌面组件平台，Electron 应用：核心不带具体功能，VR 悬浮面板、OSC 收发、外部设备都由组件接入，任何组件都能提供自己的面板，键盘和输入法是预装的一块面板。核心只做加载器、配置存取、安全边界、特权能力的 API 和公共底座，面板、把面板显示进 VR 的显示方、输入法、输出、主窗口的每一页都是组件。这篇讲面板这一套概念、核心和组件怎么分工、组件代码跑在哪些进程和页面里、它们之间怎么往来、源码放在哪。

## 面板和显示方

| 概念 | 是什么 | 归谁 |
|---|---|---|
| 面板 | VR 里的一块网页面。组件在清单里写 `panel` 字段就提供一块，一个组件最多一块，面板 id 就是组件 id | 声明归组件；组件在用，面板就在面板目录里 |
| 面板目录 | 在用的组件声明的全部面板(名字、图标、像素尺寸、默认宽度等)，纯数据 | 核心从清单算，推给主进程组件(`ctx.panels.list`) |
| 面板页面 | 核心为一块面板开的页面，地址 `fox://<面板 id>.panel/panel.html`，加载面板页面宿主 | 核心(`src/main/panels.ts`、`src/panel/`) |
| 根组件 | 铺满面板页面的那个组件，入口是清单的 `panel.page` | 组件 |
| 部件 | 挂进根组件插槽(`data-slot`)的组件：类别名等于插槽名的 `candidates`、`textfield`、`layout`、`sidepage`、`sidebutton` | 组件；核心只把名字当插槽名 |
| 显示方 | 把面板页面显示出来并处理交互的主进程组件，提供远程服务 `panels`：每块面板开没开、在哪(留在空间里，或附着在头显、手柄上)、多宽、锁没锁都归它(它的布局，存在它自己的组件数据里)；同时显示几块、快捷位指向哪块面板、手柄上的选项是它自己的设置。同名的提供者里组件顺序最前的在用的那个生效，其余的等着：不开页面、不显示。预装一个：SteamVR | 组件 |
| 面板外观 | 深色 / 浅色，全部面板共用一个开关 | 核心设置 `panels.dark` |

三层开关互不混：组件开关(核心的 `config.json`) → 面板打开 / 收起(显示方的布局) → 页面在不在、画不画(核心按显示方的要求)。面板进目录时算打开，跟着显示方的总开关一起显示；想让一块面板不出现，就在组件页关掉它的组件。程序里没有单独管理面板的界面。

- 核心不主动开面板页面：生效的显示方用 `ctx.panels.open(面板 id)` 要核心开，核心离屏渲染这一页，把每一帧的 GPU 共享纹理交给它；预装的 SteamVR 组件把每块显示着的面板各贴成一块悬浮窗口(留在空间里，或跟着头显、手柄走；附着在手上的可以抬手才显示)，把手柄的指点换成页面的鼠标事件，用手柄抓住移动和缩放(见 [SteamVR 悬浮面板](steamvr.md))。
- 页面的寿命不跟显示方走：显示方的进程退出或它停用时页面停画并保留一段时间，期间再来开的接回原页面，页面里的状态还在(见 [组件进程](component-process.md#面板页面))。
- 键盘是其中一块面板：经典外壳是根组件，候选栏、输入框、键区、侧栏是部件，输入状态来自输入法组件提供的远程服务 `keyboard`(见 [面板页面](panel-page.md#键盘面板))。
- 写一块面板见 [写一个组件](develop.md#二写一块面板)。

## 核心和组件

核心是主进程(`src/main/`)加上各运行环境里的宿主代码(`src/component-host/`、`src/panel/`、`src/renderer/`)，只有五块：

| 部分 | 内容 | 源码 |
|---|---|---|
| 加载器 | 扫描和校验清单、预装同步、安装和卸载、开发文件夹监视；开关、顺序、按 `provides` / `requires` 解析依赖；把组件装进组件进程、面板页面、媒体页面、主窗口这几种运行环境，组件变了重载、进程崩了重启 | `src/main/components/`、`src/shared/manifest.ts` |
| 配置的存取 | 读写 `config.json`；组件的设置按清单的 Schema 补默认值、校验、夹在范围内 | `src/main/settings.ts`、`src/main/components/settings.ts`、`src/shared/schema.ts` |
| 安全边界 | 见「安全边界」 | `src/main/senders.ts`、`src/main/ipc.ts` |
| 特权能力的 API | 只有 Electron 主进程能做的事：窗口、面板页面(离屏渲染、把帧交给显示方)、主题和缩放、托盘、原生对话框、打开文件夹或网址、数据文件夹的目录浏览、剪贴板、以管理员身份重启、退出、更新程序本体、Windows 安全验证。只给能力，界面和策略在组件 | `src/main/window.ts`、`panels.ts`、`panel-window.ts`、`desktop.ts`、`datadir.ts`、`updater.ts` |
| 公共底座 | 每个运行环境的 Cordis 根上下文和宿主服务；运行环境之间的总线、组件数据、远程服务的通道；应用信息和主进程组件的通用请求(发给输出、听写、翻译、开关输出组件、剪贴板)；运行日志的内存缓冲和分发；界面语言和面板外观；共享库；崩溃转储 | `src/main/relay.ts`、`app.ts`、`page-bus.ts`、`logs.ts`、`src/shared/component-services.ts` |

核心里没有输入法、没有键盘的页面、状态和操作、没有面板的摆放和布局、没有 OpenVR、没有 OSC、没有主窗口的页面，也不认识任何一个组件或面板的 id。键盘的状态和操作由输入法组件经远程服务 `keyboard` 发布和接收(约定的类型在 `sdk/keyboard.ts`，核心的源码不引用它)；远程服务的状态和参数、布局 JSON、清单的 `ime` 字段这些内容核心只转交，格式由对应的组件校验。

其余都是组件。预装的组件放在 `components/`(id 为 `yanuo.<文件夹名>`)，列表、默认顺序和默认分组在 `components/preinstalled.json`；它们和别的组件用同一套接口，同样能关、能卸载。

| 分组 | 预装组件 | 做什么 |
|---|---|---|
| basic | `shell-classic`、`candidates`、`textfield`、`keys`、`layout-d68` | 键盘面板的根组件(经典外壳)、候选栏、输入框、按键渲染、D68 布局 |
| sidebar | `side-quick`、`side-numpad`、`side-symbols`、`button-paste`、`button-theme` | 侧栏页(快捷设置、小键盘、特殊符号)和侧栏按钮(粘贴、日夜切换) |
| lang | `lang-zh`、`lang-en`、`lang-ja`、`lang-ko` | 拼音、英文、日文、韩文 |
| service | `ime`、`steamvr`、`osc`、`aliyun`、`telemetry` | 输入法和键盘流程、显示方(SteamVR 悬浮面板)、OSC 收发、百炼密钥和用量账本、在线统计(见 [在线统计](telemetry.md)) |
| output | `chatbox`、`tts-bailian`、`asr-bailian`、`mt-bailian` | VRChat 聊天框、语音合成、听写、翻译 |
| console | `window-shell`、`window-dashboard`、`window-components`、`window-market`、`window-packages`、`window-deps`、`window-logs`、`window-settings` | 主窗口的外壳和各页 |

## 组件的类别和形式

组件是一个带 `component.json` 清单的文件夹，清单的 `kind` 是类别(13 种，见 [组件格式](components.md))。一个组件可以同时有下面几种形式：

| 形式 | 清单字段 | 内容 | 怎么生效 |
|---|---|---|---|
| 纯数据 | `layout`、`skin`、`ime` | 布局 JSON、皮肤 css、语言(模式、rime 方案和词库) | 不运行代码：布局 JSON 交给按键渲染，皮肤 css 由面板页面加载，语言交给输入法组件 |
| 页面代码 | `panel.page`、`page`、`window` | ES 模块，默认导出 Cordis 插件 | 跑在面板页面、媒体页面或主窗口里(浏览器环境) |
| 主进程代码 | `main` | ES 模块，默认导出 Cordis 插件 | 跑在组件进程里(Node，完整权限) |

各运行环境加载什么由类别和入口决定(`src/main/components/store.ts`)：

| 运行环境 | 加载 |
|---|---|
| 面板页面(每块面板一页) | 这块面板的根组件(`panel.page`)；清单 `panel.slots` 里各插槽的部件(`candidates`、`textfield`、`layout`、`sidepage`、`sidebutton` 组件的 `page`，没有 `page` 的布局组件的布局 JSON)；它们要用的服务组件的 `page`；在用的皮肤的 css |
| 媒体页面 | `output`、`input`、`translator` 组件的 `page` |
| 组件进程 | 有 `main` 的组件，不分类别 |
| 主窗口 | `window` 组件的 `page`，其他类别组件的 `window` |
| 输入法组件 | 语言组件：从应用信息(`ctx.app.info.components`)里读已装的目录和清单、在用的顺序 |

只加载「在用」的组件：没被关掉；只能开一个的类别(`candidates`、`textfield`、`layout`、`skin`、`translator`)取组件顺序最前的那个；`requires` 里的每个服务都有在用的组件在 `provides` 里声明(提供者自己因为缺服务不算在用时，要它的组件也不算)。各运行环境拿到的列表里每个组件带什么，见 [组件管理](component-manager.md#开着的组件)。

组件内核是 [Cordis](https://github.com/cordiverse/cordis)(锁定 `cordis@4.0.0-rc.12`)：每个运行环境有一个根 `Context`，每个加载的组件是 `root.extend({ 这个组件自己的服务 }).plugin(入口, 设置)` 得到的一个 fiber，卸载 = `fiber.dispose()`，组件登记的监听和服务随之清理。宿主给组件的服务见 [SDK](sdk.md)，从零写一个组件见 [写一个组件](develop.md)。

## 进程和页面

```
主进程(dist/main.js)
├─ 组件进程(utilityProcess，dist/component-host.js)
│   ├─ 共用进程：没写 process 的主进程组件都在这一个里
│   └─ 独立进程：清单写 "process": "own" 的组件各一个(预装的输入法、SteamVR)
├─ yarn 进程(utilityProcess，dist/yarn-host.cjs)：从 npm 装、卸组件时才有
├─ 主窗口          fox://host/window/index.html
├─ 面板页面        fox://<面板 id>.panel/panel.html(每块开着的面板一页；离屏窗口)
└─ 媒体页面        fox://host/media.html(隐藏窗口)
```

| | 是什么 | 宿主代码 | 细节 |
|---|---|---|---|
| 主进程 | 装配各部分、注册 IPC、开窗口、起组件进程 | `src/main/main.ts` | 本篇 |
| 组件进程 | 跑主进程组件；Cordis 根上下文和 `ctx.relay`、`ctx.app`、`ctx.panels`、`ctx.output`、`ctx.storage`、`ctx.bus` 等服务 | `src/component-host/main.ts`，宿主端 `src/main/components/host.ts`、`hosts.ts` | [组件进程](component-process.md) |
| 面板页面 | 一块面板的根组件、插槽里的部件、弹层；VR 里看到的每块面板各是这样一页 | `src/panel/main.ts`，核心一侧 `src/main/panels.ts`、`panel-window.ts` | [面板页面](panel-page.md) |
| 媒体页面 | 输出、输入源、翻译组件的页面代码：播放音频、打开麦克风；没有插槽 | `src/panel/media.ts` | [面板页面](panel-page.md#媒体页面)、[语音合成、听写、翻译](voice.md) |
| 主窗口 | 无边框窗口；宿主只做主题、加载组件、跳转和文案表，外壳和各页都是组件 | `src/renderer/` | [主窗口](main-window.md) |

- 面板页面不由核心主动打开：生效的显示方经 `ctx.panels.open` 让核心开，没有显示方时一页都不开。未打包的程序带环境变量 `FOXPANEL_PANELS=1` 启动时加载开发用的显示方(`dev/display-desktop/`，只给开发和自动检查用；判断在 `src/main/dev.ts`)，它排在别的显示方前面、是生效的那个(SteamVR 组件这时等着)，把每块显示着的面板开成一个普通窗口，见 [写一个组件](develop.md#不用-steamvr-调试面板)。
- 媒体页面在有组件要它时才开，没有时关掉。
- 输入法的 rime 引擎在输入法组件进程里的工作线程，见 [输入法](input-method.md)。
- 页面没有 Node 权限，preload 把主进程的 IPC 封装成 `window.fox`。主窗口用 `src/preload/preload.ts`(接口 `FoxApi`)；面板页面和媒体页面用窄的那一份 `src/preload/page.ts`(接口 `PageApi`，只有取计划和外观、换深色、收起自己、组件数据、总线、写日志、远程服务)。两份接口和全部 IPC 通道名(`IPC`、`PAGE_IPC`)定义在 `src/shared/types.ts`。
- 能调哪些由主进程决定：每个窗口建好、加载地址之前登记成主窗口、媒体页面或面板页面(`src/main/senders.ts`)，页面发来的 IPC 都经 `src/main/ipc.ts` 注册，每个通道哪几种页面能调写在它的 `POLICY` 里，见「安全边界」。
- 主进程和组件进程之间用 `parentPort` 传消息，格式在 `src/shared/host-protocol.ts`。

### 主进程的启动和退出

`src/main/main.ts` 的 `boot()` 依次做：

1. 开崩溃转储(只存本地)，子进程退出和未捕获的异常写进运行日志。
2. 读 `config.json`(`src/main/settings.ts`)。设置了以管理员身份运行而这一份没有管理员权限时，以管理员身份另起一份并退出；用户拒绝 UAC 时以普通权限继续。
3. 主题跟设置，给会话装上限制(权限白名单、取消下载)。
4. 建好面板页面、组件管理、远程服务、应用信息、组件进程、更新这几部分并互相接上。
5. 组件管理启动：同步预装组件、准备组件项目、扫描组件目录；按在用的组件算出面板目录。
6. 注册 `fox://` 协议的处理，按当前的组件起组件进程和媒体页面。
7. 注册 IPC，开主窗口。
8. 每 2 秒把 CPU、内存和组件上报的状态栏项推给主窗口；开着自动检查更新时 10 秒后检查一次。

程序是单实例的，再次启动只把主窗口显示到前面。主窗口关掉(不是关到托盘)就退出：停定时器、托盘、面板页面、组件管理、组件进程、媒体页面。

### fox:// 协议和共享库

页面和页面组件都从 `fox://` 加载(`src/main/components/protocol.ts`)：`fox://host/<路径>` 和 `fox://<面板 id>.panel/<路径>` 都是 `dist/host/` 下的宿主页面和共享库(每块面板用自己的主机名，各是一个源)，`fox://component/<id>/<路径>` 是组件文件夹里的文件，规则见 [组件管理](component-manager.md#fox-协议)。

宿主和组件用同一份库：页面的 import map 把模块名指到 `dist/host/lib/` 下的文件，组件打包时不把它们打进去(`src/shared/libs.ts`)。

| 运行环境 | 共享的模块 |
|---|---|
| 面板页面、媒体页面 | `vue`、`cordis` |
| 主窗口 | `vue`、`naive-ui`、`@lucide/vue`、`cordis`、`@konkon-lab/foxpanel-window` |
| 组件进程 | `cordis`、`koffi`(模块解析钩子指到程序自带的那份) |

`@konkon-lab/foxpanel-window`(`src/renderer/window-api.ts`，导出的名字在 `src/shared/window-api.ts`)是主窗口给组件的宿主数据和函数：`store`、`fox`、`t`、`nav`、`windows` 等。别的依赖由组件自己打进入口文件。

### 组件变了之后

开关、排序、改设置、安装、卸载之后，组件管理(`src/main/components/manager.ts`)保存配置，重新算出各运行环境要加载的组件，各运行环境只动变了的部分，程序不重启：

- 面板页面：每块面板各有一份计划(根组件、各插槽的部件、服务、皮肤、够得着的远程服务，连同各自的设置和入口文件的修改时间)，哪一页的计划变了只重载那一页；面板不在目录里了，它的页面销毁。界面语言和深色不在计划里，变了不重载，页面的外观跟着换。
- 媒体页面：自己的计划有变化才整页重载。
- 组件进程：只卸载、加载、重载变了的组件，进程不重启。
- 主窗口：只有某些组件的设置变了时只重新加载这几个组件，组件增减、顺序或入口变了时整页重新加载。
- 面板目录变了推给全部组件进程(`ctx.panels.list`)；远程服务按新的开关和顺序重新认每个名字生效的提供方(显示方也是这样换的)；装着的组件、输出和听写的登记、界面语言有变化时，全部组件进程收到一份新的应用信息(`ctx.app.info`)。

送到各处的内容见 [组件管理](component-manager.md#发布改动)，各运行环境怎么跟上见 [面板页面](panel-page.md#计划和外观)、[组件进程](component-process.md#重载)、[主窗口](main-window.md#加载组件)。

## 各部分之间怎么往来

**远程服务**(`ctx.relay`，`src/main/relay.ts`)。跨运行环境用的服务：提供方是清单 `provides` 里有这个名字的主进程组件，它用 `ctx.relay.serve(名字, 实现)` 登记，发布一份状态、接收调用；使用方在任何组件进程或页面里用 `ctx.relay.use(名字)` 读状态、发调用。核心只管通道，不看状态和参数的内容：

- 同名的提供者有几个在用时，组件顺序最前的那个生效；它停了、关了、顺序换了，排在后面登记过的接上。核心把每个登记生效没有告诉提供方(只发给登记所在的进程)，提供方从 `serve` 返回的把手上读(`active`)和订阅(`watch`)：等着的提供方收不到调用、发布的状态没人看得到，显示方靠它决定连不连设备、开不开面板页面。
- 状态只发给订阅了这个名字的组件进程和页面，核心留着最新的一份给晚来的；没有生效的提供方(组件关着、进程没在跑)时状态是 `null`。
- 调用带上核心填的调用者(`Caller`：哪个主进程组件、哪块面板的页面，或媒体页面)，提供方按它决定收不收。等结果的调用 15 秒没回按失败回；不等结果的按到达的先后交给提供方。
- 页面只够得着这一页的组件在清单 `requires`、`uses` 里写了的名字；主窗口不接远程服务。

预装的输入法组件提供 `keyboard`：发布键盘状态(`KeyboardState`)，收按键等操作、插入文字、听写结果。键盘上的部件经输入法组件的页面部分提供的 `kb` 服务用它，听写组件在自己的进程里直接用，见 [输入法](input-method.md)。显示方提供 `panels`：发布每块面板打开没有、显示没有、常显、锁、宽度(`PanelsState`)，收打开、关掉、整组收起、到面前、改宽度和锁等调用(见 [SDK](sdk.md#显示方ctxpanels-和远程服务-panels))；面板页面的 `ctx.panel.hide()` 由核心替它调这个服务。消息的格式和各种失败见 [组件进程](component-process.md#远程服务)。

**应用信息和通用请求**(`ctx.app`，`src/main/app.ts`)。核心把程序版本、是不是安装包里的程序、界面语言、装着的全部组件(开关、在不在用、清单)、输出组件的开关和登记情况、接了听写的输入源合成一份 `AppInfo`，变了就推给全部组件进程。主进程组件要核心做的事也经它：发给输出组件、「正在输入」、清除(`ctx.output`)，开关听写(`ctx.input`)，翻译(`ctx.translator`)，开关一个输出组件、读写系统剪贴板(`ctx.app`)。

**总线**(`ctx.bus`，`src/shared/component-services.ts`)。`send(频道, 数据)` 先送给本运行环境里的监听，再经主进程转给别的运行环境：全部组件进程和主窗口都收；媒体页面和面板页面只收自己登记了的频道(页面里有监听的频道由宿主自动登记，`src/main/page-bus.ts`)。核心自己只发一个通知：`core/component-removed`，数据是卸载完的组件 id。媒体页面和面板页面发的、登记收的频道都必须以这一页加载的某个组件 id 加 `/` 开头(登记另外放行 `core/` 的频道)，所以它们发不了 `core/` 的频道，也听不到别的组件的频道(听写的麦克风音频、合成的语音都走各自组件的频道)；主窗口和主进程组件不限。页面发的一条消息：频道名最长 200 个字符，数据只能是普通数据、存成 JSON 不超过 256 KB，`core/` 的频道主窗口也发不了。

**组件数据**(`ctx.storage`)。组件进程、面板页面和媒体页面里的读写都交给主进程，存成数据文件夹的 `component-data/<id>.json`。媒体页面和面板页面只能读写这一页加载的组件的数据。

**面板页面和帧**(`ctx.panels`，`src/main/panels.ts`)。核心把面板目录推给全部组件进程；生效的显示方开面板页面、收帧、发指点事件、停画和恢复，见 [组件进程](component-process.md#面板页面)。

**运行日志**。宿主和组件写的每一行进主进程的内存缓冲，再推给主窗口和各组件进程，见 [运行日志](logs.md)。

**状态栏项**。主进程组件用 `ctx.status.set` 上报，主进程按组件顺序汇总后和 CPU、内存一起推给主窗口(校验在 `src/shared/status.ts`)。

**输出、输入源、翻译**。主进程组件在自己的进程里登记(`ctx.output.register` 等)，核心把几个进程登记的合起来；别的主进程组件用 `ctx.output.send`、`ctx.input.dictate`、`ctx.translator.translate` 让登记了的去做，见 [组件进程](component-process.md#输出听写翻译)。

## 组件之间只经声明的服务往来

每个组件只认识核心的 API 和它在清单里声明的服务，不认识别的组件的 id、总线频道、源码和数据格式。卸掉或换掉一个组件时，用到它的地方要么照常工作(同一个服务有另一个提供者)，要么那一块不显示。

- **要用别的组件的功能就声明服务。**提供方在清单写 `provides`，在代码里 `ctx.provide(名字, 对象)`(同一个运行环境里用)或 `ctx.relay.serve(名字, 实现)`(跨运行环境用)；使用方在清单写 `requires`(没有在用的提供者时不加载)或 `uses`(没有也照常加载)，在插件写 `inject`、可有可无的服务用 `ctx.inject`，远程服务用 `ctx.relay.use`。服务的接口类型在 `sdk/`。
- **总线频道只在同一个组件的几部分之间用**(主进程部分、页面部分、主窗口部分)，频道名以组件 id 开头，如 `yanuo.asr-bailian/pcm`。
- **汇总页按服务和插槽拼，不按 id 找组件。**仪表盘、组件详情、设置页要显示某个功能的内容时开一个插槽或登记接口，由提供这个功能的组件自己放进去，见 [主窗口](main-window.md)。
- **组件只从 `@konkon-lab/foxpanel-sdk`(类型)和 `@konkon-lab/foxpanel-window`(主窗口的宿主数据和函数)拿核心的东西**，不引用 `src/` 下的源码。
- **`components/_shared/` 只放不懂业务的代码**：界面零件、按 Schema 画控件的工具、Vue 挂载工具；百炼三个组件共用的接口代码在 `components/_bailian/`。它们在打包时内联进各组件。

Cordis 的服务对象只在同一个运行环境里能 `inject`(每个组件进程、每个页面各有自己的根上下文)。跨运行环境用别的组件的功能走远程服务(`ctx.relay`)或核心的登记表(输出、听写、翻译)；同一个组件的几部分之间走自己的总线频道。同一块面板里的根组件、部件和服务组件的页面部分在同一个根上下文里，互相能 `inject`；不同面板的页面之间只能走远程服务。

预装组件声明的服务：

| 服务 | 提供者 | 在哪里 | 谁在用 |
|---|---|---|---|
| `keys` | `yanuo.keys` | 键盘面板的页面 | 只有布局 JSON 的布局组件(清单写 `requires: ["keys"]`，宿主把它包成等 `keys` 的插件) |
| `keyboard` | `yanuo.ime` | 远程服务：提供方在独立的组件进程；它的页面部分在键盘面板的页面里把它包成 `kb` 服务 | 候选栏、输入框、按键渲染、侧栏页、粘贴按钮(`requires`，在页面里 `inject: ['kb']`)；听写(`uses`，在组件进程里 `ctx.relay.use('keyboard')`) |
| `panels` | `yanuo.steamvr` | 远程服务：提供方在独立的组件进程 | 面板页面的 `ctx.panel.hide()`(核心替页面调)；要读面板状态、开关面板的组件在清单写 `uses: ["panels"]` |
| `osc` | `yanuo.osc` | 共用的组件进程 | 聊天框(`requires`)、听写(可选)，见 [OSC 服务](osc.md) |
| `aliyun` | `yanuo.aliyun` | 没有服务对象：设置和密钥并进使用方的 `ctx.config` | 百炼三个组件(`requires`) |
| `usage` | `yanuo.aliyun` | 共用的组件进程(记账)、主窗口(账本) | 百炼三个组件记用量(`ctx.get('usage')`，没有提供者时不记)；组件详情的用量一节和仪表盘的费用卡片由阿里云组件自己放进插槽 |
| `telemetry` | `yanuo.telemetry` | 没有服务对象：组件自己按间隔发在线记录 | 没有 |
| `components` | `yanuo.window-components` | 主窗口 | 依赖管理、依赖图(`requires`) |
| `settings` | `yanuo.window-settings` | 主窗口 | 往设置页登记配置的组件 |

## 安全边界

- **密钥**：清单里 `role: "secret"` 的设置用系统凭据(Electron safeStorage)加密后存 `secrets.json`，不进 `config.json`；主窗口只拿到前 4 位和后 2 位的预览，看明文要过 Windows 安全验证；明文只在主进程解密后交给主进程组件(`src/main/components/secrets.ts`)。
- **页面的身份**：主窗口、媒体页面、面板页面(离屏的和普通窗口里的)在窗口建好、加载地址之前登记是哪一种，面板页面记着它是哪块面板，媒体页面和面板页面还记着这一页加载的组件 id 和这些组件够得着的远程服务名，计划变了跟着换；窗口销毁时注销(`src/main/senders.ts` 的 `Senders`、`adopt`)。下面的 IPC、权限、组件 id、总线频道、远程服务的限制都按它判断，没登记的窗口什么都调不了。
- **窄 preload**：面板页面和媒体页面的 `window.fox` 上只有 `PageApi` 的接口，组件管理、应用设置、更新、目录、市场、窗口控制的接口这两种页面上根本没有(`src/preload/page.ts`)。
- **每块面板一个源**：面板页面的主机名是 `<面板 id>.panel`，各块面板和主窗口的 localStorage、IndexedDB 互不相通。页面的地址只能是核心拼的宿主页，组件不能给地址。
- **IPC**：每个通道只处理名单里那几种页面、并且是页面主框架发来的消息(`src/main/ipc.ts` 的 `POLICY`，按 `IPC` 和 `PAGE_IPC` 的键列全)。组件管理、应用设置和界面语言、更新、窗口控制、目录浏览、市场、打开外部链接、读日志只有主窗口能调；取计划和外观、登记总线频道、远程服务的订阅和调用只有媒体页面和面板页面能调；换深色、请显示方收起自己只有面板页面能调；发总线消息、组件数据、写日志三种页面都能调。不处理时 `invoke` 的调用方得到错误、`send` 的消息丢掉，运行日志里记一行警告 `ipc <通道> refused: …`(同一个通道的同一个原因 10 秒一行)。
- **组件 id 和总线频道**：媒体页面和面板页面读写组件数据、写日志时只能用这一页加载的组件 id；发总线消息的频道、登记收的频道都必须以这一页加载的某个组件 id 加 `/` 开头(登记另外放行核心的 `core/` 频道)；主窗口不限(`ownsComponent`、`ownsChannel`、`hearsChannel`)。页面发的总线消息里频道名不合格的、`core/` 的、太大的、带普通数据以外的值的不转发(`src/main/page-bus.ts`)；这几种拒绝各自 10 秒记一行警告，警告的多少不随页面给的频道名变。
- **远程服务**：媒体页面和面板页面只能订阅、调用这一页的组件在清单 `requires`、`uses` 里写了的名字(`usesRemote`)；一个组件的清单写了某个名字，它所在的那一页的组件就都够得着。提供方要是清单 `provides` 里有这个名字、在用、并且就在发消息的那个进程里的组件。每次调用带着核心填的调用者：主进程组件发的是核对过的组件 id，面板页面发的是面板 id，媒体页面发的只有页面的种类。方法名只收字母、数字、下划线、`$` 组成、不以数字开头、最长 64 个字符的；参数只收普通数据(普通对象、数组、基本类型、二进制缓冲)，存成 JSON 不超过 64 KB；不合格的不转给提供方，记一行警告(同一个调用方同一个原因 10 秒一行)。核心替主进程组件开关组件时只认装着的输出组件。
- **权限**：按白名单给，默认拒绝(`limitPermissions`)。`media` 的申请只批给媒体页面；权限查询只放行媒体页面和主窗口的 `media`(主窗口只能查看音频设备名，打不开麦克风)；剪贴板、HID、串口、USB、蓝牙等其余权限都不给。
- **面板页面只有显示方能开**：`ctx.panels.open` 只认当前生效的显示方、并且它就在发消息的那个进程里；开了之后对这一页的操作(收帧、还帧、指点、停画、关掉)只认开它的那个组件。同时存在的面板页面最多 12 个。
- **页面限制**：全部窗口里的页面都不能导航到别的地址(重新加载当前地址可以)、不能被重定向、页面里的子框架不能加载任何地址、不能开新窗口、不能嵌 webview、选不到蓝牙设备、WebRTC 不发 UDP 包(`lockDown`)；页面发起的下载一律取消。
- **面板页面和媒体页面的联网**：内容安全策略只放行页面自己和 `fox:`，没有外站，页面里 `fetch`、WebSocket、图片、脚本都取不了外面的地址；不能嵌框架、不能开 worker、不能嵌插件。组件文件的响应另带一条内容安全策略(只能取 `fox:`、不能嵌框架)，被当成文档或 worker 加载时也联不了网。要联网的事放在组件的 `main` 部分。WebRTC 是这条线上没堵死的一处：UDP(含 STUN)已经关掉，经 TCP 连 TURN 服务器和它带出的域名查询拦不住。
- **组件文件**：`fox://component/<id>/` 只读得到这个组件文件夹里的文件；清单里的路径不能是绝对路径、不能有 `..`。
- **组件数据**：按组件 id 分文件，每个组件最多 1 MB；卸载时连同它的设置、它自己的密钥一起删掉(上限在 `src/main/components/storage.ts`，卸载时的清理在 `src/main/components/manager.ts`)。
- **数据文件夹**：目录浏览、新建文件夹、打开文件夹的路径都限制在数据文件夹里(`src/main/datadir.ts`)；打开组件文件夹只认登记过的。
- **网址**：`openExternal` 只放行 http / https。
- **外部输入**：IPC 参数、进程消息、组件上报的状态栏项和登记项、配置文件、清单都按 `unknown` 接收再收窄；页面带 CSP，默认只放行自身和 `fox:`。
- **带代码的组件不加沙箱**：主进程代码有完整的 Node 权限，上面这些是纵深防御，不是对第三方组件的沙箱；它们让「只有页面代码的面板组件」成为权限确实很小的一类。同一块面板里的根组件和部件在同一个 JS 环境里，互相没有隔离。带代码的组件(有 `panel` / `page` / `window` / `main`，或包里有 `.lua`)安装时提示能运行任意程序。
- **崩溃转储**只存在数据文件夹的 `Crashpad/`，不上传。
- **在线记录**由预装组件 `yanuo.telemetry` 发，核心里没有上报的代码；一条记录里有什么、怎么关见 [在线统计](telemetry.md)。

其中面板页面和媒体页面的 `window.fox` 上有哪些接口、各块面板的源、面板页面读写别的组件的数据、调组件管理的 IPC(卸载组件)、经键盘操作开关不是输出组件的组件、往别的频道发总线消息、登记别的组件的频道、用组件没声明的远程服务、开麦克风、联网和嵌自己组件包里的网页，主窗口用远程服务，以及面板页面和主窗口跳到外站、开新窗口，由 `npm run smoke -- --boundary` 在跑起来的程序里检查(见 [打包和更新](release.md#冒烟检查))；页面的身份、IPC、组件 id 和总线频道、权限、页面限制各条的单元测试在 `test/senders.test.ts`、`test/ipc.test.ts`、`test/page-bus.test.ts`，面板页面的在 `test/panels.test.ts`、`test/panel-window.test.ts`，`fox://` 的在 `test/fox-url.test.ts`，远程服务的在 `test/relay.test.ts`，核心的源码不带键盘约定的在 `test/core-neutral.test.ts`。

## 数据文件夹

数据文件夹是 Electron 的 `userData`(Windows 上是 `%APPDATA%\FoxPanel`)，组件经 `ctx.dataDir` 拿到路径。

| 路径 | 内容 | 谁写 |
|---|---|---|
| `config.json` | `{ "settings": { language, components, app, panels } }`：界面语言、组件的顺序、开关、设置和分组、应用设置、面板外观(`panels.dark`)。整份经临时文件替换保存；读不了时留一份 `config.json.bad` 并用默认设置 | 核心，`src/main/settings.ts` |
| `components/` | 组件目录 `<id>/`；同时是 yarn 项目，从 npm 装的组件在 `node_modules/` | 核心，见 [组件管理](component-manager.md)、[组件市场](market.md) |
| `component-data/<id>.json` | 组件自己的数据(`ctx.storage`)。SteamVR 组件的面板布局在它的 `layout` 键里 | 核心 |
| `secrets.json` | 加密的密钥 | 核心 |
| `rime/` | rime 用户目录 | 输入法组件，见 [输入法](input-method.md) |
| `usage.json` | 用量账本 | 阿里云组件，见 [用量和费用](usage.md) |
| `logs/` | 日志文件(目录可在日志组件的设置里改) | 日志组件，见 [运行日志](logs.md) |

随程序带的文件在程序目录(组件经 `ctx.appDir` 拿到)：`vendor/rime`(输入法引擎和词库)、`vendor/openvr`(`openvr_api.dll`)、`vendor/yarn`(`yarn.cjs`)、`resources/vr`(SteamVR 应用清单、按键绑定、指针贴图)。打进 `dist/` 的 npm 包的许可证全文在 `dist/THIRD_PARTY_LICENSES.txt`。

## 目录结构

```
src/
├─ main/               主进程
│   ├─ main.ts           入口：装配、IPC、启动和退出
│   ├─ senders.ts        各窗口是哪种页面的登记表、组件 id 和总线频道的归属、权限白名单、页面限制、会话的限制
│   ├─ ipc.ts            页面 IPC 的注册和策略表
│   ├─ window.ts         主窗口(无边框、主题和缩放、关闭处理、托盘)
│   ├─ relay.ts          远程服务的通道
│   ├─ payload.ts        远程调用的参数和总线消息的大小
│   ├─ app.ts            应用信息和主进程组件的通用请求
│   ├─ panels.ts         面板页面：按面板 id 持有页面、把帧交给显示方、保留期
│   ├─ panel-window.ts   面板窗口和句柄复制的适配(BrowserWindow、kernel32)
│   ├─ page-bus.ts       总线在页面一侧的登记和投递
│   ├─ pages.ts          媒体页面
│   ├─ settings.ts       config.json
│   ├─ logs.ts           运行日志的内存缓冲
│   ├─ datadir.ts        数据文件夹的目录浏览
│   ├─ desktop.ts        托盘、管理员权限、CPU 和内存、Windows 安全验证
│   ├─ updater.ts        检查和安装更新
│   ├─ dev.ts            只在这次运行加载的组件文件夹(开发用的显示方)
│   └─ components/       组件目录(store)、组件管理(manager)、组件设置(settings)、密钥(secrets)、
│                        组件数据(storage)、fox:// 协议(protocol)、组件进程的宿主端(host、hosts)、
│                        npm 组件(yarn、market)
├─ component-host/     组件进程(入口 main.ts；owned.ts 记组件占用的东西；handles.ts 关掉没有组件收的面板帧的句柄)
├─ yarn-host/          跑 yarn 的进程
├─ preload/            window.fox：preload.ts 给主窗口，page.ts 给面板页面和媒体页面(显示状态的通知在 visible.ts)
├─ panel/              面板页面和媒体页面的宿主
├─ renderer/           主窗口的宿主
└─ shared/             各处共用的类型、IPC 通道名、清单和 Schema 的校验、进程间消息格式、共享库表
sdk/                   组件 SDK 的类型(@konkon-lab/foxpanel-sdk)：index.ts，键盘的约定 keyboard.ts
components/            预装组件
├─ preinstalled.json     预装列表、默认顺序、默认分组
├─ <名字>/               component.json，src/page.ts、window.ts、main.ts、worker.ts(各入口)
├─ _shared/              预装组件共用的界面零件和工具；panels/ 是显示方共用的面板布局状态机和远程调用的收窄
└─ _bailian/             百炼三个组件共用的代码
dev/                   开发用的组件：display-desktop(把面板显示成普通窗口的显示方)，不进预装列表和安装包
examples/              示例组件
scripts/               构建、打包、生成代码、冒烟检查的脚本，npm 的 prepare，许可证的收集，预装组件的版本检查
resources/             程序图标、SteamVR 的清单和绑定
vendor/                随程序带的输入法引擎和词库、OpenVR、yarn
test/                  单元测试(node:test)
dist/                  构建产物：main.js、component-host.js、preload.cjs、preload-page.cjs、yarn-host.cjs、
                       host/(宿主页面、lib/ 共享库、window/ 主窗口)、components/<id>/、dev/<名字>/、icons/、
                       THIRD_PARTY_LICENSES.txt(打进产物的 npm 包的许可证全文)
release/               安装包、组件包、SDK 类型包
```

构建、打包和更新见 [打包和更新](release.md)。

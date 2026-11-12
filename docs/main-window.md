# 主窗口

主窗口是桌面上的管理界面：仪表盘、组件、市场、依赖管理、依赖图、日志、设置。宿主只开窗口、加载组件、给出主题、文案和跳转这些 API；顶栏、侧栏、状态栏和每一页都是预装组件，和别的组件一样能停用、卸载、换掉。

## 组成

| 部分 | 位置 | 做什么 |
|---|---|---|
| 窗口 | `src/main/window.ts` | 无边框窗口、主题和缩放、点关闭时的处理、托盘图标 |
| 页面宿主 | `src/renderer/` | Naive UI 的主题和语言、读初始数据、按加载列表加载组件、登记表、跳转、文案表、`@konkon-lab/foxpanel-window` |
| 外壳 | `components/window-shell` | 顶栏、侧栏、内容区、状态栏 |
| 页面组件 | `components/window-*` | 仪表盘、组件管理、市场、依赖管理、依赖图、日志、设置 |
| 共用代码 | `components/_shared/window/` | 预装主窗口组件共用的界面零件、文案、保护名单；打包时内联进各组件 |

预装的主窗口组件都在默认分组 `console` 里(见 [组件管理](component-manager.md))：

| 组件 | 页面 id | 侧栏 order | 提供的服务 | 内容 |
|---|---|---|---|---|
| `yanuo.window-shell` 主窗口外壳 | | | | 插槽 `layout` |
| `yanuo.window-dashboard` 仪表盘 | `home` | 0 | | 快捷设置卡和别的组件放进来的卡片 |
| `yanuo.window-components` 组件管理 | `components` | 1 | `components` | 分组树、组件详情、分组页 |
| `yanuo.window-market` 市场 | `market` | 1.5 | | 见 [组件市场](market.md) |
| `yanuo.window-packages` 依赖管理 | `packages` | 2 | | 组件和版本的表格 |
| `yanuo.window-deps` 依赖图 | `deps` | 3 | | 正在运行的组件的关系图 |
| `yanuo.window-logs` 日志 | `logs` | 4 | | 见 [运行日志](logs.md) |
| `yanuo.window-settings` 设置 | `settings` | 100 | `settings` | 设置页和应用设置 |

依赖管理和依赖图在清单里写了 `requires: ["components"]`，组件管理没开时它们不加载。

## 窗口

`src/main/window.ts` 的 `MainWindow`。

- 无边框(`frame: false`)，顶栏由页面画。默认 1440×900，主显示器的工作区放不下时缩到工作区里；最小 960×600。
- 窗口底色和页面底色一致：浅色 `#f5f6f8`，深色 `#16171b`。
- 页面地址 `fox://host/window/index.html`，preload 是 `dist/preload.cjs`(只给主窗口用，接口 `FoxApi` 在 `src/shared/types.ts`；面板页面和媒体页面用另一份窄的，没有这些接口)。主窗口不接远程服务，`FoxApi` 上没有订阅和调用远程服务的接口。
- 窗口建好、加载地址之前登记为主窗口并加上页面限制：页面不能导航到别的地址(整页重新加载可以)、不能开新窗口、不能嵌 webview、不能下载。组件管理、应用设置、更新、窗口控制、目录浏览、市场、打开外部链接、读日志这些 IPC 只有登记为主窗口的页面能调(见 [总体结构](architecture.md#安全边界))。
- 主窗口关掉，程序退出。程序已经在运行时再启动一次，把主窗口显示到前面。

### 应用设置

应用设置是 `AppSettings`(`src/shared/types.ts`)，存在数据文件夹 `config.json` 的 `settings.app` 里；界面语言存在 `settings.language`。面板的深色(全部面板共用)存在 `settings.panels.dark`，由面板页面改(日夜切换按钮)，主窗口没有改它的界面；它变了时主窗口经 `fox.onSettings` 拿到新的设置。

| 键 | 默认 | 说明 |
|---|---|---|
| `closeAction` | `ask` | 点关闭时：`ask` 每次询问、`tray` 最小化到托盘、`quit` 退出 |
| `admin` | `false` | 启动时请求管理员权限 |
| `theme` | `system` | `light` / `dark` / `system` |
| `zoom` | `1` | 主窗口缩放，夹在 0.5–1.5 |
| `autoCheck` | `true` | 启动时检查更新 |
| `autoDownload` | `true` | 发现新版本时在后台下载 |
| `beta` | `false` | 也接收测试版 |
| `navCollapsed` | `true` | 侧栏只显示图标 |

宿主只保存这些值并用在自己的事上；改它们的界面在设置组件和外壳组件里，经 `fox.setApp(改动)`、`fox.setLanguage(语言)` 交给宿主。`fox.setApp` 把改动并进去、校验(`src/main/settings.ts` 的 `readApp`)、存盘、把新设置推给主窗口，主题或缩放变了立即生效。更新相关的三项见 [打包和更新](release.md)。

- 主题：主进程按 `theme` 设 `nativeTheme.themeSource`，页面的 `prefers-color-scheme` 跟着变；页面里 Naive UI 按系统配色选浅色或深色主题(`src/renderer/theme.ts`)，CSS 变量在 `src/renderer/style.css`。
- 缩放：页面每次加载完按 `zoom` 设缩放系数。
- 管理员：`admin` 开着而当前进程没有管理员权限时，启动时以管理员身份另起一份(弹 UAC)并退出自己；用户拒绝时以普通权限继续，日志里记一行警告。
- 界面语言：`system` 时主窗口按 `navigator.language`、主进程按系统语言匹配到五种界面语言之一(中文按繁简分，日文、韩文各自对应，其余用英文)。

### 关闭和托盘

点关闭按钮(`fox.winClose()`)按 `closeAction` 处理：

| `closeAction` | 处理 |
|---|---|
| `quit` | 关窗口，程序退出 |
| `tray` | 隐藏窗口，留在托盘 |
| `ask` | 页面里有组件接了关闭询问(调过 `fox.onCloseAsk`)时，给页面发一次询问，等它用 `fox.closeAnswer('tray' / 'quit' / null)` 回答(`null` 是取消)；没有组件接时直接退出 |

页面重新加载时「有组件接了询问」这个标记清掉，由组件加载时重新接上。接询问的登记(`win:close-handler`)只认主窗口自己的页面发来的。

托盘图标在第一次最小化到托盘时建：单击或菜单「显示 FoxPanel」把主窗口显示到前面，「退出」退出程序。菜单文字跟界面语言(`src/main/desktop.ts`)。

## 页面宿主

`src/renderer/`，打包到 `dist/host/window/`。

| 文件 | 内容 |
|---|---|
| `main.ts` | 入口：挂上 `@konkon-lab/foxpanel-window`，挂载 Vue 应用，读初始数据后加载组件 |
| `App.vue` | Naive UI 的主题和语言；读数据和加载组件时转圈；之后显示外壳(插槽 `layout`)和插槽 `app` 的内容 |
| `store.ts` | 主窗口的数据 `store`，来自主进程并跟着推送更新 |
| `windows.ts` | 加载组件，页面、插槽、设置页登记表 `windows` |
| `plan.ts` | 加载列表变了时重新加载哪些组件 |
| `nav.ts` | 当前页面和组件页的选中项，跳转函数 |
| `i18n/` | 文案表、`define`、`t`；宿主自己的两条文案在 `core.ts` |
| `theme.ts`、`style.css` | Naive UI 主题、CSS 变量 |
| `money.ts` | 金额和用量数字的显示 |
| `window-api.ts` | `@konkon-lab/foxpanel-window` 导出的对象 |

没有外壳组件时，窗口里只有一行「主窗口外壳组件缺失，主窗口显示失败」和一个关闭按钮，整个窗口可以拖动。

页面的内容安全策略只放行自身和 `fox:`，网络请求另外只放行每日一言的接口 `https://v1.hitokoto.cn`。主窗口能列出音频设备的名字(设置里选设备用)，不能打开麦克风。

### 共享库和 @konkon-lab/foxpanel-window

`vue`、`naive-ui`、`@lucide/vue`、`cordis`、`@konkon-lab/foxpanel-window` 不打进宿主和组件的包，由页面的 import map 指到 `fox://host/lib/` 下的同一份文件(名单在 `src/shared/libs.ts`)。所以组件和宿主用的是同一份 Vue 和 Naive UI，主题、语言跟着宿主。

`@konkon-lab/foxpanel-window` 是一个转接模块：宿主启动时把一组对象挂在 `globalThis.__foxWindow` 上，模块按名字转成导出(名单在 `src/shared/window-api.ts`)。

| 导出 | 说明 |
|---|---|
| `store` | 响应式数据：`settings`(全部设置)、`comps`(组件列表 `rows`、清单有误的 `broken`、`devMode`、组件进程状态 `host`)、`update`(更新状态)、`version`、`dataDir`、`stats`(状态栏)、`logs`(运行日志) |
| `fox` | 主进程接口(`FoxApi`) |
| `t`、`locale` | 取文案、当前界面语言 |
| `nav`、`openPage`、`openComponent`、`openGroup` | 跳转 |
| `windows` | 登记表：`pages`、`slots`、`settings` |
| `money`、`amount` | 金额(不到 1 元显示 4 位小数，否则 2 位)和用量数字(带千分位)的显示 |
| `componentName` | 组件按界面语言的名字 |
| `textOf`、`isVisible`、`SINGLE_KINDS`、`defineMessages` | 多语言文字取值、配置项的显示条件、只能开一个的类别、定义文案表 |

### 加载组件

主进程给主窗口一份加载列表(`fox.windowPlan()`，`src/main/components/store.ts` 的 `windowComponents`)：按组件顺序列出开着的组件里要在主窗口跑的入口——`window` 组件的 `page`，别的类别的 `window`。每项有 `id`、`kind`、`name`、`config`(已补默认值，不含 secret)和入口地址 `fox://component/<id>/…`。

`windows.ts` 对每一项：

1. 从 Cordis 根上下文分出一个子上下文，带上 `id`、`config`、`log`、`bus`、`window`、`i18n`(类型 `WindowContext`，见 [SDK](sdk.md))。
2. `import` 入口，把默认导出当插件装上。入口没有默认导出或加载出错时写一行错误日志 `page load failed: …`，别的组件照常。
3. `apply` 里登记的页面、插槽、设置页内容先收在一起，加载完整批放进登记表；之后登记的直接进表。登记函数都返回撤销函数，组件卸载时全部去掉。

`ctx.bus` 的消息在主窗口的组件之间直接送达，同时经宿主转给组件进程，和登记了这个频道的面板页面、媒体页面；别处发的总线消息主窗口都收得到。组件之间的服务用 Cordis 的 `ctx.provide` / `inject`，只在主窗口这一个页面里有效。

加载列表变了(组件开关、顺序、设置变化)，主进程把新的推过来(`plan.ts`)：

| 变化 | 处理 |
|---|---|
| 各项的 `id` 和入口地址、顺序都没变，只有某些组件的 `config` 变了 | 只重新加载这几个组件：卸载旧的、加载新的，新的登记收齐后一次换掉旧的，正在看的页面不会消失。同一个组件的重新加载一个接一个做，结果是最后一份加载列表 |
| 组件增减、顺序变了、入口变了 | 整页重新加载 |

首次加载完成之前推来的加载列表只留最后一份，加载完再处理。

### 登记表

**页面**：`ctx.window.page({ id, title, icon, component, order? })`。侧栏按 `order` 从小到大排，相同时按组件顺序；`component` 铺满内容区。页面 `id` 已经被占用时这次登记不生效，写一行警告日志。

**插槽**：`ctx.window.slot({ type, component, order?, area? })`，同一个插槽里按 `order`、再按组件顺序排。

| `type` | 位置 | 谁来画 | 预装组件放的内容 |
|---|---|---|---|
| `layout` | 铺满窗口的外壳；有几个时用排最前的一个 | 宿主 | 外壳组件的顶栏、侧栏、内容区、状态栏 |
| `app` | 整个窗口上，全部显示 | 宿主 | 设置组件的关闭询问对话框 |
| `component-details` | 组件详情里的一节，拿到 props `{ id }`(正在看的组件)；`order` 小于 0 在设置各节前面，其余在后面 | 组件管理 | 日志组件的「运行日志」(-100)、输入法组件给语言组件的输入模式和搜狗词库导入(-50)、阿里云组件的「用量」(0) |
| `dashboard` | 仪表盘的一张卡片，`area` 是 `left` / `right` 列(没写为 `left`) | 仪表盘 | 阿里云组件的今日费用(左 0)、费用 · 近 14 天(左 10)、本月费用(右 0) |

**设置页**：`ctx.window.settings({ id, title, order?, keys?, component? })`，见下面「设置页」。

### 跳转

`nav` 是 `{ page, component, group }`：当前页面 id、组件页选中的组件 id、选中的分组 key(后两个最多一个)。启动时 `page` 是 `home`。

| 函数 | 作用 |
|---|---|
| `openPage(id)` | 切到一个页面 |
| `openComponent(id)` | 切到 `components` 页并选中这个组件 |
| `openGroup(key)` | 切到 `components` 页并选中这个分组 |

`nav.page` 指的页面没有登记时，外壳显示登记表里的第一个页面。

## 外壳

`components/window-shell`，用插槽 `layout` 登记一个铺满窗口的 Vue 组件(`components/window-shell/src/Layout.vue`)。

- **顶栏**(`components/window-shell/src/TitleBar.vue`，32px)：左边等宽字 `FoxPanel`，右边三个圆点——黄色最小化、绿色最大化或还原、红色关闭。整条是窗口的拖动区，双击切换最大化。
- **侧栏**(`components/window-shell/src/SideNav.vue`)：顶上是收起 / 展开按钮，下面是登记表里的页面。展开 196px 带文字，收起 64px 只显示图标；收起状态经 `fox.setApp({ navCollapsed })` 交给宿主保存。
- **内容区**：当前页面，可以上下滚动。
- **状态栏**(`components/window-shell/src/StatusBar.vue`，30px，靠右)：组件上报的项，最后是 `CPU n%  MEM n%`。

### 状态栏

主进程每 2 秒把状态栏的数据推给主窗口(`src/main/main.ts` 的 `sendStats`)：

- `cpu`、`mem`：FoxPanel 全部进程的 CPU(占全部核心的百分比)和内存(工作集占物理内存的百分比)。
- `items`：主进程组件用 `ctx.status.set(项)` 上报的项，每个组件一项，按组件顺序，只取开着的组件。项的格式见 [SDK](sdk.md)，校验在 `src/shared/status.ts`。

每一项画成「灯 名字 数」：灯 `ok` 绿、`wait` 黄、`idle` 灰。项里有 `state` 或 `rows` 时带一张卡片(标题行是灯、名字、状态文字，下面是各行)：悬停弹出，点一下固定住，再点一下、点别处或按 Esc 收起。预装组件里 OSC 服务和 SteamVR 悬浮面板各上报一项，见 [OSC 服务](osc.md)、[SteamVR 悬浮面板](steamvr.md)。

## 仪表盘

`components/window-dashboard`，页面 `home`。

- 标题旁是每日一言(`components/window-dashboard/src/quote.ts`)：从一言接口 `https://v1.hitokoto.cn` 取一句(文学、诗词、哲学三类，超时 5 秒)，当天的那一句缓存在 `localStorage` 的 `foxpanel.quote`；取不到时按日期从内置的 7 句里选。
- 下面两列卡片，左列宽(1.7 : 1)，两列等高，左列最下面留一块空位。每列的卡片有两种来源，放在一起按 `order` 排：
  - 组件清单的 `dashboard` 声明(格式见 [组件格式](components.md))：一张快捷设置卡(`components/window-dashboard/src/ConfigCard.vue`)。标题旁按声明放组件开关(`toggle`)或「前往设置 →」(`link`，跳到组件详情)，下面按 `keys` 列出这个组件的设置项，开关画成开关，其余都画成下拉；改了立即保存。组件关着时卡片也显示。
  - 别的组件用插槽 `dashboard` 放进来的卡片。

预装组件给仪表盘的卡片：

| 列 | order | 卡片 | 来自 |
|---|---|---|---|
| 左 | 0 | 今日费用 | 阿里云组件的插槽，见 [用量和费用](usage.md) |
| 左 | 10 | 费用 · 近 14 天 | 同上 |
| 右 | 0 | 本月费用 | 同上 |
| 右 | 10 | 翻译：目标语言、模型，标题旁是翻译组件的开关 | `yanuo.mt-bailian` 的清单 |
| 右 | 20 | 语音：音色、播放到、本地监听、监听设备，带「前往设置 →」，撑满剩余高度 | `yanuo.tts-bailian` 的清单 |

## 组件页

`components/window-components`，页面 `components`。左边是组件树(`components/window-components/src/CompTree.vue`，宽 228px)，右边是选中的组件(同目录的 `CompView.vue`)或分组(`GroupView.vue`)。这一页只是界面：开关、顺序、分组、设置、安装和卸载的规则在主进程，见 [组件管理](component-manager.md)。

它提供主窗口服务 `components`(`WindowComponentsService`：分组树、显示名、安装菜单和流程、最近一次操作的错误)，依赖管理和依赖图用它。

### 组件树

- 顶部搜索按名字和 id 过滤，搜索时分组都展开。
- 分组按设置里 `components.groups` 的顺序排，标题显示成「分组：名字」；不在任何分组里的组件在顶层，排在分组后面(按组件顺序)；有清单有误的文件夹时最后多一项「分组：加载失败」。
- 点分组标题打开分组页；点三角只在树里展开或收起，不保存。每次打开组件页，各分组回到自己的「默认折叠」。
- 组件行是名字(重命名过的优先)和状态灯：加载出错红，在用绿，其余(关着、单选类别里没选它、缺服务)灰。

拖动：

| 拖什么 | 放到哪 | 结果 |
|---|---|---|
| 组件 | 同一个分组里的另一个组件上 | 调分组里的成员顺序；两个组件同类别时还调这一类的组件顺序(键盘上的顺序)。往下拖落在目标后面，往上拖落在前面 |
| 组件 | 顶层的组件上(自己也在顶层) | 两个组件同类别时调这一类的组件顺序 |
| 组件 | 另一个分组或顶层的组件上 | 移到那个分组(排在目标前面)或顶层 |
| 组件 | 分组标题上 | 移进这个分组，排在最后 |
| 组件 | 树的空白处 | 移到顶层 |
| 分组标题 | 另一个分组标题上 | 调分组顺序：落在标题上半放到它前面，下半放到它后面 |

分组的数据存在设置里：

| 键 | 内容 |
|---|---|
| `components.groups` | 分组数组 `{ id, name, ids }`，数组顺序是树里的顺序，`ids` 是成员顺序 |
| `components.folded` | 默认折叠的分组 key(`u:<分组 id>`) |
| `components.names` | 组件 id → 重命名后的显示名(只改显示) |

### 分组页

- 标题行的按钮：停用分组(关掉组内开着的、不是单选类别的组件)、重命名、移除分组(成员到树的顶层)、新建分组(名字「新分组」)、安装组件。
- 分组设置：名字(离开输入框或回车时保存)、默认折叠。
- 组件列表：拖动把手、名字和 id、类别、开关。单选类别的开关只能打开(选用)。点名字进组件详情。
- 「加载失败」那一页列出清单有误的文件夹和原因，每个可以卸载(开发文件夹是移除)。

### 组件详情

- 标题「名字 [id]」，标题行的按钮：
  - 启用 / 停用。单选类别(候选栏、输入框、键盘布局、皮肤、翻译)没在用时是「选用」，在用时停用就是这一类都不用。面板组件是普通的开关，可以同时开几块。
  - 保存设置(有没保存的改动时才能点)。
  - 重命名：只改显示的名字，留空用清单里的名字。
  - 卸载(开发文件夹里的组件是「移除」，只去掉文件夹的登记)，先确认。
  - 安装组件。
- 版本和链接：当前版本；清单写了 `repository`、`bugs` 时各有一个按钮，用浏览器打开。
- 提示条，按清单和运行状态列出：

| 提示 | 什么时候有 |
|---|---|
| 组件加载失败(悬停看原因) | 主进程代码加载出错，或它的面板页面出错(加载失败、页面的进程退出) |
| 主进程组件反复崩溃已终止运行，带「重新启动」 | 组件进程连续崩溃停下，而且这个组件带代码(见 [组件进程](component-process.md)) |
| 必需服务：名字 (已加载 / 未加载) | 清单有 `requires`；点名字跳到提供它的组件 |
| 此组件提供了 X 服务 / 启用后将会提供 X 服务 | 清单有 `provides` |
| 此组件提供了发送目标 / 语音输入 / 翻译 / VR 面板 / 候选栏 / 输入框 / 键盘布局 / 键盘皮肤 / 侧栏页面 / 侧栏按钮 / 输入法语言 | 正在提供这项功能(「VR 面板」= 它声明的面板在面板目录里) |
| 此组件提供了页面：名字 | 它登记了主窗口页面；点名字跳过去 |
| 开发中，从文件夹加载：路径，带「打开文件夹」 | 开发文件夹里的组件 |

- 插槽 `component-details` 里 `order` 小于 0 的内容。
- 设置各节(`components/window-components/src/ConfigRow.vue`)：按清单 `config` 的分节，没写节标题的叫「基础设置」。只列显示条件满足的项；登记到设置页的项不在这里显示。
- 插槽 `component-details` 里其余的内容。

设置的一行是左边名字和说明、右边控件、最右「⋯」菜单。改动先记在草稿里，改过的行左边有一条强调色竖条，点「保存设置」一起提交(密钥逐个加密保存，其余一次提交)。别处改了同一个组件的设置时(比如仪表盘的快捷设置卡)，没动过的项跟着变。

| 设置类型 | 控件 |
|---|---|
| 开关 | 开关 |
| 选择 | 下拉；`role: "radio"` 是分段按钮。选项取自表格设置时分「自定义」「预置」两组；`custom` 的下拉底部能直接输入值 |
| 数字 | 步进器(− 数字 +)；`role: "slider"` 是滑块，拖动停下 300 毫秒后生效，步长小于 1 时按百分比显示 |
| 文字 | 文字框 |
| 密钥 | 密码框和眼睛按钮：已保存的值先过 Windows 安全验证才显示明文，30 秒后自动隐藏；没验证时框里只显示预览(前 4 位和后 2 位) |
| 表格 | 「添加一行」，各行在这一项下面通栏显示，每行可删 |
| 标签列表 | 输入后回车添加(数字要在范围内，重复的不加)，点叉删除 |
| 音频设备 | 下拉：系统默认和当前的设备，设备增减时自动刷新 |
| 目录 | 按钮显示当前目录，点开选目录对话框(`components/_shared/window/DirPicker.vue`)：只在数据文件夹里逐层浏览，可以新建文件夹 |

「⋯」菜单：编辑 JSON(把这一项的值当 JSON 文字改，读不出来时提示格式非法)、撤销更改、恢复默认值；密钥不能编辑 JSON，「恢复默认值」的位置是「清除」。

### 安装菜单

标题行最后的「安装组件」是一个菜单(`components/window-components/src/install.ts`)，依赖管理页的「手动添加」是同一个：

| 项 | 什么时候有 | 做什么 |
|---|---|---|
| 从市场安装 | 登记表里有 `market` 页面 | 跳到市场页 |
| 安装 zip 包 | 总是有 | 选一个 zip，检查通过后在右栏上方浮出确认条：名字和版本、类别 · 作者 · 许可证、要替换的已装版本、带代码时的提醒，点「安装」才装 |
| 从文件夹加载 | 开发者模式开着 | 选一个文件夹按开发中的组件加载 |

操作出错时错误浮在右栏上方，点一下收起。

### 开发者模式和保护名单

- 开发者模式是组件管理自己的配置 `devMode`(默认关)。组件加载时把值交给宿主(`fox.compSet({ kind: 'devMode' })`)；设置组件开着时这一项登记在设置页「常规」里，否则在组件管理自己的详情里改。
- 保护名单(`components/_shared/window/protect.ts`)：`yanuo.window-components` 和 `yanuo.window-shell`。名单里的组件在界面上不能停用、不能卸载，依赖管理页里没有「移除」；包含它们的分组不能停用、不能移除。名单只拦界面，宿主不知道它，手改配置文件不受限制。

## 依赖管理

`components/window-packages`，页面 `packages`。通栏表格，按显示名排序：

| 列 | 内容 |
|---|---|
| 组件 | 名字和 id；点名字进组件详情 |
| 本地版本 | 当前版本；开发文件夹里的标「开发文件夹」，从 npm 装的标「可更新」或「最新」 |
| 目标版本 | 下拉：从 npm 装的组件能选仓库里的各个版本(新的在前)，别的只有当前版本；最后一项是「移除」。开发文件夹里的组件不能改 |
| 操作 | 「修改」：让这一行的目标生效 |

标题行的按钮：全部更新(从 npm 装的换到各自的最新版)、应用更改(改过目标的行一起生效)、手动添加(安装菜单)、刷新(重新读组件列表和仓库里的版本)。目标里有「移除」时先确认。换版本和从 npm 安装的过程见 [组件市场](market.md)。

## 依赖图

`components/window-deps`，页面 `deps`。只画正在运行的组件：在用(开着，单选类别里排最前，要的服务都有)而且没有加载出错的。

- 节点：宿主 `FoxPanel`、有运行中组件的分组 `Group [分组名]`、组件(显示 id)。分组和宿主画成圆环；提供服务的节点中间画「+」(宿主提供面板页面的 `i18n`、`overlay` 和远程服务通道 `relay`)。不在任何分组里的组件不画。
- 连线：宿主 → 分组 → 组件是实线箭头；提供服务的组件 → 用它的组件(清单 `requires`)是虚线箭头。
- 布局是力导向的(`components/window-deps/src/force.ts`)：连线像弹簧(目标长度 100)，节点互相推开，整体向中心收拢，摊成画布的形状；虚线的拉力是实线的 0.2。
- 节点可以拖动，松手后回到布局里；点击不跳转。
- 悬停节点高亮它和往上的整条链，悬停连线高亮这条线和两端，其余淡掉。提示框跟着鼠标：节点是「组件：名字」和「提供服务：…」，连线是「调用：A → B」(实线)或「服务：A → B」(虚线)。

## 设置页

`components/window-settings`，页面 `settings`(侧栏最后一项)。它做三件事：画设置页、提供应用设置、接关闭询问。

### 分节

设置页的内容全部来自登记：`ctx.window.settings({ id, title, order?, keys?, component? })` 把本组件配置里的 `keys` 这几项(不写是全部)和一块自定义内容 `component` 放进节 `id`。

- 同 `id` 的登记合成一节(一张卡片)，标题用第一个登记的；节按 `order` 从小到大排。
- 一节里各登记按 `order`、再按组件顺序排，每个登记先放自定义内容，再放配置项。
- 只显示开着的组件的登记；配置项的显示条件照组件页的规则。
- 顶部搜索按节标题、配置项的名字和说明过滤；自定义内容在没搜索或节标题匹配时显示。

配置项在设置页改了立即保存到登记它的组件的配置(文字框在离开或回车时保存)。设置页能画开关、选择(下拉或分段按钮)、数字(步进器或滑块)、文字四种；别的类型显示成「在组件页设置」按钮。登记了、设置页又能画的项只在设置页改，组件详情里不显示(服务 `settings` 的 `edits(组件 id, 配置项)`)。

设置组件提供主窗口服务 `settings`，其中 `sections` 是三个节的 id、标题和顺序，别的组件拿它把自己的配置放进这三节：

| 节 | id | order | 内容 |
|---|---|---|---|
| 常规 | `general` | 0 | 界面语言、关闭窗口时、以管理员身份运行；组件管理的开发者模式 |
| 外观 | `look` | 10 | 界面主题(分段按钮)、界面缩放(滑块) |
| 更新与关于 | `about` | 90 | 版本和更新按钮(`components/window-settings/src/UpdateRow.vue`，更新状态对到文案和按钮在 `update-view.ts`)、自动检查更新、后台下载更新、接收测试版；数据文件夹的路径和「打开文件夹」(`components/window-settings/src/DataDir.vue`) |

### 设置组件的配置

设置组件自己的配置(清单 `config`)是界面语言 `language`(默认 `system` 跟随系统，另有简体中文、繁體中文、日本語、English、한국어)，加上「窗口」一节「应用设置」表里除 `navCollapsed` 以外的七项，键名和默认值相同。界面缩放画成 50%–150%、步长 5% 的滑块；以管理员身份运行在下次启动生效。

组件加载时把这些值交给宿主：界面语言和宿主记的不一样时调 `fox.setLanguage`，其余各项有不一样的就调 `fox.setApp`。在设置页改一项 → 保存到组件配置 → 主窗口按新的加载列表重新加载设置组件 → 组件把新值交给宿主。宿主记着最后一次交来的值，用在开窗口之前就要知道的地方(主题、缩放、管理员、托盘菜单的语言、更新检查)。

### 关闭询问

设置组件用插槽 `app` 放关闭询问对话框(`components/window-settings/src/CloseDialog.vue`)，并接上宿主的关闭询问。`closeAction` 是 `ask` 时点关闭弹出：最小化到托盘、退出、取消，可以勾「记住我的选择」(把选的那一项存成设置组件的 `closeAction`)。设置组件没开时没有组件接询问，点关闭直接退出。

## 文案

界面语言五种：`zh-Hans`、`zh-Hant`、`ja`、`en`、`ko`。

- 文案表在宿主(`src/renderer/i18n/index.ts`)，每种语言一张「键 → 文字」的表。组件在 `apply` 里用 `ctx.i18n.define(语言, { 键: 文字 })` 往里加，同名键覆盖；宿主自己只有没有外壳时用的两条。
- 页面里用 `@konkon-lab/foxpanel-window` 的 `t(键, 参数)` 取：文字里的 `{名字}` 用参数替换；当前语言没有这个键时用简体中文的，都没有时显示键本身。
- 页面标题、节标题、清单里的名字和说明这类是 `Text`(一个字符串，或按语言分的对象)，用 `textOf(值, locale)` 取。

预装主窗口组件的写法：

| 文件 | 内容 |
|---|---|
| 各组件 `src/locales.ts` | 本组件的文案，用 `defineMessages(简体中文, 其他四种语言)` 定义：简体中文定下键，别的语言必须给出同样的键，少了类型检查报错(`src/shared/messages.ts`) |
| 各组件 `src/i18n.ts` | 只收本组件和共用文案的键的 `t`，键写错时类型检查报错 |
| `components/_shared/window/locales.ts` | 共用零件的文案、组件类别名、安装确认的文案；用到共用零件的组件一起注册 |
| `components/_shared/window/i18n.ts` | `defineAll`(把几组文案注册到宿主)、`typedT`、类别名 `kindName`、把一条文案取成 `Text` 的 `textFrom` |

## 共用零件

`components/_shared/window/` 里预装主窗口组件共用的代码，打包时内联进每个用到它的组件：

| 文件 | 内容 |
|---|---|
| `PageHead.vue`、`ActionHead.vue`、`IconAction.vue` | 页面的标题行和标题行里的图标按钮 |
| `DetailSection.vue`、`DetailRow.vue`、`Notice.vue` | 详情页的一节、一行、提示条 |
| `SettingControl.vue`、`DropSelect.vue`、`SegButtons.vue`、`NumStep.vue`、`SliderControl.vue` | 按设置类型画控件：下拉、分段按钮、步进器、滑块 |
| `comp-fields.ts` | 下拉选项、音频设备列表、改一项设置 |
| `DirPicker.vue`、`AskDialog.vue`、`InstallFloat.vue` | 选目录对话框、确认或输入一行的小对话框、安装确认条和出错提示 |
| `components-service.ts` | 存下组件管理的 `components` 服务给页面用 |
| `protect.ts` | 保护名单 |
| `settle.ts` | 停下一段时间后才交出最新值(滑块用) |

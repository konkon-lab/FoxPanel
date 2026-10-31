# FoxPanel 组件 SDK

组件的代码都是 [Cordis](https://github.com/cordiverse/cordis) 插件：入口是 ES 模块，默认导出 `{ name, inject, apply(ctx, config) }`。宿主把服务挂在 `ctx` 上。

- **页面代码**跑在面板页面里(浏览器环境)，拿到 `PageContext`：面板的根组件(清单的 `panel.page`)铺满这块面板的页面，部件和服务组件的 `page` 跑在用到它们的那块面板的页面里。每块面板一页，各有自己的 Cordis 根上下文。
- **主进程代码**(`main`)跑在组件进程里(Node，完整权限)，拿到 `MainContext`。主进程组件默认共用一个进程(清单写 `"process": "own"` 的单独一个)；某个组件变了只卸载、重新加载它(和依赖它服务的组件)，进程不重启，所以停用时要放掉自己开的原生资源，koffi 的命名类型重新加载时已经在了，先用 `koffi.type(名字)` 取；崩溃后 1 秒自动重启，1 分钟内连崩 3 次停下。细节见 [组件进程](component-process.md)。
- 输出、输入源、翻译组件的页面代码跑在**媒体页面**(隐藏窗口)：能播放音频(`setSinkId` 选设备)、打开麦克风，没有插槽和弹层，用 `ctx.bus` 和 `main` 部分通信；要加载的组件或它们的设置变了时整页重载(见 [面板页面](panel-page.md#媒体页面))。
- 面板页面、媒体页面、主窗口里的代码拿不到浏览器权限：剪贴板、HID、串口、USB、蓝牙都拒绝，麦克风只有媒体页面能开(主窗口只能查看音频设备名)；不能跳到别的地址、开新窗口、嵌 webview、下载文件。面板页面和媒体页面还不能联网(取不了外面的地址，不能嵌 `iframe`、开 worker)，要联网的事放在 `main` 部分。键盘面板里粘贴和复制用 `ctx.kb.act` 的 `paste` / `copy`(对着输入框)；打开网址只有主窗口组件能做(`@konkon-lab/foxpanel-window` 的 `fox.openExternal`，只认 http / https)。见 [总体结构](architecture.md#安全边界)。

清单、布局、皮肤、语言的格式见 [components.md](components.md)。

## 类型

类型在 npm 包 `@konkon-lab/foxpanel-sdk` 里(只有类型，版本号和程序一样)，装进组件项目：

```bash
npm i -D @konkon-lab/foxpanel-sdk cordis@4.0.0-rc.12
```

写主窗口组件、要用 `@konkon-lab/foxpanel-window` 时再加 `vue`。从源码用的话，`npm run build:sdk` 生成 `release/sdk/`，`npm i -D <源码目录>/release/sdk` 装进去也一样。

```ts
import type { MainContext, PageContext } from '@konkon-lab/foxpanel-sdk';
// 主窗口组件：装了 SDK 就有这个模块的类型，运行时由主窗口提供
import { fox, store, t } from '@konkon-lab/foxpanel-window';
```

## 写法

```js
export default {
  name: 'me.hello',            // 一般写组件 id
  inject: ['kb'],              // 用到的全局服务：宿主的 overlay、i18n，组件提供的 kb、keys、osc 等
  apply(ctx, config) {
    // ctx.effect(() => 返回清理函数)：组件卸载时自动清理；ctx.on 的监听也会自动解绑
  },
};
```

- 宿主共享 `vue`(页面)和 `cordis`(两边)：直接 `import { ref } from 'vue'`、`import { Context } from 'cordis'`。别的依赖自己打包进入口。
- `config` 和 `ctx.config` 是组件的设置(已补默认值)；页面拿不到 secret，主进程能拿到解密后的 secret。
- 面板页面宿主的 `overlay`、`i18n` 和组件提供的服务(如 `kb`、`keys`、`osc`、`usage`)是全局服务，要写进 `inject`(可有可无的用 `ctx.get(名字)` 或 `ctx.inject`)；`id`、`slot`、`panel`、`config`、`dataDir`、`appDir`、`storage`、`bus`、`relay`、`app`、`panels`、`output`、`input`、`translator`、`status`、`logs`、`log` 是给每个组件单独的，直接用。
- 插件 `inject` 里的服务一直没有时，组件不启动；加载 5 秒后还在等的，运行日志里每个服务记一行 `waiting for service: <服务名>`(来源是这个组件)。等服务的组件不挡住后面的组件。

## 提供和使用服务

服务组件(`kind: service`)可以带主进程代码，用 Cordis 的 `ctx.provide(名字, 对象)` 提供服务，名字写进清单的 `provides`。用它的组件在清单写 `requires`(没有开着的提供者时不加载)，在插件写 `inject`；Cordis 等服务出现后才调 `apply`。

```js
// 提供
export default { name: 'me.clock', apply(ctx) { ctx.provide('clock', { now: () => Date.now() }); } };
// 使用
export default { name: 'me.user', inject: ['clock'], apply(ctx) { ctx.log(String(ctx.clock.now())); } };
// 可有可无的服务：ctx.inject 开一个子插件，服务在时才生效
ctx.inject(['osc'], sub => { sub.effect(() => sub.osc.on('/avatar/parameters/MuteSelf', v => { … })); });
```

没有代码的服务组件(如阿里云)只提供设置：设置并进用它的组件的 `ctx.config`。

服务对象只在提供它的那个运行环境里能 `inject`：共用的组件进程、每个独立的组件进程(`"process": "own"`)、每块面板的页面、媒体页面、主窗口各有自己的 Cordis 根上下文。面板页面里只加载这块面板的根组件、它插槽里的部件，和这些组件 `requires` 的服务里有 `page` 入口的提供者。独立进程里的组件 `inject` 不到共用进程里的服务(如 `osc`)。跨运行环境用别的组件的功能走远程服务(下一节)，或宿主的登记表(输出、听写、翻译)；同一个组件的几部分之间用 `ctx.bus`。

## 远程服务(ctx.relay)

远程服务是跨进程、跨页面用的服务：提供方是一个主进程组件，它发布一份状态、接收调用；使用方在任何组件进程或面板页面、媒体页面里读状态、发调用。宿主只管通道，不看状态和参数的内容。主窗口组件没有 `ctx.relay`。

```js
// 提供(主进程组件；清单 provides 里要有 "clock")
const serving = ctx.relay.serve('clock', {
  // 第一个参数是宿主填的调用者，其余参数是对方发来的，按 unknown 收、自己收窄
  set(caller, offset) { if (typeof offset === 'number') apply(offset); },
  now: () => Date.now(),
});
serving.publish({ offset: 0 });          // 发布状态(整份)
serving.active;                          // 这个登记生效着没有；同名的提供者里排在后面时等着
serving.watch(active => { … });          // 生效没有变了回调(登记时不调)，返回取消函数
// 使用(主进程组件直接用；页面里的组件清单 requires 或 uses 里要有 "clock")
const clock = ctx.relay.use('clock');
clock.state;                             // 最新的状态；没有提供者、或它还没发布过时为 null
clock.watch(state => { … });             // 状态变了回调(登记时不调)，返回取消函数
clock.tell('set', 3600);                 // 不等结果
const t = await clock.call('now');       // 等结果
```

| 成员 | 说明 |
|---|---|
| `use(name)` | 用一个远程服务，返回 `{ state, watch, call, tell }`。同一个组件对同一个名字多次 `use` 拿到的是同一个；组件卸载时自动退订 |
| `state` | 最新的状态。刚 `use` 时是 `null`，宿主随即补发当前的一份；没有生效的提供者时也是 `null`。页面里是 Vue 响应式的，新状态只给内容变了的字段赋值 |
| `watch(fn)` | 每次状态到了回调，登记时不调 |
| `call(method, ...args)` | 等结果。方法名或参数不合格、没有提供者、提供方没有这个方法或出错、提供方停了、15 秒没回时失败 |
| `tell(method, ...args)` | 不等结果，交给宿主就返回。同一个组件进程或页面发的按发出的先后送到提供方；交不出去时丢掉 |
| `serve(name, impl)` | 只有主进程组件能调：登记成提供方，返回把手 `{ active, watch(fn), publish(state), close() }`，组件卸载时自动撤掉。`impl` 是一个普通对象，方法是它自己的属性 |
| 把手的 `active` | 这个登记生效着：调用交给它，它发布的状态订阅方看得到。同名的提供者里排在后面等着时、宿主还没告诉时(刚登记)、撤掉之后是假 |
| 把手的 `watch(fn)` | 生效没有变了回调，登记时不调：刚登记时 `active` 是假，宿主告诉它生效了才回调一次。返回取消函数，撤掉或组件卸载时自动取消 |
| 把手的 `publish(state)`、`close()` | 发布状态(整份)：发给订阅了的组件进程和页面；等着的时候发布的，生效时订阅方收到最近的一份。`close()` 撤掉登记 |

- **谁能提供**：清单 `provides` 里有这个名字、在用的主进程组件。同名的提供者有几个时，组件顺序最前的那个生效，其余的登记着等它停了才接上；自己生效没有从把手上看(`active`、`watch`)，等着的提供方收不到调用，该省的事(连设备、开页面)等生效了再做。
- **谁能用**：主进程组件都能用(清单里写 `uses` 或 `requires` 说明依赖)；页面里的组件只够得着这一页的组件在清单 `requires`、`uses` 里写了的名字，别的名字宿主拒绝。`requires` 是没有在用的提供者时这个组件不加载，`uses` 是没有也照常加载。
- **调用者**(`Caller`)：`{ component, where }`。主进程组件发的 `where` 是 `'process'`、`component` 是宿主核对过的组件 id；面板页面发的 `where` 是 `'panel'`、`component` 是面板 id(一页里的根组件和部件分不开)；媒体页面发的 `where` 是 `'media'`、`component` 是空串。提供方按它决定收不收。
- **方法名和参数**：方法名由字母、数字、下划线、`$` 组成，不以数字开头，最长 64 个字符。参数是普通数据(普通对象、数组、基本类型、BigInt、二进制缓冲和它的视图)，存成 JSON 不超过 64 KB(二进制按字节数算)；带 Map、Set、Error 之类的对象或循环引用的调用宿主不转。
- **类型**：约定好的远程服务登记在 `RemoteMap` 里，`use` / `serve` 按名字给出状态和方法的类型。自己的服务用声明合并加进去：

```ts
declare module '@konkon-lab/foxpanel-sdk' {
  interface RemoteMap { clock: { state: { offset: number }; calls: { set(offset: number): void; now(): number } } }
}
```

预装的输入法组件提供 `keyboard`(状态 `KeyboardState`，方法 `KeyboardCalls`)，见「键盘(远程服务 keyboard)」；显示方提供 `panels`(状态 `PanelsState`，方法 `PanelsCalls`)，见「显示方」。消息和各种失败的细节见 [组件进程](component-process.md#远程服务)。

## 主窗口页面组件(WindowContext)

主窗口组件(`kind: window` 的 `page` 入口，别的类别的 `window` 入口)拿到 `WindowContext`：`id`、`config`(不含 secret)、`log`、`bus`、`window`、`i18n`，没有 `ctx.storage`。主窗口的宿主、各个插槽和预装的页面见 [主窗口](main-window.md)。

`ctx.window.page` / `ctx.window.slot` 注册页面和插槽(`component-details` 组件详情里的一节、`app` 整个窗口上的内容、`layout` 铺满窗口的外壳、`dashboard` 仪表盘上的一张卡片(`area` 写 `left` / `right` 选列，不写是左列))；`ctx.window.settings({ id, title, order?, keys?, component? })` 把自己的配置登记到设置页的一节(同 id 合成一节；`keys` 不写是全部配置项，登记了的开关、选择、数字、文字项只在设置页改，组件页不显示)；`ctx.i18n.define(语言, { 键: 文字 })` 加界面文案，页面里用 `@konkon-lab/foxpanel-window` 的 `t(键, 参数)` 取。

`ctx.window.page` / `slot` / `settings` 都返回撤销函数；在 `ctx.inject` 的回调里登记时写 `sub.effect(() => sub.window.settings(...))`，服务没了登记跟着去掉。

预装主窗口组件提供的服务(要 `inject`，或清单写 `requires`)：`components`(组件管理：分组树 `tree`、显示名 `nameOf`、安装菜单和流程 `installMenu` / `install` / `pending` / `confirm`、最近的错误 `error`)；`settings`(设置页：三节 `sections.general` / `look` / `about`，`edits(组件 id, 配置项)` 判断这一项是否在设置页改)；`usage`(用量账本 `book`)。

组件只从 `@konkon-lab/foxpanel-sdk` 拿类型(组件行 `ComponentRow`、清单 `Manifest`、配置项 `SettingDef`、文案表 `Messages` 等)，从 `@konkon-lab/foxpanel-window` 拿宿主的数据和函数(`store`、`fox`、`t`、`textOf`、`isVisible`、`SINGLE_KINDS`、`defineMessages` 等)，不引用程序的源码。

## 页面组件(PageContext)

面板页面里的组件(根组件、部件、服务组件的页面部分)都拿到 `PageContext`：`id`、`config`、`storage`、`bus`、`log`、`relay`、`slot`、`panel`，全局服务 `i18n`、`overlay`(要 `inject`)。媒体页面里的组件只有 `id`、`config`、`storage`、`bus`、`log`、`relay`。页面的 `window.fox` 是宿主用的，组件不要直接用它(它的回调不能返回值：返回值过不了页面和 preload 之间的边界)。

### ctx.panel

这一页是哪块面板、它的外观和显示状态、各插槽里的部件。这一页的组件共用一份。

| 成员 | 说明 |
|---|---|
| `id` | 面板 id(就是根组件的组件 id) |
| `width` / `height` | 页面宽高(CSS 像素)，清单 `panel` 里写的 |
| `dark` | 深色(响应式)。全部面板共用一个开关 |
| `setDark(on)` | 换深色 / 浅色：全部面板一起变，存进应用设置 |
| `visible` | 显示方让这一页画着(响应式)；为假时页面不出帧，用它停掉定时器和动画。留在空间里的面板等于正被显示；附着在头显或手柄上的面板该显示而设备不在、没抬手时也是真(这一刻在不在显示看远程服务 `panels` 的 `visible`) |
| `preview` | 页面显示在普通窗口里(开发用的显示方)，不是在 VR 里 |
| `parts(slot)` | 这个插槽里的部件，按组件顺序：`{ id, kind, name, icon?, el }`。列表在根组件加载之前就定好，只有 `name` 跟界面语言变(响应式)；字段只读，`el` 是宿主放进插槽元素里的那个元素，根组件可以改它的 `hidden` |
| `hide()` | 请显示方收起这块面板；没有显示方时无效。按总开关显示面板时它一起回来；它的组件关掉再打开时也重新出现 |

VR 里只有左键：能滚动的区域(`overflow` 是 `auto` 或 `scroll`、内容比它大)靠按住拖动滚，宿主给每个面板页面都装了(见 [面板页面](panel-page.md#拖动滚动))。拖过 8 像素的那一次按下不算点击，但宿主拦得住的只有 `click`：放在能滚动的区域里的按钮要监听 `click`，不要监听 `mousedown`。

根组件在自己画的内容里用 `data-slot="<插槽名>"` 标插槽(名字写在清单的 `panel.slots` 里)，用 `data-region="<名字>"` 标给弹层盖的区域。部件的元素在对应的插槽元素出现时才放进去并加载。经典外壳的插槽是 `candidates`、`textfield`、`layout`、`sidepage`、`sidebutton`，主体区域是 `body`(展开候选盖在上面)。

### ctx.kb(预装的输入法组件提供，要 inject)

键盘面板的页面里的输入状态和操作，由输入法组件的页面部分提供(它把远程服务 `keyboard` 包成页面里的服务)。用它的组件在清单写 `requires: ["keyboard"]`、在插件写 `inject: ['kb']`；输入法组件关着时这些组件不加载。别的面板的页面和媒体页面里没有 `kb`：要读键盘状态的组件用远程服务 `keyboard`(清单写 `uses` 或 `requires`)。

| 成员 | 说明 |
|---|---|
| `state` | 输入状态(Vue 响应式，见「输入状态」)，始终是同一个对象；每次推送只有内容变了的字段被赋值，`packs`、`pack`、`mode`、`candidates`、`outputs`、`settings` 内容没变时还是同一个对象；输入法的进程没在跑时内容是空状态(`ready` 为假、没有语言)；每次推送都发 `kb/change` 事件 |
| `pack` / `mode` | 当前语言和模式(输入法组件算好放在状态里) |
| `act(action)` | 发操作(见「操作」)；交给宿主就返回，同一页发的按先后送到 |
| `page(dir)` | 候选翻页：发 `kb/page` 事件给候选栏，`dir` 为 `-1` / `1` |
| `setOutput(id, on)` | 开关一个输出组件(「发送到」)，可以全关 |

### ctx.relay

页面里只有 `use`(见「远程服务」)，名字要在这一页某个组件清单的 `requires` 或 `uses` 里。

### ctx.slot

| 成员 | 说明 |
|---|---|
| `el` | 宿主给这个组件的元素：面板的根组件拿到整个页面的根元素，部件拿到所在插槽里属于自己的子元素 |
| `mount(render)` | 在 `el` 里渲染，返回卸载函数；写成 `ctx.effect(() => ctx.slot.mount(el => { …; return 清理函数 }))` |

插槽大小不固定，按 `el` 的大小自己排(`ResizeObserver`)。

### ctx.overlay

`open(render, { cover?, dismiss? })`：在根组件之上开一层弹层，返回关闭函数。`cover` 写根组件里某个 `data-region` 的名字就只盖住那块；`dismiss` 默认 `true`，点空白处关闭。VR 里原生的下拉框和右键菜单不显示，要弹出来的东西用它画。

### ctx.i18n

`locale` 是界面语言(`zh-Hans` / `zh-Hant` / `ja` / `en` / `ko`，响应式；主窗口里换了界面语言跟着换，页面不重载)；`text(t)` 按界面语言取清单写法的文案。

### 样式

页面组件可以用宿主的颜色变量(`--panel` `--surface` `--key` `--accent` 等，见 components.md 的「皮肤」)和类 `.card`、`.key`、`.icon-btn`，深色和皮肤会跟着变。

清单 `panel.sound` 为真的面板里，可用的按钮按下都有按键音；按钮带 `data-strong` 属性时用大键音(预装的发送按钮在用)。宿主的提示框样式是 `.fox-notice`。组件要让自己的内容用别的语言的字形时，在自己的元素上写 `lang`(见 [面板页面](panel-page.md#公共样式和按键音))。

## 主进程组件(MainContext)

### ctx.relay

`use` 和 `serve`，见「远程服务」。

### 键盘(远程服务 keyboard)

主进程组件经 `ctx.relay.use('keyboard')` 读键盘状态、发操作(清单写 `uses: ["keyboard"]`；没有输入法就不该加载的写 `requires`)：

| 用法 | 说明 |
|---|---|
| `kb.state` | 最新的输入状态(见「输入状态」)；输入法组件关着或它的进程没在跑时为 `null` |
| `kb.watch(fn)` | 状态变了回调 |
| `kb.tell('act', action)` | 发操作(见「操作」) |
| `kb.tell('insert', text)` | 在光标处插入 |
| `kb.tell('dictated', text, final)` | 听写结果：`final = false` 只显示在光标处，`true` 插入。只收用 `ctx.input.register` 接了听写的输入源组件发的，别的组件和页面发的被丢掉 |
| `kb.tell('dictationEnded')` | 听写在别处停了。同样只收接了听写的输入源组件发的 |

```js
const kb = ctx.relay.use('keyboard');
kb.tell('insert', '你好');
if (kb.state?.dictating) kb.tell('act', { kind: 'dictate' });
```

状态、操作、语言包、键盘设置的类型(`KeyboardState`、`KeyboardAction`、`KeyboardCalls`、`ImePack`、`KeyboardSettings` 等)和页面的 `KbService` 是输入法组件的约定，在 `sdk/keyboard.ts`，都从 `@konkon-lab/foxpanel-sdk` 导入。

### ctx.app

应用信息和对应用的操作。

| 成员 | 说明 |
|---|---|
| `info` | 最新的应用信息(`AppInfo`)：`locale` 界面语言；`components` 装着的全部组件(按组件顺序：`id`、`kind`、`name`、`dir`、`manifest`、`on` 开关开着、`active` 在用)；`outputs` 装着的输出组件(`id`、`name`、`on`、`live` 收不收实时内容、`typing` 能不能显示「正在输入」)；`inputs` 接了听写的输入源组件 id；`canDictate` 有没有输入源接了听写 |
| `watch(fn)` | 应用信息变了回调(登记时不调)，返回取消函数 |
| `setOn(id, on)` | 开关一个装着的输出组件(和组件页的开关是同一个改动)；别的组件不归这里开关，传了不处理 |
| `clipboard.read()` / `clipboard.write(text)` | 系统剪贴板的文字；读不了时得到空串 |

### ctx.output

`register(output)`：把这个组件注册成输出。类别是 `output`、开着、并且注册了的组件才收到发送；快捷设置里的「发送到」就是开关它们。

```js
ctx.output.register({
  send({ text, spoken, notify }) { … },   // text 原文，spoken 译文(没翻译时等于原文)，notify 提示音；可以返回 Promise
  live: true,                              // 也收自动送出和 PIN 的实时内容(默认 false)
  typing(on) { … },                        // 可选：「正在输入」
  clear() { … },                           // 可选：快捷设置里的「清除聊天气泡」
});
```

发送空文字表示清空显示(VRChat 聊天框就是这样)；朗读之类的输出自己忽略空文字。

使用侧(任何主进程组件都能调，预装的输入法组件发送时用的就是它们)：`send(payload, live)` 把一句(`{ text, spoken, notify }`)发给在用的输出，`live` 为真时只发给收实时内容的，返回收到的组件 id；`typing(on)` 让能显示的输出显示或收起「正在输入」；`clear()` 清除各输出显示的内容。

### ctx.input

`register({ start, stop })`：接管输入框的听写按钮(`kind: input`)。按下调 `start`，再按调 `stop`；有多个时用排在最前的。识别结果用 `ctx.relay.use('keyboard').tell('dictated', text, final)` 送回，自己结束时 `tell('dictationEnded')`。只往输入框里送字的输入源不用注册，直接 `tell('insert', text)`。

使用侧：`dictate(on)` 开、关听写，交给接了听写的输入源里组件顺序最前的那个。

### ctx.translator

`register(fn)`：翻译组件(`kind: translator`)注册翻译函数，`fn(text)` 返回译文(可以是 Promise)。发送、自动送出、PIN 前输入法组件先让它翻译，出错或超过 15 秒就用原文。输出组件拿到的 `spoken` 就是译文。

使用侧：`translate(text)` 交给登记了的翻译组件，返回译文；没有翻译组件时原样返回，出错或超时时失败。

```js
ctx.translator.register(async text => (await myApi(text)).translation);
```

### ctx.usage(预装的阿里云组件提供)

阿里云组件没开时没有这个服务，写 `ctx.get('usage')?.add(...)`。`add({ item, amount, cost? })`：记一笔用量(调用 AI 服务这类按量计费的组件用)。`item` 一般是模型名；`amount` 是各用量的数，单位在清单的 `usage.units` 里声明；`cost` 是这一笔的费用，按组件自己的价格表算，不知道价格时不写。阿里云组件按天、按项汇总(每笔自动加一次 `calls`)，自己往组件详情放「用量」一节(今天、最近 7 天、本月)、往仪表盘放费用卡片；账本的类型 `UsageBook` 在 SDK，主窗口组件要读账本时 `inject` 主窗口的 `usage` 服务。

```js
const { mp3, characters } = await synthesize(text);
ctx.get('usage')?.add({ item: model, amount: { chars: characters }, cost: characters / 10000 * price });
```

### ctx.osc(预装的 OSC 组件提供，要 inject)

- `on(address, fn)`：接收 VRChat 发来的 OSC，返回取消函数。有订阅时 OSC 组件才开接收(OSCQuery：随机端口 + mDNS，VRChat 自动找到，不占 9001；也可以在它的设置里改成固定端口)。回调里抛出的异常记进运行日志，不影响别的订阅；接收开不起来(比如固定端口被占)时每 10 秒重试。
- `send(address, args)`：发往 VRChat(OSC 组件设置里的发送端口)。

```js
ctx.effect(() => ctx.osc.on('/avatar/parameters/MuteSelf', muted => { … }));
ctx.osc.send('/chatbox/input', ['你好', true, false]);
```

### ctx.status

`set(item)`：状态栏里本组件的一项，`null` 去掉，组件停用时自动去掉。`item` 是 `{ led, label, value?, state?, rows? }`：`led` 为 `ok` / `wait` / `idle`(绿 / 黄 / 灰)，`label` 是名字，`value` 是名字后面的数，有 `state`(卡片标题行的状态文字)或 `rows`(`{ label, value }` 的行)时悬停弹出卡片。文字都可以是字符串或按语言分的对象。

```js
ctx.status.set({ led: 'ok', label: 'OSC', value: '↑ 3/H', state: { 'zh-Hans': '接收中', en: 'Receiving' }, rows: [{ label: '发送', value: '127.0.0.1:9000' }] });
```

### ctx.logs

`on(fn)`：收运行日志的每一行(`{ id, time, level, source, text }`)，先补发内存里已有的行，返回取消函数。预装的日志组件用它写日志文件。

### 显示方：ctx.panels 和远程服务 panels

显示方是把面板页面显示出来并处理交互的主进程组件(`kind: service`，清单 `provides` 里写 `panels`)。它做两件事：用 `ctx.panels` 让宿主开面板页面、收帧、发指点事件；用 `ctx.relay.serve('panels', …)` 发布每块面板的状态、接收开关面板的调用。预装的是 SteamVR 组件；同名的提供者有几个在用时组件顺序最前的那个生效，只有它开得了面板页面。显示方从 `serve` 返回的把手上看自己生效没有(`active`、`watch`)：等着的时候不开页面、不显示面板，生效了照布局显示，变回等着时把开着的页面都关掉。

`ctx.panels`(每个主进程组件都有，不是显示方也能读目录)：

| 成员 | 说明 |
|---|---|
| `list` | 面板目录：在用的组件声明的面板(`PanelInfo`)，按组件顺序。每项有 `id`、`name`、`icon`、页面宽高 `width` / `height`、`scale`、`fps`、`meters` / `minMeters` / `maxMeters`、`anchor`、`spawn`、`glance`、`keep`，都来自清单 |
| `watch(fn)` | 目录变了回调(登记时不调)，返回取消函数 |
| `open(id, mode?)` | 开一块面板的页面，返回页面的把手(`PanelFeed`)。`mode` 是 `'frames'`(默认：离屏渲染，一帧一帧交来)或 `'window'`(普通窗口)。不是生效的显示方、没有这块面板、页面已经有 12 个时，把手的状态变成 `failed`(显示方等着时不要开) |

页面的把手(`PanelFeed`)：

| 成员 | 说明 |
|---|---|
| `id`、`width` / `height`、`state` | 面板 id；纹理像素(窗口方式下是页面像素)，宿主告诉之前是 0；页面的状态 |
| `onFrame(fn)` | 收帧：`{ seq, handle, width, height }`。`handle` 是复制进本进程的 GPU 共享纹理的 NT 句柄(`bigint`)，宽高是这一帧纹理的实际像素(可能比 `width` / `height` 多几个像素，建纹理以帧为准)。用完自己关掉句柄并调 `release(seq)`；没登记帧回调时宿主发来的帧由组件进程关掉句柄并还回去 |
| `onDrop(fn)` | 宿主已经放掉这一帧(它替一页最多压着 4 帧，再来一帧时放掉最早的)：不能再用，关掉句柄，不用 `release` |
| `onSize(fn)`、`onState(fn)` | 纹理大小变了；页面的状态变了：`loading`、`ready`、`failed`(加载失败、页面的进程退出、开不了，`detail` 是原因)、`gone`(面板不在目录里了、窗口被关、被别的显示方接走) |
| `release(seq)` | 这一帧用完了 |
| `input(event)` | 指点事件(`PanelInput`)，坐标是纹理像素(窗口方式下是页面像素)：`{ kind: 'move', x, y, held }`(`held` = 左键按着)、`{ kind: 'down' / 'up', x, y }`、`{ kind: 'wheel', x, y, dx, dy }`(内容滚动的像素，`dy` 为正往下滚、`dx` 为正往右滚)、`{ kind: 'leave' }`(指针移出了面板) |
| `setPainting(on)` | 停画 / 恢复：停画时页面不出帧、`ctx.panel.visible` 为假，恢复时宿主让页面重画一帧；窗口方式下是隐藏 / 显示窗口 |
| `setFrameRate(fps)` | 改帧率，不超过面板清单里的上限 |
| `close()` | 关掉页面(页面里的状态没了)。组件停用时不用调：宿主自动放开它开的页面，页面留 120 秒，期间再 `open` 接回原页面 |

- 同一块面板全程序只有一页。同一个组件把同一块面板再开一次，得到的是同一页，宿主的消息都到后开的那个把手。
- 显示方的进程退出或重启时页面同样留 120 秒；页面里没发出去的内容都还在。
- 页面状态是 `failed` 时再 `open` 会重建页面。

远程服务 `panels` 的约定(类型都从 `@konkon-lab/foxpanel-sdk` 导入)：

每块面板开没开、在哪、附着在什么上、多宽、锁没锁都归显示方，存在它自己的组件数据里。面板进目录时(显示方第一次见到它，或者它的组件关掉后又打开)算打开；想让一块面板不出现，就关掉它的组件。显示方的选项、同时显示的上限、两个快捷位指向哪块面板是显示方自己的设置(在组件页改)，状态里照设置给出，没有改它们的远程调用。

状态 `PanelsState`：

| 字段 | 说明 |
|---|---|
| `display` | 显示方的名字 |
| `connected` | 显示方连上了(SteamVR 组件：连着 SteamVR)；没连上时面板都不在显示，布局照常能改 |
| `stowed` | 有面板被总开关收起着：`toggleAll` 会恢复它们 |
| `locked` | 全局锁：所有面板都不能抓、不能缩放 |
| `limit` | 同时显示的上限(块)。打开着的面板多过它时，快捷位指向的面板占着位置，其余的只显示目录里靠前的 |
| `options` | 显示方的选项(`DisplayOptions`)：`blockInput`(指着或抓着面板时挡住游戏按键)、`grabDelay`(抓取延迟，0 / 0.15 / 0.4 秒；附着在手上的面板固定 0.4 秒)、`stretch`(双手缩放)、`snap`(松手时摆正)、`recenter`(面板由不显示变成显示时的摆放：`never` / `away` / `always`；只管留在空间里的面板) |
| `panels` | 面板目录里的每一块(`PanelView`)，按组件顺序 |

每块面板(`PanelView`)：

| 字段 | 说明 |
|---|---|
| `id`、`name`、`icon?` | 面板 id(等于组件 id)、名字、图标地址 |
| `open` | 打开着；被总开关收起着的也算。面板用自己的收起按钮收起后、出错停用时是假。收起按钮收起的面板，按总开关显示面板时(`toggleAll`)一起回来 |
| `visible` | 这一刻在显示：打开着、没被总开关收起、显示方连着、没超过同时显示的上限；附着在头显或手柄上的还要那个设备在，抬手才显示的还要正面朝向眼睛。按布局算出来，显示方把窗口建出来可能晚几帧 |
| `pinned` | 常显：总开关不收起它 |
| `locked` | 锁定：不能抓、不能缩放，点击照常 |
| `anchor` | 附着在哪：`world` 留在空间里，`head` 跟着头显，`left` / `right` 跟着左手 / 右手的手柄。面板第一次出现时取清单的 `panel.anchor`，清单写附着在手上的一开始锁着 |
| `glance` | 抬手才显示：附着在手上时只在正面朝向眼睛时显示；附着在别处时不起作用。第一次出现时取清单的 `panel.glance` |
| `meters`、`minMeters`、`maxMeters` | 实际宽度(米)，和清单里能缩放到的范围 |
| `quick` | 显示方的设置里指向它的快捷位：`1`、`2`，`0` = 没有 |
| `error?` | 出错停用的原因。出错的面板算关着，再打开、总开关显示面板、显示方重新连上时重试 |

方法 `PanelsCalls`(没有返回值，结果都从状态里看)：

| 方法 | 说明 |
|---|---|
| `open(id, on)` | 打开或关掉一块面板，不动别的。有面板被总开关收起着时打开的这一块单独显示；显示着的已到上限时打不开(快捷位指向的面板除外)。关掉后位置和大小都留着；关着的面板按总开关显示面板时一起回来 |
| `toggleAll()` | 总开关：有面板藏着就全部显示；否则把打开着的非常显面板整组收起；两样都没有时不做任何事(出错停用的面板重试)。藏着 = 有面板被它收起着(`stowed`)，或者目录里有关着的面板(用自己的收起按钮、快捷位键、`open(id, false)` 关掉的；有没有快捷位指向它都算)。全部显示 = 恢复被收起的那一组、关着的面板都打开、出错停用的重试；打开着的多过上限时照上限的规则显示：快捷位指向的面板占着位置，其余的只显示目录里靠前的。出错停用的面板(没被关掉、只是带着 `error` 停用着)不算藏着，别的面板显示着时照样整组收起 |
| `summon(id?)` | 到面前：打开这块面板并按清单的 `spawn` 重新放到面前；不写 `id` = 显示着的面板都重新放。附着在头显或手柄上的面板位置不动(写了 `id` 时照样打开) |
| `reset(id)` | 回到清单的默认值：附着在哪、抬手才显示、宽度照清单，位置回到默认(留在空间里的按清单的 `spawn` 放到面前，附着的回到那个设备上的默认位置)，锁定照清单的附着对象(在手上的锁着，别的不锁)。常显不动 |
| `set(id, patch)` | 改一块面板，只改给了的项(`PanelPatch`)：`pinned`、`locked`、`meters`(夹在 `minMeters` 和 `maxMeters` 之间)、`anchor`、`glance`。设为常显的面板被总开关收起着时显示出来。`anchor` 变了时位置回到新附着对象的默认位置(`world` 是放到面前)；变成 `left` / `right` 时连带抬手才显示、锁上，宽度超过 0.3 米的缩到 0.3 米(不小于 `minMeters`)——同一次调用里给了的 `glance`、`locked`、`meters` 照给的 |
| `lockAll(on)` | 全局锁 |

- 提供方按 `unknown` 收参数、自己收窄：参数不对、目录里没有这块面板的调用不做任何事。
- 预装的 SteamVR 组件和开发用的显示方用的是同一个布局状态机(`components/_shared/panels/layout.ts`)和同一份调用的收窄(`calls.ts`)，都是纯函数；SteamVR 组件在连着时把一帧里的调用合成一次，下一帧见效(见 [SteamVR 悬浮面板](steamvr.md))。附着和抬手才显示只有 SteamVR 组件做出效果；开发用的显示方照样记进布局、出现在状态里、`set` 能改，窗口不跟着变。
- 页面里的 `ctx.panel.hide()` 就是宿主替它调 `open(这块面板的 id, false)`，调用者是 `{ component: 面板 id, where: 'panel' }`。这样收起的面板，按总开关显示面板时一起回来。要读面板状态、开关别的面板的组件在清单写 `uses: ["panels"]`，用 `ctx.relay.use('panels')`。

### ctx.appDir

程序目录的绝对路径(随程序带的 `vendor/` 在这里)。

### ctx.dataDir

数据文件夹的绝对路径(`%APPDATA%\FoxPanel`)。

### ctx.log(text, level?)

写进运行日志(主窗口「日志」页和组件详情里能看到；日志组件开着时写进它设置的目录)，来源是组件 id。页面组件和主进程组件都有；面板页面和媒体页面里宿主只收这一页加载的组件写的行。`level` 是 `info`(默认)、`warn`、`error`。预装组件的写法是英文小写短句，比如 `sent: 你好`、`synthesized 4 chars in 0.6s`。

## 两边都有

### ctx.id

本组件的 id(清单的 `id`)。页面组件、主进程组件、主窗口组件都有。

### ctx.storage

组件自己的数据，键值都是 JSON，页面和主进程两边是同一份，存在 `%APPDATA%\FoxPanel\component-data\<id>.json`，存成 JSON 后最多 1024 × 1024 个字符(UTF-16 码元)，卸载组件时删掉。面板页面、媒体页面和组件进程里的组件有，主窗口组件没有。面板页面和媒体页面里宿主只放行这一页加载的组件的读写，别的组件的数据读不到也改不了。

```js
await ctx.storage.set('phrases', ['你好', '晚安']);
const list = await ctx.storage.get('phrases');   // 没有时为 null
await ctx.storage.delete('phrases');
```

### ctx.bus

页面(面板页面、媒体页面、主窗口)和主进程组件之间发消息，经宿主转发(含发送方所在的页面或进程里的监听)。频道名写成「组件id/名字」，用在同一个组件的几部分之间：

- 面板页面和媒体页面里，发的频道、监听的频道都必须以这一页加载的某个组件 id 加 `/` 开头：发别的频道宿主不转给别处，监听别的组件的频道收不到，各记一行警告日志。`core/` 的频道能监听。
- 宿主只把页面里有监听的频道送到这一页(监听时自动登记，每页最多 256 个频道)。
- 页面发的一条消息：频道名最长 200 个字符；数据是普通数据(普通对象、数组、基本类型、二进制缓冲)，存成 JSON 不超过 256 KB(二进制按字节数算)。不合格的不转发。
- 主窗口组件和主进程组件发的、收的都不限。

```js
ctx.bus.on('me.hello/ping', data => { … });   // 返回取消函数；组件卸载时自动取消
ctx.bus.send('me.hello/ping', { n: 1 });
```

`core/` 开头的频道是核心发的通知，组件只监听、不要往里发(页面里发了送不出去)：

| 频道 | 数据 | 说明 |
|---|---|---|
| `core/component-removed` | 组件 id | 一个组件卸载完了(它的设置、secret、`ctx.storage` 数据已删)；替别的组件存了数据的组件在这时清理 |

### 事件

键盘面板的页面里输入法组件的页面部分发的事件(主进程组件用 `ctx.relay.use('keyboard').watch`)：

| 事件 | 说明 |
|---|---|
| `kb/change` | 输入状态变了，参数是 `ctx.kb.state` |
| `kb/page` | 候选翻页，参数 `-1` / `1` |

```js
ctx.on('kb/change', state => { … });
```

## 输入状态

远程服务 `keyboard` 的状态(`KeyboardState`)，页面里是 `ctx.kb.state`：

| 字段 | 说明 |
|---|---|
| `ready` | 输入法部署好了 |
| `text` `caret` `selStart` `selEnd` | 输入框文字、光标、选区(UTF-16 位置) |
| `composition` `compositionCaret` | 没上屏的输入串和其中的光标 |
| `candidates` | 候选 `{ index, text }[]` |
| `lang` `packs` | 当前语言 id、开着的语言(按顺序) |
| `dictating` `dictation` `canDictate` | 听写中、听写的半句、有没有输入源接了听写 |
| `outputs` | 装着的输出组件 `{ id, name, on }[]` |
| `settings` | 键盘设置(正在输入、自动送出、PIN、当前语言、各语言的模式)。深色不在这里：页面里读 `ctx.panel.dark`；键盘面板的宽度归显示方 |
| `uiLang` | 界面语言(页面组件的文案用 `ctx.i18n.locale`) |

## 操作

页面里 `ctx.kb.act(action)`、主进程里 `ctx.relay.use('keyboard').tell('act', action)` 的 `action`(`KeyboardAction`)：

| kind | 字段 | 说明 |
|---|---|---|
| `key` | `code`, `shift` | 按一个键(键位同 `KeyboardEvent.code`)，交给当前语言处理 |
| `text` | `text` | 直接插入文字 |
| `select` | `index` | 选候选 |
| `caret` | `position` | 放光标 |
| `range` | `start`, `end` | 选中一段 |
| `paste` / `copy` / `clear` | | 粘贴、复制、清空输入框 |
| `send` | | 发送给开着的输出 |
| `dictate` | | 开 / 关听写 |
| `clearOutputs` | | 清除各输出显示的内容 |
| `output` | `id`, `on` | 开关输出组件；`id` 不是装着的输出组件时不处理 |
| `lang` | `lang`, `mode?` | 切换语言(和模式) |
| `settings` | `patch` | 改键盘设置 |

格式不对的操作(`kind` 不认识、字段类型不对)被输入法组件丢弃；`settings` 的补丁里格式不对的项被忽略。

## 例子

一个把发送内容记下来的输出(主进程)：

```js
export default {
  name: 'me.history',
  apply(ctx) {
    ctx.output.register({
      async send({ text }) {
        if (!text) return;
        const list = (await ctx.storage.get('lines')) ?? [];
        await ctx.storage.set('lines', [text, ...list].slice(0, 100));
        ctx.bus.send('me.history/changed');
      },
    });
  },
};
```

同一个组件的页面部分(做成侧栏页时)：

```js
export default {
  name: 'me.history',
  apply(ctx) {
    ctx.effect(() => ctx.slot.mount(el => {
      const list = document.createElement('ol');
      list.className = 'card';
      el.append(list);
      const draw = async () => {
        const lines = (await ctx.storage.get('lines')) ?? [];
        list.replaceChildren(...lines.map(t => Object.assign(document.createElement('li'), { textContent: t })));
      };
      void draw();
      return ctx.bus.on('me.history/changed', draw);
    }));
  },
};
```

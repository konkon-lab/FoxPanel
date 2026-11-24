# 面板页面

一块面板是一页网页：核心为它开一个页面，加载同一个宿主页(`src/panel/`)。宿主只建 Cordis 根上下文、给服务、加载根组件、把部件挂进根组件的插槽；画面全部来自组件。这篇讲页面怎么组成、计划和外观、组件怎么加载和挂上去、公共样式，预装的键盘面板(经典外壳和它的部件)，以及跑音频的媒体页面。清单的 `panel` 字段、布局 JSON、皮肤的格式见 [组件格式](components.md)，`ctx` 上各服务的成员见 [SDK](sdk.md)，页面由谁打开、帧怎么交出去见 [组件进程](component-process.md#面板页面)。

## 页面

- 地址是 `fox://<面板 id>.panel/panel.html`(`fox://` 协议见 [组件管理](component-manager.md#fox-协议))。每块面板的主机名不同，各是一个源：localStorage、IndexedDB 互不相通，也和主窗口(`fox://host`)分开。这一页是哪块面板由核心按窗口认，不看地址。
- 窗口由核心建(`src/main/panel-window.ts`)，显示方式由显示方定：离屏窗口(画面是 GPU 共享纹理，一帧一帧交给显示方)或普通窗口(开发用的显示方)。两种都在沙箱里，preload 是窄的那一份(`src/preload/page.ts` → `dist/preload-page.cjs`)，`window.fox` 上只有 `PageApi`(`src/shared/types.ts`)的 14 个接口。
- 页面登记为面板页面(`src/main/senders.ts`)：能调的 IPC 只有取计划和外观、换深色、请显示方收起自己、远程服务的订阅和调用、总线、组件数据、写日志，并且只能用这一页加载的组件的 id、频道和它们声明了的远程服务；拿不到任何权限，不能导航到别的地址、不能开新窗口(见 [总体结构](architecture.md#安全边界))。
- 内容安全策略(`src/panel/panel.html`)：脚本、样式、图片、字体只能来自页面自己和 `fox:`(图片、字体另外允许 `data:`，样式允许内联)；没有放行任何外站，页面里取不了外面的地址；不能嵌框架(`iframe`)、不能开 worker、不能嵌插件。要联网的事放在组件的 `main` 部分。
- 共享库：页面的 import map 把 `vue`、`cordis` 指到宿主带的同一份文件(名单在 `src/shared/libs.ts` 的 `PANEL_LIBS`，import map 由 `scripts/build.ts` 生成)。组件 `import` 这两个模块时拿到的和宿主是同一份，别的依赖自己打进入口。

宿主页里的元素和类名：

| 元素 | 作用 |
|---|---|
| `#root`(类 `fox-panel fox-theme`) | 根组件的元素，宽高是计划里的页面尺寸 |
| `#overlay`(类 `fox-theme`) | 弹层容器：固定铺满页面，盖在根组件之上，自己不接鼠标 |
| `.fox-part.fox-<类别>`(带 `data-component="<id>"`) | 宿主给每个部件建的元素，放进根组件里对应的插槽元素 |
| `.fox-layer` | 弹层的一层 |
| `.fox-notice`、`.fox-notice.fox-failed` | 提示框；后一种是组件加载失败时宿主放的标记 |
| `html.fox-preview` | 页面显示在普通窗口里：页面底下垫棋盘格，看得出哪里是透明的 |

`document.title` 是根组件的名字(普通窗口的标题)。

## 计划和外观

页面启动时向核心取两样(都经 `window.fox`)：

**计划**(`fox.plan()`，类型 `PanelPlan`，由 `src/main/components/store.ts` 的 `panelPlans` 算)：这一页要加载什么。

| 字段 | 内容 |
|---|---|
| `id`、`size` | 面板 id；页面宽高(CSS 像素)，清单 `panel` 里写的 |
| `root` | 根组件：清单的 `panel.page`，铺满整页 |
| `parts` | 插槽名 → 这个插槽里的部件，按组件顺序。插槽名来自清单的 `panel.slots`；部件是在用的、类别等于插槽名的组件(有 `page` 入口的，或只有布局 JSON 的布局组件) |
| `services` | 根组件和部件 `requires` 的服务(沿提供者的 `requires` 逐层取)里有 `page` 入口的提供者，按组件顺序 |
| `remotes` | 这一页够得着的远程服务名：这一页各组件清单 `requires`、`uses` 写了的名字合在一起 |
| `skin` | 在用的皮肤 css 地址；没有皮肤时为 `null` |
| `sound` | 页面出不出声(清单的 `panel.sound`)；为真时宿主装按键音 |
| `preview` | 页面显示在普通窗口里 |

- 每个组件带 `id`、`kind`、`name`、`icon`(地址)、`config`(已补默认值，不含 secret)，和入口地址 `url`(`fox://component/<id>/<入口>?t=<入口文件的修改时间>`)或布局 JSON 的内容 `layout`。
- 一个插槽名在几块在用的面板里都声明了时，这类部件只装进组件顺序最前的那一块，其余面板的这个插槽是空的。
- 计划(整份 JSON)变了，核心让这一页重载；别的面板的页面不动。组件的开关、顺序、设置、皮肤都在计划里；入口和皮肤的地址带文件的修改时间，所以开发文件夹里保存入口文件或皮肤 css 之后，用到它的那块面板自己重载(入口 `import` 的别的文件、图标保存后不触发)。

**外观**(`fox.look()` 和之后的 `fox.onLook`，类型 `PageLook`)：深色还是浅色、界面语言。全部面板共用一份，存在核心设置的 `panels.dark` 和界面语言里；变了核心推给每个面板页面和媒体页面，页面不重载：宿主换 `#root`、`#overlay` 的 `dark` 类和 `lang`，`ctx.panel.dark`、`ctx.i18n.locale` 跟着变。

## 加载顺序

`src/panel/main.ts`：

1. 取外观和计划。
2. 有皮肤时把它的 `<link>` 加在公共样式之后；把 `#root` 设成计划里的尺寸；计划的 `sound` 为真时装按键音。
3. 给每个部件建好元素(这时还没放进页面)，根组件一加载就能从 `ctx.panel.parts(插槽名)` 看到有哪些部件。
4. 建 Cordis 根上下文，提供 `i18n`、`overlay`。
5. 开始加载 `services` 里的组件。它们不占插槽，用到它们服务的组件靠 `inject` 等服务出现。
6. 加载根组件，它的 `ctx.slot.el` 是 `#root`。
7. 挂部件(`src/panel/parts.ts`)：根组件里出现 `data-slot="<插槽名>"` 的元素时，把这个插槽的部件的元素放进去，第一次放进去时加载这个部件；根组件的内容每次变了再看一遍，到全部放好为止。所以根组件在等服务、晚一点才画出插槽时部件也挂得上，根组件重画换了插槽元素时部件的元素跟过去、不重新加载。

加载一个组件(`src/panel/services.ts` 的 `loadPlugin`)：从根上下文分出带 `id`、`config`、`storage`、`bus`、`log`、`relay`、`slot`、`panel` 的子上下文，`import()` 入口取默认导出，`ctx.plugin(入口, config)`。入口没有默认导出、导入或启动出错时：取消它登记的总线监听，往运行日志记一行 `page load failed: …`，在它的元素里放 `.fox-notice.fox-failed`(「⚠ 组件名」)；别的组件照常加载。宿主自己没有别的文字。

只有布局 JSON 的布局组件没有入口，宿主替它生成一个插件：`inject` 写 `keys`、`kb`、`overlay`、`i18n`，启动时调 `ctx.keys.mount(ctx, layout)`，由按键渲染服务来画(见下面「按键渲染」)。

两种等不到的情况各往运行日志记一行 warn(来源是那个组件，5 秒后查一次)：

| 情况 | 日志 |
|---|---|
| 组件的插件还在等 `inject` 里的服务 | `waiting for service: <服务名>`，每个等着的服务一行 |
| 根组件里一直没有部件要进的那个插槽元素 | `not loaded: the panel has no element for slot <插槽名>` |

## 宿主给的服务

| 服务 | 范围 | 来源 |
|---|---|---|
| `i18n`、`overlay` | 根上下文上的全局服务，组件写进 `inject` | `src/panel/main.ts` |
| `id`、`config`、`storage`、`bus`、`log` | 每个组件一份 | `src/panel/services.ts`、`src/shared/component-services.ts` |
| `slot` | 每个组件一份：根组件的是 `#root`，部件的是它在插槽里的元素，服务组件的是一个不在页面里的元素 | `src/panel/main.ts` |
| `panel` | 这一页的组件共用一份：面板 id、页面宽高、深色、显示状态、各插槽的部件、收起自己 | `src/panel/main.ts` |
| `relay` | 远程服务(只能用，不能提供)；这一页的组件共用一份订阅 | `src/panel/relay.ts` |
| 组件提供的服务(如 `kb`、`keys`) | 服务组件在页面代码里 `ctx.provide`：`kb` 来自输入法组件，`keys` 来自按键渲染 | 各服务组件 |

各服务的成员见 [SDK](sdk.md)。

- `relay` 只够得着计划 `remotes` 里的名字：订阅或调用别的名字被主进程拒绝，页面控制台里记一行错误。
- `storage` 读写的是主进程管的组件数据(见 [组件管理](component-manager.md))；`log` 写进运行日志(见 [运行日志](logs.md))。两样都只能用于这一页加载的组件。
- `bus`：消息在页面里的监听之间直接送达，同时经主进程转给组件进程和别的页面。发的频道、收的频道都要以这一页加载的某个组件 id 加 `/` 开头(另外能收核心的 `core/` 频道)；页面里有监听的频道向核心登记，核心只把登记了的频道送来(见 [总体结构](architecture.md#各部分之间怎么往来))。
- `panel.hide()`：核心替页面调远程服务 `panels` 的 `open(这块面板的 id, false)`，调用者是这块面板。没有显示方时无效。收起后算关着，位置和大小留着：按总开关显示面板时它一起回来；它的组件关掉再打开时也重新出现。
- `panel.visible`：显示方让这一页画着。显示方停画时为假，页面不出帧；用它停掉定时器和动画。留在空间里的面板等于正被显示着；附着在头显或手柄上的面板该显示而设备不在、没抬手时显示方不停画，这时它也是真。preload 里记着最近一次的显示状态，登记回调时先补一次(`src/preload/visible.ts`)。

主进程按窗口核对上面每一条：不满足的调用不处理，运行日志里记一行警告。

## 拖动滚动

VR 里手柄只有左键，没有滚轮。宿主给每个面板页面都装了拖动滚动(`src/panel/drag-scroll.ts`，整个文档上的捕获阶段监听)：

- 能滚动的区域 = `overflow`(那个方向的)是 `auto` 或 `scroll`、并且内容比它自己大的元素。从按下的元素往外找第一个这样的元素。
- 在这样的区域里按住左键，指针沿能滚的方向移动超过 8 像素(`DRAG_START_PX`)之后算拖动：内容跟着指针走(改 `scrollLeft` / `scrollTop`)，滚到头就停在头上。只能竖着滚的区域横着拖不算。
- 拖动过的那一次按下不算点击：松开后跟来的 `click` 到宿主这里为止，页面里别的监听都收不到。没拖过 8 像素就松开的照常是一次点击。
- 按下那一刻就做事的控件(监听 `mousedown` 的)拦不住。放在能滚动的区域里的按钮要监听 `click`；键区的键监听 `mousedown`，键盘面板里没有能滚动的区域(都是 `overflow: hidden`)，不受影响。
- 不是左键的按下不算；移动时左键已经不按着(在页面外面松开的)，这一次按下就结束。

普通窗口里(开发用的显示方)真鼠标的滚轮照常能用，拖动滚动也在。

## 插槽和部件

根组件在自己画的内容里用 `data-slot` 属性标出插槽，插槽名写在清单的 `panel.slots` 里。核心只把名字当插槽名：类别等于插槽名的部件组件装进这个插槽。

- 每个部件在插槽里有自己的元素 `<div class="fox-part fox-<类别>" data-component="<id>">`，填满插槽(侧栏按钮按内容大小)，就是它的 `ctx.slot.el`。
- `ctx.panel.parts(插槽名)` 给出这个插槽里的部件(`id`、`kind`、`name`、`icon`、`el`)，按组件顺序；列表是固定的，只有 `name` 跟界面语言变。根组件用它画页签、判断缺件，可以改部件元素的 `hidden`(比如只显示选中的那一页)。
- 清单的 `panel.slots` 里没写的插槽名，这类部件不进这块面板；写了而根组件里没有对应元素的，部件不加载并记一行日志。
- `ctx.slot.mount(render)` 返回的卸载函数先调 `render` 返回的清理函数，再清空元素。

## 弹层

`ctx.overlay.open(render, { cover, dismiss })` 每次在 `#overlay` 里新建一层(类 `fox-layer`)：

- 默认铺满页面；`cover` 写根组件里某个 `data-region` 的名字时，打开那一刻按那个元素的位置和大小盖住它(找不到这个区域时铺满页面)。
- `dismiss` 不是 `false` 时，在这一层的空白处按下鼠标就关闭。
- 返回的关闭函数先调 `render` 返回的清理函数，再移除这一层；重复调用没有影响。

VR 里没有原生的下拉框和右键菜单：离屏页面只交页面本身那一层的画面，原生弹出层不显示。要弹出来的东西用弹层画。

## 公共样式和按键音

`src/panel/style.css` 在所有组件之前加载：

- 颜色变量定义在 `.fox-theme`(浅色)和 `.fox-theme.dark`(深色)上，变量名见 [组件格式](components.md) 的「皮肤」；另有间隙 `--gap`(6px)，基础字号 14px。宿主按外观给 `#root` 和 `#overlay` 加 `dark` 类。
- 组件可用的类：`.card`(卡片)、`.key`(按键，按下时换底色并下沉 1px)、`.icon-btn`(44 × 44 的图标按钮)、`.fox-notice`(提示框)。
- 页面背景是透明的，根组件没画到的地方在 VR 里就是透明的。
- 字体按元素的 `lang` 属性选：

| `lang` | 字体 |
|---|---|
| 其他 | Noto Sans SC、Microsoft YaHei UI、Segoe UI |
| `zh-Hant` | Noto Sans TC、Microsoft JhengHei UI、Segoe UI |
| `ja` | Noto Sans JP、Yu Gothic UI、Meiryo UI、Microsoft YaHei UI、Segoe UI |
| `ko` | Noto Sans KR、Malgun Gothic、Microsoft YaHei UI、Segoe UI |

- 宿主把 `<html>`、`#root`、`#overlay` 的 `lang` 设成界面语言。组件要让自己的内容用别的语言的字形时，在自己的元素上写 `lang`：`#root` 里面带 `lang` 的元素只有 `ja`、`ko` 另选字体；`#overlay` 里面带 `lang` 的元素四种都按它选。

按键音在 `src/panel/click.ts`，计划的 `sound` 为真时才装：页面里任何没被禁用的 `<button>` 按下鼠标时响一声。波形在第一次按键时生成两段，普通键 45 毫秒、大键 60 毫秒，之后反复播放；每次播放速度在 0.94–1.06 倍之间随机，音量是 0.4(普通键)和 0.5(大键)。按钮带 `data-strong` 属性时用大键音。清单没写 `sound` 的面板，窗口是静音的。

## 皮肤

皮肤(`kind: skin`)只有一个 css 文件，没有代码。宿主把它的 `<link>` 加在公共样式之后，所以皮肤里同名的变量和规则盖过公共样式；css 里的图片、字体用相对路径，从 `fox://component/<id>/` 取。同时只有一个皮肤生效，它进每一块面板的页面；没有皮肤时就是公共样式的颜色。示例在 `examples/skin-warm/`。

## 键盘面板

键盘是预装的一块面板：根组件是经典外壳，候选栏、输入框、键区、侧栏页、侧栏按钮是挂进它插槽的部件，输入状态来自输入法组件。

| 组件 | 类别 | 内容 |
|---|---|---|
| `components/shell-classic` | `panel` | 经典外壳：键盘面板的根组件，1400 × 490，五个插槽 |
| `components/candidates` | `candidates` | 候选栏，可展开 |
| `components/textfield` | `textfield` | 输入框和清空、复制、听写、发送按钮 |
| `components/keys` | `service` | 按键渲染：提供 `keys` 服务，按布局 JSON 画键区和语言面板 |
| `components/ime`(页面部分) | `service` | 输入法组件在面板页面里的部分：提供 `kb` 服务，输入法没部署好时盖一层提示；不占插槽 |
| `components/layout-d68` | `layout` | D68 布局，只有 `layout.json`(五行)，`requires: ["keys"]` |
| `components/side-quick` | `sidepage` | 快捷设置 |
| `components/side-numpad` | `sidepage` | 小键盘 |
| `components/side-symbols` | `sidepage` | 特殊符号 |
| `components/button-paste` | `sidebutton` | 粘贴 |
| `components/button-theme` | `sidebutton` | 日夜切换 |

除了经典外壳、日夜切换和 D68 布局，上面的部件都在清单写 `requires: ["keyboard"]`(布局经 `keys` 间接要它)。它们都用 Vue 渲染，共用 `components/_shared/vue.ts`(把一个 Vue 组件挂进插槽或弹层、取上下文、按界面语言取文字)；键盘上的文字在各组件的 `src/words.ts`。

### 输入状态和操作

面板页面不处理输入，只显示状态、发出操作。页面里的 `kb` 服务不是宿主的：输入法组件的页面部分(`components/ime/src/page.ts`)经远程服务 `keyboard` 读状态、发操作，把它包成 `kb` 提供给键盘上的部件。

```
输入法组件的主进程部分 ── publish(状态) ──▶ 核心的远程服务通道 ──▶ 订阅了 keyboard 的页面 ──▶ 输入法的页面部分 ──▶ ctx.kb.state
键盘上的部件 ctx.kb.act ──▶ 输入法的页面部分 ── tell('act') ──▶ 核心(查这一页够不够得着 keyboard、填调用者) ──▶ 输入法组件(收窄字段、处理)
```

- 用 `kb` 的部件在清单写 `requires: ["keyboard"]`、在插件写 `inject: ['kb']`。输入法组件关着时它们不在计划里，键盘面板还在(经典外壳没写 `requires`)，候选栏、输入框、键区的位置显示「缺少…组件」。
- 每次推送来的是整份状态。页面的远程服务(`src/panel/relay.ts`)逐个字段比较内容，只给内容变了的字段赋值，输入法的页面部分再把换了值的字段写进 `kb.state`，所以没变的字段不触发依赖它的计算和渲染；随后发 `kb/change` 事件。
- `kb.state` 始终是同一个响应式对象。输入法组件开着、但它的进程没在跑(在重启)或 rime 在部署时内容是空状态或 `ready` 为假：输入法的页面部分(`components/ime/src/veil.ts`)用弹层盖住整页，显示「输入法部署中…」(文字跟界面语言，在 `components/ime/src/words.ts`)；盖着时点不到下面的键。
- `ctx.kb.act` 交给宿主就返回，不等输入法处理完；同一页发的操作按先后送到。
- `ctx.kb.page(dir)` 不出页面：发 `kb/page` 事件，候选栏收到后翻页。
- `ctx.kb.setOutput(id, on)` 等于发 `{ kind: 'output', id, on }`。
- 输入语言的字形：候选栏、展开的候选、输入框各自把输入语言(当前模式的 `lang`，模式没写时用语言的 `lang`)写在自己元素的 `lang` 上。候选栏和输入框在 `#root` 里，只在输入语言是日文、韩文时换字体；展开的候选在弹层里，四种语言都按输入语言选字体(繁体模式用繁体字体)。

状态的字段、操作的种类见 [SDK](sdk.md)，类型在 `sdk/keyboard.ts`；输入法组件怎么处理每个操作见 [输入法](input-method.md)。

### 经典外壳

`components/shell-classic/`，清单：

```json
{
  "id": "yanuo.shell-classic", "kind": "panel",
  "panel": {
    "page": "panel.js", "width": 1400, "height": 490, "fps": 60,
    "meters": 0.8, "minMeters": 0.4, "maxMeters": 1.6,
    "spawn": "low", "keep": true, "sound": true,
    "slots": ["candidates", "textfield", "layout", "sidepage", "sidebutton"]
  }
}
```

画面(`src/Shell.vue`)从上到下：

- 候选栏插槽(高 52px)、输入框插槽(高 56px)。
- 主体，标着 `data-region="body"`：左边是键区插槽；右边 340px 宽，里面是侧栏页插槽和一条 52px 宽的竖栏，竖栏上面是页签，下面是侧栏按钮插槽。

外壳自己管的两件事：

- **页签**：照 `ctx.panel.parts('sidepage')` 画，侧栏页多于一页时才显示。点页签选中那一页，其余侧栏页的元素设成 `hidden`；选过的那页不在了就回到第一页(`src/tabs.ts`)。页签图标是把组件的 svg 文件读成文字内联进来的，所以跟着文字颜色变；没有图标的页签显示名字的第一个字。
- **缺件提示**：候选栏、输入框、键区的插槽里没有部件时，在插槽里放一条「缺少…组件」(`.fox-notice`，五种界面语言的文字在 `src/words.ts`)。

### 候选栏

`components/candidates/src/`：

- 一行：从当前起点起最多渲染 40 个候选，量出完整放得下几个，放不下的隐藏；在第一页时第一个候选高亮。点一个候选发 `select`。
- 右端的按钮展开 / 收起全部候选。展开时开一层弹层盖住外壳的 `body` 区域(点空白处不关)，一页最多渲染 120 个，右边是上下翻页按钮；选了字就收起。
- 收到 `kb/page`：展开时翻一整页，否则翻候选栏的一行。
- 输入串变了回到第一页；输入串空了收起。

### 输入框

`components/textfield/src/TextField.vue`：

- 文字按字素排开；光标处插着输入串(带它自己的光标)，没有输入串时插着听写中的半句。光标始终滚动到可见范围内。
- 点在一个字的左半 / 右半，光标放到它前面 / 后面(`caret`)；点空白处放到末尾；按住拖动选中一段(`range`)；双击选中一个词。
- 右端四个按钮：清空(`clear`)、复制(`copy`)、听写(`dictate`，没有输入源接听写时不能按)、发送(`send`，大键音)。

### 按键渲染

`components/keys` 是服务组件，页面代码提供 `keys` 服务，只有一个方法 `mount(ctx, layout)`：在调用它的布局组件的上下文里校验布局 JSON、画进那个组件的插槽，返回卸载函数。布局组件在清单里写 `requires: ["keys"]`，按键渲染没开时布局组件不生效，键区的位置显示「缺少键盘布局组件」。

布局 JSON 的格式和限制见 [组件格式](components.md)，校验在 `components/keys/src/layout.ts`。不合格时往运行日志记 `layout is invalid: …`，插槽里显示第一条原因。

画法(`components/keys/src/Keys.vue`)：

- 1u 取「可用宽度 ÷ 最宽一行的 u 数」和「可用高度 ÷ 行数」里小的那个，下限 16px，插槽大小变了重新算。键宽是 `units × 1u − 间隙`，整块键区在插槽里居中。
- `code` 键发 `{ kind: 'key', code, shift }`：`letter` 键的 `shift` 是 Shift 和 Caps 合起来的大小写，其他键的 `shift` 就是 Shift。`text` 键发 `{ kind: 'text' }`，不经过输入法。
- Shift 按一次管一个字(打了一个 `letter`、`dual`、`text` 键后松开)，450 毫秒内连按两次锁定，锁定时再按一次解除。Caps 只影响字母(`letter` 键，和两个字符串是一对大小写的 `text` 键)，和 Shift 同时按下时相抵。
- 带 `repeat` 的键按住 420 毫秒后每 55 毫秒发一次，松开鼠标或移出键区时停。
- 当前语言有键帽(`keycaps`)时，字母键中间印键帽的字，左上角印拉丁字母，右上角印 Shift 的字；Shift 按下时中间和右上角对调。
- `pgup` / `pgdn` 调 `ctx.kb.page(-1)` / `ctx.kb.page(1)`。

语言键(`fn: "lang"`)按开着的语言数量变：

| 开着的语言 | 语言键 |
|---|---|
| 没有或一种 | 印当前语言的简称，不能按 |
| 两种 | 印「甲/乙」，当前的加深；按一下换成另一种 |
| 多于两种 | 印当前语言的简称和「▴」；按一下打开 / 关闭语言面板 |

语言面板(`LangPicker.vue`)是弹层：左边对齐语言键，底边在语言键上沿上方 8px，列出开着的语言，多于 6 种时排成两列。点一行切到那种语言(模式沿用它上次用的)并关掉面板，点面板外面也关掉。

模式键(`fn: "mode"`)印当前语言各模式的字(模式的 `key`，没写时取名字的第一个字)，用「/」隔开，当前的加深；按一下换到下一个模式。只有一种模式时不能按。

### 侧栏页和侧栏按钮

| 组件 | 做什么 |
|---|---|
| 快捷设置 | 三个开关：输入状态展示(`showTyping`)、自动送出(`autoSend`)、PIN 消息(`pinMessage`)，各发一个 `settings` 操作；「发送到」列出装着的输出组件，点一下开关(一个输出组件都没装时不显示)；底部是「清除聊天气泡」(`clearOutputs`) |
| 小键盘 | 数字和 `=` `/` `*` `-` `+` `.` 直接插入(`text`)；Enter 发回车键 |
| 特殊符号 | 30 个聊天常用符号，点一下插入 |
| 粘贴 | 发 `paste` |
| 日夜切换 | 读 `ctx.panel.dark`，按一下调 `ctx.panel.setDark`：全部面板一起换深色 / 浅色。它不用 `kb`，输入法关着时也在 |

各项设置的作用见 [输入法](input-method.md) 的「键盘设置」。带设置的侧栏页示例在 `examples/side-phrases/`。

## 媒体页面

媒体页面(`fox://host/media.html`，`src/panel/media.ts`)是一个不显示的窗口，用来跑输出、输入源、翻译组件的页面代码：Node 的组件进程不能播放音频和打开麦克风，这些事放在浏览器环境里做。

- 计划(`MediaPlan`，`src/main/components/store.ts` 的 `mediaPlan`)：在用的 `output` / `input` / `translator` 组件里有 `page` 入口的，加上它们 `requires` 的服务里有 `page` 入口的提供者；先加载服务，再加载组件。一个加载失败(已记进运行日志)不影响后面的。
- 和面板页面用同一份窄 preload 和 `src/panel/services.ts`：每个组件有 `id`、`config`、`storage`、`bus`、`log`、`relay`。根上下文上没有全局服务：没有插槽、弹层、`i18n`、`panel`。组件的页面部分和自己的主进程部分用 `ctx.bus` 通信。
- 生命周期(`src/main/pages.ts` 的 `MediaPage`)：有要加载的组件时才开窗口，一个都没有时关掉；计划(含各组件的设置)变了就重载页面。面板页面重载、有没有显示方都不影响它。窗口关掉了后台节流，隐藏着也照常跑定时器和音频。
- 麦克风权限(`media`)只给这个窗口；主窗口只能查看设备名(设置里选设备用)，面板页面查不到也申请不到，其余权限对哪个页面都一律拒绝(`src/main/senders.ts` 的 `limitPermissions`)。
- 窗口登记为媒体页面：能调的 IPC 只有取计划和外观、远程服务的订阅和调用、总线、组件数据、写日志；组件数据、日志、总线频道、远程服务的限制和面板页面一样，按这一页加载的组件算。够得着的远程服务按清单算，不分这个名字是组件的主进程部分还是页面部分在用：预装的听写组件清单写了 `uses: ["keyboard"]`(它的主进程部分用)，它开着时媒体页面里的组件也够得着 `keyboard`。
- 内容安全策略(`src/panel/media.html`)另外允许 `blob:` 脚本和 `blob:` / `data:` 媒体：听写组件的音频处理脚本(AudioWorklet)、语音合成组件播放的音频都是 `blob:` 地址。同样没有放行外站，不能嵌框架、不能开 worker。

播放和麦克风的具体流程见 [语音合成、听写、翻译](voice.md)。

## 源码

| 文件 | 内容 |
|---|---|
| `src/panel/panel.html`、`main.ts` | 面板页面宿主：取计划和外观、根上下文、根组件、弹层、字体和深色 |
| `src/panel/parts.ts` | 部件怎么挂进根组件的插槽；组件加载失败时放的标记(`markFailed`) |
| `src/panel/drag-scroll.ts` | 拖动滚动：判断和计算是纯函数，`watchDrag` 接到鼠标事件上，`installDragScroll` 装到页面的文档上 |
| `src/panel/services.ts` | 面板页面和媒体页面共用的组件服务和组件加载、等服务的日志 |
| `src/panel/relay.ts` | 页面里的远程服务：订阅、调用、状态按字段更新 |
| `src/panel/style.css`、`click.ts` | 公共样式、按键音 |
| `src/panel/media.html`、`media.ts` | 媒体页面 |
| `src/preload/page.ts`、`visible.ts` | 面板页面和媒体页面的 preload(`PageApi`)；显示状态的记着和补发(不导入 electron) |
| `src/main/panels.ts`、`panel-window.ts` | 核心持有的面板页面、面板窗口的适配 |
| `src/main/page-bus.ts` | 总线在页面一侧的登记和投递 |
| `src/main/pages.ts` | 媒体页面窗口 |
| `src/main/senders.ts`、`src/main/ipc.ts` | 各窗口是哪种页面的登记、权限和页面限制；页面 IPC 的注册和每个通道谁能调 |
| `sdk/keyboard.ts` | 输入状态、操作、语言、键盘设置、页面 `kb` 服务的类型(输入法组件的约定) |
| `components/ime/src/page.ts`、`veil.ts`、`empty.ts` | 输入法组件的页面部分(`kb` 服务)、部署提示、空状态 |
| `components/_shared/` | 预装页面组件共用的代码(Vue 挂载、图标、侧栏按钮、键位判断、输入框空着时按键的通知) |

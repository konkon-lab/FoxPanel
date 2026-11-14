# 组件格式

FoxPanel 的面板、面板里的部件(候选栏、输入框、键盘布局、侧栏页、侧栏按钮)、皮肤、语言、输出、服务都是组件。预装的组件和别人做的组件没有区别：都在主窗口 组件 页里装、开关、排序、改设置、卸载。

## 组件包

```
俄文键盘.zip
├─ component.json   清单
├─ layout.json      (按类别需要的文件：panel.js、page.js、layout.json、skin.css、rime/ …)
├─ icon.svg         图标(可选)
└─ LICENSE
```

`component.json` 也可以放在 zip 里唯一的子文件夹中(直接压缩一个文件夹的情况)。`npm run pack:component <文件夹>` 先校验清单再打成 `release/components/<id>.zip`。

开发时在主窗口 设置 → 常规 打开「开发者模式」，再到 组件 页的「安装组件」菜单里用「从文件夹加载」选组件文件夹；清单、布局 JSON、面板和页面的入口文件、皮肤 css、主进程入口保存后自动生效，主窗口入口要手动重载(见 [写一个组件](develop.md))。

## component.json

```json
{
  "id": "yanuo.layout-ru",
  "kind": "layout",
  "name": { "zh-Hans": "俄文键盘", "en": "Russian keyboard" },
  "description": { "zh-Hans": "ЙЦУКЕН 布局" },
  "version": "1.0.0",
  "author": "yanuo",
  "license": "MIT",
  "requires": ["keys"],
  "layout": "layout.json"
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | `作者.名字`，只用小写字母、数字和 `-`。同 id 再装一次 = 升级(开关、设置、secret、组件数据都保留) |
| `kind` | 是 | 类别，见下表 |
| `name` | 是 | 名字：一个字符串，或按界面语言 `{ "zh-Hans", "zh-Hant", "ja", "en", "ko" }`(缺的依次用简体中文、英文、第一个) |
| `version` | 是 | `x.y.z` |
| `author` `license` | 是 | |
| `description` | | 说明，写法同 `name` |
| `icon` | | 图标 svg(侧栏页的页签、组件页里显示)，用 `currentColor` 画线条 |
| `page` | | 页面入口(ES 模块，见「代码」)；`window` 组件跑在主窗口，输出、输入源、翻译组件跑在媒体页面，部件和服务组件跑在面板页面。`panel` 组件不写它(入口写在 `panel.page`) |
| `panel` | | 提供一块面板，见「面板」；`panel` 组件必须写，别的类别也能写 |
| `window` | | 主窗口入口(`window` 组件写在 `page`)：给主窗口组件提供服务、往主窗口的插槽放内容(仪表盘卡片、组件详情里的一节) |
| `main` | | 主进程入口(ES 模块，跑在组件进程里) |
| `process` | | `"own"` = `main` 跑在自己的组件进程里，不和别的组件共用；要和 `main` 一起写(见 [组件进程](component-process.md)) |
| `layout` | | 布局 JSON |
| `skin` | | 皮肤 css |
| `ime` | | 语言(格式由输入法组件校验，不合格的语言在它的日志里报出并跳过) |
| `config` | | 设置，Schema 声明(见下)，组件页按它生成表单 |
| `enabled` | | `false` = 装上时先关着(比如要先填 API Key 的)，默认 `true` |
| `repository` `bugs` | | 存储库、问题反馈的网址(http / https)，组件详情里显示成按钮 |
| `provides` | | 提供的服务名(小写字母、数字和 `-`)；只有 `service`、`window` 组件能写，`service` 组件必须写。见「服务」 |
| `requires` | | 必须有的服务名；没有在用的组件提供时这个组件不加载，主进程组件的 `ctx.config` 里会并进服务组件的设置和 secret(自己的同名项优先) |
| `uses` | | 会用、但没有也能工作的远程服务名；任何类别都能写，不影响这个组件加不加载。页面里的组件写了才够得着这个远程服务 |
| `usage` | | 记用量的组件：`{ "currency": "CNY", "units": { "chars": "字符", "calls": "句" } }`，主窗口按它显示用量和费用(`calls` 是宿主自动记的次数) |
| `dashboard` | | 仪表盘上的快捷设置卡：`{ "title": 文案, "keys": [config 里的键], "area": "left" / "right", "order": 数字, "toggle": 开关说明, "link": true, "grow": true }`。组件关着时也显示(`toggle` 在标题旁放组件开关，`link` 放「前往设置」)，`grow` 撑满所在列的剩余高度；和插槽 `dashboard` 里的卡片按 `order` 一起排 |

文件路径都是组件包里的相对路径，不能有 `..`。

所有组件都可以关掉，关掉后哪里不能用由用户自己负责。

| kind | 是什么 | 要有 | 同时开 |
|---|---|---|---|
| `panel` | 面板：一块 VR 里的网页面，入口是面板的根组件 | `panel` | 多个；各有各的页面 |
| `candidates` | 候选栏 | `page` | 一个，也可以都不用 |
| `textfield` | 输入框 | `page` | 一个，也可以都不用 |
| `layout` | 键盘布局 | `page` 或 `layout` | 一个，也可以都不用 |
| `sidepage` | 侧栏页 | `page` | 多个，可排序 |
| `sidebutton` | 侧栏按钮 | `page` | 多个，可排序 |
| `skin` | 皮肤 | `skin` | 一个，也可以都不用 |
| `lang` | 语言 | `ime` | 多个，可排序；可以全关(全关时直接打字母) |
| `output` | 输出(「发送到」) | `main` | 多个；可以全关 |
| `input` | 输入源 | `main` | 多个 |
| `translator` | 翻译：发送前把原文翻成译文 | `main` | 一个，也可以都不用 |
| `window` | 主窗口页面：侧栏入口和一整页(见 [主窗口](main-window.md)) | `page` | 多个，按顺序排 |
| `service` | 服务：给声明 `requires` 的组件用。可以只有设置(比如阿里云的 API Key 和地址)；也可以带代码，用 `ctx.provide` 提供服务对象：`main` 在组件进程(如 OSC、用量)，`page` 在用到它的面板页面(如按键渲染)，`window` 在主窗口 | `provides` | 多个 |

- `candidates`、`textfield`、`layout`、`sidepage`、`sidebutton` 是部件类别：类别名就是插槽名，挂进清单 `panel.slots` 里写了这个名字的面板。一个插槽名在几块在用的面板里都写了时，这类部件只装进组件顺序最前的那一块。
- 只有布局 JSON(没有 `page`)的布局组件由按键渲染组件来画，清单要写 `"requires": ["keys"]`。
- 把面板显示出来的显示方是 `service` 组件：`provides` 里写 `panels`，见 [SDK](sdk.md#显示方ctxpanels-和远程服务-panels)。

### 面板

清单里写 `panel` 字段的组件提供一块面板，面板 id 就是组件 id。`kind: panel` 的组件只提供面板；别的类别(比如一个带主进程代码的 `service` 组件)也可以另外写一块。

```jsonc
"panel": {
  "page": "panel.js",            // 必填：根组件入口(ES 模块，默认导出 Cordis 插件)，组件包内的相对路径
  "width": 480, "height": 320,   // 必填：页面宽高(CSS 像素)，各是 64–4096 的整数
  "scale": 1,                    // 纹理倍数 1 / 1.5 / 2：纹理像素 = 页面像素 × scale；小字多的面板用 2
  "fps": 30,                     // 帧率上限，1–60 的整数
  "meters": 0.5,                 // 默认宽度(米)
  "minMeters": 0.1, "maxMeters": 2,   // 用户能缩放到的宽度范围(米)
  "anchor": "world",             // 第一次出现时附着在哪：world(留在空间里) / head(头显) / left / right(左手 / 右手的手柄)
  "spawn": "front",              // 第一次出现的位置：front(正前方) / low(前下方) / side(右前方)
  "glance": false,               // 抬手才显示：附着在手上时只在正面朝向眼睛时显示；anchor 是 left / right 时默认 true
  "keep": false,                 // 收起后页面不关(页面里的状态留着)
  "sound": false,                // 页面出声：按钮按下有按键音；false 时页面静音
  "slots": []                    // 根组件有哪些插槽(名字)；默认没有，不加载任何部件
}
```

校验(`src/shared/manifest.ts` 的 `parsePanel`)：写了的值不合格一律报错，不替它换成合格的值。

| 报错 | 规则 |
|---|---|
| `panel 组件要有 panel 字段` | `kind: panel` 必须写 `panel` |
| `panel 组件的入口写在 panel.page，不写 page` | `kind: panel` 不能再写顶层的 `page` |
| `panel 要是对象` | |
| `panel.page 要是组件包内的相对路径` | 不能是绝对路径、不能有 `..`；安装时还查这个文件在不在 |
| `panel.width 和 panel.height 要是 64–4096 的整数` | |
| `panel.scale 只能是 1、1.5、2` | |
| `panel 的纹理(宽 × 高 × scale²)不能超过 4194304 像素` | 1400 × 490 开 2 倍是 274 万 |
| `panel.fps 要是 1–60 的整数` | |
| `panel.minMeters ≤ panel.meters ≤ panel.maxMeters，都在 0.05–3 米` | 没写 `minMeters`、`maxMeters` 时范围是 0.1–2 米；默认宽度在这之外时范围放到默认宽度(`meters: 0.08` 不用另写 `minMeters`) |
| `panel.anchor 只能是 world / head / left / right`、`panel.spawn 只能是 front / low / side` | |
| `panel.glance 要是 true / false`(`keep`、`sound` 同) | |
| `panel.slots 要是插槽名数组(小写字母、数字和 -)` | 重复的只留一个 |

- 这些项哪些生效由显示方定：`width`、`height`、`scale`、`fps`、`sound`、`slots` 由核心用在页面上；摆放的几项(`meters`、`minMeters`、`maxMeters`、`anchor`、`spawn`、`glance`、`keep`)是给显示方的，显示方不支持的就不起作用：预装的 SteamVR 组件这几项都用(见 [SteamVR 悬浮面板](steamvr.md#附着的面板))，开发用的显示方只把它们记进布局。
- `anchor`、`glance` 是面板第一次进显示方的布局时的取值，之后以布局里记的为准(经远程服务 `panels` 的 `set` 改，`reset` 回清单的值)。`head` 的面板跟着头显走，`left` / `right` 的跟着那只手的手柄走、一开始锁着、那只手的射线点不到它(用另一只手指和点)；`glance` 为真时手垂着不显示，面板的正面转向眼睛才显示。附着的面板没摆过时在设备上的默认位置：头显前方 0.45 米、下方 0.25 米；手柄靠手腕、朝手背的一侧。手上的面板要小：宽度 0.3 米以内，页面也小、字要大(示例 [`examples/panel-wrist/`](../examples/panel-wrist))。
- 面板进面板目录时(组件装上、打开)就算打开，跟着显示方的总开关一起显示；想让一块面板不出现，就在组件页关掉它的组件。面板用自己的收起按钮(`ctx.panel.hide()`)收起后，按总开关显示面板时一起回来；它的组件关掉再打开时也重新出现。清单里没有控制「装上后先不显示」的项。
- 面板里没有原生的下拉框、右键菜单和键盘焦点，VR 里只有指着点和按住拖；页面不能联网(放在组件的 `main` 部分)。见 [写一个组件](develop.md#二写一块面板)。

预装的键盘面板(经典外壳)的清单见 [面板页面](panel-page.md#经典外壳)。它不写 `requires`：输入法关着时键盘面板还在，由它在空插槽里显示缺件提示。

### 服务

`provides`、`requires`、`uses` 都是服务名数组，重复的只留一个。

- `provides`：这个组件提供的服务。带代码的在同一个运行环境里用 `ctx.provide` 给出服务对象，跨进程、跨页面用的在主进程代码里用 `ctx.relay.serve` 登记成远程服务(见 [SDK](sdk.md#远程服务ctxrelay))。同名的远程服务有几个提供者在用时，组件顺序最前的那个生效。
- `requires`：没有在用的提供者时，这个组件整个不算在用，哪个运行环境都不加载它。这一条沿着提供者传下去：提供者自己因为缺服务不算在用时，要它的组件也不算。组件页的详情里列出每个必需的服务有没有在用的提供者。
- `uses`：只是声明会用，没有提供者时照常加载，代码里按服务不在的情况处理(远程服务的状态是 `null`)。
- 面板页面、媒体页面里的组件只够得着清单 `requires`、`uses` 里写了的远程服务，按整页算：这一页的组件里有一个写了某个名字，这一页的组件就都够得着它。主进程组件用远程服务不受清单限制，写上是为了说明依赖、让关掉提供者时的表现对得上。

预装组件里：用页面 `kb` 服务的候选栏、输入框、按键渲染、三个侧栏页、粘贴按钮写 `requires: ["keyboard"]`(输入法组件关着时它们不加载，经典外壳在空着的位置显示缺件提示)；日夜切换按钮只用 `ctx.panel`，不写；D68 布局写 `requires: ["keys"]`；听写组件写 `uses: ["keyboard"]`(没有输入法时照常工作)；SteamVR 组件写 `provides: ["panels"]`，不用 `keyboard`。

带代码的组件(有 `panel` / `page` / `window` / `main`，或包里带 `.lua`)安装时会提示：能在电脑上运行任意程序，只装信任的来源。

### 设置(config)

`config` 是 Schema 节点的 JSON(`type` / `dict` / `list` / `inner` / `meta`)。一节是一个 `object`，多节用 `intersect`；节的 `meta.description` 是节标题，不写时第一节叫「基础设置」。各节的键合在一起存成一层，不能重名。

```json
"config": {
  "type": "intersect",
  "list": [
    {
      "type": "object",
      "dict": {
        "label": { "type": "string", "meta": { "description": "文字", "default": "Hi" } },
        "count": { "type": "number", "meta": { "description": "次数", "hint": "每次发几条", "default": 3, "min": 1, "max": 5, "step": 1 } },
        "loud": { "type": "boolean", "meta": { "description": "大写", "default": false } },
        "voice": {
          "type": "union",
          "list": [{ "type": "const", "value": "a", "meta": { "description": "A" } }, { "type": "const", "value": "b", "meta": { "description": "B" } }],
          "meta": { "description": "音色", "default": "a" }
        },
        "apiKey": { "type": "string", "meta": { "description": "API Key", "role": "secret" } }
      }
    },
    {
      "type": "object",
      "meta": { "description": "高级设置" },
      "dict": {
        "ports": { "type": "array", "inner": { "type": "number", "meta": { "min": 1, "max": 65535 } }, "meta": { "description": "目标端口", "default": [], "visible": { "loud": true } } }
      }
    }
  ]
}
```

| 节点 | 控件 | meta |
|---|---|---|
| `boolean` | 开关 | `default` |
| `number` | 步进器(− 数字 +)，按 `step` 加减，按 `min` / `max` 夹住 | `default`、`min`、`max`、`step` |
| `number` + `role: "slider"` | 滑块，要写 `min` 和 `max` | 同上 |
| `string` | 文字框 | `default` |
| `string` + `role: "secret"` | 密钥：系统凭据加密保存，主窗口只显示前 4 位和后 2 位(预览只在内存里)，明文只交给主进程组件 | `share`：同一个名字的 secret 只存一份，几个组件共用，卸载时不删 |
| `string` + `role: "audioOutput"` / `"audioInput"` | 音频设备下拉，值是 deviceId，空 = 系统默认 | |
| `string` + `role: "directory"` | 「目录：名字」按钮，点开在数据文件夹里选文件夹(不用系统资源管理器)；值是相对数据文件夹的路径，`/` 分隔 | `default` |
| `union`(成员都是 `const`) | 下拉，只收 `list` 里的值；`const` 的 `meta.description` 是选项名 | `default`；`custom: true` 也能直接输入别的值；`optionsFrom: { setting, value, label, sub? }` 选项另外取自一个表格的各行：`setting` 是那个表格设置的键，`value` / `label` 是当选项值和选项名的列，`sub`(可选)是显示成选项旁小字的列(那一格留空时小字显示「自动」) |
| `union` + `role: "radio"` | 分段按钮 | 同上 |
| `array`，`inner` 是 `object`(字段都是带 `meta.description` 的 `string`) | 多行表格，值是 `{ 字段: 文字 }[]` | `default` 行 |
| `array`，`inner` 是 `number` / `string` | 标签列表：输入后回车添加，点叉删除，重复的不加 | `default`；`inner.meta` 的 `min` / `max` 限制数字 |

每个设置项的 `meta`：

- `description`：名字，必填；`hint`：名字下面的一行说明。写法都可以是字符串或按语言分的对象。
- `visible: { 设置键: 值 或 [值…] }`：这些设置等于这些值时才显示(只影响显示，值照样保存)。

没有设置的组件不写 `config`，组件页不显示设置这一节。

- 页面组件在 `ctx.config` 里拿到设置(已补默认值，不含 secret)。

## 键盘布局 JSON

```json
{
  "rows": [
    [
      { "id": "yo", "text": ["ё", "Ё"] },
      { "id": "1", "code": "Digit1", "dual": ["1", "!"] },
      { "id": "back", "code": "Backspace", "icon": "back", "units": 2, "repeat": true }
    ],
    [
      { "id": "shift", "fn": "shift", "icon": "shift", "units": 2.25 },
      { "id": "gap", "spacer": true, "units": 0.5 },
      { "id": "q", "code": "KeyQ", "letter": "q" }
    ]
  ]
}
```

最多 12 行，每行最多 40 个键。每个键必须有 `code`、`text`、`fn` 之一(只能一个)，或是 `spacer`：

| 字段 | 说明 |
|---|---|
| `id` | 行内不重复 |
| `units` | 宽度，默认 1，最大 20；1u 按最宽一行和行数，在插槽里放得下的最大值算 |
| `code` | 发给输入法的键位，同浏览器 `KeyboardEvent.code`：`KeyA`–`KeyZ`、`Digit0`–`Digit9`、`Backquote` `Minus` `Equal` `BracketLeft` `BracketRight` `Backslash` `Semicolon` `Quote` `Comma` `Period` `Slash` `Space` `Backspace` `Delete` `Tab` `Enter` `Home` `ArrowLeft` `ArrowRight` `ArrowUp` `ArrowDown` |
| `text` | `[平时, Shift]`：直接插入这段文字，不经过输入法，每个字符串 1–8 个字符。两个是一对大小写字母时，Caps 也会换大写 |
| `fn` | `shift`(按一次管一个字，连按两次锁定)、`caps`、`pgup` / `pgdn`(候选翻页)、`lang`(切换语言)、`mode`(切换模式) |
| `letter` | 配合 `code`：印这个字母，Shift / Caps 换大写；当前语言有键帽时印键帽 |
| `dual` | 配合 `code`：`[平时, Shift]` 两个字符串印在键上，每个 1–8 个字符 |
| `label` | 功能键上的字；`icon`：`back` / `shift` 图标 |
| `repeat` | 按住连发 |
| `spacer` | 空位，只占宽度 |

## 皮肤

`skin.css` 在面板页面的公共样式之后加载，进每一块面板的页面；图片、字体用相对路径。可以改这些颜色变量，也可以写任意 CSS：

```css
.fox-theme { --panel: #f6efe4; --key: #efe3d1; --accent: #c0632b; }
.fox-theme.dark { --panel: #1e1915; --key: #3a3029; }
.fox-theme .key { border-radius: 10px; }
```

| 变量 | 用在 |
|---|---|
| `--panel` | 面板底色 |
| `--surface` | 卡片(候选栏、输入框、侧栏页) |
| `--key` `--key-down` | 按键、按下的按键 |
| `--line` `--edge` | 分隔线、按键下沿 |
| `--text` `--sub` | 文字、次要文字 |
| `--accent` `--accent-soft` | 强调色、浅强调底 |
| `--track` `--track-on` | 页签底槽、选中的页签 |
| `--switch-off` `--knob` | 关着的开关、开关圆钮 |

`.fox-theme` 是面板页面的根元素和弹层容器都带的类，`.fox-theme.dark` 是深色(全部面板共用一个开关)。

## 语言

```json
{
  "id": "yanuo.lang-xiaohe",
  "kind": "lang",
  "name": "小鹤双拼",
  "version": "1.0.0",
  "author": "yanuo",
  "license": "LGPL-3.0-only",
  "ime": {
    "short": "鹤",
    "lang": "zh-Hans",
    "schema": "xiaohe",
    "modes": [
      { "id": "simplified", "key": "简", "switches": { "zh_simp_s2t": false }, "label": { "zh-Hans": "简体", "en": "Simplified" } },
      { "id": "traditional", "key": "繁", "switches": { "zh_simp_s2t": true }, "lang": "zh-Hant", "label": { "zh-Hans": "繁体", "en": "Traditional" } }
    ]
  }
}
```

rime 方案文件放组件包的 `rime/` 文件夹(可以有子文件夹，如 `lua/`)。方案可以用内置词库(四叶草拼音、OpenCC 等)，只带方案文件。

`ime` 的字段：

| 字段 | 说明 |
|---|---|
| `schema` | rime 方案 id，`rime/` 或内置数据里要有 `<schema>.schema.yaml`；`engine` 为 `hangul` 时不用 |
| `engine` | `rime`(默认)或 `hangul`(内置韩文拼字) |
| `short` | 语言键上的简称，1–4 个字，默认取名字的第一个字(名字有多种语言时取简体中文的，没有就取第一种) |
| `lang` | 文字语言(BCP 47)，用来选字体，如 `ja`、`ko`、`zh-Hant` |
| `modes` | 模式列表，模式键按顺序轮流切换；不写就是只有一种 |
| `enter` | 输入中按回车：`raw` 上屏字母(默认)，`rime` 交给方案处理 |
| `latin` | `true` = 拼音文字(像英文单词)：大写字母也进输入串，空格、数字、符号先上屏再原样插入 |
| `keycaps` | 字母键上另外印的字：`{ "a": ["あ"], "s": ["さ", "ざ"] }`，第二个是 Shift 时的字；`engine` 为 `hangul` 时不写就印两套式字母 |

模式的字段：

| 字段 | 说明 |
|---|---|
| `id` | 必填，同一个语言里不重复 |
| `label` | 必填，写法同 `name` |
| `key` | 模式键上的字，1–2 个字，默认取 `label` 的第一个字 |
| `schema` | 这个模式换用的方案 |
| `switches` | 选方案后设的 rime 开关，如 `{ "simplification": true }` |
| `direct` | `true` = 不经过输入法，直接打字母 |
| `output` | 不出候选，上屏输入串：`composition` 原样，`katakana` 换成片假名 |
| `lang` | 这个模式的文字语言 |

输入法组件同步语言文件时的检查(不过的语言被跳过并记进运行日志)：`rime/` 里的文件不能和内置词库、程序自己的配置(`default.custom.yaml`、内置方案的 `*.custom.yaml`)或别的语言的文件同名。语言装上或卸载后 rime 会重新部署，期间键盘显示部署中；开关和排序不用重新部署。rime 记住的用户词(`*.userdb`)卸载后保留。

## 代码

`panel.page`(面板的根组件)、`page`(页面)和 `main`(主进程)入口都是 ES 模块，默认导出一个 Cordis 插件。宿主给的服务、事件、操作见 [sdk.md](sdk.md)。

- 面板的根组件铺满整页，用 `data-slot="<插槽名>"` 标出插槽(名字要写在清单的 `panel.slots` 里)，用 `data-region="<名字>"` 标出给弹层盖的区域。经典外壳的插槽是 `candidates` / `textfield` / `layout` / `sidepage` / `sidebutton`，主体区域是 `body`。
- 根组件用 `ctx.panel.parts(插槽名)` 知道插槽里有哪些部件(画页签、显示缺件提示)。
- 输出组件(`kind: output`)用 `ctx.output.register` 注册；输入源(`kind: input`)用 `ctx.relay.use('keyboard').tell('insert', 文字)` 送字，或用 `ctx.input.register` 接管听写按钮；翻译组件(`kind: translator`)用 `ctx.translator.register`。
- 面板页面里用输入状态的组件(候选栏、输入框、侧栏页、侧栏按钮、带 `page` 的布局)在清单写 `requires: ["keyboard"]`，在插件写 `inject: ['kb']`。
- 输出、输入源、翻译组件也可以带 `page` 入口：它跑在**媒体页面**(隐藏窗口，能播放音频、打开麦克风，没有插槽)，和自己的 `main` 部分用 `ctx.bus` 通信。

## 存放位置

- 组件：`%APPDATA%\FoxPanel\components\<id>\`；从 npm 装的在 `components\node_modules\<包名>\`(见 [组件市场](market.md))
- 设置：`%APPDATA%\FoxPanel\config.json`(读不了、不是 JSON 或内容不是对象时按默认设置启动，原文件另存一份 `config.json.bad`)；secret：`secrets.json`(加密)
- 面板页面自己存的东西(localStorage、IndexedDB)：每块面板一个源，互不相通；要跟组件走的数据放 `ctx.storage`
- 语言的 rime 文件：`%APPDATA%\FoxPanel\rime\data\`
- 组件自己的数据(`ctx.storage`)：`%APPDATA%\FoxPanel\component-data\<id>.json`

组件目录、设置、secret、组件数据的规则见 [组件管理](component-manager.md)。

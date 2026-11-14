# 写一个组件

组件就是一个文件夹：一个 `component.json` 清单，加上它需要的文件。下面从零做四个，分别是数据组件、一块面板、面板里的部件、主进程组件。完整的格式见 [components.md](components.md)，服务和事件见 [sdk.md](sdk.md)，能直接照着改的例子在 [`examples/`](../examples)。

## 开发环境

1. 新建一个文件夹，比如 `D:\my-components\hello`。
2. 主窗口 → 设置 → 常规，打开「开发者模式」；再到 组件 页，点「安装组件」→「从文件夹加载」，选这个文件夹。
3. 之后改文件夹里的文件，大约 0.3 秒后自动生效，不用重新安装：
   - 清单、布局 JSON 改了：用到它的那块面板重载。
   - 面板的入口(`panel.page`)、部件和服务的页面入口(`page`)、皮肤 css 保存了：用到它的那块面板(输出、输入源、翻译的 `page` 是媒体页面)自己重载。入口 `import` 的别的文件、图标保存后不触发，再保存一次入口文件。
   - 主进程入口文件(`main`)改了：这个组件在组件进程里重新加载。
   - 主窗口入口(`window`，`window` 组件的 `page`)改了：主窗口不会自己重载，在主窗口里按 `Ctrl+R`，或把组件关掉再打开。
4. 组件详情里有「开发中，从文件夹加载」的提示；移除它只去掉登记，不删文件夹。

用安装版就能写组件。用源码版(`npm start`，环境要求见 [贡献指南](../.github/CONTRIBUTING.md#开发环境))时：它和安装版用同一个数据文件夹(`%APPDATA%\FoxPanel`)，同时只能开一个；要和平时用的那份数据分开，用 `npm start -- --user-data-dir=<文件夹>` 另指定一个数据文件夹。

### 不用 SteamVR 调试面板

用源码版带环境变量 `FOXPANEL_PANELS=1` 启动(值要是 `1`；打包后的程序不看这个变量)：程序加载开发用的显示方(`dev/display-desktop/`)，每块显示着的面板是一个普通窗口，在窗口里按 `Ctrl+Shift+I` 打开 DevTools 看报错。

| 终端 | 命令 |
|---|---|
| PowerShell | `$env:FOXPANEL_PANELS='1'; npm start` |
| cmd | `set FOXPANEL_PANELS=1&& npm start` |
| Git Bash | `FOXPANEL_PANELS=1 npm start` |

PowerShell 和 cmd 里设的变量在这个终端里一直有效：要真的进 VR 时关掉这个终端，或清掉变量(PowerShell `Remove-Item Env:FOXPANEL_PANELS`，cmd `set FOXPANEL_PANELS=`)。文档里别的环境变量(`FOXPANEL_VR_SIM`、`FOXPANEL_RECORD_CALLS`、`FOXPANEL_NPM`)带法相同。

- 它只在这次运行里加载、排在全部显示方前面，是生效的显示方(SteamVR 组件这次等着：不连 SteamVR、不显示面板)；不出现在组件页、市场、依赖管理里，安装包不带。它也照这个信号做事：登记没生效时一个窗口都不开、状态里算没连上。
- 面板进目录就打开(和 SteamVR 组件用的是同一个布局状态机，没有总开关收起着的初始状态)，所以开发中的面板一加载就有窗口。收起一块面板是隐藏它的窗口；清单没写 `keep` 的隐藏满 60 秒关掉页面，再打开时重新加载。关掉窗口等于收起这块面板。收起的面板在别的面板调 `toggleAll` 时一起回来，和 VR 里按总开关键一样。
- 它提供完整的远程服务 `panels`(`open`、`toggleAll`、`summon`、`reset`、`set`、`lockAll`)：清单写了 `uses: ["panels"]` 的面板能在这里把开关别的面板、常显、锁、改宽度、换附着对象都试一遍。宽度、锁、位置、附着在哪、抬手才显示在窗口上没有效果，照样记进布局、进状态；布局只在内存里，不存盘。页面出错一次这块面板就出错停用(SteamVR 组件是 10 秒里 3 次)。
- 同时显示的上限和两个快捷位是它的设置(`limit`、`quick1`、`quick2`)，它不在组件页里，要改就写进数据文件夹 `config.json` 的 `settings.components.config["yanuo.display-desktop"]`。
- 窗口方式和 VR 里不一样的地方：

| | 普通窗口 | VR 里 |
|---|---|---|
| 指点 | 真鼠标：有悬停、滚轮、右键、双击 | 只有指着移动、扣扳机(左键按下 / 松开)、按住拖；没有悬停不动的状态、没有右键 |
| 键盘 | 实体键盘能往有焦点的输入框打字 | 没有键盘焦点 |
| 原生弹出层 | 下拉框、右键菜单照常显示 | 不显示(离屏页面只交页面本身那一层)，用弹层画 |
| 透明 | 页面底下垫棋盘格(`html.fox-preview`)，看得出哪里是透明的 | 透明的地方就是透明的 |
| 大小 | 窗口里是页面像素(`ctx.panel.preview` 为真) | 纹理像素 = 页面像素 × `scale`，贴成 `meters` 米宽 |
| 画不画 | 窗口隐藏时 `ctx.panel.visible` 为假 | 显示方停画时为假 |

真的进 VR 里看：不带这个变量启动，开着 SteamVR，按手柄上的总开关键(默认右手 B 双击)显示出面板(见 [SteamVR 悬浮面板](steamvr.md))。带着这个变量启动时 SteamVR 组件等着，不连 SteamVR，头显里没有面板。

不戴头显看离屏渲染、手柄指点这一整段：用模拟模式(`FOXPANEL_VR_SIM=<脚本.json>`，见 [SteamVR 悬浮面板](steamvr.md#模拟模式))，脚本给头和手的姿态、按键，跑完每块面板存一张 PNG 和收到的指点事件。

调试：

- 组件的 `ctx.log()`、加载出错都写进运行日志：主窗口的「日志」页和组件详情的「运行日志」一节里能看到(源码版同时打印在启动它的终端里)。主进程代码加载出错时，组件详情里还有「组件加载失败」的提示。
- 清单写错时组件出现在组件页的「加载失败」分组里，带上原因。
- 面板的页面加载失败或它的进程崩了，原因显示在组件页这个组件上；插件在等的服务一直没有时，5 秒后运行日志里有一行 `waiting for service: <服务名>`。

写 TypeScript 的话，装上类型包：`npm i -D @konkon-lab/foxpanel-sdk cordis@4.0.0-rc.12`(写主窗口组件再加 `vue`)；也可以用源码 `npm run build:sdk` 生成的 `release/sdk/`，见 [SDK](sdk.md#类型)。纯 JS 也完全可以，例子里的 `side-phrases`、`output-discord` 就是。

## 一、数据组件：一套皮肤

```
hello-skin/
├─ component.json
└─ skin.css
```

```json
{
  "id": "me.hello-skin",
  "kind": "skin",
  "name": "Hello 皮肤",
  "version": "1.0.0",
  "author": "me",
  "license": "MIT",
  "skin": "skin.css"
}
```

```css
.fox-theme { --panel: #eef6ff; --key: #dbeafe; --accent: #2563eb; }
.fox-theme.dark { --panel: #0b1220; --key: #1e293b; --accent: #60a5fa; }
```

加载后在组件页打开它的详情，点「选用」。键盘布局(`layout.json`)、语言(rime 方案)也都是这样不写代码的，格式见 components.md。

## 二、写一块面板

清单里写 `panel` 字段就提供一块面板：一页网页，由核心离屏渲染，由显示方贴进 VR。入口是 ES 模块，默认导出一个 [Cordis](https://github.com/cordiverse/cordis) 插件，它是面板的根组件，铺满整页。完整的例子在 [`examples/panel-clock/`](../examples/panel-clock)(时钟：带设置、收起按钮、按界面语言写日期)，下面是它的骨架；附着在手上的小面板见 [`examples/panel-wrist/`](../examples/panel-wrist)(手腕时钟)。

```
clock/
├─ component.json
├─ panel.js
└─ icon.svg
```

```json
{
  "id": "me.clock",
  "kind": "panel",
  "name": { "zh-Hans": "时钟", "en": "Clock" },
  "version": "1.0.0",
  "author": "me",
  "license": "MIT",
  "icon": "icon.svg",
  "panel": { "page": "panel.js", "width": 480, "height": 200, "meters": 0.3 }
}
```

```js
// panel.js
import { watchEffect } from 'vue';

export default {
  name: 'me.clock',
  inject: ['i18n'],
  apply(ctx) {
    ctx.effect(() => ctx.slot.mount(el => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;font-size:64px';
      el.append(card);
      const draw = () => {
        card.textContent = new Date().toLocaleTimeString(ctx.i18n.locale, { hour: '2-digit', minute: '2-digit' });
      };
      // 面板显示着时每秒画一次，没在显示时停表
      return watchEffect(onCleanup => {
        if (!ctx.panel.visible) return;
        draw();
        const timer = setInterval(draw, 1000);
        onCleanup(() => clearInterval(timer));
      });
    }));
  },
};
```

- `panel` 里三项必填：入口、页面宽、页面高(CSS 像素)。其余都有默认值，见 [组件格式](components.md#面板)；`meters` 是在 VR 里的默认宽度(米)，字小的面板把 `scale` 写成 2。
- `ctx.slot.el` 就是整块面板(页面的根元素)：往里面放自己的元素，按页面宽高排版。根元素自己的类名(主题、深色)由宿主管，不要改。页面背景是透明的，没画到的地方在 VR 里透明。
- `ctx.panel`：`dark`(深色)、`visible`(显示方让这一页画着没有；为假时页面不出帧，停掉定时器和动画)、`hide()`(请显示方收起这块面板)、`setDark(on)`、`width` / `height`、`preview`。`ctx.i18n.locale` 是界面语言。这几样是响应式的，放在 Vue 的 `watchEffect` 里读，变了会重跑；`vue` 由宿主共享，直接 `import`。
- `ctx.config` 是设置的当前值；在组件页改了设置，这块面板重载，插件拿到新值。
- 各面板的数据放 `ctx.storage`(跟组件走，卸载时删)；页面自己的 localStorage 每块面板各一份。
- 用宿主的 `.card`、`.key`、`.icon-btn` 类和颜色变量，深色、换皮肤会跟着变。
- 面板装上(进面板目录)就算打开，跟着显示方的总开关一起显示：在 VR 里按总开关键恢复面板时它出现在面前(位置按清单的 `spawn`)。用自己的按钮调 `ctx.panel.hide()` 收起后，按总开关键显示面板时它一起回来，组件关掉再打开时也重新出现。
- 想让面板跟着头显或手柄走，在 `panel` 里写 `anchor`：`head`、`left`、`right`(不写是留在空间里)。附着在手上的面板默认抬手才显示(`glance`，手垂着时不显示，页面照常在画，抬起来就是这一刻的画面)、一开始锁着、那只手的射线点不到它；写小一点，`meters` 在 0.3 以内。这两项是面板第一次出现时的取值，之后以显示方的布局为准。手腕时钟的清单：

```json
"panel": { "page": "panel.js", "width": 240, "height": 120, "meters": 0.12, "anchor": "left", "glance": true }
```

要先知道的限制：

- **页面不能联网**：`fetch`、WebSocket、外站的图片和脚本都取不了，也不能嵌 `iframe`、开 worker。要联网的事写在组件的 `main` 部分(组件进程，Node)，两边用 `ctx.bus` 发消息(频道名以组件 id 加 `/` 开头)，或由 `main` 提供一个远程服务给页面用。
- **VR 里只有指、点、按住拖**：没有右键、没有滚轮、没有键盘焦点、没有原生的下拉框，要弹出来的东西用 `ctx.overlay.open` 画(插件写 `inject: ['overlay']`)。内容比区域大时把区域的 `overflow` 设成 `auto`：宿主让它能按住拖动来滚(见 [面板页面](panel-page.md#拖动滚动))；放在能滚动的区域里的按钮监听 `click`，不要监听 `mousedown`(拖动过的那一次按下宿主只拦得住 `click`)。要用键盘面板的输入框：清单写 `uses: ["keyboard"]`，用 `ctx.relay.use('keyboard')` 读输入状态、往输入框插字(`tell('insert', 文字)`)。
- **只够得着声明了的东西**：别的组件的数据、总线频道读写不了；远程服务要在清单的 `requires` 或 `uses` 里写了才能用。

想让面板里能挂别人的部件，在清单的 `panel.slots` 里写插槽名，在根组件画的内容里放 `data-slot="<插槽名>"` 的元素，用 `ctx.panel.parts(插槽名)` 知道挂了哪些(见 [面板页面](panel-page.md#插槽和部件))。预装的键盘面板就是这样的一块面板，源码在 `components/shell-classic`。

## 三、面板里的部件：一个侧栏页

部件的页面代码跑在它所在的那块面板的页面里。下面这个侧栏页挂进键盘面板的 `sidepage` 插槽。入口同样是默认导出 Cordis 插件的 ES 模块。

```json
{
  "id": "me.hello",
  "kind": "sidepage",
  "name": "Hello",
  "version": "1.0.0",
  "author": "me",
  "license": "MIT",
  "page": "page.js",
  "requires": ["keyboard"],
  "config": {
    "type": "object",
    "dict": {
      "word": { "type": "string", "meta": { "description": "插入的字", "default": "你好" } }
    }
  }
}
```

```js
// page.js
export default {
  name: 'me.hello',
  inject: ['kb'],
  apply(ctx, config) {
    ctx.effect(() => ctx.slot.mount(el => {
      const b = document.createElement('button');
      b.className = 'key';
      b.textContent = config.word;
      b.onclick = () => ctx.kb.act({ kind: 'text', text: config.word });
      el.append(b);
    }));
  },
};
```

- `ctx.kb` 是预装的输入法组件在键盘面板的页面里提供的服务(输入状态和操作)：清单写 `requires: ["keyboard"]`，插件写 `inject: ['kb']`。输入法组件关着时这个组件不加载。
- `ctx.slot.el` 是宿主给这个组件的元素(侧栏页就是侧栏那一块)，大小由面板的根组件定，按它的大小排版。
- `ctx.effect(() => 清理函数)`：组件卸载时自动清理；用 `ctx.slot.mount` 渲染，卸载时宿主清空元素。
- 用宿主的 `.card`、`.key`、`.icon-btn` 类和颜色变量，换皮肤会跟着变。
- 要用 Vue 直接 `import { createApp } from 'vue'`(宿主共享)；别的框架或库自己打包进 `page.js`。
- `config` 是设置的当前值，用户在组件页改了设置，键盘面板重载，插件重新拿到新值。
- 带设置的侧栏页示例在 [`examples/side-phrases/`](../examples/side-phrases)。

## 四、主进程组件：一个输出

主进程代码跑在组件进程里(Node，能用 `fetch`、`fs`、网络……)。下面把每次发送的内容追加写进一个文件：

```json
{
  "id": "me.log-output",
  "kind": "output",
  "name": "写进文件",
  "version": "1.0.0",
  "author": "me",
  "license": "MIT",
  "main": "main.js",
  "config": {
    "type": "object",
    "dict": {
      "file": { "type": "string", "meta": { "description": "文件", "default": "D:\\sent.txt" } }
    }
  }
}
```

```js
// main.js
import fs from 'node:fs';

export default {
  name: 'me.log-output',
  apply(ctx, config) {
    ctx.output.register({
      send({ text }) {
        if (text) fs.appendFileSync(config.file, `${new Date().toISOString()} ${text}\n`);
      },
    });
  },
};
```

开着这个组件后，快捷设置的「发送到」里多一项「写进文件」。输入源(`kind: input`，往输入框送字、接管听写按钮)和翻译(`kind: translator`)也是主进程组件，见 sdk.md。

主进程组件要读键盘状态、往输入框送字时用远程服务 `keyboard`(预装的输入法组件提供)，清单写 `"uses": ["keyboard"]`：

```js
const kb = ctx.relay.use('keyboard');
kb.tell('insert', '你好');                       // 在光标处插入
ctx.effect(() => kb.watch(state => { … }));     // 输入状态变了；输入法没在跑时 state 是 null
```

自己的组件要给别的进程、页面里的组件用时，也可以提供远程服务(`ctx.relay.serve`)，见 [sdk.md](sdk.md#远程服务ctxrelay)。

主进程组件要播放声音、用麦克风时，再写一个 `page` 入口：它跑在隐藏的媒体页面里，两边用 `ctx.bus` 发消息，频道名以组件 id 加 `/` 开头(页面里发别的频道送不出去，别的组件的频道也收不到)。预装的语音合成和听写就是这样(源码在仓库 `components/tts-bailian`、`components/asr-bailian`)。

## 打包和发布

```bash
npm run pack:component D:\my-components\hello
```

先校验清单，再打成 `release/components/<id>.zip`。别人在组件页「安装组件」选这个 zip 就能装。

### 发布到 npm(组件市场)

```bash
npm run pack:component -- --npm D:\my-components\hello
npm publish release\components\foxpanel-component-me-hello-1.0.0.tgz
```

`--npm` 打成 npm 包：包名默认是 `foxpanel-component-<作者>-<名字>`，想用别的(比如 `@me/foxpanel-component-hello`)就在组件文件夹里放一个 `package.json` 写 `name`，主进程代码要用的 npm 依赖也写在它的 `dependencies` 里。打包时自动生成其余字段：版本(和清单一样)、关键词 `foxpanel-component`(市场靠它搜到)、`peerDependencies` 里的 `@konkon-lab/foxpanel-sdk`(宿主版本范围)、`foxpanel` 字段(市场显示用的 id、类别、名字、简介、是否带代码)。

- 包里的文件要是构建好的：页面代码(面板页面、媒体页面)只能 `import` 宿主共享的 `vue`、`cordis`；主窗口代码另外能用 `naive-ui`、`@lucide/vue`、`@konkon-lab/foxpanel-window`。别的依赖打进文件；主进程代码可以 `import` 包的 `dependencies`。
- 用户那边默认不执行安装脚本(`postinstall` 等)，要编译原生模块的依赖装不上；用自带预编译文件的库(比如 koffi)。
- 发布后几分钟内出现在主窗口的「市场」里，但发布满一天的版本才能装(确认框里写着什么时候之后能装，见 [组件市场](market.md))；装上、更新、卸载在市场页和依赖管理页。

- `id` 用「作者.名字」，以后升级保持不变；改了内容要提高 `version`，同 id 再装一次就是升级。
- 写上 `license`，附 `LICENSE` 文件。
- 带代码(有 `panel`、`page`、`window` 或 `main` 入口，或包里带 `.lua`)的组件，安装时会提示能运行任意程序。要先填 key 才能用的组件写 `"enabled": false`，装上时先关着。
- 要别人填的密钥用 `string` 加 `role: "secret"` 的设置，系统凭据加密保存；几个组件共用一个 key 时写同一个 `share`。

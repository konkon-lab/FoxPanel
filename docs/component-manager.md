# 组件管理

核心里管组件的部分：哪些组件装着、开着、按什么顺序，各自的设置、密钥和数据存在哪，改动怎么送到面板页面、组件进程和主窗口。清单的字段见 [组件格式](components.md)，组件页的界面见 [主窗口](main-window.md)，从 npm 装组件见 [组件市场](market.md)。

## 源码

| 文件 | 内容 |
|---|---|
| `src/main/components/store.ts` | 组件目录 `ComponentStore`：预装同步、扫描、开着的组件、各运行环境要加载的列表、zip 的解开和安装、卸载 |
| `src/main/components/settings.ts` | 组件设置 `ComponentSettings` 的读取和收窄、设置值的检查、改动 `ComponentPatch` 的收窄和归并 |
| `src/main/components/manager.ts` | `ComponentManager`：组件的 IPC、发布改动、开发文件夹监视、安装和卸载的流程 |
| `src/main/components/secrets.ts` | secret 的加密存储 `SecretStore` |
| `src/main/components/storage.ts` | 组件数据 `ComponentStorage` |
| `src/main/components/protocol.ts` | `fox://` 协议 |
| `src/main/components/yarn.ts`、`market.ts` | 组件项目和 npm 仓库，见 [组件市场](market.md) |
| `src/main/settings.ts` | 配置文件 `config.json` 的读写 |
| `src/main/datadir.ts` | 数据文件夹的目录浏览 |
| `src/shared/manifest.ts`、`src/shared/schema.ts` | 清单和 `config` 声明的类型、校验 |
| `src/shared/types.ts` | `ComponentSettings`、`ComponentRow`、`ComponentPatch`、`PanelInfo`、`PanelPlan`、`MediaPlan`、IPC 通道名 |

## 数据文件夹

数据文件夹是 `%APPDATA%\FoxPanel\`(全部内容见 [总体结构](architecture.md#数据文件夹))。组件管理用到的部分：

| 路径 | 内容 |
|---|---|
| `config.json` | 全部设置：`{ "settings": { "language", "components", "app", "panels" } }`，组件管理用 `components` |
| `secrets.json` | 加密后的 secret |
| `components/<id>/` | 装着的组件，文件夹名就是 id |
| `components/.staging/` | 解开、等确认的 zip |
| `components/package.json`、`yarn.lock`、`.yarnrc.yml`、`.yarn/`、`node_modules/` | 组件项目：从 npm 装的组件在 `node_modules/<包名>/` |
| `component-data/<id>.json` | 组件数据(`ctx.storage`) |

`config.json` 整份保存：写到 `config.json.tmp` 后替换原文件，替换不了时直接写原文件。读不了时的处理见 [组件格式](components.md) 的「存放位置」。

## 组件的来源

| 来源 | 位置 | 怎么来的 |
|---|---|---|
| 文件夹 | `components/<id>/` | 预装同步、装 zip |
| npm 包 | `components/node_modules/<包名>/` | 组件项目 `package.json` 的 `dependencies` 里列的包 |
| 开发文件夹 | 任意位置，登记在设置的 `dev` 里 | 开发者模式下「从文件夹加载」 |

同一个 id 在几个来源里都有时，用开发文件夹的，其次 npm 包，最后是文件夹。三种来源的组件走同一套开关、顺序、设置。

扫描(`ComponentStore.scan`)：

- `components/` 下名字以 `.` 开头的、`node_modules`、不是文件夹的都跳过；其余每个文件夹读 `component.json`，文件夹名要和清单的 id 一致。
- 清单里写了 `layout` 的，把布局文件按 JSON 读进来(内容由按键渲染组件检查)。
- 开发文件夹只在开发者模式开着时读。
- 不合格的记进「无法加载」列表(`BrokenComponent`：文件夹、名字、错误、是不是开发文件夹)，并写一行错误日志。

启动、装 zip、卸载、npm 操作、开发文件夹的增减和文件改动、开发者模式开关时扫描。改磁盘的操作失败时磁盘上可能只变了一部分，也扫描并发布一次。开关、顺序、设置、secret 的改动不扫描。

## 预装组件

预装组件构建在 `dist/components/<id>/`，列表是 `dist/components/preinstalled.json`(源文件 `components/preinstalled.json`)：

```json
[
  { "group": "basic", "ids": ["yanuo.shell-classic", "yanuo.candidates"] },
  "yanuo.some-component"
]
```

顶层的每一项是一个组件 id，或一个分组 `{ group, ids }`。全部 id 的先后是默认顺序；分组是首次启动(配置里还没有 `groups`)时的分组，分组的 id 和名字都取 `group`。

启动时逐个同步进组件目录(`syncPreinstalled`)：

| 组件目录里 | 处理 |
|---|---|
| 没有，id 不在 `removed` 里 | 复制进来；`order` 里没有这个 id 时排到最后，其中清单写了 `enabled: false` 的先关着 |
| 没有，id 在 `removed` 里 | 跳过 |
| 有，预装的版本更高 | 删掉旧文件夹，复制新的 |
| 有，但清单读不了或不合格 | 删掉旧文件夹，复制新的 |
| 有，版本和预装的相同或更高 | 不动 |

版本只比 `x.y.z` 三段，预发布后缀不算。预装包自己的清单不合格、或 id 和文件夹名不一致时，记一行错误日志并跳过。

同步之后预装组件和别的组件没有区别。预装组件卸载时 id 记进 `removed`，启动同步不会把它装回来；之后同 id 的组件再装上时从 `removed` 里拿掉。已装的预装组件只在预装的版本号更高时更新。

程序升级到新版本后的同步：

- 组件的设置(`config.json`)、密钥(`secrets.json`)、组件数据(`component-data/<id>.json`)、rime 用户目录都在组件文件夹外面，覆盖组件文件夹时不受影响；用户自己放进 `components/<id>/` 里的文件随旧文件夹一起删掉。
- 内容变了而版本号没升的预装组件，已装的那份不更新。打安装包之前 `scripts/preinstalled-check.ts` 把构建出的预装组件和上一次发布时的记录比对，有这种组件就报错，见 [打包和更新](release.md#预装组件的版本检查)。
- 新版本的预装列表里没有的组件留在组件目录里，照常加载；要拿掉得用户自己卸载。

## 组件设置

`config.json` 里 `settings.components` 的字段(`ComponentSettings`)：

| 字段 | 类型 | 内容 |
|---|---|---|
| `order` | `string[]` | 全部组件的顺序(组件 id)；没排进来的排在最后，按 id 排 |
| `off` | `string[]` | 关着的组件 |
| `config` | `{ 组件 id: { 设置键: 值 } }` | 各组件保存的设置值，不含 secret |
| `removed` | `string[]` | 卸载过的预装组件 |
| `dev` | `string[]` | 登记的开发文件夹(绝对路径) |
| `devMode` | `boolean` | 开发者模式 |
| `groups` | `{ id, name, ids }[]` | 组件页的分组：数组顺序是分组的顺序，`ids` 是成员的顺序；不在分组里的组件在顶层 |
| `folded` | `string[]` | 折叠着的分组，写成 `u:<分组 id>` |
| `names` | `{ 组件 id: 显示名 }` | 用户起的显示名，没有时用清单的 `name` |
| `market` | `{ registry, scripts }` | 组件市场：仓库地址(只认 http / https，默认 `https://registry.npmmirror.com`)、是否执行包里的安装脚本(默认 `false`) |

读取时缺的项用默认值，格式不对的项丢掉。分组的规则：id 是 1–32 个小写字母、数字和 `-`，不能重复；名字不能为空，最长 40 个字符；一个组件只算在第一个列出它的分组里。显示名也最长 40 个字符。

## 开着的组件

`ComponentStore.active` 按三步选出开着的组件，各运行环境只加载这些：

1. 不在 `off` 里的组件，按 `order` 排。
2. 只能开一个的类别(`candidates`、`textfield`、`layout`、`skin`、`translator`)只留排在最前的一个。
3. 清单写了 `requires` 的，每个服务名都要有留下来的组件在 `provides` 里声明，否则这个组件不算开着。第 3 步反复做到没有组件再被去掉：提供者自己因为缺服务被去掉时，要它的组件也去掉(关掉输入法组件时，要 `keyboard` 的按键渲染不算开着，要 `keys` 的布局也不算)。清单的 `uses` 不参与。

各运行环境拿到的列表：

| 运行环境 | 取哪些组件 | 每个组件给什么 |
|---|---|---|
| 面板页面(每块面板一份计划 `PanelPlan`，`panelPlans`) | 清单写了 `panel` 的组件各一块面板。根组件是它的 `panel.page`；`panel.slots` 里每个插槽名的部件是类别等于这个名字的部件组件(`candidates`、`textfield`、`layout`、`sidepage`、`sidebutton`；有 `page` 入口的，或没有 `page` 但有布局 JSON 的)；服务是根组件和部件 `requires` 的服务(沿提供者的 `requires` 逐层取)里有 `page` 入口的提供者(`window` 组件不算) | 每个组件 `id`、`kind`、`name`、`icon`、`config`，加上入口地址 `url` 或布局内容 `layout`；计划里另有面板 id、页面尺寸 `size`、在用皮肤的地址 `skin`、够得着的远程服务名 `remotes`、出不出声 `sound` |
| 组件进程 | 有 `main` 入口的 | `id`、入口文件的绝对路径和修改时间、是否独立进程、`config`(含 secret) |
| 媒体页面(计划 `MediaPlan`，`mediaPlan`) | `output`、`input`、`translator` 里有 `page` 入口的，加上它们要用的服务里有 `page` 入口的提供者 | `id`、`kind`、`name`、`config`、`url`；计划里另有 `remotes` |
| 主窗口 | `window` 组件的 `page` 入口；其他组件的 `window` 入口 | `id`、`kind`、`name`、`config`、`url` |

- 面板目录(`panelInfos`)：开着的组件里清单写了 `panel` 的，按组件顺序，每项是清单 `panel` 里摆放和尺寸的那些值；推给全部组件进程(见 [组件进程](component-process.md#面板页面))。
- 一个插槽名在几块开着的面板里都声明了时，这类部件只进组件顺序最前的那一块，其余面板的这个插槽是空的。
- 入口地址、图标、皮肤都是 `fox://component/<id>/<包内路径>`。面板页面和媒体页面的入口、皮肤的地址后面带 `?t=<文件的修改时间>`：文件保存了，计划就变了。主窗口的入口地址不带。
- `config` 是清单的默认值叠上保存的值，只认清单里声明的项；保存的值类型不对时用默认值。页面拿到的不含 secret。
- 组件进程里的 `config` 另外并进 `requires` 的各个服务组件的设置和 secret(同一个服务有几个提供者时取开着的、顺序最前的)，组件自己的同名项优先；secret 解密后填进去，几个组件共用的 secret 一次只解密一次。
- 远程服务的提供者(`ComponentStore.providers`)：开着的组件里清单 `provides` 有这个名字的，按组件顺序，排最前的那个生效。一个页面够得着的远程服务(`remotesOf`)：这一页加载的组件清单 `requires`、`uses` 里的名字合在一起；每块面板的页面和媒体页面各算各的，随计划换。
- 应用信息里的组件一栏(`appComponents`)：装着的全部组件，按组件顺序，带开关和是否开着，推给全部组件进程(见 [组件进程](component-process.md#应用信息和通用请求))。

## 改动

主窗口对组件的改动是一个 `ComponentPatch`，经 `components:set` 发来：

| `kind` | 字段 | 作用 |
|---|---|---|
| `on` | `id`、`on` | 开关一个组件 |
| `use` | `id` | 选用(只能开一个的类别)：打开它，并排到同类其他组件前面 |
| `none` | `of` | 这一类都不用(只能开一个的类别)：同类的全部关掉 |
| `order` | `ids` | 一组组件的新顺序：按这个顺序填进它们在总顺序里占的位置，别的组件位置不变 |
| `configs` | `id`、`values` | 保存一项或几项设置 |
| `devMode` | `on` | 开关开发者模式 |
| `market` | `market` | 组件市场的仓库地址和安装脚本开关 |
| `groups` | `groups` | 分组整个换掉 |
| `fold` | `key`、`folded` | 折叠或展开一个分组 |
| `name` | `id`、`name` | 显示名；空字符串 = 用清单的名字 |

`parsePatch` 按 `kind` 检查各字段的类型，多余的字段丢掉；`applyPatch` 归并进设置。`kind` 不认识、字段类型不对、组件不存在、设置项不存在或值不合格时整个改动不生效，返回 `{ ok: false, error }`。

键盘上「发送到」的开关不走 `components:set`：它是键盘操作 `output`，输入法组件收到后调 `ctx.app.setOn`，核心归并成同样的 `on` 改动(见 [组件进程](component-process.md#应用信息和通用请求))。这条路只开关装着的输出组件，`id` 是别的组件时核心不处理。

设置值按设置项的类型检查(`checkValue`)：

| 设置项 | 收什么 |
|---|---|
| 开关 | `boolean` |
| 数字 | 有限的数，夹在 `min` / `max` 内 |
| 下拉 | 选项里的字符串；写了 `custom` 或 `optionsFrom` 的收任意字符串 |
| 文字、音频设备、目录 | 字符串 |
| 表格 | 数组：每行只留声明的字段，不是字符串的格子记成空字符串 |
| 标签列表 | 数组：只留类型对的项(数字要在 `min` / `max` 内，文字不能为空)，重复的只留一个 |
| secret | 不经这里改，见「密钥」 |

目录设置的值是数据文件夹里的相对路径。主窗口的目录选择框经 `dir:list`、`dir:make` 列出和新建文件夹，`app:open-data-dir` 在资源管理器里打开；路径越出数据文件夹的都拒绝(`src/main/datadir.ts`)。

## 发布改动

每次改动保存之后(`ComponentManager.publish`)：

| 送到 | 内容 |
|---|---|
| 主窗口 | 新的组件列表(`components:list-event`)；主窗口要加载的组件变了时另发 `window:plan-event` |
| 面板页面 | 每块开着页面的面板：计划(`PanelPlan` 的 JSON)和页面加载的那份不同时只重载这一页；面板不在目录里了页面销毁；页面尺寸、帧率上限跟上清单。`fox://` 的响应不缓存，重载拿到的是新文件。界面语言和面板的深色不在计划里，变了经外观通知(`page:look-event`)送到每个面板页面和媒体页面，页面不重载 |
| 页面的登记 | 面板页面、媒体页面能用的组件 id 和够得着的远程服务名跟上新的计划 |
| 面板目录 | 变了推给全部组件进程 |
| 远程服务 | 每个名字重新认生效的提供方(开关、顺序变了时换人) |
| 应用信息 | 装着的组件、输出组件的开关有变化时，全部组件进程拿到新的一份 |
| 组件进程 | 按新的列表加载：只卸载、加载、重载变了的组件，见 [组件进程](component-process.md) |
| 媒体页面 | 计划变了就整页重载；没有要跑页面代码的组件时关掉 |

主窗口拿到的列表(`ComponentList`)是全部组件的行、无法加载的文件夹、开发者模式、组件进程的状态。每一行(`ComponentRow`)除清单里的内容外，还有这些算出来的字段：

| 字段 | 内容 |
|---|---|
| `on` / `active` | 开关 / 是否算开着(见「开着的组件」) |
| `code` | 带代码：有 `page`、`panel`、`window`、`main` 入口，或包里有 `.lua` |
| `dev` / `npm` | 来自开发文件夹 / 来自 npm 包(包名) |
| `config` | 设置值，已补默认值 |
| `secrets` / `secretHints` | 各 secret 是否已设置 / 预览 |
| `requires` | 要用的每个服务：服务名、提供它的组件 id(有开着的提供者时指它)、提供者是否开着(这里的「开着」同 `active`) |
| `error` | 主进程代码加载出错的原因；没有时是它的面板页面出错的原因(加载失败、页面的进程退出) |
| `features` | 正在提供的功能：组件进程里实际登记了的 `output`、`dictation`、`translation`，在面板目录里的 `panel`，和键盘上正在用的 `candidates`、`textfield`、`layout`、`skin`、`sidepage`、`sidebutton`、`lang` |

组件进程的状态、登记的输出和听写、加载错误、面板页面的错误变化时，列表重新推给主窗口；同一轮事件循环里的多次变化只推一次。

只在这次运行加载的组件(`ComponentManager` 的 `extra`：未打包的程序带 `FOXPANEL_PANELS=1` 启动时的开发用显示方 `dist/dev/display-desktop`，由 `src/main/dev.ts` 给出)不在这份列表里，也不在应用信息、市场、依赖管理里；它排在全部组件前面、关不掉、卸载被拒绝，不写进设置。

## 安装和卸载

### 装 zip

1. `components:pick`：选一个 `.zip`，用 Windows 自带的 `tar.exe` 解到 `components/.staging/`。
2. `component.json` 要在最外层，或在唯一的子文件夹里。校验清单；`page`、`panel.page`、`window`、`main`、`icon`、`skin` 指向的文件要在包里；`layout` 指向的文件要是 JSON。
3. 返回预览(`ComponentPreview`)：清单、是否带代码、已装的同 id 文件夹组件的版本。不合格时返回错误并清掉 `.staging`。
4. `components:install`：参数为 `true` 时删掉同 id 的旧文件夹，把解开的内容复制成 `components/<id>/`；为 `false` 时放弃。两种情况都清掉 `.staging`。

装上之后：

- 顺序里没有这个 id 的排到最后，顺序里有的位置不变；id 从 `removed` 里拿掉。
- 安装时还没有这个 id 的组件：类别是只能开一个的、或清单写了 `enabled: false` 时先关着，其他的装上就开着。
- 安装时这个 id 的组件装着(升级)：开关不变，设置、secret、数据都保留。

从 npm 装的组件在装上之后走同样的规则，安装前的检查见 [组件市场](market.md)。

### 卸载

`components:remove` 按组件的来源处理：

| 来源 | 处理 |
|---|---|
| npm 包 | 从组件项目里卸掉这个包 |
| 开发文件夹 | 只取消登记，不删文件夹，设置保留 |
| 文件夹 | 删掉 `components/<id>/` |

npm 包或文件夹卸掉之后，这个 id 没有别的来源还装着时，删掉它的设置和数据：`config` 里的设置、`secrets.json` 里它自己的 secret(共用的不删)、`component-data/<id>.json`、`order` 和 `off` 里的 id；预装组件的 id 记进 `removed`。`names` 里的显示名、`groups` 里的成员 id 不动。开发文件夹取消登记时什么都不删。做完后往总线发 `core/component-removed`(数据是组件 id)，替别的组件存了数据的组件据此清理。卸掉 npm 包后同 id 的文件夹组件还在时，设置、secret、数据留给它。

无法加载的文件夹用 `components:remove-broken` 移除：npm 包卸掉，开发文件夹取消登记，组件目录里的文件夹删掉。

哪些组件不能在界面上停用和卸载由组件页决定，见 [主窗口](main-window.md)。

## 开发者模式

- `devMode` 开着时读 `dev` 里登记的文件夹；关着时不读，登记保留。
- `components:dev-add`：选一个文件夹，清单合格才登记，排到顺序最后。
- 每个开发文件夹用 `fs.watch` 递归监视。文件有改动时等 300 毫秒(连续的保存合成一次)，扫描并发布(见「发布改动」)：清单、布局 JSON、面板和页面的入口文件、皮肤 css 保存后，用到它的那块面板(或媒体页面)的计划变了，这一页重载；主进程入口文件的修改时间变了的组件在组件进程里重载。
- 入口以外的文件(入口 `import` 的别的模块、图标)保存后计划不变，页面不重载；主窗口的入口地址里没有修改时间，改了主窗口入口(`window`，`window` 组件的 `page`)主窗口不会自己重载，要手动重载或把组件关掉再打开(见 [写一个组件](develop.md))；主进程组件只看入口文件的修改时间(见 [组件进程](component-process.md#重载))。
- 监视不了的文件夹记一行警告日志。

## 密钥

清单里 `role: "secret"` 的设置项不进 `config.json`，存在 `secrets.json`：

| 项 | 规则 |
|---|---|
| 键 | `<组件 id>/<设置键>`；写了 `share` 的是 `share:<名字>/value`，几个组件共用一份 |
| 值 | 明文经 Electron `safeStorage`(Windows 上是 DPAPI)加密后的 base64 |
| 保存 | `components:secret`，值为空字符串时清除。系统加密不可用时不保存并报错 |
| 预览 | 前 4 位 + `••••••` + 后 2 位，6 位及以下的全部遮住。预览只在内存里：启动时解密一遍算出来，算完把列表重新推给主窗口 |
| 明文 | 只在主进程解密，填进主进程组件的 `ctx.config`。页面拿到的 `config` 里没有 secret |
| 显示明文 | `components:secret-reveal`：通过 Windows 安全验证(Windows Hello 的 PIN、指纹、面部)后才返回；没通过时返回原因代码(`VerifyError`) |
| 解密失败 | 换了系统用户、文件复制到别的电脑时解不开，按没有设置处理(空字符串) |
| 卸载 | 删掉 `<组件 id>/` 开头的全部键 |

## 组件数据

`ctx.storage` 的数据由核心统一读写(`ComponentStorage`)，每个组件一个文件 `component-data/<id>.json`：

- 操作是 `get` / `set` / `delete` 一个键；键是非空字符串，值存成 JSON。`get` 没有这个键时得到 `null`。
- 一个组件的数据存成 JSON 后最长 1024 × 1024 个字符，超过时这次写入被拒绝。
- 页面经 `storage:call` 调用，组件进程经消息调用；各运行环境给每个组件的 `ctx.storage` 都固定成它自己的 id，所以面板页面、媒体页面、组件进程里同一个组件读写的是同一份。主窗口组件没有 `ctx.storage`。
- 主进程按窗口核对 `storage:call` 的组件 id：媒体页面和面板页面只能用这一页加载的组件 id，别的 id 的调用被拒绝；主窗口不限。
- 组件 id 格式不对的调用被拒绝，不会拼成文件路径。
- 读过的文件留在内存里，写入时同步写回文件。

## fox:// 协议

页面的全部文件都从 `fox://` 加载(`protocol.ts`)：

| 地址 | 对到 |
|---|---|
| `fox://host/<路径>` | 页面宿主的构建产物 `dist/host/<路径>`：`media.html`、`window/index.html`、共享库 `lib/` |
| `fox://<面板 id>.panel/<路径>` | 同一个目录 `dist/host/<路径>`：面板宿主页 `panel.html` 和它用的文件。主机名是「面板 id 加 `.panel`」，`.panel` 前面要是合格的组件 id；每块面板一个主机名，各是一个源 |
| `fox://component/<id>/<包内路径>` | 这个组件所在的文件夹(开发文件夹、npm 包或 `components/<id>/`)里的文件 |

- 协议登记为 standard、secure，支持 fetch 和 CORS。
- 地址的解析是纯函数 `resolveFox`：别的主机名、带用户名的地址、解不了码的路径都不认；`?` 和 `#` 后面的部分不看。
- 解析出的文件必须在对应的目录里面，越出目录的、组件没装的都回 404。
- 响应带 `Access-Control-Allow-Origin: *`(组件从 `fox://component` 加载，跨源导入宿主的共享库)和 `Cache-Control: no-store`。
- 组件文件的响应另带 `Content-Security-Policy`(只能取 `fox:`，不能嵌框架、开 worker、嵌插件)：它只在文件被当成文档或 worker 加载时起作用，`import` 的模块、样式、图片不受影响。

## IPC

`ComponentManager.registerIpc(ipc)` 处理的通道(名字在 `src/shared/types.ts` 的 `IPC`)，都经 `src/main/ipc.ts` 注册，参数都当 `unknown` 收窄后再用。哪种页面能调写在 `ipc.ts` 的 `POLICY` 里：`storage:call` 三种页面都能调(媒体页面和面板页面限这一页加载的组件 id)，其余只有主窗口能调；别的页面调了得到错误(见 [总体结构](architecture.md#安全边界))。远程服务的 `relay:use`、`relay:call` 由 `ServiceRelay.registerIpc` 处理，只有媒体页面和面板页面能调，服务名限这一页够得着的(见 [组件进程](component-process.md#远程服务))。面板页面和媒体页面取自己的计划和外观的 `page:plan`、`page:look` 等通道(`PAGE_IPC`)在 `src/main/main.ts` 注册，见 [面板页面](panel-page.md#计划和外观)。

| 通道 | 作用 |
|---|---|
| `window:plan` | 主窗口要加载的组件 |
| `components:list` | 组件列表 |
| `components:set` | 一个改动(`ComponentPatch`) |
| `components:pick` / `components:install` | 选 zip 并解开检查 / 确认安装或放弃 |
| `components:remove` / `components:remove-broken` | 卸载 / 移除无法加载的文件夹 |
| `components:secret` / `components:secret-reveal` | 保存或清除一个 secret / 显示明文 |
| `components:dev-add` | 登记一个开发文件夹 |
| `components:open-folder` | 在资源管理器里打开组件的文件夹，只打开扫描到的组件文件夹 |
| `components:host-restart` | 重新启动连续崩溃停下的组件进程 |
| `components:npm`、`market:search`、`market:info` | npm 包的安装和卸载、市场列表、包详情，见 [组件市场](market.md) |
| `storage:call` | 组件数据的读写 |

核心推给页面的事件：`components:list-event`(主窗口)、`window:plan-event`(主窗口)。面板页面的计划变了时核心直接让那一页重载，不发事件。

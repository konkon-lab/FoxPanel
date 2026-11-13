# 组件市场

组件可以发布到 npm，在主窗口的「市场」页搜索、安装、更新、卸载。用户的电脑上不用装 Node：程序自带 Yarn，在 Electron 的 utilityProcess 里跑。这篇讲 npm 包的格式、数据文件夹里的组件项目、安装流程、市场页和安全规则。

zip 安装、从文件夹加载、开关、顺序和设置见 [组件管理](component-manager.md)；打包命令见 [打包和更新](release.md)。

| 文件 | 作用 |
|---|---|
| `src/shared/market.ts` | 包名、关键词、`package.json` 的 `foxpanel` 字段 |
| `src/shared/version.ts` | 版本号比较、版本范围检查 |
| `src/main/components/market.ts` | 读 npm 的搜索结果和包信息 |
| `src/main/components/yarn.ts` | 写组件项目的文件，排队跑 yarn，失败时还原 |
| `src/yarn-host/main.ts` | 在 utilityProcess 里跑 `yarn.cjs` 的入口(构建成 `dist/yarn-host.cjs`) |
| `src/main/components/manager.ts` | npm 操作的 IPC、装之前的检查、装之后的校验 |
| `src/main/components/store.ts` | 扫描 `node_modules` 里的组件 |
| `components/window-market` | 市场页、组件来源和安装脚本两项设置 |
| `components/window-packages` | 依赖管理页(换版本、全部更新) |
| `vendor/yarn/yarn.cjs` | Yarn 4.18.1 单文件，许可证在同一目录 |

## 包的格式

一个组件包就是一个 npm 包，根目录有 `component.json`(格式见 [组件格式](components.md))和它指向的文件。

| 规则 | 说明 |
|---|---|
| 包名 | `foxpanel-component-<名字>` 或 `@作者/foxpanel-component-<名字>`；名字以小写字母或数字开头，后面可以有小写字母、数字、`.`、`_`、`~`、`-` |
| `keywords` | 含 `foxpanel-component`，市场靠它搜到 |
| `version` | 和 `component.json` 的 `version` 一样(市场页拿已装组件清单里的版本和包的最新版本比，不同就算可更新) |
| `peerDependencies` | `@konkon-lab/foxpanel-sdk` 的版本范围 = 要的程序版本(SDK 的版本就是程序的版本)；不写算都能装 |
| `foxpanel` | 市场用的摘要，见下表；没有或不合格的包不出现在市场里，也装不上 |
| `dependencies` | 主进程代码用到的 npm 依赖 |

`foxpanel` 字段：

| 键 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 组件 id，要和包里 `component.json` 的 `id` 一致 |
| `kind` | 是 | 类别 |
| `name` | 是 | 名字，字符串或按界面语言的对象 |
| `description` | | 简介，写法同 `name` |
| `code` | | `true` = 带代码(有 `page` / `window` / `main` 入口，或包里有 `.lua`) |
| `provides` `requires` | | 提供、要用的服务名 |

代码文件要是构建好的：

- 页面代码和主窗口代码跑在浏览器环境，只能 `import` 宿主共享的库(面板页面和媒体页面是 `vue`、`cordis`；主窗口另有 `naive-ui`、`@lucide/vue`、`@konkon-lab/foxpanel-window`)，别的依赖打进文件。
- 主进程代码跑在组件进程里，可以 `import` 包的 `dependencies`(从组件项目的 `node_modules` 解析)；`cordis`、`koffi` 指向程序自带的那份。

### 打包时生成的 package.json

`npm run pack:component -- --npm <文件夹>`(`scripts/pack-component.ts`)按清单生成包里的 `package.json`。组件文件夹里有 `package.json` 时以它为底(可以写 `name`、`dependencies`、`keywords`、`repository` 等)，下面这些字段由脚本写：

| 字段 | 值 |
|---|---|
| `name` | 文件夹里 `package.json` 的 `name`；没有时是 `foxpanel-component-<id 里的 . 换成 ->`。不合包名规则时报错 |
| `version` | 清单的 `version` |
| `type` | `module` |
| `description` | 清单的 `description`(没有时用 `name`)的简体中文 |
| `keywords` | `foxpanel-component` 加上文件夹里原有的 |
| `author` `license` | 清单的 `author`、`license` |
| `files` | 文件夹最外层除 `src`、`node_modules`、`package.json` 以外的全部 |
| `peerDependencies` | 原有的加上 `"@konkon-lab/foxpanel-sdk": "^<程序版本>"`。程序版本是 `0.x` 时这个范围只含同一个次版本号(`^0.1.0` 含 `0.1.5`，不含 `0.2.0`)，`1.0.0` 起含整个主版本号 |
| `foxpanel` | 由清单生成的摘要 |
| `repository` `bugs` | 文件夹里没写时用清单的 |

`private`、`devDependencies`、`scripts` 不进包。发布由作者自己 `npm publish <生成的 .tgz>`。

## 组件项目

数据文件夹的 `components/` 同时是一个 yarn 项目：

```
components/
├─ package.json     { name: "foxpanel-components", private: true, type: "module", dependencies }
├─ .yarnrc.yml      yarn 的配置
├─ yarn.lock
├─ .yarn/           yarn 的缓存(cache/)和全局文件夹(global/)
├─ node_modules/    从 npm 装的组件和它们的依赖
└─ yanuo.ime/ …     预装的、zip 装的组件(每个一个文件夹)
```

- `package.json` 的 `dependencies` 就是从 npm 装的组件(包名 → 版本范围)。
- 程序启动时和每次跑 yarn 之前都重写 `package.json`(只保留 `dependencies`)和 `.yarnrc.yml`，没有 `yarn.lock` 时建一个空的。这几个文件只经界面改。

`.yarnrc.yml` 的内容：

| 项 | 值 | 说明 |
|---|---|---|
| `nodeLinker` | `node-modules` | 依赖装成普通的 `node_modules` |
| `enableScripts` | 设置里的「允许安装脚本」，默认 `false` | 是否执行包里的 `postinstall` 等脚本 |
| `enableTelemetry` | `false` | |
| `enableGlobalCache` | `false` | 缓存放在项目里 |
| `cacheFolder` `globalFolder` | `./.yarn/cache`、`./.yarn/global` | |
| `logFilters` | 丢掉 `YN0002`、`YN0086` | 不报宿主 SDK 没装(组件项目里不装 `@konkon-lab/foxpanel-sdk`，版本范围由程序在装之前检查) |
| `npmRegistryServer` | 设置里的「组件来源」 | |
| `unsafeHttpWhitelist` | 仓库的主机名 | 只在仓库是 `http://` 地址时写 |

扫描组件时(`ComponentStore.scan`)，除了 `components/<id>/` 这些文件夹，还按 `dependencies` 里的每个包名读 `node_modules/<包名>/component.json`。同一个 id 有几处时的优先级：开发文件夹 > npm 包 > 组件目录里的文件夹。`.` 开头的文件夹和 `node_modules` 本身不当组件读。

npm 装的组件在组件列表里带着包名(`ComponentRow.npm`)，其余的(读文件、组件进程加载、开关、顺序、分组、设置、密钥)和文件夹组件一样按 id 处理。

## yarn 任务

`Yarn.run(参数)` 跑一条 yarn 命令：

- 用 `utilityProcess.fork` 起 `dist/yarn-host.cjs`，参数是 `yarn.cjs` 的路径和 yarn 的参数，工作目录是组件项目，输出接成管道。
- 一次只跑一个任务，后来的排队。
- 跑之前记下 `package.json` 和 `yarn.lock` 的内容，失败(退出码不是 0、超时)时写回去。
- 一个任务最长 10 分钟，超时就停掉进程。
- 输出逐行写进运行日志，来源是 `market`；带错误的行记成 `warn`。
- 失败时的错误信息：最后 20 行输出里说明原因的行(`YN0001`、`YN0035`、`YN0082`、`YN0016`，或带 `Error`)；没有这样的行时是最后 20 行；没有输出时是退出码。

环境变量在程序自己的环境上加 `YARN_ENABLE_PROGRESS_BARS=0`、`YARN_ENABLE_COLORS=0`、`YARN_ENABLE_HYPERLINKS=0`；允许安装脚本时再加 `ELECTRON_RUN_AS_NODE=1`(脚本里的 `node` 是 yarn 指向的程序本体，靠这个变量当 Node 跑)。

`yarn-host` 入口：utilityProcess 的进程在脚本跑完后不会自己退出，入口每 50 毫秒看一次，等 yarn 设好最终退出码(运行期间是占位的 42)、除了输出管道和定时器没有别的活儿时主动退出；设好退出码后最多再等 60 秒。

## 安装、换版本、卸载

主窗口经三个 IPC 通道操作(`src/shared/types.ts`)：

| 通道 | 参数 | 作用 |
|---|---|---|
| `market:search` | `refresh` | 市场列表；`true` = 不用缓存 |
| `market:info` | 包名、版本(可选) | 一个包的信息 |
| `components:npm` | `{ op: 'add', name, version }` 或 `{ op: 'remove', name }` | 装上(或换版本)、卸载；失败的原因写进运行日志(来源 `market`) |

装上或换版本(`ComponentManager.npmAdd`)：

1. 包名不合规则的直接拒绝。
2. 从设置里的仓库读这个版本的信息，下面任何一条不满足就报错、不装：`foxpanel` 字段合格；程序版本在 `@konkon-lab/foxpanel-sdk` 的范围里；这个版本发布满一天。
3. 跑 `yarn add <包名>@<版本>`。
4. 重新扫描。包里的 `component.json` 不合格，或它的 `id` 和 `foxpanel.id` 不一致时，跑 `yarn remove <包名>` 并报错。
5. 组件排到顺序最后。之前没有这个 id 的组件时，只能开一个的类别(候选栏、皮肤等)和清单写了 `"enabled": false` 的先关着。

卸载(`npmRemove`)：跑 `yarn remove <包名>`，重新扫描。这个 id 没有别的来源时，删掉它的设置、密钥、组件数据和顺序里的位置，经总线通知各组件；还有同 id 的组件(组件目录里的文件夹、开发文件夹)时，设置和数据留给它。

组件页里卸载一个 npm 装的组件、移除一个不能加载的 npm 包，走的也是 `yarn remove`。

装完、卸完后只重新加载变了的组件，程序不重启，见 [组件管理](component-manager.md)和 [组件进程](component-process.md)。

## 市场的数据

`Market`(`src/main/components/market.ts`)读两处：

| 内容 | 从哪读 |
|---|---|
| 列表(搜索) | 固定用 npm 官方 `https://registry.npmjs.org`(镜像大多不支持搜索接口)；开发时环境变量 `FOXPANEL_NPM` 可以指到本机的测试仓库 |
| 包的信息和版本、下载 | 设置里的「组件来源」 |

每次请求最长等 15 秒。

### 列表

1. `GET /-/v1/search?text=keywords:foxpanel-component&size=250`，一次最多 250 个包。
2. 去掉包名不合规则的。
3. 逐个读最新版的 `package.json`(`/<包名>/<版本>`，同时 8 个)取 `foxpanel` 字段，没有或不合格的不列。
4. 按月下载量从多到少排。

结果在内存里缓存 10 分钟。每一项(`MarketItem`)：

| 字段 | 说明 |
|---|---|
| `name` | npm 包名 |
| `version` `date` | 最新版本和它的发布时间 |
| `description` | 包的简介 |
| `publisher` | 发布者的 npm 用户名 |
| `downloads` | 最近一个月的下载量 |
| `repository` | 存储库地址 |
| `component` | `foxpanel` 字段 |

### 包的信息

`market:info` 返回 `MarketPackage`：

| 字段 | 说明 |
|---|---|
| `versions` | 能装的版本，新的在前：去掉标了 `deprecated` 的和发布不满一天的(没有发布时间的也算不满) |
| `version` | 这次看的版本：指定的；没指定时是 `latest` 标签的版本，它不满一天时是 `versions` 的第一个 |
| `component` | 这个版本的 `foxpanel` 字段，没有或不合格时为 `null` |
| `license` `readme` | 许可证、README |
| `sdk` | `peerDependencies` 里 `@konkon-lab/foxpanel-sdk` 的范围 |
| `compatible` | 能装：摘要合格，且没写范围或程序版本在范围里 |
| `readyAt` | 这个版本发布不满一天时才有：能装的时间(ISO)；没有发布时间时是空字符串 |

版本范围(`satisfies`)支持 `*`、`x.y.z`、`^`、`~`、`>=`、`>`、`<=`、`<`，空格表示「且」，`||` 表示「或」；预发布后缀忽略，看不懂的范围算不满足。

「发布满一天」和 yarn 的 `npmMinimalAgeGate` 默认值(1 天)一致：不满一天的版本 yarn 自己也不装。

## 市场页

预装的主窗口页面组件 `components/window-market`(`kind: window`，页面 id `market`，侧栏里排在「组件」和「依赖管理」之间)。

- 标题行：刷新(不用缓存重新读列表)。
- 左栏筛选：类别、状态(未安装 / 已安装 / 可更新)、纯数据(不带代码)，每项后面是搜索之后的数量。
- 搜索：显示名、包名、发布者、简介里有这段字，不分大小写。排序：按下载量、按更新时间、按名称。
- 列表上方一行写着组件数和下载用的仓库主机名；读不到列表时显示错误。
- 卡片：名字、已安装 / 可更新标记、发布者、版本(可更新时是「已装版本 → 最新版本」)、更新时间(多久以前)、简介(`foxpanel.description`，没有时用包的简介)、类别、纯数据标记、月下载量。
- 状态按 npm 包算：从这个包装上的才算已安装，版本和最新版不同就是可更新。预装的或 zip 装的同 id 组件算未安装，从市场装上后以 npm 的为准。
- 按钮：未安装是「安装」，可更新是「更新」，已安装是「打开」(跳到组件详情)。

点「安装」或「更新」先读包的信息，弹确认框：名字和版本、包名、许可证、发布者、要替换的已装版本。下面的提醒只显示最前面符合的一条：

| 情况 | 提醒 | 能否安装 |
|---|---|---|
| `foxpanel` 字段不合格 | 这个版本不是 FoxPanel 组件 | 否 |
| 程序版本不在范围里 | 这个版本要的程序版本是多少，装不上 | 否 |
| 发布不满一天 | 什么时候之后才能装 | 否 |
| 带代码 | 会在电脑上运行程序，只装信任的来源 | 能 |

组件页的「安装组件」菜单(依赖管理页的「手动添加」是同一个菜单)在市场组件开着时多一项「从市场安装」，点了跳到市场页。

依赖管理页(`components/window-packages`)对 npm 装的组件用 `market:info` 读能装的版本：「目标版本」下拉列出这些版本，「修改」和「应用更改」对换了版本的行发 `components:npm` 的 `add`，「全部更新」把落后的都换到最新版。页面的其余部分见 [主窗口](main-window.md)。

## 设置

两项设置是市场组件(`yanuo.window-market`)自己的配置，在组件页改：

| 键 | 默认 | 说明 |
|---|---|---|
| `registry` | `https://registry.npmmirror.com` | 组件来源：npmmirror、npm 官方(`https://registry.npmjs.org`)，或自己填的地址 |
| `scripts` | `false` | 允许安装脚本。关着时要编译原生模块的组件装不上，自带预编译文件的库(如 koffi)不受影响 |

市场组件加载时把这两项交给宿主(`components:set` 的 `market` 改动)，存在 `config.json` 的 `settings.components.market`。宿主只认 `http://`、`https://` 开头的仓库地址，别的用默认值。

## 安全

- 带代码的组件装之前有提醒：会在电脑上运行程序，只装信任的来源。
- `components:npm` 只接受合规则的包名和仓库版本列表里有的版本，不能用它装 `git:`、`file:`、`http:` 写法的来源。
- 安装脚本默认不执行。
- 发布不满一天的版本不装，防止装到账号被盗后发出的版本。
- 装完用包里的 `component.json` 再校验一遍，不合格或 id 对不上就卸掉。
- yarn 的缓存和全局文件夹都在组件项目里；遥测关着。
- 组件项目里不装 `@konkon-lab/foxpanel-sdk`(它只有类型)；组件能用的宿主模块只有「包的格式」里列的共享库。

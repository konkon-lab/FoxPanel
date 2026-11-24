# 打包和更新

从源码到安装包的每一环：构建 `dist/`、下载输入法引擎和词库、生成 Windows 安装包、打包组件、生成 SDK 类型包、发布一个版本的步骤，以及装好的程序怎么检查和安装更新。脚本都在 `scripts/`，是 TypeScript，用 Node 直接运行。

环境：64 位的 Windows 10 或 11，Node.js 24 或更新(`package.json` 的 `engines`)，Git；除 npm 仓库外要能连 GitHub(`vendor:rime` 的下载、Electron 的程序文件)。细节见 [贡献指南](../.github/CONTRIBUTING.md#开发环境)。`npm install` 时的 `prepare`(`scripts/prepare.ts`)在有 `.git` 的仓库里把提交钩子的目录设成 `.githooks`，没有 `.git` 或没装 Git 时什么都不做、不报错。

| 命令 | 脚本 | 产物 |
|---|---|---|
| `npm run build` | `scripts/build.ts` | `dist/` |
| `npm start` | 先 `npm run build`，再 `electron .` | |
| `npm run vendor:rime` | `scripts/vendor-rime.ts` | `vendor/rime/` |
| `npm run pack` | `npm run build`，预装组件的版本检查，再 `electron-builder --win --x64 --publish never` | `release/FoxPanel-Setup-<版本>.exe`、`.exe.blockmap`、`release/win-unpacked/` |
| `npm run check:preinstalled [-- --record]` | `scripts/preinstalled-check.ts`，见「预装组件的版本检查」 | 加 `--record` 时写 `components/released.json` |
| `npm run pack:component` | `scripts/pack-component.ts` | `release/components/` 下的 `.zip` 或 `.tgz` |
| `npm run build:sdk` | `scripts/build-sdk.ts` | `release/sdk/` |
| `npm run check` | `typecheck`(vue-tsc)、`lint`(ESLint)、`test`(node:test) | |
| `npm run smoke [-- --boundary]` | `npm run build`，再 `scripts/smoke.ts`：启动程序走一遍，见「冒烟检查」 | |

程序版本以 `package.json` 的 `version` 为准：安装包的文件名、SDK 类型包的版本、npm 组件包要的宿主版本范围都取它。`package-lock.json` 里也记着两处(最外层和 `packages[""]`)，用 `npm version <版本> --no-git-tag-version` 三处一起改。

`dist/`、`release/`、`vendor/rime/` 不进 git。

## 构建

`scripts/build.ts` 先清空 `dist/`，各部分同时打包(写的目录互不相交)，目标都是 `es2023`。

| 产物 | 来源 | 打包方式 |
|---|---|---|
| `dist/main.js` | `src/main/main.ts` | esbuild，Node ESM，npm 依赖不打进去 |
| `dist/component-host.js` | `src/component-host/main.ts` | 同上 |
| `dist/yarn-host.cjs` | `src/yarn-host/main.ts` | esbuild，CJS(要 `require` `yarn.cjs`) |
| `dist/preload.cjs` | `src/preload/preload.ts` | esbuild，CJS(沙箱里的 preload 只支持 CJS)；主窗口用 |
| `dist/preload-page.cjs` | `src/preload/page.ts` | 同上；面板页面和媒体页面用，只有 `PageApi` |
| `dist/host/panel.html`、`media.html` | `src/panel/` | Vite |
| `dist/host/window/` | `src/renderer/` | Vite(`vite.config.ts`) |
| `dist/host/lib/` | 共享库 | 见下 |
| `dist/components/<id>/` | `components/<名字>/` | 见下 |
| `dist/dev/<名字>/` | `dev/<名字>/` | 开发用的组件(显示方 `display-desktop`)，打法和预装组件一样；不进预装列表，安装包不带 |
| `dist/icons/` | `resources/icon.png` | `scripts/icons.ts`(icon-gen) |
| `dist/THIRD_PARTY_LICENSES.txt` | 打进 `dist/` 的 npm 包各自文件夹里的许可证文件 | `scripts/licenses.ts`，见「随程序分发的第三方文件」 |

`dist/host/` 是 `fox://host/` 和每块面板的 `fox://<面板 id>.panel/` 的根目录，面板页面、媒体页面、主窗口都从它加载。

### 共享库

宿主页面和组件的页面代码 `import` 这些模块时不打进各自的文件，由页面的 import map 指到 `dist/host/lib/` 里的同一份(表在 `src/shared/libs.ts`)：

| 模块 | 文件 | 怎么来 | 哪些页面能用 |
|---|---|---|---|
| `vue` | `vue.js` | Vue 的浏览器 ESM 运行时，原样复制 | 面板页面、媒体页面、主窗口 |
| `cordis` | `cordis.js` | 连同依赖打成一个文件 | 面板页面、媒体页面、主窗口 |
| `naive-ui` | `naive-ui.js` | 连同依赖打成一个文件，`vue` 留给 import map | 主窗口 |
| `@lucide/vue` | `lucide-vue.js` | 同上 | 主窗口 |
| `@konkon-lab/foxpanel-window` | `window.js` | 转接模块：把宿主挂在 `globalThis` 上的对象转成模块导出(`src/shared/window-api.ts`) | 主窗口 |

三个页面(`panel.html`、`media.html`、`window/index.html`)的 import map 在各自打完后由脚本写进 HTML。import map 是内联脚本，它的 sha256 同时加进页面 CSP 的 `script-src`。

### 预装组件

`components/preinstalled.json` 列出的每个组件都打包，同时打 4 个：`components/<名字>/` → `dist/components/yanuo.<名字>/`。

| 源文件 | 产物 | 打包方式 |
|---|---|---|
| `src/page.ts` | `page.js` | Vite 库模式，ES 模块，压缩；样式由入口脚本插进 `<style>`。共享库留给 import map：`window` 类别的按主窗口的那张表，其他类别的按面板页面的 |
| `src/panel.ts` | `panel.js` | 同上，面板的根组件；共享库按面板页面的那张表 |
| `src/window.ts` | `window.js` | 同上，共享库按主窗口的那张表 |
| `src/main.ts` | `main.js` | esbuild，Node ESM；`cordis`、`koffi` 不打进去(组件进程里指向宿主那份)；开头补一个 `require`，给打进去的 CommonJS 依赖用 |
| `src/worker.ts` | `worker.js` | esbuild，Node ESM；`koffi` 不打进去 |
| `src/` 以外的文件 | 原样复制 | `component.json`、布局、皮肤、语言数据等 |

`preinstalled.json` 也复制到 `dist/components/`。程序启动时把这里的组件同步进数据文件夹，见 [组件管理](component-manager.md)。预装组件改了内容要升 `component.json` 的版本号，已装的才会在启动时更新。

### 图标

`resources/icon.png`(1024 像素，圆外透明)缩到 `dist/icons/`：

| 文件 | 用处 | 尺寸(像素) |
|---|---|---|
| `icon.ico` | 窗口、任务栏、安装包 | 16、20、24、32、40、48、64、128、256 |
| `tray-<像素>.png` | 托盘，按显示缩放各一张 | 16、20、24、32、40、48、64 |
| `icon.png` | | 512 |

### 由脚本生成、提交在仓库里的文件

这几个脚本没有 npm 命令，源头变了时手动运行 `node scripts/<名字>.ts`：

| 脚本 | 读 | 写 |
|---|---|---|
| `gen-openvr.ts` | `vendor/openvr/openvr_capi.h` | `components/steamvr/src/fntables.ts`：各接口函数表里的方法顺序和接口版本。换头文件后重新生成，`test/vr-abi.test.ts` 拿头文件核对它和 `openvr.ts` 里手写的函数原型、结构体、常量 |
| `gen-d3d.ts` | Windows SDK 头文件(参数可以指定 SDK 的 Include 版本目录，不写用装着的最新版) | `components/steamvr/src/d3d-vtables.ts`：用到的 COM 接口方法在虚表里的顺序 |
| `gen-pointer.ts` | | `resources/vr/pointer.png`：VR 指针圆点，128 像素 |
| `gen-logo.ts` | `resources/icon.png` | `components/window-shell/src/logo.png`：主窗口侧栏的标志，192 像素 |

## 许可证

- FoxPanel 自己的代码是 MIT：全文在根目录的 `LICENSE`，`package.json` 的 `license` 写 `MIT`；`LICENSE` 经 `build.files` 进安装包，安装后在安装目录的 `resources/app/` 下。
- 预装组件、开发用的显示方、示例的清单和 SDK 类型包写的也是 MIT(小鹤双拼示例带着 LGPL-3.0 的拼写规则，清单写 `LGPL-3.0-only`)。
- 第三方文件各按各的许可证，见 `OPEN_SOURCE_LICENSES.md` 和下面一节。
- 官方的 `rime.dll` 带着 GPL-3.0 的 librime-octagram：MIT 和它相容，再分发整个安装包时还要满足 GPL-3.0 的条件。换许可证时要保持和 GPL-3.0 相容，或换一份不带这个插件的 `rime.dll`(`scripts/vendor-rime.ts` 的 `SOURCES`)。

## 随程序分发的第三方文件

| 目录 | 内容 | 来源 |
|---|---|---|
| `vendor/rime/` | 输入法引擎、词库和许可证 | `npm run vendor:rime` 下载 |
| `vendor/openvr/` | `openvr_api.dll`、`openvr_capi.h`、许可证 | 提交在仓库里 |
| `vendor/yarn/` | `yarn.cjs`(Yarn 4.18.1)、许可证 | 提交在仓库里，用途见 [组件市场](market.md) |

各项的许可证一览在仓库根的 `OPEN_SOURCE_LICENSES.md`(它也进安装包)。

npm 包的许可证全文：

- 放在 `node_modules/` 里随安装包走的包(`dependencies` 和它们的依赖)，许可证文件在各自的文件夹里。
- 打进 `dist/` 的包没有自己的文件夹，构建时收成 `dist/THIRD_PARTY_LICENSES.txt`：进安装包的每个 esbuild 产物(共享库、组件的 `main.js` 和 `worker.js`、主进程的几个入口)都出 metafile，`scripts/licenses.ts` 从里面找出实际占了字节的 `node_modules` 包，加上原样复制的 Vue，读各包最外层的 `LICENSE*`、`COPYING*`、`NOTICE*` 文件，按包名排好写成一份文本。开发用的组件(`dist/dev/`)不算。
- 包里没有许可证文件的(cordis、vdirs、css-render、@css-render/plugin-bem、@css-render/vue3-ssr，以及 `node_modules` 里的 lazy-val)，这份文本里只有包名、版本、`package.json` 写的许可证名和来源。`node_modules` 里的 @koromix/koffi-win32-x64(koffi 的原生库)自己没带许可证文件，全文是旁边的 `node_modules/koffi/LICENSE.txt`。
- 页面代码(Vite 打的那些)只引用共享库，没有另外打进 npm 包；以后有的话要同样收进来。

### 下载输入法引擎和词库

`scripts/vendor-rime.ts` 按写死的版本从 GitHub 下载：

| 来源 | 版本 | 放到 `vendor/rime/` 下 |
|---|---|---|
| librime 官方 Windows 版(msvc x64) | 1.17.0 | `rime.dll` |
| librime 的依赖包 | 1.17.0 | `data/opencc/`(OpenCC 简繁数据) |
| 四叶草拼音 rime-cloverpinyin | 1.1.4 | `data/`(方案和词库，含 THUOCL 和搜狗网络流行新词) |
| rime-prelude | 提交 `082425e` | `data/default.yaml`、`key_bindings.yaml`、`punctuation.yaml`、`symbols.yaml` |
| rime-jaroomaji(日语罗马字) | 提交 `ff24623` | `data/jaroomaji.*.yaml`(方案和 mozc、JMdict、KANJIDIC2 词库) |
| rime-easy-en(英文单词) | 提交 `54a4a07` | `data/easy_en.schema.yaml`、`data/easy_en.dict.yaml` |
| libhangul | 提交 `23d2cd9` | `hanja.txt`(韩文汉字词库) |

- 许可证放在 `vendor/rime/licenses/`：
  - librime、rime-cloverpinyin、rime-prelude、OpenCC、THUOCL、rime-jaroomaji、mozc、rime-easy-en 各一个文件，另有 JMdict / KANJIDIC2 的说明(CC BY-SA 4.0)和从 `hanja.txt` 开头注释取出的 libhangul 许可证。
  - `rime.dll` 里静态带着的插件和库(插件的提交写在 librime 发布包的 `version-info.txt` 里，库的版本是依赖包里的)：librime-lua、librime-predict、glog、leveldb、marisa-trie、yaml-cpp、Boost 各一个文件；`darts-clone.txt` 取自 librime 的依赖包；`Lua.txt` 取自 Lua 5.4.8 的 `lua.h` 末尾的注释。
  - `GPL-3.0.txt` 是 librime-octagram 的许可证文件(GPL 第 3 版全文)，LGPL-3.0 的三份数据引用的 GPL 也是这一份。
- 三个发布包和每个许可证文件下载后核对脚本里记着的 sha256，对不上就报错退出(报错里有下载到的值)；方案和词库的单个文件按完整的提交号取。换版本时把新的 sha256 写进脚本。
- 压缩包用 Windows 自带的 `tar.exe` 解(能解 7z 和 zip)。
- 全部内容在临时目录里备齐，都成功了才整个换掉 `vendor/rime/`；中途失败时 `vendor/rime/` 保持原样。

这些文件怎么用见 [输入法](input-method.md)。

## 安装包

`npm run pack` 先构建，再由 electron-builder 按 `package.json` 的 `build` 打 Windows x64 的包。要先跑过 `npm run vendor:rime`：`vendor/` 整个进安装包，没有 `vendor/rime/` 的安装包里没有输入法引擎。

| 配置 | 值 | 说明 |
|---|---|---|
| `appId` | `yanuo.foxpanel.app` | |
| `productName` | `FoxPanel` | |
| `directories.output` | `release` | |
| `asar` | `false` | 程序文件按普通文件夹放，`vendor/` 里的 dll 和 `yarn.cjs` 按普通路径读；SteamVR 应用清单里相对路径的启动命令也靠它 |
| `electronLanguages` | `zh-CN`、`zh-TW`、`ja`、`ko`、`en-US` | 只带界面语言对应的 5 个 Chromium 语言包(共 55 个，其余约 46 MiB) |
| `files` | `package.json`、`OPEN_SOURCE_LICENSES.md`、`dist/**`(不含 `.map`、不含 `dist/dev/`)、`resources/**`、`vendor/**`(不含 `.h`) | 进安装包的文件 |
| `win.target` | `nsis` | |
| `win.icon` | `dist/icons/icon.ico` | |
| `nsis.oneClick` | `false` | 带安装向导 |
| `nsis.perMachine` | `false` | 向导里有一页选只给自己装(默认，装到 `%LOCALAPPDATA%\Programs\FoxPanel`)还是给所有用户装(要管理员权限) |
| `nsis.allowToChangeInstallationDirectory` | `true` | 可以选安装目录 |
| `nsis.shortcutName` | `FoxPanel` | |
| `nsis.artifactName` | `FoxPanel-Setup-${version}.exe` | |

产物是 `release/FoxPanel-Setup-<版本>.exe`、差分更新用的 `FoxPanel-Setup-<版本>.exe.blockmap` 和免安装的 `release/win-unpacked/`；配了更新源时还有 `release/latest.yml`(见「自动更新」)。命令里的 `--publish never` 让 electron-builder 只打包、不上传(不写时它在 CI 里、带 tag 时、脚本名叫 `release` 时会自己上传)。安装包没有签名。

`package.json` 的 `dependencies`(`cordis`、`koffi`、`node-osc`、`bonjour-service`、`electron-updater`)由 electron-builder 连同 `node_modules` 放进安装包：`dist/main.js`、`dist/component-host.js` 和组件的主进程代码运行时从 `node_modules` 加载 `cordis`、`koffi`、`electron-updater`；`node-osc`、`bonjour-service` 连同依赖已经打进 OSC 组件的 `main.js`，`node_modules` 里的那几份运行时用不到。页面用的库(Vue、Naive UI 等)是 `devDependencies`，已经打进 `dist/`。

带环境变量 `FOXPANEL_PANELS=1` 启动打包后的程序没有效果：开发用的显示方不在安装包里，`src/main/dev.ts` 只在未打包时看这个变量。

卸载(electron-builder 的 NSIS 模板，`deleteAppDataOnUninstall` 用默认的 `false`)：

- 安装目录整个删掉。向导选目录时，路径里不含 `FoxPanel` 的会在后面加一层 `FoxPanel` 文件夹，含的直接当安装目录，所以选一个名字里带 `FoxPanel` 的现成文件夹时，里面原有的文件在卸载和覆盖安装时一起删掉。
- 数据文件夹 `%APPDATA%\FoxPanel` 不删，重新安装后接着用。
- SteamVR 里登记的应用清单不动(见 [SteamVR 悬浮面板](steamvr.md#连接))。

### 预装组件的版本检查

已装的预装组件只在预装的版本号更高时更新(见 [组件管理](component-manager.md#预装组件))，所以内容变了的预装组件要升 `component.json` 的 `version`。`components/_shared/`、`components/_bailian/` 的代码是内联进各组件的，改了它们，用到的组件都算内容变了。

`scripts/preinstalled-check.ts` 在构建之后做这个检查(`npm run pack` 里带着，也可以单独 `npm run check:preinstalled`)：

- 给 `dist/components/<id>/` 下每个组件的全部文件算一个 sha256(文件按相对路径排序，路径和内容都算)。
- 和发布记录 `components/released.json`(`{ app: 程序版本, components: { <id>: { version, hash } } }`)比：内容变了而版本号和记录里的一样、或版本号比记录里的低，就报错，退出码 1；记录之后加进预装列表的、预装列表里已经没有的只打印一行说明。
- 还没有发布记录时直接通过。
- `npm run check:preinstalled -- --record` 把这次构建记成发布记录，发布时和版本号的改动一起提交。

同样的源码和 `package-lock.json` 构建出的预装组件是一样的；升级了打进组件的依赖，或换了 esbuild、Vite 的版本后，产物会变，这些组件同样要升版本号。

## 组件打包

```bash
npm run pack:component <文件夹>…           # zip
npm run pack:component -- --npm <文件夹>…  # npm 包
```

`scripts/pack-component.ts` 对每个文件夹：

1. 读 `component.json` 并校验清单(`src/shared/manifest.ts`)，不合格就报错。
2. 取文件夹最外层除 `src`、`node_modules`、`package.json` 以外的全部文件和文件夹。
3. 打包到 `release/components/`(同名的旧文件先删)：

| 形式 | 文件名 | 内容 |
|---|---|---|
| zip(默认) | `<id>.zip` | 上面那些文件，`component.json` 在最外层 |
| npm 包(`--npm`) | `<包名>-<版本>.tgz`(包名里的 `@` 去掉、`/` 换成 `-`) | 和 `npm pack` 一样的 tar.gz，文件在 `package/` 下，另加生成的 `package.json` |

- 不写文件夹时打包 `examples/` 下的全部组件。
- 一个文件夹失败不影响其余的，最后以退出码 1 结束。
- 打包用 Windows 自带的 `tar.exe`，不调用 npm。

zip 的安装见 [组件管理](component-manager.md)；npm 包的 `package.json` 怎么生成、怎么发布和安装见 [组件市场](market.md)；写组件的完整过程见 [写一个组件](develop.md)。

## SDK 类型包

`npm run build:sdk` 生成 `release/sdk/`，包名 `@konkon-lab/foxpanel-sdk`，只有类型：

- `tsc` 按 `sdk/build.tsconfig.json` 只出声明文件到 `release/sdk/types/`：入口 `sdk/index.ts`(声明是 `types/sdk/index.d.ts`)和主窗口模块 `src/renderer/window-api.ts`，它们引用的 `src/` 里的类型也一起生成。
- 声明里相对导入的 `.ts` 扩展名换成 `.js`。
- 主窗口模块：`types/window-module.d.ts` 写 `declare module '@konkon-lab/foxpanel-window'`，内容取子路径 `@konkon-lab/foxpanel-sdk/window`；入口的声明开头引用它，所以装了 SDK 就能 `import` 这个模块。
- `package.json`：`version` 是程序版本，`type` 是 `module`，`exports` 有 `.` 和 `./window` 两个类型入口，`files` 是 `types`、`README.md`、`LICENSE`，`license` 是 `MIT`，`repository` 是程序的仓库，`publishConfig.access` 是 `public`；`peerDependencies` 里的 `cordis` 和程序用的版本一样，`vue` 是可选的(只有主窗口组件要)。
- `README.md` 是 `docs/sdk.md` 的副本，`LICENSE` 是仓库根的许可证；README 里指向其他文档的相对链接(`components.md`、`component-process.md` 等)在包里没有对应的文件，要看仓库的 `docs/`。
- 发到 npm 用 npm 的可信发布(OIDC)，不用令牌：仓库变量 `PUBLISH_SDK` 是 `true` 时，发版工作流在建 release 之后 `npm publish`，正式版标 `latest`、测试版标 `beta`；来源证明(provenance)由可信发布自动带上。变量不是 `true` 时不发。
- 第一次要手动发：可信发布要在包已经存在后才能登记。维护者在本地 `npm run build:sdk`，在 `release/sdk/` 里用两步验证 `npm publish`；然后在包的 Settings → Trusted publishing 里登记 GitHub Actions：组织 `konkon-lab`、仓库 `FoxPanel`、工作流文件 `release.yml`，环境留空(正式版和测试版都能发)，允许的操作勾上 npm publish(不勾时只能暂存，要到 npm 上批准)。登记后 2 天内要有一次成功的发布，否则失效。

SDK 的版本就是宿主接口的版本：npm 组件包在 `peerDependencies` 里写它的范围，装之前按程序版本检查，见 [组件市场](market.md)。类型的用法见 [SDK](sdk.md)。

## 自动更新

`src/main/updater.ts` 用 electron-updater 检查、下载、安装新版本。

更新源由 `package.json` 的 `build.publish`(electron-builder 的配置)定。有更新源时，打包在安装包的 `resources/` 里生成 `app-update.yml`、在 `release/` 里生成 `latest.yml`；程序看有没有 `app-update.yml` 决定检查不检查。

| `build.publish` | 打包的结果 |
|---|---|
| `null` | 不生成这两个文件，程序不检查更新(状态 `unconfigured`) |
| `{ "provider": "github", "owner": "…", "repo": "…" }` | 生成；程序到这个仓库的 Releases 检查更新，仓库要是公开的 |
| 没写 | electron-builder 自己找更新源：`package.json` 的 `repository` 或 git 的 `origin` 远程是 GitHub 仓库时按它生成，两样都没有时不生成 |

仓库的 `build.publish` 是 GitHub 仓库 `konkon-lab/FoxPanel`：打出的安装包到它的 Releases 检查更新，仓库要是公开的，每个版本的 release 里要有安装包、`.blockmap` 和 `latest.yml`(发版工作流会传，见「发布一个版本」)。打包后用 `release/win-unpacked/resources/app-update.yml` 在不在、里面的 `owner`、`repo` 对不对来核对。

什么时候检查：

- 设置里「自动检查更新」开着时，启动 10 秒后检查一次。
- 用户在设置页「更新与关于」点按钮(`update:check`)。

| 状态 | 含义 |
|---|---|
| `idle` | 还没检查过 |
| `dev` | 开发版(未打包)，不检查 |
| `unconfigured` | 没有 `app-update.yml`，不检查 |
| `checking` | 检查中 |
| `latest` | 已是最新 |
| `available` | 有新版本，没下载(「后台下载更新」关着时)；带 `version` |
| `downloading` | 下载中；带 `version`、`percent` |
| `downloaded` | 下好了，等用户点「重启并安装」；带 `version` |
| `error` | 失败；带 `message` |

- 正在下载或已经下好时再检查不做任何事。
- 状态是 `available` 时用户点按钮 = 开始下载，状态立即变成 `downloading`(0%)。
- 下好之后不自动安装：用户点「重启并安装」(`update:install`)才退出并安装；程序正常退出时也不装(`autoInstallOnAppQuit` 关着)，下次启动检查时接着用下好的文件。
- 点「重启并安装」：electron-updater 启动安装程序，退出之前发 `before-quit-for-update`，主窗口收到后这次关闭不询问、不关到托盘(`MainWindow.allowQuit`)，程序照常收尾退出。安装程序没启动起来时不退出，状态变成 `error`。
- 每次换状态都推给主窗口(`update:event`)，主窗口也可以主动取(`update:state`)。状态写一行运行日志，检查中和下载进度不写，失败记成 `warn`。

和更新有关的应用设置有三项，在设置页改：`autoCheck`(自动检查更新，启动时检查)、`autoDownload`(后台下载更新，发现新版本就下载)、`beta`(接收测试版，也检查预发布版本)。后两项改了立刻生效；默认值见 [主窗口](main-window.md#应用设置)。

设置页的版本一行(`components/window-settings/src/UpdateRow.vue`)显示程序版本、更新状态和一个按钮：下好了是「重启并安装」，有新版本没下载是「下载更新」，其余是「检查更新」。`dev` 显示「开发版不检查更新」，`unconfigured` 显示「这个版本不带自动更新」，这两种状态下按钮点不了；`error` 显示「更新失败」，原因在鼠标悬停的提示和运行日志里。状态怎么对到文案和按钮在 `components/window-settings/src/update-view.ts`。设置页的其余部分见 [主窗口](main-window.md)。

## 发布一个版本

版本分两种，看版本号带不带 `-`：

| | 版本号和 tag | GitHub release | 谁会收到更新 |
|---|---|---|---|
| 正式版 | `0.2.0`，tag `v0.2.0` | 正式版，标成最新 | 所有人 |
| 测试版 | `0.2.0-beta.1`、`0.2.0-beta.2`…，tag `v0.2.0-beta.1` | 预发布 | 设置里开了「接收测试版」的人(`allowPrerelease`) |

打 tag、推送由人来做；推送 `v<版本>` 的 tag 后，发版工作流 `.github/workflows/release.yml` 打包、建 release、上传。

1. 工作区干净。正式版在 `master` 上；测试版可以在任何分支上。
2. 定版本号：`npm version <版本> --no-git-tag-version`。写更新日志：正式版必须有 `changelog/<版本>.md`；测试版可以写 `changelog/<版本>.md`，不写时用正式版本号的那份(见下面第 7 步)。
3. 内容变了的预装组件升各自 `component.json` 的 `version`(见「预装组件的版本检查」)。
4. 本地先跑一遍：`npm run vendor:rime`、`npm run check`、`npm run smoke -- --boundary`、`npm run pack`，再 `node scripts/smoke.ts --exe release/win-unpacked/FoxPanel.exe`；看 `release/win-unpacked/resources/app-update.yml` 里的 `owner`、`repo` 是 `konkon-lab`、`FoxPanel`。
5. 只有正式版：`npm run check:preinstalled -- --record`，把版本号、预装组件的版本号和 `components/released.json` 的改动一起提交。测试版不记，免得测试版的组件版本被当成已发布。
6. 打 tag `v<版本>`(和 `package.json` 的 `version` 一致)，推送提交和 tag。
7. 发版工作流的第一步 `prepare`(核对，不打包)：
   - tag 和 `package.json` 的版本不一致就停下。
   - 正式版的 tag 指向的提交不在 `master` 上就停下。
   - 发布说明(`scripts/release-notes.ts`)：取 `changelog/<版本>.md`；正式版没有这个文件就停下；测试版没有时取正式版本号的文件(`0.2.0-beta.1` 取 `0.2.0.md`)，前面注明是测试版，也没有时写「暂无更新日志」。
8. 第二步 `release`：正式版在 GitHub 的 `production` 环境里等审批，在 Actions 页面批准后才往下走；测试版用 `testing` 环境，不等。接着下载输入法引擎和词库、`npm run check`、`npm run pack`，发布说明末尾附安装包的 SHA256，建 release：
   - 上传 `FoxPanel-Setup-<版本>.exe`、`.blockmap` 和 `release/` 里的更新信息文件。`build.generateUpdatesFilesForAllChannels` 开着，再补齐 `latest.yml` 和 `beta.yml` 两个，开没开「接收测试版」的程序都能在这个 release 里找到自己要的那个。更新信息文件里记着安装包的 sha512，安装包重新打过要一起换；少了它，已装的程序检查更新时得到的是失败。
   - 测试版标成预发布、不标最新；正式版标成最新。

要在 GitHub 上先建好的：`production` 环境(Settings → Environments，审批人设成维护者)；`master` 的分支保护，`CI` 工作流通过才能合并。

第一次推送之前另外要做的：

- `git status --short` 确认没有不该进仓库的文件。
- 在 GitHub 上建好公开的 `konkon-lab/FoxPanel`，再加 `origin` 远程。

### 还没定的几项，定了之后改哪里

| 事项 | 定了之后改哪里 |
|---|---|
| 第一个版本号 | `npm version`。`pack:component --npm` 写进组件包的宿主版本范围是 `^<程序版本>`：版本是 `0.x` 时这个范围只含同一个次版本号(`^0.1.0` 不含 `0.2.0`)，程序升次版本号后，照旧版本打的 npm 组件包在市场里装不上，要作者重新打包；`1.0.0` 起范围是整个主版本号。规则在 `src/shared/version.ts`，说明在 [组件市场](market.md) |
| SDK 类型包什么时候开始发 npm | 包已经准备好。要发时：npm 上建好组织 `konkon-lab`，按「SDK 类型包」一节手动发第一次并登记可信发布，再把仓库变量 `PUBLISH_SDK` 设成 `true`；之后每次发版都会一起发 |
| 安装包签不签名 | 签：在 `build.win` 里配证书后重新打包。不签：[使用说明](guide.md#安装)写明下载和运行时 Windows 的提示怎么继续，发布说明附安装包的 SHA256 |

## 冒烟检查

`npm run smoke` 先构建，再由 `scripts/smoke.ts` 把打包好的程序真的启动两次、经 Chrome 调试协议操作页面；已经构建过时可以直接 `node scripts/smoke.ts [--boundary]`。它不在 `npm run check` 里。

`node scripts/smoke.ts --exe <可执行文件>` 换成启动打包后的程序(`npm run pack` 之后的 `release/win-unpacked/FoxPanel.exe`)：启动参数里不带仓库根，只跑离屏方式那一次(安装包里没有开发用的显示方)，不能和 `--boundary` 一起用。进安装包的文件对不对(`files` 的筛选、`node_modules` 里的依赖、`vendor/` 的路径)由这一轮查到。

- 用仓库里装的 Electron 启动，`--user-data-dir` 指到系统临时目录下新建的 `foxpanel-smoke-…` 文件夹(每次启动各一个)，不碰平时用的数据文件夹；调试端口由系统分配。
- 第一次是窗口方式：环境变量 `FOXPANEL_PANELS=1`，开发用的显示方把每块显示着的面板开成普通窗口，它的同时显示的上限设成 4。数据文件夹里预先放这些组件，都先关着或放在开发文件夹里：时钟面板(`examples/panel-clock`)放进组件目录、先关着；常用语侧栏页(`examples/side-phrases`)放在一个开发文件夹里，开发者模式开着；三块只给检查用的面板(脚本里现写的，先关着)——`smoke.probe`(清单写了 `requires: ["panels"]`，页面里有一块能滚动的区域和一个按钮)和两块凑数的 `zsmoke.fill-a`、`zsmoke.fill-b`(组件顺序排在时钟后面，用来顶到上限)。
- 第二次是离屏方式：不带 `FOXPANEL_PANELS`，带 `FOXPANEL_VR_SIM=<脚本>`，SteamVR 组件不连 SteamVR、跑模拟脚本(见 [SteamVR 悬浮面板](steamvr.md#模拟模式))，它是生效的显示方；时钟(`examples/panel-clock`)和手腕时钟(`examples/panel-wrist`，附着在左手上、抬手才显示)两个示例的组件一开始就开着，所以有键盘、时钟、手腕时钟三块面板。离屏渲染、句柄复制进组件进程、D3D 复制、指点回页面这一段只有这一次启动走到；要一块能建 D3D11 设备的显卡。
- 启动时带两个开关(`--disable-backgrounding-occluded-windows`、`--disable-features=CalculateNativeWinOcclusion`)：窗口被别的窗口盖住时页面照常算可见。不带的话面板的窗口被盖住后，调试协议发的鼠标事件要等几秒才到页面，打字那几步会超时。
- 要先有 `vendor/rime`(`npm run vendor:rime`)，不需要 SteamVR。全新的数据文件夹要部署词库，约二十秒(最多等 120 秒)；整轮约两分钟。只能在 Windows 上跑：窗口在系统里显示没有是经 koffi 问 user32 的 `IsWindowVisible`。
- SteamVR 正在运行时：第一次启动里 SteamVR 组件(预装，默认开着)不是生效的显示方，等着：不连 SteamVR、不开面板页面，SteamVR 自己的配置不会被动到(见 [SteamVR 悬浮面板](steamvr.md#连接和断开))；运行日志里有一行警告说明 `panels` 由开发用的显示方提供。第二次启动跑的是模拟脚本，也不连 SteamVR。
- 每一步打印「通过」或「失败」和原因。退出码：全部通过是 0，有步骤失败是 1，参数不认识是 2。
- 中途失败、程序自己退出、按 Ctrl+C 时也会结束程序、删掉临时文件夹；结束程序只按自己启动的那个进程号。

窗口方式的步骤：

| 步骤 | 查什么 |
|---|---|
| 启动程序 | `dist/main.js` 在，程序启动起来 |
| 接上主窗口、键盘面板、媒体页面 | 三个页面都出现，各连上调试协议；面板页面只有键盘一块 |
| 输入法部署期间键盘面板上盖着部署提示，提示上的字跟界面语言 | 部署提示盖着；在主窗口换两次界面语言，提示上的字跟着换(三种语言各不相同)；最后改回去。部署在看全之前就结束了的话，关掉再打开输入法组件让它重新部署接着看，最多 3 次 |
| 输入法部署完，键盘面板画出键区 | 部署提示收起(最多等 120 秒)，键区里有键，页面上没有「缺少…组件」之类的提示 |
| 键盘面板打字选词 | 用鼠标事件依次点 n、i、h、a、o，候选第一个是「你好」；点空格后「你好」进输入框、候选清空；点清空按钮后输入框变空 |
| 换界面语言，键盘面板的文字和键盘状态跟着换 | 键盘面板文档和根元素的 `lang`、键盘状态里的界面语言都是当前的界面语言；在主窗口换两次界面语言，这三处和部件上的文字(日夜切换按钮的说明)跟着换，页面不重载；最后改回去 |
| 按日夜切换按钮，键盘面板的深色跟着换 | 点侧栏的日夜切换按钮，根元素和弹层的深色、设置里面板的深色一起换；再点一次换回来 |
| 关掉语言组件后键盘的语言列表少一项，再打开后恢复 | 在主窗口关掉日文语言组件，键盘状态里的语言列表少了它；再打开后它回来 |
| 关掉输入法组件后部件撤掉、外壳里显示缺件提示，再打开后恢复 | 在主窗口关掉输入法组件：要它的组件都不算在用、不进键盘面板的计划，面板还在，经典外壳的候选栏、输入框、键区位置各显示一条缺件提示，不盖部署提示；这时换界面语言，提示的文字跟着换；再打开后部件回来、输入法部署完，再打一遍字 |
| 打开时钟示例的组件，时钟面板有自己的窗口，键盘面板没有重载 | 多出一个面板页面，有自己的源和窗口(窗口里是清单写的页面大小)，画出时间和日期，标题是组件的名字；键盘面板的页面没有重载 |
| 两块面板和主窗口各有自己的源，localStorage 互不相通 | 三个页面的源各不相同；一页写进 localStorage 的值另外两页读不到 |
| 改键盘侧栏页的设置只有键盘面板重载，改时钟的设置只有时钟面板重载 | 改常用语侧栏页的一项设置：键盘面板重载、计划里是新的值，时钟面板不动；改时钟的「显示秒」：时钟面板重载并带上秒，键盘面板不动 |
| 开发文件夹里的文件保存后，只有用到它的键盘面板重载 | 往开发文件夹里常用语的入口文件末尾加一行：键盘面板自己重载，计划里它的入口地址换了；时钟面板不动 |
| 点时钟面板上的收起按钮，显示方隐藏它的窗口，键盘面板不受影响 | 页面先确认自己正被显示；点收起按钮(`ctx.panel.hide()`)后时钟的窗口在系统里不显示了，页面还在、没有重载、得到没在显示的通知；键盘面板的窗口照常显示、没有重载，时钟的组件还开着，运行日志里没有多出 warn 或 error；关掉再打开它的组件后窗口回来 |
| 关掉时钟的组件只有它的窗口消失，键盘面板没有重载，再打开后回来 | 关掉后面板页面只剩键盘一块，键盘面板没有重载、照常能打字；再打开后时钟的页面回来 |
| 经远程服务 panels 开关、收起和恢复、改宽度、改附着和抬手才显示、锁、到面前、顶到上限，状态和窗口同步变化；能滚动的区域按住拖动就滚 | 打开三块检查用的面板，从 `smoke.probe` 的页面里调远程服务 `panels`。每一小步等三样对上：`panels` 的状态、各块面板的窗口在系统里显示没有、页面得到的显示通知。依次：五块都算打开、只显示前四块，第五块没开页面，都留在空间里、不用抬手；到上限时 `open`、`summon` 第五块不生效；改时钟的宽度(夹在清单的范围里)；时钟的附着对象换到头显、打开再关掉抬手才显示、换到左手(连带抬手才显示、锁上)、不认识的附着对象和不是布尔的抬手才显示不起作用、换到右手(同一次给的抬手才显示和宽度照给的)，`reset` 回到清单的留在空间里、不用抬手、默认宽度，窗口全程显示着；关掉一块后第五块开得了；全局锁、单块锁能锁能解；时钟用自己的收起按钮收起后算关着，`summon` 把它打开；时钟再用收起按钮收起、键盘(1 号快捷位指向它)关掉，`toggleAll` 把两块都带回来(这时关着的第五块跟着算打开，排在上限之后、不显示)；没有面板藏着时 `toggleAll` 整组隐藏(仍算打开)再恢复同一组，常显的不跟着收起；参数不对、没有这块面板的调用不起作用。拖动滚动：在能滚动的区域里按住拖 60 像素，内容滚 60 像素、不算点击；拖 5 像素不滚；之后点按钮照常算点击。键盘面板和时钟面板全程没有重载 |
| 面板页面跳不到外站，开不了新窗口 | 两块面板的页面：开新窗口(外站的、自己这个地址的)开不成，程序的页面一个没多；把地址改到外站，地址不变、页面没有重载 |
| 主窗口各页都能点开 | 侧栏的每一项点开后选中的换成它、内容区画出标题，这一页期间没有新的报错 |
| 各页面没有报错 | 接过的每个页面的未捕获异常、没人接的 promise 拒绝、`console.error` |
| 运行日志里没有 error 级的行 | 主窗口读到的运行日志；warn 级的行列在这一步下面，不算失败 |
| 结束程序，删掉临时文件夹 | 进程已退出，文件夹已删 |

加 `--boundary` 时在第一次启动结束之前多查页面的权限边界(见 [总体结构](architecture.md#安全边界))：

| 步骤 | 查什么 |
|---|---|
| 边界：面板页面和媒体页面的 window.fox 上没有组件管理、应用设置、更新、目录、市场的接口 | 键盘面板、时钟面板、媒体页面的 `window.fox` 上正好是 `PageApi` 的 14 个接口；点名的 30 个主窗口接口一个都没有，主窗口上都有 |
| 边界：开发用的显示方不出现在组件列表里 | 主窗口拿到的组件列表里没有它，卸载被拒绝 |
| 边界：键盘面板读写不了别的组件的数据 | 自己加载的组件的数据能读写；别的组件的数据读不到、改不了 |
| 边界：时钟面板和键盘面板读写不了对方组件的数据 | 各自用自己的根组件 id 能读写；用对方的 id 读不到、写被拒绝，对方的值没变 |
| 边界：键盘面板卸载不了组件 | 页面上没有卸载组件的接口，组件还在 |
| 边界：键盘面板只能开关输出组件 | 经远程服务 `keyboard` 发的键盘操作 `output` 能开关输出组件，对别的组件和没装的 id 不起作用 |
| 边界：键盘面板只能往自己组件的总线频道发，只收到登记了的自己组件的频道 | 自己组件的频道送到主窗口、自己收不到回声；`core/` 的频道和别的组件的频道送不出去；别的页面发的消息，键盘面板登记了的自己组件的频道才收到，别的组件的频道登记了也收不到；主窗口发的 `core/` 频道送不出去 |
| 边界：键盘面板只能用组件声明了的远程服务，主窗口用不了 | 键盘面板订阅、调用这一页的组件在清单里写了的远程服务不被拒绝；没写的名字被拒绝；主窗口上没有这两个接口 |
| 边界：时钟面板够不着它没声明的远程服务 keyboard | 时钟面板的计划里只有它自己；订阅、调用 `keyboard`、`panels` 和别的名字都被拒绝；键盘面板照常能用 `keyboard` |
| 边界：没有声明 panels 的面板调不了它，声明了的才行 | 时钟面板订阅 `panels` 被拒绝，调 `open`、`toggleAll` 都被拒绝，键盘和时钟的窗口照常显示；检查用面板(清单写了 `panels`)发同样的 `open` 才把键盘面板收起 |
| 边界：键盘面板开不了麦克风 | 查到的权限状态是拒绝，打开时失败 |
| 边界：面板页面联不了网，嵌不了自己组件包里的网页 | 键盘面板和时钟面板直接取本机上临时开的一个 HTTP 服务取不到；把时钟组件包里的一个网页(它会去取同一个服务、开 WebSocket)嵌进页面，网页里的脚本没跑起来；那个服务一个请求都没收到 |
| 边界：主窗口跳不到外站 | 把主窗口的地址改到外站后地址不变 |

离屏方式的步骤(第二次启动，带不带 `--boundary` 都跑)：

| 步骤 | 查什么 |
|---|---|
| 离屏方式：带模拟脚本启动程序，SteamVR 组件当显示方，时钟和手腕时钟两个示例开着 | 程序启动起来。脚本：一开始给头的姿态和左手的指尖(指尖的射线一直斜着打在左手上那块面板的正中)；连上 3 秒后按总开关键显示面板；13 秒起右手指着键盘面板正中扣一下扳机，左手指着时钟面板正中扣一下扳机，再抓住时钟往右挪 0.3 米；21 秒时往时钟的页面发一次往下 120 像素的滚轮；22 秒时把左手抬到眼前，左手扣一下扳机，23 秒时右手指着手腕时钟正中扣一下扳机再移开，25.5 秒时放下左手；27 秒时结束 |
| 离屏方式：接上主窗口和离屏的键盘面板、时钟面板、手腕时钟面板 | 四个页面都出现；三块面板都没有被当成显示在普通窗口里；在页面里装上记鼠标事件的监听 |
| 离屏方式：三块面板的帧各贴进自己的纹理，分别指着正中扣扳机，各自的页面收到按下和松开；抓住时钟挪到一边；滚轮往下滚；手腕时钟相对左手放，抬手才显示，左手的射线点不到它 | 模拟脚本跑完写出的记录里，每块面板：有读回的画面，纹理每边和清单写的(键盘 1400 × 490、时钟 480 × 200、手腕时钟 240 × 120，乘纹理倍数)差不超过 1 像素，发给页面的指点事件里有落在正中的按下和之后的松开、且只有一次按下；读回的 PNG 大小对得上，键盘的大半像素不透明、另两块画着东西；页面里真的收到了正中的 `mousedown` 和 `mouseup`。键盘和时钟：悬浮窗口显示着，最后一次放它用的是绝对位置，只显示过一次、没隐藏过。手腕时钟：最后一次是相对 1 号设备(左手)放的，只在抬手之后显示一次、放下之后隐藏，跑完时隐藏着；右手指上来之前没有任何指点事件(左手的射线和扳机点不到它)。时钟的悬浮窗口比键盘的往右挪了 0.3 米(差不超过 0.05 米)；时钟页面里的内容往下滚了 120 像素 |
| 离屏方式：各页面没有报错，运行日志里没有 error，也没有面板页面的警告 | 四个页面的报错；运行日志没有 error 级的行，没有提到面板、帧、模拟、核对求交的 warn，有模拟脚本跑完的那一行 |
| 离屏方式：结束程序，删掉临时文件夹 | 进程已退出，文件夹已删 |

脚本里不用启动程序的部分(命令行参数、调试协议的请求和事件、运行日志的分拣、步骤的打印和退出码、模拟脚本和它的记录的检查、读回画面的检查、窗口方式里显示方的设置和收起按钮、总开关那几步等的结果)的单元测试在 `test/smoke-cdp.test.ts`。

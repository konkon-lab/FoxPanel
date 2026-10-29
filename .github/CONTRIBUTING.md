# 贡献指南

感谢你愿意为 FoxPanel 出一份力！报告问题、提建议、写组件、改代码、完善文档，都是对项目的帮助。

动手之前，请花几分钟读完这份指南。

## 行为准则

参与讨论和贡献时，请遵守 [行为准则](CODE_OF_CONDUCT.md)，保持尊重与友善。

## 如何贡献

### 先想想能不能写成组件

FoxPanel 的功能都由组件提供。想加的功能如果能写成组件，就不用改核心：照 [写一个组件](../docs/develop.md) 做好，发布到 npm，别人在主窗口的市场页里就能装上。只有组件做不到、需要核心提供新能力时，才需要改这个仓库。

### 报告 Bug

在 [Issues](https://github.com/konkon-lab/FoxPanel/issues) 里用「报告 Bug」模板新建一个，尽量写清楚：

- 出了什么问题，你期望的结果是什么
- 复现的步骤
- 系统版本、FoxPanel 版本、头显和 SteamVR 版本，装了哪些第三方组件
- 截图，或主窗口「日志」页里相关的几行

### 提交功能建议

请遵循「先讨论，后开发」：

1. 在 Issues 里用「功能建议」模板写清楚想要什么、在什么场景下用、解决什么问题。
2. 和维护者、其他人一起讨论可行性和做法。
3. 达成一致后再开始写代码。

这样可以避免花了很多时间写完，才发现和项目的方向不合、拉取请求合不进来。

## 开发流程

- **修 Bug**：Issue 里已经确认过的 Bug，可以直接修好提交拉取请求，在描述里写上 `Closes #编号`。
- **新功能**：先走完上面的讨论。然后 Fork 本仓库，从 `master` 建一个分支(如 `feature/xxx`)，写完后向本仓库的 `master` 提交拉取请求，按模板说明改了什么、为什么改、怎么验证的。
- 依赖的安装脚本要在 `package.json` 的 `allowScripts` 里批准过才会跑(按版本记)。加了或升级了带安装脚本的依赖，`npm approve-scripts --allow-scripts-pending` 会列出来，确认可信后 `npm approve-scripts <包名>`，不需要的 `npm deny-scripts <包名>`，改动一起提交。
- 提交前请确认 `npm run check` 通过；改了预装组件的内容，记得升它的版本号；用户能感知的变化，在下一个版本的更新日志里记一条(见下面的「更新日志」)。

## 开发环境

- 64 位的 Windows 10 或 11。
- Node.js 24：脚本和测试是 TypeScript，由 Node 直接运行。
- Git：`npm install` 在克隆下来的仓库里把提交钩子指到 `.githooks`
- 除 npm 仓库外要能连 GitHub：`npm run vendor:rime` 从 github.com 和 raw.githubusercontent.com 下载输入法引擎和词库(约 140 MB)；Electron 的程序文件在第一次 `npm start` 或 `npm run smoke` 时才下载。连不上时可以设 `ELECTRON_MIRROR` 换 Electron 的下载地址，设 `NODE_USE_ENV_PROXY=1` 加 `HTTPS_PROXY` 让 `vendor:rime` 走代理。

```bash
git clone https://github.com/konkon-lab/FoxPanel.git
cd FoxPanel
npm install
npm run vendor:rime
npm start
```

源码版和安装版用同一个数据文件夹(`%APPDATA%\FoxPanel\`)，同时只能开一个：安装版开着时 `npm start` 只会把它的窗口置顶。如果需要数据分离，请使用：`npm start -- --user-data-dir=<文件夹>`。

## 代码约定

### 代码

- 全部用 ES 模块(`import` / `export`)。
- 源码一律 TypeScript，严格模式；只用可擦除语法，不用 enum、namespace、构造参数属性。
- 禁止 `any`。外部输入(IPC 参数、进程消息、远程调用的参数、OSC 值、配置文件、组件清单)用 `unknown` 接收再收窄，收窄用的小函数在 `src/shared/util.ts`。
- 相对导入写完整的 `.ts` 扩展名。
- promise 必须 `await`、`.catch()`，或用 `void` 标明不关心结果。
- 主进程、preload、页面共用的类型和 IPC 通道名只在 `src/shared/types.ts` 定义。页面发来的 IPC 都经 `src/main/ipc.ts` 注册，加通道时在策略表里加一条。
- 主进程里的逻辑文件不导入 electron：建窗口、复制句柄、计时做成注入项，测试里用假对象。真的 `BrowserWindow` 只出现在 `window.ts`、`pages.ts`、`panel-window.ts` 这几个很薄的文件里。
- 核心里不放某一种组件专属的代码，功能由组件提供；预装组件和别的组件用同一套接口。
- 预装组件改了内容要升它的版本号，已装的才会在启动时更新。
- API key 等密钥只用 safeStorage 加密保存，不写明文、不提交。

### 注释和文档

- 中文，简短，说明下面的函数或代码块具体做什么、常量的含义和单位。
- 只写代码做什么，不写它是怎么一步步写成的。
- 用到的依赖和许可证来源写在 [OPEN_SOURCE_LICENSES.md](../OPEN_SOURCE_LICENSES.md)。

### 提交

```
feat/fix/ui：简短标题

-描述1
-描述2
```

- 类型只用 `feat`(新功能)、`fix`(修问题)、`ui`(界面)，后接全角冒号。
- 标题不超过 20 个字，细节写到描述里；标题下面空一行。
- 描述每行以 `-` 开头，写这次提交的代码做了什么。

`npm install` 会把提交钩子指到 `.githooks`：`commit-msg` 检查上面的格式，`pre-commit` 跑 `npm run check`。

## 更新日志

每个版本一个文件：[`changelog/<版本>.md`](../changelog)，如 `changelog/0.1.0.md`。

- 文件里直接写这个版本的变化，不用再写版本号和日期标题。
- 按 `## 新增`、`## 变更`、`## 修复`、`## 移除` 分组，没有的组不写。
- 只写用户能感知到的变化，一条一个短句，不展开解释；有对应的 Issue 时在句末写上 `(#编号)`。
- 推送 `v<版本>` 的 tag 时，发版工作流把这个文件的内容原样写进 GitHub release 的说明。
- 正式版(如 `0.2.0`)必须有自己的文件，没有就不发布；测试版(如 `0.2.0-beta.1`)可以不写，这时用 `0.2.0.md` 并注明是测试版，也没有就写「暂无更新日志」。版本号和发版的步骤见 [打包和更新](../docs/release.md#发布一个版本)。
- `package.json` 当前版本的文件必须存在，单元测试会检查。

## 命令

| 命令 | 作用 |
|---|---|
| `npm start` | 打包并启动 |
| `npm run build` | 打包到 `dist/` |
| `npm run vendor:rime` | 下载输入法引擎和词库到 `vendor/rime/` |
| `npm run typecheck` | 类型检查(vue-tsc，含 .vue) |
| `npm run lint` | ESLint |
| `npm test` | 单元测试(node:test，直接跑 .ts) |
| `npm run check` | 以上三项 |
| `npm run test:coverage` | 单元测试并统计覆盖率，结果写到 `coverage/lcov.info`；CI 跑它并传到 Codecov |
| `npm run smoke [-- --boundary]` | 冒烟检查：用临时数据文件夹把程序真的启动起来操作一轮，加 `--boundary` 多查页面的权限边界 |
| `npm run pack` | 生成 Windows 安装包 `release/FoxPanel-Setup-<版本>.exe`，只打包不上传 |
| `npm run check:preinstalled [-- --record]` | 预装组件的版本检查：内容变了而版本号没升就报错 |
| `npm run pack:component [-- --npm] [文件夹…]` | 把组件文件夹打成 zip，加 `--npm` 打成 npm 包；不写文件夹就打包 `examples/` 下全部 |
| `npm run build:sdk` | 生成组件 SDK 类型包 `release/sdk/` |

打包、发布和冒烟检查的细节见 [docs/release.md](../docs/release.md)。

不用 SteamVR 也能调试面板：带环境变量 `FOXPANEL_PANELS=1` 跑 `npm start`，每块打开的面板显示成一个普通窗口，各终端的写法见 [docs/develop.md](../docs/develop.md)。

## 关于重构

FoxPanel 由个人开发者维护，现有的架构和代码风格优先照顾开发速度和维护者自己的工作流，不是为大型团队协作设计的。

每个人对「最佳实践」都有自己的看法，但为了把精力留给真正的问题，这里不接受只停留在风格或理论层面的重构争论。如果你认为某处设计确实有严重问题，欢迎提出，但请带上：

1. **具体的问题**：它在什么场景下造成了什么实际的麻烦。
2. **能落地的方案**：完整、可执行的改法，而不只是「应该换成某某架构」。
3. **可衡量的收益**：比如快了多少、少了多少维护成本。

缺少这些的重构类 Issue 和拉取请求会被直接关闭。

## 最后

再次感谢你的理解和付出！

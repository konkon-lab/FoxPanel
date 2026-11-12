# 运行日志

宿主和各个组件写的日志汇成一份运行日志：主进程在内存里留最近的行并分发出去，预装的日志组件 `yanuo.window-logs` 把它写进文件、在主窗口里显示。

## 一行日志

类型 `LogEntry`(`src/shared/types.ts`)：

| 字段 | 说明 |
|---|---|
| `id` | 行号，从 1 递增；程序每次启动重新数 |
| `time` | 时间(毫秒时间戳) |
| `level` | `info` / `warn` / `error`，由写日志的地方给出，默认 `info` |
| `source` | 来源：空字符串是宿主，否则是组件 id |
| `text` | 内容 |

预装组件和宿主的内容写成英文小写短句，比如 `loaded 24 components`、`service osc started`、`page load failed: …`。

## 谁在写

| 来源 | 途径 | `source` |
|---|---|---|
| 宿主各部分 | `src/main/main.ts` 的 `log(text, level?, source?)` | 空 |
| 主进程组件的 `ctx.log` | 组件进程发给宿主的 `log` 消息 | 组件 id |
| 主进程组件加载出错 | 宿主记一行 `load failed: …`(error) | 组件 id |
| 组件进程的标准输出和标准错误 | 宿主记成 `component host: …`，标准错误是 warn | 空 |
| 面板页面、媒体页面、主窗口里组件的 `ctx.log` | 页面调 `fox.logWrite(组件 id, 内容, 级别)` | 组件 id |
| 页面里的组件加载出错 | 页面记一行 `page load failed: …`(error) | 组件 id |
| 组件加载 5 秒后还在等服务；面板的根组件里一直没有部件要进的插槽元素 | `waiting for service: <服务名>`、`not loaded: the panel has no element for slot <插槽名>`(warn) | 组件 id |
| 面板页面加载失败、页面的进程退出；面板页面建不出来 | `panel page failed: …`、`panel page not opened: …`(error) | 面板 id |
| 页面发来、不转发的总线消息(频道名不合格、`core/` 的频道、太大、带普通数据以外的值) | 宿主记一行 `bus message … dropped: …`(warn)，同一种原因 10 秒一行(`src/main/page-bus.ts`) | 空 |
| 页面发来、主进程不处理的 IPC | 宿主记一行 `ipc <通道> refused: …`(warn)，同一个通道的同一个原因 10 秒一行(`src/main/ipc.ts`) | 空 |
| 进程异常 | 子进程退出(warn)、页面进程退出(error)、主进程未捕获的异常(error) | 空 |

页面写来的行由主进程收窄：来源必须是合格的组件 id，内容必须是字符串，一行最多留 2000 个字符，级别不认识的按 `info`。面板页面和媒体页面写的行，来源还必须是这一页加载的组件 id，别的丢掉；主窗口不限。

`ctx.log` 和 `ctx.logs` 的用法见 [SDK](sdk.md)。

## 内存里的缓冲

`src/main/logs.ts` 的 `LogBook`：

- 每写一行，编上行号和时间，放进内存；只留最近 2000 行(`LOG_KEEP`)。同时打印到主进程的标准输出，格式 `时:分:秒 [I] 来源 内容`(宿主的来源写 `host`)。
- 新行每 300 毫秒合并成一批推出去：给主窗口，给每个组件进程。
- 主窗口启动时读一次内存里的全部行(`fox.logList()`)，之后收推来的批(`fox.onLog`)，按行号只收比手上最新一行更新的；主窗口这边也只留最近 2000 行(`src/renderer/store.ts` 的 `store.logs`)。
- 组件进程启动时宿主把内存里已有的行补发给它；组件进程里也留最近 2000 行，主进程组件用 `ctx.logs.on(fn)` 监听时先收到这些已有的行，再收新的(`src/component-host/main.ts`)。

主进程只做到这里，不写文件。

## 写文件

日志组件的主进程部分(`components/window-logs/src/main.ts`，跑在组件进程里)用 `ctx.logs.on` 收每一行，按自己的设置写文件。日志组件没开时不写文件。

设置(清单 `config`，在组件详情里改)：

| 键 | 默认 | 说明 |
|---|---|---|
| `level` | `info` | 记录等级：`info` / `warn` / `error`。低于它的行不写文件，主窗口里也不显示 |
| `root` | `logs` | 日志目录：数据文件夹里的一个目录(相对路径)，用选目录对话框选 |
| `maxAge` | `14` | 保存天数，1–365 |
| `maxSize` | `10240` | 单个文件大小(KB)，默认即 10 MB |

文件(`components/window-logs/src/files.ts`)：

- 按行的日期(本地时间)一天一个文件 `年-月-日.log`；写满 `maxSize` 后接着写当天的 `年-月-日-2.log`、`-3.log` ……组件加载后和换天时从当天第一个没写满的文件接着写。
- 每行的格式是 `时:分:秒 [I] 来源 内容`：级别取首字母大写(`I` / `W` / `E`)，来源是完整的组件 id，宿主写 `host`。
- 宿主推来的一批行收完落盘一次；组件停用时把还没落盘的写完。
- 组件加载时删掉日期早于「今天减 `maxAge` 天」的日志文件。
- 目录建不了或文件写不了时丢掉这些行，不影响别的。

组件进程重启、日志组件重新加载时，宿主补发的行里有已经写过的。日志目录里的 `written.json`(`components/window-logs/src/mark.ts`)记着最后处理的那一行的时间和行号 `{ time, id }`，不在它之后的行跳过；行号每次启动重新数，所以连时间一起比。

## 显示

日志组件的主窗口部分(`components/window-logs/src/page.ts`)登记一个页面和组件详情里的一节，两处都只显示不低于记录等级的行。主窗口的登记方式见 [主窗口](main-window.md)。

**日志页**(页面 `logs`，`components/window-logs/src/LogsPage.vue`)：标题行下面一个深色日志框铺满，列出内存里的全部行。

- 一行是 `年-月-日 时:分:秒 [I] 来源 内容`(`components/window-logs/src/LogLine.vue`)。来源只显示组件 id 的最后一段(`yanuo.tts-bailian` 显示成 `tts-bailian`)，宿主显示 `host`。
- 来源按组件着色：宿主固定一种颜色，组件按 id 从 8 种颜色里取一种，同一个组件每次一样。内容里第一个冒号后面的部分、冒号前面的数字用来源的颜色。级别标记 warn 是黄色，error 是红色。
- 来源是组件列表里有的组件时，悬停这一行右边出现箭头，点了跳到那个组件的详情。
- 新行进来时滚到底；往上翻开(离底部超过 24 像素)之后不跟着滚。
- 没有行时显示「暂无日志输出」。

**组件详情里的「运行日志」**(插槽 `component-details`，order -100，预装组件放进详情的内容里排最前；`components/window-logs/src/DetailLogs.vue`)：只列正在看的这个组件最近 100 行，框最高 220 像素，行上没有跳转箭头。这个组件一行日志都没有时不显示这一节；日志组件自己的详情里不显示。

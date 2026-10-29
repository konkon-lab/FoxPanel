// 主进程、preload、页面共用的类型和 IPC 通道名。

import type { StorageOp } from './host-protocol.ts';
import type { ComponentKind, ConfigSection, DashboardCard, Manifest, PanelAnchor, PanelSpawn, SettingDef, Text, UsageDecl } from './manifest.ts';
import type { MarketSummary } from './market.ts';

// 界面语言
export const LOCALES = ['zh-Hans', 'zh-Hant', 'ja', 'en', 'ko'] as const;
export type Locale = typeof LOCALES[number];
export type LanguageSetting = 'system' | Locale;

// 组件：顺序(装上的先后，可调)、关掉的、各组件的设置、卸载过的预装组件、开发者模式加载的文件夹、
// 自建分组、折叠的分组、改过的显示名、组件市场
export interface ComponentSettings {
  order: string[];
  off: string[];
  config: Record<string, Record<string, unknown>>;
  removed: string[];
  dev: string[];
  devMode: boolean;
  groups: ComponentGroup[];
  folded: string[];                 // 默认折叠的分组 key(u:分组 id)
  names: Record<string, string>;    // 组件 id → 显示名
  market: MarketSettings;
}

// 组件市场：下载组件的仓库、是否执行包里的安装脚本
export interface MarketSettings {
  registry: string;
  scripts: boolean;
}

export const DEFAULT_MARKET: MarketSettings = { registry: 'https://registry.npmmirror.com', scripts: false };

// 市场列表里的一个组件包
export interface MarketItem {
  name: string;               // npm 包名
  version: string;            // 最新版本
  description: string;
  date: string;               // 最新版本的发布时间
  publisher: string;
  downloads: number;          // 最近一个月的下载量
  repository: string;
  component: MarketSummary;
}

// 一个组件包的详情
export interface MarketPackage {
  name: string;
  version: string;            // 这次看的版本
  versions: string[];         // 全部版本，新的在前
  component: MarketSummary | null;   // 这个版本的 foxpanel 字段；没有或不合格时为 null
  license: string;
  readme: string;
  sdk?: string;               // 要的宿主版本范围
  compatible: boolean;        // 能装：摘要合格、宿主版本在范围里
  readyAt?: string;           // 这个版本发布不满一天时：能装的时间(ISO)；没有发布时间时为空字符串
}

// 组件项目里 npm 包的改动：装上(或换版本)、卸载
export type NpmOp = { op: 'add'; name: string; version: string } | { op: 'remove'; name: string };

// 分组：数组顺序是组件树里的顺序，成员按 ids 的顺序；不在分组里的组件在树的顶层
export interface ComponentGroup {
  id: string;
  name: string;
  ids: string[];
}

// 组件管理里的一行
export interface ComponentRow {
  id: string;
  kind: ComponentKind;
  name: Text;
  version: string;
  author: string;
  license: string;
  description?: Text;
  icon?: string;                            // fox:// 地址
  folder: string;
  active: boolean;                          // 正在用：开着、单选类别里排最前、要的服务都有
  on: boolean;                              // 开关
  code: boolean;                            // 带代码：page / window / main 入口，或包里有 Lua 脚本
  dev: boolean;                             // 开发者模式从文件夹加载的
  npm?: string;                             // 从 npm 装的：包名
  settings: SettingDef[];
  sections: ConfigSection[];                 // 设置的分节
  config: Record<string, unknown>;          // 已补默认值
  secrets: Record<string, boolean>;         // secret 是否已设置
  secretHints: Record<string, string>;      // secret 的预览(前 4 位和后 2 位)；没设时为空
  error?: string;                           // 主进程组件加载出错
  usage?: UsageDecl;                        // 记用量的组件：币种和单位
  dashboard?: DashboardCard;                // 仪表盘上的快捷设置卡
  repository?: string;
  bugs?: string;
  provides?: string[];                      // 服务组件提供的服务
  requires?: { name: string; id: string | null; on: boolean }[];   // 要用的服务：提供它的组件和它是否在用
  features?: ComponentFeature[];            // 正在提供的功能(按运行状态)
}

// 组件正在提供的功能：发送目标、听写、翻译、一块面板，或者键盘上的一块(侧栏页、输入法语言等)
export type ComponentFeature = 'output' | 'dictation' | 'translation' | 'panel' | 'candidates' | 'textfield' | 'layout' | 'skin' | 'sidepage' | 'sidebutton' | 'lang';

// 清单有误、不能加载的组件文件夹
export interface BrokenComponent {
  folder: string;
  name: string;      // 文件夹名
  errors: string[];
  dev: boolean;
}

// 组件进程：没有主进程组件 / 在跑 / 退出后等着重启 / 连续崩溃已停下
export type HostStatus = 'idle' | 'running' | 'restarting' | 'crashed';

export interface ComponentList {
  rows: ComponentRow[];
  broken: BrokenComponent[];
  devMode: boolean;
  host: HostStatus;
}

// 选好 zip 后的预览：等用户确认再装
export type ComponentPreview =
  | { ok: true; manifest: Manifest; code: boolean; replaces: string | null }   // replaces = 已装的旧版本
  | { ok: false; cancelled: true }
  | { ok: false; error: string };

export type ComponentResult = { ok: true } | { ok: false; error: string };

// 显示 secret 明文：没通过验证时给原因代码
export type VerifyError = 'noKey' | 'canceled' | 'noDevice' | 'notConfigured' | 'disabled' | 'busy' | 'retries' | 'failed';
export type SecretReveal = { ok: true; value: string } | { ok: false; error: VerifyError };

// 数据文件夹里一个文件夹的子文件夹；rel 是相对数据文件夹的路径(/ 分隔，空 = 数据文件夹本身)
export type DirListing = { ok: true; rel: string; dirs: string[] } | { ok: false; error: string };

// 主窗口对组件的改动
export type ComponentPatch =
  | { kind: 'on'; id: string; on: boolean }
  | { kind: 'use'; id: string }                                   // 单选类别：选用
  | { kind: 'order'; ids: string[] }                              // 同类组件的新顺序
  | { kind: 'configs'; id: string; values: Record<string, unknown> }   // 保存一项或几项设置
  | { kind: 'devMode'; on: boolean }
  | { kind: 'market'; market: MarketSettings }
  | { kind: 'groups'; groups: ComponentGroup[] }                  // 自建分组整个换掉
  | { kind: 'fold'; key: string; folded: boolean }
  | { kind: 'name'; id: string; name: string }                    // 空字符串 = 用清单里的名字
  | { kind: 'none'; of: ComponentKind };                         // 这一类都不用(皮肤)

export const CLOSE_ACTIONS = ['ask', 'tray', 'quit'] as const;
export type CloseAction = typeof CLOSE_ACTIONS[number];
export const THEME_MODES = ['light', 'dark', 'system'] as const;
export type ThemeMode = typeof THEME_MODES[number];

// 主窗口：关闭时的操作、管理员权限、主题、缩放、更新、侧栏收起
export interface AppSettings {
  closeAction: CloseAction;
  admin: boolean;          // 启动时请求管理员权限
  theme: ThemeMode;
  zoom: number;            // 主窗口缩放 0.5–1.5
  autoCheck: boolean;      // 启动时检查更新
  autoDownload: boolean;   // 发现新版本时在后台下载
  beta: boolean;           // 也接收测试版
  navCollapsed: boolean;   // 侧栏只显示图标
}

export const DEFAULT_APP: AppSettings = { closeAction: 'ask', admin: false, theme: 'system', zoom: 1, autoCheck: true, autoDownload: true, beta: false, navCollapsed: true };

// 面板的外观：全部面板共用深色 / 浅色
export interface PanelSettings {
  dark: boolean;
}

export interface Settings {
  language: LanguageSetting;   // 主窗口和面板的界面语言
  components: ComponentSettings;
  app: AppSettings;
  panels: PanelSettings;
}

// 运行日志的一行：source 为空 = 宿主，否则是组件 id
export type LogLevel = 'info' | 'warn' | 'error';
export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  source: string;
  text: string;
}

// 运行日志在内存里留的行数(只留最近的)：主进程、主窗口、各组件进程补发给新监听的，都是这么多行
export const LOG_KEEP = 2000;

// 写一行运行日志：level 默认 info，source 是组件 id(空 = 宿主)
export type Log = (text: string, level?: LogLevel, source?: string) => void;

// 状态栏项的灯：绿 / 黄 / 灰
export const STATUS_LEDS = ['ok', 'wait', 'idle'] as const;

// 状态栏里组件上报的一项：灯、名字、名字后面的数；有 state 或 rows 时悬停弹出卡片
export interface StatusItem {
  led: typeof STATUS_LEDS[number];
  label: Text;
  value?: Text;
  state?: Text;                            // 卡片标题行右边的状态文字
  rows?: { label: Text; value: Text }[];   // 卡片里的行
}

// 状态栏：全部进程的 CPU(%) 和内存(占物理内存 %)、组件上报的项(按组件顺序)
export interface SysStats {
  cpu: number;
  mem: number;
  items: { id: string; item: StatusItem }[];
}

// 页面要加载的组件：各种页面都有的字段
interface PageBase {
  id: string;
  kind: ComponentKind;
  name: Text;
  icon?: string;
  config: Record<string, unknown>;   // 设置(已补默认值)
}

// 页面(面板页面、媒体页面、主窗口)要加载的一个带入口的组件：url 是入口 fox://component/<id>/…
export type CodeComponent = PageBase & { url: string };

// 面板页面要加载的一个组件：带入口的，或只有布局 JSON 的键盘布局(格式由按键渲染校验)
export type PageComponent = CodeComponent | (PageBase & { layout: unknown });

// 面板目录的一项：开着的组件声明的一块面板(面板 id 就是组件 id)
export interface PanelInfo {
  id: string;
  name: Text;
  icon?: string;                     // 图标地址(svg)
  width: number;                     // 页面宽高(CSS 像素)
  height: number;
  scale: number;                     // 纹理倍数：纹理像素 = 页面像素 × scale
  fps: number;                       // 帧率上限
  meters: number;                    // 默认宽度(米)
  minMeters: number;                 // 用户能缩放到的宽度范围(米)
  maxMeters: number;
  anchor: PanelAnchor;               // 第一次出现时附着在哪
  spawn: PanelSpawn;                 // 第一次出现的位置
  glance: boolean;                   // 附着在手上时只在正面朝向眼睛时显示
  keep: boolean;                     // 收起后页面不关
}

// 一块面板的页面要加载的东西。入口地址带入口文件的修改时间(?t=)，文件变了整份计划跟着变
export interface PanelPlan {
  kind: 'panel';
  id: string;                        // 面板 id
  size: { width: number; height: number };   // 页面宽高(CSS 像素)
  root: CodeComponent;               // 根组件：铺满整页
  parts: Record<string, PageComponent[]>;    // 插槽名 → 这个插槽里的部件，按组件顺序
  services: CodeComponent[];         // 根组件和部件要用的服务(沿提供者的 requires 逐层取)里有页面入口的提供者，按组件顺序
  remotes: string[];                 // 这一页够得着的远程服务名
  skin: string | null;               // 皮肤 css 地址
  sound: boolean;                    // 页面出声(按键音)
  preview: boolean;                  // 页面显示在普通窗口里
}

// 媒体页面要加载的东西：输出、输入源、翻译组件的页面代码，和它们要用的服务里有页面入口的提供者
export interface MediaPlan {
  kind: 'media';
  components: CodeComponent[];
  services: CodeComponent[];
  remotes: string[];                 // 这一页够得着的远程服务名
}

// 面板页面和媒体页面的外观和界面语言
export interface PageLook {
  dark: boolean;
  locale: Locale;
}

// 更新：dev = 开发版不检查，unconfigured = 没配置更新源
export interface UpdateState {
  state: 'idle' | 'dev' | 'unconfigured' | 'checking' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'error';
  version?: string;
  percent?: number;
  message?: string;
}

export interface InitPayload {
  settings: Settings;
  version: string;
  dataDir: string;
}

// 远程服务的一次调用是谁发的，核心填，不由调用方自报。
// where：process = 主进程组件(component 是它的 id)，panel = 面板页面(component 是面板 id)，
// media = 媒体页面(一页里的组件分不开，component 为空串)
export interface Caller {
  component: string;
  where: 'process' | 'panel' | 'media';
}

// 核心发到组件总线的通知：一个组件卸载完了(设置、secret、数据已删)，数据是它的 id
export const BUS_COMPONENT_REMOVED = 'core/component-removed';

export const IPC = {
  init: 'app:init',
  language: 'app:language',
  settingsEvent: 'app:settings-event',
  compList: 'components:list',
  compListEvent: 'components:list-event',
  compPick: 'components:pick',
  compInstall: 'components:install',
  compRemove: 'components:remove',
  compSet: 'components:set',
  compSecret: 'components:secret',
  compDevAdd: 'components:dev-add',
  compRemoveBroken: 'components:remove-broken',
  compOpenFolder: 'components:open-folder',
  compHostRestart: 'components:host-restart',
  storageCall: 'storage:call',
  busSend: 'bus:send',
  busEvent: 'bus:event',
  busListen: 'bus:listen',
  updateState: 'update:state',
  updateEvent: 'update:event',
  updateCheck: 'update:check',
  updateInstall: 'update:install',
  compSecretReveal: 'components:secret-reveal',
  compNpm: 'components:npm',
  marketSearch: 'market:search',
  marketInfo: 'market:info',
  windowPlan: 'window:plan',
  windowPlanEvent: 'window:plan-event',
  logList: 'log:list',
  logEvent: 'log:event',
  dirList: 'dir:list',
  dirMake: 'dir:make',
  logWrite: 'log:write',
  openExternal: 'app:open-external',
  winMinimize: 'win:minimize',
  winMaximize: 'win:maximize',
  winClose: 'win:close',
  closeAsk: 'win:close-ask',
  closeAnswer: 'win:close-answer',
  closeHandler: 'win:close-handler',
  setApp: 'app:set',
  openDataDir: 'app:open-data-dir',
  statsEvent: 'app:stats-event',
  relayUse: 'relay:use',
  relayCall: 'relay:call',
  relayEvent: 'relay:event',
} as const;

// 面板页面和媒体页面的 preload 用的通道；和 IPC 同名的键是同一个通道
export const PAGE_IPC = {
  plan: 'page:plan',
  look: 'page:look',
  lookEvent: 'page:look-event',
  setDark: 'page:dark',
  visibleEvent: 'page:visible-event',
  hide: 'page:hide',
  storageCall: IPC.storageCall,
  busSend: IPC.busSend,
  busListen: IPC.busListen,
  busEvent: IPC.busEvent,
  logWrite: IPC.logWrite,
  relayUse: IPC.relayUse,
  relayCall: IPC.relayCall,
  relayEvent: IPC.relayEvent,
} as const;

// 面板页面和媒体页面的 window.fox(dist/preload-page.cjs)
export interface PageApi {
  plan(): Promise<PanelPlan | MediaPlan>;               // 这一页要加载的东西
  look(): Promise<PageLook>;
  onLook(fn: (look: PageLook) => void): void;           // 深色或界面语言变了
  setDark(on: boolean): void;                           // 全部面板一起换深色 / 浅色；只有面板页面能调
  onVisible(fn: (on: boolean) => void): void;           // 这块面板正被显示(false 时页面不出帧)；登记时按当前的值调一次
  hide(): void;                                         // 请显示方收起这块面板；只有面板页面能调，没有显示方时无效
  storageCall(id: string, call: StorageOp): Promise<unknown>;   // 组件的数据；id 要是这一页加载的组件
  busSend(channel: string, data: unknown): void;        // 频道要以这一页某个组件的 id 加「/」开头
  busListen(channel: string, on: boolean): void;        // 登记 / 取消登记一个频道(这一页某个组件的频道，或核心的 core/ 频道)；登记了的才送到这一页
  onBus(fn: (channel: string, data: unknown) => void): void;
  logWrite(source: string, text: string, level?: LogLevel): void;   // source 要是这一页加载的组件
  relayUse(name: string, on: boolean): Promise<void>;   // 订阅 / 退订一个远程服务的状态；当前状态和之后的变化都经 onRelay 送来
  onRelay(fn: (name: string, state: unknown) => void): void;   // state 为 null = 没有提供者
  // 调远程服务的一个方法。wait 为 true 时等结果；false 时交给核心就返回
  relayCall(name: string, method: string, args: unknown[], wait: boolean): Promise<unknown>;
}

// 主窗口的 window.fox(dist/preload.cjs)
export interface FoxApi {
  init(): Promise<InitPayload>;
  setLanguage(lang: LanguageSetting): Promise<void>;
  onSettings(fn: (s: Settings) => void): void;          // 设置在别处改了(面板页面换了深色等)
  compList(): Promise<ComponentList>;
  onCompList(fn: (list: ComponentList) => void): void;
  compPick(): Promise<ComponentPreview>;               // 选一个组件 zip，解开检查后等确认
  compInstall(confirm: boolean): Promise<ComponentResult>;   // 安装选好的组件；false = 放弃
  compRemove(id: string): Promise<ComponentResult>;    // 卸载；开发中的组件只移除文件夹登记
  compRemoveBroken(folder: string): Promise<ComponentResult>;
  compSet(patch: ComponentPatch): Promise<ComponentResult>;
  compSecret(id: string, key: string, value: string): Promise<ComponentResult>;   // 空字符串 = 清除
  compDevAdd(): Promise<ComponentResult>;              // 选一个文件夹按开发中的组件加载
  compOpenFolder(folder: string): Promise<void>;
  compHostRestart(): Promise<void>;                   // 重新启动组件进程
  storageCall(id: string, call: StorageOp): Promise<unknown>;   // 组件的数据
  busSend(channel: string, data: unknown): void;
  onBus(fn: (channel: string, data: unknown) => void): void;
  updateState(): Promise<UpdateState>;
  onUpdate(fn: (s: UpdateState) => void): void;
  updateCheck(): Promise<void>;
  updateInstall(): Promise<void>;                     // 退出并安装下载好的新版本
  windowPlan(): Promise<CodeComponent[]>;             // 主窗口要加载的页面组件
  onWindowPlan(fn: (plan: CodeComponent[]) => void): void;
  logList(): Promise<LogEntry[]>;                     // 内存里的最近日志
  onLog(fn: (lines: LogEntry[]) => void): void;       // 新的几行
  dirList(rel: string): Promise<DirListing>;          // 数据文件夹里某个文件夹的子文件夹(目录设置的选择框用)
  dirMake(rel: string, name: string): Promise<ComponentResult>;   // 在数据文件夹里新建文件夹
  logWrite(source: string, text: string, level?: LogLevel): void;   // 页面组件写日志
  compSecretReveal(id: string, key: string): Promise<SecretReveal>;   // 先过 Windows 安全验证
  compNpm(op: NpmOp): Promise<ComponentResult>;        // 从 npm 装上、换版本或卸载组件
  marketSearch(refresh: boolean): Promise<{ ok: true; items: MarketItem[] } | { ok: false; error: string }>;
  marketInfo(name: string, version?: string): Promise<{ ok: true; pkg: MarketPackage } | { ok: false; error: string }>;
  openExternal(url: string): Promise<void>;           // 用浏览器打开 http / https 地址
  winMinimize(): void;
  winMaximize(): void;                                // 最大化 / 还原
  winClose(): void;                                   // 按「关闭窗口时」的设置处理
  onCloseAsk(fn: () => void): void;                   // 关闭方式为每次询问时点了关闭；有组件接了才会问
  closeAnswer(action: CloseAction | null): void;     // null = 取消
  setApp(patch: Partial<AppSettings>): Promise<void>;
  openDataDir(rel?: string): Promise<void>;           // 打开数据文件夹或其中的路径(/ 分隔)
  onStats(fn: (s: SysStats) => void): void;
}

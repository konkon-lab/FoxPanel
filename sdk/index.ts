// FoxPanel 组件 SDK：宿主挂在 Cordis 上下文(ctx)上的服务的类型。
// 组件入口默认导出一个 Cordis 插件；面板页面里的组件(根组件、部件、服务组件的页面部分)的 apply 拿到 PageContext，主进程组件拿到 MainContext。
// 全局服务(overlay、i18n，以及组件提供的服务如 kb、keys、osc)要在插件的 inject 里声明；其余挂在 ctx 上的直接可用。
// 服务组件用 ctx.provide(名字, 对象) 提供服务，名字写进清单的 provides；用它的组件在清单写 requires、在插件写 inject。
// 跨进程、跨页面用的服务走远程服务(ctx.relay)：提供方是主进程组件，名字同样写进清单的 provides；
// 页面里的组件要用，清单的 requires(必须有)或 uses(没有也能工作)里要有这个名字。
// 键盘的约定(预装的输入法组件提供的远程服务 keyboard、页面里的 kb 服务)在 keyboard.ts，这里一并导出。

import type { Context } from 'cordis';
import type { KbEvents, KbService, KeyboardCalls, KeyboardState } from './keyboard.ts';
import type { ComponentKind, Manifest, PanelAnchor, SettingDef, Text } from '../src/shared/manifest.ts';
import type { Caller, ComponentRow, Locale, LogEntry, LogLevel, PanelInfo, StatusItem } from '../src/shared/types.ts';
import type { AppInfo, OutputPayload, PanelInput, PanelMode, PanelPageState } from '../src/shared/host-protocol.ts';

export type {
  CandidateItem, IdleKey, IdleKeyNotice, ImeDef, ImePack, KbEvents, KbService, KeyboardAction, KeyboardCalls, KeyboardSettings, KeyboardState, KeyCode, Labels, PackMode, UiLang,
} from './keyboard.ts';
export type { Text } from '../src/shared/manifest.ts';
export type { AppInfo, OutputPayload, PanelInput, PanelMode, PanelPageState } from '../src/shared/host-protocol.ts';
export type { Caller, CloseAction, ComponentFeature, ComponentGroup, ComponentPatch, ComponentResult, ComponentRow, LanguageSetting, Locale, LogEntry, LogLevel, MarketItem, MarketPackage, MarketSettings, NpmOp, PanelInfo, StatusItem, ThemeMode } from '../src/shared/types.ts';
export type { MarketSummary } from '../src/shared/market.ts';
export type { ComponentKind, DashboardCard, Manifest, PanelAnchor, PanelDecl, PanelSpawn, SettingDef } from '../src/shared/manifest.ts';
export type { Messages } from '../src/shared/messages.ts';

// ---------- 两边都有 ----------

// 组件自己的数据(JSON 值)，页面和主进程两侧是同一份；卸载组件时删除
export interface StorageService {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

// 页面和主进程组件之间的消息；频道名用「组件id/名字」。面板页面和媒体页面里只能发、只能收这一页加载的组件的频道，
// 一条消息存成 JSON 不超过 256 KB。core/ 开头的频道是核心发的通知(页面也能收)：core/component-removed = 一个组件卸载完了，数据是它的 id
export interface BusService {
  send(channel: string, data?: unknown): void;
  on(channel: string, fn: (data: unknown) => void): () => void;   // 返回取消函数；组件卸载时自动取消
}

// ---------- 远程服务 ----------

// 约定好的远程服务：名字 → 状态和能调的方法。别的组件用声明合并往里加自己的：
// declare module '@konkon-lab/foxpanel-sdk' { interface RemoteMap { 名字: { state: …; calls: … } } }
export interface RemoteMap {
  keyboard: { state: KeyboardState; calls: KeyboardCalls };
  panels: { state: PanelsState; calls: PanelsCalls };
}

// 一个方法的参数和结果(结果是 promise 时取它给出的值)
type CallArgs<F> = F extends (...args: infer A) => unknown ? A : never;
type CallResult<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never;

// 用一个远程服务：读它的状态、调它的方法。S 是状态，M 是方法表。
// 方法名由字母、数字、下划线、$ 组成，不以数字开头，最长 64 个字符；参数是普通数据(普通对象、数组、基本类型、BigInt、二进制缓冲和它的视图)，
// 存成 JSON 不超过 64 KB(二进制按字节数算)。不合格的调用宿主不转给提供方
export interface Remote<S, M> {
  readonly state: Readonly<S> | null;             // 没有提供者、或它还没发布过时为 null；页面里是响应式的(Vue)
  watch(fn: (state: Readonly<S> | null) => void): () => void;   // 状态变了回调(登记时不调)；返回取消函数，组件卸载时自动取消
  // 等结果：方法名或参数不合格、没有提供者、方法不存在、提供方出错或停了、15 秒没回时失败
  call<K extends keyof M>(method: K, ...args: CallArgs<M[K]>): Promise<CallResult<M[K]>>;
  // 不等结果：交给宿主就返回，同一个组件进程或页面发的按先后送到提供方；交不出去(没有提供者、方法名或参数不合格)时丢掉
  tell<K extends keyof M>(method: K, ...args: CallArgs<M[K]>): void;
}

// 提供方的实现：一个普通对象，方法是它自己的属性；第一个参数是宿主填的调用者，其余参数按 unknown 收、自己收窄
export type Served<M> = { [K in keyof M]: (caller: Caller, ...args: unknown[]) => unknown };

// 提供方手里的把手
export interface Serving<S> {
  // 这个登记生效着：调用交给它，它发布的状态订阅方看得到。同名的提供者里排在后面等着时、宿主还没告诉时、撤掉之后为 false
  readonly active: boolean;
  watch(fn: (active: boolean) => void): () => void;   // 生效没有变了回调(登记时不调)；返回取消函数，撤掉或组件卸载时自动取消
  publish(state: S): void;                        // 发布状态(整份)：发给订阅了的组件进程和页面；等着的时候发布的，生效时订阅方收到最近的一份
  close(): void;                                  // 撤掉；组件卸载时自动撤掉
}

export interface RelayService {
  use<N extends keyof RemoteMap>(name: N): Remote<RemoteMap[N]['state'], RemoteMap[N]['calls']>;
  // 只有主进程组件能调，清单的 provides 里要有 name。同名的提供者有几个开着时，组件顺序最前的那个生效，其余的等它停了才接上；
  // 自己生效没有从返回的把手上看(active、watch)
  serve<N extends keyof RemoteMap>(name: N, impl: Served<RemoteMap[N]['calls']>): Serving<RemoteMap[N]['state']>;
}

// ---------- 显示方的约定(远程服务 panels) ----------

// 显示方：把面板页面显示出来并处理交互的主进程组件。每块面板开没开、在哪、附着在什么上、多宽、锁没锁都归它，存在它自己的组件数据里。
// 选项、同时显示的上限、两个快捷位指向哪块面板是显示方自己的设置(在组件页改)，状态里照设置给出。
// 面板进目录时(显示方第一次见到它，或者它的组件关掉后又打开)算打开；想让一块面板不出现，就关掉它的组件

// 一块面板在显示方那里的状态
export interface PanelView {
  id: string;                      // 面板 id(等于组件 id)
  name: Text;
  icon?: string;                   // 图标地址(svg)
  // 打开着；被总开关收起着的也算。面板用自己的收起按钮(ctx.panel.hide)收起后是 false，到按总开关显示面板时(toggleAll)一起回来
  open: boolean;
  // 这一刻在显示：打开着、没被总开关收起、显示方连着、没超过同时显示的上限；附着在头显或手上的还要那个设备在，
  // 抬手才显示的还要正面朝向眼睛
  visible: boolean;
  pinned: boolean;                 // 常显：总开关不收起它
  locked: boolean;                 // 锁定：不能抓、不能缩放，点击照常
  // 附着在哪：world = 留在空间里，head = 跟着头显，left / right = 跟着左手 / 右手的手柄。面板第一次出现时取清单的值，
  // 清单写附着在手上的一开始锁着
  anchor: PanelAnchor;
  glance: boolean;                 // 抬手才显示：附着在手上时只在正面朝向眼睛时显示；附着在别处时不起作用
  meters: number;                  // 实际宽度(米)，在 minMeters 和 maxMeters 之间
  minMeters: number;               // 能缩放到的宽度范围(米)，清单里声明的
  maxMeters: number;
  quick: 0 | 1 | 2;                // 显示方的设置里指向它的快捷位，0 = 没有
  error?: string;                  // 出错停用的原因；出错的面板算关着(open 为 false)，再打开、总开关显示面板、显示方重新连上时重试
}

// 显示方的选项
export interface DisplayOptions {
  blockInput: boolean;             // 指着或抓着面板时挡住游戏按键
  grabDelay: 0 | 0.15 | 0.4;       // 抓取延迟(秒)：握把按住这么久面板才跟手；附着在手上的面板固定 0.4 秒
  stretch: boolean;                // 双手缩放
  snap: boolean;                   // 松手时吸正
  // 面板由不显示变成显示时(总开关恢复、快捷位键、打开、重连后重建都算)的摆放：不动 / 只拉回不在面前的 / 每次重排；
  // 只管留在空间里的面板，附着在头显或手上的不动
  recenter: 'never' | 'away' | 'always';
}

export interface PanelsState {
  display: Text;                   // 显示方的名字
  connected: boolean;              // 显示方连上了；没连上时面板都不在显示，布局照常能改
  stowed: boolean;                 // 有面板被总开关收起着：toggleAll 会恢复它们
  locked: boolean;                 // 全局锁：所有面板都不能抓、不能缩放
  limit: number;                   // 同时显示的上限(块)；打开着的面板多过它时快捷位指向的面板占着位置，其余的只显示目录里靠前的
  options: DisplayOptions;
  panels: PanelView[];             // 面板目录里的每一块，按组件顺序
}

// 一块面板能改的项
export type PanelPatch = Partial<Pick<PanelView, 'pinned' | 'locked' | 'meters' | 'anchor' | 'glance'>>;

// 参数不对、目录里没有这块面板的调用不做任何事；结果都从状态里看
export interface PanelsCalls {
  // 打开或关掉一块面板，不动别的。有面板被总开关收起着时打开的这一块单独显示；显示着的已到上限时打不开(快捷位指向的面板除外)。
  // 关掉后位置和大小都留着；关着的面板按总开关显示面板时一起回来
  open(id: string, on: boolean): void;
  // 总开关：有面板藏着 → 全部显示；否则把打开着的非常显面板整组收起；两样都没有时不做任何事(出错停用的面板重试)。
  // 藏着 = 有面板被它收起着(状态里的 stowed)，或者目录里有关着的面板(用自己的收起按钮、快捷位键、open(id, false) 关掉的；
  // 有没有快捷位指向它都算)。
  // 全部显示 = 恢复被收起的那一组，关着的面板都打开，出错停用的重试；打开着的多过上限时照上限的规则显示：
  // 快捷位指向的面板占着位置，其余的只显示目录里靠前的。
  // 出错停用的面板(没被关掉、只是带着 error 停用着)不算藏着，别的面板显示着时照样整组收起
  toggleAll(): void;
  // 到面前：打开这块面板并按清单的 spawn 重新放到面前；不写 id = 显示着的面板都重新放。附着在头显或手上的面板位置不动
  summon(id?: string): void;
  // 回到清单的默认值：附着在哪、抬手才显示、宽度照清单，位置回到默认(留在空间里的按清单的 spawn 放到面前，附着的回到那个设备的默认位置)，
  // 锁定照清单的附着对象(在手上的锁着，别的不锁)；常显不动
  reset(id: string): void;
  // 改一块面板，只改给了的项。meters 夹在这块面板的 minMeters 和 maxMeters 之间；设为常显的面板被总开关收起着时显示出来。
  // anchor 变了时位置回到新附着对象的默认位置(world 是放到面前)；变成 left / right 时抬手才显示、锁着，宽度超过 0.3 米的缩到 0.3 米
  // (不小于 minMeters)——同一次调用里给了的 glance、locked、meters 照给的
  set(id: string, patch: PanelPatch): void;
  lockAll(on: boolean): void;      // 全局锁
}

// ---------- 页面组件 ----------

// 组件自己的元素：面板的根组件拿到整个页面的根元素，部件拿到所在插槽里属于自己的子元素。
// 插槽是根组件页面里带 data-slot 的元素，名字写在清单的 panel.slots 里；类别等于插槽名的部件组件(candidates / textfield / layout /
// sidepage / sidebutton)由宿主挂进去。带 data-region 的元素是给弹层盖的区域
export interface SlotService {
  readonly el: HTMLElement;
  // 在 el 里渲染，返回卸载函数(调用 render 返回的清理函数并清空 el)；放在 ctx.effect 里，组件卸载时自动调用：
  // ctx.effect(() => ctx.slot.mount(el => { ...; return () => {...} }))
  mount(render: (el: HTMLElement) => (() => void) | void): () => void;
}

export interface OverlayOptions {
  cover?: string;        // 盖住根组件里 data-region 为这个名字的元素；不写则盖住整个页面
  dismiss?: boolean;     // 点空白处关闭，默认 true
}

// 弹层：在根组件之上；返回关闭函数
export interface OverlayService {
  open(render: (el: HTMLElement, close: () => void) => (() => void) | void, options?: OverlayOptions): () => void;
}

export interface I18nService {
  readonly locale: Locale;   // 界面语言(响应式)
  text(t: Text): string;     // 按界面语言取文案
}

// 按键渲染(预装的 yanuo.keys 提供，要 inject)：在布局组件的上下文里把布局 JSON 画进它的插槽，返回卸载函数
export interface KeysService {
  mount(ctx: PageContext, layout: unknown): () => void;   // layout = 布局组件的 JSON，由按键渲染校验
}

// 面板里的一个部件：挂在根组件插槽里的组件和它的元素
export interface PanelPart {
  readonly id: string;
  readonly kind: ComponentKind;
  readonly name: string;     // 按界面语言取好的名字(响应式)
  readonly icon?: string;    // 图标地址(svg)
  readonly el: HTMLElement;  // 宿主放进插槽元素里的那个元素；根组件可以改它的 hidden(比如只显示选中的侧栏页)
}

// 面板页面里组件的 ctx.panel：这一页是哪块面板、外观、显示状态、各插槽里的部件
export interface PanelPageService {
  readonly id: string;                           // 面板 id
  readonly width: number;                        // 页面宽高(CSS 像素)
  readonly height: number;
  readonly dark: boolean;                        // 深色(响应式)
  setDark(on: boolean): void;                    // 全部面板一起变
  // 显示方让这一页画着(响应式)；false 时页面不出帧。留在空间里的面板等于正被显示；附着在头显或手上的面板该显示而
  // 设备不在、没抬手时也是 true(这一刻在不在显示看远程服务 panels 的 PanelView.visible)
  readonly visible: boolean;
  readonly preview: boolean;                     // 显示在普通窗口里
  parts(slot: string): readonly PanelPart[];     // 这个插槽里的部件，按组件顺序；根组件用它画页签、判断缺件
  // 请显示方收起这块面板(关掉它，位置和大小留着)；没有显示方时无效。按总开关显示面板时它一起回来
  hide(): void;
}

// 媒体页面里的组件(输出、输入源、翻译的页面部分)只有 id、config、storage、bus、log、relay
export interface PageServices {
  id: string;                // 本组件 id
  panel: PanelPageService;
  keys: KeysService;         // 组件提供，要 inject
  kb: KbService;             // 输入法组件提供(见 keyboard.ts)，要 inject
  slot: SlotService;
  overlay: OverlayService;   // 宿主的全局服务，要 inject
  i18n: I18nService;         // 宿主的全局服务，要 inject
  storage: StorageService;
  bus: BusService;
  config: Record<string, unknown>;   // 设置(已补默认值，不含 secret)
  log(text: string, level?: LogLevel): void;   // 写进运行日志；级别默认 info
  relay: RelayService;       // 只有 use；名字要在本组件清单的 requires 或 uses 里
}

export type PageContext = Context & PageServices;

// ---------- 主进程组件 ----------

export interface Output {
  send(p: OutputPayload): void | Promise<void>; // 发送
  live?: boolean;                               // 也收自动送出和 PIN 的实时内容
  typing?(on: boolean): void;                   // 「正在输入」
  clear?(): void;                               // 清除显示的内容
}

export interface OutputService {
  register(output: Output): void;               // 组件卸载时自动注销
  send(p: OutputPayload, live: boolean): Promise<string[]>;   // 发给开着的输出(live = 只发给收实时内容的)，返回收到的组件 id
  typing(on: boolean): void;                    // 让能显示的输出显示 / 收起「正在输入」
  clear(): void;                                // 清除各输出显示的内容
}

export interface Input {
  start(): void;                                // 听写按钮按下
  stop(): void;                                 // 再按一次
}

export interface InputService {
  register(input: Input): void;                 // 接管听写按钮；组件卸载时自动注销
  dictate(on: boolean): void;                   // 开 / 关听写：交给组件顺序最前的输入源
}

// 翻译：返回译文；出错时抛出异常(宿主用原文)
export type Translator = (text: string) => string | Promise<string>;

export interface TranslatorService {
  register(translator: Translator): void;       // 翻译组件(kind: translator)注册
  translate(text: string): Promise<string>;     // 交给翻译组件；没有时原样返回，出错时抛出异常
}

// 应用信息和对应用的操作
export interface AppService {
  readonly info: AppInfo;                       // 最新的一份
  watch(fn: (info: AppInfo) => void): () => void;   // 变了回调(登记时不调)；返回取消函数，组件卸载时自动取消
  setOn(id: string, on: boolean): void;         // 开关一个装着的输出组件(和组件页的开关是同一个改动)；别的组件不归这里开关
  clipboard: { read(): Promise<string>; write(text: string): void };   // 系统剪贴板的文字；读不了时为空串
}

// 一项的累计：各用量、次数、费用；cost 为 null = 有用量但不知道价格
export interface UsageTotal {
  amount: Record<string, number>;
  calls: number;
  cost: number | null;
}

// 组件记的一笔
export interface UsageEntry {
  item: string;                     // 项，一般是模型名
  amount: Record<string, number>;   // 用量名(清单 usage.units 里的键) → 数量
  cost?: number;                    // 这一笔的费用，不知道价格时不写
}

// 用量账本：日期(YYYY-MM-DD) → 组件 id → 项(item) → 累计
export type UsageBook = Record<string, Record<string, Record<string, UsageTotal>>>;

// 用量(预装的 yanuo.aliyun 提供)：记一笔，按天、按项汇总，主窗口在组件详情里显示；用量单位和币种写在清单的 usage 里。
// 阿里云组件没开时没有这个服务，记用量的组件用 ctx.get('usage')?.add(...)
export interface UsageService {
  add(entry: UsageEntry): void;
}

// OSC(预装的 yanuo.osc 提供)：订阅 VRChat 发来的地址、发往 VRChat
export type OscArg = number | boolean | string;
export interface OscService {
  on(address: string, fn: (...args: OscArg[]) => void): () => void;   // 返回取消函数
  send(address: string, args: OscArg[]): void;
}

// 状态栏里本组件的一项：null = 去掉；组件停用时自动去掉
export interface StatusService {
  set(item: StatusItem | null): void;
}

// 运行日志：收每一行(先补发内存里已有的行)，返回取消函数
export interface LogsService {
  on(fn: (line: LogEntry) => void): () => void;
}

// 面板页面的一帧：GPU 共享纹理的 NT 句柄(已复制进本进程)
export interface PanelFrame {
  seq: number;
  handle: bigint;                               // 用完调 release(seq) 并自己关掉句柄
  width: number;                                // 这一帧纹理的像素
  height: number;
}

// 显示方开着的一块面板的页面
export interface PanelFeed {
  readonly id: string;                          // 面板 id
  readonly width: number;                       // 纹理像素(窗口方式下是页面像素)；宿主告诉之前是 0
  readonly height: number;
  readonly state: PanelPageState;
  onFrame(fn: (f: PanelFrame) => void): void;   // 收帧；没登记时宿主发来的帧由组件进程关掉句柄并还回去
  onDrop(fn: (seq: number) => void): void;      // 宿主已经放掉这一帧(压着的帧太多)：不能再用，关掉句柄，不用 release
  onSize(fn: (width: number, height: number) => void): void;
  onState(fn: (state: PanelPageState, detail?: string) => void): void;
  release(seq: number): void;                   // 这一帧用完了
  input(e: PanelInput): void;                   // 指点事件
  setPainting(on: boolean): void;               // 停画 / 恢复(恢复时宿主让页面重画一帧)；窗口方式下是隐藏 / 显示窗口
  setFrameRate(fps: number): void;              // 不超过面板清单里的帧率上限
  close(): void;                                // 关掉页面
}

// 面板目录和面板页面(ctx.panels)
export interface PanelsHostService {
  readonly list: readonly PanelInfo[];          // 面板目录：开着的组件声明的面板，按组件顺序
  watch(fn: (list: readonly PanelInfo[]) => void): () => void;   // 目录变了回调(登记时不调)；返回取消函数，组件卸载时自动取消
  // 开一块面板的页面：只有当前生效的显示方(清单 provides 里有 panels、组件顺序最前的开着的那个)能开，别的组件开了页面状态是 failed；
  // 显示方从 ctx.relay.serve('panels', …) 返回的把手上看自己生效没有(active、watch)，等着的时候不开页面。
  // frames = 离屏渲染并交帧，window = 普通窗口；同一块面板全程序只有一页。组件停用时自动放开，页面由宿主留一段时间
  open(id: string, mode?: PanelMode): PanelFeed;
}

export interface MainServices {
  panels: PanelsHostService;
  relay: RelayService;
  app: AppService;
  output: OutputService;
  input: InputService;
  translator: TranslatorService;
  usage: UsageService;                          // 组件提供，见上
  status: StatusService;
  logs: LogsService;
  osc: OscService;                              // 组件提供，要 inject
  storage: StorageService;
  bus: BusService;
  id: string;                                   // 本组件 id
  config: Record<string, unknown>;              // 设置，含解密后的 secret
  dataDir: string;                              // 数据文件夹(绝对路径)
  appDir: string;                               // 程序目录(随程序带的 vendor 等)
  log(text: string, level?: LogLevel): void;    // 写进运行日志；级别默认 info
}

export type MainContext = Context & MainServices;

// ---------- 主窗口页面组件(kind: window) ----------

// 一个主窗口页面：侧栏入口 + 铺满内容区的 Vue 组件
export interface WindowPage {
  id: string;                 // 页面 id，别的页面用它跳转
  title: Text;                // 侧栏上的名字
  icon: unknown;              // @lucide/vue 的图标组件
  component: unknown;         // Vue 组件
  order?: number;             // 侧栏位置，小的在上；相同时按组件顺序
}

// 插槽：往宿主的固定位置放一块 Vue 组件
// component-details：组件详情页里的一节，组件拿到 props { id: 组件 id }；order 小于 0 在设置各节前面，其余在后面，同侧按 order 从小到大
// app：放在整个窗口上的内容(对话框之类)；layout：铺满窗口的外壳(顶栏、侧栏、内容区、状态栏)，有几个时用组件顺序最前的
// dashboard：仪表盘上的一张卡片，area 是放在哪一列(left / right，没写为 left)，同列按 order 从小到大；卡片要撑满剩余高度时自己设 flex: 1
export interface WindowSlot {
  type: 'component-details' | 'app' | 'layout' | 'dashboard';
  component: unknown;         // Vue 组件
  order?: number;
  area?: string;
}

// 设置页的一节：同 id 的合成一节，节里按组件顺序放各组件的自定义内容和配置项
export interface WindowSettings {
  id: string;                 // 节 id
  title: Text;                // 节标题(同 id 取第一个)
  order?: number;             // 节的顺序，小的在上
  keys?: string[];            // 本组件配置里放进这一节的键，不写 = 全部
  component?: unknown;        // 放在配置项前面的 Vue 组件
}

// 登记都返回撤销函数；组件停用时自动全部去掉。在 ctx.inject 回调里登记时用 sub.effect(() => sub.window.xxx(...))，服务没了跟着去掉
export interface WindowService {
  page(page: WindowPage): () => void;   // 注册页面
  slot(slot: WindowSlot): () => void;   // 注册插槽内容
  settings(s: WindowSettings): () => void;   // 登记到设置页
}

// 主窗口文案：加一种语言的一组键；界面用 @konkon-lab/foxpanel-window 的 t 取
export interface WindowI18nService {
  define(locale: Locale, messages: Record<string, string>): void;
}

// 组件管理(预装的 yanuo.window-components 提供，要 inject)：组件树、显示名、安装流程和最近的错误，都是响应式的
export interface ComponentTreeGroup {
  key: string;
  title: string;
  rows: ComponentRow[];
}
export interface PendingInstall {
  manifest: Manifest;
  code: boolean;              // 带代码
  replaces: string | null;    // 要替换的已装版本
}
export interface WindowComponentsService {
  readonly tree: readonly ComponentTreeGroup[];   // 组件页的分组树
  nameOf(row: ComponentRow): string;              // 显示名(重命名过的优先)
  error: string;                                  // 最近一次操作的错误，空 = 没有
  readonly installMenu: readonly { key: string; label: string }[];   // 「安装组件」菜单
  install(key: string): void;                     // 选了菜单里的一项
  readonly pending: PendingInstall | null;        // 等确认的安装
  confirm(ok: boolean): Promise<void>;            // 确认或取消
}

// 设置页(预装的 yanuo.window-settings 提供，要 inject)：节和配置项在不在设置页改
export interface SettingsSection {
  id: string;
  title: Text;
  order: number;
}
export interface WindowSettingsService {
  readonly sections: { readonly general: SettingsSection; readonly look: SettingsSection; readonly about: SettingsSection };
  edits(owner: string, def: SettingDef): boolean;   // 这个配置项登记到了设置页并在那里改
}

// 主窗口里的用量账本(预装的 yanuo.aliyun 提供，要 inject)：响应式
export interface WindowUsageService {
  readonly book: UsageBook;
}

export interface WindowServices {
  id: string;                        // 本组件 id
  window: WindowService;
  i18n: WindowI18nService;
  bus: BusService;
  usage: WindowUsageService;         // 组件提供，要 inject
  components: WindowComponentsService;   // 组件管理提供，要 inject
  settings: WindowSettingsService;   // 设置组件提供，要 inject
  config: Record<string, unknown>;   // 设置(已补默认值，不含 secret)
  log(text: string, level?: LogLevel): void;   // 写进运行日志；级别默认 info
}

export type WindowContext = Context & WindowServices;

declare module 'cordis' {
  interface Events extends KbEvents {}
}

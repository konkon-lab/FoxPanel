// 冒烟检查：用临时数据文件夹启动打包好的程序(FOXPANEL_PANELS=1，开发用的显示方把每块打开的面板开成一个普通窗口)，经 Chrome 调试协议
// 看部署提示的文字跟不跟界面语言，在键盘面板的页面里打字选词、换界面语言(页面的文字和键盘状态跟着换)、按日夜切换、
// 关掉再打开一个语言组件(键盘的语言列表跟着变)、关掉再打开输入法组件(键盘上的部件跟着撤掉和恢复)；
// 数据文件夹里预先放了两个示例组件(时钟面板装在组件目录里、先关着，常用语侧栏页在一个开发文件夹里)：打开时钟面板(它有自己的窗口)，
// 查两块面板和主窗口的 localStorage 互不相通，改设置、保存开发文件夹里的文件时只有用到它的那块面板重载，
// 点时钟面板上的收起按钮它的窗口隐藏，关掉时钟的组件只有它的窗口消失；
// 数据文件夹里还放了三块只给这里检查用的面板(先关着，同时显示的上限设成 4)：打开它们，经远程服务 panels 开关面板、整组收起和恢复、
// 设常显、改宽度、改附着在哪和抬手才显示再重置、单块锁和全局锁、到面前、顶到上限、关着的时钟和键盘(1 号快捷位指向它)按总开关回来，
// 每一步核对 panels 的状态、各窗口在系统里显示没有、页面得到的显示通知；
// 在能滚动的区域按住拖动内容跟着滚、不算点击；面板页面跳不到外站、开不了新窗口；再把主窗口侧栏的每一页点开，
// 查各页面的报错和运行日志；结束时关掉程序、删掉临时文件夹。
// 之后再启动一次，查离屏方式的整条链路：不带 FOXPANEL_PANELS、带 FOXPANEL_VR_SIM(模拟脚本)，SteamVR 组件当显示方，
// 键盘面板、时钟面板和手腕时钟(附着在左手上、抬手才显示；后两块这一次一开始就开着)离屏渲染、每一帧的句柄复制进组件进程、
// 贴进各自的纹理；脚本按总开关键显示面板、分别指着键盘和时钟的正中扣一下扳机、抓住时钟挪到一边、往时钟的页面发一次往下的滚轮，
// 再把左手抬到眼前、右手指着手腕时钟扣一下扳机、放下左手，查各块读回的画面、纹理的大小、指点事件落在哪块上、各页面收到的按下和松开、
// 时钟的位置、时钟页面里的内容往下滚了、手腕时钟的悬浮窗口是相对左手放的、抬手时显示放下后隐藏、左手的射线点不到它、运行日志。
// 调试协议只用 Node 自带的 fetch 和 WebSocket；窗口在系统里显示没有经 koffi 问 user32。按步骤打印通过或失败，有失败时退出码为 1。
// 用法：node scripts/smoke.ts [--boundary]；--boundary 加查页面的权限边界：面板页面和媒体页面的 window.fox 上有哪些接口、
// 开发用的显示方在不在组件列表里、面板页面读写别的组件的数据(键盘面板和时钟面板互相也读写不了)、卸载组件、
// 经远程服务 keyboard 开关输出组件以外的组件、往别的频道发总线消息、登记别的组件的总线频道、
// 用组件没声明的远程服务(时钟面板够不着 keyboard，也调不了 panels)、开麦克风、联网(直接取外面的地址、嵌一个自己组件包里的网页去取)，
// 主窗口用远程服务、跳到外站。
// 程序要已经打包到 dist/(npm run smoke 会带上 npm run build)。
// --exe <可执行文件> 换成启动打包后的程序(例如 release/win-unpacked/FoxPanel.exe)：安装包里没有开发用的显示方，只跑离屏方式那一次。

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import koffi from 'koffi';
import type { PanelsState } from '@konkon-lab/foxpanel-sdk';
import { anchorDefault, axis, facing, invert, mul, position, type Mat34, type Vec3 } from '../components/steamvr/src/geometry.ts';
import type { LogEntry, PageApi } from '../src/shared/types.ts';
import { errorText, isObject } from '../src/shared/util.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const WINDOW_URL = 'fox://host/window/index.html';
const KEYBOARD_PANEL = 'yanuo.shell-classic';    // 键盘面板(面板 id 就是它的根组件的 id)
const KEYBOARD_ORIGIN = `fox://${KEYBOARD_PANEL}.panel`;   // 键盘面板的页面的源：每块面板一个
const KEYBOARD_URL = `${KEYBOARD_ORIGIN}/panel.html`;
const MEDIA_URL = 'fox://host/media.html';
const CLOCK_ID = 'yanuo.panel-clock';            // 时钟示例：一块只有自己的面板，不是预装的
const CLOCK_ORIGIN = `fox://${CLOCK_ID}.panel`;
const CLOCK_URL = `${CLOCK_ORIGIN}/panel.html`;
const WRIST_ID = 'yanuo.panel-wrist';            // 手腕时钟示例：附着在左手上、抬手才显示的小面板，不是预装的
const WRIST_URL = `fox://${WRIST_ID}.panel/panel.html`;
const PROBE_ID = 'smoke.probe';               // 只给这里检查用的面板：清单 requires panels，页面里有一块能滚动的区域和一个按钮
const PHRASES_ID = 'yanuo.side-phrases';         // 常用语示例：键盘面板里的一个侧栏页，带设置
const MANAGER_ID = 'yanuo.window-components';    // 组件页：开发者模式是它的一项设置，它加载时把这一项交给宿主
// 启动后要等到的三个页面
const STARTUP_URLS = [WINDOW_URL, KEYBOARD_URL, MEDIA_URL];
// 各页面打印时用的名字
const PAGE_NAMES: Readonly<Record<string, string>> = {
  [WINDOW_URL]: '主窗口', [KEYBOARD_URL]: '键盘面板', [MEDIA_URL]: '媒体页面', [CLOCK_URL]: '时钟面板', [WRIST_URL]: '手腕时钟面板',
  [`fox://${PROBE_ID}.panel/panel.html`]: '检查用面板',
};
const PANEL_URL = /^fox:\/\/[^/]+\.panel\//;   // 面板页面的地址

const PORT_MS = 30_000;      // 等程序报出调试端口(毫秒)
const PAGES_MS = 60_000;     // 等三个页面出现(毫秒)
const DEPLOY_MS = 120_000;   // 等输入法部署完(毫秒)；全新的数据文件夹里约二十秒
const STEP_MS = 15_000;      // 等页面上一次变化(毫秒)
const CALL_MS = 30_000;      // 一次调试协议调用等答复的时间(毫秒)
const POLL_MS = 100;         // 轮询间隔(毫秒)
const KEY_GAP_MS = 60;       // 两次按键之间的间隔(毫秒)
const SETTLE_MS = 300;       // 主窗口换页之后等异步报错冒出来的时间(毫秒)
const NAV_MS = 1500;         // 改页面地址之后等跳转发生的时间(毫秒)
const EXIT_MS = 10_000;      // 结束程序后等它退出的时间(毫秒)
const TAIL_LINES = 30;       // 程序的输出留最后这么多行，启动失败或中途退出时打印

const TYPED = 'nihao';       // 在键盘面板上按的键
const EXPECTED = '你好';     // 候选栏的第一个、上屏后输入框里的字
const PROBE_KEY = 'smoke-probe';              // 查组件数据边界时读写的键
const OUTSIDE_URL = 'https://smoke.invalid/';   // 查跳转时用的外站地址(.invalid 不会解析)
const PROTECTED_ID = 'yanuo.window-shell';    // 查开关时一定要在对照里的组件：主窗口的外壳，不是输出组件
const MISSING_ID = 'smoke.none';              // 查开关时用的 id：没有装这个组件
const IME_ID = 'yanuo.ime';                   // 输入法组件：提供远程服务 keyboard，键盘上的部件都要它
const NEEDS_IME = ['keyboard', 'keys'];       // 要这些服务的组件，输入法关掉后都不生效(keys 的提供者自己要 keyboard)
const REQUIRED_SLOTS = ['candidates', 'textfield', 'layout'];   // 外壳里没有部件时要显示缺件提示的插槽
const STORE_KEY = 'smoke-origin';             // 查页面的源时往 localStorage 里写的键
const CLOCK_TIME = /\d{1,2}:\d{2}/;           // 时钟面板上的时间(时:分)
const CLOCK_SECONDS = /\d{1,2}:\d{2}:\d{2}/;   // 带秒的时间
const WINDOW_SLACK = 4;                       // 窗口里的页面比清单写的宽高最多大这么多像素(屏幕缩放不是整数倍时窗口的大小取整)
const DEV_DISPLAY = 'yanuo.display-desktop';  // 开发用的显示方：只在这次运行加载，不该出现在组件列表里
const FILL_IDS = ['zsmoke.fill-a', 'zsmoke.fill-b'];   // 凑数的面板：组件顺序排在时钟后面，用来顶到同时显示的上限
const PANELS_LIMIT = 4;                       // 窗口方式这次运行同时显示的上限(块；显示方的设置里能调到的最小值)
const PROBE_BUTTON = 160;                     // 检查用面板里按钮的高(像素)；页面高 240
const DRAG_PX = 60;                           // 查拖动滚动时按住拖多远(像素)
const DRAG_SHORT_PX = 5;                      // 不够算拖动的距离(像素)
const DRAG_STEPS = 6;                         // 拖动分成这么多次移动
const CLOCK_METERS = 0.45;                    // 查改宽度时给时钟面板设的宽度(米)
const TITLE_MAX = 256;                        // 读窗口标题时最多读这么多个字
const UNDECLARED_REMOTE = 'smoke-none';       // 查远程服务时用的名字：没有组件在清单里写它
const LOCALES = ['zh-Hans', 'zh-Hant', 'ja', 'en', 'ko'];   // 界面语言
const THEME_ID = 'yanuo.button-theme';        // 日夜切换按钮
const LANG_ID = 'yanuo.lang-ja';              // 查语言列表时关掉再打开的语言组件
const VEIL_REDEPLOYS = 3;                     // 部署提示没看全时，最多关掉再打开输入法组件这么多次让它重新部署
const FRAME_FILE = 'smoke-frame.html';        // 查联网时放进时钟组件包里的网页：被嵌进面板页面的话它会给父页面发消息、去取外面的地址
const FRAME_MS = 1500;                        // 嵌了网页之后等它跑起来的时间(毫秒)

const SIM_ENV = 'FOXPANEL_VR_SIM';            // 环境变量：SteamVR 组件的模拟脚本
const SIM_SHOW_MS = 3000;                     // 模拟脚本：连上之后多久按总开关键显示面板(毫秒；留给面板目录到齐的时间)
const SIM_AIM_MS = SIM_SHOW_MS + 10_000;      // 模拟脚本：连上之后多久开始指着面板(毫秒；留给页面加载和这里接上页面的时间)
const SIM_WHEEL_MS = SIM_AIM_MS + 8000;       // 模拟脚本：连上之后多久往时钟的页面发滚轮(毫秒)
const SIM_WHEEL = 120;                        // 模拟脚本：滚轮往下滚多少(像素)
const SIM_WRIST_MS = SIM_AIM_MS + 9000;       // 模拟脚本：连上之后多久把左手抬到眼前(毫秒)
const SIM_WRIST_AIM_MS = SIM_WRIST_MS + 1000; // 模拟脚本：连上之后多久右手指上手腕时钟(毫秒)；这之前只有左手的射线打在它上面
const SIM_WRIST_DOWN_MS = SIM_WRIST_MS + 3500;   // 模拟脚本：连上之后多久放下左手(毫秒)
const SIM_END_MS = SIM_WRIST_MS + 5000;       // 模拟脚本：连上之后多久算跑完(毫秒)
const SIM_EYE: Vec3 = [0, 1.6, 0];            // 模拟脚本里眼睛的位置(站立空间，米)；头朝 -Z 看
const SIM_LEFT_DEVICE = 1;                    // 模拟模式里左手手柄的设备序号
const SIM_WRIST_AT: Vec3 = [-0.1, 1.45, -0.35];   // 左手抬到眼前时手腕时钟的位置(站立空间，米)
const SIM_REST_AT: Vec3 = [-0.25, 1, -0.1];   // 左手放下时手腕时钟的位置(站立空间，米)；正面朝下
const SIM_TIP_TILT = 70 * Math.PI / 180;      // 左手指尖的射线和手腕时钟的法线的夹角(弧度)：斜着从正面打在它的正中
const SIM_TIP_REACH = 0.3;                    // 左手的指尖离手腕时钟的正中多远(米)
const SIM_MOVE = 0.3;                         // 模拟脚本：抓住时钟往右挪多少(米)
const SIM_MOVE_SLACK = 0.05;                  // 时钟挪到的位置和该到的最多差这么多(米)
const SIM_WAIT_MS = SIM_END_MS + 60_000;      // 等模拟脚本跑完写出记录(毫秒)
const SIM_HZ = 90;                            // 模拟脚本里头显的刷新率(Hz)
const FRAME_SLACK = 1;                        // 离屏页面的纹理比清单写的每边最多差这么多像素
const AIM_SLACK = 3;                          // 指点事件的落点离面板正中最多差这么多像素
const PNG_HEAD = 8;                           // PNG 文件开头的标记有这么多字节

// 面板页面和媒体页面的 window.fox 上该有的接口(PageApi)，一个不多一个不少
const PAGE_API = ['busListen', 'busSend', 'hide', 'logWrite', 'look', 'onBus', 'onLook', 'onRelay', 'onVisible', 'plan', 'relayCall', 'relayUse', 'setDark', 'storageCall'];
// 只有主窗口有的接口里挑出来点名查的：组件管理、应用设置、更新、目录、市场、窗口控制
const WINDOW_ONLY = [
  'compList', 'compPick', 'compInstall', 'compRemove', 'compRemoveBroken', 'compSet', 'compSecret', 'compSecretReveal', 'compDevAdd', 'compOpenFolder', 'compHostRestart', 'compNpm',
  'init', 'setLanguage', 'setApp', 'updateState', 'updateCheck', 'updateInstall', 'dirList', 'dirMake', 'openDataDir', 'marketSearch', 'marketInfo',
  'openExternal', 'windowPlan', 'logList', 'winMinimize', 'winMaximize', 'winClose', 'closeAnswer',
];

// 面板页面和媒体页面里的 window：fox 是窄 preload 挂上去的 PageApi
type PageWindow = { fox: PageApi };

// 启动程序时带的开关：窗口被别的窗口盖住时页面照常算可见。不带的话面板的窗口被盖住后，调试协议发的鼠标事件要等几秒才到页面
const VISIBLE_SWITCHES = ['--disable-backgrounding-occluded-windows', '--disable-features=CalculateNativeWinOcclusion'];

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// ---- 命令行 ----

export interface Options {
  boundary: boolean;   // 加查权限边界
  exe: string;         // 打包后的程序的可执行文件；空串 = 用仓库里装的 Electron 启动 dist/
}

export const USAGE = '用法：node scripts/smoke.ts [--boundary | --exe <打包后的程序的可执行文件>]';

// 命令行参数；有不认识的参数、--exe 后面没有路径、--exe 和 --boundary 一起给时抛出异常
export function parseArgs(argv: readonly string[]): Options {
  const options: Options = { boundary: false, exe: '' };
  const unknown: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--boundary') {
      options.boundary = true;
    } else if (arg === '--exe') {
      const file = argv[++i];
      if (!file || file.startsWith('--')) throw new Error('--exe 后面要写可执行文件的路径');
      options.exe = path.resolve(file);
    } else if (arg !== undefined) {
      unknown.push(arg);
    }
  }
  if (unknown.length) throw new Error(`不认识的参数 ${unknown.join(' ')}`);
  // 权限边界在窗口方式那一次启动里查，打包后的程序不跑那一次
  if (options.exe && options.boundary) throw new Error('--exe 只跑离屏方式，不能和 --boundary 一起用');
  return options;
}

// ---- 调试协议 ----

interface Pending {
  method: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

// 一条调试协议连接：请求按 id 对上答复，事件按方法名分给监听；post 把一条消息发出去
export class Cdp {
  private readonly post: (text: string) => void;
  private readonly timeoutMs: number;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, ((params: unknown) => void)[]>();
  private lastId = 0;
  private closedWith: string | null = null;   // 连接断开的原因；没断为 null

  constructor(post: (text: string) => void, timeoutMs = CALL_MS) {
    this.post = post;
    this.timeoutMs = timeoutMs;
  }

  // 发一个请求，返回答复里的 result；对方报错、超时、连接断开时失败
  call(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    if (this.closedWith !== null) return Promise.reject(new Error(`${method}：${this.closedWith}`));
    const id = ++this.lastId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method}：${this.timeoutMs / 1000} 秒没有答复`));
      }, this.timeoutMs);
      this.pending.set(id, { method, resolve, reject, timer });
      try {
        this.post(JSON.stringify({ id, method, params }));
      } catch (e) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(new Error(`${method}：${errorText(e)}`));
      }
    });
  }

  on(method: string, fn: (params: unknown) => void): void {
    const list = this.listeners.get(method) ?? [];
    list.push(fn);
    this.listeners.set(method, list);
  }

  // 收到的一条消息：带 id 的是答复，带 method 的是事件；格式不对的丢掉
  receive(text: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }
    if (!isObject(msg)) return;
    const { id, method, error } = msg;
    if (typeof id === 'number') {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      if (isObject(error)) p.reject(new Error(`${p.method}：${typeof error['message'] === 'string' ? error['message'] : JSON.stringify(error)}`));
      else p.resolve(msg['result']);
    } else if (typeof method === 'string') {
      for (const fn of this.listeners.get(method) ?? []) fn(msg['params']);
    }
  }

  // 连接断了：没等到答复的请求都失败，之后的请求直接失败
  closed(reason: string): void {
    if (this.closedWith !== null) return;
    this.closedWith = reason;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(`${p.method}：${reason}`));
    }
    this.pending.clear();
  }
}

// 页面抛出的异常(Runtime.evaluate 答复或 Runtime.exceptionThrown 事件里的 exceptionDetails)转成一行文字
export function exceptionText(details: Record<string, unknown>): string {
  const text = typeof details['text'] === 'string' ? details['text'] : '';
  const ex = details['exception'];
  const what = isObject(ex) ? ex['description'] ?? ex['value'] : undefined;
  const first = typeof what === 'string' ? what.split('\n')[0] ?? '' : what === undefined ? '' : JSON.stringify(what);
  return [text, first].filter(Boolean).join(' ') || '页面抛出了异常';
}

// Runtime.evaluate 的答复里按值传回的结果；页面里抛了异常时抛出
export function evalValue(reply: unknown): unknown {
  if (!isObject(reply)) throw new Error('调试协议的答复格式不对');
  const details = reply['exceptionDetails'];
  if (isObject(details)) throw new Error(exceptionText(details));
  const result = reply['result'];
  return isObject(result) ? result['value'] : undefined;
}

// Runtime.consoleAPICalled 事件：console.error、console.assert 的内容转成一行文字，其他级别返回 null
export function consoleError(params: unknown): string | null {
  if (!isObject(params) || (params['type'] !== 'error' && params['type'] !== 'assert')) return null;
  const args = Array.isArray(params['args']) ? params['args'] as unknown[] : [];
  const parts = args.map(a => {
    if (!isObject(a)) return '';
    const v = a['value'] ?? a['description'];
    return typeof v === 'string' ? v.split('\n')[0] ?? '' : v === undefined ? '' : JSON.stringify(v);
  });
  return parts.filter(Boolean).join(' ') || 'console.error';
}

export interface PageTarget {
  url: string;      // 页面地址
  socket: string;   // 这个页面的调试协议地址(ws://)
}

// 调试端口 /json/list 的内容里 fox:// 的页面
export function pageTargets(list: unknown): PageTarget[] {
  if (!Array.isArray(list)) return [];
  return (list as unknown[]).flatMap(t => {
    if (!isObject(t) || t['type'] !== 'page') return [];
    const { url, webSocketDebuggerUrl: socket } = t;
    return typeof url === 'string' && url.startsWith('fox://') && typeof socket === 'string' ? [{ url, socket }] : [];
  });
}

// 调试端口 /json/list 的内容里页面的个数(不管地址)
export function pageCount(list: unknown): number {
  return Array.isArray(list) ? (list as unknown[]).filter(t => isObject(t) && t['type'] === 'page').length : 0;
}

// 页面列表里面板页面的地址，按字母顺序
export function panelUrls(targets: readonly PageTarget[]): string[] {
  return targets.filter(t => PANEL_URL.test(t.url)).map(t => t.url).sort();
}

// ---- 结果 ----

// 运行日志里 error 级和 warn 级的行(「来源：内容」，宿主自己的行没有来源)
export function logProblems(entries: readonly LogEntry[]): { errors: string[]; warns: string[] } {
  const line = (e: LogEntry): string => (e.source ? `${e.source}：${e.text}` : e.text);
  return {
    errors: entries.filter(e => e.level === 'error').map(line),
    warns: entries.filter(e => e.level === 'warn').map(line),
  };
}

// PNG(8 位 RGBA、每行不滤波，模拟模式存的就是这种)的宽高和不透明度不是 0 的像素数；不是这种 PNG 时抛出异常
export function pngAlpha(png: Buffer): { width: number; height: number; opaque: number } {
  let width = 0;
  let height = 0;
  const data: Buffer[] = [];
  for (let at = PNG_HEAD; at + 8 <= png.length;) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const body = png.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      if (body[8] !== 8 || body[9] !== 6) throw new Error('PNG 不是 8 位 RGBA');
    }
    if (type === 'IDAT') data.push(body);
    at += 12 + length;
  }
  if (!width || !height || !data.length) throw new Error('PNG 里没有画面');
  const raw = zlib.inflateSync(Buffer.concat(data));
  const stride = width * 4 + 1;
  if (raw.length !== stride * height) throw new Error('PNG 的数据长度和宽高对不上');
  let opaque = 0;
  for (let y = 0; y < height; y++) {
    if (raw[y * stride] !== 0) throw new Error('PNG 的行用了滤波');
    for (let x = 0; x < width; x++) if (raw[y * stride + 4 + x * 4]) opaque++;
  }
  return { width, height, opaque };
}

// 模拟脚本里和手腕时钟(附着在左手上，在手柄上的默认位置)有关的三个姿态：
// tip 是左手的指尖相对手柄的变换——指尖在面板正面一侧、离正中 SIM_TIP_REACH，射线斜着(和法线夹角 SIM_TIP_TILT)打在面板的正中，
// 左手的射线一直指着自己手上这块面板；raised 是左手抬到眼前时手柄的姿态(面板在 SIM_WRIST_AT、正面朝向眼睛)；
// lowered 是放下时手柄的姿态(面板在 SIM_REST_AT、正面朝下)
export function wristPoses(): { tip: Mat34; raised: Mat34; lowered: Mat34 } {
  const relative = anchorDefault('left');
  const [normal, side, center] = [axis(relative, 2), axis(relative, 0), position(relative)];
  const along = (from: Vec3, dir: Vec3, k: number): Vec3 => [from[0] + dir[0] * k, from[1] + dir[1] * k, from[2] + dir[2] * k];
  const back = along(along([0, 0, 0], normal, Math.cos(SIM_TIP_TILT)), side, Math.sin(SIM_TIP_TILT));   // 从面板的正中指向指尖的方向
  const from = along(center, back, SIM_TIP_REACH);
  const off = invert(relative);
  return {
    tip: facing(from, along(from, back, 1)),
    raised: mul(facing(SIM_WRIST_AT, SIM_EYE), off),
    lowered: mul(facing(SIM_REST_AT, along(SIM_REST_AT, [0, -1, 0], 1)), off),
  };
}

// 模拟脚本：一开始给头的姿态和左手的指尖；连上之后过 SIM_SHOW_MS 按一下右手的总开关键显示面板；到 SIM_AIM_MS，右手指着键盘面板纹理的正中
// 扣一下扳机，左手指着时钟面板的正中扣一下扳机，再握住握把把时钟往右挪 SIM_MOVE 米后松开；到 SIM_WHEEL_MS 往时钟的页面正中发一次往下的滚轮；
// 到 SIM_WRIST_MS 把左手抬到眼前(手腕时钟显示出来)，左手扣一下扳机(射线打在自己手上的面板上，不该点到)，到 SIM_WRIST_AIM_MS 右手指着
// 手腕时钟的正中扣一下扳机再移开，到 SIM_WRIST_DOWN_MS 放下左手；跑完的记录写进 out 文件夹
export function simScript(out: string): Record<string, unknown> {
  const press = (at: number, hand: string, action: string, down: boolean): Record<string, unknown> => ({ at, hand, press: action, down });
  const wrist = wristPoses();
  return {
    out, hz: SIM_HZ, end: SIM_END_MS,
    steps: [
      { at: 0, head: [1, 0, 0, SIM_EYE[0], 0, 1, 0, SIM_EYE[1], 0, 0, 1, SIM_EYE[2]] },
      { at: 0, hand: 'left', tip: wrist.tip },
      press(SIM_SHOW_MS, 'right', 'toggle', true), press(SIM_SHOW_MS + 100, 'right', 'toggle', false),
      { at: SIM_AIM_MS, hand: 'right', aim: [0.5, 0.5], panel: KEYBOARD_PANEL },
      press(SIM_AIM_MS + 1000, 'right', 'click', true), press(SIM_AIM_MS + 1100, 'right', 'click', false),
      { at: SIM_AIM_MS + 2000, hand: 'left', aim: [0.5, 0.5], panel: CLOCK_ID },
      press(SIM_AIM_MS + 3000, 'left', 'click', true), press(SIM_AIM_MS + 3100, 'left', 'click', false),
      press(SIM_AIM_MS + 4000, 'left', 'grab', true),
      { at: SIM_AIM_MS + 5000, hand: 'left', move: [SIM_MOVE, 0, 0] },
      press(SIM_AIM_MS + 7000, 'left', 'grab', false),
      { at: SIM_WHEEL_MS, panel: CLOCK_ID, wheel: [0, SIM_WHEEL] },
      { at: SIM_WRIST_MS, hand: 'left', pose: wrist.raised },
      press(SIM_WRIST_MS + 500, 'left', 'click', true), press(SIM_WRIST_MS + 600, 'left', 'click', false),
      { at: SIM_WRIST_AIM_MS, hand: 'right', aim: [0.5, 0.5], panel: WRIST_ID },
      press(SIM_WRIST_AIM_MS + 1000, 'right', 'click', true), press(SIM_WRIST_AIM_MS + 1100, 'right', 'click', false),
      { at: SIM_WRIST_AIM_MS + 2000, hand: 'right', pose: null },
      { at: SIM_WRIST_DOWN_MS, hand: 'left', pose: wrist.lowered },
    ],
  };
}

// 一个点离 (width / 2, height / 2) 两个方向都不超过 AIM_SLACK
const nearCenter = (x: unknown, y: unknown, width: number, height: number): boolean => (
  typeof x === 'number' && typeof y === 'number' && Math.abs(x - width / 2) <= AIM_SLACK && Math.abs(y - height / 2) <= AIM_SLACK
);

// 模拟脚本的记录里要查的一块面板：面板 id 和清单写的纹理像素。worn = 附着在手上、抬手才显示的面板：跟着的设备序号，
// 抬手、另一只手指上来、放下手各在连上之后多少毫秒；不写是留在空间里、一直显示到跑完的面板
export interface SimWant {
  id: string;
  width: number;
  height: number;
  worn?: { device: number; raised: number; aimed: number; lowered: number };
}

// 记录里的一块面板
function simPanel(record: unknown, id: string): Record<string, unknown> | undefined {
  const panels = isObject(record) && Array.isArray(record['panels']) ? (record['panels'] as unknown[]).filter(isObject) : [];
  return panels.find(p => p['id'] === id);
}

// 记录里一块面板的悬浮窗口每次显示和隐藏，写成「show 毫秒」「hide 毫秒」
function simShows(panel: Record<string, unknown>): string[] {
  const shows = Array.isArray(panel['shows']) ? (panel['shows'] as unknown[]).filter(isObject) : [];
  return shows.map(e => `${e['on'] === true ? 'show' : 'hide'} ${String(e['at'])}`);
}

// 模拟脚本跑完写的记录(result.json 解出来的值)哪里不对。wants 里的每块面板：有画面；纹理每边和 width×height 差不超过 FRAME_SLACK；
// 发给它的页面的指点事件里只有一次按下，落在纹理正中，之后有一次松开。
// 留在空间里的面板：悬浮窗口显示着，最后一次是用绝对位置放的，只显示过一次、没隐藏过。
// 附着在手上、抬手才显示的面板(worn)：悬浮窗口最后一次是相对那个设备放的；只在抬手之后、另一只手指上来之前显示出来一次，
// 放下手之后隐藏，跑完时隐藏着；另一只手指上来之前没有指点事件(这只手的射线点不到它)。都对时为空
export function simProblems(record: unknown, wants: readonly SimWant[]): string[] {
  if (!isObject(record)) return ['记录不是对象'];
  return wants.flatMap(({ id, width, height, worn }) => {
    const panel = simPanel(record, id);
    if (!panel) return [`${id}：记录里没有这块面板(没开过页面)`];
    const problems: string[] = [];
    const { image, texture, overlay, inputs } = panel;
    if (typeof image !== 'string' || !image) problems.push('没有读回画面');
    const [w, h] = isObject(texture) ? [texture['width'], texture['height']] : [];
    if (typeof w !== 'number' || typeof h !== 'number') problems.push('面板没有纹理(一帧都没贴上)');
    else if (Math.abs(w - width) > FRAME_SLACK || Math.abs(h - height) > FRAME_SLACK) problems.push(`面板的纹理是 ${w}×${h}，清单写的是 ${width}×${height}`);
    const events = Array.isArray(inputs) ? (inputs as unknown[]).filter(isObject) : [];
    const shows = simShows(panel);
    const showAt = (i: number): number => Number(shows[i]?.split(' ')[1]);
    if (!worn) {
      if (!isObject(overlay) || overlay['visible'] !== true) problems.push('悬浮窗口没有显示着');
      else if (overlay['device'] !== null) problems.push(`悬浮窗口最后一次不是用绝对位置放的(相对 ${String(overlay['device'])} 号设备)`);
      if (shows.length !== 1 || !shows[0]?.startsWith('show ')) problems.push(`悬浮窗口该只显示一次、不隐藏：${shows.join('、') || '没显示过'}`);
    } else {
      if (!isObject(overlay)) problems.push('没有悬浮窗口');
      else {
        if (overlay['device'] !== worn.device) problems.push(`悬浮窗口最后一次不是相对 ${worn.device} 号设备放的(${overlay['device'] === null ? '绝对位置' : `${String(overlay['device'])} 号设备`})`);
        if (overlay['visible'] !== false) problems.push('手放下以后悬浮窗口还显示着');
      }
      const raisedOk = shows.length === 2 && shows[0]?.startsWith('show ') === true && shows[1]?.startsWith('hide ') === true
        && showAt(0) >= worn.raised && showAt(0) < worn.aimed && showAt(1) >= worn.lowered;
      if (!raisedOk) problems.push(`悬浮窗口该在抬手(${worn.raised} 毫秒)之后显示、放下(${worn.lowered} 毫秒)之后隐藏，各一次：${shows.join('、') || '没显示过'}`);
      const early = events.filter(e => typeof e['at'] !== 'number' || e['at'] < worn.aimed);
      if (early.length) problems.push(`另一只手指上来(${worn.aimed} 毫秒)之前就有指点事件(附着的那只手的射线点到了它)：${JSON.stringify(early)}`);
    }
    const downs = events.filter(e => e['kind'] === 'down');
    const down = events.findIndex(e => e['kind'] === 'down' && nearCenter(e['x'], e['y'], width, height));
    if (down < 0) problems.push(`指点事件里没有落在面板正中的按下：${JSON.stringify(events.filter(e => e['kind'] !== 'move'))}`);
    else if (!events.slice(down + 1).some(e => e['kind'] === 'up')) problems.push('按下之后没有松开');
    if (downs.length > 1) problems.push(`收到 ${downs.length} 次按下，该只有指着它的那一次`);
    return problems.map(text => `${id}：${text}`);
  });
}

// 记录里发给一块面板的滚轮事件的 dy，按先后
export function simWheels(record: unknown, id: string): number[] {
  const inputs = simPanel(record, id)?.['inputs'];
  const events = Array.isArray(inputs) ? (inputs as unknown[]).filter(isObject) : [];
  return events.flatMap(e => (e['kind'] === 'wheel' && typeof e['dy'] === 'number' ? [e['dy']] : []));
}

// 记录里一块面板的悬浮窗口比另一块偏右多少米(站立空间的 x)；有一块没有悬浮窗口时为 null
export function simOffset(record: unknown, id: string, from: string): number | null {
  const x = (panel: string): number | null => {
    const overlay = simPanel(record, panel)?.['overlay'];
    const pose: unknown = isObject(overlay) ? overlay['pose'] : null;
    const value: unknown = Array.isArray(pose) ? pose[3] : null;
    return typeof value === 'number' ? value : null;
  };
  const [a, b] = [x(id), x(from)];
  return a === null || b === null ? null : a - b;
}

// 页面记下的鼠标事件(「类型 x,y」，页面像素)里有没有落在 (width / 2, height / 2) 附近的一次按下和它之后的一次松开
export function clickedCenter(seen: readonly string[], width: number, height: number): boolean {
  const at = (line: string, type: string): boolean => {
    const m = new RegExp(`^${type} (-?[\\d.]+),(-?[\\d.]+)$`).exec(line);
    return m !== null && nearCenter(Number(m[1]), Number(m[2]), width, height);
  };
  const down = seen.findIndex(line => at(line, 'mousedown'));
  return down >= 0 && seen.slice(down + 1).some(line => at(line, 'mouseup'));
}

export interface Step {
  name: string;
  ok: boolean;
  detail: string;     // 通过时的补充说明，失败时的原因
  notes: string[];    // 打印在这一步下面的行
}

// 一步的结果打印成的几行
export function stepLines(s: Step): string[] {
  const head = `${s.ok ? '通过' : '失败'}  ${s.name}${s.detail ? `：${s.detail}` : ''}`;
  return [head, ...s.notes.map(n => `      ${n}`)];
}

// 全部步骤的汇总行和退出码(有失败或一步都没跑为 1)
export function summary(steps: readonly Step[]): { line: string; code: number } {
  const failed = steps.filter(s => !s.ok).length;
  if (!steps.length) return { line: '没有跑任何步骤', code: 1 };
  return failed ? { line: `${steps.length} 步里 ${failed} 步失败`, code: 1 } : { line: `${steps.length} 步全部通过`, code: 0 };
}

// ---- 程序 ----

interface Running {
  child: ChildProcess;
  dir: string;         // 临时数据文件夹
  devFolder: string;   // 常用语示例所在的开发文件夹(在临时数据文件夹里)
  port: number;        // 调试端口；程序还没报出来时为 0
  tail: string[];      // 程序输出的最后几行
  gone: string | null; // 程序退出或没启动起来的说明；还在跑为 null
}

// 仓库里装的 Electron 的可执行文件
function electronPath(): string {
  const file: unknown = createRequire(import.meta.url)('electron');
  if (typeof file !== 'string' || !fs.existsSync(file)) throw new Error('node_modules 里没有 Electron 的可执行文件');
  return file;
}

// 检查用面板的页面：一块铺满整页、能竖着滚的区域，里面最上面一个按钮(每次 click 把次数记在 data-clicks 上)，下面是很高的一段空白
const PROBE_PAGE = `export default {
  name: '${PROBE_ID}',
  apply(ctx) {
    ctx.effect(() => ctx.slot.mount(el => {
      const box = document.createElement('div');
      box.id = 'smoke-scroll';
      box.style.cssText = 'position:absolute;inset:0;overflow-y:auto;background:var(--panel)';
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'smoke-button';
      button.textContent = 'tap';
      button.style.cssText = 'display:block;width:100%;height:${PROBE_BUTTON}px';
      button.addEventListener('click', () => { button.dataset.clicks = String(Number(button.dataset.clicks ?? 0) + 1); });
      const rest = document.createElement('div');
      rest.style.height = '2000px';
      box.append(button, rest);
      el.append(box);
    }));
  },
};
`;

// 凑数的面板的页面：一张卡片
const FILL_PAGE = (id: string): string => `export default {
  name: '${id}',
  apply(ctx) {
    ctx.effect(() => ctx.slot.mount(el => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'position:absolute;inset:0';
      el.append(card);
    }));
  },
};
`;

export interface SeedPanel {
  id: string;
  manifest: Record<string, unknown>;   // component.json 的内容
  page: string;                        // panel.js 的内容
}

// 窗口方式里开发用的显示方的设置：同时显示的上限是 PANELS_LIMIT；快捷位不写，用默认值(1 号指向键盘面板，2 号空着)
export const displayConfig = (): Record<string, unknown> => ({ limit: PANELS_LIMIT });

// 只给这里检查用的三块面板：一块在清单里写了 requires panels(它的页面够得着远程服务 panels)，两块凑数的什么服务都不要
export function seedPanels(): SeedPanel[] {
  const manifest = (id: string, name: string, requires: string[]): Record<string, unknown> => ({
    id, kind: 'panel', name, version: '1.0.0', author: 'smoke', license: 'MIT',
    ...(requires.length ? { requires } : {}),
    panel: { page: 'panel.js', width: 320, height: 240 },
  });
  return [
    { id: PROBE_ID, manifest: manifest(PROBE_ID, 'Smoke probe', ['panels']), page: PROBE_PAGE },
    ...FILL_IDS.map((id, i) => ({ id, manifest: manifest(id, `Smoke fill ${i + 1}`, []), page: FILL_PAGE(id) })),
  ];
}

// 往数据文件夹里放两个示例组件和三块检查用的面板，返回常用语所在的开发文件夹：时钟面板和检查用的面板放进组件目录(和装上的组件一样)，
// 设置里都先关着；常用语侧栏页复制到一个开发文件夹，设置里开着开发者模式(宿主的和组件页的那一项)并登记这个文件夹；
// 开发用的显示方的设置是 displayConfig()。时钟的组件包里另放一个网页(查联网时试着把它嵌进面板页面)
function seedExamples(dir: string): string {
  fs.cpSync(path.join(ROOT, 'examples', 'panel-clock'), path.join(dir, 'components', CLOCK_ID), { recursive: true });
  for (const { id, manifest, page } of seedPanels()) {
    const folder = path.join(dir, 'components', id);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'component.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(folder, 'panel.js'), page);
  }
  fs.writeFileSync(path.join(dir, 'components', CLOCK_ID, FRAME_FILE), `<!doctype html><meta charset="utf-8"><script>
parent.postMessage('frame ran', '*');
const port = new URLSearchParams(location.search).get('port');
fetch('http://127.0.0.1:' + port + '/frame-fetch', { mode: 'no-cors' }).then(() => parent.postMessage('frame fetched', '*'), () => parent.postMessage('frame fetch refused', '*'));
try { new WebSocket('ws://127.0.0.1:' + port + '/frame-socket'); } catch { parent.postMessage('frame socket refused', '*'); }
</script>`);
  const devFolder = path.join(dir, 'dev', 'side-phrases');
  fs.cpSync(path.join(ROOT, 'examples', 'side-phrases'), devFolder, { recursive: true });
  const components = {
    devMode: true, dev: [devFolder], off: [CLOCK_ID, PROBE_ID, ...FILL_IDS],
    config: { [MANAGER_ID]: { devMode: true }, [DEV_DISPLAY]: displayConfig() },
  };
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ settings: { components } }));
  return devFolder;
}

// 启动之前往数据文件夹里放东西，给出这次启动带的环境变量和常用语所在的开发文件夹(没放时为空串)
type Prepare = (dir: string) => { env: Record<string, string>; devFolder: string };

// 窗口方式：开发用的显示方把面板开成普通窗口；数据文件夹里预先放示例组件
const windowMode: Prepare = dir => ({ env: { FOXPANEL_PANELS: '1' }, devFolder: seedExamples(dir) });

// 离屏方式：SteamVR 组件跑模拟脚本，脚本和它的结果都放在数据文件夹的 sim 文件夹里；时钟和手腕时钟两个示例装在组件目录里、开着
const simDir = (dir: string): string => path.join(dir, 'sim');
const simResult = (dir: string): string => path.join(simDir(dir), 'result.json');
const framesMode: Prepare = dir => {
  fs.cpSync(path.join(ROOT, 'examples', 'panel-clock'), path.join(dir, 'components', CLOCK_ID), { recursive: true });
  fs.cpSync(path.join(ROOT, 'examples', 'panel-wrist'), path.join(dir, 'components', WRIST_ID), { recursive: true });
  const script = path.join(simDir(dir), 'script.json');
  fs.mkdirSync(simDir(dir), { recursive: true });
  fs.writeFileSync(script, JSON.stringify(simScript(simDir(dir))));
  return { env: { [SIM_ENV]: script }, devFolder: '' };
};

// 启动程序的命令行参数：仓库里的 Electron 要带上程序所在的文件夹(仓库根)，打包后的程序不带
export function launchArgs(packed: boolean, dir: string): string[] {
  return [...(packed ? [] : [ROOT]), `--user-data-dir=${dir}`, '--remote-debugging-port=0', ...VISIBLE_SWITCHES];
}

// 启动程序：数据文件夹是系统临时目录下新建的文件夹(prepare 往里面放东西)，调试端口由系统分配(程序在 stderr 里报出端口号)；
// packed 是打包后的程序的可执行文件，空串时用仓库里装的 Electron 启动 dist/
function start(prepare: Prepare, packed = ''): Running {
  if (packed && !fs.existsSync(packed)) throw new Error(`没有 ${packed}，要 npm run pack`);
  if (!packed && !fs.existsSync(path.join(ROOT, 'dist', 'main.js'))) throw new Error('没有 dist/main.js，要 npm run build');
  const exe = packed || electronPath();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-smoke-'));
  const env: NodeJS.ProcessEnv = { ...process.env };
  // 带着 ELECTRON_RUN_AS_NODE 时 Electron 只当 Node 用，不启动程序；显示方式只由这次启动给的变量定
  for (const name of ['ELECTRON_RUN_AS_NODE', 'FOXPANEL_PANELS', SIM_ENV]) delete env[name];
  let child: ChildProcess;
  let devFolder: string;
  try {
    const prepared = prepare(dir);
    devFolder = prepared.devFolder;
    Object.assign(env, prepared.env);
    child = spawn(exe, launchArgs(packed !== '', dir), {
      env, stdio: ['ignore', 'pipe', 'pipe'],
      // Windows 以外放进自己的进程组，结束时整组结束
      detached: process.platform !== 'win32',
    });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const app: Running = { child, dir, devFolder, port: 0, tail: [], gone: null };
  let stderr = '';
  const keep = (chunk: unknown): void => {
    for (const line of String(chunk).split(/\r?\n/)) if (line.trim()) app.tail.push(line);
    app.tail.splice(0, Math.max(0, app.tail.length - TAIL_LINES));
  };
  child.stdout?.setEncoding('utf8').on('data', keep);
  child.stderr?.setEncoding('utf8').on('data', (chunk: unknown) => {
    keep(chunk);
    if (app.port) return;
    stderr += String(chunk);
    app.port = Number(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(stderr)?.[1] ?? 0);
  });
  child.on('error', e => { app.gone ??= `程序启动不了：${e.message}`; });
  child.on('exit', (code, signal) => { app.gone ??= `程序已退出(${signal ?? `退出码 ${code ?? '?'}`})`; });
  return app;
}

// 结束启动的那个进程和它的子进程(按进程号，不按名字)，等它退出，最多等 EXIT_MS
async function stop(app: Running): Promise<void> {
  const { child } = app;
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  await new Promise<void>(resolve => {
    const timer = setTimeout(resolve, EXIT_MS);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch { /* 进程组已经没了 */ }
    }
  });
}

// ---- 系统里的窗口 ----

interface User32 {
  next(parent: null, after: unknown, cls: null, title: null): unknown;   // 下一个顶层窗口；没有了为 null
  owner(hwnd: unknown, pid: [number]): number;
  visible(hwnd: unknown): boolean;
  title(hwnd: unknown, text: Buffer, max: number): number;
}

let user32: User32 | null = null;
function windowsApi(): User32 {
  if (user32) return user32;
  const lib = koffi.load('user32.dll');
  user32 = {
    next: lib.func('void* __stdcall FindWindowExW(void* parent, void* after, const char16_t* cls, const char16_t* title)') as User32['next'],
    owner: lib.func('uint32 __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32* pid)') as User32['owner'],
    visible: lib.func('bool __stdcall IsWindowVisible(void* hwnd)') as User32['visible'],
    title: lib.func('int __stdcall GetWindowTextW(void* hwnd, void* text, int max)') as User32['title'],
  };
  return user32;
}

// 一个进程的顶层窗口里，系统说正显示着的那些的标题(问 user32，不经程序自己)。只在 Windows 上能用
function shownTitles(pid: number): string[] {
  const api = windowsApi();
  const titles: string[] = [];
  const text = Buffer.alloc(TITLE_MAX * 2);
  // 顶层窗口最多数这么多个，免得窗口表在变时转不出来
  for (let hwnd = api.next(null, null, null, null), n = 0; hwnd !== null && n < 100_000; hwnd = api.next(null, hwnd, null, null), n++) {
    const owner: [number] = [0];
    api.owner(hwnd, owner);
    if (owner[0] !== pid || !api.visible(hwnd)) continue;
    titles.push(text.toString('utf16le', 0, api.title(hwnd, text, TITLE_MAX) * 2));
  }
  return titles;
}

// 每隔 POLL_MS 读一次 read()，ok(值) 为真时返回这个值；读的时候出错算没等到。
// 超过 ms 毫秒或程序退出了就抛出异常，带上最后读到的值或错误
async function until<T>(app: Running, what: string, ms: number, read: () => T | Promise<T>, ok: (value: T) => boolean = Boolean): Promise<T> {
  const end = performance.now() + ms;
  let last = '';
  for (;;) {
    if (app.gone !== null) throw new Error(`等${what}时${app.gone}`);
    try {
      const value = await read();
      if (ok(value)) return value;
      last = `最后读到 ${JSON.stringify(value)}`;
    } catch (e) {
      last = `最后的错误：${errorText(e)}`;
    }
    if (performance.now() >= end) throw new Error(`${ms / 1000} 秒内没等到${what}，${last}`);
    await sleep(POLL_MS);
  }
}

// ---- 页面 ----

interface Point { x: number; y: number }

// 接上一个页面的调试协议：在页面里执行函数、发鼠标事件，收集页面的报错
class Page {
  readonly name: string;
  readonly errors: string[] = [];   // 未捕获的异常、没人接的 promise 拒绝、console.error(接上之前发生的也在内)
  private readonly cdp: Cdp;
  private readonly socket: WebSocket;

  private constructor(name: string, cdp: Cdp, socket: WebSocket) {
    this.name = name;
    this.cdp = cdp;
    this.socket = socket;
  }

  static async attach(target: PageTarget): Promise<Page> {
    const socket = new WebSocket(target.socket);
    const cdp = new Cdp(text => socket.send(text));
    socket.addEventListener('message', e => {
      const data: unknown = e.data;
      if (typeof data === 'string') cdp.receive(data);
    });
    socket.addEventListener('close', () => cdp.closed('连接已断开'));
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve());
      socket.addEventListener('error', () => reject(new Error(`连不上 ${target.url} 的调试协议`)));
    });
    const page = new Page(PAGE_NAMES[target.url] ?? target.url, cdp, socket);
    cdp.on('Runtime.exceptionThrown', params => {
      const details = isObject(params) ? params['exceptionDetails'] : null;
      page.errors.push(isObject(details) ? exceptionText(details) : '页面抛出了异常');
    });
    cdp.on('Runtime.consoleAPICalled', params => {
      const text = consoleError(params);
      if (text !== null) page.errors.push(text);
    });
    // 打开之后，页面里已经有的控制台消息和异常也会各补发一次事件
    await cdp.call('Runtime.enable');
    return page;
  }

  // 在页面里执行 fn(整个函数的源码发过去，参数和返回值按 JSON 传)；fn 返回 promise 时等它
  async run<A extends unknown[], R>(fn: (...args: A) => R, ...args: A): Promise<Awaited<R>> {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const reply = await this.cdp.call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return evalValue(reply) as Awaited<R>;
  }

  // 鼠标左键在页面坐标 p 点一下(按下、松开)
  async click(p: Point): Promise<void> {
    const at = { x: p.x, y: p.y, button: 'left', clickCount: 1 };
    await this.cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y });
    await this.cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
    await this.cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
  }

  // 鼠标左键在 from 按下，按住分 DRAG_STEPS 次移到 to，再松开
  async drag(from: Point, to: Point): Promise<void> {
    const held = { button: 'left', buttons: 1 };
    await this.cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y });
    await this.cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, clickCount: 1, ...held });
    for (let i = 1; i <= DRAG_STEPS; i++) {
      const x = from.x + (to.x - from.x) * i / DRAG_STEPS;
      const y = from.y + (to.y - from.y) * i / DRAG_STEPS;
      await this.cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, ...held });
    }
    await this.cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', clickCount: 1 });
  }

  close(): void {
    this.socket.close();
  }
}

// 调试端口 /json/list 的内容
async function listAll(port: number): Promise<unknown> {
  return (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
}

// 调试端口上现有的 fox:// 页面
async function listTargets(port: number): Promise<PageTarget[]> {
  return pageTargets(await listAll(port));
}

// ---- 在页面里执行的函数：只用参数和页面里的全局对象，不引用这个文件里别的东西 ----

// 键盘面板：部署提示盖着没有、键区有几个键、外壳的插槽里挂着哪些部件(组件 id)、页面上的提示(缺组件、组件加载失败、布局不合格)、
// slots 里哪些插槽直接放着提示、文档的 lang
function keyboardView(slots: string[]): { deployed: boolean; keys: number; parts: string[]; notices: string[]; noticed: string[]; lang: string } {
  return {
    lang: document.documentElement.lang,
    deployed: document.querySelector('.ime-deploying') === null,
    keys: document.querySelectorAll('.keys .key').length,
    parts: Array.from(document.querySelectorAll<HTMLElement>('[data-slot] > .fox-part'), el => el.dataset['component'] ?? ''),
    notices: Array.from(document.querySelectorAll('.fox-notice'), n => n.textContent.trim()),
    noticed: slots.filter(name => document.querySelector(`[data-slot="${name}"] > .fox-notice`) !== null),
  };
}

// 键盘面板的样子：文档和根元素的 lang、部署提示上的字(没盖着时为空串)、组件 id 的部件里第一个按钮的说明文字、
// 根元素是不是深色、markPage 之后页面重载过没有
function pageLook(labelled: string): { lang: string; rootLang: string; veil: string; label: string; dark: boolean; marked: boolean } {
  const root = document.getElementById('root');
  return {
    lang: document.documentElement.lang,
    rootLang: root?.lang ?? '',
    veil: document.querySelector('#overlay .ime-deploying')?.textContent ?? '',
    label: document.querySelector(`[data-component="${labelled}"] button`)?.getAttribute('aria-label') ?? '',
    dark: root?.classList.contains('dark') === true && document.getElementById('overlay')?.classList.contains('dark') === true,
    marked: (window as unknown as { smokeMark?: boolean }).smokeMark === true,
  };
}

// 在页面上留一个记号：页面重载后就没了
function markPage(): void {
  (window as unknown as { smokeMark?: boolean }).smokeMark = true;
}

// markPage 留的记号还在不在
function isMarked(): boolean {
  return (window as unknown as { smokeMark?: boolean }).smokeMark === true;
}

// 时钟面板：页面的源和标题、文档的 lang、卡片上的时间和日期、窗口里页面的宽高、这一页的计划里的页面宽高
async function clockView(): Promise<{ origin: string; title: string; lang: string; time: string; date: string; inner: number[]; planned: number[] }> {
  const card = document.querySelector('#root > .card');
  const plan = await (window as unknown as PageWindow).fox.plan();
  return {
    origin: location.origin, title: document.title, lang: document.documentElement.lang,
    time: card?.children[0]?.textContent ?? '', date: card?.children[1]?.textContent ?? '',
    inner: [window.innerWidth, window.innerHeight],
    planned: plan.kind === 'panel' ? [plan.size.width, plan.size.height] : [],
  };
}

// 窗口里页面的宽高
function innerSize(): number[] {
  return [window.innerWidth, window.innerHeight];
}

// 这一页的计划里组件 id 的设置和入口地址(只有布局 JSON 的布局组件没有入口，地址为空串)；计划里没有这个组件时为 null
async function plannedEntry(id: string): Promise<{ config: Record<string, unknown>; url: string } | null> {
  const plan = await (window as unknown as PageWindow).fox.plan();
  const all = plan.kind === 'panel' ? [plan.root, ...Object.values(plan.parts).flat(), ...plan.services] : [...plan.components, ...plan.services];
  const c = all.find(x => x.id === id);
  return c ? { config: c.config, url: 'url' in c ? c.url : '' } : null;
}

// 改一个组件的设置(主窗口里调，和组件页里改是同一个改动)；没改成时返回原因
async function setConfig(id: string, values: Record<string, unknown>): Promise<string | null> {
  const r = await window.fox.compSet({ kind: 'configs', id, values });
  return r.ok ? null : r.error;
}

// 开一个新窗口：开成了返回 true
function tryOpen(url: string): boolean {
  return window.open(url) !== null;
}

// 键盘面板里组件 id 的部件里第一个按钮的中心；找不到或它在窗口外面返回 null
function partButtonCenter(id: string): { x: number; y: number } | null {
  const r = document.querySelector(`[data-component="${id}"] button`)?.getBoundingClientRect();
  if (!r?.width) return null;
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  return x < window.innerWidth && y < window.innerHeight ? { x, y } : null;
}

// 远程服务 keyboard 的状态里的语言包 id 和界面语言；没有状态时为 null。
// 第一次调时装上监听并订阅(宿主随即补发当前的状态)，之后读监听记下的最新一份
async function keyboardLangs(): Promise<{ packs: string[]; uiLang: string } | null> {
  const w = window as unknown as { smokeKeyboard?: { state: unknown } };
  if (!w.smokeKeyboard) {
    const box: { state: unknown } = { state: null };
    w.smokeKeyboard = box;
    const fox = (window as unknown as PageWindow).fox;
    fox.onRelay((name, state) => { if (name === 'keyboard') box.state = state; });
    await fox.relayUse('keyboard', true);
  }
  const s = w.smokeKeyboard.state as { packs?: { id: string }[]; uiLang?: string } | null;
  return s ? { packs: (s.packs ?? []).map(pack => pack.id), uiLang: s.uiLang ?? '' } : null;
}

// 设置里的界面语言(主窗口里调)
async function languageSetting(): Promise<string> {
  return (await window.fox.init()).settings.language;
}

// 设置里面板的深色(主窗口里调)
async function panelsDark(): Promise<boolean> {
  return (await window.fox.init()).settings.panels.dark;
}

// 改界面语言(主窗口里调，和设置页的选择是同一个改动)
async function setLanguage(lang: string): Promise<void> {
  await window.fox.setLanguage(lang as Parameters<typeof window.fox.setLanguage>[0]);
}

// 键区里一个键的中心(页面坐标)：letter 是键帽上的字母，空串 = 最宽的那个键(空格)；找不到或键在窗口外面返回 null
function keyCenter(letter: string): { x: number; y: number } | null {
  let best: DOMRect | null = null;
  for (const key of document.querySelectorAll('.keys .key')) {
    const r = key.getBoundingClientRect();
    if (letter) {
      if (key.querySelector('.letter, .latin')?.textContent.trim().toLowerCase() === letter) best = r;
    } else if (!best || r.width > best.width) {
      best = r;
    }
  }
  if (!best || !best.width) return null;
  const x = best.left + best.width / 2;
  const y = best.top + best.height / 2;
  return x < window.innerWidth && y < window.innerHeight ? { x, y } : null;
}

// 输入框里清空按钮的中心
function clearCenter(): { x: number; y: number } | null {
  const r = document.querySelector('.field .icon-btn')?.getBoundingClientRect();
  return r?.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

// 候选栏和输入框的内容：候选数和前五个候选、已上屏的字、输入串
function inputView(): { count: number; cands: string[]; text: string; composition: string } {
  const texts = (selector: string): string[] => Array.from(document.querySelectorAll(selector), e => e.textContent);
  const cands = texts('.cand').map(t => t.trim());
  return { count: cands.length, cands: cands.slice(0, 5), text: texts('.field .text .ch').join(''), composition: texts('.field .text .comp').join('') };
}

// 主窗口侧栏各项的页面名
function navTitles(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.side .item'), b => b.title);
}

// 点侧栏里页面名是 title 的那一项；找不到返回 false
function openNav(title: string): boolean {
  const item = Array.from(document.querySelectorAll<HTMLElement>('.side .item')).find(b => b.title === title);
  item?.click();
  return item !== undefined;
}

// 侧栏选中的是 title 这一项、内容区画出了 h1 时返回 h1 的文字，否则返回空串
function shownHeading(title: string): string {
  if (document.querySelector<HTMLElement>('.side .item.active')?.title !== title) return '';
  const h1 = document.querySelector('.content .scroll h1');
  return h1 && h1.getClientRects().length ? h1.textContent.trim() : '';
}

// 调 window.fox 上卸载组件的接口；被拒绝时返回原因，卸载成了返回 null
async function tryRemove(id: string): Promise<string | null> {
  if (typeof window.fox.compRemove !== 'function') return '页面上没有这个接口';
  try {
    const r = await window.fox.compRemove(id);
    return r?.ok ? null : `返回 ${JSON.stringify(r)}`;
  } catch (e) {
    return String(e);
  }
}

// 装着的全部组件 id(主窗口里调)
async function installedIds(): Promise<string[]> {
  return (await window.fox.compList()).rows.map(r => r.id);
}

// 这一页的计划：面板页面的根组件、各插槽的部件、服务的组件 id；媒体页面的是它的页面代码和服务
async function planIds(): Promise<{ root: string; parts: string[]; services: string[] }> {
  const plan = await (window as unknown as PageWindow).fox.plan();
  if (plan.kind === 'media') return { root: '', parts: plan.components.map(c => c.id), services: plan.services.map(c => c.id) };
  return { root: plan.root.id, parts: Object.values(plan.parts).flat().map(c => c.id), services: plan.services.map(c => c.id) };
}

// window.fox 上的接口名
function foxKeys(): string[] {
  return Object.keys(window.fox).sort();
}

// 页面的源；把它的 localStorage 里 key 这一项写成 value，before 是写之前这一项的值(没有为 null)
function originStore(key: string, value: string): { origin: string; before: string | null } {
  const before = localStorage.getItem(key);
  localStorage.setItem(key, value);
  return { origin: location.origin, before };
}

// 往组件 id 的数据里写一项；调用出错时返回原因，没出错返回 null
async function writeData(id: string, key: string, value: string): Promise<string | null> {
  if (typeof window.fox.storageCall !== 'function') return '页面上没有这个接口';
  try {
    await window.fox.storageCall(id, { op: 'set', key, value });
    return null;
  } catch (e) {
    return String(e);
  }
}

// 读组件 id 的数据里的一项；调用出错或没有这个接口时返回 null
async function readData(id: string, key: string): Promise<unknown> {
  if (typeof window.fox.storageCall !== 'function') return null;
  try {
    return await window.fox.storageCall(id, { op: 'get', key }) ?? null;
  } catch {
    return null;
  }
}

// 装着的组件里开着的 id(主窗口里调)
async function enabledIds(): Promise<string[]> {
  return (await window.fox.compList()).rows.filter(r => r.on).map(r => r.id);
}

// 装着的第一个输出组件和它开没开(主窗口里调)；没有输出组件时为 null
async function firstOutput(): Promise<{ id: string; on: boolean } | null> {
  const row = (await window.fox.compList()).rows.find(r => r.kind === 'output');
  return row ? { id: row.id, on: row.on } : null;
}

// 经远程服务 keyboard 依次发开关输出组件的键盘操作(键盘上「发送到」的开关走的就是它)；list 的每一项是 [组件 id, 开还是关]
async function toggleOutputs(list: [string, boolean][]): Promise<void> {
  for (const [id, on] of list) await (window as unknown as PageWindow).fox.relayCall('keyboard', 'act', [{ kind: 'output', id, on }], false);
}

// 装着的组件里不是输出组件的 id(主窗口里调)
async function otherKindIds(): Promise<string[]> {
  return (await window.fox.compList()).rows.filter(r => r.kind !== 'output').map(r => r.id);
}

// 开关一个组件(主窗口里调，和组件页的开关是同一个改动)；没改成时返回原因
async function switchComponent(id: string, on: boolean): Promise<string | null> {
  const r = await window.fox.compSet({ kind: 'on', id, on });
  return r.ok ? null : r.error;
}

// 装着的组件里开着、清单 requires 里有 names 之一的 id(主窗口里调)
async function requiring(names: string[]): Promise<string[]> {
  return (await window.fox.compList()).rows.filter(r => r.on && (r.requires ?? []).some(x => names.includes(x.name))).map(r => r.id);
}

// 装着的组件里正在用的 id(主窗口里调)
async function activeIds(): Promise<string[]> {
  return (await window.fox.compList()).rows.filter(r => r.active).map(r => r.id);
}

// 装着的组件里，id 在 ids 里的那些在清单 requires 里写的服务名(主窗口里调)
async function requiredBy(ids: string[]): Promise<string[]> {
  const rows = (await window.fox.compList()).rows.filter(r => ids.includes(r.id));
  return [...new Set(rows.flatMap(r => (r.requires ?? []).map(x => x.name)))];
}

// 订阅一个远程服务，再往它发一个不等结果的调用；两样各自被拒绝时的原因(页面上没有这个接口也算)，没被拒绝为 null
async function tryRelay(name: string): Promise<{ use: string | null; call: string | null }> {
  const fox = (window as unknown as { fox: Partial<PageApi> }).fox;
  const { relayUse, relayCall } = fox;
  if (typeof relayUse !== 'function' || typeof relayCall !== 'function') return { use: '页面上没有这个接口', call: '页面上没有这个接口' };
  const refusal = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e: unknown) => String(e));
  return { use: await refusal(relayUse(name, true)), call: await refusal(relayCall(name, 'smoke', [], false)) };
}

// 记下这个页面之后收到的总线消息(「频道 数据的 JSON」)；只装一次
function watchBus(): void {
  const w = window as unknown as { smokeBus?: string[] };
  if (w.smokeBus) return;
  const seen: string[] = [];
  w.smokeBus = seen;
  window.fox.onBus((channel, data) => { seen.push(`${channel} ${JSON.stringify(data)}`); });
}

// watchBus 之后收到的总线消息
function busSeen(): string[] {
  return (window as unknown as { smokeBus?: string[] }).smokeBus ?? [];
}

// 往总线发一条消息
function busSend(channel: string, data: string): void {
  window.fox.busSend(channel, data);
}

// 登记 / 取消登记一个总线频道(面板页面里调)
function busListen(channel: string, on: boolean): void {
  (window as unknown as PageWindow).fox.busListen(channel, on);
}

// 查麦克风权限的状态，再申请打开麦克风：state 是查到的状态，error 是打不开时错误的名字(打开了为 null，随即关掉)
async function tryMicrophone(): Promise<{ state: string; error: string | null }> {
  const state = (await navigator.permissions.query({ name: 'microphone' })).state;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return { state, error: null };
  } catch (e) {
    return { state, error: e instanceof Error ? e.name : String(e) };
  }
}

// 这块面板是不是正被显示：新登记的回调马上得到最近一次的值
function visibleNow(): Promise<boolean> {
  return new Promise(resolve => (window as unknown as PageWindow).fox.onVisible(on => { resolve(on); }));
}

// 时钟面板上收起按钮的中心；找不到返回 null
function hideCenter(): { x: number; y: number } | null {
  const r = document.querySelector('#root > .card > button')?.getBoundingClientRect();
  return r?.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
}

// 运行日志里 warn 和 error 级的行(主窗口里调)
async function troubleLines(): Promise<string[]> {
  return (await window.fox.logList()).filter(l => l.level !== 'info').map(l => `${l.source} ${l.text}`);
}

// 直接取一个地址：取到了返回 null，取不了返回原因
async function tryFetch(url: string): Promise<string | null> {
  try {
    await fetch(url, { mode: 'no-cors' });
    return null;
  } catch (e) {
    return String(e);
  }
}

// 在页面里嵌一个框架加载 url，等 ms 毫秒后拿掉；返回这期间框架发给页面的消息(框架里的脚本没跑起来时是空的)
async function embedFrame(url: string, ms: number): Promise<string[]> {
  const got: string[] = [];
  const listen = (e: MessageEvent): void => { got.push(String(e.data)); };
  window.addEventListener('message', listen);
  const frame = document.createElement('iframe');
  frame.src = url;
  document.body.append(frame);
  await new Promise(resolve => setTimeout(resolve, ms));
  window.removeEventListener('message', listen);
  frame.remove();
  return got;
}

// 记下这个页面之后收到的鼠标按下和松开(「类型 x,y」，页面像素)；只装一次
function watchMouse(): void {
  const w = window as unknown as { smokeMouse?: string[] };
  if (w.smokeMouse) return;
  const seen: string[] = [];
  w.smokeMouse = seen;
  for (const type of ['mousedown', 'mouseup'] as const) {
    document.addEventListener(type, e => { seen.push(`${type} ${e.clientX},${e.clientY}`); }, true);
  }
}

// watchMouse 之后收到的鼠标事件
function mouseSeen(): string[] {
  return (window as unknown as { smokeMouse?: string[] }).smokeMouse ?? [];
}

// 面板页面是不是显示在普通窗口里(计划里的 preview 和页面上的记号)
async function previewed(): Promise<{ plan: boolean; marked: boolean }> {
  const plan = await (window as unknown as PageWindow).fox.plan();
  return { plan: plan.kind === 'panel' && plan.preview, marked: document.documentElement.classList.contains('fox-preview') };
}

// 远程服务 panels 的状态；还没有时为 null。第一次调时装上监听并订阅(宿主随即补发当前的状态)，之后读监听记下的最新一份
async function panelsState(): Promise<PanelsState | null> {
  const w = window as unknown as { smokePanels?: { state: PanelsState | null } };
  if (!w.smokePanels) {
    const box: { state: PanelsState | null } = { state: null };
    w.smokePanels = box;
    const fox = (window as unknown as PageWindow).fox;
    fox.onRelay((name, state) => { if (name === 'panels') box.state = state as PanelsState | null; });
    await fox.relayUse('panels', true);
  }
  return w.smokePanels.state;
}

// 调远程服务 panels 的一个方法(不等结果)；被拒绝时返回原因，交出去了返回 null
async function panelsCall(method: string, args: unknown[]): Promise<string | null> {
  try {
    await (window as unknown as PageWindow).fox.relayCall('panels', method, args, false);
    return null;
  } catch (e) {
    return String(e);
  }
}

// 页面的标题(窗口方式下也是窗口的标题)
function pageTitle(): string {
  return document.title;
}

// 检查用面板：能滚动的区域滚到哪、按钮被 click 了几次、按钮中心在页面上的位置(找不到时为 null)
function probeView(): { top: number; clicks: number; button: { x: number; y: number } | null } {
  const box = document.getElementById('smoke-scroll');
  const button = document.getElementById('smoke-button');
  const r = button?.getBoundingClientRect();
  return {
    top: box?.scrollTop ?? -1,
    clicks: Number(button?.dataset['clicks'] ?? 0),
    button: r?.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
  };
}

// 在页面最上面盖一块看不见、能竖着滚的区域(里面是很高的一段空白)，滚轮落在它上面时它跟着滚
function addWheelBox(): void {
  const box = document.createElement('div');
  box.id = 'smoke-wheel';
  box.style.cssText = 'position:fixed;inset:0;overflow-y:auto;opacity:0;z-index:99999';
  const rest = document.createElement('div');
  rest.style.height = '5000px';
  box.append(rest);
  document.body.append(box);
}

// addWheelBox 盖的那块区域滚到哪；没有时为 -1
function wheelTop(): number {
  return document.getElementById('smoke-wheel')?.scrollTop ?? -1;
}

// 让页面跳到 url
function navigate(url: string): void {
  location.href = url;
}

function currentUrl(): string {
  return location.href;
}

// ---- 步骤 ----

interface Pages {
  window: Page;
  keyboard: Page;
  media: Page;
  clock: Page | null;   // 时钟面板的页面：它的组件开着时才有
  all: Page[];          // 接过的全部页面；页面关掉之后还留在这里，它报过的错照样要查
}

// 等三个页面都出现并接上；键盘面板的页面和主窗口用来操作
async function attachPages(app: Running): Promise<Pages> {
  const port = await until(app, '程序报出调试端口', PORT_MS, () => app.port);
  const targets = await until(app, '主窗口、键盘面板、媒体页面', PAGES_MS, () => listTargets(port), list => STARTUP_URLS.every(url => list.some(t => t.url === url)));
  const all: Page[] = [];
  const byUrl = new Map<string, Page>();
  try {
    for (const t of targets) {
      const page = await Page.attach(t);
      all.push(page);
      if (!byUrl.has(t.url)) byUrl.set(t.url, page);
    }
  } catch (e) {
    for (const p of all) p.close();
    throw e;
  }
  const window = byUrl.get(WINDOW_URL);
  const keyboard = byUrl.get(KEYBOARD_URL);
  const media = byUrl.get(MEDIA_URL);
  if (!window || !keyboard || !media) throw new Error('页面没接上');
  // 面板只该有键盘这一块：时钟的组件关着，别的 .panel 页面不该出现
  const panels = panelUrls(targets);
  if (panels.length !== 1) throw new Error(`面板页面不是只有键盘一块：${panels.join('、')}`);
  return { window, keyboard, media, clock: null, all };
}

// 输入法还在部署时键盘面板上盖着部署提示；在主窗口换界面语言，提示上的字跟着换(三种语言各不相同)；最后改回去。
// 部署在看全之前就结束了的话，关掉再打开输入法组件让它重新部署，接着看；最多这样 VEIL_REDEPLOYS 次
async function veilFollows(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const read = async (): Promise<{ look: ReturnType<typeof pageLook>; view: ReturnType<typeof keyboardView> }> => (
    { look: await kb.run(pageLook, THEME_ID), view: await kb.run(keyboardView, REQUIRED_SLOTS) }
  );
  const setting = await win.run(languageSetting);
  const first = (await until(app, '键盘面板的界面语言', STEP_MS, read, v => LOCALES.includes(v.look.lang))).look.lang;
  const langs = [first, ...LOCALES.filter(lang => lang !== first).slice(0, 2)];
  const veils: string[] = [];
  let redeploys = 0;
  try {
    for (const lang of langs) {
      if (lang !== first) await win.run(setLanguage, lang);
      for (;;) {
        // 等到这种语言的提示盖着(文字和前面几种都不同)，或者部署已经结束(键区画出来了)
        const now = await until(app, `部署提示是 ${lang} 的文字，或者输入法部署完`, DEPLOY_MS, read,
          v => v.look.lang === lang && ((v.look.veil !== '' && !veils.includes(v.look.veil)) || (v.look.veil === '' && v.view.deployed && v.view.keys > 0)));
        if (now.look.veil !== '') {
          veils.push(now.look.veil);
          break;
        }
        if (++redeploys > VEIL_REDEPLOYS) throw new Error(`重新部署了 ${VEIL_REDEPLOYS} 次，还是没看到 ${lang} 的部署提示(看到过的：${veils.join('、') || '没有'})`);
        await switchOn(win, IME_ID, false);
        await until(app, '输入法关掉后键区撤掉', STEP_MS, read, v => v.view.keys === 0);
        await switchOn(win, IME_ID, true);
      }
    }
  } finally {
    await win.run(setLanguage, setting);
  }
  await until(app, `界面语言改回 ${first}`, STEP_MS, read, v => v.look.lang === first && (v.look.veil === '' || v.look.veil === veils[0]));
  return `${veils.join(' → ')}${redeploys ? `(重新部署了 ${redeploys} 次)` : ''}`;
}

// 输入法部署完、键区画出来，页面上没有缺组件之类的提示
async function keyboardReady(app: Running, kb: Page): Promise<string> {
  const view = await until(app, '输入法部署完、键区画出来', DEPLOY_MS, () => kb.run(keyboardView, REQUIRED_SLOTS), v => v.deployed && v.keys > 0);
  if (view.notices.length) throw new Error(`键盘面板上有提示：${view.notices.join('；')}`);
  return `${view.keys} 个键`;
}

// 按 TYPED 的每个字母，候选第一个是 EXPECTED；按空格后它进输入框、候选清空；点清空按钮后输入框空了
async function typeWord(app: Running, kb: Page): Promise<string> {
  const press = async (letter: string): Promise<void> => {
    const at = await kb.run(keyCenter, letter);
    if (!at) throw new Error(`键区里找不到${letter ? ` ${letter} 键` : '空格键'}，或者它在窗口外面`);
    await kb.click(at);
    await sleep(KEY_GAP_MS);
  };
  for (const letter of TYPED) await press(letter);
  await until(app, `候选第一个是「${EXPECTED}」`, STEP_MS, () => kb.run(inputView), v => v.cands[0] === EXPECTED);
  await press('');
  await until(app, `「${EXPECTED}」进输入框、候选清空`, STEP_MS, () => kb.run(inputView), v => v.text === EXPECTED && v.count === 0 && v.composition === '');
  const clear = await kb.run(clearCenter);
  if (!clear) throw new Error('输入框里找不到清空按钮');
  await kb.click(clear);
  await until(app, '输入框清空', STEP_MS, () => kb.run(inputView), v => v.text === '');
  return `按 ${TYPED} 和空格，输入框里是「${EXPECTED}」`;
}

// 键盘面板的界面语言是核心给的那个：文档和根元素的 lang、键盘状态里的界面语言都是它；
// 在主窗口换界面语言，这三处和部件上的文字(日夜切换按钮的说明)跟着换，页面不重载；最后改回去
async function languageFollows(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const read = async (): Promise<{ look: ReturnType<typeof pageLook>; uiLang: string }> => (
    { look: await kb.run(pageLook, THEME_ID), uiLang: (await kb.run(keyboardLangs))?.uiLang ?? '' }
  );
  const shows = (lang: string) => (v: Awaited<ReturnType<typeof read>>): boolean => v.look.lang === lang && v.look.rootLang === lang && v.uiLang === lang;
  const setting = await win.run(languageSetting);
  const first = (await kb.run(pageLook, THEME_ID)).lang;
  if (!LOCALES.includes(first)) throw new Error(`键盘面板的 lang 是「${first}」，不是界面语言`);
  const before = await until(app, `键盘面板和键盘状态的界面语言都是 ${first}`, STEP_MS, read, shows(first));
  await kb.run(markPage);
  const others = LOCALES.filter(lang => lang !== first).slice(0, 2);
  const labels = [before.look.label];
  try {
    for (const lang of others) {
      await win.run(setLanguage, lang);
      const now = await until(app, `键盘面板和键盘状态的界面语言换成 ${lang}，部件上的文字跟着换`, STEP_MS, read, v => shows(lang)(v) && !labels.includes(v.look.label));
      labels.push(now.look.label);
    }
  } finally {
    await win.run(setLanguage, setting);
  }
  const after = await until(app, `键盘面板和键盘状态的界面语言改回 ${first}`, STEP_MS, read, v => shows(first)(v) && v.look.label === before.look.label);
  if (new Set(labels).size !== labels.length || labels.includes('')) throw new Error(`部件上的文字没有跟着换：${labels.join('、')}`);
  if (!after.look.marked) throw new Error('换界面语言时键盘面板的页面重载了');
  return `${first} → ${others.join(' → ')} → ${first}，页面没有重载`;
}

// 按日夜切换按钮：键盘面板的深色(根元素和弹层)跟着换，设置里面板的深色也跟着换；再按一次换回来
async function themeToggles(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const at = await kb.run(partButtonCenter, THEME_ID);
  if (!at) throw new Error(`键盘面板里找不到 ${THEME_ID} 的按钮，或者它在窗口外面`);
  const read = async (): Promise<{ page: boolean; saved: boolean }> => ({ page: (await kb.run(pageLook, THEME_ID)).dark, saved: await win.run(panelsDark) });
  const before = await read();
  if (before.page !== before.saved) throw new Error(`键盘面板是${before.page ? '深色' : '浅色'}，设置里面板的深色是 ${before.saved}`);
  await kb.click(at);
  await until(app, `键盘面板和设置换成${before.page ? '浅色' : '深色'}`, STEP_MS, read, v => v.page !== before.page && v.saved === v.page);
  await kb.click(at);
  await until(app, `键盘面板和设置换回${before.page ? '深色' : '浅色'}`, STEP_MS, read, v => v.page === before.page && v.saved === v.page);
  return `${before.page ? '深色 → 浅色 → 深色' : '浅色 → 深色 → 浅色'}`;
}

// 在主窗口关掉一个语言组件：键盘状态里的语言列表少了它；再打开：它回来
async function langOffAndOn(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const set = async (on: boolean): Promise<void> => {
    const refused = await win.run(switchComponent, LANG_ID, on);
    if (refused !== null) throw new Error(`${LANG_ID} ${on ? '打不开' : '关不掉'}：${refused}`);
  };
  const packs = async (): Promise<string[]> => (await kb.run(keyboardLangs))?.packs ?? [];
  const before = await until(app, `键盘的语言列表里有 ${LANG_ID}`, STEP_MS, packs, list => list.includes(LANG_ID));
  await set(false);
  try {
    await until(app, `键盘的语言列表里没有 ${LANG_ID}`, STEP_MS, packs, list => !list.includes(LANG_ID) && list.length === before.length - 1);
  } finally {
    await set(true);
  }
  await until(app, `${LANG_ID} 回到键盘的语言列表`, STEP_MS, packs, list => list.includes(LANG_ID) && list.length === before.length);
  return `${before.length} 种语言 → ${before.length - 1} 种 → ${before.length} 种`;
}

// 侧栏的每一项点开：选中的换成它、内容区画出 h1、这一页没有报错
async function visitPages(app: Running, win: Page): Promise<string> {
  const titles = await until(app, '主窗口的侧栏', STEP_MS, () => win.run(navTitles), list => list.length > 0);
  for (const title of titles) {
    const before = win.errors.length;
    if (!await win.run(openNav, title)) throw new Error(`侧栏里找不到「${title}」`);
    await until(app, `「${title}」页的标题`, STEP_MS, () => win.run(shownHeading, title));
    await sleep(SETTLE_MS);
    if (win.errors.length > before) throw new Error(`「${title}」页报错：${win.errors.slice(before).join('；')}`);
  }
  return titles.join('、');
}

// 关掉输入法组件：要它的部件都不算在用、不进键盘面板(挂着的只剩不用它的部件)，外壳的三个插槽里显示缺件提示，不盖部署提示；
// 这时换界面语言，缺件提示的文字跟着换；再打开：部件回来、输入法部署完、能打字
async function imeOffAndOn(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const set = async (on: boolean): Promise<void> => {
    const refused = await win.run(switchComponent, IME_ID, on);
    if (refused !== null) throw new Error(`${IME_ID} ${on ? '打不开' : '关不掉'}：${refused}`);
  };
  const before = await kb.run(keyboardView, REQUIRED_SLOTS);
  const planned = await kb.run(planIds);
  const needing = await win.run(requiring, NEEDS_IME);
  const parts = needing.filter(id => planned.parts.includes(id));
  // 不用输入法的部件：关掉输入法后还挂着的就该是它们
  const staying = planned.parts.filter(id => !needing.includes(id));
  if (planned.root !== KEYBOARD_PANEL || !planned.services.includes(IME_ID) || !parts.length) throw new Error('键盘面板里没有输入法的页面部分或要它的部件，查不了');
  if ([...before.parts].sort().join() !== [...planned.parts].sort().join()) throw new Error(`外壳里挂着的部件(${before.parts.join('、')})和计划里的(${planned.parts.join('、')})不一样`);
  await set(false);
  let summary: string;
  try {
    const view = await until(app, '要输入法的部件撤掉、外壳里出现缺件提示', STEP_MS, () => kb.run(keyboardView, REQUIRED_SLOTS),
      v => v.parts.join() === staying.join() && v.keys === 0 && v.noticed.length === REQUIRED_SLOTS.length);
    if (view.notices.length !== REQUIRED_SLOTS.length) throw new Error(`页面上的提示不是 ${REQUIRED_SLOTS.length} 条缺件提示：${view.notices.join('；')}`);
    if (!view.deployed) throw new Error('输入法关着，页面上还盖着部署提示');
    const now = await kb.run(planIds);
    const left = [now.root, ...now.parts, ...now.services];
    const stay = [IME_ID, ...needing].filter(id => left.includes(id));
    if (stay.length) throw new Error(`键盘面板的计划里还有 ${stay.join('、')}`);
    if (now.root !== KEYBOARD_PANEL || now.parts.join() !== staying.join() || now.services.length) throw new Error(`键盘面板的计划里剩的不是外壳和不用输入法的部件：${left.join('、')}`);
    const active = await win.run(activeIds);
    const still = needing.filter(id => active.includes(id));
    if (still.length) throw new Error(`${still.join('、')} 还算在用`);
    // 输入法关着时界面语言照样跟核心走
    const setting = await win.run(languageSetting);
    const other = LOCALES.find(lang => lang !== view.lang) ?? '';
    let translated: string[];
    try {
      await win.run(setLanguage, other);
      translated = (await until(app, `缺件提示换成 ${other} 的文字`, STEP_MS, () => kb.run(keyboardView, REQUIRED_SLOTS),
        v => v.lang === other && v.notices.length === view.notices.length && v.notices.every(n => !view.notices.includes(n)))).notices;
    } finally {
      await win.run(setLanguage, setting);
    }
    await until(app, `缺件提示换回 ${view.lang} 的文字`, STEP_MS, () => kb.run(keyboardView, REQUIRED_SLOTS),
      v => v.lang === view.lang && v.notices.join('；') === view.notices.join('；'));
    summary = `关掉后要它的 ${parts.length} 个部件不进键盘面板，计划里剩 ${left.join('、')}，提示：${view.notices.join('；')}(${other}：${translated.join('；')})`;
  } finally {
    await set(true);
  }
  await until(app, '部件回来、输入法部署完', DEPLOY_MS, () => kb.run(keyboardView, REQUIRED_SLOTS),
    v => v.deployed && v.keys === before.keys && v.parts.join() === before.parts.join() && v.notices.length === 0);
  await typeWord(app, kb);
  return `${summary}；再打开后外壳里的 ${before.parts.length} 个部件回来，能打字`;
}

type ClockView = Awaited<ReturnType<typeof clockView>>;

// 时钟面板画出了时间和日期(日期里有年份)
const clockDrawn = (v: ClockView): boolean => CLOCK_TIME.test(v.time) && /\d{4}/.test(v.date);

// 时钟面板的页面；它的组件没开着时抛出异常
function clockPage(pages: Pages): Page {
  if (!pages.clock) throw new Error('时钟面板没有开着，查不了');
  return pages.clock;
}

// 等时钟面板的页面出现并接上
async function attachClock(app: Running, pages: Pages): Promise<Page> {
  const targets = await until(app, '时钟面板的页面', STEP_MS, () => listTargets(app.port), list => list.some(t => t.url === CLOCK_URL));
  const target = targets.find(t => t.url === CLOCK_URL);
  if (!target) throw new Error('时钟面板的页面没有出现');
  const page = await Page.attach(target);
  pages.clock = page;
  pages.all.push(page);
  return page;
}

// 开关一个组件(经主窗口)；没改成时抛出异常
async function switchOn(win: Page, id: string, on: boolean): Promise<void> {
  const refused = await win.run(switchComponent, id, on);
  if (refused !== null) throw new Error(`${id} ${on ? '打不开' : '关不掉'}：${refused}`);
}

type PlannedEntry = NonNullable<Awaited<ReturnType<typeof plannedEntry>>>;

// 等键盘面板重载完：markPage 留的记号没了，键区又画出来，计划里组件 id 的那一项满足 ok；返回这时的页面和那一项
async function keyboardReloaded(app: Running, kb: Page, what: string, id: string, ok: (entry: PlannedEntry) => boolean): Promise<{ view: ReturnType<typeof keyboardView>; entry: PlannedEntry }> {
  const read = async (): Promise<{ marked: boolean; view: ReturnType<typeof keyboardView>; entry: PlannedEntry | null }> => (
    { marked: await kb.run(isMarked), view: await kb.run(keyboardView, REQUIRED_SLOTS), entry: await kb.run(plannedEntry, id) }
  );
  const done = await until(app, what, STEP_MS, read, v => !v.marked && v.view.deployed && v.view.keys > 0 && v.entry !== null && ok(v.entry));
  if (done.view.notices.length) throw new Error(`键盘面板重载后有提示：${done.view.notices.join('；')}`);
  if (!done.entry) throw new Error(`键盘面板的计划里没有 ${id}`);
  return { view: done.view, entry: done.entry };
}

// 在主窗口打开时钟示例的组件(装在组件目录里，不是预装的)：多出一个面板页面，它有自己的源和自己的窗口(窗口里是它清单写的页面大小)，
// 画出时间和日期，标题是组件的名字；键盘面板的页面没有重载
async function clockOpens(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  if (!(await win.run(installedIds)).includes(CLOCK_ID)) throw new Error(`组件列表里没有 ${CLOCK_ID}`);
  if ((await win.run(enabledIds)).includes(CLOCK_ID)) throw new Error(`${CLOCK_ID} 一开始就开着`);
  await kb.run(markPage);
  await switchOn(win, CLOCK_ID, true);
  const clock = await attachClock(app, pages);
  const view = await until(app, '时钟面板画出时间和日期', STEP_MS, () => clock.run(clockView), clockDrawn);
  if (view.origin !== CLOCK_ORIGIN) throw new Error(`时钟面板的源是 ${view.origin}`);
  if (!view.title || !LOCALES.includes(view.lang)) throw new Error(`时钟面板的标题是「${view.title}」，lang 是「${view.lang}」`);
  const fits = view.planned.length === 2 && view.planned.every((side, i) => {
    const over = (view.inner[i] ?? 0) - side;
    return over >= 0 && over <= WINDOW_SLACK;
  });
  if (!fits) throw new Error(`时钟面板的窗口里是 ${view.inner.join('×')}，清单写的页面是 ${view.planned.join('×')}`);
  const kbSize = await kb.run(innerSize);
  if ((kbSize[0] ?? 0) <= (view.inner[0] ?? 0) + WINDOW_SLACK) throw new Error(`键盘面板的窗口里是 ${kbSize.join('×')}，和时钟面板的分不开`);
  const panels = panelUrls(await listTargets(app.port));
  if (panels.join() !== [CLOCK_URL, KEYBOARD_URL].sort().join()) throw new Error(`面板页面不是键盘和时钟两块：${panels.join('、')}`);
  if (!await kb.run(isMarked)) throw new Error('打开时钟的组件时键盘面板的页面重载了');
  return `时钟面板 ${view.origin}，窗口里 ${view.inner.join('×')}，「${view.title}」${view.time}，${view.date}；键盘面板(窗口里 ${kbSize.join('×')})没有重载`;
}

// 主窗口、键盘面板、时钟面板各有自己的源：一页往 localStorage 里写的值，另外两页都读不到
async function storesApart(pages: Pages): Promise<string> {
  const list: { page: Page; tag: string; origin?: string }[] = [
    { page: pages.window, tag: 'window' },
    { page: pages.keyboard, tag: 'keyboard', origin: KEYBOARD_ORIGIN },
    { page: clockPage(pages), tag: 'clock', origin: CLOCK_ORIGIN },
  ];
  const origins: string[] = [];
  for (const { page, tag, origin } of list) {
    const r = await page.run(originStore, STORE_KEY, tag);
    if (origin !== undefined && r.origin !== origin) throw new Error(`${page.name}的源是 ${r.origin}`);
    if (r.before !== null) throw new Error(`${page.name}读到了别处写的 localStorage：${r.before}`);
    origins.push(r.origin);
  }
  if (new Set(origins).size !== origins.length) throw new Error(`有页面是同一个源：${origins.join('、')}`);
  // 都写过之后各页读到的还是自己写的
  for (const { page, tag } of list) {
    const again = await page.run(originStore, STORE_KEY, tag);
    if (again.before !== tag) throw new Error(`${page.name}的 localStorage 里读到的是 ${String(again.before)}`);
  }
  return `${list.map(({ page }, i) => `${page.name} ${origins[i] ?? ''}`).join('，')}，localStorage 互不相通`;
}

// 改常用语侧栏页(键盘面板里的一个部件)的一项设置：只有键盘面板重载，重载后计划里是新的值、照常画出键区，时钟面板不动。
// 改时钟的设置(显示秒)：只有时钟面板重载并带上秒，键盘面板不动。两项最后都改回去
async function settingReloads(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const clock = clockPage(pages);
  const set = async (id: string, values: Record<string, unknown>): Promise<void> => {
    const refused = await win.run(setConfig, id, values);
    if (refused !== null) throw new Error(`${id} 的设置改不了：${refused}`);
  };
  const send = (await kb.run(plannedEntry, PHRASES_ID))?.config['send'];
  if (typeof send !== 'boolean') throw new Error(`键盘面板的计划里没有 ${PHRASES_ID} 的设置`);
  await kb.run(markPage);
  await clock.run(markPage);
  await set(PHRASES_ID, { send: !send });
  try {
    await keyboardReloaded(app, kb, `键盘面板重载，计划里 ${PHRASES_ID} 的设置是新的值`, PHRASES_ID, e => e.config['send'] === !send);
  } finally {
    await kb.run(markPage).catch(() => undefined);
    await set(PHRASES_ID, { send });
  }
  await keyboardReloaded(app, kb, `键盘面板再重载，${PHRASES_ID} 的设置改回去`, PHRASES_ID, e => e.config['send'] === send);
  if (!await clock.run(isMarked)) throw new Error(`改 ${PHRASES_ID} 的设置时时钟面板的页面重载了`);

  if (CLOCK_SECONDS.test((await clock.run(clockView)).time)) throw new Error('时钟面板一开始就带秒');
  await kb.run(markPage);
  await set(CLOCK_ID, { seconds: true });
  let shown: string;
  try {
    const read = async (): Promise<{ marked: boolean; view: ClockView }> => ({ marked: await clock.run(isMarked), view: await clock.run(clockView) });
    shown = (await until(app, '时钟面板重载并带上秒', STEP_MS, read, v => !v.marked && CLOCK_SECONDS.test(v.view.time))).view.time;
  } finally {
    await set(CLOCK_ID, { seconds: false });
  }
  await until(app, '时钟面板再重载，不带秒', STEP_MS, () => clock.run(clockView), v => clockDrawn(v) && !CLOCK_SECONDS.test(v.time));
  if (!await kb.run(isMarked)) throw new Error('改时钟的设置时键盘面板的页面重载了');
  return `改 ${PHRASES_ID} 的设置键盘面板重载两次，时钟面板没有重载；改 ${CLOCK_ID} 的设置时钟面板重载(带秒时 ${shown})，键盘面板没有重载`;
}

// 开发文件夹里常用语的入口文件保存一次(末尾加一行注释)：键盘面板自己重载，计划里它的入口地址换了(地址带文件的修改时间)，
// 部件照常挂着；时钟面板不动
async function devSaveReloads(app: Running, pages: Pages): Promise<string> {
  const { keyboard: kb } = pages;
  const clock = clockPage(pages);
  const before = await kb.run(plannedEntry, PHRASES_ID);
  if (!before?.url) throw new Error(`键盘面板的计划里没有 ${PHRASES_ID} 的入口`);
  await kb.run(markPage);
  await clock.run(markPage);
  fs.appendFileSync(path.join(app.devFolder, 'page.js'), '\n// smoke\n');
  const { view, entry } = await keyboardReloaded(app, kb, `键盘面板重载，计划里 ${PHRASES_ID} 的入口地址换了`, PHRASES_ID, e => e.url !== '' && e.url !== before.url);
  if (!view.parts.includes(PHRASES_ID)) throw new Error(`重载后外壳里没有挂着 ${PHRASES_ID}：${view.parts.join('、')}`);
  if (!await clock.run(isMarked)) throw new Error('保存开发文件夹里的文件时时钟面板的页面重载了');
  const tail = (url: string): string => url.slice(url.lastIndexOf('/') + 1);
  return `${tail(before.url)} → ${tail(entry.url)}，键盘面板重载，时钟面板没有重载`;
}

// 启动的那个进程的进程号(程序的窗口都是它的)
function processId(app: Running): number {
  const pid = app.child.pid;
  if (pid === undefined) throw new Error('程序没有进程号');
  return pid;
}

// 一个面板页面的标题：等它换成面板的名字(页面刚加载时是宿主页自带的标题)
async function panelTitle(app: Running, page: Page): Promise<string> {
  return until(app, `${page.name}的标题换成面板的名字`, STEP_MS, () => page.run(pageTitle), title => title !== '' && title !== 'FoxPanel');
}

// 点时钟面板上的收起按钮(页面请显示方收起自己)：显示方隐藏它的窗口——系统里这个窗口不显示了，页面还在、得到「没在显示」的通知；
// 键盘面板的窗口照常显示着、没有重载，时钟的组件还开着，运行日志里没有多出 warn 或 error(调用没有被拒绝)。
// 再关掉、打开它的组件，它的窗口回来
async function clockHides(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const clock = clockPage(pages);
  const pid = processId(app);
  const titles = { clock: await panelTitle(app, clock), kb: await panelTitle(app, kb) };
  if (titles.clock === titles.kb) throw new Error(`两块面板的窗口标题都是「${titles.kb}」，分不开`);
  if (!await clock.run(visibleNow)) throw new Error('时钟面板显示着，页面得到的却是没在显示');
  await until(app, '两块面板的窗口在系统里显示着', STEP_MS, () => shownTitles(pid), list => list.includes(titles.clock) && list.includes(titles.kb));
  const at = await clock.run(hideCenter);
  if (!at) throw new Error('时钟面板上找不到收起按钮');
  const before = await win.run(troubleLines);
  await kb.run(markPage);
  await clock.run(markPage);
  await clock.click(at);
  const read = async (): Promise<{ shown: string[]; told: boolean }> => ({ shown: shownTitles(pid), told: await clock.run(visibleNow) });
  const hidden = await until(app, '时钟面板的窗口隐藏、页面得到没在显示的通知', STEP_MS, read, v => !v.shown.includes(titles.clock) && !v.told);
  if (!hidden.shown.includes(titles.kb)) throw new Error('收起时钟面板时键盘面板的窗口也不显示了');
  const urls = panelUrls(await listTargets(app.port));
  if (urls.join() !== [CLOCK_URL, KEYBOARD_URL].sort().join()) throw new Error(`收起之后面板页面不是键盘和时钟两块：${urls.join('、')}`);
  if (!await clock.run(isMarked)) throw new Error('收起时钟面板时它的页面重载了');
  if (!await kb.run(isMarked)) throw new Error('收起时钟面板时键盘面板的页面重载了');
  if (!(await win.run(enabledIds)).includes(CLOCK_ID)) throw new Error(`收起面板把 ${CLOCK_ID} 这个组件关掉了`);
  const fresh = (await win.run(troubleLines)).slice(before.length);
  if (fresh.length) throw new Error(`运行日志里多了：${fresh.join('；')}`);
  await switchOn(win, CLOCK_ID, false);
  await until(app, '时钟面板的页面消失', STEP_MS, async () => panelUrls(await listTargets(app.port)), list => list.join() === KEYBOARD_URL);
  pages.clock = null;
  clock.close();
  await switchOn(win, CLOCK_ID, true);
  const back = await attachClock(app, pages);
  const view = await until(app, '时钟面板再画出时间和日期', STEP_MS, () => back.run(clockView), clockDrawn);
  await until(app, '时钟面板的窗口在系统里又显示着', STEP_MS, () => shownTitles(pid), list => list.includes(titles.clock));
  return `点收起后时钟面板的窗口「${titles.clock}」在系统里不显示了，页面还在、得到没在显示的通知，键盘面板的窗口照常显示、没有重载，日志里没有被拒绝的调用；关掉再打开组件后时钟面板回来(${view.time})`;
}

// 一块面板的页面的地址
const panelUrl = (id: string): string => `fox://${id}.panel/panel.html`;

// 等一块面板的页面出现并接上
async function attachPanel(app: Running, pages: Pages, id: string): Promise<Page> {
  const url = panelUrl(id);
  const targets = await until(app, `${id} 的页面`, STEP_MS, () => listTargets(app.port), list => list.some(t => t.url === url));
  const target = targets.find(t => t.url === url);
  if (!target) throw new Error(`${id} 的页面没有出现`);
  const page = await Page.attach(target);
  pages.all.push(page);
  return page;
}

// 关掉检查用的面板的组件，等它们的页面都消失(面板页面只剩键盘和时钟)
async function closeSeeded(app: Running, win: Page, ids: readonly string[]): Promise<void> {
  for (const id of ids) await switchOn(win, id, false);
  await until(app, '检查用的面板的页面都消失', STEP_MS, async () => panelUrls(await listTargets(app.port)), list => list.join() === [CLOCK_URL, KEYBOARD_URL].sort().join());
}

type PanelView = PanelsState['panels'][number];

// 状态里的一块面板；没有时抛出异常
function viewOf(state: PanelsState, id: string): PanelView {
  const view = state.panels.find(p => p.id === id);
  if (!view) throw new Error(`panels 的状态里没有 ${id}`);
  return view;
}

// 检查用面板里：点一下按钮算一次 click；在按钮上按住往上拖 DRAG_PX 像素再松开，内容往下滚了这么多、不算 click；
// 只拖 DRAG_SHORT_PX 像素不滚；在按钮上按住往下拖回最上面也不算 click，之后再点照常算
async function dragScrolls(app: Running, probe: Page): Promise<string> {
  const start = await until(app, '检查用面板画出按钮', STEP_MS, () => probe.run(probeView), v => v.button !== null);
  const at = start.button;
  if (!at || start.top !== 0 || start.clicks !== 0) throw new Error(`检查用面板一开始是 ${JSON.stringify(start)}`);
  await probe.click(at);
  await until(app, '按钮收到一次 click', STEP_MS, () => probe.run(probeView), v => v.clicks === 1 && v.top === 0);
  await probe.drag(at, { x: at.x, y: at.y - DRAG_PX });
  const dragged = await until(app, `内容往下滚 ${DRAG_PX} 像素`, STEP_MS, () => probe.run(probeView), v => Math.abs(v.top - DRAG_PX) <= 1);
  await sleep(SETTLE_MS);
  const after = await probe.run(probeView);
  if (after.clicks !== 1) throw new Error(`拖动之后按钮的 click 次数从 1 变成 ${after.clicks}`);
  // 在按钮下面的空白上按住拖一小段：不够算拖动，内容不滚
  const low = { x: at.x, y: at.y + DRAG_PX };
  await probe.drag(low, { x: low.x, y: low.y + DRAG_SHORT_PX });
  await sleep(SETTLE_MS);
  const short = await probe.run(probeView);
  if (short.top !== after.top) throw new Error(`只拖 ${DRAG_SHORT_PX} 像素内容也滚了：${after.top} → ${short.top}`);
  // 在按钮上按住往下拖到头：内容回到最上面，这一次也不算 click
  const high = { x: at.x, y: at.y - DRAG_PX };
  await probe.drag(high, { x: high.x, y: high.y + DRAG_PX * 2 });
  await until(app, '内容拖回最上面', STEP_MS, () => probe.run(probeView), v => v.top === 0);
  await sleep(SETTLE_MS);
  const back = await probe.run(probeView);
  if (back.clicks !== 1) throw new Error(`在按钮上拖动之后它的 click 次数从 1 变成 ${back.clicks}`);
  await probe.click(at);
  const clicked = await until(app, '拖动之后再点按钮照常算 click', STEP_MS, () => probe.run(probeView), v => v.clicks === 2);
  return `按住拖 ${DRAG_PX} 像素内容滚了 ${dragged.top} 像素、不算点击；拖 ${DRAG_SHORT_PX} 像素不滚；拖回最上面后点按钮照常算点击(共 ${clicked.clicks} 次)`;
}

// 打开三块检查用的面板(一块在清单里写了 panels、两块凑数)，经那一块的页面用远程服务 panels 做一轮：
// 顶到同时显示的上限、改宽度、改附着在哪和抬手才显示再重置、开关时钟、全局锁、单块锁、时钟自己的收起按钮、到面前、
// 关着的时钟和键盘按总开关回来、整组收起和恢复、常显、不合格的调用。
// 每一步等三样对上：panels 的状态、各块面板的窗口在系统里显示没有、各页面得到的显示通知。
// 最后关掉这三块的组件；键盘面板和时钟面板的页面全程没有重载
async function panelsRound(app: Running, pages: Pages): Promise<{ detail: string; notes: string[] }> {
  const { window: win, keyboard: kb } = pages;
  const clock = clockPage(pages);
  const pid = processId(app);
  const [fillA = '', fillB = ''] = FILL_IDS;
  const all = [KEYBOARD_PANEL, PROBE_ID, CLOCK_ID, fillA, fillB];
  const four = [KEYBOARD_PANEL, PROBE_ID, CLOCK_ID, fillA];
  const notes: string[] = [];
  await kb.run(markPage);
  await clock.run(markPage);
  try {
    for (const id of [PROBE_ID, ...FILL_IDS]) await switchOn(win, id, true);
    const probe = await attachPanel(app, pages, PROBE_ID);
    const boards = new Map<string, Page>([[KEYBOARD_PANEL, kb], [PROBE_ID, probe], [CLOCK_ID, clock], [fillA, await attachPanel(app, pages, fillA)]]);
    const titles = new Map<string, string>();
    for (const [id, page] of boards) titles.set(id, await panelTitle(app, page));

    // 等 panels 的状态里显示着的正好是 shown(按目录的顺序)、ok(状态) 为真；开过页面的面板里，系统里显示着窗口的、
    // 页面得到「在显示」通知的也正好是这几块。返回这时的状态
    const expect = async (what: string, shown: readonly string[], ok: (s: PanelsState) => boolean = () => true): Promise<PanelsState> => {
      let last: PanelsState | null = null;
      const read = async (): Promise<{ panels: string[]; flags: string; windows: string[]; told: string[] }> => {
        const state = await probe.run(panelsState);
        last = state;
        const onScreen = shownTitles(pid);
        const told: string[] = [];
        for (const [id, page] of boards) if (await page.run(visibleNow)) told.push(id);
        return {
          panels: (state?.panels ?? []).map(p => (
            `${p.id}${p.open ? ' open' : ''}${p.visible ? ' visible' : ''}${p.pinned ? ' pinned' : ''}${p.locked ? ' locked' : ''} ${p.anchor}${p.glance ? ' glance' : ''} ${p.meters}`
          )),
          flags: state ? `${state.connected ? 'connected' : ''}${state.stowed ? ' stowed' : ''}${state.locked ? ' locked' : ''} limit ${state.limit}` : '',
          windows: [...titles].filter(([, title]) => onScreen.includes(title)).map(([id]) => id),
          told,
        };
      };
      const want = shown.join();
      const known = (ids: readonly string[]): string => ids.filter(id => boards.has(id)).join();
      await until(app, what, STEP_MS, read, v => {
        const state = last;
        return state !== null && state.panels.filter(p => p.visible).map(p => p.id).join() === want && ok(state)
          && known(all.filter(id => v.windows.includes(id))) === known(shown) && known(all.filter(id => v.told.includes(id))) === known(shown);
      });
      if (!last) throw new Error('没有 panels 的状态');
      return last;
    };
    const call = async (method: string, ...args: unknown[]): Promise<void> => {
      const refused = await probe.run(panelsCall, method, args);
      if (refused !== null) throw new Error(`panels.${method} 被拒绝：${refused}`);
    };
    const hasPage = async (id: string): Promise<boolean> => (await listTargets(app.port)).some(t => t.url === panelUrl(id));

    // 五块面板进目录就都算打开；同时显示的上限是 4：只显示组件顺序靠前的四块，第五块不开页面
    const first = await expect('五块面板都算打开、显示着前四块', four, s => (
      s.panels.map(p => p.id).join() === all.join() && s.panels.every(p => p.open && !p.pinned && !p.locked && p.anchor === 'world' && !p.glance)
      && s.connected && !s.stowed && !s.locked && s.limit === PANELS_LIMIT
    ));
    if (await hasPage(fillB)) throw new Error(`${fillB} 排在上限之后，却开了页面`);
    const meters = viewOf(first, CLOCK_ID).meters;
    notes.push(`显示方 ${JSON.stringify(first.display)}，上限 ${first.limit}：${all.length} 块面板都算打开，显示着 ${four.join('、')}，${fillB} 没开页面`);

    // 到上限时再开不生效；改宽度(窗口上没有效果，状态里有)。调用按先后处理：后发的那个生效时，前面的已经处理过了
    await call('open', fillB, false);
    await expect('第五块关掉', four, s => !viewOf(s, fillB).open);
    await call('open', fillB, true);
    await call('summon', fillB);
    await call('set', CLOCK_ID, { meters: CLOCK_METERS });
    await expect('时钟的宽度改了，到了上限的第五块开不了', four, s => viewOf(s, CLOCK_ID).meters === CLOCK_METERS && !viewOf(s, fillB).open);
    if (await hasPage(fillB)) throw new Error(`到上限时再开 ${fillB}，它开了页面`);
    await call('set', CLOCK_ID, { meters: 99 });
    const wide = await expect('宽度夹在清单的最大值', four, s => viewOf(s, CLOCK_ID).meters === viewOf(s, CLOCK_ID).maxMeters);
    await call('reset', CLOCK_ID);
    await expect('宽度回到清单的默认值', four, s => viewOf(s, CLOCK_ID).meters === meters);
    notes.push(`到上限时 open、summon 第五块都不生效；时钟的宽度 ${meters} → ${CLOCK_METERS} → ${viewOf(wide, CLOCK_ID).meters}(夹在最大值) → reset 回 ${meters}，窗口不动`);

    // 附着在哪、抬手才显示(窗口上没有效果，状态里有)：挂到头显上不带别的；挂到手上连带抬手才显示、锁上；不认识的值不起作用；
    // 重置回清单的值(留在空间里、不用抬手、不锁)，窗口照常显示着
    await call('set', CLOCK_ID, { anchor: 'head' });
    await expect('时钟附着在头显上', four, s => viewOf(s, CLOCK_ID).anchor === 'head' && !viewOf(s, CLOCK_ID).glance && !viewOf(s, CLOCK_ID).locked);
    await call('set', CLOCK_ID, { glance: true });
    await expect('时钟抬手才显示', four, s => viewOf(s, CLOCK_ID).anchor === 'head' && viewOf(s, CLOCK_ID).glance);
    await call('set', CLOCK_ID, { glance: false });
    await call('set', CLOCK_ID, { anchor: 'left' });
    await expect('时钟附着在左手上，连带抬手才显示、锁上', four, s => viewOf(s, CLOCK_ID).anchor === 'left' && viewOf(s, CLOCK_ID).glance && viewOf(s, CLOCK_ID).locked);
    await call('set', CLOCK_ID, { anchor: 'sky' });
    await call('set', CLOCK_ID, { glance: 'yes' });
    await call('set', CLOCK_ID, { locked: false });
    await expect('不认识的附着对象、不是布尔的抬手才显示都不起作用', four, s => viewOf(s, CLOCK_ID).anchor === 'left' && viewOf(s, CLOCK_ID).glance && !viewOf(s, CLOCK_ID).locked);
    await call('set', CLOCK_ID, { anchor: 'right', glance: false, meters: CLOCK_METERS });
    await expect('时钟换到右手上，同一次给了的照给的', four, s => (
      viewOf(s, CLOCK_ID).anchor === 'right' && !viewOf(s, CLOCK_ID).glance && viewOf(s, CLOCK_ID).locked && viewOf(s, CLOCK_ID).meters === CLOCK_METERS
    ));
    await call('reset', CLOCK_ID);
    await expect('时钟回到清单的附着、抬手才显示、宽度，锁解开', four, s => (
      viewOf(s, CLOCK_ID).anchor === 'world' && !viewOf(s, CLOCK_ID).glance && viewOf(s, CLOCK_ID).meters === meters && !viewOf(s, CLOCK_ID).locked
    ));
    notes.push('时钟的附着对象 world → head → left(连带抬手才显示、锁上) → right(同一次给的 glance、meters 照给的)，不认识的值不起作用；reset 回到清单的 world、不用抬手、默认宽度、不锁，窗口全程显示着');

    // 关掉时钟：它的窗口隐藏、页面还在；空出一个位置，第五块开得了；这时再开时钟不生效。全局锁进状态
    await call('open', CLOCK_ID, false);
    await expect('时钟关掉', [KEYBOARD_PANEL, PROBE_ID, fillA], s => !viewOf(s, CLOCK_ID).open);
    if (!await hasPage(CLOCK_ID)) throw new Error('关掉时钟面板时它的页面没了(该只是隐藏窗口)');
    await call('open', fillB, true);
    const fifth = await attachPanel(app, pages, fillB);
    boards.set(fillB, fifth);
    titles.set(fillB, await panelTitle(app, fifth));
    if (new Set(titles.values()).size !== titles.size) throw new Error(`有面板的窗口标题一样：${[...titles.values()].join('、')}`);
    await expect('第五块顶上来', [KEYBOARD_PANEL, PROBE_ID, fillA, fillB]);
    await call('open', CLOCK_ID, true);
    await call('lockAll', true);
    await expect('全局锁上了，到了上限时钟开不了', [KEYBOARD_PANEL, PROBE_ID, fillA, fillB], s => s.locked && !viewOf(s, CLOCK_ID).open);
    await call('lockAll', false);
    await call('open', fillB, false);
    await call('open', CLOCK_ID, true);
    await expect('第五块关掉、时钟打开、全局锁解开', four, s => !s.locked && viewOf(s, CLOCK_ID).open && !viewOf(s, fillB).open);
    notes.push('关掉时钟后它的窗口隐藏、页面还在，第五块开得了；到上限时再开时钟不生效；全局锁能锁能解；关掉第五块后时钟开得了');

    // 单块锁
    await call('set', CLOCK_ID, { locked: true });
    await expect('时钟锁上', four, s => viewOf(s, CLOCK_ID).locked && !viewOf(s, KEYBOARD_PANEL).locked && !s.locked);
    await call('set', CLOCK_ID, { locked: false });
    await expect('时钟解锁', four, s => !viewOf(s, CLOCK_ID).locked);

    // 时钟用自己的收起按钮收起后算关着；到面前把它打开
    const at = await clock.run(hideCenter);
    if (!at) throw new Error('时钟面板上找不到收起按钮');
    await clock.click(at);
    await expect('时钟用自己的收起按钮收起', [KEYBOARD_PANEL, PROBE_ID, fillA], s => !viewOf(s, CLOCK_ID).open);
    await call('summon', CLOCK_ID);
    await expect('时钟到面前', four, s => viewOf(s, CLOCK_ID).open);
    await call('summon');
    // 时钟再用收起按钮收起，键盘(1 号快捷位指向它)也关掉：总开关把关着的都带回来，别的窗口不动、不算收起着；
    // 关着的第五块跟着算打开，排在上限之后、不显示
    await clock.click(at);
    await expect('时钟再用自己的收起按钮收起', [KEYBOARD_PANEL, PROBE_ID, fillA], s => !viewOf(s, CLOCK_ID).open && !viewOf(s, fillB).open && !s.stowed);
    await call('open', KEYBOARD_PANEL, false);
    await expect('键盘关掉', [PROBE_ID, fillA], s => !viewOf(s, KEYBOARD_PANEL).open && viewOf(s, KEYBOARD_PANEL).quick === 1 && !s.stowed);
    await call('toggleAll');
    await expect('总开关把关着的时钟和键盘带回来', four, s => !s.stowed && all.every(id => viewOf(s, id).open));
    notes.push('单块锁能锁能解；时钟用自己的收起按钮收起后状态里算关着，summon 把它打开；时钟再收起、键盘(1 号快捷位指向它)关掉后 toggleAll 把两块都带回来(关着的第五块跟着算打开，排在上限之后不显示)');

    // 整组收起和恢复；常显的不跟总开关
    await call('toggleAll');
    await expect('整组收起', [], s => s.stowed && all.every(id => viewOf(s, id).open));
    await call('toggleAll');
    await expect('恢复同一组', four, s => !s.stowed);
    await call('set', CLOCK_ID, { pinned: true });
    await call('toggleAll');
    await expect('常显的时钟留着，别的收起', [CLOCK_ID], s => s.stowed && viewOf(s, CLOCK_ID).pinned);
    await call('toggleAll');
    await call('set', CLOCK_ID, { pinned: false });
    await expect('恢复，时钟不常显', four, s => !s.stowed && !viewOf(s, CLOCK_ID).pinned);
    notes.push('没有面板藏着时 toggleAll 把四块的窗口都隐藏(状态里五块仍算打开)，再调恢复同一组；设成常显的时钟不跟着收起');

    // 不合格的调用不起作用：面板 id 不是字符串、开关不是布尔、宽度不是数、没有这块面板
    await call('open', 5, false);
    await call('open', CLOCK_ID, 'no');
    await call('set', CLOCK_ID, { meters: 'wide' });
    await call('lockAll', 1);
    await call('open', MISSING_ID, false);
    await call('set', CLOCK_ID, { locked: true });
    await expect('不合格的调用都没起作用', four, s => (
      viewOf(s, CLOCK_ID).locked && viewOf(s, CLOCK_ID).meters === meters && !s.locked && four.every(id => viewOf(s, id).open) && s.panels.length === all.length
    ));
    await call('set', CLOCK_ID, { locked: false });
    await expect('时钟解锁', four, s => !viewOf(s, CLOCK_ID).locked);
    notes.push('参数不对、没有这块面板的调用都不起作用');

    notes.push(`拖动滚动：${await dragScrolls(app, probe)}`);
  } finally {
    await closeSeeded(app, win, [PROBE_ID, ...FILL_IDS]);
  }
  if (!await kb.run(isMarked)) throw new Error('这一轮里键盘面板的页面重载了');
  if (!await clock.run(isMarked)) throw new Error('这一轮里时钟面板的页面重载了');
  const [kbTitle, clockTitle] = [await panelTitle(app, kb), await panelTitle(app, clock)];
  await until(app, '键盘和时钟的窗口在系统里显示着', STEP_MS, () => shownTitles(pid), list => list.includes(kbTitle) && list.includes(clockTitle));
  return { detail: '状态、窗口在系统里显示没有、页面得到的显示通知每一步都对得上；键盘面板和时钟面板没有重载', notes };
}

// 关掉时钟的组件：只有它的页面消失，键盘面板的页面还在、没有重载、照常能打字；再打开：时钟的页面回来，键盘面板还是没有重载
async function clockOffAndOn(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const clock = clockPage(pages);
  await kb.run(markPage);
  await switchOn(win, CLOCK_ID, false);
  try {
    await until(app, '时钟面板的页面消失、键盘面板的还在', STEP_MS, async () => panelUrls(await listTargets(app.port)), list => list.join() === KEYBOARD_URL);
    pages.clock = null;
    clock.close();
    if (!await kb.run(isMarked)) throw new Error('关掉时钟的组件时键盘面板的页面重载了');
    await typeWord(app, kb);
  } finally {
    await switchOn(win, CLOCK_ID, true);
  }
  const back = await attachClock(app, pages);
  const view = await until(app, '时钟面板再画出时间和日期', STEP_MS, () => back.run(clockView), clockDrawn);
  if (!await kb.run(isMarked)) throw new Error('再打开时钟的组件时键盘面板的页面重载了');
  return `关掉后面板页面只剩键盘一块，键盘面板没有重载、能打字；再打开后时钟面板回来(${view.time})`;
}

// 两块面板的页面：开新窗口(外站的、自己这个地址的)都开不成，程序的页面一个没多；把地址改到外站，地址不变、页面没有重载
async function panelsConfined(app: Running, pages: Pages): Promise<string> {
  const done: string[] = [];
  for (const page of [pages.keyboard, clockPage(pages)]) {
    const count = pageCount(await listAll(app.port));
    const here = await page.run(currentUrl);
    await page.run(markPage);
    for (const url of [OUTSIDE_URL, here]) {
      if (await page.run(tryOpen, url)) throw new Error(`${page.name}开出了新窗口 ${url}`);
    }
    const stayed = await blockedNavigation(app, page);
    const now = pageCount(await listAll(app.port));
    if (now !== count) throw new Error(`${page.name}开新窗口之后程序的页面从 ${count} 个变成 ${now} 个`);
    if (!await page.run(isMarked)) throw new Error(`${page.name}的页面重载了`);
    done.push(`${page.name}${stayed}`);
  }
  return `${done.join('，')}；新窗口都没开成`;
}

// 各页面收集到的报错
function pageErrors(pages: readonly Page[]): string[] {
  return pages.flatMap(p => p.errors.map(e => `${p.name}：${e}`));
}

// 面板页面(键盘、时钟)和媒体页面的 window.fox 上正好是 PageApi 的那些接口：没有组件管理、应用设置、更新、目录、市场、窗口控制的接口；主窗口有
async function narrowApi(pages: Pages): Promise<string> {
  const expected = [...PAGE_API].sort().join();
  for (const page of [pages.keyboard, clockPage(pages), pages.media]) {
    const keys = await page.run(foxKeys);
    const leaked = WINDOW_ONLY.filter(name => keys.includes(name));
    if (leaked.length) throw new Error(`${page.name}的 window.fox 上有 ${leaked.join('、')}`);
    if (keys.join() !== expected) throw new Error(`${page.name}的 window.fox 上的接口是 ${keys.join('、')}`);
  }
  const main = await pages.window.run(foxKeys);
  const absent = WINDOW_ONLY.filter(name => !main.includes(name));
  if (absent.length) throw new Error(`主窗口的 window.fox 上没有 ${absent.join('、')}，名单对不上`);
  return `键盘面板、时钟面板和媒体页面各只有 ${PAGE_API.length} 个接口，${WINDOW_ONLY.length} 个主窗口的接口一个都没有`;
}

// 开发用的显示方把键盘面板开成了窗口，自己不在主窗口拿到的组件列表里，也卸载不了
async function hiddenDisplay(pages: Pages): Promise<string> {
  const before = await pages.window.run(installedIds);
  if (before.includes(DEV_DISPLAY)) throw new Error(`组件列表里有 ${DEV_DISPLAY}`);
  const refused = await pages.window.run(tryRemove, DEV_DISPLAY);
  if (refused === null) throw new Error(`${DEV_DISPLAY} 被卸载了`);
  const after = await pages.window.run(installedIds);
  if (after.join() !== before.join()) throw new Error('组件列表变了');
  return `列表里的 ${before.length} 个组件里没有它，卸载被拒绝`;
}

// 一页的计划里的全部组件 id(面板页面：根组件、部件、服务)
async function loadedIds(page: Page): Promise<string[]> {
  const plan = await page.run(planIds);
  return [...(plan.root ? [plan.root] : []), ...plan.parts, ...plan.services];
}

// 键盘面板用自己计划里的组件 id 能读写数据；用别的组件 id 读不到主窗口写的值，也改不了它
async function foreignData(pages: Pages): Promise<string> {
  const own = await loadedIds(pages.keyboard);
  const mine = own[0];
  const other = (await pages.window.run(installedIds)).find(id => !own.includes(id));
  if (mine === undefined || other === undefined) throw new Error('找不到用来对照的组件');
  const refusedOwn = await pages.keyboard.run(writeData, mine, PROBE_KEY, 'page');
  if (refusedOwn !== null || await pages.window.run(readData, mine, PROBE_KEY) !== 'page') throw new Error(`自己的组件 ${mine} 的数据也写不进${refusedOwn === null ? '' : `：${refusedOwn}`}`);
  const seeded = await pages.window.run(writeData, other, PROBE_KEY, 'window');
  if (seeded !== null) throw new Error(`主窗口写不了 ${other} 的数据：${seeded}`);
  if (await pages.keyboard.run(readData, other, PROBE_KEY) === 'window') throw new Error(`键盘面板读到了 ${other} 的数据`);
  await pages.keyboard.run(writeData, other, PROBE_KEY, 'page');
  if (await pages.window.run(readData, other, PROBE_KEY) !== 'window') throw new Error(`键盘面板改了 ${other} 的数据`);
  return `${mine} 能读写，${other} 读不到也改不了`;
}

// 时钟面板和键盘面板各自用自己的根组件 id 能读写数据；用对方的 id 读不到对方写的值，写被拒绝，对方的值没变
async function panelsDataApart(pages: Pages): Promise<string> {
  const sides = [
    { page: pages.keyboard, id: KEYBOARD_PANEL, value: 'keyboard' },
    { page: clockPage(pages), id: CLOCK_ID, value: 'clock' },
  ] as const;
  for (const { page, id, value } of sides) {
    const refused = await page.run(writeData, id, PROBE_KEY, value);
    if (refused !== null || await page.run(readData, id, PROBE_KEY) !== value) throw new Error(`${page.name}读写不了自己的组件 ${id} 的数据${refused === null ? '' : `：${refused}`}`);
  }
  const [kb, clock] = sides;
  for (const [from, to] of [[clock, kb], [kb, clock]] as const) {
    if (await from.page.run(readData, to.id, PROBE_KEY) === to.value) throw new Error(`${from.page.name}读到了 ${to.id} 的数据`);
    if (await from.page.run(writeData, to.id, PROBE_KEY, 'forged') === null) throw new Error(`${from.page.name}写 ${to.id} 的数据没有被拒绝`);
    if (await to.page.run(readData, to.id, PROBE_KEY) !== to.value) throw new Error(`${from.page.name}改了 ${to.id} 的数据`);
  }
  return `时钟面板读写不了 ${kb.id} 的数据，键盘面板读写不了 ${clock.id} 的数据，各自的照常能读写`;
}

// 时钟面板的组件没在清单里写任何远程服务：键盘面板在用的 keyboard、别的名字它都订阅不了、调不了；键盘面板照常能用 keyboard
async function clockNoRemotes(pages: Pages): Promise<string> {
  const clock = clockPage(pages);
  const plan = await clock.run(planIds);
  if (plan.root !== CLOCK_ID || plan.parts.length || plan.services.length) throw new Error(`时钟面板的计划里不是只有它自己：${[plan.root, ...plan.parts, ...plan.services].join('、')}`);
  for (const name of ['keyboard', 'panels', UNDECLARED_REMOTE]) {
    const r = await clock.run(tryRelay, name);
    if (r.use === null || r.call === null) throw new Error(`时钟面板${r.use === null ? '订阅' : '调用'} ${name} 没有被拒绝`);
  }
  const kb = await pages.keyboard.run(tryRelay, 'keyboard');
  if (kb.use !== null || kb.call !== null) throw new Error(`键盘面板用不了 keyboard：${kb.use ?? kb.call ?? ''}`);
  return '时钟面板用 keyboard、panels 都被拒绝，键盘面板照常能用 keyboard';
}

// 订阅远程服务 panels，再调它的方法(收起 id 这块面板、总开关，不等结果的和等结果的)；各自被拒绝时的原因，没被拒绝为 null
async function tryPanels(id: string): Promise<{ use: string | null; open: string | null; toggle: string | null; waited: string | null }> {
  const fox = (window as unknown as PageWindow).fox;
  const refusal = (p: Promise<unknown>): Promise<string | null> => p.then(() => null, (e: unknown) => String(e));
  return {
    use: await refusal(fox.relayUse('panels', true)),
    open: await refusal(fox.relayCall('panels', 'open', [id, false], false)),
    toggle: await refusal(fox.relayCall('panels', 'toggleAll', [], false)),
    waited: await refusal(fox.relayCall('panels', 'toggleAll', [], true)),
  };
}

// 时钟面板的组件没在清单里写 panels：它订阅不了、调不了(收起键盘面板、总开关都被拒绝)。打开清单里写了 panels 的检查用面板来看：
// 状态里键盘和时钟都显示着、没有被收起，两个窗口在系统里照常显示；同样的调用由检查用面板发才起作用
async function panelsDeclaredOnly(app: Running, pages: Pages): Promise<string> {
  const { window: win, keyboard: kb } = pages;
  const clock = clockPage(pages);
  const pid = processId(app);
  const titles = { kb: await panelTitle(app, kb), clock: await panelTitle(app, clock) };
  const tried = await clock.run(tryPanels, KEYBOARD_PANEL);
  const passed = Object.entries(tried).filter(([, refused]) => refused === null).map(([what]) => what);
  if (passed.length) throw new Error(`时钟面板用 panels 没有被拒绝：${passed.join('、')}`);
  await switchOn(win, PROBE_ID, true);
  try {
    const probe = await attachPanel(app, pages, PROBE_ID);
    const three = [KEYBOARD_PANEL, PROBE_ID, CLOCK_ID].join();
    const visible = (s: PanelsState | null): string => (s?.panels ?? []).filter(p => p.visible).map(p => p.id).join();
    await sleep(SETTLE_MS);
    const state = await until(app, '检查用面板看到 panels 的状态', STEP_MS, () => probe.run(panelsState), s => s !== null && s.panels.some(p => p.id === PROBE_ID && p.visible));
    if (visible(state) !== three || state?.stowed) throw new Error(`时钟面板的调用起了作用：显示着的是 ${visible(state)}${state?.stowed ? '，有面板被收起着' : ''}`);
    const shown = shownTitles(pid);
    if (!shown.includes(titles.kb) || !shown.includes(titles.clock)) throw new Error(`时钟面板的调用之后，系统里显示着的窗口是 ${shown.join('、')}`);
    // 对照：清单里写了 panels 的面板发同样的调用，键盘面板的窗口隐藏；再打开
    const call = async (on: boolean): Promise<void> => {
      const refused = await probe.run(panelsCall, 'open', [KEYBOARD_PANEL, on]);
      if (refused !== null) throw new Error(`检查用面板调 panels.open 被拒绝：${refused}`);
    };
    const read = async (): Promise<{ visible: string; onScreen: boolean }> => ({ visible: visible(await probe.run(panelsState)), onScreen: shownTitles(pid).includes(titles.kb) });
    await call(false);
    try {
      await until(app, '检查用面板把键盘面板收起', STEP_MS, read, v => v.visible === [PROBE_ID, CLOCK_ID].join() && !v.onScreen);
    } finally {
      await call(true);
    }
    await until(app, '键盘面板再打开', STEP_MS, read, v => v.visible === three && v.onScreen);
  } finally {
    await closeSeeded(app, win, [PROBE_ID]);
  }
  return `时钟面板订阅 panels 被拒绝(${tried.use ?? ''})，调 open、toggleAll 都被拒绝，键盘和时钟的窗口照常显示；检查用面板(清单写了 panels)发同样的 open 才把键盘面板收起`;
}

// 键盘面板卸载组件被拒绝(页面上没有这个接口也算)，组件还在
async function refusedRemove(pages: Pages, id: string): Promise<string> {
  const refused = await pages.keyboard.run(tryRemove, id);
  const still = (await pages.window.run(installedIds)).includes(id);
  if (refused === null || !still) throw new Error(still ? '调用没有被拒绝' : `${id} 被卸载了`);
  return refused;
}

// 键盘面板经远程服务 keyboard 发开关组件的键盘操作：输出组件照常开关(开关一次再改回去)；
// 装着的别的组件(主窗口的外壳、输入法、键盘上的部件等，每个都发一次和它当前开关相反的操作)和没装的 id 都不起作用
async function outputToggleOnly(app: Running, pages: Pages): Promise<string> {
  const before = await pages.window.run(enabledIds);
  const others = await pages.window.run(otherKindIds);
  const absent = [PROTECTED_ID, IME_ID].filter(id => !others.includes(id) || !before.includes(id));
  if (absent.length) throw new Error(`${absent.join('、')} 没装或没开着，查不了`);
  const output = await pages.window.run(firstOutput);
  if (!output) throw new Error('没有装着的输出组件用来对照');
  const isOn = async (): Promise<boolean> => (await pages.window.run(enabledIds)).includes(output.id);
  await pages.keyboard.run(toggleOutputs, [...others.map((id): [string, boolean] => [id, !before.includes(id)]), [MISSING_ID, true]]);
  // 同一个页面发的操作按先后处理：后发的这个生效时，前面的都已经处理过了
  await pages.keyboard.run(toggleOutputs, [[output.id, !output.on]]);
  await until(app, `${output.id} ${output.on ? '关掉' : '打开'}`, STEP_MS, isOn, on => on !== output.on);
  const after = await pages.window.run(enabledIds);
  await pages.keyboard.run(toggleOutputs, [[output.id, output.on]]);
  await until(app, `${output.id} 改回${output.on ? '开着' : '关着'}`, STEP_MS, isOn, on => on === output.on);
  const switched = [...others, MISSING_ID].filter(id => before.includes(id) !== after.includes(id));
  if (switched.length) throw new Error(`${switched.join('、')} 的开关被改了`);
  return `${output.id} 能开关，别的 ${others.length} 个组件和没装的 ${MISSING_ID} 都没动`;
}

// 键盘面板往总线发消息：自己组件的频道主窗口收得到、自己收不到回声；核心的频道和别的组件的频道发不出去。
// 别的页面发的消息：键盘面板登记了的频道才收得到；别的组件的频道它登记不了(登记了也收不到)；核心的频道主窗口也发不出去
async function busBoundary(app: Running, pages: Pages): Promise<string> {
  const own = await loadedIds(pages.keyboard);
  const mine = own[0];
  const other = (await pages.window.run(installedIds)).find(id => !own.includes(id));
  if (mine === undefined || other === undefined) throw new Error('找不到用来对照的组件');
  await pages.window.run(watchBus);
  await pages.keyboard.run(watchBus);
  const sent = { core: 'core/component-removed "smoke.none"', other: `${other}/smoke "x"`, mine: `${mine}/smoke "ping"` };
  await pages.keyboard.run(busSend, 'core/component-removed', 'smoke.none');
  await pages.keyboard.run(busSend, `${other}/smoke`, 'x');
  // 同一个页面发的消息按先后到：这一条到主窗口时，前两条要是转了也已经到了
  await pages.keyboard.run(busSend, `${mine}/smoke`, 'ping');
  const got = await until(app, '主窗口收到键盘面板发的总线消息', STEP_MS, () => pages.window.run(busSeen), list => list.includes(sent.mine));
  const leaked = got.filter(line => line === sent.core || line === sent.other);
  if (leaked.length) throw new Error(`主窗口收到了 ${leaked.join('、')}`);
  await sleep(SETTLE_MS);
  if ((await pages.keyboard.run(busSeen)).includes(sent.mine)) throw new Error('键盘面板收到了自己发的消息');
  const probe = `${mine}/smoke-listen`;
  const foreign = `${other}/smoke-listen`;
  const heard = { early: `${probe} "early"`, forged: 'core/component-removed "smoke.forged"', foreign: `${foreign} "secret"`, late: `${probe} "late"` };
  await pages.keyboard.run(busListen, 'core/component-removed', true);
  // 别的组件的频道(听写的麦克风 PCM、合成的音频都走这样的频道)：登记被拒绝
  await pages.keyboard.run(busListen, foreign, true);
  await pages.window.run(busSend, probe, 'early');
  await pages.window.run(busSend, 'core/component-removed', 'smoke.forged');
  await sleep(SETTLE_MS);
  await pages.keyboard.run(busListen, probe, true);
  await pages.window.run(busSend, foreign, 'secret');
  await pages.window.run(busSend, probe, 'late');
  const listened = await until(app, '键盘面板收到登记了的频道上的总线消息', STEP_MS, () => pages.keyboard.run(busSeen), list => list.includes(heard.late));
  await pages.keyboard.run(busListen, probe, false);
  await pages.keyboard.run(busListen, 'core/component-removed', false);
  if (listened.includes(heard.early)) throw new Error('键盘面板收到了没登记的频道上的消息');
  if (listened.includes(heard.forged)) throw new Error('主窗口发的 core/component-removed 送到了键盘面板');
  if (listened.includes(heard.foreign)) throw new Error(`键盘面板登记了别的组件的频道 ${foreign}，收到了上面的消息`);
  return `${mine}/smoke 送到主窗口，core/component-removed 和 ${other}/smoke 没送出去；键盘面板登记了 ${probe} 之后才收到它，登记 ${foreign} 收不到，主窗口发的 core/component-removed 没送出去`;
}

// 键盘面板：计划里的组件在清单里写了的远程服务能订阅、能调，没写的被拒绝；主窗口哪个都用不了
async function relayBoundary(pages: Pages): Promise<string> {
  const declared = (await pages.window.run(requiredBy, await loadedIds(pages.keyboard)))[0];
  if (declared === undefined) throw new Error('键盘面板的组件没有在清单里写服务，找不到用来对照的名字');
  const own = await pages.keyboard.run(tryRelay, declared);
  if (own.use !== null || own.call !== null) throw new Error(`键盘面板用不了组件声明了的 ${declared}：${own.use ?? own.call ?? ''}`);
  const other = await pages.keyboard.run(tryRelay, UNDECLARED_REMOTE);
  if (other.use === null || other.call === null) throw new Error(`键盘面板${other.use === null ? '订阅' : '调用'}没声明的 ${UNDECLARED_REMOTE} 没有被拒绝`);
  const win = await pages.window.run(tryRelay, declared);
  if (win.use === null || win.call === null) throw new Error(`主窗口${win.use === null ? '订阅' : '调用'} ${declared} 没有被拒绝`);
  return `键盘面板能用 ${declared}，${UNDECLARED_REMOTE} 被拒绝；主窗口用 ${declared} 被拒绝(${win.use})`;
}

// 键盘面板查到的麦克风权限是拒绝，申请打开也打不开
async function deniedMicrophone(kb: Page): Promise<string> {
  const { state, error } = await kb.run(tryMicrophone);
  if (error === null) throw new Error('麦克风打开了');
  if (state !== 'denied') throw new Error(`查到的权限状态是 ${state}`);
  return `权限状态 ${state}，打开时 ${error}`;
}

// 面板页面(键盘、时钟)联不了网：直接取本机上临时开的一个 HTTP 服务取不到；把自己组件包里的一个网页嵌进来
// (那个网页会去取同一个服务、开 WebSocket)，网页里的脚本没跑起来。那个服务一个请求都没收到
async function noNetwork(pages: Pages): Promise<string> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    res.end('ok');
  });
  server.on('upgrade', (req, socket) => {
    hits.push(`upgrade ${req.url ?? ''}`);
    socket.destroy();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    const port = isObject(address) ? address['port'] : null;
    if (typeof port !== 'number') throw new Error('本机的 HTTP 服务没开起来');
    // 对照：这个服务从脚本这边取得到
    await fetch(`http://127.0.0.1:${port}/control`);
    if (hits.join() !== '/control') throw new Error('本机的 HTTP 服务没收到对照的请求');
    hits.length = 0;
    for (const page of [pages.keyboard, clockPage(pages)]) {
      if (await page.run(tryFetch, `http://127.0.0.1:${port}/direct`) === null) throw new Error(`${page.name}直接取到了外面的地址`);
      const said = await page.run(embedFrame, `fox://component/${CLOCK_ID}/${FRAME_FILE}?port=${port}`, FRAME_MS);
      if (said.length) throw new Error(`${page.name}里嵌的网页跑起来了：${said.join('、')}`);
    }
    if (hits.length) throw new Error(`本机的 HTTP 服务收到了 ${hits.join('、')}`);
    return `键盘面板和时钟面板直接取 http://127.0.0.1:${port} 被拦，嵌进来的 ${FRAME_FILE} 没跑起来，服务没收到请求`;
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
}

// 页面把地址改到外站：页面地址不变
async function blockedNavigation(app: Running, page: Page): Promise<string> {
  const before = await until(app, `${page.name}的地址`, STEP_MS, () => page.run(currentUrl));
  await page.run(navigate, OUTSIDE_URL).catch(() => undefined);
  await sleep(NAV_MS);
  const after = await until(app, `${page.name}的地址`, STEP_MS, () => page.run(currentUrl));
  if (after !== before) throw new Error(`页面地址变成了 ${after}`);
  return `地址还是 ${after}`;
}

// 跑一步并打印结果：describe 把 run 的返回值写成补充说明(可以带几行附注)；run 抛出异常算失败，返回 undefined
type RunStep = <T>(name: string, run: () => T | Promise<T>, describe?: (value: T) => string | { detail: string; notes: string[] }) => Promise<T | undefined>;

// 一次启动的收尾：关掉调试连接、结束程序、删掉临时文件夹，只做一次；程序没退出或文件夹没删掉算收尾失败。
// 有步骤失败且程序中途退出或页面没接上时，打印程序最后的输出
async function finishRun(step: RunStep, name: string, app: Running, pages: () => readonly Page[], attached: () => boolean, failed: () => boolean): Promise<void> {
  const early = app.gone;
  const bad = failed();
  await step(name, async () => {
    for (const p of pages()) p.close();
    await stop(app);
    fs.rmSync(app.dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    if (app.child.exitCode === null && app.child.signalCode === null) throw new Error(`进程 ${app.child.pid ?? '?'} 没有退出`);
    if (fs.existsSync(app.dir)) throw new Error(`${app.dir} 没删掉`);
  });
  if (bad && (early !== null || !attached())) {
    for (const line of ['程序最后的输出：', ...app.tail.map(l => `      ${l}`)]) console.log(line);
  }
}

// 中断(Ctrl+C)时结束这次启动的程序、删掉临时文件夹再退出；返回取消这个安排的函数
function stopOnInterrupt(app: Running): () => void {
  const handler = (): void => {
    void stop(app).catch(() => undefined).finally(() => {
      fs.rmSync(app.dir, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
      process.exit(130);
    });
  };
  process.once('SIGINT', handler);
  return () => { process.removeListener('SIGINT', handler); };
}

// 窗口方式的一次启动：开发用的显示方把面板开成普通窗口，在里面打字、开关组件、查边界
async function windowRun(step: RunStep, failed: () => boolean, options: Options): Promise<void> {
  const app = await step('启动程序', () => start(windowMode), a => `数据文件夹 ${a.dir}`);
  if (!app) return;
  // 程序还在跑时的一步；程序已经退出就直接算失败
  const live: RunStep = (name, run, describe) => step(name, () => {
    if (app.gone !== null) throw new Error(app.gone);
    return run();
  }, describe);
  let pages: Pages | undefined;
  const forget = stopOnInterrupt(app);
  try {
    pages = await live('接上主窗口、键盘面板、媒体页面', () => attachPages(app), () => `调试端口 ${app.port}`);
    if (pages) {
      const { window: win, keyboard: kb, all } = pages;
      const both = pages;
      await live('输入法部署期间键盘面板上盖着部署提示，提示上的字跟界面语言', () => veilFollows(app, both), d => d);
      await live('输入法部署完，键盘面板画出键区', () => keyboardReady(app, kb), d => d);
      await live('键盘面板打字选词', () => typeWord(app, kb), d => d);
      await live('换界面语言，键盘面板的文字和键盘状态跟着换', () => languageFollows(app, both), d => d);
      await live('按日夜切换按钮，键盘面板的深色跟着换', () => themeToggles(app, both), d => d);
      await live('关掉语言组件后键盘的语言列表少一项，再打开后恢复', () => langOffAndOn(app, both), d => d);
      await live('关掉输入法组件后部件撤掉、外壳里显示缺件提示，再打开后恢复', () => imeOffAndOn(app, both), d => d);
      await live('打开时钟示例的组件，时钟面板有自己的窗口，键盘面板没有重载', () => clockOpens(app, both), d => d);
      await live('两块面板和主窗口各有自己的源，localStorage 互不相通', () => storesApart(both), d => d);
      await live('改键盘侧栏页的设置只有键盘面板重载，改时钟的设置只有时钟面板重载', () => settingReloads(app, both), d => d);
      await live('开发文件夹里的文件保存后，只有用到它的键盘面板重载', () => devSaveReloads(app, both), d => d);
      await live('点时钟面板上的收起按钮，显示方隐藏它的窗口，键盘面板不受影响', () => clockHides(app, both), d => d);
      await live('关掉时钟的组件只有它的窗口消失，键盘面板没有重载，再打开后回来', () => clockOffAndOn(app, both), d => d);
      await live('经远程服务 panels 开关、收起和恢复、改宽度、改附着和抬手才显示、锁、到面前、顶到上限，状态和窗口同步变化；能滚动的区域按住拖动就滚', () => panelsRound(app, both), d => d);
      await live('面板页面跳不到外站，开不了新窗口', () => panelsConfined(app, both), d => d);
      await live('主窗口各页都能点开', () => visitPages(app, win), d => d);
      await live('各页面没有报错', () => {
        const errors = pageErrors(all);
        if (errors.length) throw new Error(errors.join('；'));
      });
      await live('运行日志里没有 error 级的行', async () => {
        const { errors, warns } = logProblems(await win.run(() => window.fox.logList()));
        if (errors.length) throw new Error(errors.join('；'));
        return warns;
      }, warns => ({ detail: warns.length ? `有 ${warns.length} 行 warn` : '', notes: warns.map(w => `warn  ${w}`) }));
      if (options.boundary) {
        await live('边界：面板页面和媒体页面的 window.fox 上没有组件管理、应用设置、更新、目录、市场的接口', () => narrowApi(both), d => d);
        await live('边界：开发用的显示方不出现在组件列表里', () => hiddenDisplay(both), d => d);
        await live('边界：键盘面板读写不了别的组件的数据', () => foreignData(both), d => d);
        await live('边界：时钟面板和键盘面板读写不了对方组件的数据', () => panelsDataApart(both), d => d);
        await live('边界：键盘面板卸载不了组件', () => refusedRemove(both, 'yanuo.keys'), d => d);
        await live('边界：键盘面板只能开关输出组件', () => outputToggleOnly(app, both), d => d);
        await live('边界：键盘面板只能往自己组件的总线频道发，只收到登记了的自己组件的频道', () => busBoundary(app, both), d => d);
        await live('边界：键盘面板只能用组件声明了的远程服务，主窗口用不了', () => relayBoundary(both), d => d);
        await live('边界：时钟面板够不着它没声明的远程服务 keyboard', () => clockNoRemotes(both), d => d);
        await live('边界：没有声明 panels 的面板调不了它，声明了的才行', () => panelsDeclaredOnly(app, both), d => d);
        await live('边界：键盘面板开不了麦克风', () => deniedMicrophone(kb), d => d);
        await live('边界：面板页面联不了网，嵌不了自己组件包里的网页', () => noNetwork(both), d => d);
        await live('边界：主窗口跳不到外站', () => blockedNavigation(app, win), d => d);
      }
    }
  } finally {
    await finishRun(step, '结束程序，删掉临时文件夹', app, () => pages?.all ?? [], () => pages !== undefined, failed);
    forget();
  }
}

// 一个组件的清单里写的面板纹理像素(页面宽高 × 纹理倍数)；dir 是组件的文件夹
function panelTexture(dir: string): { width: number; height: number } {
  const manifest: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8'));
  const panel = isObject(manifest) ? manifest['panel'] : null;
  const { width, height, scale = 1 } = isObject(panel) ? panel : {};
  if (typeof width !== 'number' || typeof height !== 'number' || typeof scale !== 'number') throw new Error(`${dir} 的清单里没有面板的宽高`);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// 离屏方式的一次启动：SteamVR 组件跑模拟脚本(不连 SteamVR)，是生效的显示方；键盘面板、时钟面板和手腕时钟离屏渲染，每一帧经句柄复制交给它
async function framesRun(step: RunStep, failed: () => boolean, options: Options): Promise<void> {
  const app = await step('离屏方式：带模拟脚本启动程序，SteamVR 组件当显示方，时钟和手腕时钟两个示例开着', () => start(framesMode, options.exe), a => `${options.exe ? `程序 ${options.exe}，` : ''}数据文件夹 ${a.dir}`);
  if (!app) return;
  const live: RunStep = (name, run, describe) => step(name, () => {
    if (app.gone !== null) throw new Error(app.gone);
    return run();
  }, describe);
  const all: Page[] = [];
  let attached = false;
  const forget = stopOnInterrupt(app);
  try {
    const pages = await live('离屏方式：接上主窗口和离屏的键盘面板、时钟面板、手腕时钟面板', async () => {
      const port = await until(app, '程序报出调试端口', PORT_MS, () => app.port);
      const wanted = [WINDOW_URL, KEYBOARD_URL, CLOCK_URL, WRIST_URL];
      const targets = await until(app, '主窗口和三块面板的页面', PAGES_MS, () => listTargets(port), list => wanted.every(url => list.some(t => t.url === url)));
      for (const url of wanted) {
        const target = targets.find(t => t.url === url);
        if (target) all.push(await Page.attach(target));
      }
      const [win, kb, clock, wrist] = all;
      if (!win || !kb || !clock || !wrist) throw new Error('页面没接上');
      for (const page of [kb, clock, wrist]) {
        await page.run(watchMouse);
        const shown = await page.run(previewed);
        if (shown.plan || shown.marked) throw new Error(`离屏的${page.name}被当成了显示在普通窗口里`);
      }
      await clock.run(addWheelBox);
      attached = true;
      return { win, kb, clock, wrist };
    }, () => `调试端口 ${app.port}`);
    if (pages) {
      const { win, kb, clock, wrist } = pages;
      const worn = { device: SIM_LEFT_DEVICE, raised: SIM_WRIST_MS, aimed: SIM_WRIST_AIM_MS, lowered: SIM_WRIST_DOWN_MS };
      const wants: (SimWant & { page: Page })[] = [
        { id: KEYBOARD_PANEL, page: kb, ...panelTexture(path.join(ROOT, 'components', 'shell-classic')) },
        { id: CLOCK_ID, page: clock, ...panelTexture(path.join(ROOT, 'examples', 'panel-clock')) },
        { id: WRIST_ID, page: wrist, ...panelTexture(path.join(ROOT, 'examples', 'panel-wrist')), worn },
      ];
      await live('离屏方式：三块面板的帧各贴进自己的纹理，分别指着正中扣扳机，各自的页面收到按下和松开；抓住时钟挪到一边；滚轮往下滚；手腕时钟相对左手放，抬手才显示，左手的射线点不到它', async () => {
        const file = simResult(app.dir);
        await until(app, '模拟脚本跑完', SIM_WAIT_MS, () => fs.existsSync(file));
        const record: unknown = await until(app, '模拟脚本的记录写完', STEP_MS, () => JSON.parse(fs.readFileSync(file, 'utf8')) as unknown, isObject);
        const problems = simProblems(record, wants);
        if (problems.length) throw new Error(problems.join('；'));
        const notes: string[] = [];
        for (const want of wants) {
          const image = simPanel(record, want.id)?.['image'];
          const picture = pngAlpha(fs.readFileSync(typeof image === 'string' ? image : ''));
          if (Math.abs(picture.width - want.width) > FRAME_SLACK || Math.abs(picture.height - want.height) > FRAME_SLACK) throw new Error(`${want.id} 读回的画面是 ${picture.width}×${picture.height}`);
          // 键盘面板铺满整页：读回的画面里大半像素不是透明的；时钟面板、手腕时钟画着东西就行
          const enough = want.id === KEYBOARD_PANEL ? picture.width * picture.height / 2 : 0;
          if (picture.opaque <= enough) throw new Error(`${want.id} 读回的画面 ${picture.width}×${picture.height} 里只有 ${picture.opaque} 个像素不透明`);
          const seen = await until(app, `${want.page.name}收到按下和松开`, STEP_MS, () => want.page.run(mouseSeen), list => clickedCenter(list, want.width, want.height));
          if (seen.filter(line => line.startsWith('mousedown')).length !== 1) throw new Error(`${want.page.name}收到的按下不是一次：${seen.join('、')}`);
          notes.push(`${want.id}：纹理和画面 ${picture.width}×${picture.height}，${picture.opaque} 个像素不透明；页面收到 ${seen.join('、')}`);
        }
        const shows = simShows(simPanel(record, WRIST_ID) ?? {});
        notes.push(`手腕时钟的悬浮窗口相对 ${SIM_LEFT_DEVICE} 号设备(左手)放：${shows.join('、')}(${SIM_WRIST_MS} 毫秒抬手，${SIM_WRIST_DOWN_MS} 毫秒放下)；${SIM_WRIST_AIM_MS} 毫秒右手指上来之前没有指点事件`);
        const offset = simOffset(record, CLOCK_ID, KEYBOARD_PANEL);
        if (offset === null || Math.abs(offset - SIM_MOVE) > SIM_MOVE_SLACK) throw new Error(`时钟面板比键盘面板偏右 ${String(offset)} 米，该是 ${SIM_MOVE} 米左右`);
        notes.push(`时钟面板被抓着挪到键盘面板右边 ${offset.toFixed(3)} 米`);
        // 滚轮：指点事件里 dy 为正，页面里的内容往下滚
        const wheels = simWheels(record, CLOCK_ID);
        if (wheels.join() !== String(SIM_WHEEL)) throw new Error(`发给时钟面板的滚轮不是一次 dy ${SIM_WHEEL}：${wheels.join('、') || '没有'}`);
        const top = await until(app, '时钟页面里的内容往下滚', STEP_MS, () => clock.run(wheelTop), v => v > 0);
        notes.push(`往时钟面板发 dy ${SIM_WHEEL} 的滚轮，页面里的内容往下滚了 ${top} 像素`);
        return notes;
      }, notes => ({ detail: '', notes }));
      await live('离屏方式：各页面没有报错，运行日志里没有 error，也没有面板页面的警告', async () => {
        const errors = pageErrors(all);
        if (errors.length) throw new Error(errors.join('；'));
        const lines = await win.run(() => window.fox.logList());
        const problems = logProblems(lines);
        if (problems.errors.length) throw new Error(problems.errors.join('；'));
        const about = problems.warns.filter(w => /panel|frame|vr sim|hit check/i.test(w));
        if (about.length) throw new Error(about.join('；'));
        if (!lines.some(l => l.text.startsWith('vr sim finished'))) throw new Error('运行日志里没有模拟脚本跑完的那一行');
        return problems.warns;
      }, warns => ({ detail: warns.length ? `有 ${warns.length} 行 warn` : '', notes: warns.map(w => `warn  ${w}`) }));
    }
  } finally {
    await finishRun(step, '离屏方式：结束程序，删掉临时文件夹', app, () => all, () => attached, failed);
    forget();
  }
}

// 跑全部步骤，返回退出码
async function main(argv: readonly string[]): Promise<number> {
  let options: Options;
  try {
    options = parseArgs(argv);
  } catch (e) {
    console.error(errorText(e));
    console.error(USAGE);
    return 2;
  }
  const steps: Step[] = [];
  const step: RunStep = async <T>(name: string, run: () => T | Promise<T>, describe: (value: T) => string | { detail: string; notes: string[] } = () => ''): Promise<T | undefined> => {
    let result: Step;
    let value: T | undefined;
    try {
      value = await run();
      const d = describe(value);
      result = typeof d === 'string' ? { name, ok: true, detail: d, notes: [] } : { name, ok: true, ...d };
    } catch (e) {
      value = undefined;
      result = { name, ok: false, detail: errorText(e), notes: [] };
    }
    steps.push(result);
    for (const line of stepLines(result)) console.log(line);
    return value;
  };
  const failed = (): boolean => steps.some(s => !s.ok);
  if (!options.exe) await windowRun(step, failed, options);
  await framesRun(step, failed, options);
  const { line, code } = summary(steps);
  console.log(line);
  return code;
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) process.exitCode = await main(process.argv.slice(2));

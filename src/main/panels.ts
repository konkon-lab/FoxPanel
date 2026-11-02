// 面板页面：核心按面板 id 持有页面(一块面板一页)，显示方组件所在的进程来开。离屏方式下每一帧把 GPU 共享纹理的 NT 句柄
// 复制进收帧的进程交给它，它用完放掉(pnRelease)后核心才放掉这一帧；窗口方式下页面是一个普通窗口。
// 收帧的进程退出或显示方停用时页面停画并保留一段时间，期间再来开的接回原页面。
// 建窗口、复制句柄、计时都是注入项，这里不导入 electron。

import { PANEL_MODES, type PanelInput, type PanelMode, type PanelPageState, type PanelRequest, type ToProcess } from '../shared/host-protocol.ts';
import type { Text } from '../shared/manifest.ts';
import { PAGE_IPC, type Log, type PanelInfo, type PanelPlan } from '../shared/types.ts';
import { errorText, isObject } from '../shared/util.ts';

export const HELD_MAX = 4;             // 核心替一页最多压着几帧(超过时放掉最早的并通知收帧方，免得页面没有纹理可画)
export const LINGER_MS = 120_000;      // 收帧方没了之后页面保留这么久(毫秒)
export const PANEL_PAGES_MAX = 12;     // 同时存在的面板页面数上限
const SIZE_SLACK = 4;                  // 系统把离屏窗口改到和登记的尺寸差多少像素以内不算被改
const WARN_MS = 10_000;                // 同样内容的警告日志最少隔这么久写一行(毫秒)
const FIT_TRIES = 2;                   // 一页的离屏窗口为了让画面对上登记的尺寸，最多改这么多次大小

// 页面画出的一帧(GPU 共享纹理)里用到的部分
export interface SharedFrame {
  release(): void;
  textureInfo: {
    widgetType: string;                           // 'frame' = 页面本身的那一层
    codedSize: { width: number; height: number }; // 纹理的宽高(像素)
    handle: { ntHandle?: Buffer };                // 纹理的 NT 句柄(8 字节，小端)
  };
}

// 发给页面的鼠标事件(坐标是页面像素)
export type PageInputEvent =
  | { type: 'mouseMove'; x: number; y: number; modifiers: 'leftbuttondown'[] }
  | { type: 'mouseDown' | 'mouseUp'; x: number; y: number; button: 'left'; clickCount: 1 }
  | { type: 'mouseWheel'; x: number; y: number; deltaX: number; deltaY: number }
  | { type: 'mouseLeave'; x: number; y: number };

// 要建的一个面板窗口：页面宽高(CSS 像素)、纹理倍数(窗口方式下是 1)、出不出声
export interface PanelWindowSpec {
  id: string;        // 面板 id
  name: Text;        // 面板的名字(窗口方式下作窗口标题)
  mode: PanelMode;
  width: number;
  height: number;
  scale: number;
  sound: boolean;
}

// 面板窗口发生的事
export interface PageEvents {
  paint(frame: SharedFrame | undefined): void;   // 离屏页面画出一帧
  resized(): void;                               // 窗口的大小变了
  loaded(): void;                                // 页面加载完了
  failed(detail: string): void;                  // 页面加载失败，或它的渲染进程退出了
  restarted(): void;                             // 页面开始加载新的文档(重新加载)
  closed(): void;                                // 窗口没了(不是经 destroy 关的)
}

// 面板窗口里用到的部分
export interface PageWindow {
  readonly id: number;                           // webContents 的 id
  loadURL(url: string): void;
  reload(): void;
  destroy(): void;
  show(): void;
  hide(): void;
  setContentSize(width: number, height: number): void;
  getContentSize(): number[];
  sendInputEvent(e: PageInputEvent): void;
  startPainting(): void;
  stopPainting(): void;
  invalidate(): void;                            // 让离屏页面重画一帧
  setFrameRate(fps: number): void;
  setBackgroundThrottling(on: boolean): void;
  send(channel: string, ...args: unknown[]): void;   // 发给页面的 IPC
}

// 组件进程里用到的部分
export interface PanelHost {
  readonly pid: number | undefined;   // 进程没在跑时 undefined
  post(m: ToProcess): void;
  runs(id: string): boolean;          // 这个进程里有这个组件
}

// 面板目录的一项和它的页面要加载的东西
export interface PanelSpec {
  info: PanelInfo;
  plan: PanelPlan;
}

export interface PanelPagesDeps {
  display(): string | undefined;                                        // 当前生效的显示方：远程服务 panels 的提供者里组件顺序最前的开着的那个
  createWindow(spec: PanelWindowSpec, events: PageEvents): PageWindow;  // 建窗口(不加载地址)；建不了时抛出异常
  adopt(page: number, plan: PanelPlan): void;                           // 窗口建好(加载地址之前)或它的计划变了：登记这一页是哪块面板、能用哪些组件 id 和远程服务；抛出异常时这一页不开
  dropped(page: number): void;                                          // 这一页的窗口没了
  restarted(page: number): void;                                        // 这一页开始重新加载
  openProcess(pid: number): bigint | null;                              // 打开一个能往里复制句柄的进程句柄；打不开返回 null
  duplicate(process: bigint, handle: bigint): bigint | null;            // 把本进程的句柄复制进那个进程，返回那边的句柄值；失败返回 null
  closeHandle(handle: bigint): void;
  setTimer(fn: () => void, ms: number): () => void;                     // 过 ms 毫秒调 fn；返回取消函数
  listed(list: readonly PanelInfo[]): void;                             // 面板目录变了
  failed(): void;                                                       // 出错的页面(errors)变了
  log: Log;
  now?(): number;   // 当前时间(毫秒)，警告的限频用；不给时用系统时钟
}

// 收帧方：开这一页的组件和它所在的进程
interface Receiver {
  host: PanelHost;
  component: string;
}

interface Page {
  id: string;
  token: object;                       // 这一次建的窗口(同一块面板重建窗口后，旧窗口的事件不算)
  win: PageWindow;
  mode: PanelMode;
  info: PanelInfo;
  plan: PanelPlan;
  sig: string;                         // 计划(JSON)：变了就重载这一页
  build: string;                       // 建窗口时定下的部分(见 buildOf)：变了要重建窗口
  scale: number;                       // 纹理像素 / 页面像素
  frames: Map<number, SharedFrame>;    // 交给收帧方、还没放掉的帧
  seq: number;
  receiver: Receiver | null;           // 没有 = 在保留期里
  painting: boolean;                   // 在画(窗口方式下 = 窗口显示着)
  state: PanelPageState;
  detail: string;                      // 出错的原因
  cancelLinger: (() => void) | null;   // 保留期的计时
  sizeWarned: boolean;                 // 被系统改大小的警告写过了
  trimW: number;                       // 离屏窗口比登记的页面尺寸少设多少像素(见 fit)
  trimH: number;
  fits: number;                        // 为了对上尺寸改过几次窗口大小
  fitSeen: string;                     // 上一次比对过的帧的像素(宽x高)
}

// 两个收帧方是不是同一个：同一个进程里的同一个组件
const sameReceiver = (a: Receiver, b: Receiver): boolean => a.host === b.host && a.component === b.component;

const isMode = (v: unknown): v is PanelMode => (PANEL_MODES as readonly unknown[]).includes(v);
const isCoord = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 建窗口时定下、之后改不了的部分：离屏窗口的纹理倍数、出不出声
const buildOf = (spec: PanelSpec, mode: PanelMode): string => `${mode === 'frames' ? spec.info.scale : 1} ${spec.plan.sound}`;

// 一块面板的页面加载的全部组件 id：根组件、各插槽的部件、服务
export function planIds(plan: PanelPlan): string[] {
  return [...new Set([plan.root, ...Object.values(plan.parts).flat(), ...plan.services].map(c => c.id))];
}

// 组件进程发来的指点事件(进程消息)收窄；格式不对时为 null
export function parseInput(raw: unknown): PanelInput | null {
  if (!isObject(raw)) return null;
  const { kind, x, y, dx, dy, held } = raw;
  if (kind === 'leave') return { kind };
  if (!isCoord(x) || !isCoord(y)) return null;
  if (kind === 'move') return { kind, x, y, held: held === true };
  if (kind === 'down' || kind === 'up') return { kind, x, y };
  return kind === 'wheel' && isCoord(dx) && isCoord(dy) ? { kind, x, y, dx, dy } : null;
}

// 指点事件 → 发给页面的鼠标事件；scale = 纹理像素 / 页面像素，坐标换成页面像素(取整)。
// 滚轮：页面收到的 deltaY 为正是往上滚，和指点事件的 dy 方向相反
export function toInputEvents(e: PanelInput, scale: number): PageInputEvent[] {
  if (e.kind === 'leave') return [{ type: 'mouseLeave', x: 0, y: 0 }];
  const x = Math.round(e.x / scale);
  const y = Math.round(e.y / scale);
  switch (e.kind) {
    case 'move': return [{ type: 'mouseMove', x, y, modifiers: e.held ? ['leftbuttondown'] : [] }];
    case 'down': return [{ type: 'mouseDown', x, y, button: 'left', clickCount: 1 }];
    case 'up': return [{ type: 'mouseUp', x, y, button: 'left', clickCount: 1 }];
    case 'wheel': return [{ type: 'mouseWheel', x, y, deltaX: -Math.round(e.dx), deltaY: -Math.round(e.dy) }];
  }
}

export class PanelPages {
  private readonly deps: PanelPagesDeps;
  private readonly pages = new Map<string, Page>();                                    // 面板 id → 它的页面
  private specs = new Map<string, PanelSpec>();                                        // 面板目录
  private listSig = '[]';                                                              // 上次通知出去的面板目录(JSON)
  private readonly procs = new Map<PanelHost, { pid: number; handle: bigint }>();      // 收帧的进程 → 它的进程句柄(复制句柄用)
  private readonly failures = new Map<string, string>();                               // 面板 id → 页面出错的原因
  private readonly warned = new Map<string, number>();                                 // 警告的内容 → 上次写它的时间

  constructor(deps: PanelPagesDeps) {
    this.deps = deps;
  }

  // 面板目录，按组件顺序
  get list(): PanelInfo[] {
    return [...this.specs.values()].map(s => s.info);
  }

  // 页面出错的面板：面板 id → 原因(组件页显示在这个组件上)
  get errors(): ReadonlyMap<string, string> {
    return this.failures;
  }

  // 一个页面(webContents 的 id)要加载的计划；不是面板页面时为 null
  planOf(page: number): PanelPlan | null {
    for (const p of this.pages.values()) if (p.win.id === page) return { ...p.plan, preview: p.mode === 'window' };
    return null;
  }

  // 给全部面板页面发一条 IPC
  sendAll(channel: string, ...args: unknown[]): void {
    for (const p of this.pages.values()) p.win.send(channel, ...args);
  }

  // 写一行警告；同样的内容 WARN_MS 内只写一次
  private warn(text: string, source = ''): void {
    const now = (this.deps.now ?? Date.now)();
    const key = `${source} ${text}`;
    const last = this.warned.get(key);
    if (last !== undefined && now - last < WARN_MS) return;
    this.warned.set(key, now);
    this.deps.log(text, 'warn', source);
  }

  // 显示方发来的消息。pnOpen 以外的只认这一页当前的收帧方(那个进程里的那个组件)发的
  message(m: PanelRequest, host: PanelHost): void {
    if (typeof m.id !== 'string') return;
    if (m.t === 'pnOpen') return this.open(host, m.component, m.id, m.mode);
    const page = this.pages.get(m.id);
    if (!page || page.receiver?.host !== host || page.receiver.component !== m.component) return;
    switch (m.t) {
      case 'pnClose': return m.linger === true ? this.detach(page) : this.destroy(page);
      case 'pnRelease':
        page.frames.get(m.seq)?.release();
        page.frames.delete(m.seq);
        return;
      case 'pnInput': {
        const e = parseInput(m.event);
        if (e) for (const event of toInputEvents(e, page.scale)) page.win.sendInputEvent(event);
        return;
      }
      case 'pnPaint': return this.paint(page, m.on === true);
      case 'pnFps':
        // 帧率不超过清单里写的上限
        if (page.mode === 'frames' && isCoord(m.fps)) page.win.setFrameRate(Math.min(page.info.fps, Math.max(1, Math.round(m.fps))));
        return;
    }
  }

  // 开一块面板的页面。发起的组件要是当前生效的显示方、在这个进程里，面板要在目录里，否则回 failed。
  // 页面已经在且显示方式相同时接过来(别的收帧方开着的，或在保留期里的)；显示方式不同或页面出过错时销毁重建
  private open(host: PanelHost, component: unknown, id: string, mode: unknown): void {
    const refuse = (detail: string): void => host.post({ t: 'pnState', component: typeof component === 'string' ? component : '', id, state: 'failed', detail });
    if (typeof component !== 'string' || !isMode(mode)) return refuse('bad request');
    if (component !== this.deps.display() || !host.runs(component)) {
      this.warn(`cannot open panel ${id}: only the active display component can open panel pages`, component);
      return refuse('not the active display');
    }
    const spec = this.specs.get(id);
    if (!spec) return refuse('no such panel');
    let page = this.pages.get(id);
    if (page && (page.mode !== mode || page.state === 'failed')) {
      const old = page.receiver;
      this.destroy(page);
      if (old && !sameReceiver(old, { host, component })) old.host.post({ t: 'pnState', component: old.component, id, state: 'gone', detail: 'taken over' });
      page = undefined;
    }
    if (!page) {
      if (this.pages.size >= PANEL_PAGES_MAX) {
        this.warn(`cannot open panel ${id}: ${PANEL_PAGES_MAX} panel pages are open already`, component);
        return refuse('too many panels');
      }
      page = this.create(spec, mode) ?? undefined;
      if (!page) return refuse('cannot open the page');
    }
    this.attach(page, { host, component });
  }

  // 建一块面板的窗口并加载面板宿主页；建不了或登记不了时写日志并返回 null
  private create(spec: PanelSpec, mode: PanelMode): Page | null {
    const { info, plan } = spec;
    const id = info.id;
    const token = {};
    const scale = mode === 'frames' ? info.scale : 1;
    // 这一次建的窗口对应的页面；页面已经销毁或换了窗口时为 undefined
    const mine = (): Page | undefined => {
      const p = this.pages.get(id);
      return p?.token === token ? p : undefined;
    };
    const run = (fn: (p: Page) => void) => (): void => {
      const p = mine();
      if (p) fn(p);
    };
    let win: PageWindow;
    try {
      win = this.deps.createWindow({ id, name: info.name, mode, width: info.width, height: info.height, scale, sound: plan.sound }, {
        paint: frame => {
          const p = mine();
          if (p) this.frame(p, frame);
          else frame?.release();
        },
        resized: run(p => this.keepSize(p)),
        loaded: run(p => {
          this.setState(p, 'ready');
          p.win.send(PAGE_IPC.visibleEvent, p.painting);
        }),
        failed: detail => {
          const p = mine();
          if (p) this.setState(p, 'failed', detail);
        },
        restarted: run(p => {
          this.deps.restarted(p.win.id);
          if (p.state === 'ready') this.setState(p, 'loading');
        }),
        closed: run(p => this.evict(p, 'closed', false)),
      });
    } catch (e) {
      this.deps.log(`panel page not opened: ${errorText(e)}`, 'error', id);
      return null;
    }
    try {
      this.deps.adopt(win.id, plan);
    } catch (e) {
      this.deps.log(`panel page not opened: ${errorText(e)}`, 'error', id);
      win.destroy();
      return null;
    }
    const page: Page = {
      id, token, win, mode, info, plan, sig: JSON.stringify(plan), build: buildOf(spec, mode), scale,
      frames: new Map(), seq: 0, receiver: null, painting: false, state: 'loading', detail: '', cancelLinger: null, sizeWarned: false,
      trimW: 0, trimH: 0, fits: 0, fitSeen: '',
    };
    this.pages.set(id, page);
    // 窗口建好时内容区会和要的差出来(比桌面大的被系统夹小；屏幕缩放不是整数倍时普通窗口差一两个像素，可能比页面小)：
    // 加载之前按页面尺寸再设一次
    win.setContentSize(info.width, info.height);
    if (mode === 'frames') win.setFrameRate(info.fps);
    win.loadURL(`fox://${id}.panel/panel.html`);
    return page;
  }

  // 把收帧方换成 receiver：放掉交给前一个的帧，前一个不是它时告诉前一个页面被接走了；把大小和状态告诉新的，开始画并重画一帧
  private attach(page: Page, receiver: Receiver): void {
    const old = page.receiver;
    this.releaseFrames(page);
    if (old && !sameReceiver(old, receiver)) old.host.post({ t: 'pnState', component: old.component, id: page.id, state: 'gone', detail: 'taken over' });
    page.cancelLinger?.();
    page.cancelLinger = null;
    page.receiver = receiver;
    this.postSize(page);
    this.postState(page);
    this.paint(page, true, true);
  }

  private postSize(page: Page): void {
    const { width, height } = page.info;
    const to = page.receiver;
    to?.host.post({ t: 'pnSize', component: to.component, id: page.id, width: Math.round(width * page.scale), height: Math.round(height * page.scale) });
  }

  private postState(page: Page): void {
    const to = page.receiver;
    to?.host.post({ t: 'pnState', component: to.component, id: page.id, state: page.state, ...(page.detail ? { detail: page.detail } : {}) });
  }

  // 页面的状态变了：告诉收帧方；出错的记下原因并写日志，加载好了的清掉
  private setState(page: Page, state: PanelPageState, detail = ''): void {
    if (page.state === state && page.detail === detail) return;
    page.state = state;
    page.detail = detail;
    this.postState(page);
    if (state === 'failed') {
      this.deps.log(`panel page failed: ${detail}`, 'error', page.id);
      this.setError(page.id, detail || 'panel page failed');
    } else if (state === 'ready') this.setError(page.id, null);
  }

  // 记下或清掉一块面板的页面错误
  private setError(id: string, error: string | null): void {
    if ((this.failures.get(id) ?? null) === error) return;
    if (error === null) this.failures.delete(id);
    else this.failures.set(id, error);
    this.deps.failed();
  }

  private releaseFrames(page: Page): void {
    for (const f of page.frames.values()) f.release();
    page.frames.clear();
  }

  // 停画 / 恢复：离屏页面停画时放开后台节流，恢复时重画一帧；窗口方式下是隐藏 / 显示窗口。页面自己也得到通知。
  // again = 已经是这个状态也照做(换了收帧方)
  private paint(page: Page, on: boolean, again = false): void {
    if (page.painting === on && !again) return;
    page.painting = on;
    const win = page.win;
    if (page.mode === 'window') {
      if (on) win.show();
      else win.hide();
    } else if (on) {
      win.setBackgroundThrottling(false);
      win.startPainting();
      win.invalidate();
    } else {
      win.stopPainting();
      win.setBackgroundThrottling(true);
    }
    win.send(PAGE_IPC.visibleEvent, on);
  }

  // 收帧的进程的进程句柄：每个进程只打开一次，进程换了(重启)时重新打开；打不开时为 null
  private processOf(host: PanelHost): bigint | null {
    const pid = host.pid;
    const had = this.procs.get(host);
    if (had && had.pid === pid) return had.handle;
    if (had) {
      this.procs.delete(host);
      this.deps.closeHandle(had.handle);
    }
    if (!pid) return null;
    const handle = this.deps.openProcess(pid);
    if (handle !== null) this.procs.set(host, { pid, handle });
    return handle;
  }

  // 新的一帧：有收帧方且在画时把句柄复制进它的进程交过去，压着的帧超过 HELD_MAX 时放掉最早的并通知它；
  // 别的层的帧(原生弹出层)、复制不了的帧直接放掉
  private frame(page: Page, frame: SharedFrame | undefined): void {
    if (!frame) return;
    if (frame.textureInfo.widgetType === 'frame') this.fit(page, frame.textureInfo.codedSize);
    const nt = frame.textureInfo.handle.ntHandle;
    const receiver = page.receiver;
    if (!receiver || !page.painting || !nt || frame.textureInfo.widgetType !== 'frame') return frame.release();
    let handle: bigint | null = null;
    try {
      const proc = this.processOf(receiver.host);
      if (proc !== null) handle = this.deps.duplicate(proc, nt.readBigUInt64LE(0));
    } catch (e) {
      this.warn(`panel frame: ${errorText(e)}`, page.id);
    }
    if (handle === null) return frame.release();
    const seq = ++page.seq;
    page.frames.set(seq, frame);
    for (const [old, f] of page.frames) {
      if (page.frames.size <= HELD_MAX) break;
      f.release();
      page.frames.delete(old);
      receiver.host.post({ t: 'pnDrop', component: receiver.component, id: page.id, seq: old });
    }
    const { width, height } = frame.textureInfo.codedSize;
    receiver.host.post({ t: 'pnFrame', component: receiver.component, id: page.id, seq, handle: handle.toString(), width, height });
  }

  // 离屏页面画出的大小(帧的像素 ÷ 纹理倍数)比登记的页面尺寸多或少几个像素时，把窗口设小或设大这么多，让画出的正好是登记的尺寸。
  // 屏幕缩放不是整数倍时会差出来：窗口的大小按屏幕像素取整，换回页面像素时又往上取整。
  // 同一个大小的帧只比对一次，一页最多改 FIT_TRIES 次；差得多的(窗口被系统夹小了)不归这里
  private fit(page: Page, coded: { width: number; height: number }): void {
    if (page.mode !== 'frames') return;
    const seen = `${coded.width}x${coded.height}`;
    if (seen === page.fitSeen) return;
    page.fitSeen = seen;
    const overW = Math.round(coded.width / page.scale) - page.info.width;
    const overH = Math.round(coded.height / page.scale) - page.info.height;
    if ((!overW && !overH) || Math.abs(overW) > SIZE_SLACK || Math.abs(overH) > SIZE_SLACK || page.fits >= FIT_TRIES) return;
    page.fits++;
    page.trimW += overW;
    page.trimH += overH;
    page.win.setContentSize(page.info.width - page.trimW, page.info.height - page.trimH);
  }

  // 离屏窗口被系统改了大小(多屏缩放比例不同时)：改回登记的尺寸；同一页的警告只写一次
  private keepSize(page: Page): void {
    if (page.mode !== 'frames') return;
    const [w = 0, h = 0] = page.win.getContentSize();
    const { width, height } = page.info;
    if (Math.abs(w - width) <= SIZE_SLACK && Math.abs(h - height) <= SIZE_SLACK) return;
    page.win.setContentSize(width - page.trimW, height - page.trimH);
    if (page.sizeWarned) return;
    page.sizeWarned = true;
    this.deps.log(`panel page was resized to ${w}×${h} by the system, restored to ${width}×${height}`, 'warn', page.id);
  }

  // 收帧方放开这一页(它的进程退出了，或显示方停用了)：放掉帧、停画，页面保留 LINGER_MS，到期没人接就销毁
  private detach(page: Page): void {
    this.releaseFrames(page);
    page.receiver = null;
    this.paint(page, false);
    page.cancelLinger?.();
    page.cancelLinger = this.deps.setTimer(() => {
      page.cancelLinger = null;
      if (this.pages.get(page.id) === page && !page.receiver) this.destroy(page);
    }, LINGER_MS);
  }

  // 页面不要了：放掉帧，从表里拿掉，注销；destroy 为 true 时销毁窗口(窗口已经没了的不用)
  private remove(page: Page, destroy: boolean): void {
    this.releaseFrames(page);
    page.cancelLinger?.();
    page.cancelLinger = null;
    this.pages.delete(page.id);
    this.setError(page.id, null);
    try {
      this.deps.dropped(page.win.id);
    } catch (e) {
      this.deps.log(`panel page closed: ${errorText(e)}`, 'warn', page.id);
    }
    if (destroy) page.win.destroy();
  }

  // 销毁一个页面
  private destroy(page: Page): void {
    this.remove(page, true);
  }

  // 页面没了而收帧方没有要求关：拿掉页面并告诉收帧方(gone，detail 是原因)
  private evict(page: Page, detail: string, destroy = true): void {
    const receiver = page.receiver;
    this.remove(page, destroy);
    receiver?.host.post({ t: 'pnState', component: receiver.component, id: page.id, state: 'gone', detail });
  }

  // 一个组件进程停了或退出了：它收帧的页面进保留期，关掉它的进程句柄
  hostGone(host: PanelHost): void {
    for (const page of [...this.pages.values()]) if (page.receiver?.host === host) this.detach(page);
    const proc = this.procs.get(host);
    if (!proc) return;
    this.procs.delete(host);
    this.deps.closeHandle(proc.handle);
  }

  // 重建一页的窗口(建窗口时定下的部分变了)：收帧方和画不画照旧。在保留期里的页面(没有收帧方)只销毁，再来开时按新的建
  private rebuild(page: Page, spec: PanelSpec): void {
    const { receiver, painting, mode } = page;
    this.destroy(page);
    if (!receiver) return;
    const next = this.create(spec, mode);
    if (!next) return void receiver.host.post({ t: 'pnState', component: receiver.component, id: page.id, state: 'failed', detail: 'cannot open the page' });
    this.attach(next, receiver);
    if (!painting) this.paint(next, false);
  }

  // 组件变了：面板不在目录里的页面销毁并通知收帧方；计划变了的只重载那一页；页面尺寸变了的改窗口大小并告诉收帧方；
  // 纹理倍数或出不出声变了的重建窗口。面板目录变了时通知出去
  sync(list: readonly PanelSpec[]): void {
    this.specs = new Map(list.map(s => [s.info.id, s]));
    for (const page of [...this.pages.values()]) {
      const spec = this.specs.get(page.id);
      if (!spec) {
        this.evict(page, 'removed');
        continue;
      }
      if (buildOf(spec, page.mode) !== page.build) {
        this.rebuild(page, spec);
        continue;
      }
      const old = page.info;
      page.info = spec.info;
      if (old.width !== spec.info.width || old.height !== spec.info.height) {
        Object.assign(page, { trimW: 0, trimH: 0, fits: 0, fitSeen: '' });
        page.win.setContentSize(spec.info.width, spec.info.height);
        this.postSize(page);
      }
      if (old.fps !== spec.info.fps && page.mode === 'frames') page.win.setFrameRate(spec.info.fps);
      const sig = JSON.stringify(spec.plan);
      if (sig === page.sig) continue;
      page.sig = sig;
      page.plan = spec.plan;
      this.deps.adopt(page.win.id, spec.plan);
      this.setState(page, 'loading');
      page.win.reload();
    }
    const sig = JSON.stringify(this.list);
    if (sig === this.listSig) return;
    this.listSig = sig;
    this.deps.listed(this.list);
  }

  // 退出：销毁全部页面，关掉进程句柄
  stop(): void {
    for (const page of [...this.pages.values()]) this.destroy(page);
    for (const proc of this.procs.values()) this.deps.closeHandle(proc.handle);
    this.procs.clear();
  }
}

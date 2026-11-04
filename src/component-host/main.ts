// 组件进程(utilityProcess)：全部主进程组件跑在这里，Cordis 根上下文 + 宿主服务；和宿主之间用 parentPort 传消息。
// 组件列表变了时只卸载、加载、重载变了的组件(设置或入口文件变了算变)，别的组件不动。

import { Context, type Fiber, type Plugin } from 'cordis';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import type {
  AppService, Input, InputService, LogEntry, LogsService, Output, OutputService, PanelFeed, PanelFrame, PanelsHostService,
  RelayService, Serving, StatusService, Translator, TranslatorService,
} from '@konkon-lab/foxpanel-sdk';
import { createBus, relayOver, storageOver, WAIT_LOG_MS, waitingFor, waitingText, type RemoteCore } from '../shared/component-services.ts';
import type { AppInfo, FromProcess, HostComponent, PanelPageState, ToProcess } from '../shared/host-protocol.ts';
import { LOG_KEEP, type Caller, type PanelInfo } from '../shared/types.ts';
import { errorText } from '../shared/util.ts';
import { handles } from './handles.ts';
import { Owned } from './owned.ts';

const port = process.parentPort;
const post = (m: FromProcess): void => port.postMessage(m);

let appInfo: AppInfo = { locale: 'zh-Hans', components: [], outputs: [], inputs: [], canDictate: false };   // 宿主推来的应用信息(load 消息到之前是空的)
const appListeners = new Set<{ id: string; fn: (info: AppInfo) => void }>();   // 应用信息变了要叫的回调，id 是登记它的组件
let panelList: readonly PanelInfo[] = [];   // 宿主推来的面板目录
const panelListeners = new Set<{ id: string; fn: (list: readonly PanelInfo[]) => void }>();   // 面板目录变了要叫的回调，id 是登记它的组件
let dataDir = '';
let appDir = '';
let order: string[] = [];                    // 组件列表里的 id，按组件顺序
const outputs = new Map<string, Output>();   // 组件 id → 注册的输出
const inputs = new Map<string, Input>();     // 组件 id → 注册的听写
let dictating: { id: string; input: Input } | null = null;   // 正在听写的输入源
let translator: { id: string; fn: Translator } | null = null;
const logLines: LogEntry[] = [];   // 宿主转来的日志行(最近 LOG_KEEP 行)，留着补发给新监听
const logListeners = new Set<(line: LogEntry) => void>();
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();   // 等宿主回复的请求
let nextReq = 0;

const root = new Context();

// 记一行出错日志：id 是出错的组件(空 = 宿主)，what 是当时在做的事
function logError(id: string, what: string, e: unknown): void {
  post({ t: 'log', id, text: `${what}: ${errorText(e)}`, level: 'error' });
}

// 调组件的代码：出错只记日志
function guard(id: string, what: string, fn: () => unknown): void {
  try {
    const r = fn();
    if (r instanceof Promise) r.catch((e: unknown) => logError(id, what, e));
  } catch (e) {
    logError(id, what, e);
  }
}

// 把注册的输出、听写(按组件顺序)、翻译告诉宿主
function announce(): void {
  post({
    t: 'outputs',
    outputs: [...outputs].map(([id, o]) => ({ id, live: o.live === true, typing: typeof o.typing === 'function' })),
    inputs: order.filter(id => inputs.has(id)),
    translator: translator !== null,
  });
}

// 发一条要宿主回复(reply)的消息
function ask(make: (req: number) => FromProcess): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const req = ++nextReq;
    pending.set(req, { resolve, reject });
    post(make(req));
  });
}

// 总线：本进程的组件之间直接送达，同时经宿主转给别的进程和页面
const bus = createBus(
  (channel, data) => post({ t: 'bus', channel, data }),
  (channel, e) => logError('', `bus ${channel}`, e),
);

// 组件里 import 这些模块(cordis、koffi 等)时指向宿主那份：组件装在数据文件夹里，找不到程序自带的 node_modules
function shareModules(shared: Record<string, string>): void {
  const hook = `const M = ${JSON.stringify(shared)}; export async function resolve(s, c, next) { return Object.hasOwn(M, s) ? { url: M[s], shortCircuit: true } : next(s, c); }`;
  register(`data:text/javascript,${encodeURIComponent(hook)}`);
}

// 以下是各组件自己的服务：id 是组件 id，owner 记下卸载时要放掉的东西

// 输出：登记自己；发送、「正在输入」、清除经宿主交给登记了输出的各进程
const outputFor = (id: string, owner: Owned): OutputService => ({
  register(o) {
    outputs.set(id, o);
    owner.add(() => { if (outputs.get(id) === o) outputs.delete(id); });
    announce();
  },
  send: (payload, live) => ask(req => ({ t: 'outSend', req, payload, live: live === true })) as Promise<string[]>,
  typing: on => post({ t: 'outTyping', on: on === true }),
  clear: () => post({ t: 'outClear' }),
});

// 听写：登记自己；开关听写经宿主交给组件顺序最前的输入源
const inputFor = (id: string, owner: Owned): InputService => ({
  register(i) {
    inputs.set(id, i);
    owner.add(() => {
      if (inputs.get(id) === i) inputs.delete(id);
      if (dictating?.input === i) dictating = null;
    });
    announce();
  },
  dictate: on => post({ t: 'inDictate', on: on === true }),
});

// 翻译：登记自己；翻译一句经宿主交给登记了的翻译组件
const translatorFor = (id: string, owner: Owned): TranslatorService => ({
  register(fn) {
    const mine = { id, fn };
    translator = mine;
    owner.add(() => { if (translator === mine) translator = null; });
    announce();
  },
  translate: text => ask(req => ({ t: 'trAsk', req, text: String(text) })) as Promise<string>,
});

// 应用信息和对应用的操作：开关输出组件、系统剪贴板
const appFor = (id: string, owner: Owned): AppService => ({
  get info() { return appInfo; },
  watch(fn) {
    const mine = { id, fn };
    appListeners.add(mine);
    return owner.add(() => appListeners.delete(mine));
  },
  setOn: (target, on) => post({ t: 'setOn', id: String(target), on: on === true }),
  clipboard: {
    read: () => ask(req => ({ t: 'clipRead', req })) as Promise<string>,
    write: text => post({ t: 'clipWrite', text: String(text) }),
  },
});

// 远程服务(使用侧)：本进程订阅了的一个名字。state 是宿主发来的最新状态，watchers 是状态变了要叫的回调(id 是登记它的组件)，
// users 是在用它的组件数
interface RemoteEntry {
  state: unknown;
  watchers: Set<{ id: string; fn: (state: unknown) => void }>;
  users: number;
}
const remotes = new Map<string, RemoteEntry>();

// 远程服务(提供侧)：本进程里组件的一个登记。impl 是实现，active 是宿主说的生效没有(没说之前为假)，
// watchers 是生效没有变了要叫的回调
interface ServedEntry {
  impl: Readonly<Record<string, unknown>>;
  active: boolean;
  watchers: Set<(active: boolean) => void>;
}

// 本进程里的登记，键是服务名加组件 id(两者里都没有换行)
const served = new Map<string, ServedEntry>();
const servedKey = (name: string, id: string): string => `${name}\n${id}`;

// 一个组件开始用 name：本进程第一个用它的向宿主订阅
function subscribe(name: string): RemoteEntry {
  let entry = remotes.get(name);
  if (!entry) {
    remotes.set(name, entry = { state: null, watchers: new Set(), users: 0 });
    post({ t: 'rvUse', name, on: true });
  }
  entry.users++;
  return entry;
}

// 一个组件不用 name 了：本进程没有别的组件在用时向宿主退订
function unsubscribe(name: string, entry: RemoteEntry): void {
  if (--entry.users > 0) return;
  if (remotes.get(name) === entry) remotes.delete(name);
  post({ t: 'rvUse', name, on: false });
}

// 组件的 ctx.relay：use 读状态、发调用(调用带上组件 id，宿主核对后填成调用者)；serve 登记成提供方，
// 把手上读得到这个登记生效没有
function relayFor(id: string, owner: Owned): RelayService {
  const mine = new Map<string, RemoteCore>();   // 这个组件用着的远程服务
  const use = (name: string): RemoteCore => {
    const had = mine.get(name);
    if (had) return had;
    const entry = subscribe(name);
    owner.add(() => {
      mine.delete(name);
      unsubscribe(name, entry);
    });
    const core: RemoteCore = {
      state: () => entry.state,
      watch(fn) {
        const w = { id, fn };
        entry.watchers.add(w);
        return owner.add(() => entry.watchers.delete(w));
      },
      call: (method, args) => ask(req => ({ t: 'rvCall', component: id, req, name, method, args })),
      tell: (method, args) => post({ t: 'rvCall', component: id, name, method, args }),
    };
    mine.set(name, core);
    return core;
  };
  const serve = (name: string, impl: Readonly<Record<string, unknown>>): Serving<unknown> => {
    const key = servedKey(name, id);
    const entry: ServedEntry = { impl, active: false, watchers: new Set() };
    served.set(key, entry);
    post({ t: 'rvServe', component: id, name });
    // 同一个组件对同一个名字再登记一次之后，前一次的把手不起作用
    const close = owner.add(() => {
      if (served.get(key) !== entry) return;
      served.delete(key);
      post({ t: 'rvClose', component: id, name });
    });
    return {
      get active() { return served.get(key) === entry && entry.active; },
      watch(fn) {
        entry.watchers.add(fn);
        return owner.add(() => entry.watchers.delete(fn));
      },
      publish: s => { if (served.get(key) === entry) post({ t: 'rvState', component: id, name, state: s }); },
      close,
    };
  };
  return relayOver(use, serve);
}

const TELL_LOG_MS = 10_000;                       // 不等结果的调用出错，同一个组件的同一个服务最少隔这么久记一行日志(毫秒)
const tellLogged = new Map<string, number>();     // 服务名加组件 id → 上次记这种日志的时间

// 宿主转来的一次远程调用：交给登记了的实现(调用者是第一个参数)；带 req 的把结果或错误回给宿主(错误没有文字时回「出错」)，
// 不带的出错只记日志，TELL_LOG_MS 内同一个组件的同一个服务只记一行
function invoke(m: Extract<ToProcess, { t: 'rvInvoke' }>): void {
  const { req } = m;
  const failed = (e: unknown): void => {
    if (req !== undefined) return post({ t: 'rvResult', req, error: errorText(e) || '出错' });
    const key = servedKey(m.name, m.component);
    const now = Date.now();
    const last = tellLogged.get(key);
    if (last !== undefined && Math.abs(now - last) < TELL_LOG_MS) return;
    tellLogged.set(key, now);
    logError(m.component, `${m.name}.${m.method}`, e);
  };
  const impl = served.get(servedKey(m.name, m.component))?.impl;
  const fn = impl && Object.hasOwn(impl, m.method) ? impl[m.method] : undefined;
  if (typeof fn !== 'function') return failed(new Error(impl ? `${m.name} 没有 ${m.method} 这个方法` : `这个组件没有提供 ${m.name}`));
  const method = fn as (caller: Caller, ...args: unknown[]) => unknown;
  let result: unknown;
  try {
    result = method.call(impl, m.caller, ...m.args);
  } catch (e) {
    return failed(e);
  }
  Promise.resolve(result)
    .then(value => { if (req !== undefined) post({ t: 'rvResult', req, value }); })
    .catch(failed);
}

// 状态栏项：上报过的组件卸载时去掉
function statusFor(id: string, owner: Owned): StatusService {
  let reported = false;
  return {
    set(item) {
      post({ t: 'status', id, item: item ?? null });
      if (!reported) owner.add(() => post({ t: 'status', id, item: null }));
      reported = true;
    },
  };
}

// 日志：新监听先补发已有的行
const logsFor = (owner: Owned): LogsService => ({
  on(fn) {
    for (const line of logLines) fn(line);
    logListeners.add(fn);
    return owner.add(() => logListeners.delete(fn));
  },
});

function receiveLogs(lines: LogEntry[]): void {
  logLines.push(...lines);
  if (logLines.length > LOG_KEEP) logLines.splice(0, logLines.length - LOG_KEEP);
  for (const line of lines) for (const fn of logListeners) guard('', 'logs', () => fn(line));
}

// 面板页面的一帧没有组件收(没登记帧回调，或页面已经关了)：关掉复制进本进程的句柄(handle，十进制)，关完(或关不掉)之后调 release 告诉宿主这一帧用完了。
// 关不掉时记一行日志，同一个错误只记一次
let closeError = '';
function dropFrame(handle: string, release: () => void): void {
  const failed = (e: unknown): void => {
    const text = errorText(e);
    if (text === closeError) return;
    closeError = text;
    logError('', 'panel frame', e);
  };
  try {
    const closing = handles.close(BigInt(handle));
    if (closing instanceof Promise) {
      void closing.catch(failed).then(release);
      return;
    }
  } catch (e) {
    failed(e);
  }
  release();
}

// 本进程开着的一块面板的页面：开它的组件、组件登记的回调、宿主发来的大小和状态
interface FeedEntry {
  owner: string;
  frame: ((f: PanelFrame) => void) | null;
  drop: ((seq: number) => void) | null;
  size: ((width: number, height: number) => void) | null;
  state: ((state: PanelPageState, detail?: string) => void) | null;
  width: number;
  height: number;
  now: PanelPageState;
}

// 面板页面：本进程里按「开它的组件、面板 id」记(两者里都没有换行)；同一个组件把同一块面板再开一次时宿主的消息都到后开的那个
const feeds = new Map<string, FeedEntry>();
const feedKey = (component: string, id: string): string => `${component}\n${id}`;

// 组件的 ctx.panels：面板目录，开面板页面(能不能开由宿主按是不是生效的显示方定)
const panelsFor = (comp: string, owner: Owned): PanelsHostService => ({
  get list() { return panelList; },
  watch(fn) {
    const mine = { id: comp, fn };
    panelListeners.add(mine);
    return owner.add(() => panelListeners.delete(mine));
  },
  open(target, mode = 'frames') {
    const id = String(target);
    const key = feedKey(comp, id);
    const s: FeedEntry = { owner: comp, frame: null, drop: null, size: null, state: null, width: 0, height: 0, now: 'loading' };
    feeds.set(key, s);
    post({ t: 'pnOpen', component: comp, id, mode });
    // 这一页还归这个把手时才发
    const mine = (m: FromProcess): void => { if (feeds.get(key) === s) post(m); };
    // 关掉：linger = 页面留在宿主那里(组件停用时)
    const close = (linger: boolean): void => {
      if (feeds.get(key) !== s) return;
      feeds.delete(key);
      post({ t: 'pnClose', component: comp, id, linger });
    };
    // 组件卸载时放开；自己关掉之后这一项从占用的东西里拿掉
    const held = owner.hold(() => close(true));
    const feed: PanelFeed = {
      id,
      get width() { return s.width; },
      get height() { return s.height; },
      get state() { return s.now; },
      onFrame: fn => { s.frame = fn; },
      onDrop: fn => { s.drop = fn; },
      onSize: fn => { s.size = fn; },
      onState: fn => { s.state = fn; },
      release: seq => mine({ t: 'pnRelease', component: comp, id, seq }),
      input: event => mine({ t: 'pnInput', component: comp, id, event }),
      setPainting: on => mine({ t: 'pnPaint', component: comp, id, on: on === true }),
      setFrameRate: fps => mine({ t: 'pnFps', component: comp, id, fps }),
      close: () => {
        close(false);
        held.forget();
      },
    };
    return feed;
  },
});

interface Loaded {
  sig: string;          // 组件条目(含设置、入口文件修改时间)
  fiber: Fiber | null;
  owned: Owned;
}
const loaded = new Map<string, Loaded>();

async function load(c: HostComponent, sig: string): Promise<void> {
  const owned = new Owned();
  const entry: Loaded = { sig, fiber: null, owned };
  loaded.set(c.id, entry);
  const mine = bus.open();
  owned.add(mine.close);
  const log = (text: string, level?: unknown): void => post({ t: 'log', id: c.id, text: String(text), level: level === 'warn' || level === 'error' ? level : 'info' });
  const ctx = root.extend({
    id: c.id,
    config: c.config,
    dataDir,
    appDir,
    log,
    storage: storageOver(call => ask(req => ({ t: 'storage', id: c.id, req, call }))),
    bus: mine.bus,
    output: outputFor(c.id, owned),
    input: inputFor(c.id, owned),
    translator: translatorFor(c.id, owned),
    status: statusFor(c.id, owned),
    logs: logsFor(owned),
    panels: panelsFor(c.id, owned),
    relay: relayFor(c.id, owned),
    app: appFor(c.id, owned),
  });
  try {
    // 入口文件变了时换一个地址重新 import(同一地址 import 拿到的是缓存)
    const mod = await import(`${pathToFileURL(c.file).href}?t=${c.mtime}`) as { default?: Plugin };
    if (!mod.default) throw new Error('入口没有默认导出');
    const fiber = ctx.plugin(mod.default, c.config);
    entry.fiber = fiber;
    // 插件在等 inject 的服务时这里不等它(服务有了它自己起来)，后面的组件照常加载
    await fiber;
    post({ t: 'loaded', id: c.id });
    // 过一阵还在等服务：每个等着的服务记一行日志
    const timer = setTimeout(() => {
      for (const name of waitingFor(root, fiber)) log(waitingText(name), 'warn');
    }, WAIT_LOG_MS);
    timer.unref();
    owned.add(() => clearTimeout(timer));
  } catch (e) {
    post({ t: 'loaded', id: c.id, error: errorText(e) });
  }
}

async function unload(id: string): Promise<void> {
  const entry = loaded.get(id);
  if (!entry) return;
  loaded.delete(id);
  try {
    await entry.fiber?.dispose();
  } catch (e) {
    logError(id, 'unload', e);
  }
  entry.owned.release(fn => guard(id, 'unload', fn));
}

// 按新的组件列表：变了的和去掉的卸载，新的和变了的按列表顺序加载
async function sync(list: readonly HostComponent[]): Promise<void> {
  order = list.map(c => c.id);
  const next = new Map(list.map(c => [c.id, { c, sig: JSON.stringify(c) }] as const));
  for (const [id, entry] of [...loaded]) if (next.get(id)?.sig !== entry.sig) await unload(id);
  for (const { c, sig } of next.values()) if (!loaded.has(c.id)) await load(c, sig);
  announce();
}

// 组件列表的改动一个接一个做
let syncing = Promise.resolve();
function apply(list: readonly HostComponent[]): void {
  syncing = syncing.then(() => sync(list)).catch((e: unknown) => logError('', 'apply', e));
}

// 听写：开始时交给组件顺序最前的输入源，停止时交给开始的那个
function dictate(on: boolean): void {
  if (!on) {
    const d = dictating;
    dictating = null;
    if (d) guard(d.id, 'dictate', () => d.input.stop());
    return;
  }
  for (const id of order) {
    const input = inputs.get(id);
    if (!input) continue;
    dictating = { id, input };
    guard(id, 'dictate', () => input.start());
    return;
  }
}

port.on('message', ({ data }: { data: ToProcess }) => {
  switch (data.t) {
    case 'load':
      appInfo = data.info;
      panelList = data.panels;
      dataDir = data.dataDir;
      appDir = data.appDir;
      shareModules(data.shared);
      apply(data.components);
      return;
    case 'apply':
      apply(data.components);
      return;
    case 'send':
      for (const id of data.to) {
        const o = outputs.get(id);
        if (o) guard(id, 'send', () => o.send(data.payload));
      }
      return;
    case 'typing':
      for (const [id, o] of outputs) if (o.typing) guard(id, 'typing', () => o.typing?.(data.on));
      return;
    case 'clear':
      for (const [id, o] of outputs) if (o.clear) guard(id, 'clear', () => o.clear?.());
      return;
    case 'dictate':
      dictate(data.on);
      return;
    case 'bus':
      bus.deliver(data.channel, data.data);
      return;
    case 'translate': {
      const t = translator;
      if (!t) return post({ t: 'translated', req: data.req, text: data.text });
      Promise.resolve().then(() => t.fn(data.text))
        .then(text => post({ t: 'translated', req: data.req, text: String(text) }))
        .catch((e: unknown) => post({ t: 'translated', req: data.req, error: errorText(e) }));
      return;
    }
    case 'logs':
      receiveLogs(data.lines);
      return;
    case 'pnList':
      panelList = data.panels;
      for (const l of [...panelListeners]) guard(l.id, 'panel list', () => l.fn(data.panels));
      return;
    case 'pnFrame': {
      const feed = feeds.get(feedKey(data.component, data.id));
      const fn = feed?.frame;
      if (!feed || !fn) return dropFrame(data.handle, () => post({ t: 'pnRelease', component: data.component, id: data.id, seq: data.seq }));
      guard(feed.owner, 'panel frame', () => fn({ seq: data.seq, handle: BigInt(data.handle), width: data.width, height: data.height }));
      return;
    }
    case 'pnDrop': {
      const feed = feeds.get(feedKey(data.component, data.id));
      const fn = feed?.drop;
      if (feed && fn) guard(feed.owner, 'panel frame', () => fn(data.seq));
      return;
    }
    case 'pnSize': {
      const feed = feeds.get(feedKey(data.component, data.id));
      if (!feed) return;
      feed.width = data.width;
      feed.height = data.height;
      const fn = feed.size;
      if (fn) guard(feed.owner, 'panel size', () => fn(data.width, data.height));
      return;
    }
    case 'pnState': {
      const feed = feeds.get(feedKey(data.component, data.id));
      if (!feed) return;
      feed.now = data.state;
      const fn = feed.state;
      if (fn) guard(feed.owner, 'panel state', () => fn(data.state, data.detail));
      return;
    }
    case 'info':
      appInfo = data.info;
      for (const l of [...appListeners]) guard(l.id, 'app info', () => l.fn(data.info));
      return;
    case 'rvState': {
      const entry = remotes.get(data.name);
      if (!entry) return;
      entry.state = data.state ?? null;
      for (const w of [...entry.watchers]) guard(w.id, `relay ${data.name}`, () => w.fn(entry.state));
      return;
    }
    case 'rvActive': {
      const entry = served.get(servedKey(data.name, data.component));
      const on = data.on === true;
      if (!entry || entry.active === on) return;
      entry.active = on;
      for (const fn of [...entry.watchers]) guard(data.component, `relay ${data.name}`, () => fn(on));
      return;
    }
    case 'rvInvoke':
      invoke(data);
      return;
    case 'reply': {
      const p = pending.get(data.req);
      pending.delete(data.req);
      if (data.error !== undefined) p?.reject(new Error(data.error || '请求失败'));
      else p?.resolve(data.value);
    }
  }
});

process.on('uncaughtException', e => {
  post({ t: 'log', id: '', text: `component host crashed: ${e.stack ?? e.message}`, level: 'error' });
  process.exit(1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HELD_MAX, LINGER_MS, PANEL_PAGES_MAX, PanelPages, parseInput, planIds, toInputEvents,
  type PageEvents, type PageInputEvent, type PageWindow, type PanelHost, type PanelSpec, type PanelWindowSpec, type SharedFrame,
} from '../src/main/panels.ts';
import type { PanelMode, PanelRequest, ToProcess } from '../src/shared/host-protocol.ts';
import { PAGE_IPC, type PanelInfo, type PanelPlan } from '../src/shared/types.ts';

// 假的面板窗口：记下对它做的每件事、发给页面的 IPC 和输入事件；窗口的事件由测试调 events 里的函数触发
class FakeWindow implements PageWindow {
  readonly id: number;
  readonly spec: PanelWindowSpec;
  readonly events: PageEvents;
  readonly calls: string[] = [];
  readonly sent: unknown[][] = [];
  readonly inputs: PageInputEvent[] = [];
  size: number[];
  destroyed = false;

  constructor(id: number, spec: PanelWindowSpec, events: PageEvents) {
    this.id = id;
    this.spec = spec;
    this.events = events;
    this.size = [spec.width, spec.height];
  }

  // 取走已经记下的调用
  take(): string[] {
    return this.calls.splice(0);
  }

  loadURL(url: string): void { this.calls.push(`loadURL ${url}`); }
  reload(): void { this.calls.push('reload'); }
  destroy(): void {
    this.calls.push('destroy');
    this.destroyed = true;
  }
  show(): void { this.calls.push('show'); }
  hide(): void { this.calls.push('hide'); }
  setContentSize(width: number, height: number): void {
    this.calls.push(`setContentSize ${width}x${height}`);
    this.size = [width, height];
  }
  getContentSize(): number[] { return [...this.size]; }
  sendInputEvent(e: PageInputEvent): void { this.inputs.push(e); }
  startPainting(): void { this.calls.push('startPainting'); }
  stopPainting(): void { this.calls.push('stopPainting'); }
  invalidate(): void { this.calls.push('invalidate'); }
  setFrameRate(fps: number): void { this.calls.push(`setFrameRate ${fps}`); }
  setBackgroundThrottling(on: boolean): void { this.calls.push(`throttle ${on}`); }
  send(channel: string, ...args: unknown[]): void { this.sent.push([channel, ...args]); }
}

// 假的组件进程：记下发给它的消息；ids 是它里面的组件
class FakeHost implements PanelHost {
  pid: number | undefined;
  readonly ids: Set<string>;
  readonly sent: ToProcess[] = [];

  constructor(pid: number | undefined, ids: string[]) {
    this.pid = pid;
    this.ids = new Set(ids);
  }

  post(m: ToProcess): void { this.sent.push(m); }
  runs(id: string): boolean { return this.ids.has(id); }

  // 取走已经收到的消息
  take(): ToProcess[] {
    return this.sent.splice(0);
  }
}

// 页面画出的一帧：released 记下放掉了几次
interface FakeFrame extends SharedFrame {
  released: number;
}
function frameOf(handle: bigint | null, widgetType = 'frame', width = 480, height = 200): FakeFrame {
  const nt = Buffer.alloc(8);
  if (handle !== null) nt.writeBigUInt64LE(handle);
  const f: FakeFrame = {
    released: 0,
    release: () => { f.released++; },
    textureInfo: { widgetType, codedSize: { width, height }, handle: handle === null ? {} : { ntHandle: nt } },
  };
  return f;
}

const DISPLAY = 'a.vr';   // 生效的显示方组件

const infoOf = (id: string, over: Partial<PanelInfo> = {}): PanelInfo => ({
  id, name: id, width: 480, height: 200, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2,
  anchor: 'world', spawn: 'front', glance: false, keep: false, ...over,
});

const planOf = (id: string, over: Partial<PanelPlan> = {}): PanelPlan => ({
  kind: 'panel', id, size: { width: 480, height: 200 },
  root: { id, kind: 'panel', name: id, config: {}, url: `fox://component/${id}/panel.js?t=1` },
  parts: {}, services: [], remotes: [], skin: null, sound: false, preview: false, ...over,
});

const specOf = (id: string, info: Partial<PanelInfo> = {}, plan: Partial<PanelPlan> = {}): PanelSpec => ({ info: infoOf(id, info), plan: planOf(id, plan) });

interface Timer {
  fn: () => void;
  ms: number;
  cancelled: boolean;
}

interface Rig {
  pages: PanelPages;
  windows: FakeWindow[];                     // 建过的窗口，按建的先后
  timers: Timer[];                           // 起过的计时
  logs: string[];                            // 「级别 来源: 内容」
  adopted: [number, string, string[]][];     // 登记：页面、面板 id、能用的组件 id
  dropped: number[];                         // 注销的页面
  trail: string[];                           // 登记和注销各发生在窗口的哪些操作之后：「adopt 页面: 操作,…」「dropped 页面: 操作,…」
  restarted: number[];                       // 报了重新加载的页面
  lists: string[][];                         // 通知出去的面板目录(各项的 id)
  native: { calls: string[]; process: bigint | null; copied: bigint | null; fail: string };   // 句柄操作：记下调用；process = 打开进程的结果，copied = 复制的结果，fail 不空时复制抛这个错
  state: { display: string | undefined; failed: number; adoptError: string; windowError: string; dropError: string; now: number };
  // 以 host 的身份发一条消息
  say(host: FakeHost, m: PanelRequest): void;
  // 让 host 里的显示方开一块面板，回这块面板当前的窗口
  open(host: FakeHost, id: string, mode?: PanelMode): FakeWindow;
}

function rig(specs: PanelSpec[] = [specOf('a.clock')]): Rig {
  const windows: FakeWindow[] = [];
  const timers: Timer[] = [];
  const logs: string[] = [];
  const adopted: Rig['adopted'] = [];
  const dropped: number[] = [];
  const trail: string[] = [];
  const done = (page: number): string => windows.find(w => w.id === page)?.calls.join(',') ?? '';
  const restarted: number[] = [];
  const lists: string[][] = [];
  const native: Rig['native'] = { calls: [], process: 700n, copied: 4242n, fail: '' };
  const state: Rig['state'] = { display: DISPLAY, failed: 0, adoptError: '', windowError: '', dropError: '', now: 1_000_000 };
  const pages = new PanelPages({
    display: () => state.display,
    createWindow: (spec, events) => {
      if (state.windowError) throw new Error(state.windowError);
      const w = new FakeWindow(100 + windows.length, spec, events);
      windows.push(w);
      return w;
    },
    adopt: (page, plan) => {
      if (state.adoptError) throw new Error(state.adoptError);
      adopted.push([page, plan.id, planIds(plan)]);
      trail.push(`adopt ${page}: ${done(page)}`);
    },
    dropped: page => {
      dropped.push(page);
      trail.push(`dropped ${page}: ${done(page)}`);
      if (state.dropError) throw new Error(state.dropError);
    },
    restarted: page => { restarted.push(page); },
    openProcess: pid => {
      native.calls.push(`open ${pid}`);
      return native.process;
    },
    duplicate: (process, handle) => {
      native.calls.push(`dup ${process} ${handle}`);
      if (native.fail) throw new Error(native.fail);
      return native.copied;
    },
    closeHandle: handle => { native.calls.push(`close ${handle}`); },
    setTimer: (fn, ms) => {
      const timer: Timer = { fn, ms, cancelled: false };
      timers.push(timer);
      return () => { timer.cancelled = true; };
    },
    listed: list => { lists.push(list.map(p => p.id)); },
    failed: () => { state.failed++; },
    log: (text, level = 'info', source = '') => { logs.push(`${level} ${source}: ${text}`); },
    now: () => state.now,
  });
  pages.sync(specs);
  const say: Rig['say'] = (host, m) => pages.message(m, host);
  const open: Rig['open'] = (host, id, mode = 'frames') => {
    say(host, { t: 'pnOpen', component: DISPLAY, id, mode });
    const last = windows.findLast(w => w.spec.id === id && !w.destroyed);
    assert.ok(last, `no window for ${id}`);
    return last;
  };
  return { pages, windows, timers, logs, adopted, dropped, trail, restarted, lists, native, state, say, open };
}

// 显示方所在的进程
const displayHost = (pid = 4321): FakeHost => new FakeHost(pid, [DISPLAY, 'a.other']);

test('指点事件的翻译：坐标从纹理像素换成页面像素，按住时带左键，滚轮方向反过来，移出不带坐标', () => {
  assert.deepEqual(toInputEvents({ kind: 'move', x: 300, y: 151, held: false }, 2), [{ type: 'mouseMove', x: 150, y: 76, modifiers: [] }]);
  assert.deepEqual(toInputEvents({ kind: 'move', x: 300, y: 150, held: true }, 1.5), [{ type: 'mouseMove', x: 200, y: 100, modifiers: ['leftbuttondown'] }]);
  assert.deepEqual(toInputEvents({ kind: 'down', x: 10, y: 20 }, 1), [{ type: 'mouseDown', x: 10, y: 20, button: 'left', clickCount: 1 }]);
  assert.deepEqual(toInputEvents({ kind: 'up', x: 10.4, y: 20.6 }, 1), [{ type: 'mouseUp', x: 10, y: 21, button: 'left', clickCount: 1 }]);
  assert.deepEqual(toInputEvents({ kind: 'wheel', x: 40, y: 60, dx: 0, dy: 120 }, 2), [{ type: 'mouseWheel', x: 20, y: 30, deltaX: -0, deltaY: -120 }]);
  assert.deepEqual(toInputEvents({ kind: 'wheel', x: 0, y: 0, dx: -30.4, dy: -7.6 }, 1), [{ type: 'mouseWheel', x: 0, y: 0, deltaX: 30, deltaY: 8 }]);
  assert.deepEqual(toInputEvents({ kind: 'leave' }, 2), [{ type: 'mouseLeave', x: 0, y: 0 }]);
});

test('指点事件的收窄：种类不认识、坐标不是有限的数、滚轮缺滚动量的都不收；多出来的字段丢掉', () => {
  assert.deepEqual(parseInput({ kind: 'move', x: 1, y: 2, held: true, extra: 1 }), { kind: 'move', x: 1, y: 2, held: true });
  assert.deepEqual(parseInput({ kind: 'move', x: 1, y: 2, held: 'yes' }), { kind: 'move', x: 1, y: 2, held: false });
  assert.deepEqual(parseInput({ kind: 'down', x: 0, y: 0 }), { kind: 'down', x: 0, y: 0 });
  assert.deepEqual(parseInput({ kind: 'up', x: 3, y: 4 }), { kind: 'up', x: 3, y: 4 });
  assert.deepEqual(parseInput({ kind: 'wheel', x: 3, y: 4, dx: 0, dy: -5 }), { kind: 'wheel', x: 3, y: 4, dx: 0, dy: -5 });
  assert.deepEqual(parseInput({ kind: 'leave', x: 'ignored' }), { kind: 'leave' });
  const bad: unknown[] = [
    null, 5, 'move', [], {}, { kind: 'click', x: 1, y: 2 }, { kind: 'move', x: '1', y: 2 }, { kind: 'move', x: 1 },
    { kind: 'down', x: Number.NaN, y: 2 }, { kind: 'up', x: 1, y: Number.POSITIVE_INFINITY }, { kind: 'wheel', x: 1, y: 2, dx: 1 }, { kind: 'wheel', x: 1, y: 2, dx: 1, dy: '2' },
  ];
  for (const raw of bad) assert.equal(parseInput(raw), null, JSON.stringify(raw));
});

test('一页加载的组件 id：根组件、各插槽的部件、服务，重复的只算一次', () => {
  const part = (id: string): PanelPlan['root'] => ({ id, kind: 'sidepage', name: id, config: {}, url: `fox://component/${id}/page.js` });
  const plan = planOf('a.kb', { parts: { sidepage: [part('a.one'), part('a.two')], layout: [{ id: 'a.d68', kind: 'layout', name: 'd68', config: {}, layout: {} }], empty: [] }, services: [part('a.ime'), part('a.kb')] });
  assert.deepEqual(planIds(plan), ['a.kb', 'a.one', 'a.two', 'a.d68', 'a.ime']);
  assert.deepEqual(planIds(planOf('a.clock')), ['a.clock']);
});

test('开页面：只有当前生效的显示方、在它所在的进程里能开；别的组件、别的进程、不在目录里的面板、不认识的显示方式都回 failed，不建窗口', () => {
  const r = rig();
  const host = displayHost();
  const refused = (h: FakeHost, m: Record<string, unknown>): unknown => {
    r.say(h, { t: 'pnOpen', ...m } as PanelRequest);
    const got = h.take();
    assert.equal(got.length, 1);
    const [first] = got;
    return first?.t === 'pnState' ? [first.id, first.state, first.detail] : first;
  };
  // 同一个进程里别的组件
  assert.deepEqual(refused(host, { component: 'a.other', id: 'a.clock', mode: 'frames' }), ['a.clock', 'failed', 'not the active display']);
  // 显示方不在发消息的这个进程里(冒用它的 id)
  assert.deepEqual(refused(new FakeHost(9, ['a.evil']), { component: DISPLAY, id: 'a.clock', mode: 'frames' }), ['a.clock', 'failed', 'not the active display']);
  assert.deepEqual(refused(host, { component: DISPLAY, id: 'a.none', mode: 'frames' }), ['a.none', 'failed', 'no such panel']);
  assert.deepEqual(refused(host, { component: DISPLAY, id: 'a.clock', mode: 'popup' }), ['a.clock', 'failed', 'bad request']);
  assert.deepEqual(refused(host, { component: 5, id: 'a.clock', mode: 'frames' }), ['a.clock', 'failed', 'bad request']);
  // 没有显示方时谁都开不了
  r.state.display = undefined;
  assert.deepEqual(refused(host, { component: DISPLAY, id: 'a.clock', mode: 'frames' }), ['a.clock', 'failed', 'not the active display']);
  // 面板 id 不是字符串的消息丢掉
  r.say(host, { t: 'pnOpen', component: DISPLAY, id: 7, mode: 'frames' } as unknown as PanelRequest);
  assert.deepEqual(host.take(), []);
  assert.equal(r.windows.length, 0);
  // 冒开的写警告，记在发起的组件名下；同样的 10 秒内只写一次
  assert.deepEqual(r.logs, [
    'warn a.other: cannot open panel a.clock: only the active display component can open panel pages',
    `warn ${DISPLAY}: cannot open panel a.clock: only the active display component can open panel pages`,
  ]);
  // 换了显示方：新的能开，旧的不能
  r.state.display = 'a.other';
  assert.deepEqual(refused(host, { component: DISPLAY, id: 'a.clock', mode: 'frames' }), ['a.clock', 'failed', 'not the active display']);
  r.say(host, { t: 'pnOpen', component: 'a.other', id: 'a.clock', mode: 'frames' });
  assert.equal(r.windows.length, 1);
});

test('没有显示方来开时不建任何页面：目录里有面板、组件变了、发外观通知、组件进程退出都不建窗口', () => {
  const r = rig([specOf('a.kb', { keep: true }), specOf('a.clock')]);
  assert.deepEqual(r.pages.list.map(p => p.id), ['a.kb', 'a.clock']);
  r.pages.sync([specOf('a.kb', { keep: true }, { remotes: ['keyboard'] }), specOf('a.clock'), specOf('a.notes')]);
  r.pages.sendAll(PAGE_IPC.lookEvent, { dark: true, locale: 'en' });
  r.pages.hostGone(displayHost());
  assert.deepEqual([r.windows.length, r.adopted, r.timers.length, r.native.calls], [0, [], 0, []]);
  assert.equal(r.pages.planOf(100), null);
  r.pages.stop();
  assert.equal(r.windows.length, 0);
});

test('开离屏页面：按清单的尺寸、倍数、出不出声建窗口，先登记再加载；建好马上按页面尺寸设一次大小、设帧率，加载这块面板自己的源；回纹理大小和状态，开始画', () => {
  const r = rig([specOf('a.kb', { width: 1400, height: 490, scale: 1.5, fps: 60, name: { en: 'Keyboard' } }, { sound: true, remotes: ['keyboard'] })]);
  const host = displayHost();
  const win = r.open(host, 'a.kb');
  assert.deepEqual(win.spec, { id: 'a.kb', name: { en: 'Keyboard' }, mode: 'frames', width: 1400, height: 490, scale: 1.5, sound: true });
  assert.deepEqual(r.adopted, [[win.id, 'a.kb', ['a.kb']]]);
  assert.deepEqual(r.trail, [`adopt ${win.id}: `]);   // 登记时窗口还什么都没做
  assert.deepEqual(win.take(), [
    'setContentSize 1400x490', 'setFrameRate 60', 'loadURL fox://a.kb.panel/panel.html',
    'throttle false', 'startPainting', 'invalidate',
  ]);
  assert.deepEqual(host.take(), [
    { t: 'pnSize', component: DISPLAY, id: 'a.kb', width: 2100, height: 735 },
    { t: 'pnState', component: DISPLAY, id: 'a.kb', state: 'loading' },
  ]);
  assert.deepEqual(win.sent, [[PAGE_IPC.visibleEvent, true]]);
  // 页面取计划：是这块面板的，不是窗口方式
  assert.deepEqual(r.pages.planOf(win.id), planOf('a.kb', { sound: true, remotes: ['keyboard'] }));
  assert.equal(r.pages.planOf(999), null);
  assert.deepEqual([r.logs, r.timers.length, r.dropped], [[], 0, []]);
});

test('同一块面板只开一页：同一个进程再开一次不建新窗口，重发大小和状态并重画一帧', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  win.events.loaded();
  win.take();
  host.take();
  const frame = frameOf(1n);
  win.events.paint(frame);
  host.take();
  assert.equal(r.open(host, 'a.clock'), win);
  assert.equal(r.windows.length, 1);
  assert.deepEqual(win.take(), ['throttle false', 'startPainting', 'invalidate']);
  assert.deepEqual(host.take(), [{ t: 'pnSize', component: DISPLAY, id: 'a.clock', width: 480, height: 200 }, { t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'ready' }]);
  // 之前交出去的帧放掉了
  assert.equal(frame.released, 1);
  assert.equal(r.adopted.length, 1);
});

test('同一块面板只开一页：显示方换到别的进程来开时接走原页面，前一个进程得到 gone，它之后发的消息不算', () => {
  const r = rig();
  const first = displayHost(1);
  const win = r.open(first, 'a.clock');
  win.events.loaded();
  const frame = frameOf(1n);
  win.events.paint(frame);
  first.take();
  win.take();
  const second = displayHost(2);
  assert.equal(r.open(second, 'a.clock'), win);
  assert.equal(r.windows.length, 1);
  assert.equal(frame.released, 1);
  assert.deepEqual(first.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'gone', detail: 'taken over' }]);
  assert.deepEqual(second.take(), [{ t: 'pnSize', component: DISPLAY, id: 'a.clock', width: 480, height: 200 }, { t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'ready' }]);
  win.take();
  // 前一个进程的操作都不起作用
  r.say(first, { t: 'pnPaint', component: DISPLAY, id: 'a.clock', on: false });
  r.say(first, { t: 'pnInput', component: DISPLAY, id: 'a.clock', event: { kind: 'down', x: 1, y: 1 } });
  r.say(first, { t: 'pnFps', component: DISPLAY, id: 'a.clock', fps: 5 });
  r.say(first, { t: 'pnClose', component: DISPLAY, id: 'a.clock', linger: false });
  assert.deepEqual([win.take(), win.inputs, win.destroyed], [[], [], false]);
  // 新的一帧交给新的进程
  win.events.paint(frameOf(2n));
  assert.deepEqual(second.take().map(m => m.t), ['pnFrame']);
  assert.deepEqual(first.take(), []);
});

test('出帧：句柄复制进收帧的进程交过去，进程句柄每个进程只打开一次；宽高是这一帧纹理的像素', () => {
  const r = rig();
  const host = displayHost(4321);
  const win = r.open(host, 'a.clock');
  host.take();
  const a = frameOf(0xABCDn, 'frame', 482, 201);
  win.events.paint(a);
  win.events.paint(frameOf(0xABCEn));
  assert.deepEqual(r.native.calls, ['open 4321', `dup 700 ${0xABCDn}`, `dup 700 ${0xABCEn}`]);
  assert.deepEqual(host.take(), [
    { t: 'pnFrame', component: DISPLAY, id: 'a.clock', seq: 1, handle: '4242', width: 482, height: 201 },
    { t: 'pnFrame', component: DISPLAY, id: 'a.clock', seq: 2, handle: '4242', width: 480, height: 200 },
  ]);
  assert.equal(a.released, 0);
  // 用完放掉：核心才放掉这一帧；放两次、放没有的帧不出错
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 1 });
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 1 });
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 99 });
  assert.equal(a.released, 1);
  // 进程重启(pid 变了)：关掉旧的进程句柄，重新打开
  host.pid = 5000;
  r.native.calls.length = 0;
  win.events.paint(frameOf(3n));
  assert.deepEqual(r.native.calls, ['close 700', 'open 5000', 'dup 700 3']);
  // 句柄值超过安全整数范围：照原值写成十进制
  host.take();
  const big = 0x1000_0000_0000_0001n;
  r.native.copied = big;
  win.events.paint(frameOf(big - 1n));
  assert.deepEqual(r.native.calls.at(-1), `dup 700 ${big - 1n}`);
  assert.deepEqual(host.take(), [{ t: 'pnFrame', component: DISPLAY, id: 'a.clock', seq: 4, handle: '1152921504606846977', width: 480, height: 200 }]);
});

test('出帧：没有画面的事件、别的层的帧、没有句柄的帧、复制不了的帧都放掉不交；复制出错只写一行警告', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  host.take();
  win.events.paint(undefined);
  const popup = frameOf(1n, 'popup');
  const bare = frameOf(null);
  win.events.paint(popup);
  win.events.paint(bare);
  assert.deepEqual([popup.released, bare.released, r.native.calls], [1, 1, []]);
  // 复制失败
  r.native.copied = null;
  const lost = frameOf(2n);
  win.events.paint(lost);
  assert.equal(lost.released, 1);
  // 进程打不开
  const other = rig();
  other.native.process = null;
  const w2 = other.open(displayHost(4321), 'a.clock');
  const shut = frameOf(3n);
  w2.events.paint(shut);
  w2.events.paint(frameOf(4n));
  assert.equal(shut.released, 1);
  assert.deepEqual(other.native.calls, ['open 4321', 'open 4321']);
  // 进程没在跑
  host.pid = undefined;
  const idle = frameOf(5n);
  win.events.paint(idle);
  assert.equal(idle.released, 1);
  host.pid = 4321;
  // 复制抛出异常：放掉，警告同样的 10 秒内只写一次
  r.native.fail = 'access denied';
  const thrown = [frameOf(6n), frameOf(7n)];
  for (const f of thrown) win.events.paint(f);
  assert.deepEqual(thrown.map(f => f.released), [1, 1]);
  assert.deepEqual(r.logs, ['warn a.clock: panel frame: access denied']);
  r.state.now += 10_000;
  win.events.paint(frameOf(8n));
  assert.equal(r.logs.length, 2);
  assert.deepEqual(host.take(), []);
  // 之后的帧照常交，帧号只算交出去的
  r.native.fail = '';
  r.native.copied = 9000n;
  win.events.paint(frameOf(9n));
  assert.deepEqual(host.take(), [{ t: 'pnFrame', component: DISPLAY, id: 'a.clock', seq: 1, handle: '9000', width: 480, height: 200 }]);
});

test('两块面板各有各的页面：帧号各算各的，还帧要说对面板、由收帧的进程来还；关掉一块时放掉它没还的帧，另一块不动', () => {
  const r = rig([specOf('a.clock'), specOf('a.notes')]);
  const host = displayHost();
  const clock = r.open(host, 'a.clock');
  const notes = r.open(host, 'a.notes');
  assert.notEqual(clock, notes);
  host.take();
  const [c1, c2, n1] = [frameOf(10n), frameOf(11n), frameOf(20n)];
  clock.events.paint(c1);
  notes.events.paint(n1);
  clock.events.paint(c2);
  assert.deepEqual(host.take().map(m => (m.t === 'pnFrame' ? [m.id, m.seq] : m.t)), [['a.clock', 1], ['a.notes', 1], ['a.clock', 2]]);
  // 帧号对上了别的面板、别的进程来还：都不放
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.notes', seq: 2 });
  r.say(displayHost(9), { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 1 });
  assert.deepEqual([c1.released, c2.released, n1.released], [0, 0, 0]);
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 1 });
  assert.deepEqual([c1.released, c2.released, n1.released], [1, 0, 0]);
  // 关掉一块：没还的帧放掉，注销在销毁窗口之前；另一块照常出帧、照常还
  r.trail.length = 0;
  clock.take();
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.clock', linger: false });
  assert.deepEqual([c1.released, c2.released, n1.released, clock.destroyed, notes.destroyed], [1, 1, 0, true, false]);
  assert.deepEqual(r.trail, [`dropped ${clock.id}: `]);
  assert.deepEqual(clock.take(), ['destroy']);
  // 关了之后还帧、再关都不管
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 2 });
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.clock', linger: false });
  assert.deepEqual([c2.released, r.dropped], [1, [clock.id]]);
  notes.events.paint(frameOf(21n));
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.notes', seq: 1 });
  assert.deepEqual([n1.released, host.take().map(m => m.t)], [1, ['pnFrame']]);
  // 关过的面板再开是新的页面
  const again = r.open(host, 'a.clock');
  assert.notEqual(again, clock);
  assert.equal(r.windows.length, 3);
});

test('注销出错：窗口照样销毁，页面拿掉，记一行警告', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  r.state.dropError = 'gone';
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.clock', linger: false });
  assert.equal(win.destroyed, true);
  assert.deepEqual(r.logs, ['warn a.clock: panel page closed: gone']);
  assert.equal(r.pages.planOf(win.id), null);
  r.state.dropError = '';
  assert.notEqual(r.open(host, 'a.clock'), win);
});

test('压帧上限：一页最多替收帧方压着 HELD_MAX 帧，再来一帧时放掉最早的并发 pnDrop', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  host.take();
  const frames = Array.from({ length: HELD_MAX + 2 }, (_, i) => frameOf(BigInt(i + 1)));
  for (const f of frames.slice(0, HELD_MAX)) win.events.paint(f);
  assert.deepEqual(frames.map(f => f.released), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(host.take().map(m => m.t), ['pnFrame', 'pnFrame', 'pnFrame', 'pnFrame']);
  win.events.paint(frames[HELD_MAX]);
  assert.deepEqual(frames.map(f => f.released), [1, 0, 0, 0, 0, 0]);
  assert.deepEqual(host.take(), [
    { t: 'pnDrop', component: DISPLAY, id: 'a.clock', seq: 1 },
    { t: 'pnFrame', component: DISPLAY, id: 'a.clock', seq: 5, handle: '4242', width: 480, height: 200 },
  ]);
  // 收帧方放掉一帧之后有了空位，下一帧不淘汰
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 3 });
  win.events.paint(frames[HELD_MAX + 1]);
  assert.deepEqual(frames.map(f => f.released), [1, 0, 1, 0, 0, 0]);
  assert.deepEqual(host.take().map(m => m.t), ['pnFrame']);
  // 已经淘汰的帧再放不出错
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 1 });
  assert.equal(frames[0]?.released, 1);
});

test('停画和恢复：停画后页面不出帧、放开后台节流，恢复时重画一帧；页面得到显示状态的通知；重复的要求不重复做', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  win.take();
  win.sent.length = 0;
  host.take();
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.clock', on: false });
  assert.deepEqual(win.take(), ['stopPainting', 'throttle true']);
  assert.deepEqual(win.sent, [[PAGE_IPC.visibleEvent, false]]);
  // 停画时到的帧放掉不交
  const late = frameOf(1n);
  win.events.paint(late);
  assert.equal(late.released, 1);
  assert.deepEqual([host.take(), r.native.calls], [[], []]);
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.clock', on: false });
  assert.deepEqual(win.take(), []);
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.clock', on: true });
  assert.deepEqual(win.take(), ['throttle false', 'startPainting', 'invalidate']);
  assert.deepEqual(win.sent.slice(1), [[PAGE_IPC.visibleEvent, true]]);
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.clock', on: true });
  assert.deepEqual(win.take(), []);
  win.events.paint(frameOf(2n));
  assert.deepEqual(host.take().map(m => m.t), ['pnFrame']);
  // 页面加载完时把当前的显示状态再告诉它一次
  win.sent.length = 0;
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.clock', on: false });
  win.events.loaded();
  assert.deepEqual(win.sent, [[PAGE_IPC.visibleEvent, false], [PAGE_IPC.visibleEvent, false]]);
});

test('帧率：不超过清单里的上限、不低于 1；不是数的不理', () => {
  const r = rig([specOf('a.clock', { fps: 30 })]);
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  win.take();
  for (const fps of [15, 90, 0, 12.6, Number.NaN, '10']) r.say(host, { t: 'pnFps', component: DISPLAY, id: 'a.clock', fps } as PanelRequest);
  assert.deepEqual(win.take(), ['setFrameRate 15', 'setFrameRate 30', 'setFrameRate 1', 'setFrameRate 13']);
});

test('指点事件：收帧方发来的换成页面像素交给页面；格式不对的丢掉', () => {
  const r = rig([specOf('a.clock', { scale: 2 })]);
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  r.say(host, { t: 'pnInput', component: DISPLAY, id: 'a.clock', event: { kind: 'move', x: 200, y: 100, held: false } });
  r.say(host, { t: 'pnInput', component: DISPLAY, id: 'a.clock', event: { kind: 'down', x: 200, y: 100 } });
  r.say(host, { t: 'pnInput', component: DISPLAY, id: 'a.clock', event: { kind: 'bad' } } as unknown as PanelRequest);
  r.say(host, { t: 'pnInput', component: DISPLAY, id: 'a.clock', event: { kind: 'up', x: 200, y: 100 } });
  r.say(host, { t: 'pnInput', component: DISPLAY, id: 'a.clock', event: { kind: 'leave' } });
  r.say(host, { t: 'pnInput', component: DISPLAY, id: 'a.none', event: { kind: 'leave' } });
  assert.deepEqual(win.inputs, [
    { type: 'mouseMove', x: 100, y: 50, modifiers: [] },
    { type: 'mouseDown', x: 100, y: 50, button: 'left', clickCount: 1 },
    { type: 'mouseUp', x: 100, y: 50, button: 'left', clickCount: 1 },
    { type: 'mouseLeave', x: 0, y: 0 },
  ]);
});

test('保留期：收帧的进程退出后页面停画并保留 LINGER_MS，关掉它的进程句柄；期间显示方再来开，接回原页面', () => {
  const r = rig();
  const host = displayHost(4321);
  const win = r.open(host, 'a.clock');
  win.events.loaded();
  const held = frameOf(1n);
  win.events.paint(held);
  win.take();
  host.take();
  r.native.calls.length = 0;
  r.pages.hostGone(host);
  assert.deepEqual(win.take(), ['stopPainting', 'throttle true']);
  assert.deepEqual([held.released, win.destroyed, r.native.calls], [1, false, ['close 700']]);
  assert.deepEqual(r.timers.map(t => [t.ms, t.cancelled]), [[LINGER_MS, false]]);
  assert.equal(LINGER_MS, 120_000);
  // 保留期里页面照常在：帧不交，状态照记
  win.events.paint(frameOf(2n));
  assert.deepEqual(host.take(), []);
  // 进程重启后显示方再开：还是那个窗口，计时取消，重新出帧。页面没有重新加载、没有重新登记：页面里的东西(输入框里没发出去的字)都还在
  const again = displayHost(5555);
  assert.equal(r.open(again, 'a.clock'), win);
  assert.equal(r.windows.length, 1);
  assert.deepEqual(r.timers.map(t => t.cancelled), [true]);
  assert.deepEqual(win.take(), ['throttle false', 'startPainting', 'invalidate']);
  assert.deepEqual([r.adopted.length, r.dropped, r.restarted, win.destroyed], [1, [], [], false]);
  assert.deepEqual(r.pages.planOf(win.id), planOf('a.clock'));
  assert.deepEqual(again.take(), [{ t: 'pnSize', component: DISPLAY, id: 'a.clock', width: 480, height: 200 }, { t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'ready' }]);
  win.events.paint(frameOf(3n));
  assert.deepEqual(again.take().map(m => m.t), ['pnFrame']);
  // 取消了的计时到点也不销毁
  r.timers[0]?.fn();
  assert.equal(win.destroyed, false);
});

test('保留期：到期没人接的页面销毁并注销；显示方停用时放开的页面(pnClose 带 linger)同样保留，直接关的立即销毁', () => {
  const r = rig([specOf('a.clock'), specOf('a.notes'), specOf('a.todo')]);
  const host = displayHost();
  const clock = r.open(host, 'a.clock');
  const notes = r.open(host, 'a.notes');
  const todo = r.open(host, 'a.todo');
  for (const w of [clock, notes, todo]) w.take();
  // 放开一页：保留
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.clock', linger: true });
  assert.deepEqual([clock.take(), clock.destroyed, r.timers.length], [['stopPainting', 'throttle true'], false, 1]);
  // 直接关一页：立即销毁，不起计时
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.notes', linger: false });
  assert.deepEqual([notes.take(), notes.destroyed, r.timers.length, r.dropped], [['destroy'], true, 1, [notes.id]]);
  // 进程退出：还归它的那一页也进保留期；已经放开的那一页不重新计时
  r.pages.hostGone(host);
  assert.deepEqual(r.timers.map(t => [t.ms, t.cancelled]), [[LINGER_MS, false], [LINGER_MS, false]]);
  // 到期：各自销毁
  r.timers[0]?.fn();
  assert.deepEqual([clock.destroyed, todo.destroyed, r.dropped], [true, false, [notes.id, clock.id]]);
  r.timers[1]?.fn();
  assert.deepEqual([todo.destroyed, r.dropped], [true, [notes.id, clock.id, todo.id]]);
  assert.equal(r.pages.planOf(clock.id), null);
  // 销毁之后再开是新的窗口
  const fresh = r.open(displayHost(), 'a.clock');
  assert.notEqual(fresh, clock);
  assert.equal(r.windows.length, 4);
});

test('换显示方式：离屏的页面改用窗口方式开时销毁重建；窗口方式建好也按页面尺寸设一次大小，不设帧率，大小按页面像素报，停画是隐藏窗口', () => {
  const r = rig([specOf('a.clock', { scale: 2 })]);
  const host = displayHost();
  const offscreen = r.open(host, 'a.clock');
  const held = frameOf(1n);
  offscreen.events.paint(held);
  host.take();
  const win = r.open(host, 'a.clock', 'window');
  assert.notEqual(win, offscreen);
  assert.deepEqual([offscreen.destroyed, held.released, r.dropped], [true, 1, [offscreen.id]]);
  assert.deepEqual(win.spec, { id: 'a.clock', name: 'a.clock', mode: 'window', width: 480, height: 200, scale: 1, sound: false });
  assert.deepEqual(win.take(), ['setContentSize 480x200', 'loadURL fox://a.clock.panel/panel.html', 'show']);
  // 同一个进程换显示方式：不给它发 gone
  assert.deepEqual(host.take(), [{ t: 'pnSize', component: DISPLAY, id: 'a.clock', width: 480, height: 200 }, { t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'loading' }]);
  assert.equal(r.pages.planOf(win.id)?.preview, true);
  // 停画 / 恢复 = 隐藏 / 显示窗口；页面同样得到通知
  win.sent.length = 0;
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.clock', on: false });
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.clock', on: true });
  assert.deepEqual(win.take(), ['hide', 'show']);
  assert.deepEqual(win.sent, [[PAGE_IPC.visibleEvent, false], [PAGE_IPC.visibleEvent, true]]);
  // 窗口方式下帧率不管、被改大小不管；指点事件按页面像素
  r.say(host, { t: 'pnFps', component: DISPLAY, id: 'a.clock', fps: 10 });
  win.size = [300, 100];
  win.events.resized();
  assert.deepEqual(win.take(), []);
  r.say(host, { t: 'pnInput', component: DISPLAY, id: 'a.clock', event: { kind: 'down', x: 30, y: 40 } });
  assert.deepEqual(win.inputs, [{ type: 'mouseDown', x: 30, y: 40, button: 'left', clickCount: 1 }]);
  // 旧窗口迟到的事件不算；迟到的帧放掉，不复制、不交
  r.native.calls.length = 0;
  const late = frameOf(2n);
  offscreen.events.loaded();
  offscreen.events.closed();
  offscreen.events.paint(late);
  offscreen.events.paint(undefined);
  assert.deepEqual([host.take(), late.released, r.native.calls, win.destroyed], [[], 1, [], false]);
  // 换回离屏：再重建一次
  const back = r.open(host, 'a.clock', 'frames');
  assert.deepEqual([win.destroyed, back.spec.mode, r.windows.length], [true, 'frames', 3]);
});

test('页面关掉之后它的窗口迟到的帧放掉：不复制句柄、不交给谁', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  win.events.loaded();
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.clock', linger: false });
  host.take();
  r.native.calls.length = 0;
  const late = frameOf(9n);
  win.events.paint(late);
  assert.deepEqual([late.released, r.native.calls, host.take()], [1, [], []]);
});

test('换显示方式：别的进程用另一种方式来开时，前一个收帧方得到 gone，它手里的帧放掉，页面销毁重建', () => {
  const r = rig();
  const first = displayHost(1);
  const offscreen = r.open(first, 'a.clock');
  offscreen.events.loaded();
  const held = frameOf(1n);
  offscreen.events.paint(held);
  first.take();
  const second = displayHost(2);
  const win = r.open(second, 'a.clock', 'window');
  assert.notEqual(win, offscreen);
  assert.deepEqual([offscreen.destroyed, held.released, win.spec.mode, r.windows.length], [true, 1, 'window', 2]);
  assert.deepEqual(first.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'gone', detail: 'taken over' }]);
  assert.deepEqual(second.take(), [{ t: 'pnSize', component: DISPLAY, id: 'a.clock', width: 480, height: 200 }, { t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'loading' }]);
});

test('出过错的页面：别的进程来开时销毁重建，前一个收帧方得到 gone', () => {
  const r = rig();
  const first = displayHost(1);
  const broken = r.open(first, 'a.clock');
  broken.events.failed('page process gone: crashed 1');
  first.take();
  const second = displayHost(2);
  const win = r.open(second, 'a.clock');
  assert.notEqual(win, broken);
  assert.deepEqual([broken.destroyed, r.windows.length], [true, 2]);
  assert.deepEqual(first.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'gone', detail: 'taken over' }]);
  assert.deepEqual(second.take().map(m => m.t), ['pnSize', 'pnState']);
});

test('同一个进程里别的组件：它被拒的 pnOpen 之后发的 pnClose、pnPaint、pnRelease、pnInput、pnFps 都不算，生效显示方的页面不动', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  win.events.loaded();
  const held = frameOf(1n);
  win.events.paint(held);
  host.take();
  win.take();
  r.say(host, { t: 'pnOpen', component: 'a.other', id: 'a.clock', mode: 'frames' });
  assert.deepEqual(host.take(), [{ t: 'pnState', component: 'a.other', id: 'a.clock', state: 'failed', detail: 'not the active display' }]);
  r.say(host, { t: 'pnRelease', component: 'a.other', id: 'a.clock', seq: 1 });
  r.say(host, { t: 'pnPaint', component: 'a.other', id: 'a.clock', on: false });
  r.say(host, { t: 'pnInput', component: 'a.other', id: 'a.clock', event: { kind: 'down', x: 1, y: 1 } });
  r.say(host, { t: 'pnFps', component: 'a.other', id: 'a.clock', fps: 5 });
  r.say(host, { t: 'pnClose', component: 'a.other', id: 'a.clock', linger: true });
  r.say(host, { t: 'pnClose', component: 'a.other', id: 'a.clock', linger: false });
  // 没写组件的也不算
  r.say(host, { t: 'pnClose', id: 'a.clock', linger: false } as unknown as PanelRequest);
  assert.deepEqual([win.take(), win.inputs, win.destroyed, held.released, r.timers.length, r.dropped, host.take()], [[], [], false, 0, 0, [], []]);
  // 生效的显示方自己的照常
  r.say(host, { t: 'pnRelease', component: DISPLAY, id: 'a.clock', seq: 1 });
  assert.equal(held.released, 1);
});

test('同一个进程里换了显示方：新的显示方来开时接走原页面，前一个组件得到 gone，它之后发的消息不算', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  win.events.loaded();
  host.take();
  win.take();
  r.state.display = 'a.other';
  r.say(host, { t: 'pnOpen', component: 'a.other', id: 'a.clock', mode: 'frames' });
  assert.equal(r.windows.length, 1);
  assert.deepEqual(host.take(), [
    { t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'gone', detail: 'taken over' },
    { t: 'pnSize', component: 'a.other', id: 'a.clock', width: 480, height: 200 },
    { t: 'pnState', component: 'a.other', id: 'a.clock', state: 'ready' },
  ]);
  win.take();
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.clock', linger: false });
  assert.equal(win.destroyed, false);
  win.events.paint(frameOf(3n));
  assert.deepEqual(host.take(), [{ t: 'pnFrame', component: 'a.other', id: 'a.clock', seq: 1, handle: '4242', width: 480, height: 200 }]);
  r.say(host, { t: 'pnClose', component: 'a.other', id: 'a.clock', linger: false });
  assert.equal(win.destroyed, true);
});

test('别的组件进程退出：不是它收帧的页面不动——照常画、不起保留期的计时、帧照常交；它的进程句柄关掉', () => {
  const r = rig([specOf('a.clock'), specOf('a.notes')]);
  const host = displayHost(4321);
  const clock = r.open(host, 'a.clock');
  clock.events.loaded();
  // 另一个进程收过一帧(留下了进程句柄)，之后显示方换回 host 所在的进程
  const other = displayHost(9000);
  const notes = r.open(other, 'a.notes');
  notes.events.paint(frameOf(5n));
  r.open(host, 'a.notes');
  clock.events.paint(frameOf(1n));
  for (const w of [clock, notes]) w.take();
  host.take();
  r.native.calls.length = 0;
  r.pages.hostGone(other);
  r.pages.hostGone(new FakeHost(7, ['a.ime']));
  assert.deepEqual([clock.take(), notes.take(), r.timers.length, r.native.calls], [[], [], 0, ['close 700']]);
  clock.events.paint(frameOf(2n));
  notes.events.paint(frameOf(3n));
  assert.deepEqual(host.take().map(m => (m.t === 'pnFrame' ? `${m.id} ${m.seq}` : m.t)), ['a.clock 2', 'a.notes 2']);
});

test('页面总数上限：同时最多 PANEL_PAGES_MAX 页，再开的回 failed；关掉一页后能再开；已经开着的面板再开不算新的一页', () => {
  assert.equal(PANEL_PAGES_MAX, 12);
  const ids = Array.from({ length: PANEL_PAGES_MAX + 1 }, (_, i) => `a.p${i}`);
  const r = rig(ids.map(id => specOf(id)));
  const host = displayHost();
  for (const id of ids.slice(0, PANEL_PAGES_MAX)) r.open(host, id);
  assert.equal(r.windows.length, PANEL_PAGES_MAX);
  host.take();
  const extra = ids[PANEL_PAGES_MAX] ?? '';
  r.say(host, { t: 'pnOpen', component: DISPLAY, id: extra, mode: 'frames' });
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: extra, state: 'failed', detail: 'too many panels' }]);
  assert.equal(r.windows.length, PANEL_PAGES_MAX);
  assert.deepEqual(r.logs, [`warn ${DISPLAY}: cannot open panel ${extra}: 12 panel pages are open already`]);
  // 开着的再开一次照常
  r.open(host, 'a.p0');
  assert.equal(r.windows.length, PANEL_PAGES_MAX);
  // 保留期里的页面也占名额；关掉一页后有了空位
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.p1', linger: true });
  r.say(host, { t: 'pnOpen', component: DISPLAY, id: extra, mode: 'frames' });
  assert.equal(r.windows.length, PANEL_PAGES_MAX);
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.p2', linger: false });
  r.open(host, extra);
  assert.equal(r.windows.length, PANEL_PAGES_MAX + 1);
});

test('组件变了：计划变了的只重载那一页并换成新计划的登记，别的页不动；计划没变什么都不做', () => {
  const a = specOf('a.clock');
  const b = specOf('a.notes');
  const r = rig([a, b]);
  const host = displayHost();
  const clock = r.open(host, 'a.clock');
  const notes = r.open(host, 'a.notes');
  for (const w of [clock, notes]) {
    w.events.loaded();
    w.take();
  }
  host.take();
  r.adopted.length = 0;
  // 内容一样的新对象：不算变
  r.pages.sync([specOf('a.clock'), specOf('a.notes')]);
  assert.deepEqual([clock.take(), notes.take(), host.take(), r.adopted], [[], [], [], []]);
  // 一块面板的入口文件变了(地址里的修改时间)、多了一个服务
  const service = { id: 'a.ime', kind: 'service' as const, name: 'ime', config: {}, url: 'fox://component/a.ime/page.js?t=1' };
  const next = specOf('a.notes', {}, { root: { ...b.plan.root, url: 'fox://component/a.notes/panel.js?t=2' }, services: [service], remotes: ['keyboard'] });
  r.pages.sync([a, next]);
  assert.deepEqual([clock.take(), notes.take()], [[], ['reload']]);
  assert.deepEqual(r.adopted, [[notes.id, 'a.notes', ['a.notes', 'a.ime']]]);
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.notes', state: 'loading' }]);
  assert.deepEqual(r.pages.planOf(notes.id), next.plan);
  // 重载完了回到 ready
  notes.events.restarted();
  notes.events.loaded();
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.notes', state: 'ready' }]);
  assert.deepEqual(r.restarted, [notes.id]);
  // 只有设置变了的部件所在的那一页重载
  const part = { id: 'a.side', kind: 'sidepage' as const, name: 'side', config: { n: 1 }, url: 'fox://component/a.side/page.js?t=1' };
  r.pages.sync([specOf('a.clock', {}, { parts: { sidepage: [part] } }), next]);
  assert.deepEqual([clock.take(), notes.take()], [['reload'], []]);
  r.pages.sync([specOf('a.clock', {}, { parts: { sidepage: [{ ...part, config: { n: 2 } }] } }), next]);
  assert.deepEqual([clock.take(), notes.take()], [['reload'], []]);
  assert.equal(r.windows.length, 2);
});

test('组件变了：面板不在目录里的页面销毁，收帧方得到 gone；之后这块面板开不了', () => {
  const r = rig([specOf('a.clock'), specOf('a.notes')]);
  const host = displayHost();
  const clock = r.open(host, 'a.clock');
  const notes = r.open(host, 'a.notes');
  const held = frameOf(1n);
  clock.events.paint(held);
  host.take();
  r.pages.sync([specOf('a.notes')]);
  assert.deepEqual([clock.destroyed, notes.destroyed, held.released, r.dropped], [true, false, 1, [clock.id]]);
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'gone', detail: 'removed' }]);
  r.say(host, { t: 'pnOpen', component: DISPLAY, id: 'a.clock', mode: 'frames' });
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'failed', detail: 'no such panel' }]);
  // 保留期里的页面被拿掉时不用通知谁，到点的计时也不出错
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.notes', linger: true });
  r.pages.sync([]);
  assert.deepEqual([notes.destroyed, host.take(), r.timers.map(t => t.cancelled)], [true, [], [true]]);
  r.timers[0]?.fn();
});

test('组件变了：页面尺寸变了改窗口大小并告诉收帧方；帧率上限变了跟着设；纹理倍数或出不出声变了重建窗口，收帧方和画不画照旧', () => {
  const r = rig([specOf('a.kb', { width: 1400, height: 490, scale: 2, fps: 60 })]);
  const host = displayHost();
  const win = r.open(host, 'a.kb');
  win.take();
  host.take();
  // 尺寸(计划里的尺寸跟着变，页面重载)
  r.pages.sync([specOf('a.kb', { width: 1000, height: 350, scale: 2, fps: 60 }, { size: { width: 1000, height: 350 } })]);
  assert.deepEqual(win.take(), ['setContentSize 1000x350', 'reload']);
  assert.deepEqual(host.take(), [{ t: 'pnSize', component: DISPLAY, id: 'a.kb', width: 2000, height: 700 }]);
  // 帧率上限
  r.pages.sync([specOf('a.kb', { width: 1000, height: 350, scale: 2, fps: 30 }, { size: { width: 1000, height: 350 } })]);
  assert.deepEqual([win.take(), host.take()], [['setFrameRate 30'], []]);
  // 倍数：重建，新窗口按新的倍数；同一个收帧方接着收
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.kb', on: false });
  win.take();
  r.pages.sync([specOf('a.kb', { width: 1000, height: 350, scale: 1, fps: 30 }, { size: { width: 1000, height: 350 } })]);
  const rebuilt = r.windows.at(-1);
  assert.ok(rebuilt && rebuilt !== win);
  assert.deepEqual([win.destroyed, rebuilt.spec.scale, r.windows.length], [true, 1, 2]);
  assert.deepEqual(host.take(), [{ t: 'pnSize', component: DISPLAY, id: 'a.kb', width: 1000, height: 350 }, { t: 'pnState', component: DISPLAY, id: 'a.kb', state: 'loading' }]);
  // 重建之前停着画：重建后还是停着
  assert.deepEqual(rebuilt.take().slice(-2), ['stopPainting', 'throttle true']);
  const late = frameOf(1n);
  rebuilt.events.paint(late);
  assert.equal(late.released, 1);
  // 出不出声
  r.pages.sync([specOf('a.kb', { width: 1000, height: 350, scale: 1, fps: 30 }, { size: { width: 1000, height: 350 }, sound: true })]);
  assert.deepEqual([rebuilt.destroyed, r.windows.length, r.windows.at(-1)?.spec.sound], [true, 3, true]);
});

test('组件变了：保留期里的页面要重建时只销毁，不建新窗口(没有人收帧的离屏窗口不空画)；显示方再来开时按新的清单建', () => {
  const r = rig([specOf('a.kb', { scale: 2 })]);
  const host = displayHost();
  const win = r.open(host, 'a.kb');
  r.pages.hostGone(host);
  win.take();
  host.take();
  r.pages.sync([specOf('a.kb', { scale: 1.5 })]);
  assert.deepEqual([win.take(), win.destroyed, r.windows.length, r.dropped, r.timers.map(t => t.cancelled)], [['destroy'], true, 1, [win.id], [true]]);
  assert.deepEqual(host.take(), []);
  assert.equal(r.pages.planOf(win.id), null);
  // 取消了的计时到点不出错；之前的收帧方的消息不算
  r.timers[0]?.fn();
  r.say(host, { t: 'pnPaint', component: DISPLAY, id: 'a.kb', on: true });
  assert.equal(r.windows.length, 1);
  const fresh = r.open(displayHost(5), 'a.kb');
  assert.deepEqual([fresh.spec.scale, r.windows.length], [1.5, 2]);
});

test('面板目录：变了才通知出去；页面的计划变了目录没变时不通知', () => {
  const r = rig([]);
  assert.deepEqual([r.lists, r.pages.list], [[], []]);
  r.pages.sync([specOf('a.clock'), specOf('a.notes')]);
  r.pages.sync([specOf('a.clock'), specOf('a.notes', {}, { remotes: ['keyboard'] })]);
  assert.deepEqual(r.lists, [['a.clock', 'a.notes']]);
  assert.deepEqual(r.pages.list.map(p => p.id), ['a.clock', 'a.notes']);
  r.pages.sync([specOf('a.notes'), specOf('a.clock')]);
  r.pages.sync([specOf('a.notes', { meters: 0.8 }), specOf('a.clock')]);
  r.pages.sync([]);
  assert.deepEqual(r.lists.slice(1), [['a.notes', 'a.clock'], ['a.notes', 'a.clock'], []]);
});

test('加载失败和渲染进程退出：收帧方得到 failed 和原因，记进这块面板的错误并写日志；加载好了清掉；显示方再开时重建窗口', () => {
  const r = rig([specOf('a.clock'), specOf('a.notes')]);
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  host.take();
  win.events.failed('ERR_FILE_NOT_FOUND (-6)');
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'failed', detail: 'ERR_FILE_NOT_FOUND (-6)' }]);
  assert.deepEqual([...r.pages.errors], [['a.clock', 'ERR_FILE_NOT_FOUND (-6)']]);
  assert.deepEqual([r.state.failed, r.logs], [1, ['error a.clock: panel page failed: ERR_FILE_NOT_FOUND (-6)']]);
  // 同样的错误再报一次不重复通知
  win.events.failed('ERR_FILE_NOT_FOUND (-6)');
  assert.deepEqual([host.take(), r.state.failed], [[], 1]);
  // 显示方再开：销毁重建，从加载开始；错误清掉
  const again = r.open(host, 'a.clock');
  assert.notEqual(again, win);
  assert.deepEqual([win.destroyed, [...r.pages.errors], r.state.failed], [true, [], 2]);
  assert.deepEqual(host.take(), [{ t: 'pnSize', component: DISPLAY, id: 'a.clock', width: 480, height: 200 }, { t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'loading' }]);
  again.events.loaded();
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'ready' }]);
  // 渲染进程退出
  again.events.failed('page process gone: crashed 1');
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'failed', detail: 'page process gone: crashed 1' }]);
  assert.deepEqual([...r.pages.errors], [['a.clock', 'page process gone: crashed 1']]);
  // 组件变了重载这一页：重新加载好之后错误清掉
  r.pages.sync([specOf('a.clock', {}, { remotes: ['x'] }), specOf('a.notes')]);
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'loading' }]);
  again.events.loaded();
  assert.deepEqual([host.take(), [...r.pages.errors]], [[{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'ready' }], []]);
  // 出错的页面销毁时错误跟着清掉
  const notes = r.open(host, 'a.notes');
  notes.events.failed('boom');
  assert.equal(r.pages.errors.get('a.notes'), 'boom');
  r.say(host, { t: 'pnClose', component: DISPLAY, id: 'a.notes', linger: false });
  assert.deepEqual([...r.pages.errors], []);
});

test('页面自己重新加载：报给宿主(清掉它登记的总线频道)，状态回到 loading，加载完再回 ready', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock');
  win.events.restarted();
  win.events.loaded();
  host.take();
  assert.deepEqual(r.restarted, [win.id]);
  win.events.restarted();
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'loading' }]);
  win.events.loaded();
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'ready' }]);
  assert.deepEqual(r.restarted, [win.id, win.id]);
});

test('离屏窗口被系统改了大小：改回登记的尺寸，同一页只写一次警告；差几个像素不算', () => {
  const r = rig([specOf('a.kb', { width: 1400, height: 490 })]);
  const win = r.open(displayHost(), 'a.kb');
  win.take();
  win.size = [1403, 487];
  win.events.resized();
  assert.deepEqual([win.take(), r.logs], [[], []]);
  win.size = [1750, 613];
  win.events.resized();
  assert.deepEqual(win.take(), ['setContentSize 1400x490']);
  assert.deepEqual(r.logs, ['warn a.kb: panel page was resized to 1750×613 by the system, restored to 1400×490']);
  win.size = [700, 245];
  win.events.resized();
  assert.deepEqual([win.take(), r.logs.length], [['setContentSize 1400x490'], 1]);
});

test('离屏页面画出的比登记的尺寸多几个像素：把窗口设小这么多；同一个大小的帧只比对一次，一页最多改两次；差得多的不动', () => {
  const r = rig([specOf('a.kb', { width: 1400, height: 490 }), specOf('a.big', { width: 1400, height: 490, scale: 2 }), specOf('a.clock')]);
  const host = displayHost();
  const win = r.open(host, 'a.kb');
  win.take();
  // 正好是登记的尺寸：不动
  win.events.paint(frameOf(1n, 'frame', 1400, 490));
  assert.deepEqual(win.take(), []);
  // 宽高各多 1 像素：窗口各设小 1；还在路上的同样大小的帧不算
  win.events.paint(frameOf(2n, 'frame', 1401, 491));
  win.events.paint(frameOf(3n, 'frame', 1401, 491));
  win.events.resized();
  assert.deepEqual([win.take(), r.logs], [['setContentSize 1399x489'], []]);
  // 设小之后画出的对上了：窗口不动；帧照常交给收帧方，宽高是帧的像素
  host.take();
  win.events.paint(frameOf(4n, 'frame', 1400, 490));
  assert.deepEqual(win.take(), []);
  assert.deepEqual(host.take().map(m => (m.t === 'pnFrame' ? [m.width, m.height] : m.t)), [[1400, 490]]);
  // 被系统改了大小时改回的是设小之后的大小
  win.size = [1750, 613];
  win.events.resized();
  assert.deepEqual(win.take(), ['setContentSize 1399x489']);
  // 别的层的帧不比对
  win.events.paint(frameOf(5n, 'popup', 300, 100));
  assert.deepEqual(win.take(), []);

  // 纹理是 2 倍的：按页面像素算；设小之后反而少了 1 像素的设回去，一页只改两次
  const big = r.open(host, 'a.big');
  big.take();
  big.events.paint(frameOf(6n, 'frame', 2802, 980));
  assert.deepEqual(big.take(), ['setContentSize 1399x490']);
  big.events.paint(frameOf(7n, 'frame', 2798, 980));
  assert.deepEqual(big.take(), ['setContentSize 1400x490']);
  big.events.paint(frameOf(8n, 'frame', 2802, 982));
  big.events.paint(frameOf(9n, 'frame', 2800, 980));
  assert.deepEqual(big.take(), []);

  // 差得多(窗口被系统夹小了)：不归这里
  const clock = r.open(host, 'a.clock');
  clock.take();
  clock.events.paint(frameOf(10n, 'frame', 300, 200));
  clock.events.paint(frameOf(11n, 'frame', 480, 205));
  assert.deepEqual(clock.take(), []);
  // 窗口方式下不比对
  const shown = r.open(host, 'a.clock', 'window');
  shown.take();
  shown.events.paint(frameOf(12n, 'frame', 481, 201));
  assert.deepEqual(shown.take(), []);
});

test('离屏页面的尺寸在清单里改了：按新的尺寸设窗口，之前为了对上画面设小的那一点不留，重新比对', () => {
  const r = rig([specOf('a.kb', { width: 1400, height: 490 })]);
  const win = r.open(displayHost(), 'a.kb');
  win.take();
  win.events.paint(frameOf(1n, 'frame', 1401, 491));
  assert.deepEqual(win.take(), ['setContentSize 1399x489']);
  r.pages.sync([specOf('a.kb', { width: 1000, height: 350 }, { size: { width: 1000, height: 350 } })]);
  assert.deepEqual(win.take(), ['setContentSize 1000x350', 'reload']);
  win.events.paint(frameOf(2n, 'frame', 1001, 350));
  assert.deepEqual(win.take(), ['setContentSize 999x350']);
});

test('窗口被关掉(窗口方式下用户关的)：页面拿掉并注销，收帧方得到 gone；窗口不另外销毁', () => {
  const r = rig();
  const host = displayHost();
  const win = r.open(host, 'a.clock', 'window');
  win.take();
  host.take();
  win.events.closed();
  assert.deepEqual([win.take(), r.dropped, r.pages.planOf(win.id)], [[], [win.id], null]);
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'gone', detail: 'closed' }]);
  // 再开是新的窗口
  assert.notEqual(r.open(host, 'a.clock', 'window'), win);
});

test('开不了的页面：建窗口出错、登记出错都回 failed 并写日志；登记出错的窗口销毁，不留页面', () => {
  const r = rig();
  const host = displayHost();
  r.state.windowError = 'no gpu';
  r.say(host, { t: 'pnOpen', component: DISPLAY, id: 'a.clock', mode: 'frames' });
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'failed', detail: 'cannot open the page' }]);
  r.state.windowError = '';
  r.state.adoptError = 'not registered';
  r.say(host, { t: 'pnOpen', component: DISPLAY, id: 'a.clock', mode: 'frames' });
  assert.deepEqual(host.take(), [{ t: 'pnState', component: DISPLAY, id: 'a.clock', state: 'failed', detail: 'cannot open the page' }]);
  assert.deepEqual(r.windows.map(w => [w.destroyed, w.take()]), [[true, ['destroy']]]);
  assert.deepEqual(r.logs, ['error a.clock: panel page not opened: no gpu', 'error a.clock: panel page not opened: not registered']);
  assert.equal(r.pages.planOf(r.windows[0]?.id ?? 0), null);
  // 之后能正常开
  r.state.adoptError = '';
  r.open(host, 'a.clock');
  assert.equal(r.windows.length, 2);
});

test('外观通知和退出：sendAll 发给全部面板页面；stop 销毁全部页面、关掉进程句柄', () => {
  const r = rig([specOf('a.clock'), specOf('a.notes')]);
  const host = displayHost();
  const clock = r.open(host, 'a.clock');
  const notes = r.open(host, 'a.notes', 'window');
  clock.events.paint(frameOf(1n));
  for (const w of [clock, notes]) w.sent.length = 0;
  const look = { dark: true, locale: 'ja' };
  r.pages.sendAll(PAGE_IPC.lookEvent, look);
  assert.deepEqual([clock.sent, notes.sent], [[[PAGE_IPC.lookEvent, look]], [[PAGE_IPC.lookEvent, look]]]);
  r.native.calls.length = 0;
  r.pages.stop();
  assert.deepEqual([clock.destroyed, notes.destroyed, r.native.calls], [true, true, ['close 700']]);
  assert.deepEqual(r.dropped.sort(), [clock.id, notes.id].sort());
  r.pages.sendAll(PAGE_IPC.lookEvent, look);
  assert.equal(clock.sent.length, 1);
});

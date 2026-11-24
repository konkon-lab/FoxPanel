// SteamVR 组件的测试共用的假对象：面板页面，和一套接好的布局、面板表、会话(假的 SteamVR 和显卡，手动走的时钟)。

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import type { PanelFeed, PanelFrame, PanelInfo, PanelInput, PanelPageState, PanelsCalls, PanelsState, Served } from '@konkon-lab/foxpanel-sdk';
import { DEFAULT_SETTINGS, emptyLayout, type DisplaySettings, type Layout } from '../components/_shared/panels/layout.ts';
import type { VrBackend } from '../components/steamvr/src/api.ts';
import { Control } from '../components/steamvr/src/control.ts';
import { FakeGpu, FakeVr, type Call, type FakeGpuObject, type FakeOverlay } from '../components/steamvr/src/fake.ts';
import { IDENTITY, type Mat34 } from '../components/steamvr/src/geometry.ts';
import { ROLE_LEFT, ROLE_RIGHT } from '../components/steamvr/src/openvr.ts';
import { Session, type HitSettings } from '../components/steamvr/src/session.ts';
import { aimPose } from '../components/steamvr/src/sim.ts';
import { Stage } from '../components/steamvr/src/stage.ts';
import { overlayKey } from '../components/steamvr/src/surface.ts';

export type Side = 'left' | 'right';

export const near = (a: readonly number[], b: readonly number[], eps = 1e-9): void => {
  assert.equal(a.length, b.length);
  a.forEach((v, i) => assert.ok(Math.abs(v - (b[i] ?? NaN)) < eps, `[${a.join(', ')}] ≠ [${b.join(', ')}]`));
};

// 不带旋转、放在 (x, y, z) 的姿态(朝 -Z 看)
export const at = (x: number, y: number, z: number): Mat34 => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z];
// 绕 Y 转 180°(朝 +Z 看)、放在 (x, y, z)
export const turned = (x: number, y: number, z: number): Mat34 => [-1, 0, 0, x, 0, 1, 0, y, 0, 0, -1, z];
// m 平移 (dx, dy, dz)
export const shifted = (m: Mat34, dx: number, dy: number, dz: number): Mat34 => {
  const r: Mat34 = [...m];
  r[3] += dx;
  r[7] += dy;
  r[11] += dz;
  return r;
};

export const textures = (gpu: FakeGpu): Extract<FakeGpuObject, { kind: 'texture' }>[] => gpu.objects.filter(o => o.kind === 'texture');

// performance.now 换成手动走的时钟(ms)
export function fakeClock(t: TestContext): { now: number } {
  const clock = { now: 1000 };
  t.mock.method(performance, 'now', () => clock.now);
  return clock;
}

// 面板目录的一项
export const info = (id: string, patch: Partial<PanelInfo> = {}): PanelInfo => ({
  id, name: id, width: 1400, height: 700, scale: 1, fps: 60, meters: 0.8, minMeters: 0.4, maxMeters: 1.6,
  anchor: 'world', spawn: 'low', glance: false, keep: false, ...patch,
});
// 键盘：1400×700、宽 0.8 米、收起后页面不关；时钟：400×200、宽 0.3 米、出现在正前方
export const KB = info('a.kb', { keep: true });
export const CLOCK = info('a.clock', { width: 400, height: 200, meters: 0.3, minMeters: 0.1, maxMeters: 2, spawn: 'front' });
// 附着在头显上的面板：400×200、宽 0.3 米；手腕上的面板：240×120、宽 0.12 米，附着在左手上、抬手才显示
export const HUD = info('a.hud', { width: 400, height: 200, meters: 0.3, minMeters: 0.1, maxMeters: 1, anchor: 'head' });
export const WRIST = info('a.wrist', { width: 240, height: 120, meters: 0.12, minMeters: 0.08, maxMeters: 0.4, anchor: 'left', glance: true });

// 假的面板页面：send 交一帧，drop 让宿主放掉一帧，report 是宿主报来页面的状态；记下指点事件、还回来的帧、画不画、关没关
export class Page implements PanelFeed {
  readonly id: string;
  width: number;                      // 纹理像素；0 = 宿主还没告诉
  height: number;
  state: PanelPageState = 'ready';
  readonly events: string[] = [];     // 指点事件，如 'move 700,350 held'
  readonly inputs: PanelInput[] = [];
  readonly released: number[] = [];   // 还回来的帧号，按次序
  readonly early: number[] = [];      // 还回来时句柄还没关的帧号
  readonly paints: boolean[] = [];    // 各次 setPainting 给的值
  painting = true;                    // 开着的页面在画
  closed = false;
  private readonly gpu: () => FakeGpu | undefined;
  private readonly handles = new Map<number, bigint>();
  private listener: ((f: PanelFrame) => void) | null = null;
  private dropped: ((seq: number) => void) | null = null;
  private watcher: ((state: PanelPageState, detail?: string) => void) | null = null;

  private readonly base: bigint;      // 帧的句柄从哪个数起

  // gpu：这时在用的显卡设备(查句柄关没关)；base：帧号 seq 的句柄是 base + seq
  constructor(gpu: FakeGpu | (() => FakeGpu | undefined), id = 'a.kb', width = 1400, height = 700, base = 1000n) {
    this.gpu = typeof gpu === 'function' ? gpu : () => gpu;
    this.id = id;
    this.width = width;
    this.height = height;
    this.base = base;
  }

  onFrame(fn: (f: PanelFrame) => void): void {
    this.listener = fn;
  }

  onDrop(fn: (seq: number) => void): void {
    this.dropped = fn;
  }

  onSize(): void {}

  onState(fn: (state: PanelPageState, detail?: string) => void): void {
    this.watcher = fn;
  }

  release(seq: number): void {
    this.released.push(seq);
    const handle = this.handles.get(seq);
    if (handle === undefined || !this.gpu()?.closed.includes(handle)) this.early.push(seq);
  }

  input(e: PanelInput): void {
    this.inputs.push(e);
    if (e.kind === 'move') this.events.push(`move ${e.x},${e.y}${e.held ? ' held' : ''}`);
    else if (e.kind === 'down' || e.kind === 'up') this.events.push(`${e.kind} ${e.x},${e.y}`);
    else this.events.push(e.kind);
  }

  setPainting(on: boolean): void {
    this.paints.push(on);
    this.painting = on;
  }

  setFrameRate(): void {}

  close(): void {
    this.closed = true;
  }

  // 交一帧：帧号 seq，句柄是 base + seq；没有人收时(页面的把手没登记)什么都不做
  send(seq: number, width = this.width, height = this.height): PanelFrame {
    const frame: PanelFrame = { seq, handle: this.base + BigInt(seq), width, height };
    this.handles.set(seq, frame.handle);
    this.listener?.(frame);
    return frame;
  }

  // 宿主放掉了帧号 seq 的那一帧
  drop(seq: number): void {
    this.dropped?.(seq);
  }

  // 宿主报来页面的状态
  report(state: PanelPageState, detail?: string): void {
    this.state = state;
    this.watcher?.(state, detail);
  }
}

export const APP = 'yanuo.foxpanel';
export const DOT = { left: `${APP}:pointer.left`, right: `${APP}:pointer.right` } as const;
export const ACTION = {
  toggle: '/actions/main/in/OverlayToggle', click: '/actions/main/in/OverlayInteract', grab: '/actions/main/in/OverlayGrab',
  quick1: '/actions/main/in/PanelQuick1', quick2: '/actions/main/in/PanelQuick2',
} as const;
export const SOURCE = { left: '/user/hand/left', right: '/user/hand/right' } as const;
export const DEVICE = { left: 1, right: 2 } as const;                 // 两只手的设备序号
export const ROLE = { left: ROLE_LEFT, right: ROLE_RIGHT } as const;
export const TICK = 10;                       // 刷新率 100 Hz 时一帧的毫秒数
export const PROBE = 5000;                    // 探测的间隔(ms)
export const BLOCK = 0x01ffffff;              // 挡住手柄按键时的输入优先级
export const HEAD = at(0, 1.6, 0);
// 两只手一开始在身体两侧、朝身后指：哪块面板都指不着
export const LEFT = turned(-0.2, 1.2, 0.3);
export const RIGHT = turned(0.2, 1.2, 0.3);
export const K = 1 - Math.exp(-0.25);         // 抓着面板时一帧(10 毫秒)靠近目标的比例：时间常数 0.04 秒

// 测试里显示方的设置：默认值，1 号快捷位指向键盘
export const SETTINGS: DisplaySettings = { ...DEFAULT_SETTINGS, quick: ['a.kb', null] };
// 显示方的选项里改几项
export const settingsWith = (options: Partial<DisplaySettings['options']>, rest: Partial<Omit<DisplaySettings, 'options'>> = {}): DisplaySettings => (
  { ...SETTINGS, ...rest, options: { ...SETTINGS.options, ...options } }
);

export interface RigOptions {
  list?: PanelInfo[];           // 面板目录，默认是键盘和时钟
  settings?: DisplaySettings;   // 显示方的设置，默认是 SETTINGS
  hit?: HitSettings;            // 求交的两条退路，默认都关
  everyFrame?: boolean;         // 纹理每个显示帧都交给 SteamVR，默认是
  native?: boolean;             // 附着的面板交给 SteamVR 带着设备走，默认是
  follow?: boolean;             // 面板空间跟着游玩空间，默认是
  layout?: Layout;              // 一开始的布局，默认是空的、总开关收起着
  backend?: VrBackend;          // 探测和建连接的方式，默认是这里的假 SteamVR 和假显卡
  tap?: (feed: PanelFeed) => PanelFeed;   // 开出来的页面过它一遍再给面板表
}

// 一套假的 SteamVR、显卡、面板页面和组件数据，上面接好布局(Control)、面板表(Stage)、会话(Session)
export class Rig {
  readonly calls: Call[] = [];           // Vr 和 Gpu 的调用，按发生的次序
  readonly logs: string[] = [];          // 日志，带级别的写成 'error: …'
  readonly vrs: FakeVr[] = [];           // 每次连接各一个
  readonly gpus: FakeGpu[] = [];
  readonly pages: Page[] = [];           // 开过的面板页面，按次序；第 n 个的帧的句柄从 n × 1000 起
  readonly opened: string[] = [];        // 开过页面的面板 id，按次序
  readonly published: PanelsState[] = [];   // 发布的 panels 状态，按次序
  readonly status: string[] = [];        // 上报给状态栏的：'ok 2'、'idle'
  readonly stored: unknown[] = [];       // 存进组件数据的布局，按次序
  list: PanelInfo[];
  running = true;                        // SteamVR 在不在运行
  changed = 0;                           // 连接状态变化的通知次数
  connects = 0;                          // 连接的次数
  hz = 100;
  luid = 0x1234n;
  head: Mat34 = HEAD;
  connectError: string | null = null;    // 连接时抛出的错误
  gpuError: string | null = null;        // 建显卡设备时抛出的错误
  pageSize: Record<string, [number, number]> = {};   // 面板 id → 它的页面报的纹理像素；没写的照面板目录
  prepare: (vr: FakeVr) => void = () => {};   // 每次连接时对新的 FakeVr 多做的设置
  readonly control: Control;
  readonly stage: Stage;
  readonly session: Session;
  private impl: Served<PanelsCalls> | null = null;
  private readonly hands: Record<Side, Mat34 | null> = { left: LEFT, right: RIGHT };
  private since = 0;                     // 最近一次连接开始时 calls 的长度
  private readonly clock: { now: number };
  private readonly t: TestContext;

  constructor(t: TestContext, options: RigOptions = {}) {
    this.t = t;
    this.clock = fakeClock(t);
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
    this.list = options.list ?? [KB, CLOCK];
    const log = (text: string, level?: string): void => { this.logs.push(level ? `${level}: ${text}` : text); };
    this.control = new Control({
      serve: calls => {
        this.impl = calls;
        return { active: true, watch: () => () => undefined, publish: state => { this.published.push(state); }, close: () => undefined };
      },
      storage: { set: (key, value) => { this.stored.push(key === 'layout' ? value : [key, value]); return Promise.resolve(); } },
      log,
      display: 'SteamVR',
      settings: options.settings ?? SETTINGS,
      list: () => this.list,
      connected: () => this.session.connected,
      report: (connected, shown) => { this.status.push(connected ? `ok ${shown}` : 'idle'); },
    }, options.layout ?? emptyLayout(true));
    this.stage = new Stage({
      board: this.control,
      open: id => {
        const item = this.list.find(p => p.id === id);
        const [width, height] = this.pageSize[id] ?? [item?.width ?? 0, item?.height ?? 0];
        const page = new Page(() => this.gpus.at(-1), id, width, height, 1000n * BigInt(this.pages.length + 1));
        this.pages.push(page);
        this.opened.push(id);
        return options.tap ? options.tap(page) : page;
      },
      log,
      everyFrame: options.everyFrame ?? true,
      native: options.native ?? true,
    });
    this.session = new Session({
      log, stage: this.stage, board: this.control,
      hit: options.hit ?? { check: false, native: false },
      follow: options.follow ?? true,
      changed: () => {
        this.changed++;
        this.control.link();
      },
      actionManifest: 'res/actions.json',
      appManifest: 'res/manifest.vrmanifest',
      pointerImage: 'res/pointer.png',
    }, options.backend ?? {
      running: () => this.running,
      connect: () => {
        this.connects++;
        this.since = this.calls.length;
        if (this.connectError !== null) throw new Error(this.connectError);
        const vr = new FakeVr(this.calls);
        vr.hz = this.hz;
        vr.luid = this.luid;
        vr.setPose(0, this.head);
        for (const side of ['left', 'right'] as const) {
          vr.setRole(ROLE[side], DEVICE[side]);
          vr.setTip(DEVICE[side], IDENTITY);
          vr.setPose(DEVICE[side], this.hands[side]);
        }
        this.prepare(vr);
        this.vrs.push(vr);
        return vr;
      },
      gpu: luid => {
        if (this.gpuError !== null) throw new Error(this.gpuError);
        const gpu = new FakeGpu(luid, this.calls);
        this.gpus.push(gpu);
        return gpu;
      },
    });
    this.control.flush();
  }

  get vr(): FakeVr {
    const vr = this.vrs.at(-1);
    assert.ok(vr);
    return vr;
  }

  get gpu(): FakeGpu {
    const gpu = this.gpus.at(-1);
    assert.ok(gpu);
    return gpu;
  }

  // 一块面板最近开的那一页
  page(id = 'a.kb'): Page {
    const page = this.pages.findLast(p => p.id === id);
    assert.ok(page, `${id} 没开过页面`);
    return page;
  }

  // 这次连接里一块面板的悬浮窗口；没建过时为 undefined
  overlay(id: string): FakeOverlay | undefined {
    return this.vr.find(overlayKey(id));
  }

  // 这次连接里一块面板的悬浮窗口
  panel(id = 'a.kb'): FakeOverlay {
    const o = this.overlay(id);
    assert.ok(o, `${id} 没有悬浮窗口`);
    return o;
  }

  dot(side: Side): FakeOverlay {
    const o = this.vr.find(DOT[side]);
    assert.ok(o);
    return o;
  }

  // 远程服务 panels 的实现
  get remote(): Served<PanelsCalls> {
    assert.ok(this.impl);
    return this.impl;
  }

  // 最近发布的 panels 状态
  get panels(): PanelsState {
    const state = this.published.at(-1);
    assert.ok(state);
    return state;
  }

  // 最近发布的状态里各块面板的「id 打开 显示」
  views(): string[] {
    return this.panels.panels.map(p => `${p.id} ${p.open} ${p.visible}`);
  }

  // 过 ms 毫秒(时钟和定时器一起走)
  wait(ms: number): void {
    this.clock.now += ms;
    this.t.mock.timers.tick(ms);
  }

  // 过 n 个显示帧
  frame(n = 1): void {
    for (let i = 0; i < n; i++) this.wait(TICK);
  }

  // 一只手的姿态；null = 姿态无效
  hand(side: Side, mat: Mat34 | null): void {
    this.hands[side] = mat;
    this.vrs.at(-1)?.setPose(DEVICE[side], mat);
  }

  // 一块面板的悬浮窗口这一刻在面板空间里的姿态(跟着设备的按那个设备这一刻的姿态算)
  where(id: string): Mat34 {
    const pose = this.vr.where(this.panel(id));
    assert.ok(pose, `${id} 跟着的设备不在`);
    return pose;
  }

  // 一只手指着一块面板纹理上 (x, y) 这个像素的正中；返回手的姿态(在落点正前方 0.3 米，朝向和面板相同)
  aim(side: Side, id: string, x: number, y: number): Mat34 {
    const o = this.panel(id);
    const item = this.list.find(p => p.id === id);
    assert.ok(item);
    const pose = aimPose(this.where(id), o.meters, item.height / item.width, (x + 0.5) / item.width, (y + 0.5) / item.height);
    this.hand(side, pose);
    return pose;
  }

  // 一只手移到哪块面板都指不着的地方
  away(side: Side): void {
    this.hand(side, side === 'left' ? LEFT : RIGHT);
  }

  setHead(mat: Mat34): void {
    this.head = mat;
    this.vr.setPose(0, mat);
  }

  press(action: keyof typeof ACTION, side: Side, down: boolean): void {
    this.vr.press(ACTION[action], SOURCE[side], down);
  }

  // 按一下再松开，各占一帧
  tap(action: keyof typeof ACTION, side: Side = 'right'): void {
    this.press(action, side, true);
    this.frame();
    this.press(action, side, false);
    this.frame();
  }

  // 从第 from 条起的调用(方法名)
  names(from: number): string[] {
    return this.calls.slice(from).map(c => c.name);
  }

  // 最近一次连接里对 Vr 调用 name 的各次参数
  args(name: Parameters<FakeVr['args']>[0]): (readonly unknown[])[] {
    return this.calls.slice(this.since).filter(c => c.on === 'vr' && c.name === name).map(c => c.args);
  }

  // 最近一次连接里对一个悬浮窗口调用 name 的次数
  count(name: 'show' | 'hide' | 'place' | 'placeOn' | 'setWidth' | 'setTexture' | 'intersect' | 'destroy', overlay: FakeOverlay): number {
    return this.args(name).filter(a => a[0] === overlay.handle).length;
  }

  // 每一帧更新动作集时给的优先级，按次序
  priorities(): unknown[] {
    return this.args('activate').map(a => a[1]);
  }
}

// 连上 SteamVR
export function connected(t: TestContext, options: RigOptions = {}): Rig {
  const rig = new Rig(t, options);
  rig.session.start();
  return rig;
}

// 连上并用右手的总开关键显示出面板目录里的面板(一帧建一个悬浮窗口)
export function shown(t: TestContext, options: RigOptions = {}): Rig {
  const rig = connected(t, options);
  rig.tap('toggle');
  rig.frame(rig.list.length);
  for (const p of rig.list) assert.equal(rig.panel(p.id).visible, true, p.id);
  return rig;
}

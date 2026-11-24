import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Caller, MainContext, PanelInfo, PanelsCalls, PanelsState, Served } from '@konkon-lab/foxpanel-sdk';
import { FakeGpu, FakeVr, type Call, type FakeOverlay } from '../components/steamvr/src/fake.ts';
import { arrange, IDENTITY } from '../components/steamvr/src/geometry.ts';
import { appManifestName, mount, readAttach, readEveryFrame, readFollow, readHit, type Carry } from '../components/steamvr/src/main.ts';
import type { ConnectOptions } from '../components/steamvr/src/api.ts';
import { EVENT_QUIT } from '../components/steamvr/src/openvr.ts';
import { aimPose, squareHit } from '../components/steamvr/src/sim.ts';
import { overlayKey } from '../components/steamvr/src/surface.ts';
import { ACTION, at, BLOCK, CLOCK, DEVICE, DOT, HEAD, HUD, info, KB, LEFT, near, Page, PROBE, RIGHT, ROLE, SOURCE, TICK, type Side } from './vr-helpers.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const WHO: Caller = { component: 'a.list', where: 'panel' };
// 组件的设置：默认值，1 号快捷位指向键盘
const CONFIG = { quick1: 'a.kb', quick2: '', limit: 8, recenter: 'away', blockInput: true, grabDelay: '0.15', stretch: true, snap: true, hitTest: 'js', hitCheck: false };

// 假的上下文(面板目录、远程服务、组件数据、总线、状态栏)和假的 SteamVR、显卡，组件装在上面
class Rig {
  readonly calls: Call[] = [];             // Vr 和 Gpu 的调用，按发生的次序
  readonly status: unknown[] = [];         // 上报给状态栏的项
  readonly opened: string[] = [];          // 开过的面板页面：「面板 id 显示方式」
  readonly pages: Page[] = [];             // 开过的面板页面，按次序
  readonly published: PanelsState[] = [];  // 发布的 panels 状态，按次序
  readonly served: string[] = [];          // 登记提供的远程服务
  readonly logs: string[] = [];            // 日志，带级别的写成 'warn: …'
  readonly reads: string[] = [];           // 从组件数据读过的键
  readonly writes: [string, unknown][] = [];   // 往组件数据写的键和值
  readonly vrs: FakeVr[] = [];
  readonly gpus: FakeGpu[] = [];
  readonly carry: Carry = { layout: null };
  list: PanelInfo[] = [KB, CLOCK];         // 面板目录
  config: Record<string, unknown> = CONFIG;
  stored: unknown = null;                  // 组件数据里的布局
  readError: string | null = null;         // 读组件数据时的错误
  running = true;                          // SteamVR 在不在运行
  connects = 0;
  readonly follows: boolean[] = [];        // 每次连接时给的「面板空间跟着游玩空间」
  readonly links: ConnectOptions['log'][] = [];   // 每次连接时给的日志函数
  active = true;                           // 远程服务 panels 的登记生效着没有(宿主告诉组件的)
  private impl: Served<PanelsCalls> | null = null;
  private readonly activeWatchers = new Set<(active: boolean) => void>();
  exe = path.join('app', 'node_modules', 'electron', 'dist', 'electron.exe');   // 程序的可执行文件(默认是源码运行时的位置)
  private readonly listWatchers = new Set<(list: readonly PanelInfo[]) => void>();
  private readonly busWatchers = new Map<string, (data: unknown) => void>();
  private disposers: (() => void)[] = [];  // 组件登记的清理函数
  private readonly clock = { now: 1000 };
  private readonly t: TestContext;

  constructor(t: TestContext) {
    this.t = t;
    t.mock.method(performance, 'now', () => this.clock.now);
    t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  }

  // 装上组件；布局读回来之后才开始
  async mount(): Promise<void> {
    const list = (): PanelInfo[] => this.list;
    const active = (): boolean => this.active;
    const ctx = {
      appDir: 'app',
      config: this.config,
      log: (text: string, level?: string) => { this.logs.push(level ? `${level}: ${text}` : text); },
      panels: {
        get list() { return list(); },
        watch: (fn: (list: readonly PanelInfo[]) => void) => {
          this.listWatchers.add(fn);
          return () => { this.listWatchers.delete(fn); };
        },
        open: (id: string, mode: string) => {
          this.opened.push(`${id} ${mode}`);
          const item = this.list.find(p => p.id === id);
          const page = new Page(() => this.gpus.at(-1), id, item?.width ?? 0, item?.height ?? 0, 1000n * BigInt(this.pages.length + 1));
          this.pages.push(page);
          return page;
        },
      },
      status: { set: (item: unknown) => { this.status.push(item); } },
      effect: (fn: () => () => void) => { this.disposers.push(fn()); },
      storage: {
        get: (key: string) => {
          this.reads.push(key);
          return this.readError === null ? Promise.resolve(this.stored) : Promise.reject(new Error(this.readError));
        },
        set: (key: string, value: unknown) => {
          this.writes.push([key, value]);
          return Promise.resolve();
        },
      },
      bus: {
        on: (channel: string, fn: (data: unknown) => void) => {
          this.busWatchers.set(channel, fn);
          return () => { this.busWatchers.delete(channel); };
        },
      },
      relay: {
        use: () => assert.fail('SteamVR 组件不用别的远程服务'),
        serve: (name: string, impl: Served<PanelsCalls>) => {
          this.served.push(name);
          this.impl = impl;
          return {
            get active() { return active(); },
            watch: (fn: (active: boolean) => void) => {
              this.activeWatchers.add(fn);
              return () => { this.activeWatchers.delete(fn); };
            },
            publish: (state: PanelsState) => { this.published.push(state); },
            close: () => undefined,
          };
        },
      },
    };
    mount(ctx as unknown as MainContext, {
      carry: this.carry,
      exe: this.exe,
      backend: {
        running: () => this.running,
        connect: options => {
          this.connects++;
          this.follows.push(options.follow);
          this.links.push(options.log);
          const vr = new FakeVr(this.calls);
          vr.hz = 100;
          vr.setPose(0, HEAD);
          for (const side of ['left', 'right'] as const) {
            vr.setRole(ROLE[side], DEVICE[side]);
            vr.setTip(DEVICE[side], IDENTITY);
            vr.setPose(DEVICE[side], side === 'left' ? LEFT : RIGHT);
          }
          vr.hit = (overlay, source, dir) => squareHit(source, dir, overlay.pose, overlay.meters);
          this.vrs.push(vr);
          return vr;
        },
        gpu: luid => {
          const gpu = new FakeGpu(luid, this.calls);
          this.gpus.push(gpu);
          return gpu;
        },
      },
    });
    await this.settle();
  }

  // 等读组件数据的回话处理完
  async settle(): Promise<void> {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  }

  // 卸载：组件自己的清理函数
  unmount(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
    this.listWatchers.clear();
    this.busWatchers.clear();
    this.activeWatchers.clear();
  }

  // 宿主告诉组件：远程服务 panels 的登记生效了 / 等着了；值没变时不说
  activate(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    for (const fn of [...this.activeWatchers]) fn(on);
  }

  // 面板目录变了
  catalog(list: PanelInfo[]): void {
    this.list = list;
    for (const fn of [...this.listWatchers]) fn(list);
  }

  // 核心在总线上发的通知
  bus(channel: string, data: unknown): void {
    this.busWatchers.get(channel)?.(data);
  }

  // 组件提供的 panels 的调用
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

  page(id = 'a.kb'): Page {
    const page = this.pages.findLast(p => p.id === id);
    assert.ok(page, `${id} 没开过页面`);
    return page;
  }

  get vr(): FakeVr {
    const vr = this.vrs.at(-1);
    assert.ok(vr);
    return vr;
  }

  overlay(id: string): FakeOverlay | undefined {
    return this.vr.find(overlayKey(id));
  }

  panel(id = 'a.kb'): FakeOverlay {
    const o = this.overlay(id);
    assert.ok(o, `${id} 没有悬浮窗口`);
    return o;
  }

  // 对 Vr 调 name 的各次参数
  args(name: string): (readonly unknown[])[] {
    return this.calls.filter(c => c.on === 'vr' && c.name === name).map(c => c.args);
  }

  // 最近一次更新动作集时给的优先级
  priority(): unknown {
    return this.calls.findLast(c => c.on === 'vr' && c.name === 'activate')?.args[1];
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

  press(action: keyof typeof ACTION, side: Side, down: boolean): void {
    this.vr.press(ACTION[action], SOURCE[side], down);
  }

  // 按一下再松开，各占一帧
  tap(action: keyof typeof ACTION = 'toggle', side: Side = 'right'): void {
    this.press(action, side, true);
    this.frame();
    this.press(action, side, false);
    this.frame();
  }

  // 一只手指着一块面板纹理上 (x, y) 这个像素的正中
  aim(side: Side, id: string, x: number, y: number): void {
    const o = this.panel(id);
    const item = this.list.find(p => p.id === id);
    assert.ok(item);
    this.vr.setPose(DEVICE[side], aimPose(o.pose, o.meters, item.height / item.width, (x + 0.5) / item.width, (y + 0.5) / item.height));
  }
}

// 装上并连上
async function mounted(t: TestContext, setup: (rig: Rig) => void = () => {}): Promise<Rig> {
  const rig = new Rig(t);
  setup(rig);
  await rig.mount();
  return rig;
}

// ---------- 装上和卸载 ----------

test('SteamVR 应用清单：可执行文件在程序目录里用按源码目录写的那份，在外面(安装版)用按安装目录写的那份', async t => {
  const dev = path.join('D:\\src\\foxpanel', 'node_modules', 'electron', 'dist', 'electron.exe');
  assert.equal(appManifestName('D:\\src\\foxpanel', dev), 'manifest.vrmanifest');
  assert.equal(appManifestName('C:\\Programs\\FoxPanel\\resources\\app', 'C:\\Programs\\FoxPanel\\FoxPanel.exe'), 'manifest.packed.vrmanifest');
  assert.equal(appManifestName('C:\\Programs\\FoxPanel\\resources\\app', 'D:\\elsewhere\\FoxPanel.exe'), 'manifest.packed.vrmanifest');
  // 两份清单只有启动命令不同；按安装目录写的那份相对它自己的位置指到安装目录最外层的 <产品名>.exe
  const read = (file: string): { applications: Record<string, unknown>[] } => JSON.parse(fs.readFileSync(path.join(ROOT, 'resources', 'vr', file), 'utf8')) as { applications: Record<string, unknown>[] };
  const source = read('manifest.vrmanifest').applications[0] ?? {};
  const packed = read('manifest.packed.vrmanifest').applications[0] ?? {};
  const { binary_path_windows: sourceBinary, arguments: sourceArgs, ...sourceRest } = source;
  const { binary_path_windows: packedBinary, ...packedRest } = packed;
  assert.deepEqual(packedRest, sourceRest);
  assert.deepEqual([sourceBinary, sourceArgs], ['../../node_modules/electron/dist/electron.exe', '../..']);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { productName: string; build: { asar: boolean; files: string[] } };
  const install = path.resolve('C:\\Programs\\FoxPanel');
  assert.equal(path.resolve(install, 'resources', 'app', 'resources', 'vr', String(packedBinary)), path.join(install, `${pkg.productName}.exe`));
  // 这个位置关系靠程序文件按普通文件夹放、resources/ 整个进安装包
  assert.equal(pkg.build.asar, false);
  assert.ok(pkg.build.files.includes('resources/**/*'));

  // 安装版登记的是按安装目录写的那份
  const rig = new Rig(t);
  rig.exe = path.join('FoxPanel.exe');
  await rig.mount();
  assert.deepEqual(rig.args('register'), [[path.join('app', 'resources', 'vr', 'manifest.packed.vrmanifest'), 'yanuo.foxpanel']]);
  rig.unmount();
});

test('SteamVR 组件：布局读回来才登记远程服务 panels、开始连；状态栏上是连接灯和显示着的面板数', async t => {
  const rig = new Rig(t);
  const waiting = rig.mount();
  assert.deepEqual([rig.reads, rig.served, rig.connects], [['layout'], [], 0]);
  assert.deepEqual(rig.status, [{ led: 'idle', label: 'STEAMVR' }]);
  await waiting;
  assert.deepEqual([rig.served, rig.connects, rig.opened], [['panels'], 1, []]);
  assert.deepEqual(rig.status.slice(1), [{ led: 'ok', label: 'STEAMVR', value: '0' }]);   // 和上一次一样的不重复报
  const res = (name: string): string => path.join('app', 'resources', 'vr', name);
  assert.deepEqual(rig.args('register'), [[res('manifest.vrmanifest'), 'yanuo.foxpanel']]);
  assert.deepEqual(rig.args('setManifest'), [[res('actions.json')]]);
  assert.deepEqual(rig.args('setImage').map(a => a[1]), [res('pointer.png'), res('pointer.png')]);
  assert.deepEqual([rig.panels.display, rig.panels.connected, rig.panels.stowed, rig.views()], ['SteamVR', true, true, ['a.kb true false', 'a.clock true false']]);

  rig.tap();
  rig.frame();
  assert.deepEqual(rig.opened, ['a.kb frames', 'a.clock frames']);
  assert.deepEqual(rig.status.at(-1), { led: 'ok', label: 'STEAMVR', value: '2' });
  rig.unmount();
  assert.equal(rig.vr.closed, true);
  assert.deepEqual(rig.status.at(-1), { led: 'idle', label: 'STEAMVR' });
  assert.deepEqual(rig.pages.map(p => [p.painting, p.closed]), [[false, false], [false, false]]);   // 卸载时页面不关：宿主放开页面并保留一段时间
});

test('SteamVR 组件：存着的布局照用——全局锁、常显、位置和宽度；读不出来时记一行警告，按空的布局开始', async t => {
  const pose = at(0.2, 1.1, -0.7);
  const rig = await mounted(t, r => {
    r.stored = { locked: true, panels: { 'a.kb': { open: true, pinned: true, locked: false, meters: 1.1, pose }, 'a.clock': { open: false, pinned: false, locked: true, meters: null, pose: null } } };
  });
  rig.frame(2);
  // 常显的键盘连上就显示在存着的位置；关着的时钟不显示
  assert.deepEqual([rig.panel().visible, rig.panel().pose, rig.panel().meters], [true, pose, 1.1]);
  assert.deepEqual([rig.panels.locked, rig.views()], [true, ['a.kb true true', 'a.clock false false']]);
  assert.deepEqual(rig.panels.panels.map(p => [p.pinned, p.locked, p.meters]), [[true, false, 1.1], [false, true, 0.3]]);
  rig.unmount();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const broken = await mounted(t, r => { r.readError = '读不了'; });
  assert.deepEqual(broken.logs, ['warn: cannot read layout: 读不了', 'steamvr connected']);
  assert.deepEqual(broken.views(), ['a.kb true false', 'a.clock true false']);
  broken.unmount();
});

test('SteamVR 组件：布局还没读回来就卸载，不登记也不连', async t => {
  const rig = new Rig(t);
  const waiting = rig.mount();
  rig.unmount();
  await waiting;
  rig.frame(3);
  assert.deepEqual([rig.served, rig.connects, rig.status], [[], 0, [{ led: 'idle', label: 'STEAMVR' }]]);
  assert.equal(rig.carry.layout, null);
});

// ---------- 设置 ----------

test('设置：挡游戏按键、快捷位、上限、求交方式照组件的设置；状态里的选项照设置给出', async t => {
  const rig = await mounted(t, r => {
    r.config = { ...CONFIG, blockInput: false, quick1: 'a.clock', quick2: 'a.kb', limit: 5, grabDelay: '0.4', stretch: false, snap: false, recenter: 'always', hitTest: 'native' };
  });
  assert.deepEqual(rig.panels.options, { blockInput: false, grabDelay: 0.4, stretch: false, snap: false, recenter: 'always' });
  assert.equal(rig.panels.limit, 5);
  rig.tap('quick1');
  assert.equal(rig.panel('a.clock').visible, true);
  assert.equal(rig.overlay('a.kb'), undefined);
  assert.deepEqual(rig.panels.panels.map(p => p.quick), [2, 1]);
  rig.aim('left', 'a.clock', 200, 100);
  rig.frame();
  assert.equal(rig.priority(), 0);                                // 指着也不挡
  assert.ok(rig.args('intersect').length > 0);                    // 求交问的是 SteamVR
  assert.deepEqual(rig.page('a.clock').events.at(-1), 'move 200,100');
  rig.unmount();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const plain = await mounted(t);
  plain.tap('quick1');
  plain.aim('left', 'a.kb', 700, 350);
  plain.frame();
  assert.deepEqual([plain.priority(), plain.args('intersect').length], [BLOCK, 0]);
  plain.unmount();
});

test('设置里求交的两条退路：hitCheck 是布尔，hitTest 是 js 或 native，别的值都当默认', () => {
  assert.deepEqual(readHit({ hitCheck: true, hitTest: 'native' }), { check: true, native: true });
  assert.deepEqual(readHit({ hitCheck: false, hitTest: 'js' }), { check: false, native: false });
  assert.deepEqual(readHit({ hitCheck: 'yes', hitTest: 'NATIVE' }), { check: false, native: false });
  assert.deepEqual(readHit({}), { check: false, native: false });
  assert.deepEqual(readHit(null), { check: false, native: false });
});

test('设置里纹理怎么交：textureSubmit 是 changed 时画面变了才交，别的值都是每个显示帧都交', async t => {
  assert.deepEqual([readEveryFrame({ textureSubmit: 'changed' }), readEveryFrame({ textureSubmit: 'always' }), readEveryFrame({ textureSubmit: true }), readEveryFrame({}), readEveryFrame(null)],
    [false, true, true, true, true]);
  const rig = await mounted(t, r => {
    r.list = [KB];
    r.config = { ...CONFIG, textureSubmit: 'changed' };
  });
  rig.tap();
  rig.page('a.kb').send(1);
  rig.frame(2);
  const o = rig.panel('a.kb');
  const count = (): number => rig.args('setTexture').filter(a => a[0] === o.handle).length;
  assert.equal(count(), 1);
  rig.frame(20);
  assert.equal(count(), 2);                                        // 同一帧隔 30 毫秒复制的第二次
  rig.unmount();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const plain = await mounted(t, r => { r.list = [KB]; });
  plain.tap();
  plain.page('a.kb').send(1);
  plain.frame(22);
  const kb = plain.panel('a.kb');
  // 每个显示帧都交：22 帧里除了两次复制开始的那两帧
  assert.equal(plain.args('setTexture').filter(a => a[0] === kb.handle).length, 20);
  plain.unmount();
});

test('设置改了(组件在同一个进程里重新加载)：还没存盘的布局马上存；接着用留下的布局，面板不用再按总开关键，位置不变', async t => {
  const rig = await mounted(t);
  rig.tap();
  rig.frame();
  const poses = [rig.panel('a.kb').pose, rig.panel('a.clock').pose];
  const pages = [...rig.pages];
  void rig.remote.set(WHO, 'a.clock', { meters: 0.5 });
  rig.frame();
  assert.equal(rig.writes.length, 0);                             // 防抖的 500 毫秒还没到
  rig.unmount();
  assert.deepEqual(rig.writes.map(w => w[0]), ['layout']);
  assert.equal((rig.writes[0]?.[1] as { panels: Record<string, { meters: number }> }).panels['a.clock']?.meters, 0.5);
  assert.ok(rig.carry.layout);
  assert.deepEqual(rig.pages.map(p => p.painting), [false, false]);

  rig.config = { ...CONFIG, blockInput: false };
  await rig.mount();
  assert.equal(rig.carry.layout, null);
  assert.deepEqual([rig.reads, rig.connects], [['layout'], 2]);   // 没有再读组件数据
  rig.frame(2);
  assert.deepEqual([rig.panel('a.kb').pose, rig.panel('a.clock').pose], poses);
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible, rig.panel('a.clock').meters], [true, true, 0.5]);
  // 面板的页面重新向宿主要一次(宿主那边留着那一页，接回去)；前一次的把手停着画
  assert.deepEqual(rig.opened, ['a.kb frames', 'a.clock frames', 'a.kb frames', 'a.clock frames']);
  assert.deepEqual([pages.map(p => p.painting), rig.pages.slice(2).map(p => p.painting)], [[false, false], [true, true]]);
  assert.deepEqual([rig.panels.stowed, rig.panels.options.blockInput, rig.views()], [false, false, ['a.kb true true', 'a.clock true true']]);
  rig.unmount();
});

// ---------- 远程服务 panels ----------

test('SteamVR 没连上时不开面板页面；状态里面板都列出来、都不在显示，布局照常能改，当场发布', async t => {
  const rig = await mounted(t, r => { r.running = false; });
  rig.wait(PROBE * 3);
  assert.equal(rig.connects, 0);
  assert.deepEqual([rig.opened, rig.served], [[], ['panels']]);
  assert.deepEqual([rig.panels.connected, rig.panels.stowed, rig.views()], [false, true, ['a.kb true false', 'a.clock true false']]);
  void rig.remote.toggleAll(WHO);
  assert.deepEqual([rig.opened, rig.panels.stowed, rig.views()], [[], false, ['a.kb true false', 'a.clock true false']]);
  void rig.remote.open(WHO, 'a.clock', false);
  assert.deepEqual(rig.views(), ['a.kb true false', 'a.clock false false']);
  // SteamVR 起来：连上时照布局显示
  rig.running = true;
  rig.wait(PROBE);
  rig.frame(2);
  assert.deepEqual([rig.connects, rig.opened], [1, ['a.kb frames']]);
  assert.equal(rig.panel().visible, true);
  assert.deepEqual([rig.panels.connected, rig.views()], [true, ['a.kb true true', 'a.clock false false']]);
  rig.unmount();
});

test('远程服务 panels：open、toggleAll、summon、reset、set、lockAll 作用到布局上，下一帧悬浮窗口跟上；参数不对的不理', async t => {
  const rig = await mounted(t);
  void rig.remote.toggleAll(WHO);
  rig.frame(2);
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, true]);
  // 面板自己请显示方收起(页面的 hide)：关掉，不在收起的那一组里
  void rig.remote.open({ component: 'a.clock', where: 'panel' }, 'a.clock', false);
  rig.frame();
  assert.equal(rig.panel('a.clock').visible, false);
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock false false']]);
  // 总开关：收起的那一块回来，键盘不动、不算收起着
  void rig.remote.toggleAll(WHO);
  rig.frame();
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, true]);
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock true true']]);
  // 再调：两块整组收起
  void rig.remote.toggleAll(WHO);
  rig.frame();
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible, rig.panels.stowed], [false, false, true]);
  // 总开关收起着时打开一块：它单独显示
  void rig.remote.open(WHO, 'a.clock', true);
  rig.frame();
  assert.deepEqual([rig.panel('a.clock').visible, rig.views()], [true, ['a.kb true false', 'a.clock true true']]);
  void rig.remote.toggleAll(WHO);
  rig.frame();
  assert.deepEqual(rig.views(), ['a.kb true true', 'a.clock true true']);

  void rig.remote.set(WHO, 'a.kb', { meters: 5, pinned: true });   // 宽度夹在清单的范围里
  void rig.remote.lockAll(WHO, true);
  rig.frame();
  assert.deepEqual([rig.panel('a.kb').meters, rig.panels.locked, rig.panels.panels[0]?.pinned, rig.panels.panels[0]?.meters], [1.6, true, true, 1.6]);
  void rig.remote.toggleAll(WHO);                                  // 常显的不收
  rig.frame();
  assert.deepEqual(rig.views(), ['a.kb true true', 'a.clock true false']);
  rig.vr.setPose(0, at(1, 1.6, 0));
  void rig.remote.summon(WHO);                                     // 显示着的都到面前
  rig.frame();
  near(rig.panel('a.kb').pose, arrange(at(1, 1.6, 0), 'low', []));
  void rig.remote.reset(WHO, 'a.kb');
  rig.frame();
  assert.equal(rig.panel('a.kb').meters, 0.8);

  // 参数不对、目录里没有的面板：不动，也不发布
  const states = rig.published.length;
  void rig.remote.open(WHO, 'a.none', true);
  void rig.remote.open(WHO, 5, true);
  void rig.remote.open(WHO, 'a.kb', 'yes');
  void rig.remote.open(WHO, 'a.kb', undefined);
  void rig.remote.set(WHO, 'a.kb', { meters: 'wide' });
  void rig.remote.lockAll(WHO, 1);
  void rig.remote.reset(WHO, null);
  void rig.remote.summon(WHO, 7);
  rig.frame(2);
  assert.equal(rig.published.length, states);
  rig.unmount();
});

test('发布：一帧里的几次改动合成一次；没有改动的帧不发布', async t => {
  const rig = await mounted(t);
  rig.frame(3);
  const before = rig.published.length;
  void rig.remote.toggleAll(WHO);
  void rig.remote.lockAll(WHO, true);
  void rig.remote.set(WHO, 'a.kb', { meters: 1 });
  assert.equal(rig.published.length, before);
  rig.frame();
  assert.equal(rig.published.length, before + 1);
  assert.deepEqual([rig.panels.stowed, rig.panels.locked, rig.panels.panels[0]?.meters], [false, true, 1]);
  rig.frame();                                                     // 两块面板第一次放到面前：位置不在状态里，但布局变了，各发一次
  rig.frame(10);
  const settled = rig.published.length;
  rig.frame(10);
  assert.equal(rig.published.length, settled);
  rig.unmount();
});

test('存盘：布局变了以后过 500 毫秒存进组件数据的 layout 键，这期间又变了就重新等；存的只有全局锁和各块面板的记录', async t => {
  const rig = await mounted(t);
  void rig.remote.lockAll(WHO, true);
  rig.frame();
  rig.wait(400);
  void rig.remote.set(WHO, 'a.kb', { pinned: true });
  rig.frame();
  rig.wait(480);
  assert.equal(rig.writes.length, 0);
  rig.wait(20);
  assert.deepEqual(rig.writes, [['layout', {
    locked: true,
    panels: {
      'a.kb': { open: true, pinned: true, locked: false, meters: null, anchor: 'world', glance: false, pose: rig.panel('a.kb').pose },
      'a.clock': { open: true, pinned: false, locked: false, meters: null, anchor: 'world', glance: false, pose: null },
    },
  }]]);
  rig.wait(5000);
  assert.equal(rig.writes.length, 1);
  // 只改了收起 / 恢复：存盘的那一份没变，不存
  void rig.remote.toggleAll(WHO);
  rig.frame();
  rig.wait(1000);
  assert.equal(rig.writes.length, 2);                              // 时钟第一次显示、放到面前：位置变了
  void rig.remote.toggleAll(WHO);
  rig.frame();
  rig.wait(1000);
  assert.equal(rig.writes.length, 2);
  rig.unmount();
  assert.equal(rig.writes.length, 2);
});

// ---------- 面板目录 ----------

test('面板目录变了：新进目录的面板算打开(总开关收起着时进收起的那一组)；面板的组件关了，它的页面关掉、悬浮窗口销毁，再打开时回到它关掉之前的位置', async t => {
  const rig = await mounted(t, r => { r.list = [KB]; });
  rig.tap();
  assert.deepEqual(rig.views(), ['a.kb true true']);
  // 总开关没收起着：时钟的组件打开，面板直接显示
  rig.catalog([KB, CLOCK]);
  rig.frame();
  assert.deepEqual([rig.opened, rig.panel('a.clock').visible, rig.views()], [['a.kb frames', 'a.clock frames'], true, ['a.kb true true', 'a.clock true true']]);
  const where = rig.panel('a.clock').pose;
  const clock = rig.page('a.clock');
  // 时钟的组件关了
  rig.catalog([KB]);
  rig.frame();
  assert.deepEqual([clock.closed, rig.panel('a.clock').destroyed, rig.panel('a.kb').visible, rig.views()], [true, true, true, ['a.kb true true']]);
  rig.tap();                                                       // 收起键盘
  rig.catalog([KB, info('a.third'), CLOCK]);                       // 总开关收起着时进目录：放进收起的那一组
  rig.frame(3);
  assert.deepEqual([rig.opened.length, rig.views()], [2, ['a.kb true false', 'a.third true false', 'a.clock true false']]);
  rig.tap();
  rig.frame(2);
  assert.deepEqual(rig.views(), ['a.kb true true', 'a.third true true', 'a.clock true true']);
  assert.deepEqual(rig.panel('a.clock').pose, where);
  // 面板没变、清单里的名字和宽度范围变了：状态跟着发布
  const count = rig.published.length;
  rig.catalog([KB, info('a.third', { name: 'Third', maxMeters: 3 }), CLOCK]);
  rig.frame();
  assert.equal(rig.published.length, count + 1);
  assert.deepEqual([rig.panels.panels[1]?.name, rig.panels.panels[1]?.maxMeters], ['Third', 3]);
  rig.unmount();
});

test('一个组件卸载完了(core/component-removed)：它那块面板的记录删掉，再装上时按清单的默认值从头来', async t => {
  const rig = await mounted(t);
  rig.tap();
  rig.frame();
  void rig.remote.set(WHO, 'a.clock', { meters: 0.5, pinned: true });
  rig.frame();
  rig.catalog([KB]);
  rig.bus('core/component-removed', 'a.clock');
  rig.bus('core/component-removed', 7);                            // 数据不是 id：不理
  rig.frame();
  rig.wait(600);
  assert.deepEqual(Object.keys((rig.writes.at(-1)?.[1] as { panels: object }).panels), ['a.kb']);   // 存盘的布局里没有它了
  rig.catalog([KB, CLOCK]);
  rig.frame(2);
  assert.deepEqual(rig.panels.panels[1] && [rig.panels.panels[1].meters, rig.panels.panels[1].pinned], [0.3, false]);
  rig.unmount();
});

// ---------- 断开和重连 ----------

test('SteamVR 断开：页面留着只停画，显示着的面板收起；再连上接着用同一个页面，按总开关键恢复', async t => {
  const rig = await mounted(t, r => { r.list = [KB]; });
  rig.tap();
  const page = rig.page();
  assert.deepEqual([page.painting, page.closed], [true, false]);
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  assert.deepEqual([page.painting, page.closed], [false, false]);
  assert.deepEqual([rig.panels.connected, rig.panels.stowed, rig.views()], [false, true, ['a.kb true false']]);
  assert.deepEqual(rig.status.at(-1), { led: 'idle', label: 'STEAMVR' });
  rig.wait(PROBE);
  assert.equal(rig.connects, 2);
  rig.frame(2);
  assert.deepEqual([rig.overlay('a.kb'), page.painting], [undefined, false]);   // 收起着：不建悬浮窗口，页面不画
  assert.deepEqual([rig.panels.connected, rig.views()], [true, ['a.kb true false']]);
  rig.tap();
  assert.deepEqual([rig.panel().visible, rig.opened, page.painting], [true, ['a.kb frames'], true]);
  // 指点事件到的还是那个页面
  rig.aim('right', 'a.kb', 700, 350);
  rig.frame();
  assert.deepEqual(page.inputs.at(-1), { kind: 'move', x: 700, y: 350, held: false });
  rig.unmount();
});

test('SteamVR 断开之前用收起按钮关掉的面板：再连上按总开关键，它和收起的那一组一起回来，位置是关掉之前的', async t => {
  const rig = await mounted(t);
  rig.tap();
  rig.frame(2);
  const where = rig.panel('a.clock').pose;
  void rig.remote.open({ component: 'a.clock', where: 'panel' }, 'a.clock', false);   // 时钟页面的 ctx.panel.hide()
  rig.frame();
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock false false']]);
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  assert.deepEqual([rig.panels.connected, rig.panels.stowed, rig.views()], [false, true, ['a.kb true false', 'a.clock false false']]);
  rig.wait(PROBE);
  rig.frame(2);
  assert.deepEqual([rig.connects, rig.panels.connected, rig.views()], [2, true, ['a.kb true false', 'a.clock false false']]);
  rig.tap();
  rig.frame(2);
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock true true']]);
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible, rig.panel('a.clock').pose], [true, true, where]);
  rig.unmount();
});

test('没有面板可显示：照样连上 SteamVR，总开关键什么都不做；之后进目录的面板按一下总开关键显示', async t => {
  const rig = await mounted(t, r => { r.list = []; });
  assert.equal(rig.connects, 1);
  rig.tap();
  rig.tap();
  assert.deepEqual([rig.opened, rig.vr.overlays.map(o => o.key), rig.views()], [[], [DOT.left, DOT.right], []]);
  rig.catalog([CLOCK]);
  rig.frame();
  assert.deepEqual([rig.opened, rig.views()], [[], ['a.clock true false']]);
  rig.tap();
  assert.deepEqual([rig.panel('a.clock').visible, rig.views()], [true, ['a.clock true true']]);
  rig.unmount();
});

// ---------- 生效和等着 ----------

test('等着的显示方(别的显示方排在前面)：不连 SteamVR、不开面板页面，状态栏是没连上，等多久都没有页面出错停用；生效了才连上、照布局显示', async t => {
  const rig = await mounted(t, r => { r.active = false; });
  rig.wait(PROBE * 4);
  assert.deepEqual([rig.served, rig.connects, rig.opened, rig.calls.length], [['panels'], 0, [], 0]);
  assert.deepEqual(rig.status, [{ led: 'idle', label: 'STEAMVR' }]);
  assert.deepEqual([rig.panels.connected, rig.views(), rig.panels.panels.map(p => p.error)], [false, ['a.kb true false', 'a.clock true false'], [undefined, undefined]]);
  assert.deepEqual(rig.logs, []);

  rig.activate(true);                              // 当场探测、连上
  assert.deepEqual([rig.connects, rig.panels.connected, rig.status.at(-1)], [1, true, { led: 'ok', label: 'STEAMVR', value: '0' }]);
  rig.tap();
  rig.frame();
  assert.deepEqual([rig.opened, rig.views()], [['a.kb frames', 'a.clock frames'], ['a.kb true true', 'a.clock true true']]);
  rig.wait(PROBE * 2);
  assert.equal(rig.connects, 1);                   // 连着时不重复连
  rig.unmount();
});

test('生效的显示方变回等着：断开 SteamVR，悬浮窗口放掉，面板页面都关掉(按着的扳机补上抬起)，手柄键不起作用，探测停下；又生效时重新连上，按总开关键恢复', async t => {
  const rig = await mounted(t);
  rig.tap();
  rig.frame();
  const pages = [...rig.pages];
  rig.aim('right', 'a.kb', 700, 350);
  rig.press('click', 'right', true);
  rig.frame();
  const first = rig.vr;

  rig.activate(false);
  assert.deepEqual([first.closed, first.overlays.every(o => o.destroyed), pages.map(p => p.closed)], [true, true, [true, true]]);
  assert.deepEqual(pages[0]?.events.slice(-2), ['up 700,350', 'leave']);
  assert.deepEqual([rig.panels.connected, rig.views(), rig.status.at(-1)], [false, ['a.kb true false', 'a.clock true false'], { led: 'idle', label: 'STEAMVR' }]);
  const calls = rig.calls.length;
  rig.wait(PROBE * 3);                             // 不探测、不连、不开页面
  first.press(ACTION.toggle, SOURCE.right, true);
  rig.frame(3);
  assert.deepEqual([rig.connects, rig.calls.length, rig.opened.length, rig.panels.panels.map(p => p.error)], [1, calls, 2, [undefined, undefined]]);
  // 等着时页面被生效的显示方接走，报来「没了」：已经关掉的页面不理，布局里不记成关着
  pages[0]?.report('gone', 'taken over');
  assert.deepEqual(rig.views(), ['a.kb true false', 'a.clock true false']);

  rig.activate(true);
  assert.deepEqual([rig.connects, rig.panels.connected, rig.panels.stowed], [2, true, true]);
  rig.frame(3);
  assert.equal(rig.opened.length, 3);              // 键盘写了 keep：连上就开着页面停画；收起着，不建悬浮窗口
  assert.equal(rig.overlay('a.kb'), undefined);
  rig.tap();
  rig.frame();
  assert.deepEqual([rig.opened.slice(2), rig.views()], [['a.kb frames', 'a.clock frames'], ['a.kb true true', 'a.clock true true']]);
  assert.deepEqual(rig.pages.slice(2).map(p => [p.painting, p.closed]), [[true, false], [true, false]]);
  // 来回切几次，每次生效只探测一次
  rig.activate(false);
  rig.activate(true);
  rig.wait(PROBE);
  assert.equal(rig.connects, 3);
  rig.unmount();
});

test('等着时改不了布局的调用到不了这里，面板目录照常跟；卸载、SteamVR 没在运行时变成等着都不出错', async t => {
  const rig = await mounted(t, r => {
    r.active = false;
    r.running = false;
  });
  rig.catalog([KB]);
  assert.deepEqual(rig.views(), ['a.kb true false']);
  rig.activate(true);
  rig.wait(PROBE);
  assert.deepEqual([rig.connects, rig.panels.connected], [0, false]);
  rig.activate(false);                             // 没连上过：没有东西可收
  rig.running = true;
  rig.wait(PROBE * 2);
  assert.deepEqual([rig.connects, rig.logs], [0, []]);
  rig.unmount();
});

// ---------- 附着的面板 ----------

test('设置里附着的面板怎么跟着设备：attach 是 js 时每帧自己设绝对位置，别的值都交给 SteamVR', async t => {
  assert.deepEqual([readAttach({ attach: 'js' }), readAttach({ attach: 'native' }), readAttach({ attach: 'JS' }), readAttach({}), readAttach(null)], [false, true, true, true, true]);
  const stored = { locked: false, panels: { 'a.hud': { open: true, pinned: true, locked: false, meters: null, anchor: 'head', glance: false, pose: at(0, -0.2, -0.6) } } };
  const rig = await mounted(t, r => {
    r.list = [HUD];
    r.stored = stored;
  });
  rig.frame(2);
  assert.deepEqual([rig.args('placeOn').map(a => [a[0], a[1], a[2]]), rig.panel('a.hud').device], [[[rig.panel('a.hud').handle, 0, at(0, -0.2, -0.6)]], 0]);
  assert.deepEqual([rig.panels.panels[0]?.anchor, rig.panels.panels[0]?.visible], ['head', true]);
  rig.unmount();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const plain = await mounted(t, r => {
    r.list = [HUD];
    r.stored = stored;
    r.config = { ...CONFIG, attach: 'js' };
  });
  plain.frame(2);
  assert.deepEqual([plain.args('placeOn').length, plain.panel('a.hud').device], [0, null]);
  near(plain.panel('a.hud').pose, at(0, 1.4, -0.6));
  plain.unmount();
});

// ---------- 跟着游玩空间 ----------

test('设置里面板跟不跟着游玩空间：followSpace 只有写了 false 才不跟；连接时交给连接方式，日志也接过去', async t => {
  assert.deepEqual([readFollow({ followSpace: false }), readFollow({ followSpace: true }), readFollow({ followSpace: 'no' }), readFollow({ followSpace: 0 }), readFollow({}), readFollow(null)],
    [false, true, true, true, true, true]);
  const rig = await mounted(t);
  assert.deepEqual([rig.connects, rig.follows], [1, [true]]);
  rig.links[0]?.('vr: space', 'warn');
  assert.equal(rig.logs.at(-1), 'warn: vr: space');
  rig.unmount();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const off = await mounted(t, r => { r.config = { ...CONFIG, followSpace: false }; });
  assert.deepEqual([off.connects, off.follows], [1, [false]]);
  off.unmount();
});

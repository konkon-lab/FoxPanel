import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { Caller, PanelFeed, PanelInfo, PanelMode, PanelPageState, PanelsCalls, PanelsState, Served } from '@konkon-lab/foxpanel-sdk';
import { PAGE_LINGER_MS } from '../components/_shared/panels/layout.ts';
import { mount, type DisplayContext } from '../dev/display-desktop/src/main.ts';
import { readPreinstalled } from '../src/main/components/settings.ts';
import { parseManifest } from '../src/shared/manifest.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

const panel = (id: string, patch: Partial<PanelInfo> = {}): PanelInfo => ({
  id, name: id, width: 480, height: 200, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2,
  anchor: 'world', spawn: 'front', glance: false, keep: false, ...patch,
});
const KB = panel('a.kb', { keep: true });
const CLOCK = panel('a.clock');

// 假的宿主：记下显示方对面板页面做的事(steps)、发布的状态；state 像宿主那样把页面状态告诉显示方，
// active 像宿主那样告诉它远程服务 panels 的登记生效没有
interface Rig {
  steps: string[];
  states: PanelsState[];
  logs: string[];
  calls: Served<PanelsCalls>;
  catalog(list: PanelInfo[]): void;                                // 面板目录变了
  state(id: string, state: PanelPageState, detail?: string): void;
  removed(id: unknown): void;                                      // 核心说一个组件卸载完了
  active(on: boolean): void;                                       // 宿主说登记生效了 / 等着
  unload(): void;                                                  // 组件停用
  last(): PanelsState;                                             // 最近一份状态
  shown(): string[];                                               // 最近一份状态里显示着的面板
  view(id: string): PanelsState['panels'][number];                 // 最近一份状态里的一块面板
}

const CALLER: Caller = { component: 'a.list', where: 'panel' };

// 已经换成假计时的测试
const timed = new WeakSet<TestContext>();

// 装上显示方；计时是假的(t.mock.timers.tick 走时间)。waiting 为真时登记还没生效，否则装上之后宿主就告诉它生效了
function rig(t: TestContext, list: PanelInfo[], config: Record<string, unknown> = {}, waiting = false): Rig {
  if (!timed.has(t)) t.mock.timers.enable({ apis: ['setTimeout'] });
  timed.add(t);
  const steps: string[] = [];
  const states: PanelsState[] = [];
  const logs: string[] = [];
  let current = list;
  let watcher: (list: readonly PanelInfo[]) => void = () => undefined;
  const listeners = new Map<string, (state: PanelPageState, detail?: string) => void>();
  const bus = new Map<string, (data: unknown) => void>();
  const disposers: (() => void)[] = [];
  let calls: Served<PanelsCalls> | null = null;
  let serving = false;
  const watchers = new Set<(active: boolean) => void>();
  const active = (on: boolean): void => {
    if (serving === on) return;
    serving = on;
    for (const fn of [...watchers]) fn(on);
  };
  const feed = (id: string, mode: PanelMode): PanelFeed => ({
    id, width: 0, height: 0, state: 'loading',
    onFrame: () => undefined, onDrop: () => undefined, onSize: () => undefined,
    onState: fn => { listeners.set(id, fn); },
    release: () => undefined, input: () => undefined, setFrameRate: () => undefined,
    setPainting: on => { steps.push(`${id} ${on ? 'show' : 'hide'}`); },
    close: () => { steps.push(`${id} close ${mode}`); },
  });
  const ctx: DisplayContext = {
    config,
    log: (text, level = 'info') => { logs.push(`${level} ${text}`); },
    panels: {
      get list() { return current; },
      watch: fn => {
        watcher = fn;
        return () => undefined;
      },
      open: (id, mode = 'frames') => {
        steps.push(`${id} open ${mode}`);
        return feed(id, mode);
      },
    },
    relay: {
      use: () => assert.fail('显示方不用别的远程服务'),
      serve: (name, impl) => {
        assert.equal(name, 'panels');
        calls = impl as Served<PanelsCalls>;
        return {
          get active() { return serving; },
          watch: fn => {
            watchers.add(fn);
            return () => { watchers.delete(fn); };
          },
          publish: state => { states.push(state as PanelsState); },
          close: () => undefined,
        };
      },
    },
    bus: {
      on: (channel, fn) => {
        bus.set(channel, fn);
        return () => undefined;
      },
    },
    effect: fn => { disposers.push(fn()); },
  };
  mount(ctx);
  if (!waiting) active(true);
  const last = (): PanelsState => states.at(-1) ?? assert.fail('显示方没有发布状态');
  return {
    steps, states, logs, last, active,
    calls: calls ?? assert.fail('显示方没有提供 panels'),
    catalog: next => {
      current = next;
      watcher(next);
    },
    state: (id, state, detail) => listeners.get(id)?.(state, detail),
    removed: id => bus.get('core/component-removed')?.(id),
    unload: () => { for (const dispose of disposers) dispose(); },
    shown: () => last().panels.filter(p => p.visible).map(p => p.id),
    view: id => last().panels.find(p => p.id === id) ?? assert.fail(`状态里没有 ${id}`),
  };
}

test('开发用的显示方：启动时把面板目录里的面板都开成普通窗口，发布状态', t => {
  const r = rig(t, [KB, CLOCK]);
  assert.deepEqual(r.steps, ['a.kb open window', 'a.clock open window']);
  // 装上时发布一份(登记还没生效)，生效时再发布一份
  assert.equal(r.states.length, 2);
  const state = r.last();
  assert.deepEqual([state.connected, state.stowed, state.locked, state.limit], [true, false, false, 8]);
  assert.deepEqual(state.panels.map(p => [p.id, p.open, p.visible, p.pinned, p.locked, p.meters, p.minMeters, p.maxMeters]), [
    ['a.kb', true, true, false, false, 0.5, 0.1, 2], ['a.clock', true, true, false, false, 0.5, 0.1, 2],
  ]);
  assert.deepEqual(state.options, { blockInput: true, grabDelay: 0.15, stretch: true, snap: true, recenter: 'away' });
  assert.equal(typeof state.display, 'object');
});

test('开发用的显示方：远程服务 panels 的 open 开关一块面板，关掉就是隐藏窗口；清单没写 keep 的隐藏满一分钟关掉页面', t => {
  const r = rig(t, [KB, CLOCK]);
  r.steps.length = 0;
  // 已经开着的再开一次：什么都不做，也不重新发布状态
  r.calls.open(CALLER, 'a.clock', true);
  assert.deepEqual([r.steps, r.shown(), r.states.length], [[], ['a.kb', 'a.clock'], 2]);
  r.calls.open(CALLER, 'a.clock', false);
  r.calls.open(CALLER, 'a.kb', false);
  assert.deepEqual([r.steps, r.shown()], [['a.clock hide', 'a.kb hide'], []]);
  assert.deepEqual(r.last().panels.map(p => p.open), [false, false]);
  // 不到一分钟再打开：窗口显示出来，页面是同一个
  t.mock.timers.tick(PAGE_LINGER_MS - 1);
  r.calls.open(CALLER, 'a.clock', true);
  assert.deepEqual([r.steps.slice(2), r.shown()], [['a.clock show'], ['a.clock']]);
  // 再关掉：从这时起满一分钟才关页面；写了 keep 的键盘一直留着
  r.calls.open(CALLER, 'a.clock', false);
  t.mock.timers.tick(PAGE_LINGER_MS - 1);
  assert.deepEqual(r.steps.slice(3), ['a.clock hide']);
  t.mock.timers.tick(1);
  assert.deepEqual(r.steps.slice(4), ['a.clock close window']);
  t.mock.timers.tick(PAGE_LINGER_MS * 10);
  assert.deepEqual(r.steps.slice(5), []);
  // 再打开：隐藏着的显示出来，关掉了的重新开
  r.calls.open(CALLER, 'a.kb', true);
  r.calls.open(CALLER, 'a.clock', true);
  assert.deepEqual([r.steps.slice(5), r.shown()], [['a.kb show', 'a.clock open window'], ['a.kb', 'a.clock']]);
  // 参数不对(面板 id 不是字符串，第二个参数不是布尔、漏传)、没有这块面板：不动，也不重新发布状态
  const before = r.steps.length;
  const states = r.states.length;
  r.calls.open(CALLER, 5, true);
  r.calls.open(CALLER, 'a.kb', 'yes');
  r.calls.open(CALLER, 'a.kb', undefined);
  r.calls.open(CALLER, 'a.clock', 0);
  r.calls.open(CALLER, 'a.none', true);
  assert.deepEqual([r.steps.slice(before), r.shown(), r.states.length], [[], ['a.kb', 'a.clock'], states]);
});

test('开发用的显示方：总开关把打开着的面板整组收起，再调恢复同一组；关着的面板跟着回来，有快捷位指向的一样；目录是空的时不动', t => {
  const r = rig(t, [KB, CLOCK, panel('a.third')], { quick1: 'a.third' });
  r.steps.length = 0;
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps, r.shown(), r.last().stowed], [['a.kb hide', 'a.clock hide', 'a.third hide'], [], true]);
  assert.deepEqual(r.last().panels.map(p => p.open), [true, true, true]);
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps.slice(3), r.shown(), r.last().stowed], [['a.kb show', 'a.clock show', 'a.third show'], ['a.kb', 'a.clock', 'a.third'], false]);
  // 1 号快捷位指向的面板关着：按总开关它的窗口回来，别的窗口不动、不算收起着
  r.calls.open(CALLER, 'a.third', false);
  assert.deepEqual([r.steps.slice(6), r.shown(), r.view('a.third').open, r.view('a.third').quick], [['a.third hide'], ['a.kb', 'a.clock'], false, 1]);
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps.slice(7), r.shown(), r.last().stowed, r.view('a.third').open], [['a.third show'], ['a.kb', 'a.clock', 'a.third'], false, true]);
  // 目录里只剩它一块、它关着：按总开关它回来
  r.catalog([panel('a.third')]);
  r.calls.open(CALLER, 'a.third', false);
  assert.deepEqual([r.shown(), r.last().panels.map(p => p.open)], [[], [false]]);
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.shown(), r.last().panels.map(p => p.open), r.last().stowed], [['a.third'], [true], false]);
  // 目录是空的：总开关什么都不做，不重新发布状态
  r.catalog([]);
  const count = r.states.length;
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.states.length, r.shown(), r.last().stowed], [count, [], false]);
});

test('开发用的显示方：面板用自己的收起按钮收起后，按总开关时窗口回来，别的窗口不动；再按整组收起', t => {
  const r = rig(t, [KB, CLOCK, panel('a.third')]);
  r.calls.open({ component: 'a.clock', where: 'panel' }, 'a.clock', false);   // 页面的 ctx.panel.hide()
  assert.deepEqual([r.shown(), r.view('a.clock').open, r.last().stowed], [['a.kb', 'a.third'], false, false]);
  r.steps.length = 0;
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps, r.shown(), r.view('a.clock').open, r.last().stowed], [['a.clock show'], ['a.kb', 'a.clock', 'a.third'], true, false]);
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps.slice(1), r.shown(), r.last().stowed], [['a.kb hide', 'a.clock hide', 'a.third hide'], [], true]);
  // 收起着时又关了一块：按总开关三块一起回来
  r.calls.open(CALLER, 'a.third', false);
  assert.deepEqual([r.steps.length, r.last().panels.map(p => p.open), r.last().stowed], [4, [true, true, false], true]);
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps.slice(4), r.shown(), r.last().stowed], [['a.kb show', 'a.clock show', 'a.third show'], ['a.kb', 'a.clock', 'a.third'], false]);
  // 三块都关掉(一块显示着的都没有)：按总开关都回来
  for (const id of ['a.kb', 'a.clock', 'a.third']) r.calls.open(CALLER, id, false);
  assert.deepEqual([r.shown(), r.last().panels.map(p => p.open)], [[], [false, false, false]]);
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.shown(), r.last().panels.map(p => p.open), r.last().stowed], [['a.kb', 'a.clock', 'a.third'], [true, true, true], false]);
  // 用户关掉窗口(页面没了)也算收起：按总开关重新开出窗口
  r.steps.length = 0;
  r.state('a.clock', 'gone', 'closed');
  assert.deepEqual([r.shown(), r.view('a.clock').open], [['a.kb', 'a.third'], false]);
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps, r.shown()], [['a.clock open window'], ['a.kb', 'a.clock', 'a.third']]);
});

test('开发用的显示方：常显的面板总开关不收起；被收起着的面板设成常显就显示出来', t => {
  const r = rig(t, [KB, CLOCK]);
  r.calls.set(CALLER, 'a.clock', { pinned: true });
  r.steps.length = 0;
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps, r.shown(), r.last().stowed], [['a.kb hide'], ['a.clock'], true]);
  r.calls.set(CALLER, 'a.kb', { pinned: true });
  assert.deepEqual([r.steps.slice(1), r.shown(), r.last().stowed], [['a.kb show'], ['a.kb', 'a.clock'], false]);
});

test('开发用的显示方：宽度、单块锁、全局锁在窗口上没有效果，照样进状态；宽度夹在清单的范围里', t => {
  const r = rig(t, [KB, CLOCK]);
  r.steps.length = 0;
  r.calls.set(CALLER, 'a.clock', { meters: 0.8, locked: true });
  assert.deepEqual([r.view('a.clock').meters, r.view('a.clock').locked, r.view('a.kb').meters, r.view('a.kb').locked], [0.8, true, 0.5, false]);
  r.calls.set(CALLER, 'a.clock', { meters: 9 });
  assert.equal(r.view('a.clock').meters, 2);
  r.calls.set(CALLER, 'a.clock', { meters: 0.01, locked: false });
  assert.deepEqual([r.view('a.clock').meters, r.view('a.clock').locked], [0.1, false]);
  r.calls.lockAll(CALLER, true);
  assert.equal(r.last().locked, true);
  r.calls.lockAll(CALLER, false);
  assert.equal(r.last().locked, false);
  // 位置和大小回到清单的默认值
  r.calls.reset(CALLER, 'a.clock');
  assert.equal(r.view('a.clock').meters, 0.5);
  // 改这些不动窗口；值不对、一项都认不出、没变的调用不重新发布状态
  const count = r.states.length;
  r.calls.set(CALLER, 'a.clock', { meters: 'wide' });
  r.calls.set(CALLER, 'a.clock', {});
  r.calls.set(CALLER, 'a.none', { locked: true });
  r.calls.lockAll(CALLER, 'yes');
  r.calls.lockAll(CALLER, false);
  r.calls.reset(CALLER, 'a.clock');
  assert.deepEqual([r.states.length, r.steps], [count, []]);
});

test('开发用的显示方：到面前——给了 id 时打开那一块，没给时不动窗口', t => {
  const r = rig(t, [KB, CLOCK]);
  r.calls.open(CALLER, 'a.clock', false);
  r.steps.length = 0;
  r.calls.summon(CALLER, 'a.clock');
  assert.deepEqual([r.steps, r.shown(), r.view('a.clock').open], [['a.clock show'], ['a.kb', 'a.clock'], true]);
  const count = r.states.length;
  r.calls.summon(CALLER);
  r.calls.summon(CALLER, 'a.none');
  r.calls.summon(CALLER, 7);
  assert.deepEqual([r.states.length, r.steps.length], [count, 1]);
});

test('开发用的显示方：同时显示的上限和快捷位来自组件的设置；到上限时再开不生效，关掉一块才开得了', t => {
  const ids = ['a.one', 'a.two', 'a.three', 'a.four', 'a.five'];
  const r = rig(t, ids.map(id => panel(id)), { limit: 4, quick1: 'a.two', quick2: 'a.three' });
  // 打开着的多过上限：只显示目录里靠前的，排在后面的照样算打开着
  assert.deepEqual([r.last().limit, r.shown(), r.view('a.five').open], [4, ids.slice(0, 4), true]);
  assert.deepEqual(r.last().panels.map(p => p.quick), [0, 1, 2, 0, 0]);
  assert.deepEqual(r.steps, ids.slice(0, 4).map(id => `${id} open window`));
  // 关掉排在后面的那块再开：显示着的已经到上限，开不了
  r.calls.open(CALLER, 'a.five', false);
  r.steps.length = 0;
  const count = r.states.length;
  r.calls.open(CALLER, 'a.five', true);
  r.calls.summon(CALLER, 'a.five');
  assert.deepEqual([r.states.length, r.steps, r.view('a.five').open, r.shown()], [count, [], false, ids.slice(0, 4)]);
  // 关掉一块之后开得了
  r.calls.open(CALLER, 'a.one', false);
  r.calls.open(CALLER, 'a.five', true);
  assert.deepEqual([r.steps, r.shown()], [['a.one hide', 'a.five open window'], ['a.two', 'a.three', 'a.four', 'a.five']]);
  // 快捷位指向排在上限之后的面板：它占一个位置
  assert.deepEqual(rig(t, ids.map(id => panel(id)), { limit: 4, quick1: 'a.five' }).shown(), ['a.one', 'a.two', 'a.three', 'a.five']);
  // 设置里的上限夹在 4–12；不写时是 8，1 号快捷位是预装的键盘面板
  assert.equal(rig(t, [KB], { limit: 1 }).last().limit, 4);
  assert.equal(rig(t, [KB], { limit: 99 }).last().limit, 12);
  const plain = rig(t, [panel('yanuo.shell-classic'), KB]);
  assert.deepEqual([plain.last().limit, plain.last().panels.map(p => p.quick)], [8, [1, 0]]);
});

test('开发用的显示方：面板目录变了跟着变——新来的面板都打开；不在目录里的关掉页面', t => {
  const r = rig(t, [KB]);
  r.steps.length = 0;
  r.catalog([KB, CLOCK, panel('a.third')]);
  assert.deepEqual([r.steps, r.shown()], [['a.clock open window', 'a.third open window'], ['a.kb', 'a.clock', 'a.third']]);
  // 关掉的面板留在目录里时不重开
  r.calls.open(CALLER, 'a.clock', false);
  r.catalog([CLOCK]);
  assert.deepEqual([r.steps.slice(2), r.shown()], [['a.clock hide', 'a.kb close window', 'a.third close window'], []]);
  // 回到目录里：重新打开
  r.catalog([KB, CLOCK]);
  assert.deepEqual([r.steps.slice(5), r.shown()], [['a.kb open window'], ['a.kb']]);
  // 按总开关：关掉的时钟回来(隐藏不满一分钟，页面是同一个)
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.steps.slice(6), r.shown(), r.last().stowed], [['a.clock show'], ['a.kb', 'a.clock'], false]);
  // 总开关收起着时进目录的面板也收着，恢复时一起出现
  r.calls.toggleAll(CALLER);
  r.catalog([KB, CLOCK, panel('a.late')]);
  assert.deepEqual([r.shown(), r.view('a.late').open, r.last().stowed], [[], true, true]);
  r.calls.toggleAll(CALLER);
  assert.deepEqual(r.shown(), ['a.kb', 'a.clock', 'a.late']);
});

test('开发用的显示方：用远程服务关掉的面板目录再变不重开，它的组件关掉再打开后窗口回来', t => {
  const mine = panel('a.mine');
  const r = rig(t, [KB, mine, CLOCK]);
  assert.deepEqual([r.steps, r.shown()], [['a.kb open window', 'a.mine open window', 'a.clock open window'], ['a.kb', 'a.mine', 'a.clock']]);
  // 关掉它之后，目录因为别的面板变了：不重开
  r.calls.open(CALLER, 'a.mine', false);
  r.catalog([KB, mine]);
  assert.deepEqual([r.steps.slice(3), r.shown()], [['a.mine hide', 'a.clock close window'], ['a.kb']]);
  r.calls.open(CALLER, 'a.mine', true);
  r.steps.length = 0;
  // 它的组件关掉：面板不在目录里，宿主报页面没了
  r.catalog([KB]);
  r.state('a.mine', 'gone', 'removed');
  assert.deepEqual([r.steps, r.shown()], [['a.mine close window'], ['a.kb']]);
  // 组件再打开：面板回到目录里，窗口回来
  r.catalog([KB, mine]);
  assert.deepEqual([r.steps.slice(1), r.shown()], [['a.mine open window'], ['a.kb', 'a.mine']]);
  // 宿主的两条消息反过来到(页面没了在前、目录在后)也一样
  r.state('a.mine', 'gone', 'removed');
  r.catalog([KB]);
  assert.deepEqual(r.shown(), ['a.kb']);
  r.catalog([KB, mine]);
  assert.deepEqual([r.steps.slice(2), r.shown()], [['a.mine open window'], ['a.kb', 'a.mine']]);
  // 预装的面板也一样：回到目录里时打开，哪怕之前被关掉过
  r.calls.open(CALLER, 'a.kb', false);
  r.catalog([mine]);
  r.catalog([KB, mine]);
  assert.deepEqual(r.shown(), ['a.kb', 'a.mine']);
});

test('开发用的显示方：组件卸载完了，它那块面板记的常显、锁、宽度都不留；只是关掉组件的留着', t => {
  const r = rig(t, [KB, CLOCK]);
  r.calls.set(CALLER, 'a.clock', { pinned: true, locked: true, meters: 1 });
  // 关掉组件再打开：记的都还在
  r.catalog([KB]);
  r.catalog([KB, CLOCK]);
  assert.deepEqual([r.view('a.clock').pinned, r.view('a.clock').locked, r.view('a.clock').meters], [true, true, 1]);
  // 卸载再装上：和第一次见到一样
  r.catalog([KB]);
  r.removed('a.clock');
  r.removed(7);
  r.catalog([KB, CLOCK]);
  assert.deepEqual([r.view('a.clock').open, r.view('a.clock').pinned, r.view('a.clock').locked, r.view('a.clock').meters], [true, false, false, 0.5]);
});

test('开发用的显示方：窗口被关掉或页面出错时这块面板算关着；出错的关掉页面、状态里带原因、写一行日志，再打开时重试', t => {
  const r = rig(t, [KB, CLOCK]);
  r.steps.length = 0;
  // 用户把窗口关了
  r.state('a.kb', 'gone', 'closed');
  assert.deepEqual([r.steps, r.shown(), r.view('a.kb').open], [[], ['a.clock'], false]);
  // 加载中、加载好不动布局
  r.state('a.clock', 'loading');
  r.state('a.clock', 'ready');
  assert.deepEqual(r.shown(), ['a.clock']);
  // 页面出错
  r.state('a.clock', 'failed', 'page process gone: crashed 1');
  assert.deepEqual([r.steps, r.shown(), r.view('a.clock').error], [['a.clock close window'], [], 'page process gone: crashed 1']);
  assert.deepEqual(r.logs, ['warn panel a.clock closed: page process gone: crashed 1']);
  // 已经丢开的页面再来消息不算
  const count = r.states.length;
  r.state('a.clock', 'gone', 'closed');
  assert.equal(r.states.length, count);
  // 再打开：重新开页面，原因清掉
  r.calls.open(CALLER, 'a.clock', true);
  assert.deepEqual([r.steps.slice(1), r.shown(), r.view('a.clock').error], [['a.clock open window'], ['a.clock'], undefined]);
});

test('开发用的显示方：登记没生效时一个窗口都不开，状态里算没连上，布局照常能改；生效时照布局开', t => {
  const r = rig(t, [KB, CLOCK, panel('a.third')], {}, true);
  assert.deepEqual([r.steps, r.states.length, r.last().connected, r.shown()], [[], 1, false, []]);
  assert.deepEqual(r.last().panels.map(p => p.open), [true, true, true]);
  // 等着的时候：调用照常改布局、发布状态，目录变了也不开窗口
  r.calls.set(CALLER, 'a.kb', { pinned: true, meters: 0.9 });
  r.calls.summon(CALLER, 'a.third');
  r.calls.toggleAll(CALLER);
  assert.deepEqual([r.last().stowed, r.last().panels.map(p => p.open)], [true, [true, true, true]]);
  r.calls.toggleAll(CALLER);
  r.calls.open(CALLER, 'a.clock', false);
  r.catalog([KB, CLOCK, panel('a.third'), panel('a.late')]);
  t.mock.timers.tick(PAGE_LINGER_MS * 2);
  assert.deepEqual([r.steps, r.shown(), r.last().connected], [[], [], false]);
  assert.deepEqual(r.last().panels.map(p => `${p.id} ${p.open} ${p.pinned} ${p.meters}`), ['a.kb true true 0.9', 'a.clock false false 0.5', 'a.third true false 0.5', 'a.late true false 0.5']);
  // 生效了：照这时的布局开窗口，关着的不开
  const count = r.states.length;
  r.active(true);
  assert.deepEqual([r.steps, r.shown(), r.last().connected, r.states.length], [['a.kb open window', 'a.third open window', 'a.late open window'], ['a.kb', 'a.third', 'a.late'], true, count + 1]);
  // 宿主再说一遍生效：不重开
  r.active(true);
  assert.equal(r.steps.length, 3);
});

test('开发用的显示方：登记变回等着时窗口全部关掉(隐藏着的、写了 keep 的也关)，等着关页面的计时取消；再生效时照布局重新开', t => {
  const r = rig(t, [KB, CLOCK, panel('a.third')]);
  r.calls.open(CALLER, 'a.clock', false);
  r.calls.open(CALLER, 'a.kb', false);
  r.steps.length = 0;
  r.active(false);
  assert.deepEqual([[...r.steps].sort(), r.shown(), r.last().connected], [['a.clock close window', 'a.kb close window', 'a.third close window'], [], false]);
  // 布局不动：打开没有照旧
  assert.deepEqual(r.last().panels.map(p => p.open), [false, false, true]);
  // 隐藏着的那块本来在等着关页面：不关第二次
  t.mock.timers.tick(PAGE_LINGER_MS * 2);
  assert.equal(r.steps.length, 3);
  // 关掉之后宿主才送到的页面状态(被别的显示方接走、被拒)不算
  const count = r.states.length;
  r.state('a.third', 'gone', 'taken over');
  r.state('a.kb', 'failed', 'not the active display');
  assert.deepEqual([r.states.length, r.logs], [count, []]);
  // 等着的时候打开一块：只改布局
  r.calls.open(CALLER, 'a.kb', true);
  assert.deepEqual([r.steps.length, r.view('a.kb').open, r.view('a.kb').visible], [3, true, false]);
  // 再生效：照布局重新开
  r.active(true);
  assert.deepEqual([r.steps.slice(3), r.shown(), r.last().connected], [['a.kb open window', 'a.third open window'], ['a.kb', 'a.third'], true]);
});

test('开发用的显示方：生效时出错停用的面板重试；等着的时候不开页面，也就没有被拒的页面', t => {
  const r = rig(t, [KB, CLOCK]);
  r.state('a.clock', 'failed', 'page process gone: crashed 1');
  assert.deepEqual([r.shown(), r.view('a.clock').error], [['a.kb'], 'page process gone: crashed 1']);
  r.active(false);
  r.steps.length = 0;
  // 等着的时候出错的原因还在状态里
  assert.equal(r.view('a.clock').error, 'page process gone: crashed 1');
  r.active(true);
  assert.deepEqual([r.steps, r.shown(), r.view('a.clock').error], [['a.kb open window', 'a.clock open window'], ['a.kb', 'a.clock'], undefined]);
  // 一直等着的显示方：反复来回都没有开过页面、没有出错停用的面板、没写过日志
  const idle = rig(t, [KB, CLOCK], {}, true);
  idle.catalog([KB, CLOCK, panel('a.third')]);
  idle.calls.toggleAll(CALLER);
  idle.calls.toggleAll(CALLER);
  assert.deepEqual([idle.steps, idle.logs, idle.last().panels.map(p => p.error)], [[], [], [undefined, undefined, undefined]]);
});

test('开发用的显示方：附着在哪、抬手才显示照清单进状态，set 能改、reset 回清单的值，窗口上没有效果', t => {
  const wrist = panel('a.wrist', { anchor: 'left', glance: true, meters: 0.12 });
  const r = rig(t, [KB, wrist, panel('a.hud', { anchor: 'head' })]);
  assert.deepEqual(r.last().panels.map(p => [p.id, p.anchor, p.glance, p.locked, p.visible]), [
    ['a.kb', 'world', false, false, true], ['a.wrist', 'left', true, true, true], ['a.hud', 'head', false, false, true],
  ]);
  r.steps.length = 0;
  // 键盘挂到右手上：抬手才显示、锁着、宽度缩到 0.3 米
  r.calls.set(CALLER, 'a.kb', { anchor: 'right' });
  assert.deepEqual([r.view('a.kb').anchor, r.view('a.kb').glance, r.view('a.kb').locked, r.view('a.kb').meters], ['right', true, true, 0.3]);
  r.calls.set(CALLER, 'a.kb', { glance: false });
  assert.equal(r.view('a.kb').glance, false);
  // 手腕上的面板挪到空间里
  r.calls.set(CALLER, 'a.wrist', { anchor: 'world', glance: false, locked: false });
  assert.deepEqual([r.view('a.wrist').anchor, r.view('a.wrist').glance, r.view('a.wrist').locked], ['world', false, false]);
  // 重置：回到清单的附着对象、抬手才显示和默认宽度
  r.calls.reset(CALLER, 'a.wrist');
  r.calls.reset(CALLER, 'a.kb');
  assert.deepEqual([r.view('a.wrist').anchor, r.view('a.wrist').glance, r.view('a.kb').anchor, r.view('a.kb').glance, r.view('a.kb').meters], ['left', true, 'world', false, 0.5]);
  // 认不出的值、没变的值：不重新发布状态；这些都不动窗口，面板一直显示着
  const count = r.states.length;
  r.calls.set(CALLER, 'a.kb', { anchor: 'floor' });
  r.calls.set(CALLER, 'a.kb', { glance: 'yes' });
  r.calls.set(CALLER, 'a.kb', { anchor: 'world' });
  r.calls.summon(CALLER, 'a.wrist');
  assert.deepEqual([r.states.length, r.steps, r.shown()], [count, [], ['a.kb', 'a.wrist', 'a.hud']]);
});

test('开发用的显示方：组件停用时取消等着关页面的计时', t => {
  const r = rig(t, [KB, CLOCK]);
  r.calls.open(CALLER, 'a.clock', false);
  r.steps.length = 0;
  r.unload();
  t.mock.timers.tick(PAGE_LINGER_MS * 2);
  assert.deepEqual(r.steps, []);
});

test('开发用的显示方只给开发用：清单是提供 panels 的服务组件、只有 main，设置是两个快捷位和同时显示的上限；不在预装列表里，安装包不带；带环境变量启动才加载', () => {
  const dir = path.join(ROOT, 'dev', 'display-desktop');
  const r = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8')));
  if (!r.ok) assert.fail(r.errors.join('；'));
  const m = r.manifest;
  assert.deepEqual([m.id, m.kind, m.provides, m.main, m.page, m.window, m.panel, m.process], ['yanuo.display-desktop', 'service', ['panels'], 'main.js', undefined, undefined, undefined, undefined]);
  assert.deepEqual(m.settings.map(d => d.key), ['quick1', 'quick2', 'limit']);
  assert.ok(fs.existsSync(path.join(dir, 'src', 'main.ts')));
  assert.ok(!readPreinstalled(path.join(ROOT, 'components')).ids.includes(m.id));
  assert.ok(!fs.existsSync(path.join(ROOT, 'components', 'display-desktop')));
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { build: { files: string[] } };
  assert.ok(pkg.build.files.includes('!dist/dev/**'));
  // 打包脚本把 dev/ 下的组件打到 dist/dev/，不进 dist/components/
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.ts'), 'utf8');
  assert.match(build, /buildComponent\(path\.join\(src, name\), path\.join\(dist, 'dev', name\), false\)/);
  // 核心里只有这一处提到它，由环境变量和打包没有决定加不加载(src/main/dev.ts)
  const main = fs.readFileSync(path.join(ROOT, 'src', 'main', 'main.ts'), 'utf8');
  assert.equal([...main.matchAll(/DEV_DISPLAY/g)].length, 2);
  assert.match(main, /devComponents\(process\.env, app\.isPackaged, DEV_DISPLAY\)/);
  assert.doesNotMatch(main, /FOXPANEL_PAGE/);
});

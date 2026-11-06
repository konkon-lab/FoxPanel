import test from 'node:test';
import assert from 'node:assert/strict';
import type { Caller, PanelInfo } from '@konkon-lab/foxpanel-sdk';
import { applyCommand, parseCall, readPatch, serveCalls, type PanelsCommand } from '../components/_shared/panels/calls.ts';
import {
  DEFAULT_SETTINGS, emptyLayout, lockAll, place, reset, setOpen, setPanel, shownSet, summon, toggleAll, withCatalog, type Layout, type Pose,
} from '../components/_shared/panels/layout.ts';

const panel = (id: string, patch: Partial<PanelInfo> = {}): PanelInfo => ({
  id, name: id, width: 480, height: 200, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2,
  anchor: 'world', spawn: 'front', glance: false, keep: false, ...patch,
});
const LIST = [panel('a.kb', { meters: 0.8, minMeters: 0.4, maxMeters: 1.6 }), panel('a.clock')];
const SET = DEFAULT_SETTINGS;
const POSE: Pose = [1, 0, 0, 0.1, 0, 1, 0, 1.3, 0, 0, 1, -0.6];
const WHO: Caller = { component: 'a.list', where: 'panel' };

test('panels 的调用收窄成命令：面板 id 不合格、开关不是布尔、能改的项一项都认不出时为 null', () => {
  assert.deepEqual(parseCall('open', ['a.kb', true]), { kind: 'open', id: 'a.kb', on: true });
  assert.deepEqual(parseCall('open', ['a.kb', false, 'extra']), { kind: 'open', id: 'a.kb', on: false });
  for (const args of [[], ['a.kb'], ['a.kb', 'yes'], ['a.kb', 0], ['a.kb', null], [5, true], ['Bad Id', true], ['nodot', true], [undefined, true], [null, false]]) {
    assert.equal(parseCall('open', args), null, JSON.stringify(args));
  }
  assert.deepEqual(parseCall('toggleAll', []), { kind: 'toggleAll' });
  assert.deepEqual(parseCall('toggleAll', ['a.kb', 1]), { kind: 'toggleAll' });
  // 到面前：不写 id 是全部
  for (const args of [[], [undefined], [null]]) assert.deepEqual(parseCall('summon', args), { kind: 'summon', id: null }, JSON.stringify(args));
  assert.deepEqual(parseCall('summon', ['a.clock']), { kind: 'summon', id: 'a.clock' });
  for (const args of [[5], ['Bad Id'], [''], [true], [{}]]) assert.equal(parseCall('summon', args), null, JSON.stringify(args));
  assert.deepEqual(parseCall('reset', ['a.kb']), { kind: 'reset', id: 'a.kb' });
  for (const args of [[], [5], ['x'], [null]]) assert.equal(parseCall('reset', args), null, JSON.stringify(args));
  assert.deepEqual(parseCall('set', ['a.kb', { pinned: true, locked: false, meters: 1.23456, glance: true, quick: 1, anchor: 'left', open: false }]), {
    kind: 'set', id: 'a.kb', patch: { pinned: true, locked: false, meters: 1.235, anchor: 'left', glance: true },
  });
  assert.deepEqual(parseCall('set', ['a.kb', { locked: true, pinned: 'yes' }]), { kind: 'set', id: 'a.kb', patch: { locked: true } });
  assert.deepEqual(parseCall('set', ['a.kb', { anchor: 'head' }]), { kind: 'set', id: 'a.kb', patch: { anchor: 'head' } });
  assert.deepEqual(parseCall('set', ['a.kb', { glance: false, anchor: 'wrist' }]), { kind: 'set', id: 'a.kb', patch: { glance: false } });
  for (const args of [
    [], ['a.kb'], ['a.kb', {}], ['a.kb', null], ['a.kb', 'pinned'], ['a.kb', [{ pinned: true }]], ['a.kb', { pinned: 'yes', locked: 1, meters: -1 }], [5, { pinned: true }],
    ['a.kb', { anchor: 'wrist', glance: 1 }], ['a.kb', { anchor: null }], ['a.kb', 'left'],
  ]) {
    assert.equal(parseCall('set', args), null, JSON.stringify(args));
  }
  assert.deepEqual(parseCall('lockAll', [true]), { kind: 'lockAll', on: true });
  assert.deepEqual(parseCall('lockAll', [false]), { kind: 'lockAll', on: false });
  for (const args of [[], ['true'], [1], [null]]) assert.equal(parseCall('lockAll', args), null, JSON.stringify(args));
});

test('一块面板能改的项：只认常显、锁定、宽度、附着在哪、抬手才显示；宽度要是有限的正数，取整到毫米；附着在哪要是四个值之一', () => {
  assert.deepEqual(readPatch({ pinned: false, locked: true, meters: 0.5004 }), { pinned: false, locked: true, meters: 0.5 });
  assert.deepEqual(readPatch({ meters: 2.5 }), { meters: 2.5 });
  for (const anchor of ['world', 'head', 'left', 'right']) assert.deepEqual(readPatch({ anchor }), { anchor }, anchor);
  for (const anchor of ['', 'World', 'LEFT', 'hand', 'both', 0, 1, true, null, ['left'], { anchor: 'left' }]) assert.deepEqual(readPatch({ anchor }), {}, JSON.stringify(anchor));
  assert.deepEqual([readPatch({ glance: true }), readPatch({ glance: false })], [{ glance: true }, { glance: false }]);
  for (const glance of ['true', 1, 0, null, [true]]) assert.deepEqual(readPatch({ glance }), {}, JSON.stringify(glance));
  assert.deepEqual(readPatch({ anchor: 'right', glance: false, pinned: true, locked: false, meters: 0.2 }), { pinned: true, locked: false, meters: 0.2, anchor: 'right', glance: false });
  for (const meters of [NaN, Infinity, 0, -0.2, '1', null, true]) assert.deepEqual(readPatch({ meters }), {}, String(meters));
  for (const raw of [undefined, null, 5, 'x', [], [1], { open: true, visible: true, quick: 2, id: 'a.kb' }]) assert.deepEqual(readPatch(raw), {}, JSON.stringify(raw));
});

test('命令作用到布局上：和直接调状态机的各个操作是同一个结果；没有变化时给回同一份', () => {
  const layout = place(withCatalog(emptyLayout(false), LIST), 'a.kb', POSE);
  const run = (from: Layout, command: PanelsCommand): Layout => applyCommand(from, LIST, SET, command);
  assert.deepEqual(run(layout, { kind: 'open', id: 'a.clock', on: false }), setOpen(layout, SET, 'a.clock', false));
  const closed = setOpen(layout, SET, 'a.clock', false);
  assert.deepEqual(run(closed, { kind: 'open', id: 'a.clock', on: true }), setOpen(closed, SET, 'a.clock', true));
  assert.deepEqual(run(layout, { kind: 'toggleAll' }), toggleAll(layout));
  assert.deepEqual(run(layout, { kind: 'toggleAll' }).stash, ['a.kb', 'a.clock']);
  assert.deepEqual(run(toggleAll(layout), { kind: 'toggleAll' }), layout);
  // 关着的面板跟着总开关打开，显示着的不动；设置里有快捷位指向它时一样
  assert.deepEqual(run(closed, { kind: 'toggleAll' }), layout);
  assert.deepEqual(applyCommand(closed, LIST, { ...SET, quick: [null, 'a.clock'] }, { kind: 'toggleAll' }), layout);
  assert.deepEqual(run(layout, { kind: 'summon', id: null }), summon(layout, SET));
  assert.equal(run(layout, { kind: 'summon', id: null }).panels['a.kb']?.pose, null);
  assert.deepEqual(run(closed, { kind: 'summon', id: 'a.clock' }), summon(closed, SET, 'a.clock'));
  assert.deepEqual(shownSet(run(closed, { kind: 'summon', id: 'a.clock' }), SET), ['a.kb', 'a.clock']);
  assert.deepEqual(run(layout, { kind: 'reset', id: 'a.kb' }), reset(layout, LIST, 'a.kb'));
  assert.equal(run(layout, { kind: 'reset', id: 'a.kb' }).panels['a.kb']?.pose, null);
  // 改附着在哪、抬手才显示；重置回清单的值(LIST 里都是留在空间里的)
  const hung = run(layout, { kind: 'set', id: 'a.kb', patch: { anchor: 'left' } });
  assert.deepEqual(hung, setPanel(layout, LIST, 'a.kb', { anchor: 'left' }));
  assert.deepEqual(hung.panels['a.kb'], { open: true, pinned: false, locked: true, meters: 0.4, anchor: 'left', glance: true, pose: null });
  assert.equal(run(hung, { kind: 'set', id: 'a.kb', patch: { glance: false } }).panels['a.kb']?.glance, false);
  assert.deepEqual(run(hung, { kind: 'reset', id: 'a.kb' }).panels['a.kb'], { open: true, pinned: false, locked: false, meters: null, anchor: 'world', glance: false, pose: null });
  // 到面前不动附着的面板
  const placed = place(hung, 'a.kb', POSE);
  assert.equal(run(placed, { kind: 'summon', id: null }), placed);
  assert.equal(run(placed, { kind: 'summon', id: 'a.kb' }), placed);
  assert.deepEqual(run(layout, { kind: 'set', id: 'a.kb', patch: { meters: 9, pinned: true } }), setPanel(layout, LIST, 'a.kb', { meters: 9, pinned: true }));
  assert.equal(run(layout, { kind: 'set', id: 'a.kb', patch: { meters: 9 } }).panels['a.kb']?.meters, 1.6);
  assert.deepEqual(run(layout, { kind: 'lockAll', on: true }), lockAll(layout, true));
  // 没有变化
  for (const command of [
    { kind: 'open', id: 'a.kb', on: true }, { kind: 'open', id: 'a.none', on: false }, { kind: 'summon', id: 'a.none' }, { kind: 'reset', id: 'a.clock' },
    { kind: 'set', id: 'a.none', patch: { pinned: true } }, { kind: 'lockAll', on: false },
  ] satisfies PanelsCommand[]) assert.equal(run(layout, command), layout, JSON.stringify(command));
});

test('远程服务 panels 的实现：约定里的方法都有；每个调用收窄成命令，连同调用者交出去，收窄不过的不交', () => {
  const got: [PanelsCommand, string][] = [];
  const served = serveCalls((command, caller) => { got.push([command, caller.component]); });
  assert.deepEqual(Object.keys(served).sort(), ['lockAll', 'open', 'reset', 'set', 'summon', 'toggleAll']);
  served.open(WHO, 'a.kb', false);
  served.open(WHO, 'a.kb');
  served.open(WHO, 5, true);
  served.toggleAll(WHO);
  served.summon(WHO);
  served.summon(WHO, 'a.kb');
  served.summon(WHO, 5);
  served.reset(WHO, 'a.kb');
  served.reset(WHO);
  served.set(WHO, 'a.kb', { locked: true });
  served.set(WHO, 'a.kb', { glance: true });
  served.set(WHO, 'a.kb', { anchor: 'right' });
  served.set(WHO, 'a.kb', { anchor: 'elbow' });
  served.set(WHO, 'a.kb', { quick: 1 });
  served.lockAll({ component: 'a.wrist', where: 'panel' }, true);
  served.lockAll(WHO, 1);
  assert.deepEqual(got, [
    [{ kind: 'open', id: 'a.kb', on: false }, 'a.list'],
    [{ kind: 'toggleAll' }, 'a.list'],
    [{ kind: 'summon', id: null }, 'a.list'],
    [{ kind: 'summon', id: 'a.kb' }, 'a.list'],
    [{ kind: 'reset', id: 'a.kb' }, 'a.list'],
    [{ kind: 'set', id: 'a.kb', patch: { locked: true } }, 'a.list'],
    [{ kind: 'set', id: 'a.kb', patch: { glance: true } }, 'a.list'],
    [{ kind: 'set', id: 'a.kb', patch: { anchor: 'right' } }, 'a.list'],
    [{ kind: 'lockAll', on: true }, 'a.wrist'],
  ]);

  // 接到布局上：一串调用之后的布局
  let layout = withCatalog(emptyLayout(true), LIST);
  const live = serveCalls(command => { layout = applyCommand(layout, LIST, SET, command); });
  live.toggleAll(WHO);
  live.set(WHO, 'a.clock', { meters: 3, pinned: true });
  live.open(WHO, 'a.kb', false);
  assert.equal(layout.panels['a.kb']?.open, false);
  live.toggleAll(WHO);                                    // 关着的键盘跟着总开关打开
  live.lockAll(WHO, true);
  live.set(WHO, 'a.kb', { anchor: 'head' });
  live.set(WHO, 'a.clock', { anchor: 'left', locked: false });
  live.reset(WHO, 'a.kb');
  assert.deepEqual(layout, {
    stowed: false, stash: [], present: ['a.kb', 'a.clock'], locked: true, errors: {},
    panels: {
      'a.kb': { open: true, pinned: false, locked: false, meters: null, anchor: 'world', glance: false, pose: null },
      'a.clock': { open: true, pinned: true, locked: false, meters: 0.3, anchor: 'left', glance: true, pose: null },
    },
  });
  live.open(WHO, 'a.kb', false);
  live.toggleAll(WHO);
  live.toggleAll(WHO);                                    // 没有面板藏着：非常显的键盘收起，常显的时钟不动
  assert.deepEqual([layout.stowed, layout.stash, layout.panels['a.kb']?.open], [true, ['a.kb'], true]);
});

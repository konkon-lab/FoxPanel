import test from 'node:test';
import assert from 'node:assert/strict';
import type { PanelInfo } from '@konkon-lab/foxpanel-sdk';
import {
  anchorOf, ANCHORS, DEFAULT_OPTIONS, DEFAULT_SETTINGS, DISPLAY_LIMIT, dropPanel, emptyLayout, errorOf, failPanel, glances, grabDelayOf, HAND_GRAB_DELAY, HAND_METERS,
  isAnchor, isHand, isOpen, lockAll, metersOf, movable, place, quickKey, readLayout, readSettings, reset, retryAll, setOpen, setPanel, shownSet, storedOf, stowAll, summon,
  toggleAll, viewOf, withCatalog, type DisplaySettings, type Layout, type PanelRecord, type Pose,
} from '../components/_shared/panels/layout.ts';

// 面板目录的一项
const panel = (id: string, patch: Partial<PanelInfo> = {}): PanelInfo => ({
  id, name: id, width: 480, height: 200, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2,
  anchor: 'world', spawn: 'front', glance: false, keep: false, ...patch,
});

const KB = panel('a.kb', { keep: true, meters: 0.8, minMeters: 0.4, maxMeters: 1.6, spawn: 'low' });
const CLOCK = panel('a.clock');
const NOTES = panel('a.notes');
const LIST = [KB, CLOCK, NOTES];
const ALL = ['a.kb', 'a.clock', 'a.notes'];

// 设置：上限 8，1 号快捷位指向 a.kb，2 号指向 a.clock
const SET: DisplaySettings = { ...DEFAULT_SETTINGS, quick: ['a.kb', 'a.clock'] };
// 第一次见到的面板的记录
const FRESH: PanelRecord = { open: true, pinned: false, locked: false, meters: null, anchor: 'world', glance: false, pose: null };
const POSE: Pose = [1, 0, 0, 0.1, 0, 1, 0, 1.3, 0, 0, 1, -0.6];
const OTHER: Pose = [0, 0, 1, -0.4, 0, 1, 0, 1.5, -1, 0, 0, -0.5];

const shown = (layout: Layout): string[] => shownSet(layout, SET);
// 目录里是 LIST、总开关没收起着的布局
const start = (): Layout => withCatalog(emptyLayout(false), LIST);

test('面板进目录：第一次见到的算打开；有记录的照记录；目录没变时给回同一份布局', () => {
  const layout = start();
  assert.deepEqual(layout, { stowed: false, stash: [], present: ALL, locked: false, panels: { 'a.kb': FRESH, 'a.clock': FRESH, 'a.notes': FRESH }, errors: {} });
  assert.deepEqual(shown(layout), ALL);
  assert.equal(withCatalog(layout, LIST), layout);
  // 清单的值变了、面板和顺序没变：还是同一份
  assert.equal(withCatalog(layout, [KB, panel('a.clock', { meters: 1 }), NOTES]), layout);
  // 顺序换了：该显示的面板跟着目录的顺序
  assert.deepEqual(shown(withCatalog(layout, [NOTES, KB, CLOCK])), ['a.notes', 'a.kb', 'a.clock']);
  // 关掉的面板留在目录里：目录再变(多了别的面板)不重新打开
  const closed = setOpen(layout, SET, 'a.clock', false);
  const more = withCatalog(closed, [...LIST, panel('a.wrist')]);
  assert.deepEqual([shown(more), more.panels['a.clock']?.open, more.panels['a.wrist']], [['a.kb', 'a.notes', 'a.wrist'], false, FRESH]);
});

test('总开关收起着时进目录的面板放进收起的那一组，恢复时才出现；常显的直接显示，关着的不进', () => {
  const layout = withCatalog(emptyLayout(true), [KB, CLOCK]);
  assert.deepEqual([layout.stowed, layout.stash, shown(layout)], [true, ['a.kb', 'a.clock'], []]);
  // 之后进目录的也进那一组
  const more = withCatalog(layout, LIST);
  assert.deepEqual([more.stowed, more.stash, shown(more)], [true, ALL, []]);
  const restored = toggleAll(more);
  assert.deepEqual([restored.stowed, restored.stash, shown(restored)], [false, [], ALL]);
  // 存过的布局
  const saved = readLayout({ panels: { 'a.kb': { open: true, pinned: true }, 'a.clock': { open: false }, 'a.notes': { open: true } } });
  const back = withCatalog(saved, LIST);
  assert.deepEqual([back.stowed, back.stash, shown(back)], [true, ['a.notes'], ['a.kb']]);
  // 目录是空的：那一组是空的，还收起着
  const none = withCatalog(emptyLayout(true), []);
  assert.deepEqual([none.stowed, none.stash, none.present], [true, [], []]);
});

test('面板不在目录里：位置、大小、常显、锁的记录留着，不显示、开关和改动都不管它；回到目录时重新算打开，哪怕之前被关掉过', () => {
  const sized = place(setPanel(start(), LIST, 'a.clock', { meters: 0.7, locked: true }), 'a.clock', POSE);
  const hidden = setOpen(sized, SET, 'a.clock', false);   // 面板用自己的收起按钮收起
  const gone = withCatalog(hidden, [KB, NOTES]);
  assert.deepEqual([gone.present, shown(gone)], [['a.kb', 'a.notes'], ['a.kb', 'a.notes']]);
  assert.deepEqual(gone.panels['a.clock'], { ...FRESH, locked: true, meters: 0.7, pose: POSE });
  assert.equal(setOpen(gone, SET, 'a.clock', false), gone);
  assert.equal(setOpen(gone, SET, 'a.clock', true), gone);
  assert.equal(setPanel(gone, LIST, 'a.clock', { pinned: true }), gone);
  assert.equal(reset(gone, LIST, 'a.clock'), gone);
  assert.equal(summon(gone, SET, 'a.clock'), gone);
  assert.equal(quickKey(gone, SET, 2), gone);
  const back = withCatalog(gone, LIST);
  assert.deepEqual(shown(back), ALL);
  assert.deepEqual(back.panels['a.clock'], { ...FRESH, locked: true, meters: 0.7, pose: POSE });
  // 打开着离开的回来也打开着
  assert.deepEqual(shown(withCatalog(withCatalog(sized, [CLOCK]), LIST)), ALL);
});

test('总开关收起着时面板离开目录：从收起的那一组里拿掉，那一组空了也还收起着；回来时放进那一组', () => {
  const stowed = withCatalog(emptyLayout(true), [KB]);
  const gone = withCatalog(stowed, []);
  assert.deepEqual([gone.stowed, gone.stash, gone.present], [true, [], []]);
  assert.equal(toggleAll(gone), gone);
  const back = withCatalog(gone, [KB, CLOCK]);
  assert.deepEqual([back.stowed, back.stash, shown(back)], [true, ['a.kb', 'a.clock'], []]);
  // 总开关没收起着时离开再回来：直接显示
  const again = withCatalog(withCatalog(toggleAll(back), [CLOCK]), [KB, CLOCK]);
  assert.deepEqual([again.stowed, again.stash, shown(again)], [false, [], ['a.kb', 'a.clock']]);
  // 存盘读回、关着的面板这次启动时不在目录里：之后进目录时算打开，大小还在
  const saved = withCatalog(readLayout({ panels: { 'a.clock': { open: false, meters: 0.9 } } }), [KB]);
  assert.equal(saved.panels['a.clock']?.open, true);
  const later = withCatalog(saved, [KB, CLOCK]);
  assert.deepEqual([later.stash, later.panels['a.clock']], [['a.kb', 'a.clock'], { ...FRESH, meters: 0.9 }]);
});

test('组件卸载完：删掉这块面板的记录，连同目录和收起的那一组里的；再装上是第一次见到的面板', () => {
  const layout = place(withCatalog(emptyLayout(true), LIST), 'a.clock', POSE);
  const dropped = dropPanel(layout, 'a.clock');
  assert.deepEqual(dropped, { stowed: true, stash: ['a.kb', 'a.notes'], present: ['a.kb', 'a.notes'], locked: false, panels: { 'a.kb': FRESH, 'a.notes': FRESH }, errors: {} });
  assert.equal(dropPanel(dropped, 'a.clock'), dropped);
  assert.equal(dropPanel(layout, 'a.none'), layout);
  const again = withCatalog(dropped, LIST);
  assert.deepEqual([again.panels['a.clock'], again.stash], [FRESH, ['a.kb', 'a.notes', 'a.clock']]);
  // 不在目录里的面板的记录也删
  const away = withCatalog(layout, [KB]);
  assert.deepEqual(Object.keys(dropPanel(away, 'a.clock').panels), ['a.kb', 'a.notes']);
});

test('打开和关掉一块面板：不动别的，位置和大小留着；没有这块面板、没变化的操作给回同一份布局', () => {
  const layout = place(start(), 'a.clock', POSE);
  const closed = setOpen(layout, SET, 'a.clock', false);
  assert.deepEqual([shown(closed), closed.panels['a.clock']], [['a.kb', 'a.notes'], { ...FRESH, open: false, pose: POSE }]);
  assert.equal(layout.panels['a.clock']?.open, true);
  const opened = setOpen(closed, SET, 'a.clock', true);
  assert.deepEqual([shown(opened), opened.panels['a.clock']], [ALL, { ...FRESH, pose: POSE }]);
  assert.equal(setOpen(layout, SET, 'a.none', true), layout);
  assert.equal(setOpen(layout, SET, 'a.none', false), layout);
  assert.equal(setOpen(layout, SET, 'a.kb', true), layout);
  assert.equal(setOpen(closed, SET, 'a.clock', false), closed);
});

test('总开关：没有面板藏着、有打开着的面板显示着就整组收起，再按恢复同一组；没有可显示也没有可收起的时不变', () => {
  const layout = start();
  const stowed = toggleAll(layout);
  assert.deepEqual([stowed.stowed, stowed.stash, shown(stowed)], [true, ALL, []]);
  // 收起不改各块的记录：位置、大小、打开没有都留着
  assert.equal(stowed.panels, layout.panels);
  const restored = toggleAll(stowed);
  assert.deepEqual([restored.stowed, restored.stash, shown(restored)], [false, [], ALL]);
  // 没有关着的面板时恢复也不改各块的记录
  assert.equal(restored.panels, layout.panels);
  // 目录是空的：不变
  for (const empty of [emptyLayout(false), emptyLayout(true)]) assert.equal(toggleAll(empty), empty);
});

test('总开关：目录里有关着的面板就算有面板藏着，有没有快捷位指向它都算——按一下全部显示，再按才整组收起', () => {
  const NOTES_BACK: PanelRecord = { ...FRESH, meters: 0.7, pose: POSE };
  const sized = place(setPanel(start(), LIST, 'a.notes', { meters: 0.7 }), 'a.notes', POSE);
  // 只关了一块、别的还显示着：那一块回来(位置、大小是关掉之前的)，别的不动、不算收起着
  const one = setOpen(sized, SET, 'a.notes', false);
  assert.deepEqual([shown(one), one.panels['a.notes']?.open], [['a.kb', 'a.clock'], false]);
  const back = toggleAll(one);
  assert.deepEqual(back, { stowed: false, stash: [], present: ALL, locked: false, panels: { 'a.kb': FRESH, 'a.clock': FRESH, 'a.notes': NOTES_BACK }, errors: {} });
  assert.deepEqual(shown(back), ALL);
  assert.equal(one.panels['a.notes']?.open, false);   // 给进来的布局不动
  // 再按：三块整组收起；第三下恢复
  const again = toggleAll(back);
  assert.deepEqual([again.stowed, again.stash, shown(again)], [true, ALL, []]);
  assert.deepEqual(shown(toggleAll(again)), ALL);

  // 关的是唯一的一块：按一下回来
  const alone = setOpen(withCatalog(emptyLayout(false), [NOTES]), SET, 'a.notes', false);
  assert.deepEqual([shown(alone), shown(toggleAll(alone)), toggleAll(alone).panels['a.notes']], [[], ['a.notes'], FRESH]);

  // 关着的有快捷位指向(a.kb 是 1 号)：一样算藏着——别的面板显示着时它回来、别的不动，再按三块整组收起
  const keyed = setOpen(start(), SET, 'a.kb', false);
  assert.deepEqual([shown(keyed), keyed.panels['a.kb']?.open], [['a.clock', 'a.notes'], false]);
  const unkeyed = toggleAll(keyed);
  assert.deepEqual(unkeyed, { stowed: false, stash: [], present: ALL, locked: false, panels: { 'a.kb': FRESH, 'a.clock': FRESH, 'a.notes': FRESH }, errors: {} });
  assert.deepEqual([shown(unkeyed), toggleAll(unkeyed).stash], [ALL, ALL]);
  // 目录里只有它一块
  const lone = setOpen(withCatalog(emptyLayout(false), [KB]), SET, 'a.kb', false);
  assert.deepEqual([shown(lone), shown(toggleAll(lone)), toggleAll(lone).stowed], [[], ['a.kb'], false]);
  // 目录里的面板都有快捷位指向、都关着：都回来
  const pair = withCatalog(emptyLayout(false), [KB, CLOCK]);
  const none = setOpen(setOpen(pair, SET, 'a.kb', false), SET, 'a.clock', false);
  assert.deepEqual([shown(none), shown(toggleAll(none))], [[], ['a.kb', 'a.clock']]);
  // 关着两块，一块有快捷位指向、一块没有：都打开
  const both = setOpen(setOpen(start(), SET, 'a.clock', false), SET, 'a.notes', false);
  const opened = toggleAll(both);
  assert.deepEqual([shown(both), shown(opened), ALL.map(id => opened.panels[id]?.open)], [['a.kb'], ALL, [true, true, true]]);

  // 常显的面板被关：一样回来，还是常显
  const pinned = setOpen(setPanel(start(), LIST, 'a.notes', { pinned: true }), SET, 'a.notes', false);
  const repinned = toggleAll(pinned);
  assert.deepEqual([shown(repinned), repinned.stowed, repinned.panels['a.notes']], [ALL, false, { ...FRESH, pinned: true }]);
  assert.deepEqual([toggleAll(repinned).stash, shown(toggleAll(repinned))], [['a.kb', 'a.clock'], ['a.notes']]);

  // 被总开关收起着时又关了一块：按一下，那一组恢复，关掉的那块也回来
  const group = toggleAll(start());
  const less = setOpen(group, SET, 'a.notes', false);
  assert.deepEqual([less.stowed, less.stash, shown(less)], [true, ['a.kb', 'a.clock'], []]);
  const full = toggleAll(less);
  assert.deepEqual([full.stowed, full.stash, shown(full), full.panels['a.notes']?.open], [false, [], ALL, true]);
  // 那一组被关空了(还算收起着)：按一下，关着的三块都回来
  const emptied = setOpen(setOpen(less, SET, 'a.kb', false), SET, 'a.clock', false);
  assert.deepEqual([emptied.stowed, emptied.stash, shown(emptied)], [true, [], []]);
  const rest = toggleAll(emptied);
  assert.deepEqual([rest.stowed, rest.stash, shown(rest)], [false, [], ALL]);

  // 不在目录里的面板关着的记录不算藏着：显示着的照常整组收起，那条记录不动
  const away = withCatalog(emptyLayout(false), [KB]);
  const stray: Layout = { ...away, panels: { ...away.panels, 'a.notes': { ...FRESH, open: false } } };
  const hidden = toggleAll(stray);
  assert.deepEqual([hidden.stash, hidden.panels['a.notes']?.open], [['a.kb'], false]);
});

test('总开关和同时显示的上限：关着的面板打开后，显示哪几块照目录的顺序和上限；排在上限之后的算打开着、没在显示，再按整组收起', () => {
  const four: DisplaySettings = { ...DEFAULT_SETTINGS, limit: 4, quick: [null, null] };
  const ids = ['a.p1', 'a.p2', 'a.p3', 'a.p4', 'a.p5', 'a.p6'];
  const list = ids.map(id => panel(id));
  const layout = withCatalog(emptyLayout(false), list);
  // 关掉排在前面的一块，后面的补上；按总开关它回来，补上来的那块让出位置(还算打开着)
  const early = setOpen(layout, four, 'a.p2', false);
  assert.deepEqual(shownSet(early, four), ['a.p1', 'a.p3', 'a.p4', 'a.p5']);
  const first = toggleAll(early);
  assert.deepEqual([shownSet(first, four), isOpen(first, 'a.p2'), isOpen(first, 'a.p5'), first.stowed], [['a.p1', 'a.p2', 'a.p3', 'a.p4'], true, true, false]);
  // 关掉排在上限之后的一块：按总开关它算打开着，显示着的还是前四块；再按六块整组收起
  const late = setOpen(layout, four, 'a.p6', false);
  const opened = toggleAll(late);
  assert.deepEqual([shownSet(opened, four), opened.panels['a.p6']?.open, opened.stash], [['a.p1', 'a.p2', 'a.p3', 'a.p4'], true, []]);
  assert.deepEqual([toggleAll(opened).stash, shownSet(toggleAll(opened), four)], [ids, []]);
  // 关着的那块排在上限之后、有快捷位指向：按总开关它打开并占一个位置，第四块让出位置(还算打开着)
  const keyed: DisplaySettings = { ...four, quick: ['a.p6', null] };
  const off = quickKey(layout, keyed, 1);
  assert.deepEqual([shownSet(off, keyed), off.panels['a.p6']?.open], [['a.p1', 'a.p2', 'a.p3', 'a.p4'], false]);
  const on = toggleAll(off);
  assert.deepEqual([shownSet(on, keyed), isOpen(on, 'a.p4'), isOpen(on, 'a.p5'), on.stowed], [['a.p1', 'a.p2', 'a.p3', 'a.p6'], true, true, false]);
  // 关着的两块都有快捷位指向、排在前面：都打开，占两个位置，其余的取前两块
  const pair: DisplaySettings = { ...four, quick: ['a.p2', 'a.p3'] };
  const less = quickKey(quickKey(layout, pair, 1), pair, 2);
  assert.deepEqual(shownSet(less, pair), ['a.p1', 'a.p4', 'a.p5', 'a.p6']);
  assert.deepEqual(shownSet(toggleAll(less), pair), ['a.p1', 'a.p2', 'a.p3', 'a.p4']);
});

test('显示方断开：算总开关收起着，显示着的非常显面板并进收起的那一组，常显的、关着的不动；已经收起着的还在那一组里，按总开关一起恢复', () => {
  const layout = setPanel(setOpen(start(), SET, 'a.clock', false), LIST, 'a.notes', { pinned: true });
  const stowed = stowAll(layout);
  assert.deepEqual([stowed.stowed, stowed.stash, shown(stowed)], [true, ['a.kb'], ['a.notes']]);
  assert.equal(stowed.panels, layout.panels);
  assert.equal(stowAll(stowed), stowed);                    // 没有可收的：不变
  // 总开关收起着时单独打开了一块：断开时它并进那一组，顺序照目录
  const mixed = setOpen(toggleAll(start()), SET, 'a.clock', true);
  assert.deepEqual([mixed.stash, shown(mixed)], [['a.kb', 'a.notes'], ['a.clock']]);
  const all = stowAll(mixed);
  assert.deepEqual([all.stowed, all.stash, shown(all)], [true, ALL, []]);
  assert.deepEqual(shown(toggleAll(all)), ALL);
  const empty = emptyLayout(true);
  assert.equal(stowAll(empty), empty);
  // 断开时一块都没显示着(键盘被关掉了)：也算收起着，断开期间进目录的面板进那一组，再连上要按总开关才出现；
  // 关着的键盘跟着一起回来
  const none = stowAll(setOpen(withCatalog(emptyLayout(false), [KB]), SET, 'a.kb', false));
  assert.deepEqual([none.stowed, none.stash], [true, []]);
  const later = withCatalog(none, [KB, CLOCK]);
  assert.deepEqual([later.stash, shown(later), shown(toggleAll(later))], [['a.clock'], [], ['a.kb', 'a.clock']]);
});

test('显示方断开再连上之后按总开关：收起的那一组恢复，断开之前关掉的面板也回来，有快捷位指向的一样', () => {
  // 断开之前关掉了 a.notes(没有快捷位)和 a.kb(1 号快捷位)，只剩 a.clock 显示着
  const before = setOpen(setOpen(start(), SET, 'a.notes', false), SET, 'a.kb', false);
  const cut = stowAll(before);
  assert.deepEqual([cut.stowed, cut.stash, shown(cut)], [true, ['a.clock'], []]);
  const linked = toggleAll(retryAll(cut));
  assert.deepEqual([linked.stowed, linked.stash, shown(linked)], [false, [], ALL]);
  assert.deepEqual(ALL.map(id => linked.panels[id]?.open), [true, true, true]);
  // 目录里只有一块、断开之前被关掉了(断开后收起的那一组是空的)：按总开关它回来，不算收起着
  for (const info of [NOTES, KB]) {
    const only = stowAll(setOpen(withCatalog(emptyLayout(false), [info]), SET, info.id, false));
    assert.deepEqual([only.stowed, only.stash], [true, []]);
    const again = toggleAll(only);
    assert.deepEqual([again.stowed, again.stash, shown(again)], [false, [], [info.id]]);
  }
});

test('常显的面板总开关不收起它；被收起着的面板设成常显就显示出来', () => {
  const layout = setPanel(start(), LIST, 'a.clock', { pinned: true });
  const stowed = toggleAll(layout);
  assert.deepEqual([stowed.stowed, stowed.stash, shown(stowed)], [true, ['a.kb', 'a.notes'], ['a.clock']]);
  assert.deepEqual(shown(toggleAll(stowed)), ALL);
  // 显示着的只有常显的、另两块关着：按总开关那两块回来，不算收起着
  const only = setOpen(setOpen(layout, SET, 'a.kb', false), SET, 'a.notes', false);
  assert.deepEqual([shown(only), shown(toggleAll(only)), toggleAll(only).stowed], [['a.clock'], ALL, false]);
  // 目录里只有常显的面板：总开关不变
  const solo = setPanel(withCatalog(emptyLayout(false), [CLOCK]), [CLOCK], 'a.clock', { pinned: true });
  assert.deepEqual(shown(solo), ['a.clock']);
  assert.equal(toggleAll(solo), solo);
  // 收起的那一组里的一块设成常显：显示出来，不在那一组里；那一组空了就不算收起着
  const pinned = setPanel(stowed, LIST, 'a.kb', { pinned: true });
  assert.deepEqual([pinned.stowed, pinned.stash, shown(pinned)], [true, ['a.notes'], ['a.kb', 'a.clock']]);
  const last = setPanel(pinned, LIST, 'a.notes', { pinned: true });
  assert.deepEqual([last.stowed, last.stash, shown(last)], [false, [], ALL]);
  // 取消常显：还显示着，那一组不变；恢复之后它跟着总开关走
  const unpinned = setPanel(stowed, LIST, 'a.clock', { pinned: false });
  assert.deepEqual([unpinned.stash, shown(unpinned)], [['a.kb', 'a.notes'], ['a.clock']]);
  assert.deepEqual(toggleAll(toggleAll(unpinned)).stash, ALL);
});

test('总开关收起着时开关一块：打开的那一块单独显示；它在收起的那一组里就从组里拿掉，打开后那一组空了不算收起着，关掉不改收起着没有', () => {
  // a.kb、a.notes 被收起着，a.clock 在收起之后关掉(不在那一组里)
  const stowed = setOpen(toggleAll(start()), SET, 'a.clock', false);
  assert.deepEqual([stowed.stowed, stowed.stash, shown(stowed)], [true, ['a.kb', 'a.notes'], []]);
  // 打开组外的一块：它显示，那一组还收着；恢复时那一组回来，单独打开的也还在
  const extra = setOpen(stowed, SET, 'a.clock', true);
  assert.deepEqual([extra.stowed, extra.stash, shown(extra)], [true, ['a.kb', 'a.notes'], ['a.clock']]);
  assert.deepEqual(shown(toggleAll(extra)), ALL);
  // 打开组里的一块：它显示，不在组里了
  const one = setOpen(stowed, SET, 'a.kb', true);
  assert.deepEqual([one.stowed, one.stash, shown(one)], [true, ['a.notes'], ['a.kb']]);
  // 关掉组里的一块：它不在组里了；按总开关显示时关着的两块和那一组一起回来
  const dropped = setOpen(stowed, SET, 'a.notes', false);
  assert.deepEqual([dropped.stowed, dropped.stash, shown(toggleAll(dropped))], [true, ['a.kb'], ALL]);
  // 关掉组里最后一块：还算收起着，之后进目录的面板进那一组
  const empty = setOpen(dropped, SET, 'a.kb', false);
  assert.deepEqual([empty.stowed, empty.stash, shown(empty)], [true, [], []]);
  const joined = withCatalog(empty, [...LIST, panel('a.wrist')]);
  assert.deepEqual([joined.stash, shown(joined)], [['a.wrist'], []]);
  // 面板的组件关掉再打开(页面没了的消息比目录早到：关掉 → 离开目录 → 回到目录)：它回到收起的那一组里，不自己冒出来
  const gone = withCatalog(setOpen(toggleAll(withCatalog(emptyLayout(false), [KB])), SET, 'a.kb', false), []);
  assert.deepEqual([gone.stowed, gone.stash, gone.panels['a.kb']?.open], [true, [], true]);
  const back = withCatalog(gone, [KB, CLOCK]);
  assert.deepEqual([back.stash, shown(back), shown(toggleAll(back))], [['a.kb', 'a.clock'], [], ['a.kb', 'a.clock']]);
  // 启动时收起的那一组是空的(存过的面板关着)：打开它之后不算收起着，再按总开关把它收起；不打开直接按总开关它也回来
  const boot = withCatalog(readLayout({ panels: { 'a.kb': { open: false } } }), [KB]);
  assert.deepEqual([boot.stowed, boot.stash, shown(boot)], [true, [], []]);
  assert.deepEqual([toggleAll(boot).stowed, shown(toggleAll(boot))], [false, ['a.kb']]);
  const first = setOpen(boot, SET, 'a.kb', true);
  assert.deepEqual([first.stowed, shown(first), toggleAll(first).stash], [false, ['a.kb'], ['a.kb']]);
});

test('快捷位键：开关那个快捷位指向的面板，不动别的；空位、面板不在目录里时不变', () => {
  const layout = start();
  const off = quickKey(layout, SET, 1);
  assert.deepEqual([shown(off), off.panels['a.kb']?.open], [['a.clock', 'a.notes'], false]);
  assert.deepEqual(shown(quickKey(off, SET, 1)), ALL);
  // 用快捷位键关掉的面板，按总开关显示面板时回来，别的不动、不算收起着
  assert.deepEqual([shown(toggleAll(off)), toggleAll(off).stowed, toggleAll(off).panels['a.kb']?.open], [ALL, false, true]);
  assert.deepEqual(shown(quickKey(layout, SET, 2)), ['a.kb', 'a.notes']);
  // 空位
  const blank: DisplaySettings = { ...SET, quick: ['a.kb', null] };
  assert.equal(quickKey(layout, blank, 2), layout);
  assert.equal(quickKey(layout, { ...SET, quick: [null, null] }, 1), layout);
  // 指向的面板没有、不在目录里
  assert.equal(quickKey(layout, { ...SET, quick: ['a.none', null] }, 1), layout);
  const away = withCatalog(layout, [CLOCK, NOTES]);
  assert.equal(quickKey(away, SET, 1), away);
  // 被总开关收起着：这一块单独显示出来；再按关掉它，那一组不变，按总开关恢复时它和那一组一起回来
  const stowed = toggleAll(layout);
  const alone = quickKey(stowed, SET, 1);
  assert.deepEqual([alone.stash, shown(alone)], [['a.clock', 'a.notes'], ['a.kb']]);
  const hidden = quickKey(alone, SET, 1);
  assert.deepEqual([hidden.stash, shown(hidden), hidden.panels['a.kb']?.open], [['a.clock', 'a.notes'], [], false]);
  assert.deepEqual([shown(toggleAll(hidden)), toggleAll(hidden).stowed], [ALL, false]);
});

test('同时显示的上限：打开着的多过上限时只显示目录里靠前的；显示着的到上限时再开不生效，关掉一块后排在后面的补上；快捷位指向的面板占着位置', () => {
  const four: DisplaySettings = { ...SET, limit: 4 };
  const ids = ['a.p1', 'a.p2', 'a.p3', 'a.p4', 'a.p5', 'a.p6'];
  const list = ids.map(id => panel(id));
  const layout = withCatalog(emptyLayout(false), list);
  assert.deepEqual(shownSet(layout, four), ['a.p1', 'a.p2', 'a.p3', 'a.p4']);
  // 都算打开着，后两块没在显示
  const state = viewOf(layout, list, four, { display: 'x', connected: true });
  assert.deepEqual([state.limit, state.panels.map(p => `${p.open} ${p.visible}`)], [4, ['true true', 'true true', 'true true', 'true true', 'true false', 'true false']]);
  // 关掉前面的一块：后面的补上
  const closed = setOpen(layout, four, 'a.p2', false);
  assert.deepEqual(shownSet(closed, four), ['a.p1', 'a.p3', 'a.p4', 'a.p5']);
  // 到上限时再开、到面前都不生效
  assert.equal(setOpen(closed, four, 'a.p2', true), closed);
  assert.equal(summon(closed, four, 'a.p2'), closed);
  // 快捷位指向的面板到了上限也打得开：它占一个位置，排在最后的那块让出来(还算打开着)
  const two: DisplaySettings = { ...four, quick: ['a.p2', null] };
  const opened = quickKey(closed, two, 1);
  assert.deepEqual([shownSet(opened, two), isOpen(opened, 'a.p5')], [['a.p1', 'a.p2', 'a.p3', 'a.p4'], true]);
  assert.deepEqual(shownSet(summon(closed, two, 'a.p2'), two), ['a.p1', 'a.p2', 'a.p3', 'a.p4']);
  // 快捷位指向排在上限之后的面板：它显示着，按快捷位键关掉它、再按打开
  const six: DisplaySettings = { ...four, quick: ['a.p6', 'a.p5'] };
  assert.deepEqual(shownSet(layout, six), ['a.p1', 'a.p2', 'a.p5', 'a.p6']);
  const off = quickKey(layout, six, 1);
  assert.deepEqual([shownSet(off, six), off.panels['a.p6']?.open], [['a.p1', 'a.p2', 'a.p3', 'a.p5'], false]);
  assert.deepEqual(shownSet(quickKey(off, six, 1), six), ['a.p1', 'a.p2', 'a.p5', 'a.p6']);
  // 总开关恢复一组时，用快捷位单独打开着的那块留在显示的里面
  const kept = quickKey(toggleAll(layout), six, 1);
  assert.deepEqual([shownSet(kept, six), shownSet(toggleAll(kept), six)], [['a.p6'], ['a.p1', 'a.p2', 'a.p5', 'a.p6']]);
  // 上限够了就开得了
  assert.deepEqual(shownSet(setOpen(closed, SET, 'a.p2', true), SET), ids);
  // 总开关把排在上限之后的也一起收起；恢复后还是只显示前四块
  const stowed = toggleAll(layout);
  assert.deepEqual([stowed.stash, shownSet(stowed, four)], [ids, []]);
  assert.deepEqual(shownSet(toggleAll(stowed), four), ['a.p1', 'a.p2', 'a.p3', 'a.p4']);
  // 总开关收起着时只剩常显的在显示
  const pinned = toggleAll(setPanel(layout, list, 'a.p5', { pinned: true }));
  assert.deepEqual(shownSet(pinned, four), ['a.p5']);
  assert.deepEqual([DISPLAY_LIMIT, DEFAULT_SETTINGS.limit], [8, 8]);
});

test('出错停用：算关着、带原因，记录里的 open 和存盘的那一份不动；再打开、快捷位键、到面前、总开关显示面板、重新连上时清掉原因重试', () => {
  const layout = start();
  const failed = failPanel(layout, 'a.kb', 'overlay did not show');
  assert.deepEqual([errorOf(failed, 'a.kb'), isOpen(failed, 'a.kb'), shown(failed), failed.panels['a.kb']?.open], ['overlay did not show', false, ['a.clock', 'a.notes'], true]);
  assert.equal(failed.panels, layout.panels);
  assert.deepEqual(storedOf(failed), storedOf(layout));
  assert.equal(failPanel(failed, 'a.kb', 'overlay did not show'), failed);
  assert.equal(failPanel(layout, 'a.none', 'x'), layout);                 // 不在目录里的不记
  const view = viewOf(failed, LIST, SET, { display: 'x', connected: true }).panels[0];
  assert.deepEqual([view?.open, view?.visible, view?.error], [false, false, 'overlay did not show']);
  // 出错的不占同时显示的名额
  const tight: DisplaySettings = { ...SET, limit: 4, quick: [null, null] };
  const five = withCatalog(emptyLayout(false), ['a.p1', 'a.p2', 'a.p3', 'a.p4', 'a.p5'].map(id => panel(id)));
  assert.deepEqual(shownSet(failPanel(five, 'a.p1', 'x'), tight), ['a.p2', 'a.p3', 'a.p4', 'a.p5']);
  // 再打开、快捷位键、到面前：清掉原因，记录还是同一份
  for (const retried of [setOpen(failed, SET, 'a.kb', true), quickKey(failed, SET, 1), summon(failed, SET, 'a.kb')]) {
    assert.deepEqual([retried.errors, shown(retried), retried.panels], [{}, ALL, layout.panels]);
  }
  // 关掉出错的面板：原因清掉，真的关着
  const closed = setOpen(failed, SET, 'a.kb', false);
  assert.deepEqual([closed.errors, closed.panels['a.kb']?.open], [{}, false]);
  // 总开关：出错停用的面板不算藏着(记录里是打开着)——有别的面板显示着时照常收起(出错的不进那一组，原因和记录不动)，恢复时重试
  const stowed = toggleAll(failed);
  assert.deepEqual([stowed.stowed, stowed.stash, errorOf(stowed, 'a.kb'), stowed.panels], [true, ['a.clock', 'a.notes'], 'overlay did not show', failed.panels]);
  const restored = toggleAll(stowed);
  assert.deepEqual([restored.errors, shown(restored)], [{}, ALL]);
  // 总开关：没有面板可收起、只有出错的：重试
  const only = failPanel(withCatalog(emptyLayout(false), [KB]), 'a.kb', 'x');
  assert.deepEqual([shown(only), shown(toggleAll(only))], [[], ['a.kb']]);
  // 出错停用的同时有用收起按钮关掉的面板：按总开关，关着的打开、出错的重试，显示着的不动
  const shut = setOpen(failed, SET, 'a.notes', false);
  assert.deepEqual([shown(shut), errorOf(shut, 'a.kb')], [['a.clock'], 'overlay did not show']);
  const both = toggleAll(shut);
  assert.deepEqual([both.errors, both.stowed, both.stash, shown(both), both.panels['a.notes']?.open], [{}, false, [], ALL, true]);
  // 关着的面板又记了出错的原因：还是算关着(藏着)，按总开关时打开并重试，显示着的两块不动
  const dead = failPanel(setOpen(layout, SET, 'a.notes', false), 'a.notes', 'page failed');
  assert.deepEqual([dead.panels['a.notes']?.open, errorOf(dead, 'a.notes'), shown(dead)], [false, 'page failed', ['a.kb', 'a.clock']]);
  const revived = toggleAll(dead);
  assert.deepEqual([revived.stowed, revived.stash, revived.errors, shown(revived), revived.panels['a.notes']?.open], [false, [], {}, ALL, true]);
  // 被总开关收起着的面板出错：从那一组里拿掉，还算收起着
  const hidden = failPanel(toggleAll(layout), 'a.clock', 'x');
  assert.deepEqual([hidden.stowed, hidden.stash], [true, ['a.kb', 'a.notes']]);
  // 重新连上：都重试；没有出错的时给回同一份
  assert.deepEqual([retryAll(failed).errors, shown(retryAll(failed))], [{}, ALL]);
  assert.equal(retryAll(layout), layout);
  // 面板离开目录、组件卸载完：出过的错不留
  assert.deepEqual(withCatalog(failed, [CLOCK, NOTES]).errors, {});
  assert.deepEqual(dropPanel(failed, 'a.kb').errors, {});
  assert.equal(withCatalog(failed, [NOTES, KB, CLOCK]).errors, failed.errors);
});

test('改一块面板：常显、锁定、宽度只改给了的项；宽度取整到毫米、夹在这块面板清单的最小和最大之间', () => {
  const layout = start();
  assert.equal(metersOf(layout, KB), 0.8);
  const wide = setPanel(layout, LIST, 'a.kb', { meters: 1.23456 });
  assert.deepEqual([wide.panels['a.kb'], metersOf(wide, KB)], [{ ...FRESH, meters: 1.235 }, 1.235]);
  assert.equal(layout.panels['a.kb']?.meters, null);
  // a.kb 的范围是 0.4–1.6 米，a.clock 是 0.1–2 米
  assert.equal(setPanel(layout, LIST, 'a.kb', { meters: 5 }).panels['a.kb']?.meters, 1.6);
  assert.equal(setPanel(layout, LIST, 'a.kb', { meters: 0.05 }).panels['a.kb']?.meters, 0.4);
  assert.equal(setPanel(layout, LIST, 'a.clock', { meters: 5 }).panels['a.clock']?.meters, 2);
  assert.equal(setPanel(layout, LIST, 'a.clock', { meters: 0.05 }).panels['a.clock']?.meters, 0.1);
  // 清单的范围变了：实际宽度跟着夹
  assert.equal(metersOf(wide, { ...KB, maxMeters: 1 }), 1);
  assert.equal(metersOf(wide, { ...KB, minMeters: 1.4 }), 1.4);
  assert.equal(metersOf(layout, panel('a.none', { meters: 0.3 })), 0.3);
  // 不是有限的正数：不改
  for (const meters of [NaN, Infinity, -Infinity, 0, -1]) assert.equal(setPanel(wide, LIST, 'a.kb', { meters }), wide, String(meters));
  const both = setPanel(wide, LIST, 'a.kb', { pinned: true, locked: true });
  assert.deepEqual(both.panels['a.kb'], { ...FRESH, pinned: true, locked: true, meters: 1.235 });
  assert.deepEqual(setPanel(both, LIST, 'a.kb', { locked: false }).panels['a.kb'], { ...FRESH, pinned: true, meters: 1.235 });
  // 没变化、空的改动、没有这块面板、目录的清单里没有它
  assert.equal(setPanel(both, LIST, 'a.kb', { pinned: true, meters: 1.2351 }), both);
  assert.equal(setPanel(both, LIST, 'a.kb', {}), both);
  assert.equal(setPanel(both, LIST, 'a.none', { pinned: true }), both);
  assert.equal(setPanel(both, [CLOCK], 'a.kb', { pinned: false }), both);
});

test('锁：单块的锁和全局锁都没锁的面板才能抓、能缩放；锁着照样能开关和收起', () => {
  const layout = setPanel(start(), LIST, 'a.clock', { locked: true });
  assert.deepEqual(['a.kb', 'a.clock', 'a.none'].map(id => movable(layout, id)), [true, false, false]);
  const all = lockAll(layout, true);
  assert.deepEqual([all.locked, movable(all, 'a.kb'), movable(all, 'a.clock')], [true, false, false]);
  assert.equal(lockAll(all, true), all);
  assert.equal(lockAll(layout, false), layout);
  // 全局锁放开：单块的锁还在
  const free = lockAll(all, false);
  assert.deepEqual([free.locked, movable(free, 'a.kb'), movable(free, 'a.clock')], [false, true, false]);
  assert.deepEqual(shown(toggleAll(all)), []);
  assert.deepEqual(shown(setOpen(all, SET, 'a.clock', false)), ['a.kb', 'a.notes']);
});

test('记位置、到面前、重置：到面前忘掉位置(关着的先打开)，重置连宽度一起回到清单的默认值', () => {
  const placed = place(place(start(), 'a.kb', POSE), 'a.clock', OTHER);
  assert.deepEqual(ALL.map(id => placed.panels[id]?.pose), [POSE, OTHER, null]);
  assert.notEqual(placed.panels['a.kb']?.pose, POSE);
  assert.equal(place(placed, 'a.kb', [...POSE]), placed);
  assert.equal(place(placed, 'a.none', POSE), placed);
  // 一块到面前
  const one = summon(placed, SET, 'a.kb');
  assert.deepEqual(ALL.map(id => one.panels[id]?.pose), [null, OTHER, null]);
  assert.equal(summon(one, SET, 'a.kb'), one);
  assert.equal(summon(placed, SET, 'a.none'), placed);
  // 关着的：打开并忘掉位置
  const called = summon(setOpen(placed, SET, 'a.clock', false), SET, 'a.clock');
  assert.deepEqual([shown(called), called.panels['a.clock']], [ALL, FRESH]);
  // 被总开关收起着的：单独显示出来
  const stowed = toggleAll(placed);
  const alone = summon(stowed, SET, 'a.clock');
  assert.deepEqual([alone.stash, shown(alone), alone.panels['a.clock']?.pose], [['a.kb', 'a.notes'], ['a.clock'], null]);
  // 全部到面前：显示着的都忘掉位置，没显示的不动
  const all = summon(setOpen(placed, SET, 'a.clock', false), SET);
  assert.deepEqual(ALL.map(id => all.panels[id]?.pose), [null, OTHER, null]);
  assert.equal(summon(all, SET), all);
  assert.equal(summon(stowed, SET), stowed);
  // 重置：位置和宽度没了，常显、打开没有不动
  const sized = setPanel(placed, LIST, 'a.kb', { meters: 1.2, pinned: true });
  const back = reset(sized, LIST, 'a.kb');
  assert.deepEqual([back.panels['a.kb'], metersOf(back, KB)], [{ ...FRESH, pinned: true }, 0.8]);
  assert.equal(reset(back, LIST, 'a.kb'), back);
  assert.equal(reset(back, LIST, 'a.none'), back);
  // 只改过宽度、只摆过位置的也重置
  assert.deepEqual(reset(setPanel(start(), LIST, 'a.kb', { meters: 1 }), LIST, 'a.kb').panels['a.kb'], FRESH);
  assert.deepEqual(reset(placed, LIST, 'a.clock').panels['a.clock'], FRESH);
  // 目录的清单里没有它：不变
  assert.equal(reset(placed, [KB], 'a.clock'), placed);
});

test('存盘读回：坏的项用默认值，矩阵要 12 个有限数，id 不合格或不是对象的记录丢掉；读不出来时是空的布局', () => {
  for (const raw of [undefined, null, 5, 'x', [], [{ panels: {} }], {}, { locked: 'yes', panels: [] }, { panels: 'a.kb' }]) {
    assert.deepEqual(readLayout(raw), emptyLayout(true), JSON.stringify(raw));
  }
  const read = readLayout({
    locked: true, stowed: false, stash: ['a.kb'], present: ['a.kb'], extra: 1,
    panels: {
      'a.kb': { open: false, pinned: true, locked: true, meters: 1.2, anchor: 'left', glance: true, pose: POSE, extra: 1 },
      'a.bad': { open: 'no', pinned: 1, locked: null, meters: '1', anchor: 'foot', glance: 'yes', pose: 'here' },
      'a.head': { anchor: 'head', glance: 1 },
      'a.right': { anchor: 'right', glance: true },
      'a.case': { anchor: 'Left', glance: null },
      'a.listed': { anchor: ['left'], glance: [true] },
      'a.empty': {},
      'a.short': { pose: POSE.slice(0, 11) },
      'a.long': { pose: [...POSE, 0] },
      'a.nan': { pose: [...POSE.slice(0, 11), NaN], meters: NaN },
      'a.inf': { pose: [Infinity, ...POSE.slice(1)], meters: -0.5 },
      'a.text': { pose: [...POSE.slice(0, 11), '0'], meters: 0 },
      'a.round': { meters: 0.123456 },
      'nodot': { open: true }, 'A.Upper': {}, 'a.b.c': {}, '': {},
      'a.null': null, 'a.list': [], 'a.num': 5,
    },
  });
  assert.deepEqual(read, {
    stowed: true, stash: [], present: [], locked: true, errors: {},
    panels: {
      'a.kb': { open: false, pinned: true, locked: true, meters: 1.2, anchor: 'left', glance: true, pose: POSE },
      'a.head': { ...FRESH, anchor: 'head' }, 'a.right': { ...FRESH, anchor: 'right', glance: true }, 'a.case': FRESH, 'a.listed': FRESH,
      'a.bad': FRESH, 'a.empty': FRESH, 'a.short': FRESH, 'a.long': FRESH, 'a.nan': FRESH, 'a.inf': FRESH, 'a.text': FRESH,
      'a.round': { ...FRESH, meters: 0.123 },
    },
  });
  assert.notEqual(read.panels['a.kb']?.pose, POSE);
});

test('存盘的那一份只有全局锁和各块的记录，读回来是同样的记录；总开关每次启动都收起着，目录到之前什么都不显示', () => {
  const layout = lockAll(place(setPanel(setOpen(start(), SET, 'a.notes', false), LIST, 'a.kb', { meters: 1.1, pinned: true }), 'a.clock', POSE), true);
  const stored: unknown = JSON.parse(JSON.stringify(storedOf(layout)));
  assert.deepEqual(stored, {
    locked: true,
    panels: {
      'a.kb': { open: true, pinned: true, locked: false, meters: 1.1, anchor: 'world', glance: false, pose: null },
      'a.clock': { open: true, pinned: false, locked: false, meters: null, anchor: 'world', glance: false, pose: POSE },
      'a.notes': { open: false, pinned: false, locked: false, meters: null, anchor: 'world', glance: false, pose: null },
    },
  });
  // 收起着存的也一样：a.notes 打开之后按总开关，非常显的两块被收起，存盘的那一份和收起之前相同
  const whole = setOpen(layout, SET, 'a.notes', true);
  const stowed = toggleAll(whole);
  assert.deepEqual([stowed.stowed, stowed.stash], [true, ['a.clock', 'a.notes']]);
  assert.deepEqual(storedOf(stowed), storedOf(whole));
  const again = readLayout(stored);
  assert.deepEqual(again, { stowed: true, stash: [], present: [], locked: true, panels: layout.panels, errors: {} });
  assert.deepEqual(shown(again), []);
  // 目录到了：打开着的非常显面板进收起的那一组，常显的直接显示，关着的还关着
  const ready = withCatalog(again, LIST);
  assert.deepEqual([ready.stash, shown(ready), ready.panels['a.notes']?.open], [['a.clock'], ['a.kb'], false]);
  // 按总开关：收起的那一组恢复，上次关掉的 a.notes 也打开
  assert.deepEqual(shown(toggleAll(ready)), ALL);
});

test('显示方的设置：坏的项用默认值；上限取整并夹在 4–12；抓取延迟认数字和写成字符串的；快捷位空串是空位', () => {
  assert.deepEqual(DEFAULT_SETTINGS, {
    options: { blockInput: true, grabDelay: 0.15, stretch: true, snap: true, recenter: 'away' }, limit: 8, quick: ['yanuo.shell-classic', null],
  });
  assert.equal(DEFAULT_SETTINGS.options, DEFAULT_OPTIONS);
  for (const raw of [undefined, null, 5, 'x', [], {}]) assert.deepEqual(readSettings(raw), DEFAULT_SETTINGS, JSON.stringify(raw));
  assert.deepEqual(
    readSettings({ blockInput: false, grabDelay: '0.4', stretch: false, snap: false, recenter: 'always', limit: 10, quick1: 'a.clock', quick2: 'a.kb', other: 1 }),
    { options: { blockInput: false, grabDelay: 0.4, stretch: false, snap: false, recenter: 'always' }, limit: 10, quick: ['a.clock', 'a.kb'] },
  );
  assert.deepEqual(readSettings({ blockInput: 'no', stretch: 0, snap: null }).options, DEFAULT_OPTIONS);
  const delay = (grabDelay: unknown): number => readSettings({ grabDelay }).options.grabDelay;
  assert.deepEqual([0, '0', 0.15, '0.15', 0.4, '0.4', 0.2, '0.2', '', null, true].map(delay), [0, 0, 0.15, 0.15, 0.4, 0.4, 0.15, 0.15, 0.15, 0.15, 0.15]);
  const recenter = (value: unknown): string => readSettings({ recenter: value }).options.recenter;
  assert.deepEqual(['never', 'away', 'always', 'sometimes', 1, null].map(recenter), ['never', 'away', 'always', 'away', 'away', 'away']);
  const limit = (value: unknown): number => readSettings({ limit: value }).limit;
  assert.deepEqual([4, 12, 3, 0, -1, 13, 100, 6.4, 6.5, '6', NaN, Infinity, null].map(limit), [4, 12, 4, 4, 4, 12, 12, 6, 7, 8, 8, 8, 8]);
  // 快捷位：空串、不合格的 id 是空位；不是字符串时用默认值
  assert.deepEqual(readSettings({ quick1: '', quick2: '' }).quick, [null, null]);
  assert.deepEqual(readSettings({ quick1: 'Bad Id', quick2: 'a.kb' }).quick, [null, 'a.kb']);
  assert.deepEqual(readSettings({ quick1: 5, quick2: 5 }).quick, ['yanuo.shell-classic', null]);
});

test('发布的状态：按目录的顺序一块一项，带实际宽度、清单的范围、快捷位；open 算上被总开关收起着的，visible 是这一刻在显示；出错的带原因', () => {
  const list = [...LIST, panel('a.wrist', { icon: 'fox://component/a.wrist/icon.svg' })];
  let layout = withCatalog(emptyLayout(false), list);
  layout = setPanel(layout, list, 'a.kb', { meters: 1.2, locked: true });
  layout = setPanel(layout, list, 'a.clock', { pinned: true });
  layout = lockAll(toggleAll(failPanel(layout, 'a.wrist', 'page process gone')), true);
  const settings: DisplaySettings = { options: { ...DEFAULT_OPTIONS, snap: false }, limit: 6, quick: ['a.kb', 'a.clock'] };
  const state = viewOf(layout, list, settings, { display: { en: 'Desktop' }, connected: true });
  assert.deepEqual(state, {
    display: { en: 'Desktop' }, connected: true, stowed: true, locked: true, limit: 6,
    options: { blockInput: true, grabDelay: 0.15, stretch: true, snap: false, recenter: 'away' },
    panels: [
      { id: 'a.kb', name: 'a.kb', open: true, visible: false, pinned: false, locked: true, anchor: 'world', glance: false, meters: 1.2, minMeters: 0.4, maxMeters: 1.6, quick: 1 },
      { id: 'a.clock', name: 'a.clock', open: true, visible: true, pinned: true, locked: false, anchor: 'world', glance: false, meters: 0.5, minMeters: 0.1, maxMeters: 2, quick: 2 },
      { id: 'a.notes', name: 'a.notes', open: true, visible: false, pinned: false, locked: false, anchor: 'world', glance: false, meters: 0.5, minMeters: 0.1, maxMeters: 2, quick: 0 },
      {
        id: 'a.wrist', name: 'a.wrist', icon: 'fox://component/a.wrist/icon.svg', open: false, visible: false, pinned: false, locked: false, anchor: 'world', glance: false,
        meters: 0.5, minMeters: 0.1, maxMeters: 2, quick: 0, error: 'page process gone',
      },
    ],
  });
  // 恢复之后不算收起着，出错的那块重试
  const restored = viewOf(toggleAll(layout), list, settings, { display: 'x', connected: true });
  assert.deepEqual([restored.stowed, restored.panels.map(p => p.visible), restored.panels.map(p => p.error)], [false, [true, true, true, true], [undefined, undefined, undefined, undefined]]);
  // 显示方没连上：打开着的面板也不算在显示
  assert.deepEqual(viewOf(toggleAll(layout), list, settings, { display: 'x', connected: false }).panels.map(p => `${p.open} ${p.visible}`), [
    'true false', 'true false', 'true false', 'true false',
  ]);
  // 两个快捷位指向同一块：算 1 号
  assert.deepEqual(viewOf(layout, list, { ...settings, quick: ['a.notes', 'a.notes'] }, { display: 'x', connected: true }).panels.map(p => p.quick), [0, 0, 1, 0]);
  // 目录里有、布局没见过的面板：关着，清单的默认宽度
  const partial = viewOf(withCatalog(emptyLayout(false), [KB]), [KB, CLOCK], SET, { display: 'x', connected: true });
  assert.deepEqual(partial.panels.map(p => `${p.id} ${p.open} ${p.visible} ${p.meters}`), ['a.kb true true 0.8', 'a.clock false false 0.5']);
});

// 清单写着附着在别处的面板：手腕上的小面板(抬手才显示)、跟着头显的、清单写了不抬手也显示的右手面板
const WRIST = panel('a.wrist', { anchor: 'left', glance: true, meters: 0.12, minMeters: 0.08, maxMeters: 0.4 });
const HUD = panel('a.hud', { anchor: 'head' });
const PALM = panel('a.palm', { anchor: 'right', glance: false });
const MIXED = [KB, CLOCK, WRIST, HUD, PALM];
const MIXED_IDS = ['a.kb', 'a.clock', 'a.wrist', 'a.hud', 'a.palm'];
const mixed = (): Layout => withCatalog(emptyLayout(false), MIXED);

test('第一次进布局：附着在哪、抬手才显示取清单的值，清单写附着在手上的锁着；有记录的照记录，清单后来改了不跟着变', () => {
  const layout = mixed();
  assert.deepEqual(layout.panels, {
    'a.kb': FRESH, 'a.clock': FRESH,
    'a.wrist': { ...FRESH, locked: true, anchor: 'left', glance: true },
    'a.hud': { ...FRESH, anchor: 'head' },
    'a.palm': { ...FRESH, locked: true, anchor: 'right' },
  });
  // 清单的值变了：记录不变(同一份布局)
  const edited = [KB, CLOCK, panel('a.wrist'), panel('a.hud', { anchor: 'left', glance: true }), PALM];
  assert.equal(withCatalog(layout, edited), layout);
  // 离开目录再回来：照记录，不重新取清单的值、不重新锁上
  const free = setPanel(layout, MIXED, 'a.wrist', { locked: false, glance: false });
  const back = withCatalog(withCatalog(free, [KB]), edited);
  assert.deepEqual([back.panels['a.wrist'], back.panels['a.hud']], [{ ...FRESH, anchor: 'left' }, { ...FRESH, anchor: 'head' }]);
  // 卸载再装上：是第一次见到的面板，取这时清单的值
  const again = withCatalog(dropPanel(withCatalog(layout, [KB]), 'a.hud'), edited);
  assert.deepEqual(again.panels['a.hud'], { ...FRESH, locked: true, anchor: 'left', glance: true });
  // 存盘读回的记录照存的：清单写附着在手上、存的是留在空间里没锁的，进目录时不改
  const saved = withCatalog(readLayout({ panels: { 'a.wrist': { open: true, locked: false, anchor: 'world', glance: false, pose: POSE } } }), MIXED);
  assert.deepEqual(saved.panels['a.wrist'], { ...FRESH, pose: POSE });
  // 存盘里没有 anchor、glance 的记录：留在空间里、不抬手才显示，别的项照存的
  const old = withCatalog(readLayout({ panels: { 'a.wrist': { open: true, pinned: true, locked: true, meters: 0.2, pose: POSE } } }), MIXED);
  assert.deepEqual(old.panels['a.wrist'], { ...FRESH, pinned: true, locked: true, meters: 0.2, pose: POSE });
});

test('附着的查询：附着在哪(没有记录算留在空间里)；抬手才显示只在附着在手上且 glance 为真时算；附着在手上的抓取延迟固定 0.4 秒', () => {
  const layout = setPanel(mixed(), MIXED, 'a.hud', { glance: true });
  const ids = [...MIXED_IDS, 'a.none'];
  assert.deepEqual(ids.map(id => anchorOf(layout, id)), ['world', 'world', 'left', 'head', 'right', 'world']);
  assert.deepEqual(ids.map(id => glances(layout, id)), [false, false, true, false, false, false]);
  // 留在空间里的面板记录里 glance 为真也不算
  const world = setPanel(layout, MIXED, 'a.kb', { glance: true });
  assert.deepEqual([world.panels['a.kb']?.glance, glances(world, 'a.kb')], [true, false]);
  assert.equal(glances(setPanel(layout, MIXED, 'a.palm', { glance: true }), 'a.palm'), true);
  assert.equal(HAND_GRAB_DELAY, 0.4);
  for (const grabDelay of [0, 0.15, 0.4] as const) {
    const options = { ...DEFAULT_OPTIONS, grabDelay };
    assert.deepEqual(ids.map(id => grabDelayOf(layout, options, id)), [grabDelay, grabDelay, 0.4, grabDelay, 0.4, grabDelay]);
  }
  assert.deepEqual([...ANCHORS], ['world', 'head', 'left', 'right']);
  assert.deepEqual(ANCHORS.map(isHand), [false, false, true, true]);
  assert.deepEqual(['world', 'head', 'left', 'right', 'Left', 'hand', '', 0, null, undefined, ['left']].map(isAnchor), [true, true, true, true, false, false, false, false, false, false, false]);
});

test('改附着在哪：位置忘掉；变成附着在手上时抬手才显示、锁着，比 0.3 米宽的缩到 0.3 米(不小于清单的最小宽度)；变成别的只忘掉位置', () => {
  const layout = place(place(mixed(), 'a.kb', POSE), 'a.clock', OTHER);
  assert.equal(HAND_METERS, 0.3);
  // a.clock：默认 0.5 米，范围 0.1–2 米，缩到 0.3 米
  const left = setPanel(layout, MIXED, 'a.clock', { anchor: 'left' });
  assert.deepEqual(left.panels['a.clock'], { ...FRESH, locked: true, meters: 0.3, anchor: 'left', glance: true });
  assert.deepEqual(layout.panels['a.clock'], { ...FRESH, pose: OTHER });
  // a.kb：最小 0.4 米，缩到 0.4 米
  const kb = setPanel(layout, MIXED, 'a.kb', { anchor: 'right' });
  assert.deepEqual([kb.panels['a.kb'], metersOf(kb, KB)], [{ ...FRESH, locked: true, meters: 0.4, anchor: 'right', glance: true }, 0.4]);
  // 调过宽度的也一样；本来就不超过 0.3 米的宽度不动(没调过的还是跟清单的默认宽度)
  const sized = (meters: number): number | null | undefined => (
    setPanel(setPanel(layout, MIXED, 'a.clock', { meters }), MIXED, 'a.clock', { anchor: 'left' }).panels['a.clock']?.meters
  );
  assert.deepEqual([1.5, 0.301, 0.3, 0.25].map(sized), [0.3, 0.3, 0.3, 0.25]);
  const small = [panel('a.small', { meters: 0.2 })];
  assert.equal(setPanel(withCatalog(emptyLayout(false), small), small, 'a.small', { anchor: 'left' }).panels['a.small']?.meters, null);
  // 同一次改动里给了的抬手才显示、锁定、宽度照给的
  const explicit = setPanel(layout, MIXED, 'a.clock', { anchor: 'left', glance: false, locked: false, meters: 0.6 });
  assert.deepEqual(explicit.panels['a.clock'], { ...FRESH, meters: 0.6, anchor: 'left' });
  // 从一只手换到另一只手：也算变成附着在手上
  const freed = place(setPanel(left, MIXED, 'a.clock', { glance: false, locked: false, meters: 0.5 }), 'a.clock', POSE);
  assert.deepEqual(setPanel(freed, MIXED, 'a.clock', { anchor: 'right' }).panels['a.clock'], { ...FRESH, locked: true, meters: 0.3, anchor: 'right', glance: true });
  // 变成跟着头显、留在空间里：只忘掉位置，抬手才显示、锁、宽度都不动
  const placedLeft = place(left, 'a.clock', POSE);
  assert.deepEqual(setPanel(placedLeft, MIXED, 'a.clock', { anchor: 'head' }).panels['a.clock'], { ...FRESH, locked: true, meters: 0.3, anchor: 'head', glance: true });
  assert.deepEqual(setPanel(placedLeft, MIXED, 'a.clock', { anchor: 'world' }).panels['a.clock'], { ...FRESH, locked: true, meters: 0.3, anchor: 'world', glance: true });
  assert.deepEqual(setPanel(layout, MIXED, 'a.kb', { anchor: 'head' }).panels['a.kb'], { ...FRESH, anchor: 'head' });
  // 和记录里一样的 anchor：位置留着，没别的改动时给回同一份
  assert.equal(setPanel(placedLeft, MIXED, 'a.clock', { anchor: 'left' }), placedLeft);
  assert.equal(setPanel(layout, MIXED, 'a.kb', { anchor: 'world' }), layout);
  assert.deepEqual(setPanel(placedLeft, MIXED, 'a.clock', { anchor: 'left', pinned: true }).panels['a.clock']?.pose, POSE);
  // 认不出的 anchor 不改
  assert.equal(setPanel(layout, MIXED, 'a.kb', { anchor: 'foot' as never }), layout);
  // 只改抬手才显示：别的不动，没变时给回同一份
  const plain = setPanel(placedLeft, MIXED, 'a.clock', { glance: false });
  assert.deepEqual(plain.panels['a.clock'], { ...FRESH, locked: true, meters: 0.3, anchor: 'left', pose: POSE });
  assert.equal(setPanel(plain, MIXED, 'a.clock', { glance: false }), plain);
  // 被总开关收起着的改附着：还收起着；总开关、常显、上限、快捷位对附着的面板一样
  const stowed = toggleAll(layout);
  assert.deepEqual(stowed.stash, MIXED_IDS);
  const moved = setPanel(stowed, MIXED, 'a.clock', { anchor: 'left' });
  assert.deepEqual([moved.stash, shown(moved)], [MIXED_IDS, []]);
  assert.deepEqual(shown(toggleAll(setPanel(layout, MIXED, 'a.wrist', { pinned: true }))), ['a.wrist']);
  const tight: DisplaySettings = { ...SET, limit: 4, quick: [null, 'a.palm'] };
  assert.deepEqual(shownSet(layout, tight), ['a.kb', 'a.clock', 'a.wrist', 'a.palm']);
  assert.deepEqual(shownSet(quickKey(layout, tight, 2), tight), ['a.kb', 'a.clock', 'a.wrist', 'a.hud']);
});

test('重置附着的面板：回到清单的附着对象、抬手才显示、默认宽度，位置忘掉，锁照清单的附着对象；常显、打开没有不动', () => {
  const layout = mixed();
  // 清单写在左手腕上的面板被挪到空间里、调宽、解锁
  const moved = place(setPanel(layout, MIXED, 'a.wrist', { anchor: 'world', glance: false, locked: false, meters: 0.3, pinned: true }), 'a.wrist', POSE);
  assert.deepEqual(moved.panels['a.wrist'], { ...FRESH, pinned: true, meters: 0.3, pose: POSE });
  const back = reset(moved, MIXED, 'a.wrist');
  assert.deepEqual([back.panels['a.wrist'], metersOf(back, WRIST)], [{ ...FRESH, pinned: true, locked: true, anchor: 'left', glance: true }, 0.12]);
  assert.equal(reset(back, MIXED, 'a.wrist'), back);
  // 清单写留在空间里的面板被挂到手上：重置回空间里，改附着时带上的锁解开
  const hung = place(setPanel(layout, MIXED, 'a.clock', { anchor: 'right' }), 'a.clock', OTHER);
  assert.deepEqual(reset(hung, MIXED, 'a.clock').panels['a.clock'], FRESH);
  // 只有锁和清单的附着对象不一样：也重置
  assert.deepEqual(reset(setPanel(layout, MIXED, 'a.wrist', { locked: false }), MIXED, 'a.wrist').panels['a.wrist'], layout.panels['a.wrist']);
  assert.deepEqual(reset(setPanel(layout, MIXED, 'a.kb', { locked: true }), MIXED, 'a.kb').panels['a.kb'], layout.panels['a.kb']);
  // 只有抬手才显示和清单不一样、只有附着对象不一样：也重置
  assert.deepEqual(reset(setPanel(layout, MIXED, 'a.wrist', { glance: false }), MIXED, 'a.wrist').panels['a.wrist'], layout.panels['a.wrist']);
  assert.deepEqual(reset(setPanel(layout, MIXED, 'a.hud', { anchor: 'world' }), MIXED, 'a.hud').panels['a.hud'], layout.panels['a.hud']);
  // 附着的面板挪过位置(相对设备的变换)：重置忘掉
  assert.deepEqual(reset(place(layout, 'a.hud', POSE), MIXED, 'a.hud').panels['a.hud'], layout.panels['a.hud']);
  // 已经是清单的值：给回同一份；清单后来改了：照这时的清单
  assert.equal(reset(layout, MIXED, 'a.wrist'), layout);
  assert.deepEqual(reset(layout, [KB, CLOCK, panel('a.wrist', { anchor: 'head' })], 'a.wrist').panels['a.wrist'], { ...FRESH, anchor: 'head' });
});

test('到面前不动附着的面板：留在空间里的忘掉位置，附着在头显或手上的位置留着；点名一块附着的面板时照样打开', () => {
  let layout = mixed();
  for (const id of MIXED_IDS) layout = place(layout, id, id === 'a.clock' ? OTHER : POSE);
  // 全部到面前
  const all = summon(layout, SET);
  assert.deepEqual(MIXED_IDS.map(id => all.panels[id]?.pose), [null, null, POSE, POSE, POSE]);
  // 一块都没有留在空间里的要动：给回同一份
  assert.equal(summon(all, SET), all);
  // 点名附着的面板：显示着的不变
  for (const id of ['a.wrist', 'a.hud', 'a.palm']) assert.equal(summon(layout, SET, id), layout, id);
  // 关着的附着面板：打开，位置留着
  const opened = summon(setOpen(layout, SET, 'a.wrist', false), SET, 'a.wrist');
  assert.deepEqual([shown(opened), opened.panels['a.wrist']], [MIXED_IDS, { ...FRESH, locked: true, anchor: 'left', glance: true, pose: POSE }]);
  // 被总开关收起着的附着面板：单独显示出来，位置留着
  const alone = summon(toggleAll(layout), SET, 'a.hud');
  assert.deepEqual([shown(alone), alone.panels['a.hud']?.pose], [['a.hud'], POSE]);
  // 留在空间里的面板挂到头显上之后也不动；挪回空间里之后到面前照常
  const hung = place(setPanel(layout, MIXED, 'a.kb', { anchor: 'head' }), 'a.kb', OTHER);
  assert.equal(summon(hung, SET, 'a.kb'), hung);
  assert.deepEqual(summon(hung, SET).panels['a.kb']?.pose, OTHER);
  const home = place(setPanel(hung, MIXED, 'a.kb', { anchor: 'world' }), 'a.kb', POSE);
  assert.equal(summon(home, SET, 'a.kb').panels['a.kb']?.pose, null);
});

test('发布的状态：带上附着在哪、抬手才显示(照记录，不照清单)；显示方说这一刻没在显示的面板 visible 为假，open 不变', () => {
  const layout = setPanel(setPanel(mixed(), MIXED, 'a.hud', { anchor: 'world' }), MIXED, 'a.clock', { anchor: 'right' });
  const status = { display: 'x', connected: true };
  const state = viewOf(layout, MIXED, SET, status);
  assert.deepEqual(state.panels.map(p => [p.id, p.anchor, p.glance, p.locked, p.meters, p.visible]), [
    ['a.kb', 'world', false, false, 0.8, true], ['a.clock', 'right', true, true, 0.3, true], ['a.wrist', 'left', true, true, 0.12, true],
    ['a.hud', 'world', false, false, 0.5, true], ['a.palm', 'right', false, true, 0.5, true],
  ]);
  // 附着的设备不在、没抬手的那几块：没在显示，还算打开着
  const away = viewOf(layout, MIXED, SET, { ...status, hidden: ['a.wrist', 'a.clock', 'a.none'] });
  assert.deepEqual(away.panels.map(p => `${p.open} ${p.visible}`), ['true true', 'true false', 'true false', 'true true', 'true true']);
  assert.deepEqual(viewOf(layout, MIXED, SET, { ...status, hidden: [] }), state);
  // 没连上时都不在显示
  assert.deepEqual(viewOf(layout, MIXED, SET, { display: 'x', connected: false, hidden: ['a.wrist'] }).panels.map(p => p.visible), [false, false, false, false, false]);
  // 目录里有、布局没见过的面板：照清单的值
  const partial = viewOf(withCatalog(emptyLayout(false), [KB]), [KB, WRIST], SET, status).panels[1];
  assert.deepEqual([partial?.open, partial?.anchor, partial?.glance, partial?.locked], [false, 'left', true, false]);
});

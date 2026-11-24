import test from 'node:test';
import assert from 'node:assert/strict';
import type { Caller } from '@konkon-lab/foxpanel-sdk';
import { readLayout, type Layout, type PanelRecord, type StoredLayout } from '../components/_shared/panels/layout.ts';
import { arrange, position, type Mat34 } from '../components/steamvr/src/geometry.ts';
import { EVENT_QUIT, ROLE_LEFT } from '../components/steamvr/src/openvr.ts';
import { overlayKey } from '../components/steamvr/src/surface.ts';
import {
  ACTION, at, BLOCK, CLOCK, connected, DEVICE, HEAD, HUD, info, KB, near, PROBE, Rig, settingsWith, shifted, shown, SOURCE, textures, turned, WRIST,
} from './vr-helpers.ts';

const WHO: Caller = { component: 'a.other', where: 'process' };
const BUTTONS = 10;   // 一帧读的按键数：两只手各 5 个动作
const buttons = (): string[] => Array.from({ length: BUTTONS }, () => 'button');
const SECOND = 100;   // 1 秒的帧数：一块面板出错后歇这么久才重试
// 最近存盘的布局里各块面板打开没有
const storedOpen = (rig: Rig): Record<string, boolean> => {
  const stored = rig.stored.at(-1) as StoredLayout | undefined;
  return Object.fromEntries(Object.entries(stored?.panels ?? {}).map(([id, record]) => [id, record.open]));
};

// ---------- 每帧循环 ----------

test('每帧循环：一帧里各个调用的次序', t => {
  const rig = connected(t);
  const { vr } = rig;
  let from = rig.calls.length;
  rig.frame();   // 什么都没显示；手柄的设备序号第一次出现，取指尖
  assert.deepEqual(rig.names(from), ['events', 'poses', 'roleIndex', 'tip', 'roleIndex', 'tip', 'activate', ...buttons()]);
  assert.deepEqual(rig.args('tip'), [[DEVICE.left, vr.id('source', SOURCE.left)], [DEVICE.right, vr.id('source', SOURCE.right)]]);
  assert.deepEqual(rig.args('activate'), [[vr.id('set', '/actions/main'), 0]]);
  // 每只手依次读：总开关、扳机、握把、快捷位 1、快捷位 2
  assert.deepEqual(rig.args('button'), (['left', 'right'] as const).flatMap(side => (
    (['toggle', 'click', 'grab', 'quick1', 'quick2'] as const).map(a => [vr.id('action', ACTION[a]), vr.id('source', SOURCE[side])])
  )));

  rig.press('toggle', 'right', true);
  rig.frame();   // 这一帧末尾布局变了
  rig.press('toggle', 'right', false);
  from = rig.calls.length;
  rig.frame();   // 键盘：建悬浮窗口、设宽度、放到面前、显示
  assert.deepEqual(rig.names(from), ['events', 'poses', 'roleIndex', 'roleIndex', 'overlay', 'createQuery', 'setWidth', 'place', 'show', 'activate', ...buttons()]);
  from = rig.calls.length;
  rig.frame();   // 时钟
  assert.deepEqual(rig.names(from), ['events', 'poses', 'roleIndex', 'roleIndex', 'overlay', 'createQuery', 'setWidth', 'place', 'show', 'activate', ...buttons()]);
  assert.deepEqual(rig.args('overlay').slice(2), [[overlayKey('a.kb'), 'FoxPanel a.kb'], [overlayKey('a.clock'), 'FoxPanel a.clock']]);

  rig.page('a.kb').send(1);
  rig.page('a.clock').send(1);
  rig.aim('left', 'a.kb', 350, 350);
  rig.aim('right', 'a.clock', 200, 100);
  rig.frame(2);
  from = rig.calls.length;
  rig.frame();   // 两块都显示着、有画面，两只手各指着一块：求交不调 SteamVR
  assert.deepEqual(rig.names(from), [
    'events', 'poses', 'roleIndex', 'roleIndex', 'activate', ...buttons(),
    'place', 'place',
    'setTexture', 'setTexture',
  ]);
  assert.equal(rig.args('activate').at(-1)?.[1], BLOCK);
  assert.deepEqual([rig.page('a.kb').events.at(-1), rig.page('a.clock').events.at(-1)], ['move 350,350', 'move 200,100']);
  rig.session.stop();
});

test('从没显示过的面板不建悬浮窗口；清单写了 keep 的打开着的面板连上就开着页面停画，没写的显示出来时才开；页面等悬浮窗口显示了才画', t => {
  const rig = connected(t);
  rig.frame(5);
  assert.deepEqual([rig.opened, rig.vr.overlays.length], [['a.kb'], 2]);   // 键盘写了 keep；悬浮窗口只有两个圆点
  assert.deepEqual(rig.page('a.kb').paints, [false]);
  rig.tap('toggle');
  assert.deepEqual(rig.opened, ['a.kb', 'a.clock']);
  assert.deepEqual(rig.page('a.kb').paints, [false, true]);          // 开的时候停着画，显示出来才画(宿主这时重画一帧)
  assert.deepEqual(rig.page('a.clock').paints, [false]);             // 时钟的悬浮窗口还没轮到建
  rig.frame();
  assert.deepEqual(rig.page('a.clock').paints, [false, true]);
  rig.session.stop();
});

test('关着的面板清单写了 keep 也不预先开页面', t => {
  const rig = connected(t, { layout: readLayout({ panels: { 'a.kb': { open: false } } }) });
  rig.frame(5);
  assert.deepEqual([rig.opened, rig.views()], [[], ['a.kb false false', 'a.clock true false']]);
  rig.session.stop();
});

test('每帧最多建一个悬浮窗口，也最多销毁一个', t => {
  const rig = connected(t, { list: [KB, CLOCK, info('a.third'), info('a.fourth')] });
  const built = (): number => rig.args('overlay').length - 2;
  const destroyed = (): number => rig.args('destroy').length;
  rig.press('toggle', 'right', true);
  rig.frame();
  rig.press('toggle', 'right', false);
  assert.equal(built(), 0);
  for (const n of [1, 2, 3, 4, 4]) {
    rig.frame();
    assert.equal(built(), n);
  }
  assert.deepEqual(rig.views(), ['a.kb true true', 'a.clock true true', 'a.third true true', 'a.fourth true true']);
  // 三块面板的组件一起关了：一帧销毁一个
  rig.list = [KB];
  rig.control.catalog(rig.list);
  for (const n of [1, 2, 3, 3]) {
    rig.frame();
    assert.equal(destroyed(), n);
  }
  assert.deepEqual(['a.clock', 'a.third', 'a.fourth'].map(id => [rig.page(id).closed, rig.panel(id).destroyed]), [[true, true], [true, true], [true, true]]);
  assert.equal(rig.panel('a.kb').visible, true);
  rig.session.stop();
});

test('面板的组件关了(页面先报没了，目录后到)：悬浮窗口不当场销毁，照样一帧销毁一个', t => {
  const rig = shown(t, { list: [KB, CLOCK, info('a.third'), info('a.fourth')] });
  const destroyed = (): number => rig.args('destroy').length;
  for (const id of ['a.clock', 'a.third', 'a.fourth']) rig.page(id).report('gone', 'removed');
  assert.equal(destroyed(), 0);
  rig.list = [KB];
  rig.control.catalog(rig.list);
  for (const n of [1, 2, 3, 3]) {
    rig.frame();
    assert.equal(destroyed(), n);
  }
  assert.deepEqual([rig.views(), rig.panel('a.kb').visible], [['a.kb true true'], true]);
  rig.session.stop();
});

test('总开关收起着时面板的组件关掉再打开(页面先报没了，目录后到)：回来的和新进目录的面板都在收起的那一组里，按总开关键才出现', t => {
  const rig = shown(t, { list: [KB] });
  rig.tap('toggle');
  rig.frame(2);
  rig.page('a.kb').report('gone', 'removed');
  rig.list = [];
  rig.control.catalog(rig.list);
  rig.frame(2);
  assert.equal(rig.panel('a.kb').destroyed, true);
  rig.list = [KB, CLOCK];
  rig.control.catalog(rig.list);
  rig.frame(4);
  assert.deepEqual([rig.views(), rig.panels.stowed], [['a.kb true false', 'a.clock true false'], true]);
  assert.equal(rig.vr.overlays.filter(o => !o.destroyed).length, 2);   // 只有两个圆点
  rig.tap('toggle');
  rig.frame(2);
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, true]);
  rig.session.stop();
});

test('隐藏没成功：下一帧接着试，成了才算隐藏、页面才停画', t => {
  const rig = shown(t, { list: [KB] });
  const o = rig.panel();
  rig.vr.stuck.add(overlayKey('a.kb'));
  rig.tap('toggle');
  rig.frame(3);
  assert.deepEqual([o.visible, rig.page().painting, rig.count('hide', o)], [true, true, 4]);
  rig.vr.stuck.clear();
  rig.frame();
  assert.deepEqual([o.visible, rig.page().painting, rig.count('hide', o)], [false, false, 5]);
  rig.frame(3);
  assert.equal(rig.count('hide', o), 5);
  rig.session.stop();
});

test('摆放时只避开显示着的面板：关着的面板占过的位置可以用', t => {
  const low = info('a.low');
  const rig = shown(t, { list: [KB] });
  near(rig.panel('a.kb').pose, arrange(HEAD, 'low', []));
  rig.tap('quick1');                                        // 关掉键盘
  rig.list = [KB, low];
  rig.control.catalog(rig.list);
  rig.frame(2);
  assert.deepEqual(rig.views(), ['a.kb false false', 'a.low true true']);
  near(rig.panel('a.low').pose, arrange(HEAD, 'low', []));
  rig.session.stop();
});

test('第一次显示按清单的 spawn 放到面前，后放的错开先放的；宽度是清单的默认宽度', t => {
  const rig = shown(t);
  const kb = arrange(HEAD, 'low', []);
  near(rig.panel('a.kb').pose, kb);
  near(rig.panel('a.clock').pose, arrange(HEAD, 'front', [position(kb)]));
  assert.deepEqual([rig.panel('a.kb').meters, rig.panel('a.clock').meters], [0.8, 0.3]);
  // 位置记进了布局
  near(rig.control.layout.panels['a.kb']?.pose ?? [], kb);
  rig.session.stop();
});

// ---------- 显示和隐藏 ----------

test('不显示的面板停画：收起时隐藏悬浮窗口、页面停画，之后交来的帧直接还、不交纹理；恢复时接着画', t => {
  const rig = shown(t);
  const kb = rig.page('a.kb');
  const overlay = rig.panel('a.kb');
  kb.send(1);
  rig.frame(2);
  assert.equal(overlay.texture, textures(rig.gpu)[0]);
  const sets = rig.count('setTexture', overlay);
  kb.send(2);                                     // 等着复制
  rig.tap('toggle');
  assert.deepEqual([overlay.visible, kb.painting, kb.closed], [false, false, false]);
  assert.deepEqual(kb.released, [1, 2]);          // 手里的帧都还了
  kb.send(3);                                     // 停画的要求到宿主之前出的帧
  assert.deepEqual([kb.released, kb.early], [[1, 2, 3], []]);
  rig.frame(5);
  assert.equal(rig.count('setTexture', overlay), sets);       // 收起之后不交纹理
  assert.deepEqual(rig.views(), ['a.kb true false', 'a.clock true false']);
  assert.equal(rig.status.at(-1), 'ok 0');

  rig.tap('toggle');
  assert.deepEqual([overlay.visible, kb.painting], [true, true]);
  assert.equal(rig.count('show', overlay), 2);
  assert.equal(rig.args('overlay').length, 4);    // 悬浮窗口接着用，没有重建
  kb.send(4);
  rig.frame(2);
  assert.ok(rig.count('setTexture', overlay) > sets);
  assert.equal(rig.status.at(-1), 'ok 2');
  rig.session.stop();
});

test('收起满 60 秒：清单没写 keep 的面板关掉页面、销毁悬浮窗口，写了的留着；再打开时重新开页面，回到上次的位置', t => {
  const rig = shown(t);
  const clock = rig.page('a.clock');
  const kb = rig.page('a.kb');
  const where = rig.panel('a.clock').pose;
  rig.tap('toggle');
  rig.wait(59_900);
  rig.frame();
  assert.deepEqual([clock.closed, rig.panel('a.clock').destroyed], [false, false]);
  rig.wait(200);
  rig.frame();
  assert.deepEqual([clock.closed, rig.panel('a.clock').destroyed], [true, true]);
  assert.deepEqual([kb.closed, kb.painting, rig.panel('a.kb').destroyed], [false, false, false]);
  rig.wait(600_000);
  rig.frame();
  assert.deepEqual([kb.closed, rig.panel('a.kb').destroyed], [false, false]);
  assert.deepEqual(rig.views(), ['a.kb true false', 'a.clock true false']);   // 布局里还是打开着

  rig.tap('toggle');
  rig.frame();
  assert.deepEqual(rig.opened, ['a.kb', 'a.clock', 'a.clock']);
  assert.notEqual(rig.page('a.clock'), clock);
  assert.deepEqual([rig.panel('a.clock').visible, rig.panel('a.clock').destroyed], [true, false]);
  near(rig.panel('a.clock').pose, where);
  assert.equal(rig.page('a.kb'), kb);
  rig.session.stop();
});

test('显示时的摆放：只拉回不在面前的(默认)、每次重排、不动', t => {
  const far = at(5, 1.6, 0);
  // 默认：头稍微动了面板留在原地，走远了才拉回来
  const away = shown(t, { list: [KB] });
  const first = away.panel().pose;
  away.tap('toggle');
  away.setHead(at(0.05, 1.6, 0));
  away.tap('toggle');
  assert.equal(away.panel().pose, first);
  assert.equal(away.count('place', away.panel()), 1);
  away.tap('toggle');
  away.setHead(far);
  away.tap('toggle');
  near(away.panel().pose, arrange(far, 'low', []));
  away.session.stop();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const always = shown(t, { list: [KB], settings: settingsWith({ recenter: 'always' }) });
  always.tap('toggle');
  always.setHead(at(0.05, 1.6, 0));
  always.tap('toggle');
  near(always.panel().pose, arrange(at(0.05, 1.6, 0), 'low', []));
  always.session.stop();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const never = shown(t, { list: [KB], settings: settingsWith({ recenter: 'never' }) });
  const stay = never.panel().pose;
  never.tap('toggle');
  never.setHead(far);
  never.tap('toggle');
  assert.equal(never.panel().pose, stay);
  never.session.stop();
});

test('头显姿态无效时照样拿这一帧取到的头显矩阵算面前的位置，不沿用上一次有效的', t => {
  const rig = connected(t, { list: [KB] });
  rig.frame();                       // 头显姿态有效的一帧
  rig.vr.setPose(0, null);           // 之后无效：假 Vr 给的矩阵是单位阵
  rig.tap('toggle');
  near(rig.panel().pose, arrange([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], 'low', []));
  rig.session.stop();
});

test('布局里的宽度和位置变了，悬浮窗口跟上：改宽度、重置、到面前', t => {
  const rig = shown(t, { list: [KB] });
  const overlay = rig.panel();
  void rig.remote.set(WHO, 'a.kb', { meters: 1.2 });
  assert.equal(overlay.meters, 0.8);               // 下一帧才动
  rig.frame();
  assert.equal(overlay.meters, 1.2);
  assert.equal(rig.panels.panels[0]?.meters, 1.2);
  rig.setHead(at(1, 1.6, 0));
  void rig.remote.summon(WHO, 'a.kb');
  rig.frame();
  near(overlay.pose, arrange(at(1, 1.6, 0), 'low', []));
  assert.equal(overlay.meters, 1.2);
  rig.setHead(at(2, 1.6, 0));
  void rig.remote.reset(WHO, 'a.kb');
  rig.frame();
  near(overlay.pose, arrange(at(2, 1.6, 0), 'low', []));
  assert.equal(overlay.meters, 0.8);
  const places = rig.count('place', overlay);
  rig.frame(5);                                    // 没有变化的帧不调
  assert.deepEqual([rig.count('place', overlay), rig.count('setWidth', overlay)], [places, 3]);
  rig.session.stop();
});

test('存着的布局：连上后照它显示——位置和宽度是上次的，不重新放到面前', t => {
  const pose = at(0.1, 1.2, -0.6);
  const rig = connected(t, { list: [KB], layout: readLayout({ locked: false, panels: { 'a.kb': { open: true, pinned: false, locked: false, meters: 1.1, pose } } }) });
  rig.tap('toggle');
  assert.deepEqual([rig.panel().pose, rig.panel().meters, rig.panel().visible], [pose, 1.1, true]);
  rig.session.stop();
});

// ---------- 重连 ----------

test('重连后照表重建：断开时悬浮窗口都放掉、页面留着停画；再连上按总开关键，面板在新的连接里重新建出来，位置、宽度、页面都和断开之前一样', t => {
  const rig = shown(t);
  void rig.remote.set(WHO, 'a.clock', { meters: 0.5 });
  rig.frame();
  const poses = [rig.panel('a.kb').pose, rig.panel('a.clock').pose];
  const pages = [rig.page('a.kb'), rig.page('a.clock')];
  const old = rig.vr;
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  assert.equal(rig.session.connected, false);
  assert.deepEqual(old.overlays.map(o => o.destroyed), [true, true, true, true]);
  assert.deepEqual(pages.map(p => [p.painting, p.closed]), [[false, false], [false, false]]);
  assert.deepEqual([rig.panels.connected, rig.panels.stowed, rig.views()], [false, true, ['a.kb true false', 'a.clock true false']]);
  assert.equal(rig.status.at(-1), 'idle');

  rig.wait(PROBE);
  assert.equal(rig.connects, 2);
  rig.frame(3);
  assert.equal(rig.vr.overlays.length, 2);                  // 收起着：只有两个圆点
  rig.tap('toggle');
  rig.frame();
  assert.deepEqual([rig.panel('a.kb').pose, rig.panel('a.clock').pose], poses);
  assert.deepEqual([rig.panel('a.kb').meters, rig.panel('a.clock').meters], [0.8, 0.5]);
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, true]);
  assert.deepEqual(rig.opened, ['a.kb', 'a.clock']);        // 页面没有重新开
  assert.deepEqual(pages.map(p => p.painting), [true, true]);
  // 同一个页面的帧贴到新的悬浮窗口上
  pages[0]?.send(7);
  rig.frame(2);
  assert.equal(rig.panel('a.kb').texture, textures(rig.gpu)[0]);
  rig.session.stop();
});

test('重连：常显的面板不用按总开关键，连上就重新建出来', t => {
  const rig = shown(t);
  void rig.remote.set(WHO, 'a.clock', { pinned: true });
  rig.frame();
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  assert.deepEqual(rig.views(), ['a.kb true false', 'a.clock true false']);
  rig.wait(PROBE);
  rig.frame(2);
  assert.equal(rig.panel('a.clock').visible, true);
  assert.equal(rig.overlay('a.kb'), undefined);
  assert.deepEqual(rig.views(), ['a.kb true false', 'a.clock true true']);
  rig.session.stop();
});

test('断开着满 60 秒：清单没写 keep 的面板的页面关掉；再连上显示时重新开', t => {
  const rig = shown(t);
  rig.session.stop();
  rig.running = false;
  rig.session.start();
  rig.wait(PROBE * 11);
  assert.deepEqual([rig.page('a.clock').closed, rig.page('a.kb').closed], [false, false]);
  rig.wait(PROBE * 2);
  assert.deepEqual([rig.page('a.clock').closed, rig.page('a.kb').closed], [true, false]);
  rig.running = true;
  rig.wait(PROBE);
  rig.tap('toggle');
  rig.frame();
  assert.deepEqual(rig.opened, ['a.kb', 'a.clock', 'a.clock']);
  rig.session.stop();
});

test('断开着的 60 秒从断开那一刻算起：显示了很久的面板断开后也要再过 60 秒才关页面', t => {
  const rig = shown(t);
  rig.wait(70_000);
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  assert.equal(rig.session.connected, false);
  rig.running = false;
  rig.wait(PROBE * 2);
  assert.equal(rig.page('a.clock').closed, false);
  rig.wait(60_000);
  assert.deepEqual([rig.page('a.clock').closed, rig.page('a.kb').closed], [true, false]);
  rig.session.stop();
});

test('建悬浮窗口时键被这次连接里没销毁成的悬浮窗口占着：接管那一个，照常显示', t => {
  const rig = new Rig(t, { list: [KB] });
  rig.prepare = vr => {
    const stale = vr.overlay(overlayKey('a.kb'), 'stale');
    vr.show(stale);
  };
  rig.session.start();
  rig.tap('toggle');
  assert.deepEqual(rig.vr.adopted, [overlayKey('a.kb')]);
  assert.equal(rig.panel().visible, true);
  near(rig.panel().pose, arrange(HEAD, 'low', []));
  rig.session.stop();
});

test('悬浮窗口的键被别的程序占着：不接管；圆点的键被占着时连不上，面板的键被占着时只算那块面板出错', t => {
  const rig = new Rig(t);
  rig.prepare = vr => { vr.taken.add(overlayKey('a.clock')); };
  rig.session.start();
  rig.tap('toggle');
  rig.frame(2 * SECOND + 5);
  assert.deepEqual([rig.session.connected, rig.vr.adopted, rig.overlay('a.clock')], [true, [], undefined]);
  assert.deepEqual([rig.views(), rig.panels.panels[1]?.error], [['a.kb true true', 'a.clock false false'], `创建悬浮窗口 ${overlayKey('a.clock')} 失败 17`]);
  rig.session.stop();
});

test('圆点的键被别的程序占着：连不上，记一行错误，不动那个悬浮窗口', t => {
  const rig = new Rig(t);
  rig.prepare = vr => { vr.taken.add('yanuo.foxpanel:pointer.right'); };
  rig.session.start();
  assert.deepEqual([rig.session.connected, rig.vr.adopted, rig.vr.overlays.map(o => o.destroyed)], [false, [], [true]]);
  assert.equal(rig.logs.at(-1), 'error: vr: 创建悬浮窗口 yanuo.foxpanel:pointer.right 失败 17');
  rig.session.stop();
});

// ---------- 一块面板出错只动它自己 ----------

test('一块面板建纹理失败不影响另一块：出错后歇 1 秒再试，10 秒里出错 3 次才停用它，另一块照常；停用不进存盘，再打开时重试', t => {
  const rig = shown(t);
  const clock = rig.page('a.clock');
  const kb = rig.page('a.kb');
  rig.gpu.fail('createTexture', '显存不够');
  clock.send(1);
  rig.frame();
  assert.deepEqual(rig.logs.slice(1), ['vr: a.clock 纹理 400×200', 'warn: panel a.clock: 显存不够']);
  assert.deepEqual(clock.released, [1]);                    // 出错的帧还给宿主
  assert.deepEqual([rig.session.connected, rig.panel('a.clock').visible, rig.panel('a.kb').visible], [true, true, true]);
  rig.gpu.fail('createTexture', null);
  kb.send(1);
  rig.frame(2);
  assert.equal(rig.panel('a.kb').texture, textures(rig.gpu)[0]);   // 键盘的帧照常贴上

  // 歇着的 1 秒里不试：新来的帧留着，不建纹理，也指不着它
  rig.gpu.fail('createTexture', '显存不够');
  clock.send(2);
  rig.aim('left', 'a.clock', 200, 100);
  rig.frame(SECOND - 3);
  assert.deepEqual([rig.logs.length, clock.released, rig.dot('left').visible], [4, [1], false]);
  rig.away('left');
  rig.frame();                                              // 歇满 1 秒：第 2 次
  assert.deepEqual([rig.logs.slice(4), clock.released], [['vr: a.clock 纹理 400×200', 'warn: panel a.clock: 显存不够'], [1, 2]]);
  clock.send(3);
  rig.frame(SECOND);                                        // 第 3 次：停用
  rig.gpu.fail('createTexture', null);
  assert.deepEqual([clock.closed, rig.panel('a.clock').destroyed], [true, true]);
  assert.deepEqual(rig.views(), ['a.kb true true', 'a.clock false false']);
  assert.equal(rig.panels.panels[1]?.error, '显存不够');
  assert.deepEqual([rig.session.connected, rig.panel('a.kb').visible, kb.closed], [true, true, false]);
  assert.equal(rig.status.at(-1), 'ok 1');
  rig.frame(SECOND);
  assert.equal(rig.opened.length, 2);                       // 停用了的不自己重开
  assert.deepEqual(storedOpen(rig), { 'a.kb': true, 'a.clock': true });   // 存盘里还是打开着

  void rig.remote.open(WHO, 'a.clock', true);
  rig.frame(2);
  assert.deepEqual(rig.opened, ['a.kb', 'a.clock', 'a.clock']);
  assert.deepEqual([rig.panel('a.clock').visible, rig.views()[1], rig.panels.panels[1]?.error], [true, 'a.clock true true', undefined]);
  rig.page('a.clock').send(1);
  rig.frame(2);
  assert.ok(rig.panel('a.clock').texture);
  rig.session.stop();
});

test('出错隔得久不算：两次出错之后过了 10 秒，第 3 次不停用', t => {
  const rig = shown(t, { list: [KB] });
  const kb = rig.page();
  rig.gpu.fail('beginCopy', '打不开共享纹理');
  kb.send(1);
  rig.frame();
  kb.send(2);
  rig.frame(SECOND);
  rig.wait(10_000);
  kb.send(3);
  rig.frame();
  assert.deepEqual([rig.panel().destroyed, kb.closed, rig.views()], [false, false, ['a.kb true true']]);
  assert.equal(rig.logs.filter(l => l === 'warn: panel a.kb: 打不开共享纹理').length, 3);
  kb.send(4);
  rig.frame(SECOND);
  kb.send(5);
  rig.frame(SECOND);
  assert.deepEqual([rig.panel().destroyed, kb.closed, rig.panels.panels[0]?.error], [true, true, '打不开共享纹理']);
  rig.session.stop();
});

test('悬浮窗口建不出来、显示不出来：只算这块面板出错，3 次后停用，连接不断', t => {
  const rig = connected(t);
  rig.frame();
  rig.vr.fail('overlay', '创建悬浮窗口失败 21');
  rig.tap('toggle');
  rig.frame(5);
  assert.equal(rig.args('overlay').length, 4);              // 两个圆点，加一帧试一块：键盘、时钟各试了一次就歇着
  rig.frame(2 * SECOND);
  assert.equal(rig.session.connected, true);
  assert.deepEqual(rig.views(), ['a.kb false false', 'a.clock false false']);
  assert.deepEqual(rig.panels.panels.map(p => p.error), ['创建悬浮窗口失败 21', '创建悬浮窗口失败 21']);
  assert.deepEqual(rig.pages.map(p => p.closed), [true, true]);
  rig.vr.fail('overlay', null);
  // 显示不出来
  rig.vr.stuck.add(overlayKey('a.kb'));
  rig.tap('quick1');
  rig.frame(2 * SECOND);
  assert.equal(rig.panels.panels[0]?.error, 'overlay did not show');
  assert.equal(rig.panel('a.kb').destroyed, true);
  rig.vr.stuck.clear();
  rig.tap('quick1');
  assert.deepEqual([rig.panel('a.kb').visible, rig.panels.panels[0]?.error], [true, undefined]);
  rig.session.stop();
});

test('页面出错：关掉它、算这块面板出错一次，歇 1 秒重新开；10 秒里 3 次就停用，状态带原因；总开关键、快捷位键重试', t => {
  const rig = shown(t, { list: [KB] });
  const first = rig.page();
  first.report('failed', 'page process gone: crashed 1');
  assert.deepEqual([first.closed, rig.logs.at(-1)], [true, 'warn: panel a.kb: page process gone: crashed 1']);
  first.report('ready');                                    // 关掉的页面之后报什么都不管
  first.report('failed', 'again');
  assert.equal(rig.logs.filter(l => l.startsWith('warn: panel')).length, 1);
  rig.frame(SECOND - 1);
  assert.equal(rig.opened.length, 1);                       // 歇着的 1 秒里不重开
  rig.frame();
  assert.equal(rig.opened.length, 2);
  assert.deepEqual([rig.page().paints, rig.panel().visible, rig.views()], [[false, true], true, ['a.kb true true']]);
  // 新的页面的帧照常贴上
  rig.page().send(1);
  rig.frame(2);
  assert.ok(rig.panel().texture);
  rig.page().report('failed');                              // 没给原因
  rig.frame(SECOND);
  rig.page().report('failed', 'did-fail-load -6');
  assert.equal(rig.panel().destroyed, true);
  assert.equal(rig.logs.at(-2), 'warn: panel a.kb: panel page failed');
  rig.frame(5);                                             // 状态在下一帧末尾发布
  assert.deepEqual([rig.views(), rig.panels.panels[0]?.error], [['a.kb false false'], 'did-fail-load -6']);
  assert.equal(rig.opened.length, 3);
  rig.frame(2 * SECOND);
  assert.equal(rig.opened.length, 3);                       // 停用了的不自己重开(写了 keep 也一样)
  assert.deepEqual(storedOpen(rig), { 'a.kb': true });      // 存盘里还是打开着
  rig.tap('toggle');                                        // 总开关键：没有面板可收起，出错的重试
  assert.deepEqual([rig.opened.length, rig.panel().visible, rig.panels.panels[0]?.error], [4, true, undefined]);
  rig.page().report('failed', 'x');
  rig.frame(SECOND);
  rig.page().report('failed', 'x');
  rig.frame(SECOND);
  rig.page().report('failed', 'x');
  rig.frame();
  assert.equal(rig.panels.panels[0]?.error, 'x');
  const count = rig.opened.length;
  rig.tap('quick1');                                        // 快捷位键：重试
  assert.deepEqual([rig.opened.length, rig.panel().visible, rig.panels.panels[0]?.error], [count + 1, true, undefined]);
  rig.session.stop();
});

test('出错停用不进存盘：按存盘的布局重新开始，按总开关键面板照常显示；到面前也重试', t => {
  const rig = shown(t, { list: [KB] });
  for (let i = 0; i < 3; i++) {
    rig.page().report('failed', 'did-fail-load -6');
    rig.frame(SECOND);
  }
  rig.wait(600);
  assert.deepEqual([rig.views(), rig.panels.panels[0]?.error, storedOpen(rig)], [['a.kb false false'], 'did-fail-load -6', { 'a.kb': true }]);
  void rig.remote.summon(WHO, 'a.kb');
  rig.frame(2);
  assert.deepEqual([rig.views(), rig.panels.panels[0]?.error], [['a.kb true true'], undefined]);
  rig.session.stop();
});

test('按存盘的布局重新开始：出过错的面板存的是打开着，按总开关键照常显示', t => {
  const rig = connected(t, { list: [KB], layout: readLayout({ locked: false, panels: { 'a.kb': { open: true, pinned: false, locked: false, meters: null, pose: null } } }) });
  rig.tap('toggle');
  assert.deepEqual([rig.views(), rig.panel().visible], [['a.kb true true'], true]);
  rig.session.stop();
});

test('页面一开就出错(核心开不出这一页)：每块面板隔 1 秒试一次，3 次后停用，存盘里不记成关着', t => {
  const rig = connected(t);
  let seen = 0;
  // 每次开出来的页面都立刻报出错
  const refuse = (): void => {
    for (; seen < rig.pages.length; seen++) rig.pages[seen]?.report('failed', 'cannot open the page');
  };
  for (let i = 0; i < 12; i++) {
    if (i === 1) rig.press('toggle', 'right', true);
    if (i === 2) rig.press('toggle', 'right', false);
    rig.frame();
    refuse();
  }
  assert.deepEqual(rig.opened, ['a.kb', 'a.clock']);        // 12 帧里各只开了一次
  for (let i = 0; i < 2 * SECOND + 10; i++) {
    rig.frame();
    refuse();
  }
  assert.deepEqual(rig.opened.length, 6);
  assert.deepEqual(rig.panels.panels.map(p => `${p.id} ${p.open} ${p.error}`), ['a.kb false cannot open the page', 'a.clock false cannot open the page']);
  rig.wait(600);
  assert.deepEqual(storedOpen(rig), { 'a.kb': true, 'a.clock': true });   // 存的只有摆过的位置
  rig.session.stop();
});

test('显卡设备丢了：不算哪块面板出错，断开重连；重连后面板照常显示，布局里不记成关着', t => {
  const rig = shown(t);
  rig.page('a.kb').send(1);
  rig.page('a.clock').send(1);
  rig.frame(6);
  rig.gpu.lost = true;
  rig.page('a.kb').send(2);
  rig.page('a.clock').send(2);
  rig.frame();
  assert.equal(rig.session.connected, false);
  assert.deepEqual(rig.logs.slice(-2), ['error: vr: 显卡设备丢了', 'steamvr disconnected']);
  assert.equal(rig.logs.some(l => l.startsWith('warn: panel')), false);
  assert.deepEqual([rig.views(), rig.panels.panels.map(p => p.error)], [['a.kb true false', 'a.clock true false'], [undefined, undefined]]);
  rig.wait(PROBE);
  assert.deepEqual([rig.session.connected, rig.gpus.length], [true, 2]);
  rig.tap('toggle');
  rig.frame(2);
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible, rig.opened], [true, true, ['a.kb', 'a.clock']]);
  rig.page('a.kb').send(3);
  rig.frame(3);
  assert.ok(rig.panel('a.kb').texture);
  rig.wait(600);
  assert.deepEqual(storedOpen(rig), { 'a.kb': true, 'a.clock': true });
  // 查复制进度时发现设备丢了也一样
  rig.page('a.kb').send(4);
  rig.gpu.busy = true;
  rig.frame();
  rig.gpu.lost = true;
  rig.frame();
  assert.equal(rig.session.connected, false);
  rig.session.stop();
});

test('重新连上时出错停用的面板重试', t => {
  const rig = shown(t, { list: [KB] });
  for (let i = 0; i < 3; i++) {
    rig.page().report('failed', 'did-fail-load -6');
    rig.frame(SECOND);
  }
  assert.equal(rig.panels.panels[0]?.error, 'did-fail-load -6');
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  rig.wait(PROBE);
  assert.deepEqual([rig.session.connected, rig.panels.panels[0]?.error, rig.views()], [true, undefined, ['a.kb true true']]);
  rig.frame(2);
  assert.equal(rig.panel().visible, true);
  rig.session.stop();
});

test('页面没了(被别的显示方接走)：这块面板算关着，悬浮窗口隐藏后销毁，不记错；不自己重开', t => {
  const rig = shown(t, { list: [KB] });
  const first = rig.page();
  first.report('gone', 'taken over');
  assert.deepEqual([first.closed, rig.panel().destroyed], [true, false]);
  rig.frame(3);
  assert.deepEqual([rig.panel().destroyed, rig.views(), rig.panels.panels[0]?.error], [true, ['a.kb false false'], undefined]);
  assert.deepEqual(rig.logs, ['steamvr connected']);
  rig.frame(SECOND);
  assert.equal(rig.opened.length, 1);
  rig.tap('quick1');
  assert.deepEqual([rig.opened.length, rig.panel().visible], [2, true]);
  rig.session.stop();
});

// ---------- 上限 ----------

test('同时显示的上限：打开着的多过上限时只显示目录里靠前的', t => {
  const list = [KB, CLOCK, info('a.p3'), info('a.p4'), info('a.p5')];
  const rig = connected(t, { list, settings: settingsWith({}, { limit: 4 }) });
  rig.tap('toggle');
  rig.frame(6);
  assert.deepEqual(rig.views(), ['a.kb true true', 'a.clock true true', 'a.p3 true true', 'a.p4 true true', 'a.p5 true false']);
  assert.deepEqual([rig.opened, rig.overlay('a.p5')], [['a.kb', 'a.clock', 'a.p3', 'a.p4'], undefined]);
  assert.deepEqual([rig.panels.limit, rig.status.at(-1)], [4, 'ok 4']);
  rig.session.stop();
});

// ---------- 附着的面板 ----------

// 布局里一块面板的记录：打开着、常显(连上就显示，不用按总开关键)
const record = (patch: Partial<PanelRecord>): PanelRecord => ({ open: true, pinned: true, locked: false, meters: null, anchor: 'world', glance: false, pose: null, ...patch });
const layoutOf = (panels: Record<string, PanelRecord>): Layout => readLayout({ locked: false, panels });
// 一帧里对 Vr 和 Gpu 的调用，不算每帧都有的那几样
const EVERY_FRAME = ['events', 'poses', 'roleIndex', 'activate', 'button'];
const framed = (rig: Rig): string[] => {
  const from = rig.calls.length;
  rig.frame();
  return rig.names(from).filter(name => !EVERY_FRAME.includes(name));
};
const SIN40 = Math.sin(40 * Math.PI / 180);
const COS40 = Math.cos(40 * Math.PI / 180);
// 附着的面板还没摆过时相对设备的变换，照规则手算的。头显：前方 0.45 米、下方 0.25 米，正面朝向眼睛
const HEAD_REACH = Math.hypot(0.25, 0.45);
const ON_HEAD: Mat34 = [1, 0, 0, 0, 0, 0.45 / HEAD_REACH, 0.25 / HEAD_REACH, -0.25, 0, -0.25 / HEAD_REACH, 0.45 / HEAD_REACH, -0.45];
// 手柄：朝手背 0.05 米、朝手腕 0.12 米，正面从朝手背转向手柄上方 40°
const ON_LEFT: Mat34 = [0, -SIN40, -COS40, -0.05, 0, -COS40, SIN40, 0, -1, 0, 0, 0.12];
const ON_RIGHT: Mat34 = [0, SIN40, COS40, 0.05, 0, -COS40, SIN40, 0, 1, 0, 0, 0.12];
// 一块面板最近发布的状态
const view = (rig: Rig, id: string) => rig.panels.panels.find(p => p.id === id) ?? assert.fail(`状态里没有 ${id}`);

test('附着在头显上的面板(交给 SteamVR)：第一次显示按默认的相对位置放(不记进布局)，这一帧的调用次序；头动了不用说，求交照头这一刻的姿态算', t => {
  const rig = connected(t, { list: [HUD], layout: layoutOf({ 'a.hud': record({ anchor: 'head' }) }) });
  // 建悬浮窗口、设宽度、交给 SteamVR 跟着 0 号设备、显示
  assert.deepEqual(framed(rig), ['tip', 'tip', 'overlay', 'createQuery', 'setWidth', 'placeOn', 'show']);
  const o = rig.panel('a.hud');
  assert.deepEqual(rig.args('placeOn').map(a => [a[0], a[1]]), [[o.handle, 0]]);
  near(o.pose, ON_HEAD);
  assert.deepEqual([o.visible, o.device, rig.views(), view(rig, 'a.hud').anchor, rig.status.at(-1)], [true, 0, ['a.hud true true'], 'head', 'ok 1']);
  rig.wait(1000);
  assert.deepEqual([rig.control.layout.panels['a.hud']?.pose, rig.stored], [null, []]);   // 默认位置不进布局、不存盘

  // 右手指着它的正中：落点照头的姿态接上相对变换算
  rig.aim('right', 'a.hud', 200, 100);
  rig.frame();
  assert.equal(rig.page('a.hud').events.at(-1), 'move 200,100');
  near(position(rig.dot('right').pose), [0, 1.35 + 0.002 * 0.25 / HEAD_REACH, -0.45 + 0.002 * 0.45 / HEAD_REACH], 1e-3);
  // 头挪开：SteamVR 带着面板走，这里不用说；手没动，射线落空
  rig.setHead(at(1, 1.7, 0.5));
  rig.frame();
  assert.equal(rig.page('a.hud').events.at(-1), 'leave');
  rig.aim('right', 'a.hud', 100, 50);
  rig.frame();
  assert.equal(rig.page('a.hud').events.at(-1), 'move 100,50');
  near(position(rig.dot('right').pose), [1 - 0.075, 1.45 + 0.0375 * 0.45 / HEAD_REACH, 0.05 - 0.0375 * 0.25 / HEAD_REACH], 2e-3);
  assert.deepEqual([rig.count('placeOn', o), rig.count('place', o), rig.count('show', o)], [1, 0, 1]);
  rig.session.stop();
});

test('附着的面板自己算位置(attach 选 js)：每帧把设备姿态接上相对变换设成绝对位置，设备没动时不说；不调相对设备的调用', t => {
  const rig = connected(t, { native: false, list: [HUD], layout: layoutOf({ 'a.hud': record({ anchor: 'head', pose: at(0, -0.2, -0.6) }) }) });
  assert.deepEqual(framed(rig), ['tip', 'tip', 'overlay', 'createQuery', 'setWidth', 'place', 'show']);
  const o = rig.panel('a.hud');
  rig.frame(3);
  rig.setHead(at(1, 1.6, 0));
  rig.frame(2);
  rig.setHead(turned(1, 1.6, 0));
  rig.frame();
  const places = rig.args('place').filter(a => a[0] === o.handle).map(a => a[1] as number[]);
  assert.equal(places.length, 3);
  near(places[0] ?? [], at(0, 1.4, -0.6));
  near(places[1] ?? [], at(1, 1.4, -0.6));
  near(places[2] ?? [], turned(1, 1.4, 0.6));        // 头转了 180°：面板到了另一侧
  assert.deepEqual([rig.args('placeOn').length, o.device, o.visible], [0, null, true]);
  assert.deepEqual(rig.control.layout.panels['a.hud']?.pose, at(0, -0.2, -0.6));   // 布局里记的还是相对变换
  rig.session.stop();
});

test('附着在手上的面板，手柄不在(没开、姿态无效)：悬浮窗口建好但不显示，页面照常画，状态里 visible 为假；手柄回来就显示，相对变换不用再说；设备序号换了才再说', t => {
  const rig = new Rig(t, { list: [WRIST], layout: layoutOf({ 'a.wrist': record({ anchor: 'left', locked: true }) }) });
  rig.hand('left', null);
  rig.session.start();
  assert.deepEqual(framed(rig), ['tip', 'tip', 'overlay', 'createQuery', 'setWidth']);
  const o = rig.panel('a.wrist');
  const page = rig.page('a.wrist');
  assert.deepEqual([o.visible, rig.views(), rig.status.at(-1), page.paints], [false, ['a.wrist true false'], 'ok 0', [false, true]]);
  assert.equal(rig.control.layout.panels['a.wrist']?.pose, null);
  rig.frame(5);
  assert.deepEqual([rig.count('placeOn', o), rig.count('show', o), rig.published.length], [0, 0, 3]);

  const hand = at(-0.2, 1.2, -0.3);
  rig.hand('left', hand);
  assert.deepEqual(framed(rig), ['placeOn', 'show']);
  assert.deepEqual(rig.args('placeOn').map(a => [a[0], a[1]]), [[o.handle, DEVICE.left]]);
  near(o.pose, ON_LEFT);
  assert.deepEqual([o.visible, rig.views(), rig.status.at(-1)], [true, ['a.wrist true true'], 'ok 1']);
  // 姿态无效(矩阵还是旧的)：隐藏；回来：显示，不用再说跟谁
  rig.vr.losePose(DEVICE.left);
  assert.deepEqual(framed(rig), ['hide']);
  assert.deepEqual([rig.views(), rig.status.at(-1)], [['a.wrist true false'], 'ok 0']);
  rig.hand('left', hand);
  assert.deepEqual(framed(rig), ['show']);
  // 这只手没有设备了
  rig.vr.setRole(ROLE_LEFT, null);
  assert.deepEqual(framed(rig), ['hide']);
  // 左手换成 5 号设备：重新取指尖，告诉 SteamVR 跟 5 号
  rig.vr.setRole(ROLE_LEFT, 5);
  rig.vr.setPose(5, hand);
  assert.deepEqual(framed(rig), ['tip', 'placeOn', 'show']);
  assert.deepEqual([rig.args('placeOn').at(-1)?.[1], o.device, rig.views()], [5, 5, ['a.wrist true true']]);
  assert.deepEqual([page.paints, rig.logs], [[false, true], ['steamvr connected']]);
  rig.session.stop();
});

test('头显的姿态无效时附着在头显上的面板不显示，回来就显示；留在空间里的面板不受影响', t => {
  const rig = connected(t, { list: [HUD, CLOCK], layout: layoutOf({ 'a.hud': record({ anchor: 'head' }), 'a.clock': record({}) }) });
  rig.frame(2);
  assert.deepEqual(rig.views(), ['a.hud true true', 'a.clock true true']);
  rig.vr.losePose(0);
  rig.frame();
  assert.deepEqual([rig.panel('a.hud').visible, rig.panel('a.clock').visible, rig.views(), rig.status.at(-1)], [false, true, ['a.hud true false', 'a.clock true true'], 'ok 1']);
  rig.setHead(HEAD);
  rig.frame();
  assert.deepEqual([rig.panel('a.hud').visible, rig.views(), rig.count('placeOn', rig.panel('a.hud'))], [true, ['a.hud true true', 'a.clock true true'], 1]);
  rig.session.stop();
});

test('抬手才显示：面板正面和它到眼睛的方向夹角小于 40° 才显示，大于 50° 才隐藏，中间保持原样不抖；没显示时页面照常画、新画面照常进纹理并交给 SteamVR', t => {
  // 面板在手柄上方 0.1 米、和手柄同朝向；手柄在眼睛前方 0.4 米、低 0.1 米，往左挪时面板的法线(+Z)和它到眼睛的方向夹角是 deg
  const rig = new Rig(t, { list: [WRIST], layout: layoutOf({ 'a.wrist': record({ anchor: 'left', glance: true, locked: true, pose: at(0, 0.1, 0) }) }) });
  const hold = (deg: number): void => rig.hand('left', at(-0.4 * Math.tan(deg * Math.PI / 180), 1.5, -0.4));
  hold(55);
  rig.session.start();
  rig.frame(2);
  const o = rig.panel('a.wrist');
  const page = rig.page('a.wrist');
  const seen = (): unknown[] => [o.visible, view(rig, 'a.wrist').visible, rig.status.at(-1)];
  assert.deepEqual(seen(), [false, false, 'ok 0']);
  assert.deepEqual([view(rig, 'a.wrist').open, view(rig, 'a.wrist').glance, page.paints], [true, true, [false, true]]);
  // 手垂着时页面交来的帧照常复制，画面变了就交给 SteamVR
  page.send(1);
  rig.frame(3);
  const [texture] = textures(rig.gpu);
  assert.ok(texture);
  assert.deepEqual([texture.frames, o.texture === texture, rig.count('setTexture', o)], [[1001n], true, 1]);
  rig.frame(5);
  assert.deepEqual([texture.frames, rig.count('setTexture', o)], [[1001n, 1001n], 2]);   // 同一帧隔 30 毫秒复制的第二次
  page.send(2);
  rig.frame(3);
  assert.deepEqual([texture.frames.at(-1), rig.count('setTexture', o), o.visible], [1002n, 3, false]);   // 新的一帧隐藏着就交给了 SteamVR

  hold(45);
  rig.frame();
  assert.deepEqual(seen(), [false, false, 'ok 0']);
  hold(39);
  // 抬手：这一帧的调用是 placeOn、show；纹理里已经是最新的那一帧
  assert.deepEqual(framed(rig).slice(0, 2), ['placeOn', 'show']);
  assert.deepEqual([...seen(), o.device, texture.frames.at(-1)], [true, true, 'ok 1', DEVICE.left, 1002n]);
  for (const deg of [45, 49, 41, 49.9]) {
    hold(deg);
    rig.frame(2);
    assert.deepEqual(seen(), [true, true, 'ok 1'], `${deg}°`);
  }
  hold(51);
  rig.frame();
  assert.deepEqual(seen(), [false, false, 'ok 0']);
  for (const deg of [45, 41, 40.1, 49]) {
    hold(deg);
    rig.frame(2);
    assert.deepEqual(seen(), [false, false, 'ok 0'], `${deg}°`);
  }
  hold(30);
  rig.frame();
  assert.deepEqual(seen(), [true, true, 'ok 1']);
  assert.deepEqual([rig.count('show', o), rig.count('hide', o), rig.count('placeOn', o), page.paints, page.released], [2, 1, 1, [false, true], [1, 2]]);
  assert.ok(rig.count('setTexture', o) > 10);     // 显示着时每个显示帧都交
  rig.session.stop();
});

test('抬手才显示只管附着在手上的面板：手上的面板关了它就一直显示，头显上的面板开着它也一直显示；改 glance 当帧起作用', t => {
  const rig = connected(t, {
    list: [WRIST, HUD],
    layout: layoutOf({ 'a.wrist': record({ anchor: 'left', pose: at(0, 0.1, 0) }), 'a.hud': record({ anchor: 'head', glance: true, pose: at(0, -0.2, -0.6) }) }),
  });
  rig.hand('left', turned(-0.2, 1.2, -0.5));       // 左手在身前朝后指：面板背对着眼睛
  rig.frame(2);
  assert.deepEqual(rig.views(), ['a.wrist true true', 'a.hud true true']);
  void rig.remote.set(WHO, 'a.wrist', { glance: true });
  rig.frame();
  assert.deepEqual([rig.panel('a.wrist').visible, rig.views()], [false, ['a.wrist true false', 'a.hud true true']]);
  void rig.remote.set(WHO, 'a.wrist', { glance: false });
  rig.frame();
  assert.deepEqual([rig.panel('a.wrist').visible, rig.views()], [true, ['a.wrist true true', 'a.hud true true']]);
  rig.session.stop();
});

test('换附着对象：留在空间里 → 头显 → 左手 → 右手 → 留在空间里，每次只多一个放位置的调用，悬浮窗口一直显示着；位置回到新对象的默认位置', t => {
  const rig = shown(t, { list: [CLOCK] });
  const o = rig.panel('a.clock');
  const relative = (): readonly number[] | null | undefined => rig.control.layout.panels['a.clock']?.pose;
  void rig.remote.set(WHO, 'a.clock', { anchor: 'head' });
  assert.deepEqual(framed(rig), ['placeOn']);
  assert.deepEqual([o.visible, o.device, view(rig, 'a.clock').anchor], [true, 0, 'head']);
  near(o.pose, ON_HEAD);
  assert.equal(relative(), null);                  // 附着对象的默认位置不记进布局
  void rig.remote.set(WHO, 'a.clock', { anchor: 'left', glance: false });
  assert.deepEqual(framed(rig), ['placeOn']);
  assert.deepEqual([o.visible, o.device, view(rig, 'a.clock').locked], [true, DEVICE.left, true]);
  near(o.pose, ON_LEFT);
  assert.equal(relative(), null);
  void rig.remote.set(WHO, 'a.clock', { anchor: 'right', glance: false });
  assert.deepEqual(framed(rig), ['placeOn']);
  assert.deepEqual([o.visible, o.device], [true, DEVICE.right]);
  near(o.pose, ON_RIGHT);
  void rig.remote.set(WHO, 'a.clock', { anchor: 'world' });
  assert.deepEqual(framed(rig), ['place']);
  assert.deepEqual([o.visible, o.device, view(rig, 'a.clock').anchor], [true, null, 'world']);
  near(o.pose, arrange(HEAD, 'front', []));
  near(relative() ?? [], arrange(HEAD, 'front', []));
  assert.deepEqual([rig.count('show', o), rig.count('hide', o), rig.count('placeOn', o)], [1, 0, 3]);
  // 变成手上的面板时默认抬手才显示：手垂着(面板的正面离眼睛的方向 75° 上下)，当帧隐藏，不用告诉 SteamVR 跟谁
  rig.hand('left', at(-0.2, 1, 0.3));
  void rig.remote.set(WHO, 'a.clock', { anchor: 'left' });
  assert.deepEqual(framed(rig), ['hide']);
  assert.deepEqual([view(rig, 'a.clock').glance, view(rig, 'a.clock').visible, rig.count('placeOn', o)], [true, false, 3]);
  // 重置：回到清单的留在空间里，重新放到面前——和 SteamVR 手里那份绝对位置一样(挂到左手后没显示过、没说过跟谁)，不用再说
  void rig.remote.reset(WHO, 'a.clock');
  assert.deepEqual(framed(rig), ['show']);
  near(o.pose, arrange(HEAD, 'front', []));
  assert.deepEqual([o.device, view(rig, 'a.clock').anchor, view(rig, 'a.clock').visible], [null, 'world', true]);
  rig.session.stop();
});

test('宽过 0.3 米的面板挂到手上：宽度缩到 0.3 米，和跟着手的调用在同一帧', t => {
  const rig = shown(t, { list: [KB] });
  void rig.remote.set(WHO, 'a.kb', { anchor: 'right', glance: false });
  assert.deepEqual(framed(rig), ['setWidth', 'placeOn']);
  assert.deepEqual([rig.panel('a.kb').meters, rig.panel('a.kb').device, view(rig, 'a.kb').meters], [0.4, DEVICE.right, 0.4]);   // 键盘的最小宽度是 0.4 米
  rig.session.stop();
});

test('到面前、显示时的摆放只管留在空间里的面板：附着的面板相对变换不动，也不占留在空间里的面板要避开的位置', t => {
  const rig = connected(t, {
    list: [HUD, CLOCK], settings: settingsWith({ recenter: 'always' }),
    layout: layoutOf({ 'a.hud': record({ anchor: 'head', pinned: false, pose: at(0, 1.55, -0.65) }), 'a.clock': record({ pinned: false }) }),
  });
  rig.tap('toggle');
  rig.frame(2);
  const hud = rig.panel('a.hud');
  // 头显上的面板相对头显的变换，数值上正好是时钟在面板空间里出现的位置：它不是面板空间里的位置，时钟照样放在那，不用错开
  near(rig.panel('a.clock').pose, arrange(HEAD, 'front', []));
  near(position(rig.panel('a.clock').pose), [0, 1.55, -0.65]);
  void rig.remote.summon(WHO);
  void rig.remote.summon(WHO, 'a.hud');
  rig.frame(2);
  rig.tap('toggle');
  rig.setHead(at(2, 1.6, 2));
  rig.tap('toggle');                               // 每次显示都重排：时钟跟到新的面前，头显上的面板不重新放
  rig.frame(2);
  near(position(rig.panel('a.clock').pose), [2, 1.55, 1.35]);
  assert.deepEqual([hud.pose, rig.control.layout.panels['a.hud']?.pose, rig.count('placeOn', hud), rig.count('place', hud)], [at(0, 1.55, -0.65), at(0, 1.55, -0.65), 1, 0]);
  assert.deepEqual(rig.views(), ['a.hud true true', 'a.clock true true']);
  rig.session.stop();
});

test('没在显示的附着的面板被收起：页面这时才停画，从这一刻起满 60 秒才关；恢复后手没抬照样不显示', t => {
  const rig = connected(t, { list: [WRIST], layout: layoutOf({ 'a.wrist': record({ anchor: 'left', glance: true, locked: true, pinned: false, pose: at(0, 0.1, 0) }) }) });
  rig.tap('toggle');
  rig.frame(2);
  const page = rig.page('a.wrist');
  rig.wait(120_000);                               // 手一直垂着：显示着的那一组里，页面一直画着、不关
  assert.deepEqual([rig.panel('a.wrist').visible, page.paints, page.closed, rig.views()], [false, [false, true], false, ['a.wrist true false']]);
  rig.tap('toggle');
  assert.deepEqual([page.paints, page.closed], [[false, true, false], false]);
  rig.wait(59_000);
  assert.equal(page.closed, false);
  rig.wait(1500);
  assert.deepEqual([page.closed, rig.panel('a.wrist').destroyed], [true, true]);
  rig.tap('toggle');
  rig.frame(2);
  assert.deepEqual([rig.opened, rig.panel('a.wrist').visible, rig.page('a.wrist').painting, rig.views()], [['a.wrist', 'a.wrist'], false, true, ['a.wrist true false']]);
  rig.session.stop();
});

test('重连：附着的面板在新的连接里重新建、重新告诉 SteamVR 跟谁；抬手才显示的结果不留到下一次连接；断开时状态里没有藏着的面板', t => {
  const rig = new Rig(t, { list: [WRIST], layout: layoutOf({ 'a.wrist': record({ anchor: 'left', glance: true, locked: true, pose: at(0, 0.1, 0) }) }) });
  const hold = (deg: number): void => rig.hand('left', at(-0.4 * Math.tan(deg * Math.PI / 180), 1.5, -0.4));
  hold(30);
  rig.session.start();
  rig.frame(2);
  hold(45);                                        // 回差里：照上一帧的结果，还显示着
  rig.frame();
  assert.deepEqual([rig.panel('a.wrist').visible, rig.views()], [true, ['a.wrist true true']]);
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  assert.deepEqual([rig.session.connected, rig.page('a.wrist').painting, rig.views()], [false, false, ['a.wrist true false']]);
  rig.wait(PROBE);
  rig.frame(2);                                    // 常显的面板连上就重建；手还在 45°：没有上一次的结果可照，不显示
  const o = rig.panel('a.wrist');
  assert.deepEqual([rig.vrs.length, o.destroyed, o.visible, rig.count('placeOn', o), rig.views(), rig.page('a.wrist').painting], [2, false, false, 0, ['a.wrist true false'], true]);
  hold(30);
  rig.frame();
  assert.deepEqual([o.visible, o.device, rig.count('placeOn', o), rig.views(), rig.opened], [true, DEVICE.left, 1, ['a.wrist true true'], ['a.wrist']]);
  rig.session.stop();
});

test('附着的面板隐藏没成功：下一帧接着试，这期间不算显示着', t => {
  const rig = connected(t, { list: [HUD], layout: layoutOf({ 'a.hud': record({ anchor: 'head' }) }) });
  rig.frame();
  const o = rig.panel('a.hud');
  rig.vr.stuck.add(overlayKey('a.hud'));
  rig.vr.losePose(0);
  rig.frame(3);
  assert.deepEqual([o.visible, rig.count('hide', o), rig.views()], [true, 3, ['a.hud true false']]);
  rig.vr.stuck.delete(overlayKey('a.hud'));
  rig.frame(2);
  assert.deepEqual([o.visible, rig.count('hide', o)], [false, 4]);
  rig.session.stop();
});

test('布局里只换了附着对象、位置还是同一份：悬浮窗口照新的附着对象重新放', t => {
  const rig = connected(t, { list: [HUD], layout: layoutOf({ 'a.hud': record({ anchor: 'head', pose: at(0, -0.2, -0.6) }) }) });
  rig.frame();
  const o = rig.panel('a.hud');
  assert.deepEqual([o.device, o.pose], [0, at(0, -0.2, -0.6)]);
  // 记录里的位置原样留着，只把附着对象换成留在空间里：那份矩阵当成面板空间里的姿态
  rig.control.change(layout => {
    const kept = layout.panels['a.hud'] ?? assert.fail('没有记录');
    return { ...layout, panels: { ...layout.panels, 'a.hud': { ...kept, anchor: 'world' } } };
  });
  assert.deepEqual(framed(rig), ['place']);
  assert.deepEqual([o.device, o.pose, o.visible], [null, at(0, -0.2, -0.6), true]);
  rig.control.change(layout => {
    const kept = layout.panels['a.hud'] ?? assert.fail('没有记录');
    return { ...layout, panels: { ...layout.panels, 'a.hud': { ...kept, anchor: 'right' } } };
  });
  assert.deepEqual(framed(rig), ['placeOn']);
  assert.deepEqual([o.device, o.pose, o.visible], [DEVICE.right, at(0, -0.2, -0.6), true]);
  rig.session.stop();
});

test('没摆过的附着的面板一直照默认位置放，布局里不记；抓着挪过、松手时才记下相对变换；重置后又照默认位置', t => {
  const rig = connected(t, { list: [HUD], settings: settingsWith({ grabDelay: 0, snap: false }), layout: layoutOf({ 'a.hud': record({ anchor: 'head' }) }) });
  rig.frame(2);
  const o = rig.panel('a.hud');
  const recorded = (): readonly number[] | null | undefined => rig.control.layout.panels['a.hud']?.pose;
  near(o.pose, ON_HEAD);
  const hand = rig.aim('right', 'a.hud', 200, 100);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame();
  rig.hand('right', shifted(hand, 0.1, 0, 0));
  rig.frame(200);
  assert.deepEqual([recorded(), rig.stored], [null, []]);
  rig.press('grab', 'right', false);
  rig.frame();
  near(recorded() ?? [], shifted(ON_HEAD, 0.1, 0, 0), 1e-6);   // 头显没有旋转：相对变换只多出往右的 0.1 米
  near(o.pose, shifted(ON_HEAD, 0.1, 0, 0), 1e-6);
  rig.away('right');
  void rig.remote.reset(WHO, 'a.hud');
  rig.frame();
  near(o.pose, ON_HEAD);
  assert.equal(recorded(), null);
  rig.session.stop();
});

test('抬手才显示的结果在设备不在、头显姿态无效的那几帧留着：回差里(45°)显示着的面板，手柄的姿态无效一帧后回来照样显示，没显示着的照样不显示；头显的姿态无效时照最近一次的结果，回来后按角度算', t => {
  const rig = new Rig(t, { list: [WRIST], layout: layoutOf({ 'a.wrist': record({ anchor: 'left', glance: true, locked: true, pose: at(0, 0.1, 0) }) }) });
  const hold = (deg: number): void => rig.hand('left', at(-0.4 * Math.tan(deg * Math.PI / 180), 1.5, -0.4));
  const seen = (): unknown[] => [rig.panel('a.wrist').visible, view(rig, 'a.wrist').visible];
  hold(30);
  rig.session.start();
  rig.frame(2);
  hold(45);
  rig.frame();
  assert.deepEqual(seen(), [true, true]);
  rig.vr.losePose(DEVICE.left);
  rig.frame();
  assert.deepEqual(seen(), [false, false]);
  hold(45);                                        // 手没动，姿态回来了
  rig.frame();
  assert.deepEqual(seen(), [true, true]);
  hold(51);
  rig.frame();
  hold(45);
  rig.frame();
  rig.vr.losePose(DEVICE.left);
  rig.frame();
  hold(45);
  rig.frame();
  assert.deepEqual(seen(), [false, false]);

  // 头显的姿态无效：没有眼睛的位置可算，显示着的接着显示、没显示的接着不显示
  hold(30);
  rig.frame();
  assert.deepEqual(seen(), [true, true]);
  rig.vr.losePose(0);
  hold(60);
  rig.frame(2);
  assert.deepEqual(seen(), [true, true]);
  rig.setHead(HEAD);
  rig.frame();
  assert.deepEqual(seen(), [false, false]);
  rig.vr.losePose(0);
  hold(10);
  rig.frame(2);
  assert.deepEqual(seen(), [false, false]);
  rig.setHead(HEAD);
  rig.frame();
  assert.deepEqual(seen(), [true, true]);
  rig.session.stop();
});

test('连上时头显就没有姿态：抬手才显示的面板不显示(不拿无效的头显矩阵当眼睛的位置)，头显有了姿态后按角度算', t => {
  const rig = new Rig(t, { list: [WRIST], layout: layoutOf({ 'a.wrist': record({ anchor: 'left', glance: true, locked: true, pose: at(0, 0.1, 0) }) }) });
  rig.prepare = vr => vr.setPose(0, null);
  // 面板在 (0, 0.4, -1)、正面朝 +Z：离面板空间的原点的方向 22° 上下
  rig.hand('left', at(0, 0.3, -1));
  rig.session.start();
  rig.frame(3);
  assert.deepEqual([rig.panel('a.wrist').visible, rig.views(), rig.status.at(-1)], [false, ['a.wrist true false'], 'ok 0']);
  rig.setHead(at(0, 0.5, 0));                      // 眼睛在面板前方 1 米、高 0.1 米：6° 上下
  rig.frame();
  assert.deepEqual([rig.panel('a.wrist').visible, rig.views(), rig.status.at(-1)], [true, ['a.wrist true true'], 'ok 1']);
  rig.session.stop();
});

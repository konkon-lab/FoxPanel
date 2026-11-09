import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { Caller } from '@konkon-lab/foxpanel-sdk';
import { readLayout, recordOf, type Layout, type PanelRecord } from '../components/_shared/panels/layout.ts';
import { axis, dotPose, position } from '../components/steamvr/src/geometry.ts';
import { EVENT_QUIT, ROLE_LEFT } from '../components/steamvr/src/openvr.ts';
import { squareHit } from '../components/steamvr/src/sim.ts';
import {
  ACTION, APP, at, BLOCK, CLOCK, connected, DEVICE, DOT, HUD, K, KB, LEFT, near, PROBE, Rig, settingsWith, shifted, shown, SOURCE, textures, turned, WRIST,
  type RigOptions, type Side,
} from './vr-helpers.ts';

const WHO: Caller = { component: 'a.other', where: 'process' };
// 抓取延迟选「无」、松手不吸正：握把一按就抓起来，松手的位置原样留着
const DIRECT = settingsWith({ grabDelay: 0, snap: false });

// 连上并显示出键盘一块面板
const keyboard = (t: TestContext, settings = DIRECT): Rig => shown(t, { list: [KB], settings });

// ---------- 连接 ----------

test('连接：建设备、登记应用、取句柄、两个圆点的次序和参数；面板的悬浮窗口和页面这时都不建', t => {
  const rig = connected(t);
  assert.deepEqual(rig.names(0), [
    'outputLuid', 'register', 'setManifest', 'handle', 'handle', 'handle', 'handle', 'handle', 'handle',
    'overlay', 'setWidth', 'setSortOrder', 'setImage', 'handle',
    'overlay', 'setWidth', 'setSortOrder', 'setImage', 'handle',
    'refreshRate',
  ]);
  assert.equal(rig.gpu.luid, 0x1234n);
  assert.deepEqual(rig.args('register'), [['res/manifest.vrmanifest', APP]]);
  assert.deepEqual(rig.args('setManifest'), [['res/actions.json']]);
  assert.deepEqual(rig.args('handle'), [
    ['set', '/actions/main'], ['action', ACTION.toggle], ['action', ACTION.click], ['action', ACTION.grab], ['action', ACTION.quick1], ['action', ACTION.quick2],
    ['source', SOURCE.left], ['source', SOURCE.right],
  ]);
  assert.deepEqual(rig.args('overlay'), [[DOT.left, 'FoxPanel pointer left'], [DOT.right, 'FoxPanel pointer right']]);
  for (const side of ['left', 'right'] as const) {
    const dot = rig.dot(side);
    assert.deepEqual([dot.meters, dot.sort, dot.image, dot.visible], [0.006, 10, 'res/pointer.png', false]);
  }
  assert.deepEqual([rig.pages.length, rig.logs, rig.changed, rig.session.connected], [0, ['steamvr connected'], 1, true]);
  assert.deepEqual([rig.panels.connected, rig.status], [true, ['idle', 'ok 0']]);
  rig.session.stop();
});

test('连接：登记应用、动作清单、圆点贴图出错只记日志，照样连上', t => {
  const rig = new Rig(t);
  rig.prepare = vr => {
    vr.fail('register', '登记不了');
    vr.manifestError = 7;
    vr.imageError = 9;
  };
  rig.session.start();
  assert.deepEqual(rig.logs, [
    'warn: cannot register steamvr app: 登记不了', 'error: action manifest failed: 7',
    'warn: pointer texture failed: 9', 'warn: pointer texture failed: 9', 'steamvr connected',
  ]);
  assert.equal(rig.session.connected, true);
  rig.session.stop();
});

test('每帧循环：频率是头显刷新率，夹在 30–144 Hz', t => {
  for (const [hz, ms] of [[90, 11], [200, 6], [10, 33]] as const) {
    const rig = new Rig(t);
    rig.hz = hz;
    rig.session.start();
    rig.wait(ms - 1);
    assert.equal(rig.args('poses').length, 0, `${hz} Hz`);
    rig.wait(1);
    assert.equal(rig.args('poses').length, 1, `${hz} Hz`);
    rig.wait(ms);
    assert.equal(rig.args('poses').length, 2, `${hz} Hz`);
    rig.session.stop();
    t.mock.restoreAll();
    t.mock.timers.reset();
  }
});

test('探测：SteamVR 没在运行时不连，每 5 秒查一次；连着时不重复连', t => {
  const rig = new Rig(t);
  rig.running = false;
  rig.session.start();
  rig.wait(PROBE * 2);
  assert.equal(rig.connects, 0);
  assert.deepEqual(rig.logs, []);
  rig.running = true;
  rig.wait(PROBE - 1);
  assert.equal(rig.session.connected, false);
  rig.wait(1);
  assert.equal(rig.session.connected, true);
  rig.wait(PROBE * 3);
  assert.equal(rig.connects, 1);
  assert.deepEqual(rig.logs, ['steamvr connected']);
  rig.session.stop();
});

test('连接出错：同一个错误只记一次日志，换了错误或中间 SteamVR 关过再记', t => {
  const rig = new Rig(t);
  rig.connectError = 'SteamVR 初始化失败 108';
  rig.session.start();
  rig.wait(PROBE * 3);
  assert.equal(rig.connects, 4);
  assert.deepEqual(rig.logs, ['error: vr: SteamVR 初始化失败 108']);
  assert.equal(rig.changed, 0);

  rig.connectError = null;
  rig.prepare = vr => { vr.fail('refreshRate', '读不到刷新率'); };
  rig.wait(PROBE * 2);
  assert.deepEqual(rig.logs.slice(1), ['error: vr: 读不到刷新率']);

  rig.running = false;
  rig.wait(PROBE);
  rig.running = true;
  rig.wait(PROBE * 2);
  assert.deepEqual(rig.logs.slice(2), ['error: vr: 读不到刷新率']);
  assert.equal(rig.session.connected, false);
  assert.equal(rig.changed, 0);

  rig.prepare = () => {};
  rig.wait(PROBE);
  assert.deepEqual(rig.logs.slice(3), ['steamvr connected']);
  assert.equal(rig.changed, 1);
  rig.session.stop();
});

test('连接出错：连到一半的资源全部放掉', t => {
  const rig = new Rig(t);
  rig.prepare = vr => { vr.fail('refreshRate', '读不到刷新率'); };   // 圆点都建好以后出错
  rig.session.start();
  assert.equal(rig.session.connected, false);
  assert.deepEqual(rig.vr.overlays.map(o => o.destroyed), [true, true]);
  assert.equal(rig.vr.closed, true);
  assert.equal(rig.gpu.disposed, true);
  assert.deepEqual(rig.gpu.live(), []);

  rig.prepare = vr => { vr.fail('handle', '取不到句柄'); };          // 只建了显卡设备
  let from = rig.calls.length;
  rig.wait(PROBE);
  assert.deepEqual(rig.names(from), ['outputLuid', 'register', 'setManifest', 'handle', 'activate', 'dispose', 'shutdown']);
  assert.deepEqual(rig.args('activate'), [[0, 0]]);

  rig.prepare = () => {};
  rig.gpuError = '建不出设备';                                       // 显卡设备没建出来
  from = rig.calls.length;
  rig.wait(PROBE);
  assert.deepEqual(rig.names(from), ['outputLuid', 'activate', 'shutdown']);
  assert.equal(rig.vr.closed, true);
  assert.equal(rig.gpus.length, 2);
  assert.deepEqual([rig.pages.length, rig.changed], [0, 0]);
  rig.session.stop();
});

// ---------- 开关键 ----------

test('总开关键：收起着就恢复，有面板显示着就整组收起；两只手都能按，同一帧按下只算一次，按住不放不会反复切换', t => {
  const rig = connected(t);
  rig.press('toggle', 'left', true);
  rig.press('toggle', 'right', true);
  rig.frame(2);
  assert.equal(rig.panel('a.kb').visible, true);
  rig.frame(5);
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, true]);
  assert.equal(rig.count('show', rig.panel('a.kb')), 1);
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock true true']]);
  rig.press('toggle', 'left', false);
  rig.press('toggle', 'right', false);
  rig.frame();
  rig.tap('toggle', 'left');                       // 左手的总开关键也管用
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [false, false]);
  assert.deepEqual([rig.panels.stowed, rig.views()], [true, ['a.kb true false', 'a.clock true false']]);
  rig.tap('toggle', 'right');
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, true]);
  rig.session.stop();
});

test('总开关键：面板用自己的收起按钮收起后，按一下它回来、别的面板不动，再按整组收起', t => {
  const rig = shown(t);
  const clock = { component: 'a.clock', where: 'panel' } as const;
  void rig.remote.open(clock, 'a.clock', false);   // 时钟页面的 ctx.panel.hide()
  rig.frame();
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, false]);
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock false false']]);
  const where = rig.panel('a.clock').pose;
  rig.tap('toggle');
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible, rig.panel('a.clock').pose], [true, true, where]);
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock true true']]);
  assert.deepEqual([rig.count('show', rig.panel('a.kb')), rig.count('hide', rig.panel('a.kb')), rig.opened], [1, 0, ['a.kb', 'a.clock']]);
  rig.tap('toggle', 'left');
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [false, false]);
  assert.deepEqual([rig.panels.stowed, rig.views()], [true, ['a.kb true false', 'a.clock true false']]);
  // 收起着时时钟又请显示方收起自己：按总开关键两块一起回来
  void rig.remote.open(clock, 'a.clock', false);
  rig.frame();
  assert.deepEqual([rig.panels.stowed, rig.views()], [true, ['a.kb true false', 'a.clock false false']]);
  rig.tap('toggle');
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, true]);
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock true true']]);
  rig.session.stop();
});

test('总开关键：只有键盘一块、1 号快捷位指向它，它被自己的收起按钮收起：按一下回来，位置是收起之前的，再按收起', t => {
  const rig = keyboard(t);
  const where = rig.panel().pose;
  void rig.remote.open({ component: 'a.kb', where: 'panel' }, 'a.kb', false);   // 键盘页面的 ctx.panel.hide()
  rig.frame();
  assert.deepEqual([rig.panel().visible, rig.panels.stowed, rig.views()], [false, false, ['a.kb false false']]);
  assert.equal(rig.panels.panels[0]?.quick, 1);
  rig.tap('toggle');
  assert.deepEqual([rig.panel().visible, rig.panel().pose, rig.panels.stowed, rig.views()], [true, where, false, ['a.kb true true']]);
  rig.tap('toggle', 'left');
  assert.deepEqual([rig.panel().visible, rig.panels.stowed, rig.views()], [false, true, ['a.kb true false']]);
  rig.session.stop();
});

test('快捷位键：开关那一个快捷位的面板，不动别的；空位什么都不做', t => {
  const rig = connected(t);
  rig.tap('quick1', 'left');                       // 总开关收起着：键盘单独显示
  assert.equal(rig.panel('a.kb').visible, true);
  assert.equal(rig.overlay('a.clock'), undefined);
  assert.deepEqual([rig.panels.stowed, rig.views()], [true, ['a.kb true true', 'a.clock true false']]);
  assert.deepEqual(rig.panels.panels.map(p => p.quick), [1, 0]);
  rig.tap('quick1', 'right');
  assert.deepEqual([rig.panel('a.kb').visible, rig.views()], [false, ['a.kb false false', 'a.clock true false']]);
  rig.tap('toggle');                               // 收起的时钟恢复，用快捷位键关掉的键盘一起回来
  rig.frame();
  assert.deepEqual([rig.panel('a.kb').visible, rig.panel('a.clock').visible], [true, true]);
  assert.deepEqual([rig.panels.stowed, rig.views()], [false, ['a.kb true true', 'a.clock true true']]);
  rig.tap('quick1');                               // 时钟显示着：只关掉键盘
  assert.deepEqual([rig.panel('a.kb').visible, rig.panels.stowed, rig.views()], [false, false, ['a.kb false false', 'a.clock true true']]);
  rig.tap('quick1');
  assert.deepEqual(rig.views(), ['a.kb true true', 'a.clock true true']);
  const published = rig.published.length;
  rig.tap('quick2');                               // 2 号是空位
  assert.equal(rig.published.length, published);
  rig.session.stop();
});

test('快捷位键：2 号指向一块面板时开关它', t => {
  const rig = connected(t, { settings: settingsWith({}, { quick: ['a.kb', 'a.clock'] }) });
  rig.tap('quick2');
  assert.equal(rig.panel('a.clock').visible, true);
  assert.equal(rig.overlay('a.kb'), undefined);
  assert.deepEqual(rig.panels.panels.map(p => p.quick), [1, 2]);
  rig.tap('quick2');
  assert.equal(rig.panel('a.clock').visible, false);
  rig.session.stop();
});

// ---------- 指 ----------

test('指：指尖的射线打在面板的正面上，圆点贴在落点上、页面收到移动；两只手指着同一块时两个圆点都显示，只发先指上来那只手的移动', t => {
  const rig = keyboard(t);
  const page = rig.page();
  const hand = rig.aim('left', 'a.kb', 350, 210);
  rig.frame();
  assert.deepEqual(page.events, ['move 350,210']);
  assert.equal(rig.dot('left').visible, true);
  // 圆点在落点上：手正前方 0.3 米处(手的朝向和面板相同)
  const [x, y, z] = [hand[3] - 0.3 * hand[2], hand[7] - 0.3 * hand[6], hand[11] - 0.3 * hand[10]];
  near(rig.dot('left').pose, dotPose(rig.panel().pose, [x, y, z]), 1e-9);
  assert.equal(rig.args('intersect').length, 0);   // 求交是自己算的，不问 SteamVR

  rig.aim('right', 'a.kb', 700, 350);
  rig.frame();
  assert.deepEqual(page.events.slice(1), ['move 350,210']);    // 没动的手每帧也发；右手不发
  assert.deepEqual([rig.dot('left').visible, rig.dot('right').visible], [true, true]);
  rig.away('left');
  rig.frame();                                     // 左手移开，同一帧里轮到右手
  assert.deepEqual(page.events.slice(2), ['leave', 'move 700,350']);
  rig.session.stop();
});

test('指：面板收起着、手柄姿态无效、没有设备、指在面板外、从背面指，都不算指着', t => {
  const rig = keyboard(t);
  const page = rig.page();
  const hand = rig.aim('left', 'a.kb', 350, 210);
  rig.frame();
  assert.equal(rig.dot('left').visible, true);
  rig.tap('toggle');                               // 收起
  page.events.length = 0;
  rig.frame(3);
  assert.deepEqual([rig.dot('left').visible, page.events], [false, []]);
  rig.tap('toggle');
  assert.equal(rig.dot('left').visible, true);

  rig.hand('left', null);                          // 姿态无效
  rig.frame(2);
  assert.equal(rig.dot('left').visible, false);
  rig.hand('left', hand);
  rig.frame();
  assert.equal(rig.dot('left').visible, true);

  page.events.length = 0;
  rig.vr.losePose(DEVICE.left);                    // 姿态无效，矩阵还是指着面板的那一份
  rig.frame(2);
  assert.deepEqual([rig.dot('left').visible, page.events], [false, ['leave']]);
  rig.hand('left', hand);
  rig.frame();
  assert.equal(rig.dot('left').visible, true);

  rig.vr.setRole(ROLE_LEFT, null);                 // 没有设备
  rig.frame(2);
  assert.equal(rig.dot('left').visible, false);
  rig.vr.setRole(ROLE_LEFT, DEVICE.left);
  rig.frame();
  assert.equal(rig.dot('left').visible, true);

  rig.hand('left', shifted(hand, 0, 0.5, 0));      // 面板上方
  rig.frame();
  assert.equal(rig.dot('left').visible, false);
  rig.hand('left', turned(0, 1.3, -1));            // 在面板背后朝着它的背面指
  rig.frame();
  assert.equal(rig.dot('left').visible, false);
  assert.equal(page.events.at(-1), 'leave');
  rig.session.stop();
});

test('指：一块面板只听先指上来的那只手——另一只手指上来、移开都不发事件，不发移出', t => {
  const rig = keyboard(t);
  const page = rig.page();
  rig.aim('left', 'a.kb', 350, 210);
  rig.frame();
  rig.aim('right', 'a.kb', 700, 350);
  rig.frame(2);
  assert.deepEqual([...new Set(page.events)], ['move 350,210']);
  page.events.length = 0;
  rig.away('right');
  rig.frame(2);
  assert.deepEqual(page.events, ['move 350,210', 'move 350,210']);
  assert.deepEqual([rig.dot('left').visible, rig.dot('right').visible], [true, false]);
  rig.session.stop();
});

test('指：取不到指尖时不算指着，满 1 秒重取', t => {
  const rig = new Rig(t, { list: [KB] });
  rig.prepare = vr => { vr.setTip(DEVICE.left, null); };
  rig.session.start();
  rig.tap('toggle');
  rig.aim('left', 'a.kb', 350, 210);
  const tips = (): number => rig.args('tip').filter(a => a[0] === DEVICE.left).length;
  rig.frame(98);                                   // 第一帧取过一次，离那时 990 毫秒
  assert.equal(tips(), 1);
  assert.deepEqual(rig.page().events, []);
  rig.vr.setTip(DEVICE.left, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]);
  rig.frame();                                     // 满 1 秒
  assert.equal(tips(), 2);
  assert.deepEqual(rig.page().events, ['move 350,210']);
  rig.frame(200);
  assert.equal(tips(), 2);
  rig.session.stop();
});

test('指：页面还没报大小、也没有纹理时算不出落点；第一帧贴上以后按纹理的大小算', t => {
  const rig = new Rig(t, { list: [KB] });
  rig.pageSize = { 'a.kb': [0, 0] };
  rig.session.start();
  rig.tap('toggle');
  rig.aim('right', 'a.kb', 700, 350);
  rig.frame(3);
  assert.deepEqual([rig.dot('right').visible, rig.page().events], [false, []]);
  rig.page().send(1, 1400, 700);
  rig.frame(2);
  assert.deepEqual([rig.dot('right').visible, rig.page().events.at(-1)], [true, 'move 700,350']);
  rig.session.stop();
});

// ---------- 点 ----------

test('点：两只手都能点——交替按扳机，各在自己指着的位置发按下和抬起', t => {
  const rig = keyboard(t);
  const page = rig.page();
  rig.aim('left', 'a.kb', 350, 210);
  rig.aim('right', 'a.kb', 700, 350);
  rig.frame();
  page.events.length = 0;
  rig.tap('click', 'left');
  rig.tap('click', 'right');
  rig.tap('click', 'left');
  assert.deepEqual(page.events, [
    'move 350,210', 'down 350,210', 'move 350,210 held', 'up 350,210',
    'move 350,210', 'move 700,350', 'down 700,350', 'move 700,350 held', 'up 700,350',
    'move 350,210', 'down 350,210', 'move 350,210 held', 'up 350,210',
  ]);
  rig.session.stop();
});

test('点：没指着面板时扳机不发事件', t => {
  const rig = keyboard(t);
  rig.tap('click', 'left');
  assert.deepEqual(rig.page().events, []);
  rig.session.stop();
});

test('点：按着扳机滑出面板的边缘，落点夹在边上继续发移动，松开时在那里抬起，之后才算移出', t => {
  const rig = keyboard(t);
  const page = rig.page();
  const hand = rig.aim('left', 'a.kb', 350, 210);
  rig.press('click', 'left', true);
  rig.frame(2);
  page.events.length = 0;
  rig.hand('left', shifted(hand, -0.5, 0, 0));     // 向左滑出去
  rig.frame();
  assert.deepEqual(page.events, ['move 0,210 held']);
  assert.equal(rig.dot('left').visible, true);
  // 圆点夹在面板的边上：键盘宽 0.8 米、高 0.4 米，左边离中心 0.4 米
  const o = rig.panel();
  const offset = (along: 0 | 1): number => {
    const from = position(o.pose);
    const to = position(rig.dot('left').pose);
    const dir = axis(o.pose, along);
    return (to[0] - from[0]) * dir[0] + (to[1] - from[1]) * dir[1] + (to[2] - from[2]) * dir[2];
  };
  near([offset(0)], [-0.4], 1e-6);
  rig.hand('left', shifted(hand, 0, 0.5, 0));      // 向上滑出去：上边离中心 0.2 米
  rig.frame();
  near([offset(1)], [0.2], 1e-6);
  assert.equal(page.events.pop(), 'move 350,0 held');
  rig.hand('left', shifted(hand, -0.5, 0, 0));
  rig.frame();
  page.events.pop();
  rig.press('click', 'left', false);
  rig.frame(2);
  assert.deepEqual(page.events, ['move 0,210 held', 'move 0,210 held', 'up 0,210', 'leave']);
  assert.equal(rig.dot('left').visible, false);
  rig.session.stop();
});

test('点：按着扳机时面板被收起，补抬起和移出', t => {
  const rig = keyboard(t);
  const page = rig.page();
  rig.aim('left', 'a.kb', 700, 350);
  rig.press('click', 'left', true);
  rig.frame(2);
  page.events.length = 0;
  rig.press('toggle', 'right', true);
  rig.frame();                                     // 这一帧末尾布局变了
  assert.deepEqual(page.events, ['move 700,350 held']);
  rig.frame();                                     // 悬浮窗口隐藏
  assert.deepEqual(page.events, ['move 700,350 held', 'up 700,350', 'leave']);
  rig.frame(3);
  assert.equal(page.events.length, 3);
  rig.session.stop();
});

test('点：按着扳机时 SteamVR 退出、组件停用，替页面补抬起和移出(按住连发的键靠它停下)', t => {
  const rig = keyboard(t);
  const page = rig.page();
  rig.aim('right', 'a.kb', 700, 350);
  rig.press('click', 'right', true);
  rig.frame(2);
  rig.vr.emit(EVENT_QUIT);
  rig.frame();
  assert.equal(rig.session.connected, false);
  assert.deepEqual([page.events.slice(-3), page.closed], [['move 700,350 held', 'up 700,350', 'leave'], false]);
  // 重新连上后只指着、没按着时停用：只发移出
  rig.wait(PROBE);
  rig.tap('toggle');
  page.events.length = 0;
  rig.aim('right', 'a.kb', 700, 350);
  rig.frame(2);
  rig.session.stop();
  assert.deepEqual(page.events.at(-1), 'leave');
  assert.equal(page.events.includes('up 700,350'), false);
});

// ---------- 抓和缩放 ----------

test('抓：握把按下时指着面板才抓得起来，面板平滑地跟着这只手走；松开后留在原地，位置过 500 毫秒存进组件数据', t => {
  const rig = keyboard(t);
  const overlay = rig.panel();
  const start = overlay.pose;
  rig.tap('grab', 'right');                        // 没指着：抓不起来
  rig.frame(3);
  assert.equal(overlay.pose, start);

  const hand = rig.aim('right', 'a.kb', 700, 350);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame();
  near(overlay.pose, start);                       // 手没动，面板不动
  rig.hand('right', shifted(hand, 0.1, 0.05, 0));  // 抓起来以后不用一直指着
  rig.frame();
  near(overlay.pose, shifted(start, 0.1 * K, 0.05 * K, 0));   // 一帧走时间常数 0.04 秒的指数平滑的一步
  rig.frame(200);
  near(overlay.pose, shifted(start, 0.1, 0.05, 0), 1e-6);
  assert.deepEqual(rig.stored.length, 1);          // 第一次放到面前时存过一次；抓着的时候不存

  rig.press('grab', 'right', false);
  rig.frame();
  const rest = overlay.pose;
  const places = rig.count('place', overlay);
  rig.hand('right', hand);
  rig.frame(5);
  assert.equal(overlay.pose, rest);
  assert.equal(rig.count('place', overlay), places);
  rig.wait(500);
  assert.equal(rig.stored.length, 2);
  near((rig.stored[1] as { panels: Record<string, { pose: number[] }> }).panels['a.kb']?.pose ?? [], rest);
  rig.session.stop();
});

test('抓取延迟：默认要按住 0.15 秒面板才跟手', t => {
  const rig = keyboard(t, settingsWith({ snap: false }));
  const overlay = rig.panel();
  const start = overlay.pose;
  const hand = rig.aim('right', 'a.kb', 700, 350);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(5);
  rig.hand('right', shifted(hand, 0.02, 0, 0));
  rig.frame(5);
  assert.equal(overlay.pose, start);
  rig.frame(10);                                   // 满 0.15 秒：从这一刻的相对位置起跟手
  rig.hand('right', shifted(hand, 0.12, 0, 0));
  rig.frame(200);
  near(overlay.pose, shifted(start, 0.1, 0, 0), 1e-6);
  rig.session.stop();
});

test('锁：全局锁或这块面板自己锁着时抓不动，点击照常', t => {
  const rig = keyboard(t);
  const overlay = rig.panel();
  const start = overlay.pose;
  const hand = rig.aim('right', 'a.kb', 700, 350);
  const drag = (): void => {
    rig.press('grab', 'right', true);
    rig.frame();
    rig.hand('right', shifted(hand, 0.1, 0, 0));
    rig.frame(20);
    rig.press('grab', 'right', false);
    rig.hand('right', hand);
    rig.frame();
  };
  void rig.remote.lockAll(WHO, true);
  rig.frame();
  drag();
  assert.equal(overlay.pose, start);
  rig.tap('click', 'right');
  assert.deepEqual(rig.page().events.filter(e => !e.startsWith('move')), ['down 700,350', 'up 700,350']);
  void rig.remote.lockAll(WHO, false);
  void rig.remote.set(WHO, 'a.kb', { locked: true });
  rig.frame();
  drag();
  assert.equal(overlay.pose, start);
  assert.deepEqual([rig.panels.locked, rig.panels.panels[0]?.locked], [false, true]);
  void rig.remote.set(WHO, 'a.kb', { locked: false });
  rig.frame();
  drag();
  assert.notEqual(overlay.pose, start);
  rig.session.stop();
});

// 两只手相距 0.4 米抓住键盘
function stretching(t: TestContext, settings = DIRECT): { rig: Rig; left: ReturnType<Rig['aim']>; right: ReturnType<Rig['aim']> } {
  const rig = keyboard(t, settings);
  const left = rig.aim('left', 'a.kb', 349, 349);
  const right = rig.aim('right', 'a.kb', 1049, 349);
  rig.frame();
  rig.press('grab', 'left', true);
  rig.press('grab', 'right', true);
  rig.frame();
  return { rig, left, right };
}

test('缩放：宽度按两手距离的比例变，夹在清单的 0.4–1.6 米；缩放时不存', t => {
  const { rig, right } = stretching(t);
  const overlay = rig.panel();
  near([overlay.meters], [0.8]);
  rig.hand('right', shifted(right, 0.2, 0, 0));    // 0.6 米
  rig.frame();
  near([overlay.meters], [1.2]);
  rig.hand('right', shifted(right, 0.8, 0, 0));    // 1.2 米
  rig.frame();
  assert.equal(overlay.meters, 1.6);
  rig.hand('right', shifted(right, -0.3, 0, 0));   // 0.1 米
  rig.frame();
  assert.equal(overlay.meters, 0.4);
  rig.wait(1000);
  assert.equal(rig.stored.length, 1);
  assert.equal(rig.panels.panels[0]?.meters, 0.8); // 状态里还是缩放之前的宽度
  rig.session.stop();
});

test('缩放：松开一只手时宽度取整到厘米记进布局并存盘，剩下的那只手不让面板跳，接着能拖', t => {
  const { rig, right } = stretching(t);
  const overlay = rig.panel();
  const start = overlay.pose;
  rig.hand('right', shifted(right, 0.1333, 0, 0)); // 0.5333 米
  rig.frame(3);
  near([overlay.meters], [1.0666]);
  near(overlay.pose, start);

  rig.press('grab', 'left', false);                // 左手松开，右手还抓着
  rig.frame();
  assert.equal(overlay.meters, 1.07);
  assert.equal(rig.control.layout.panels['a.kb']?.meters, 1.07);
  near(overlay.pose, start);                       // 面板留在原地，不向右手抓起来时的相对位置靠
  rig.frame(20);
  near(overlay.pose, start);
  assert.equal(rig.panels.panels[0]?.meters, 1.07);
  rig.wait(500);
  assert.equal((rig.stored.at(-1) as { panels: Record<string, { meters: number }> }).panels['a.kb']?.meters, 1.07);

  rig.hand('right', shifted(right, 0.1333, 0.1, 0));   // 右手接着拖
  rig.frame(200);
  near(overlay.pose, shifted(start, 0, 0.1, 0), 1e-6);
  rig.session.stop();
});

test('缩放：两只手同一帧松开只记一次；缩放中断开时不记宽度，重新连上后宽度是布局里的', t => {
  const { rig, right } = stretching(t);
  rig.hand('right', shifted(right, 0.2, 0, 0));
  rig.frame();
  rig.press('grab', 'left', false);
  rig.press('grab', 'right', false);
  rig.frame(3);
  assert.deepEqual([rig.panel().meters, rig.control.layout.panels['a.kb']?.meters], [1.2, 1.2]);
  rig.session.stop();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const again = stretching(t);
  again.rig.hand('right', shifted(again.right, 0.2, 0, 0));
  again.rig.frame();
  near([again.rig.panel().meters], [1.2]);
  again.rig.vr.emit(EVENT_QUIT);
  again.rig.frame();
  assert.equal(again.rig.session.connected, false);
  again.rig.wait(PROBE);
  again.rig.tap('toggle');
  again.rig.frame(3);
  assert.deepEqual([again.rig.panel().meters, again.rig.control.layout.panels['a.kb']?.meters], [0.8, null]);
  again.rig.session.stop();
});

test('缩放到一半面板被收起：不记宽度；再显示时悬浮窗口的宽度是布局里的', t => {
  const rig = keyboard(t);
  rig.aim('left', 'a.kb', 349, 349);
  const right = rig.aim('right', 'a.kb', 1049, 349);
  rig.frame();
  rig.press('grab', 'left', true);
  rig.press('grab', 'right', true);
  rig.frame();
  rig.hand('right', shifted(right, 0.2, 0, 0));
  rig.frame(2);
  near([rig.panel().meters], [1.2], 1e-6);
  rig.tap('toggle');
  assert.equal(rig.panel().visible, false);
  rig.press('grab', 'left', false);
  rig.press('grab', 'right', false);
  rig.away('left');
  rig.away('right');
  rig.frame();
  rig.tap('toggle');
  rig.frame(2);
  assert.deepEqual([rig.panel().visible, rig.panel().meters, recordOf(rig.control.layout, 'a.kb')?.meters, rig.panels.panels[0]?.meters], [true, 0.8, null, 0.8]);
  rig.session.stop();
});

test('两只手各抓一块：各移各的', t => {
  const rig = shown(t, { settings: DIRECT });
  const starts = [rig.panel('a.kb').pose, rig.panel('a.clock').pose];
  const left = rig.aim('left', 'a.kb', 700, 350);
  const right = rig.aim('right', 'a.clock', 200, 100);
  rig.frame();
  rig.press('grab', 'left', true);
  rig.press('grab', 'right', true);
  rig.frame();
  rig.hand('left', shifted(left, -0.1, 0, 0));
  rig.hand('right', shifted(right, 0.3, 0.1, 0));
  rig.frame(200);
  near(rig.panel('a.kb').pose, shifted(starts[0] ?? LEFT, -0.1, 0, 0), 1e-6);
  near(rig.panel('a.clock').pose, shifted(starts[1] ?? LEFT, 0.3, 0.1, 0), 1e-6);
  assert.deepEqual([rig.panel('a.kb').meters, rig.panel('a.clock').meters], [0.8, 0.3]);
  rig.session.stop();
});

// ---------- 挡游戏按键 ----------

test('挡游戏按键：设置开着时，有手指着面板、扳机按住滑出去、抓着面板时用最高优先级，其余时候是 0；设置关着时一直是 0', t => {
  const rig = connected(t, { list: [KB], settings: settingsWith({ grabDelay: 0, snap: false }) });
  const side: Side = 'left';
  rig.frame();                                     // 面板收起着
  rig.tap('toggle');                               // 显示出来，还没指着
  const hand = rig.aim(side, 'a.kb', 350, 210);
  rig.frame();                                     // 指着
  rig.away(side);
  rig.frame();                                     // 移开
  rig.hand(side, hand);
  rig.press('click', side, true);
  rig.frame(2);
  rig.hand(side, shifted(hand, 0, 1, 0));
  rig.frame();                                     // 扳机按住滑出去
  rig.press('click', side, false);
  rig.frame(2);
  assert.deepEqual(rig.priorities(), [0, 0, 0, BLOCK, 0, BLOCK, BLOCK, BLOCK, BLOCK, 0]);
  rig.hand(side, hand);
  rig.press('grab', side, true);
  rig.frame(2);
  rig.hand(side, shifted(hand, 0, 1, 0));
  rig.frame(3);                                    // 抓着，射线早就不在面板上了
  rig.press('grab', side, false);
  rig.frame(2);
  assert.deepEqual(rig.priorities().slice(10), [BLOCK, BLOCK, BLOCK, BLOCK, BLOCK, BLOCK, 0]);
  assert.equal(rig.args('activate').every(a => a[0] === rig.vr.id('set', '/actions/main')), true);
  rig.session.stop();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const off = keyboard(t, settingsWith({ blockInput: false }));
  off.aim('left', 'a.kb', 350, 210);
  off.press('click', 'left', true);
  off.frame(3);
  assert.deepEqual([...new Set(off.priorities())], [0]);
  off.session.stop();
});

// ---------- 圆点 ----------

test('圆点：只在指着的状态变化时显示或隐藏，指着时每帧放到落点上', t => {
  const rig = keyboard(t);
  const left = rig.dot('left');
  const right = rig.dot('right');
  rig.frame(3);
  assert.deepEqual([rig.count('show', left), rig.count('hide', left), rig.count('place', left)], [0, 0, 0]);
  rig.aim('left', 'a.kb', 350, 210);
  rig.frame(4);
  assert.deepEqual([rig.count('show', left), rig.count('hide', left), rig.count('place', left)], [1, 0, 4]);
  rig.away('left');
  rig.frame(4);
  assert.deepEqual([rig.count('show', left), rig.count('hide', left), rig.count('place', left)], [1, 1, 4]);
  assert.deepEqual([rig.count('show', right), rig.count('hide', right), rig.count('place', right)], [0, 0, 0]);
  rig.session.stop();
});

test('圆点：显示没成功时下一帧重试', t => {
  const rig = keyboard(t);
  const left = rig.dot('left');
  rig.vr.stuck.add(DOT.left);
  rig.aim('left', 'a.kb', 350, 210);
  rig.frame(3);
  assert.equal(rig.count('show', left), 3);
  assert.equal(left.visible, false);
  rig.vr.stuck.delete(DOT.left);
  rig.frame(3);
  assert.equal(rig.count('show', left), 4);
  assert.equal(left.visible, true);
  rig.session.stop();
});

// ---------- 画面 ----------

test('画面：页面交来的帧贴到这块面板的悬浮窗口上', t => {
  const rig = shown(t);
  rig.page('a.clock').send(1);
  rig.page('a.kb').send(1);
  rig.frame(2);
  const [first, second] = textures(rig.gpu);
  assert.ok(first && second);
  assert.deepEqual([rig.panel('a.kb').texture, rig.panel('a.clock').texture], [first, second]);
  assert.deepEqual([first.frames, [first.width, first.height], second.frames, [second.width, second.height]], [[1001n], [1400, 700], [2001n], [400, 200]]);
  assert.deepEqual(rig.logs, ['steamvr connected', 'vr: a.kb 纹理 1400×700', 'vr: a.clock 纹理 400×200']);
  rig.session.stop();
});

// ---------- 求交的两条退路 ----------

test('求交改用 SteamVR 的：每只手对每块显示着的面板各问一次，落点照它给的算', t => {
  const rig = new Rig(t, { list: [KB], hit: { check: false, native: true } });
  rig.prepare = vr => { vr.hit = (overlay, source, dir) => squareHit(source, dir, overlay.pose, overlay.meters); };
  rig.session.start();
  rig.tap('toggle');
  rig.aim('left', 'a.kb', 350, 210);
  const before = rig.args('intersect').length;
  rig.frame();
  assert.equal(rig.args('intersect').length - before, 2);        // 两只手各问一次；右手朝身后指，问了没中
  assert.deepEqual(rig.page().events, ['move 350,210']);
  assert.equal(rig.dot('left').visible, true);
  // 正方形里、面板的矩形外：SteamVR 说打中了，换成像素时落在面板外，不算
  rig.hand('left', shifted(rig.aim('left', 'a.kb', 350, 0), 0, 0.1, 0));
  rig.frame();
  assert.equal(rig.dot('left').visible, false);
  rig.session.stop();
});

test('求交改用 SteamVR 的：落点正好在右边、下边那条线上时，页面得到的是最后一列、最后一行的像素', t => {
  const rig = new Rig(t, { list: [KB], hit: { check: false, native: true } });
  let edge: { u: number; v: number } | null = null;   // SteamVR 给的 u、v 换成这一组
  rig.prepare = vr => {
    vr.hit = (overlay, source, dir) => {
      const hit = squareHit(source, dir, overlay.pose, overlay.meters);
      return hit && edge ? { ...hit, ...edge } : hit;
    };
  };
  rig.session.start();
  rig.tap('toggle');
  rig.aim('left', 'a.kb', 700, 350);
  edge = { u: 1, v: 0.25 };                        // 键盘 1400×700：v 自下而上，0.25 是下边
  rig.frame();
  assert.deepEqual(rig.page().events, ['move 1399,699']);
  edge = { u: 0, v: 0.75 };                        // 左上角
  rig.frame();
  assert.deepEqual(rig.page().events, ['move 1399,699', 'move 0,0']);
  rig.session.stop();
});

test('核对求交：打开时指着的那块面板另外问一次 SteamVR，落点差 2 像素以上记一行日志，一秒最多一行', t => {
  const rig = new Rig(t, { list: [KB], hit: { check: true, native: false } });
  let skew = 0;                                    // SteamVR 给的 u、v 比真的偏多少
  let lift = 0;
  rig.prepare = vr => {
    vr.hit = (overlay, source, dir) => {
      const hit = squareHit(source, dir, overlay.pose, overlay.meters);
      return hit ? { ...hit, u: hit.u + skew, v: hit.v + lift } : null;
    };
  };
  rig.session.start();
  rig.tap('toggle');
  rig.aim('left', 'a.kb', 350, 210);
  rig.frame(3);
  assert.equal(rig.args('intersect').length, 3);   // 每帧一次，只问指着的那只手
  assert.deepEqual(rig.logs, ['steamvr connected']);
  skew = 1 / 1400;                                 // 差 1 像素：不记
  rig.frame();
  assert.deepEqual(rig.logs, ['steamvr connected']);
  skew = 2 / 1400;
  rig.frame(50);
  assert.deepEqual(rig.logs.slice(1), ['warn: hit check a.kb: js 350,210 native 352,210']);
  rig.frame(60);                                   // 过了一秒再记一行
  assert.equal(rig.logs.length, 3);
  skew = 0;
  lift = 1 / 1400;                                 // 上下差 1 像素(v 按边长等于宽度的正方形算)：不记
  rig.wait(1000);
  assert.equal(rig.logs.length, 3);
  lift = 5 / 1400;                                 // v 大 5 像素：落点高 5 像素
  rig.wait(1000);
  assert.equal(rig.logs.at(-1), 'warn: hit check a.kb: js 350,210 native 350,205');
  lift = 0;
  skew = 2;                                        // SteamVR 说没打中
  rig.wait(1000);
  assert.equal(rig.logs.at(-1), 'warn: hit check a.kb: js 350,210 native none');
  assert.deepEqual(rig.page().events.at(-1), 'move 350,210');    // 用的还是自己算的
  rig.session.stop();
});

// ---------- 断开 ----------

test('断开：SteamVR 退出时放掉全部资源，不记错误；面板的页面停画不关；之后的探测重新连上', t => {
  const rig = keyboard(t);
  const { vr, gpu } = rig;
  const page = rig.page();
  page.send(1);
  rig.frame();         // 1 复制中
  page.send(2);        // 2 等着
  vr.emit(EVENT_QUIT);
  const from = rig.calls.length;
  rig.frame();
  assert.deepEqual(rig.names(from), [
    'events', 'activate', 'destroy', 'destroy',
    'closeHandle', 'closeHandle', 'destroy', 'release', 'release', 'release',
    'dispose', 'shutdown',
  ]);
  assert.deepEqual(rig.args('activate').at(-1), [vr.id('set', '/actions/main'), 0]);
  assert.deepEqual(vr.overlays.map(o => o.destroyed), [true, true, true]);
  assert.equal(vr.closed, true);
  assert.equal(gpu.disposed, true);
  assert.deepEqual(gpu.live(), []);
  assert.deepEqual(page.released, [1, 2]);
  assert.deepEqual(page.early, []);
  assert.deepEqual([page.painting, page.closed], [false, false]);
  // 停画的要求到宿主之前已经在路上的帧：断开之后才到，关掉句柄并还回去
  page.send(3);
  assert.deepEqual([page.released, page.early, gpu.closed], [[1, 2, 3], [], [1001n, 1002n, 1003n]]);
  assert.deepEqual(rig.logs.filter(l => !l.startsWith('vr: ')), ['steamvr connected', 'steamvr disconnected']);
  assert.deepEqual([rig.changed, rig.session.connected, rig.status.at(-1)], [2, false, 'idle']);

  const quiet = rig.calls.length;
  rig.frame(10);                                   // 每帧循环已经停了
  assert.equal(rig.calls.length, quiet);

  rig.wait(PROBE);
  assert.deepEqual([rig.connects, rig.session.connected, rig.changed], [2, true, 3]);
  assert.equal(rig.overlay('a.kb'), undefined);    // 收起着：悬浮窗口等按了总开关键才建
  rig.tap('toggle');
  assert.deepEqual([rig.panel().visible, rig.pages.length, page.painting], [true, 1, true]);
  rig.session.stop();
});

test('断开：取姿态、更新动作集、读按键出错时记错误日志并断开', t => {
  for (const method of ['poses', 'activate', 'button', 'events'] as const) {
    const rig = keyboard(t);
    rig.vr.fail(method, '读不到');
    rig.frame();
    assert.deepEqual(rig.logs, ['steamvr connected', 'error: vr: 读不到', 'steamvr disconnected'], method);
    assert.deepEqual([rig.session.connected, rig.vr.closed, rig.gpu.disposed, rig.changed], [false, true, true, 2], method);
    assert.deepEqual([rig.page().painting, rig.page().closed], [false, false], method);
    rig.session.stop();
    assert.equal(rig.changed, 2, method);
    t.mock.restoreAll();
    t.mock.timers.reset();
  }
});

test('停止：断开并停掉探测', t => {
  const rig = keyboard(t);
  rig.session.stop();
  assert.equal(rig.session.connected, false);
  assert.deepEqual(rig.logs, ['steamvr connected', 'steamvr disconnected']);
  assert.equal(rig.vr.closed, true);
  assert.deepEqual(rig.gpu.live(), []);
  rig.wait(PROBE * 3);
  assert.equal(rig.connects, 1);
  rig.session.stop();                              // 已经断开时不通知
  assert.equal(rig.changed, 2);
});

test('开始两次只探测一份：停止之后不留着探测，SteamVR 起来了也不连', t => {
  const rig = new Rig(t, { list: [KB] });
  rig.running = false;
  rig.session.start();
  rig.session.start();
  rig.session.stop();
  rig.running = true;
  rig.wait(PROBE * 3);
  assert.deepEqual([rig.connects, rig.session.connected], [0, false]);
  rig.session.start();
  assert.deepEqual([rig.connects, rig.session.connected], [1, true]);
  rig.session.stop();
});

test('两块面板前后叠着：指尖的射线只算打在近的那一块上', t => {
  const rig = shown(t, { list: [KB, { ...CLOCK, spawn: 'low', meters: 0.8 }], settings: settingsWith({ recenter: 'never' }) });
  // 时钟挪到键盘正后方 0.1 米(沿键盘的法线往后)
  const kb = rig.panel('a.kb').pose;
  const behind = shifted(kb, -0.1 * kb[2], -0.1 * kb[6], -0.1 * kb[10]);
  rig.control.change(layout => ({ ...layout, panels: { ...layout.panels, 'a.clock': { open: true, pinned: false, locked: false, meters: 0.8, anchor: 'world', glance: false, pose: behind } } }));
  rig.frame();
  near(rig.panel('a.clock').pose, behind);
  rig.aim('right', 'a.kb', 700, 350);
  rig.frame(2);
  assert.deepEqual([rig.page('a.kb').events.at(-1), rig.page('a.clock').events], ['move 700,350', []]);
  rig.session.stop();
});

// ---------- 附着的面板 ----------

// 手腕上的面板在手柄上方 0.1 米、和手柄同朝向
const WORN = at(0, 0.1, 0);
// 左手的指尖相对手柄：在手腕上的面板正前方 0.3 米朝着它——左手的射线一直打在自己手上那块面板的正中
const TIP_AT_OWN = at(0, 0.1, 0.3);
const LEFT_UP = at(-0.2, 1.2, -0.4);               // 左手抬在身前
// 布局：一块常显的面板(连上就显示)
const pinned = (id: string, patch: Partial<PanelRecord>): Layout => readLayout({
  locked: false, panels: { [id]: { open: true, pinned: true, locked: false, meters: null, anchor: 'world', glance: false, pose: null, ...patch } },
});
const dist = (a: readonly number[], b: readonly number[]): number => Math.hypot((a[3] ?? 0) - (b[3] ?? 0), (a[7] ?? 0) - (b[7] ?? 0), (a[11] ?? 0) - (b[11] ?? 0));

// 连上，左手抬在身前，手腕上的面板(附着在左手上、不用抬手)显示着
function worn(t: TestContext, patch: Partial<PanelRecord> = {}, options: RigOptions = {}): Rig {
  const rig = new Rig(t, { list: [WRIST], settings: DIRECT, layout: pinned('a.wrist', { anchor: 'left', pose: WORN, ...patch }), ...options });
  rig.hand('left', LEFT_UP);
  rig.session.start();
  rig.frame(2);
  assert.equal(rig.panel('a.wrist').visible, true);
  return rig;
}

test('附着在左手上的面板不吃左手的射线：射线正打在它上面也没有事件、没有圆点、不挡游戏按键，扳机点不到；右手照常指和点；面板的位置照手柄的姿态算，不照指尖', t => {
  const rig = new Rig(t, { list: [WRIST], settings: DIRECT, layout: pinned('a.wrist', { anchor: 'left', locked: true, pose: WORN }) });
  rig.prepare = vr => vr.setTip(DEVICE.left, TIP_AT_OWN);
  rig.hand('left', LEFT_UP);
  rig.session.start();
  rig.frame(2);
  const page = rig.page('a.wrist');
  near(rig.where('a.wrist'), at(-0.2, 1.3, -0.4));
  rig.tap('click', 'left');
  rig.tap('grab', 'left');
  assert.deepEqual([page.events, rig.dot('left').visible, rig.priorities().at(-1)], [[], false, 0]);
  // 右手指着正中扣扳机：落点照「手柄的姿态 × 相对变换」算
  rig.aim('right', 'a.wrist', 120, 60);
  rig.frame();
  assert.equal(rig.priorities().at(-1), BLOCK);
  rig.tap('click', 'right');
  assert.deepEqual(page.events.filter(e => !e.startsWith('move')), ['down 120,60', 'up 120,60']);
  assert.deepEqual([rig.dot('right').visible, rig.dot('left').visible], [true, false]);
  near(position(rig.dot('right').pose), [-0.2, 1.3, -0.398], 1e-3);
  rig.away('right');
  rig.frame();
  assert.equal(page.events.at(-1), 'leave');

  // 同一个位置上的面板附着到头显上(相对头显的变换算成同一个站立空间里的位置)：左手的射线算数
  page.events.length = 0;
  rig.control.change(layout => ({ ...layout, panels: { ...layout.panels, 'a.wrist': { open: true, pinned: true, locked: true, meters: null, anchor: 'head', glance: false, pose: at(-0.2, -0.3, -0.4) } } }));
  rig.frame();
  near(rig.where('a.wrist'), at(-0.2, 1.3, -0.4));
  assert.deepEqual([page.events, rig.dot('left').visible, rig.priorities().at(-1)], [['move 120,60'], true, BLOCK]);
  rig.tap('click', 'left');
  assert.deepEqual(page.events.filter(e => !e.startsWith('move')), ['down 120,60', 'up 120,60']);
  rig.session.stop();
});

test('附着在手上的面板抓取延迟固定 0.4 秒(设置选了「无」也一样)；附着在头显上的照设置', t => {
  const rig = worn(t);
  const o = rig.panel('a.wrist');
  const hand = rig.aim('right', 'a.wrist', 120, 60);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(30);                                   // 0.3 秒
  rig.hand('right', shifted(hand, 0.02, 0, 0));    // 还指着面板
  rig.frame(5);
  assert.deepEqual([o.pose, rig.count('placeOn', o)], [WORN, 1]);
  rig.frame(10);                                   // 满 0.4 秒：从这一刻的相对位置起跟手
  rig.hand('right', shifted(hand, 0.07, 0, 0));
  rig.frame(200);
  near(rig.where('a.wrist'), at(-0.15, 1.3, -0.4), 1e-6);
  rig.session.stop();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const head = connected(t, { list: [HUD], settings: DIRECT, layout: pinned('a.hud', { anchor: 'head', pose: at(0, -0.2, -0.6) }) });
  head.frame(2);
  const grip = head.aim('right', 'a.hud', 200, 100);
  head.frame();
  head.press('grab', 'right', true);
  head.frame();
  head.hand('right', shifted(grip, 0.1, 0, 0));
  head.frame();
  near(head.where('a.hud'), at(0.1 * K, 1.4, -0.6));   // 握把一按就抓起来，下一帧就跟手
  head.session.stop();
});

test('抓着附着在头显上的面板挪：面板跟手，相对头显的变换跟着变；松手后还附着在头显上，记下新的相对变换，不吸正；头动了面板跟着走', t => {
  const rig = connected(t, { list: [HUD], settings: settingsWith({ grabDelay: 0 }), layout: pinned('a.hud', { anchor: 'head', pose: at(0, -0.2, -0.6) }) });
  rig.frame(2);
  const o = rig.panel('a.hud');
  const hand = rig.aim('right', 'a.hud', 200, 100);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame();
  near(o.pose, at(0, -0.2, -0.6));                 // 手没动，面板不动
  // 手往右 0.1 米、往上 0.05 米，再绕射线的方向滚 5°
  const c = Math.cos(5 * Math.PI / 180);
  const s = Math.sin(5 * Math.PI / 180);
  rig.hand('right', [c, -s, 0, hand[3] + 0.1, s, c, 0, hand[7] + 0.05, 0, 0, 1, hand[11]]);
  rig.frame();
  const placed = rig.count('placeOn', o);
  rig.frame(200);
  assert.ok(rig.count('placeOn', o) > placed);     // 抓着的时候相对变换每帧告诉 SteamVR
  near(rig.where('a.hud'), [c, -s, 0, 0.1, s, c, 0, 1.45, 0, 0, 1, -0.6], 1e-3);
  assert.deepEqual(rig.control.layout.panels['a.hud']?.pose, at(0, -0.2, -0.6));   // 抓着的时候不记进布局
  assert.equal(rig.stored.length, 0);

  rig.press('grab', 'right', false);
  rig.frame();
  const kept = rig.control.layout.panels['a.hud'];
  near(kept?.pose ?? [], [c, -s, 0, 0.1, s, c, 0, -0.15, 0, 0, 1, -0.6], 1e-3);   // 侧倾 5° 留着：附着的面板不吸正
  assert.deepEqual([kept?.anchor, o.device, rig.count('place', o)], ['head', 0, 0]);
  const told = rig.count('placeOn', o);
  rig.setHead(turned(1, 1.6, 0));
  rig.frame(5);
  assert.equal(rig.count('placeOn', o), told);     // 松手以后不用说
  near(rig.where('a.hud'), [-c, s, 0, 0.9, s, c, 0, 1.45, 0, 0, -1, 0.6], 1e-3);   // 头转了 180°：面板到了另一侧
  rig.wait(500);
  near((rig.stored.at(-1) as { panels: Record<string, { pose: number[] }> }).panels['a.hud']?.pose ?? [], kept?.pose ?? []);
  rig.session.stop();
});

test('右手抓着左手上的面板挪：左手这期间动了面板也跟着右手；松手后记下相对左手的变换，之后跟着左手走', t => {
  const rig = worn(t);
  const hand = rig.aim('right', 'a.wrist', 120, 60);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(45);
  rig.hand('right', shifted(hand, 0.05, 0.02, 0));
  rig.frame(20);
  rig.hand('left', at(-0.3, 1.1, -0.4));           // 左手往左下挪 0.1 米
  rig.frame(200);
  near(rig.where('a.wrist'), at(-0.15, 1.32, -0.4), 1e-6);
  rig.press('grab', 'right', false);
  rig.frame();
  const kept = rig.control.layout.panels['a.wrist'];
  near(kept?.pose ?? [], at(0.15, 0.22, 0), 1e-6);
  assert.deepEqual([kept?.anchor, kept?.locked, rig.panel('a.wrist').device], ['left', false, DEVICE.left]);
  rig.away('right');
  rig.hand('left', turned(0.3, 1, 0.2));           // 左手转过身去
  rig.frame(3);
  near(rig.where('a.wrist'), turned(0.15, 1.22, 0.2), 1e-6);
  near(rig.control.layout.panels['a.wrist']?.pose ?? [], at(0.15, 0.22, 0), 1e-6);
  rig.session.stop();
});

test('双手缩放左手上的面板：右手抓着它时左手的握把按住满 0.4 秒(不用指着)，宽度按两手距离变，面板留在手腕上；松开时宽度和相对变换记进布局；左手没按满就松开的不缩放', t => {
  const rig = worn(t);
  const o = rig.panel('a.wrist');
  rig.tap('grab', 'left');                         // 没有手抓着它：左手按握把不起作用
  const right = rig.aim('right', 'a.wrist', 120, 60);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(45);
  rig.press('grab', 'left', true);
  rig.frame(45);
  near([o.meters], [0.12]);
  // 右手沿两手的连线退到两倍远
  const far = shifted(LEFT_UP, 2 * (right[3] - LEFT_UP[3]), 2 * (right[7] - LEFT_UP[7]), 2 * (right[11] - LEFT_UP[11]));
  near([dist(far, LEFT_UP)], [2 * dist(right, LEFT_UP)]);
  rig.hand('right', far);
  rig.frame();
  near([o.meters], [0.24]);
  near(rig.where('a.wrist'), at(-0.2, 1.3, -0.4), 1e-9);   // 跟着左手：还在手腕上
  assert.equal(rig.control.layout.panels['a.wrist']?.meters, null);
  rig.press('grab', 'right', false);
  rig.frame();
  assert.deepEqual([o.meters, rig.control.layout.panels['a.wrist']?.meters, rig.panels.panels[0]?.meters], [0.24, 0.24, 0.24]);
  rig.press('grab', 'left', false);
  rig.frame();
  near(rig.control.layout.panels['a.wrist']?.pose ?? [], WORN, 1e-9);
  rig.session.stop();
  t.mock.restoreAll();
  t.mock.timers.reset();

  // 左手按了 0.3 秒就松开：这期间右手挪远了，面板跟着右手，宽度不变
  const quick = worn(t);
  const grip = quick.aim('right', 'a.wrist', 120, 60);
  quick.frame();
  quick.press('grab', 'right', true);
  quick.frame(45);
  quick.press('grab', 'left', true);
  quick.frame(30);
  quick.hand('right', shifted(grip, 0.3, 0, 0));
  quick.frame(3);
  quick.press('grab', 'left', false);
  quick.frame(2);
  assert.deepEqual([quick.panel('a.wrist').meters, quick.control.layout.panels['a.wrist']?.meters, quick.panels.panels[0]?.meters], [0.12, null, 0.12]);
  quick.session.stop();
});

test('双手缩放手上的面板到一半，手柄的姿态无效一帧、抬手才显示的面板转过 50°：不记宽度，再显示时悬浮窗口的宽度是布局里的', t => {
  const rig = worn(t);
  const o = rig.panel('a.wrist');
  const right = rig.aim('right', 'a.wrist', 120, 60);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(45);
  rig.press('grab', 'left', true);
  rig.frame(45);
  rig.hand('right', shifted(LEFT_UP, 2 * (right[3] - LEFT_UP[3]), 2 * (right[7] - LEFT_UP[7]), 2 * (right[11] - LEFT_UP[11])));
  rig.frame();
  near([o.meters], [0.24]);
  rig.vr.losePose(DEVICE.left);
  rig.frame();
  assert.equal(o.visible, false);
  rig.hand('left', LEFT_UP);
  rig.frame();
  assert.deepEqual([o.visible, o.meters, rig.control.layout.panels['a.wrist']?.meters, rig.panels.panels[0]?.meters], [true, 0.12, null, 0.12]);
  rig.press('grab', 'left', false);
  rig.press('grab', 'right', false);
  rig.frame(2);
  assert.deepEqual([o.meters, rig.control.layout.panels['a.wrist']?.meters, rig.stored], [0.12, null, []]);
  rig.session.stop();
  t.mock.restoreAll();
  t.mock.timers.reset();

  // 抬手才显示的：面板在手柄上方 0.1 米，手柄往左挪时面板的法线和它到眼睛的方向夹角是 deg
  const glance = new Rig(t, { list: [WRIST], settings: DIRECT, layout: pinned('a.wrist', { anchor: 'left', glance: true, pose: WORN }) });
  const hold = (deg: number): void => glance.hand('left', at(-0.4 * Math.tan(deg * Math.PI / 180), 1.5, -0.4));
  hold(30);
  glance.session.start();
  glance.frame(2);
  const g = glance.panel('a.wrist');
  const far = glance.aim('right', 'a.wrist', 120, 60);
  glance.frame();
  glance.press('grab', 'right', true);
  glance.frame(45);
  glance.press('grab', 'left', true);
  glance.frame(45);
  glance.hand('right', shifted(far, 0, 0, 0.3));   // 右手退后 0.3 米：两手的距离变了
  glance.frame(2);
  assert.ok(g.visible && g.meters > 0.13, `${g.meters}`);
  hold(55);
  glance.frame(30);                                // 面板平滑地跟着抓着它的左手转过去
  assert.equal(g.visible, false);
  hold(30);
  glance.frame();
  assert.deepEqual([g.visible, g.meters, glance.control.layout.panels['a.wrist']?.meters, glance.panels.panels[0]?.meters], [true, 0.12, null, 0.12]);
  glance.session.stop();
});

test('抓着附着的面板时附着的设备动了，面板留在抓着的手里：头每帧挪 1 厘米、转过身去，左手每帧挪 1 厘米，面板在空间里都不动，每帧只告诉 SteamVR 一次；松手时记下相对设备这一刻的变换', t => {
  const rig = connected(t, { list: [HUD], settings: DIRECT, layout: pinned('a.hud', { anchor: 'head', pose: at(0, -0.2, -0.6) }) });
  rig.frame(2);
  const o = rig.panel('a.hud');
  rig.aim('right', 'a.hud', 200, 100);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(2);
  const start = at(0, 1.4, -0.6);
  near(rig.where('a.hud'), start);
  for (let i = 1; i <= 50; i++) {
    rig.setHead(at(0.01 * i, 1.6, 0));
    const told = rig.count('placeOn', o);
    rig.frame();
    near(rig.where('a.hud'), start, 1e-9);
    assert.equal(rig.count('placeOn', o), told + 1);
  }
  rig.setHead(turned(0.5, 1.6, 0));
  rig.frame();
  near(rig.where('a.hud'), start, 1e-9);
  rig.press('grab', 'right', false);
  rig.frame();
  // 头在 (0.5, 1.6, 0)、朝身后：面板在它的坐标里是右 0.5、下 0.2、身后 0.6 米，朝向也转了 180°
  near(rig.control.layout.panels['a.hud']?.pose ?? [], turned(0.5, -0.2, 0.6), 1e-9);
  rig.setHead(turned(0.5, 1.7, 0));                // 松手以后跟着头走，求交也照头这一刻的姿态算
  rig.aim('right', 'a.hud', 100, 50);
  rig.frame();
  near(rig.where('a.hud'), shifted(start, 0, 0.1, 0), 1e-9);
  assert.deepEqual([rig.page('a.hud').events.at(-1), rig.count('place', o)], ['move 100,50', 0]);
  rig.session.stop();
  t.mock.restoreAll();
  t.mock.timers.reset();

  const wrist = worn(t);
  wrist.aim('right', 'a.wrist', 120, 60);
  wrist.frame();
  wrist.press('grab', 'right', true);
  wrist.frame(45);
  const held = at(-0.2, 1.3, -0.4);
  near(wrist.where('a.wrist'), held);
  for (let i = 1; i <= 30; i++) {
    wrist.hand('left', shifted(LEFT_UP, -0.01 * i, 0, 0));
    wrist.frame();
    near(wrist.where('a.wrist'), held, 1e-9);
  }
  wrist.press('grab', 'right', false);
  wrist.frame();
  near(wrist.control.layout.panels['a.wrist']?.pose ?? [], at(0.3, 0.1, 0), 1e-9);   // 左手在 (-0.5, 1.2, -0.4)
  wrist.session.stop();
});

test('附着的面板自己算位置(attach 选 js)时抓着挪：每帧只设一次绝对位置，不调相对设备的调用', t => {
  const rig = connected(t, { native: false, list: [HUD], settings: DIRECT, layout: pinned('a.hud', { anchor: 'head', pose: at(0, -0.2, -0.6) }) });
  rig.frame(2);
  const o = rig.panel('a.hud');
  const hand = rig.aim('right', 'a.hud', 200, 100);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(2);
  for (let i = 1; i <= 20; i++) {
    rig.setHead(at(0.01 * i, 1.6, 0));
    rig.hand('right', shifted(hand, 0, 0.005 * i, 0));
    const told = rig.count('place', o);
    rig.frame();
    assert.equal(rig.count('place', o), told + 1, `第 ${i} 帧`);
  }
  rig.frame(200);
  near(o.pose, at(0, 1.5, -0.6), 1e-6);            // 跟着右手往上 0.1 米，头挪了不带着它走
  rig.press('grab', 'right', false);
  rig.frame();
  near(rig.control.layout.panels['a.hud']?.pose ?? [], at(-0.2, -0.1, -0.6), 1e-6);   // 头在 (0.2, 1.6, 0)
  assert.deepEqual([rig.args('placeOn').length, o.device], [0, null]);
  rig.session.stop();
});

test('求交改用 SteamVR 的、核对求交都只管留在空间里的面板：附着的面板一律用这里算的姿态，不问 SteamVR', t => {
  for (const hit of [{ check: false, native: true }, { check: true, native: false }]) {
    const rig = new Rig(t, { list: [HUD], hit, layout: pinned('a.hud', { anchor: 'head', pose: at(0, -0.2, -0.6) }) });
    rig.prepare = vr => { vr.hit = () => null; };   // SteamVR 一律说没打中
    rig.session.start();
    rig.frame(2);
    rig.aim('right', 'a.hud', 100, 50);
    rig.frame(3);
    assert.deepEqual([rig.page('a.hud').events.at(-1), rig.args('intersect').length, rig.logs], ['move 100,50', 0, ['steamvr connected']], JSON.stringify(hit));
    rig.session.stop();
    t.mock.restoreAll();
    t.mock.timers.reset();
  }
});

test('抓着附着的面板时它被重置：从默认位置起向手里靠(和留在空间里的面板一样)', t => {
  const rig = connected(t, { list: [HUD], settings: DIRECT, layout: pinned('a.hud', { anchor: 'head', pose: at(0, -0.2, -0.6) }) });
  rig.frame(2);
  rig.aim('right', 'a.hud', 200, 100);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(2);
  void rig.remote.reset(WHO, 'a.hud');
  rig.frame();
  // 头显上的默认位置是眼睛前方 0.45 米、下方 0.25 米；抓着它的手要它留在 (0, 1.4, -0.6)：一帧靠近 K
  near(position(rig.where('a.hud')), [0, 1.35 + 0.05 * K, -0.45 - 0.15 * K], 1e-9);
  rig.frame(200);
  near(position(rig.where('a.hud')), [0, 1.4, -0.6], 1e-6);
  rig.session.stop();
});

test('抓着附着的面板的那只手姿态无效：没有新的姿态给它的那几帧，面板照相对变换跟着设备走，求交也照这个算', t => {
  const rig = connected(t, { list: [HUD], settings: DIRECT, layout: pinned('a.hud', { anchor: 'head', pose: at(0, -0.2, -0.6) }) });
  rig.frame(2);
  rig.aim('right', 'a.hud', 200, 100);
  rig.frame();
  rig.press('grab', 'right', true);
  rig.frame(2);
  rig.hand('right', null);
  rig.frame();
  rig.setHead(at(0.3, 1.6, 0));                    // 头往右 0.3 米：面板(宽 0.3 米)整块离开了抓着它时的位置
  rig.aim('left', 'a.hud', 100, 50);
  rig.frame();
  near(rig.where('a.hud'), at(0.3, 1.4, -0.6), 1e-9);
  assert.equal(rig.page('a.hud').events.at(-1), 'move 100,50');
  rig.session.stop();
});

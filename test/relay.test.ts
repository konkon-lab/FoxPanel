import test from 'node:test';
import assert from 'node:assert/strict';
import { createIpc, type IpcEvent, type IpcHandler } from '../src/main/ipc.ts';
import { ARGS_MAX, CALL_MS, ServiceRelay, type RelayHost } from '../src/main/relay.ts';
import { Senders } from '../src/main/senders.ts';
import type { ToProcess } from '../src/shared/host-protocol.ts';
import { IPC } from '../src/shared/types.ts';

type Invoke = Extract<ToProcess, { t: 'rvInvoke' }>;

// 假的组件进程：记下发给它的消息和回复；runs 里是它加载的组件
interface FakeHost extends RelayHost {
  posted: ToProcess[];
  replies: unknown[][];
  invokes(): Invoke[];                       // 收到的调用
  states(name: string): unknown[];           // 收到的 name 的状态
  actives(): string[];                       // 收到的生效通知(「名字 组件 on / off」)
}

function fakeHost(...components: string[]): FakeHost {
  const posted: ToProcess[] = [];
  const replies: unknown[][] = [];
  return {
    posted, replies,
    post: m => { posted.push(m); },
    reply: (req, value, error) => { replies.push(error === undefined ? [req, value] : [req, value, error]); },
    runs: id => components.includes(id),
    invokes: () => posted.filter(m => m.t === 'rvInvoke'),
    states: name => posted.flatMap(m => (m.t === 'rvState' && m.name === name ? [m.state] : [])),
    actives: () => posted.flatMap(m => (m.t === 'rvActive' ? [`${m.name} ${m.component} ${m.on ? 'on' : 'off'}`] : [])),
  };
}

// 测试里的页面(webContents 的 id)：面板页面的组件够得着 keyboard，媒体页面的够得着 keyboard 和 clock，主窗口不接远程服务
const SHELL = 2;
const MEDIA = 3;
const WINDOW = 1;

interface Rig {
  relay: ServiceRelay;
  senders: Senders;
  order: string[];                           // 开着的组件，按组件顺序
  provides: Record<string, string[]>;        // 组件 id → 清单的 provides
  logs: string[];                            // 写出的日志(「级别 来源: 内容」)
  clock: { now: number };
  pageStates: [number, string, unknown][];   // 发给页面的状态(页面、名字、状态)
  // 以 sender 这个页面的身份调页面一侧的通道
  fire(channel: string, sender: number, ...args: unknown[]): unknown;
}

function rig(): Rig {
  const senders = new Senders();
  senders.add(WINDOW, 'window');
  senders.addPanel(SHELL, 'a.shell', ['a.shell'], ['keyboard']);
  senders.add(MEDIA, 'media', ['a.asr'], ['keyboard', 'clock']);
  const order = ['a.ime', 'b.ime', 'a.clock', 'a.user'];
  const provides: Record<string, string[]> = { 'a.ime': ['keyboard'], 'b.ime': ['keyboard'], 'a.clock': ['clock'] };
  const logs: string[] = [];
  const clock = { now: 1_000_000 };
  const pageStates: [number, string, unknown][] = [];
  const log = (text: string, level = 'info', source = ''): void => { logs.push(`${level} ${source}: ${text}`); };
  const relay = new ServiceRelay({
    providers: name => order.filter(id => provides[id]?.includes(name)),
    senders, log, now: () => clock.now,
    toPage: (id, name, state) => { pageStates.push([id, name, state]); },
  });
  const handlers = new Map<string, IpcHandler>();
  relay.registerIpc(createIpc({
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn), on: (channel, fn) => handlers.set(channel, fn) },
    senders, log, now: () => clock.now,
  }));
  const fire: Rig['fire'] = (channel, sender, ...args) => {
    const fn = handlers.get(channel);
    assert.ok(fn, channel);
    const frame = {};
    const e: IpcEvent = { sender: { id: sender, mainFrame: frame }, senderFrame: frame };
    return fn(e, ...args);
  };
  return { relay, senders, order, provides, logs, clock, pageStates, fire };
}

// 登记成提供方并发布一份状态
function serve(r: Rig, host: FakeHost, component: string, name: string, state: unknown): void {
  r.relay.message({ t: 'rvServe', component, name }, host);
  r.relay.message({ t: 'rvState', component, name, state }, host);
}

test('登记：清单 provides 里没有这个名字、组件关着、组件不在这个进程里，都不登记并写警告', () => {
  const r = rig();
  const host = fakeHost('a.ime', 'a.user', 'c.off');
  const user = fakeHost('a.user');
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: true }, user);
  // provides 里没有 keyboard
  serve(r, host, 'a.user', 'keyboard', { n: 1 });
  // provides 里有，但组件关着(不在开着的组件里)
  r.provides['c.off'] = ['keyboard'];
  serve(r, host, 'c.off', 'keyboard', { n: 2 });
  // 开着、provides 里有，但发消息的进程里没有这个组件
  serve(r, user, 'a.ime', 'keyboard', { n: 3 });
  assert.equal(r.relay.state('keyboard'), null);
  assert.deepEqual(user.states('keyboard'), [null]);
  assert.deepEqual(r.logs, [
    'warn a.user: cannot serve keyboard: the component is off or does not list it in provides',
    'warn c.off: cannot serve keyboard: the component is off or does not list it in provides',
    'warn a.ime: cannot serve keyboard: the component is off or does not list it in provides',
  ]);
  // 没登记上的调不到
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 1, name: 'keyboard', method: 'act', args: [] }, user);
  assert.deepEqual(user.replies, [[1, null, '没有提供 keyboard 的组件']]);
  assert.deepEqual(host.invokes(), []);
  // 合格的登记上
  serve(r, host, 'a.ime', 'keyboard', { n: 4 });
  assert.deepEqual(r.relay.state('keyboard'), { n: 4 });
  assert.equal(r.logs.length, 3);
  // 没登记上的不告诉生效没有，登记上的告诉一次
  assert.deepEqual([host.actives(), user.actives()], [['keyboard a.ime on'], []]);
});

test('生效信号：登记当时告诉一次；排在后面的等着，排最前的关掉、顺序换了时各自收到变化，没变化不重发；撤掉登记后面的不顶上', () => {
  const r = rig();
  const first = fakeHost('a.ime');
  const second = fakeHost('b.ime');
  const user = fakeHost('a.user');
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: true }, user);
  // 排在后面的先登记：等着
  r.relay.message({ t: 'rvServe', component: 'b.ime', name: 'keyboard' }, second);
  assert.deepEqual([second.actives(), first.actives()], [['keyboard b.ime off'], []]);
  // 排最前的登记上：它生效；等着的那个没变化，不重发
  r.relay.message({ t: 'rvServe', component: 'a.ime', name: 'keyboard' }, first);
  assert.deepEqual([first.actives(), second.actives()], [['keyboard a.ime on'], ['keyboard b.ime off']]);
  // 发布状态、订阅、调用都不带来通知
  r.relay.message({ t: 'rvState', component: 'a.ime', name: 'keyboard', state: 1 }, first);
  r.relay.message({ t: 'rvState', component: 'b.ime', name: 'keyboard', state: 2 }, second);
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [] }, user);
  assert.deepEqual([first.actives().length, second.actives().length], [1, 1]);
  // 排最前的组件关掉：它变成等着，后面那个生效
  r.order.splice(r.order.indexOf('a.ime'), 1);
  r.relay.sync();
  assert.deepEqual([first.actives().slice(1), second.actives().slice(1)], [['keyboard a.ime off'], ['keyboard b.ime on']]);
  // 没变化的 sync、重新打开并排到后面：都不重发
  r.relay.sync();
  r.order.push('a.ime');
  r.relay.sync();
  assert.deepEqual([first.actives().length, second.actives().length], [2, 2]);
  // 顺序调回最前：换回来
  r.order.unshift(...r.order.splice(r.order.indexOf('a.ime'), 1));
  r.relay.sync();
  assert.deepEqual([first.actives().slice(2), second.actives().slice(2)], [['keyboard a.ime on'], ['keyboard b.ime off']]);
  // 生效的撤掉登记：这个名字没有提供方，后面的还等着；撤掉的那个不通知
  r.relay.message({ t: 'rvClose', component: 'a.ime', name: 'keyboard' }, first);
  assert.deepEqual([r.relay.state('keyboard'), first.actives().length, second.actives().length], [null, 3, 3]);
  // 再登记：再告诉一次；没撤就再登记一次的也再告诉一次
  r.relay.message({ t: 'rvServe', component: 'a.ime', name: 'keyboard' }, first);
  r.relay.message({ t: 'rvServe', component: 'a.ime', name: 'keyboard' }, first);
  assert.deepEqual([first.actives().slice(3), second.actives().length], [['keyboard a.ime on', 'keyboard a.ime on'], 3]);
  // 等着的撤掉、再登记：还是等着，告诉一次
  r.relay.message({ t: 'rvClose', component: 'b.ime', name: 'keyboard' }, second);
  r.relay.message({ t: 'rvServe', component: 'b.ime', name: 'keyboard' }, second);
  assert.deepEqual([second.actives().slice(3), first.actives().length], [['keyboard b.ime off'], 5]);
  // 订阅方一条通知都收不到
  assert.deepEqual(user.actives(), []);
});

test('生效信号：同一个进程里两个组件登记同一个名字各收各的，变成等着的排在变成生效的前面；只发给登记所在的进程', () => {
  const r = rig();
  const both = fakeHost('a.ime', 'b.ime');
  const other = fakeHost('a.clock');
  const user = fakeHost('a.user');
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: true }, user);
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: true }, other);
  r.relay.message({ t: 'rvServe', component: 'a.clock', name: 'clock' }, other);
  r.relay.message({ t: 'rvServe', component: 'a.ime', name: 'keyboard' }, both);
  r.relay.message({ t: 'rvServe', component: 'b.ime', name: 'keyboard' }, both);
  assert.deepEqual(both.actives(), ['keyboard a.ime on', 'keyboard b.ime off']);
  assert.deepEqual([other.actives(), user.actives()], [['clock a.clock on'], []]);
  // 顺序换了，b.ime 排到最前
  r.order.unshift(...r.order.splice(r.order.indexOf('b.ime'), 1));
  r.relay.sync();
  assert.deepEqual(both.actives().slice(2), ['keyboard a.ime off', 'keyboard b.ime on']);
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [1] }, user);
  assert.deepEqual(both.invokes().map(m => m.component), ['b.ime']);
  // 别的名字的登记、订阅了这个名字的进程都没收到
  assert.deepEqual([other.actives(), user.actives()], [['clock a.clock on'], []]);
  // 生效的那个组件关掉：同一个进程里的另一个接上
  r.order.splice(r.order.indexOf('b.ime'), 1);
  r.relay.sync();
  assert.deepEqual(both.actives().slice(4), ['keyboard b.ime off', 'keyboard a.ime on']);
});

test('生效信号：提供方的进程退出不往它那里发；排最前的提供者的进程退出时后面的还等着，它重启后再登记时告诉一次', () => {
  const r = rig();
  const first = fakeHost('a.ime');
  const second = fakeHost('b.ime');
  r.relay.message({ t: 'rvServe', component: 'a.ime', name: 'keyboard' }, first);
  r.relay.message({ t: 'rvServe', component: 'b.ime', name: 'keyboard' }, second);
  const before = first.posted.length;
  r.relay.hostGone(first);
  assert.deepEqual([first.posted.length, second.actives(), r.relay.state('keyboard')], [before, ['keyboard b.ime off'], null]);
  r.relay.message({ t: 'rvServe', component: 'a.ime', name: 'keyboard' }, first);
  assert.deepEqual([first.actives(), second.actives()], [['keyboard a.ime on', 'keyboard a.ime on'], ['keyboard b.ime off']]);
  // 等着的那个的进程退出：生效的不受影响；它退出期间排最前的组件关掉，这个名字没有提供方，它重启后登记上就生效
  r.relay.hostGone(second);
  assert.equal(first.actives().length, 2);
  r.order.splice(r.order.indexOf('a.ime'), 1);
  r.relay.sync();
  assert.deepEqual(first.actives().slice(2), ['keyboard a.ime off']);
  r.relay.message({ t: 'rvServe', component: 'b.ime', name: 'keyboard' }, second);
  assert.deepEqual(second.actives().slice(1), ['keyboard b.ime on']);
});

test('登记：同名的提供者只有组件顺序最前的开着的那个生效；它停了、关了、顺序换了，后面登记过的接上', () => {
  const r = rig();
  const first = fakeHost('a.ime');
  const second = fakeHost('b.ime');
  const user = fakeHost('a.user');
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: true }, user);
  // 排在后面的先登记：不生效，它的状态订阅方看不到，调用到不了它
  serve(r, second, 'b.ime', 'keyboard', { from: 'b' });
  assert.deepEqual(r.logs, ['warn b.ime: keyboard is served by a.ime; this component takes over when that one stops']);
  assert.equal(r.relay.state('keyboard'), null);
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [1] }, user);
  assert.deepEqual(second.invokes(), []);
  // 排最前的登记上：生效的是它
  serve(r, first, 'a.ime', 'keyboard', { from: 'a' });
  assert.deepEqual(r.relay.state('keyboard'), { from: 'a' });
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [2] }, user);
  assert.deepEqual([first.invokes().map(m => m.args), second.invokes()], [[[2]], []]);
  // 后面那个再发布：订阅方收不到
  r.relay.message({ t: 'rvState', component: 'b.ime', name: 'keyboard', state: { from: 'b2' } }, second);
  assert.deepEqual(user.states('keyboard'), [null, { from: 'a' }]);
  // 排最前的关掉(不在开着的组件里了)：后面那个接上，订阅方收到它最近发布的状态
  r.order.splice(r.order.indexOf('a.ime'), 1);
  r.relay.sync();
  assert.deepEqual(user.states('keyboard'), [null, { from: 'a' }, { from: 'b2' }]);
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [3] }, user);
  assert.deepEqual(second.invokes().map(m => [m.component, m.args]), [['b.ime', [3]]]);
  // 关掉的那个再发布：不算
  r.relay.message({ t: 'rvState', component: 'a.ime', name: 'keyboard', state: { from: 'a2' } }, first);
  assert.deepEqual(r.relay.state('keyboard'), { from: 'b2' });
  // 重新打开并排到后面：生效的还是 b.ime；顺序调回最前：换回 a.ime(它之前登记过，没撤)
  r.order.push('a.ime');
  r.relay.sync();
  assert.deepEqual(r.relay.state('keyboard'), { from: 'b2' });
  r.order.unshift(...r.order.splice(r.order.indexOf('a.ime'), 1));
  r.relay.sync();
  assert.deepEqual(r.relay.state('keyboard'), { from: 'a2' });
  // 生效的撤掉登记：排最前的开着的提供者没登记，这个名字就没有提供方(不让后面的顶上)
  r.relay.message({ t: 'rvClose', component: 'a.ime', name: 'keyboard' }, first);
  assert.equal(r.relay.state('keyboard'), null);
  assert.equal(user.states('keyboard').at(-1), null);
  // 没变化的 sync 不重发
  const before = user.posted.length;
  r.relay.sync();
  assert.equal(user.posted.length, before);
});

test('状态：只发给订阅了这个名字的进程和页面；晚来的订阅时补一份当前的；退订后收不到', () => {
  const r = rig();
  const ime = fakeHost('a.ime', 'a.clock');
  const early = fakeHost('a.user');
  const late = fakeHost('a.user');
  const never = fakeHost('a.user');
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: true }, early);
  r.relay.message({ t: 'rvUse', name: 'clock', on: true }, never);
  assert.equal(r.fire(IPC.relayUse, SHELL, 'keyboard', true), undefined);
  assert.deepEqual([early.states('keyboard'), r.pageStates], [[null], [[SHELL, 'keyboard', null]]]);
  serve(r, ime, 'a.ime', 'keyboard', { text: 'a' });
  r.relay.message({ t: 'rvState', component: 'a.ime', name: 'keyboard', state: { text: 'ab' } }, ime);
  // 晚来的进程和页面：订阅时各补一份当前的
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: true }, late);
  r.fire(IPC.relayUse, MEDIA, 'keyboard', true);
  r.relay.message({ t: 'rvState', component: 'a.ime', name: 'keyboard', state: { text: 'abc' } }, ime);
  assert.deepEqual(early.states('keyboard'), [null, { text: 'a' }, { text: 'ab' }, { text: 'abc' }]);
  assert.deepEqual(late.states('keyboard'), [{ text: 'ab' }, { text: 'abc' }]);
  assert.deepEqual(r.pageStates.filter(([id]) => id === SHELL).map(([, , s]) => s), [null, { text: 'a' }, { text: 'ab' }, { text: 'abc' }]);
  assert.deepEqual(r.pageStates.filter(([id]) => id === MEDIA), [[MEDIA, 'keyboard', { text: 'ab' }], [MEDIA, 'keyboard', { text: 'abc' }]]);
  // 没订阅 keyboard 的进程、提供方自己所在的进程都收不到；别的名字的状态各走各的
  assert.deepEqual([never.states('keyboard'), ime.states('keyboard')], [[], []]);
  serve(r, ime, 'a.clock', 'clock', '12:00');
  assert.deepEqual([never.states('clock'), early.states('clock'), late.states('clock')], [[null, '12:00'], [], []]);
  assert.equal(r.pageStates.filter(([, name]) => name === 'clock').length, 0);
  // 退订：进程和页面都收不到
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: false }, early);
  r.fire(IPC.relayUse, SHELL, 'keyboard', false);
  const pages = r.pageStates.length;
  r.relay.message({ t: 'rvState', component: 'a.ime', name: 'keyboard', state: { text: '' } }, ime);
  assert.equal(early.states('keyboard').length, 4);
  assert.deepEqual(late.states('keyboard').at(-1), { text: '' });
  assert.deepEqual(r.pageStates.slice(pages), [[MEDIA, 'keyboard', { text: '' }]]);
});

test('页面：够不着这一页的组件没在清单里写的远程服务；主窗口和没登记的窗口都用不了；页面关了、换了加载列表后不给它发', async () => {
  const r = rig();
  const host = fakeHost('a.ime', 'a.clock');
  serve(r, host, 'a.ime', 'keyboard', { text: 'k' });
  serve(r, host, 'a.clock', 'clock', '12:00');
  // 面板页面的组件只写了 keyboard：订阅和调用 clock 都被拒，clock 的提供方收不到调用
  assert.throws(() => r.fire(IPC.relayUse, SHELL, 'clock', true), /不允许调用/);
  assert.throws(() => r.fire(IPC.relayCall, SHELL, 'clock', 'set', ['13:00'], true), /不允许调用/);
  assert.throws(() => r.fire(IPC.relayCall, SHELL, 'clock', 'set', ['13:00'], false), /不允许调用/);
  // 名字不是字符串、主窗口、没登记的窗口
  assert.throws(() => r.fire(IPC.relayUse, SHELL, ['keyboard'], true), /不允许调用/);
  assert.throws(() => r.fire(IPC.relayUse, WINDOW, 'keyboard', true), /不允许调用/);
  assert.throws(() => r.fire(IPC.relayCall, WINDOW, 'keyboard', 'act', [], false), /不允许调用/);
  assert.throws(() => r.fire(IPC.relayCall, 9, 'keyboard', 'act', [], false), /不允许调用/);
  assert.deepEqual([host.invokes(), r.pageStates], [[], []]);
  assert.deepEqual(r.logs.filter(l => l.includes('refused')), [
    `warn : ipc ${IPC.relayUse} refused: remote service is not declared by a component loaded on the panel page`,
    `warn : ipc ${IPC.relayCall} refused: remote service is not declared by a component loaded on the panel page`,
    `warn : ipc ${IPC.relayUse} refused: sender window is not allowed`,
    `warn : ipc ${IPC.relayCall} refused: sender window is not allowed`,
    `warn : ipc ${IPC.relayCall} refused: sender unknown is not allowed`,
  ]);
  // 媒体页面的组件写了 clock：能订阅、能调
  r.fire(IPC.relayUse, MEDIA, 'clock', true);
  r.fire(IPC.relayUse, SHELL, 'keyboard', true);
  assert.deepEqual(r.pageStates, [[MEDIA, 'clock', '12:00'], [SHELL, 'keyboard', { text: 'k' }]]);
  const asked = r.fire(IPC.relayCall, MEDIA, 'clock', 'set', ['13:00'], true);
  const sent = host.invokes().at(-1);
  assert.deepEqual([sent?.name, sent?.component, sent?.method, sent?.args], ['clock', 'a.clock', 'set', ['13:00']]);
  r.relay.message({ t: 'rvResult', req: sent?.req ?? -1, value: 'ok' }, host);
  assert.equal(await asked, 'ok');
  // 媒体页面换了加载列表，新的组件够不着 clock：订阅过也不给它发；面板页面关了：不给它发
  r.senders.loadMedia(['a.tts'], ['keyboard']);
  r.senders.remove(SHELL);
  const before = r.pageStates.length;
  r.relay.message({ t: 'rvState', component: 'a.clock', name: 'clock', state: '13:00' }, host);
  r.relay.message({ t: 'rvState', component: 'a.ime', name: 'keyboard', state: { text: 'k2' } }, host);
  assert.equal(r.pageStates.length, before);
  // 之后同一个 id 的新页面没订阅过，也收不到
  r.senders.addPanel(SHELL, 'a.shell', ['a.shell'], ['keyboard']);
  r.relay.message({ t: 'rvState', component: 'a.ime', name: 'keyboard', state: { text: 'k3' } }, host);
  assert.equal(r.pageStates.length, before);
});

test('调用：带上核心填的调用者；带 req 的等提供方回结果，结果和错误各回给发起方', async () => {
  const r = rig();
  const ime = fakeHost('a.ime');
  const user = fakeHost('a.user', 'a.other');
  serve(r, ime, 'a.ime', 'keyboard', {});
  // 组件进程发的：调用者是发消息的组件和 process
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 7, name: 'keyboard', method: 'insert', args: ['hi', { deep: [1] }] }, user);
  r.relay.message({ t: 'rvCall', component: 'a.other', req: 8, name: 'keyboard', method: 'boom', args: [] }, user);
  // 页面发的：面板页面的调用者是面板 id，媒体页面的分不出是哪个组件
  const fromPage = r.fire(IPC.relayCall, SHELL, 'keyboard', 'act', [{ kind: 'send' }], true);
  const fromMedia = assert.rejects(r.fire(IPC.relayCall, MEDIA, 'keyboard', 'dictated', ['x', true], true) as Promise<unknown>, /not a dictation source/);
  const [a, b, c, d] = ime.invokes();
  assert.deepEqual([a, b, c, d].map(m => m?.caller), [
    { component: 'a.user', where: 'process' }, { component: 'a.other', where: 'process' },
    { component: 'a.shell', where: 'panel' }, { component: '', where: 'media' },
  ]);
  assert.deepEqual(a, { t: 'rvInvoke', req: a?.req, name: 'keyboard', component: 'a.ime', method: 'insert', args: ['hi', { deep: [1] }], caller: { component: 'a.user', where: 'process' } });
  assert.equal(new Set([a, b, c, d].map(m => m?.req)).size, 4);
  // 提供方回结果：按请求号各回各的，回的顺序不必和调用的顺序一样
  r.relay.message({ t: 'rvResult', req: d?.req ?? -1, error: 'not a dictation source' }, ime);
  r.relay.message({ t: 'rvResult', req: b?.req ?? -1, error: 'no such method' }, ime);
  r.relay.message({ t: 'rvResult', req: a?.req ?? -1, value: { ok: true } }, ime);
  r.relay.message({ t: 'rvResult', req: c?.req ?? -1 }, ime);
  assert.deepEqual(user.replies, [[8, null, 'no such method'], [7, { ok: true }]]);
  assert.equal(await fromPage, undefined);
  await fromMedia;
  // 同一个请求号再回一次、别的进程冒充提供方回：都不算
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 9, name: 'keyboard', method: 'insert', args: [] }, user);
  const again = ime.invokes().at(-1);
  r.relay.message({ t: 'rvResult', req: a?.req ?? -1, value: 'twice' }, ime);
  r.relay.message({ t: 'rvResult', req: again?.req ?? -1, value: 'forged' }, user);
  assert.equal(user.replies.length, 2);
  r.relay.message({ t: 'rvResult', req: again?.req ?? -1, value: 'real' }, ime);
  assert.deepEqual(user.replies.at(-1), [9, 'real']);
  // 发调用的组件不在发消息的进程里：不转，按失败回
  r.relay.message({ t: 'rvCall', component: 'a.ime', req: 10, name: 'keyboard', method: 'insert', args: [] }, user);
  assert.deepEqual(user.replies.at(-1), [10, null, '参数不对']);
  // 参数不是数组、方法名不是字符串(进程消息不可信)
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 11, name: 'keyboard', method: 'insert', args: 'x' as unknown as unknown[] }, user);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 12, name: 'keyboard', method: 5 as unknown as string, args: [] }, user);
  assert.deepEqual(user.replies.slice(-2), [[11, null, '参数不对'], [12, null, '参数不对']]);
  assert.equal(ime.invokes().length, 5);
});

test('超时：15 秒没回的调用按失败回，之后才到的结果不算；按时回了的不超时', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig();
  const ime = fakeHost('a.ime');
  const user = fakeHost('a.user');
  serve(r, ime, 'a.ime', 'keyboard', {});
  assert.equal(CALL_MS, 15_000);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 1, name: 'keyboard', method: 'slow', args: [] }, user);
  const fromPage = r.fire(IPC.relayCall, SHELL, 'keyboard', 'slow', [], true) as Promise<unknown>;
  const rejected = assert.rejects(fromPage, /调用 keyboard\.slow 超时/);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 2, name: 'keyboard', method: 'quick', args: [] }, user);
  const [slow, , quick] = ime.invokes();
  t.mock.timers.tick(CALL_MS - 1);
  r.relay.message({ t: 'rvResult', req: quick?.req ?? -1, value: 'done' }, ime);
  assert.deepEqual(user.replies, [[2, 'done']]);
  t.mock.timers.tick(1);
  assert.deepEqual(user.replies, [[2, 'done'], [1, null, '调用 keyboard.slow 超时']]);
  await rejected;
  // 超时之后才到的结果、过了很久：都不回
  r.relay.message({ t: 'rvResult', req: slow?.req ?? -1, value: 'late' }, ime);
  t.mock.timers.tick(CALL_MS * 4);
  assert.equal(user.replies.length, 2);
});

test('参数过大：存成 JSON 超过 64 KB 的调用不转给提供方，带 req 的按失败回，并写警告(同一个调用方 10 秒一次)', async t => {
  // 没超的那个调用没人回：不让它的超时计时拖住测试
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig();
  const ime = fakeHost('a.ime');
  const user = fakeHost('a.user');
  serve(r, ime, 'a.ime', 'keyboard', {});
  assert.equal(ARGS_MAX, 64 * 1024);
  // ["…"] 一共 ARGS_MAX 字节：刚好不超过
  const fits = 'x'.repeat(ARGS_MAX - 4);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 1, name: 'keyboard', method: 'insert', args: [fits] }, user);
  assert.equal(ime.invokes().length, 1);
  // 多一个字节；按字节算，不按字符数
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 2, name: 'keyboard', method: 'insert', args: [`${fits}x`] }, user);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 3, name: 'keyboard', method: 'insert', args: ['字'.repeat(ARGS_MAX / 3)] }, user);
  // 不等结果的、二进制缓冲、类型数组(按字节数，不按元素个数)
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'insert', args: [`${fits}x`] }, user);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 4, name: 'keyboard', method: 'insert', args: [new ArrayBuffer(ARGS_MAX)] }, user);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 5, name: 'keyboard', method: 'insert', args: [new Uint32Array(ARGS_MAX / 4)] }, user);
  assert.equal(ime.invokes().length, 1);
  assert.deepEqual(user.replies, [2, 3, 4, 5].map(req => [req, null, '参数超过 64 KB']));
  assert.deepEqual(r.logs, ['warn a.user: call to keyboard refused: arguments are over 64 KB']);
  // 页面发的同样拒绝
  await assert.rejects(r.fire(IPC.relayCall, SHELL, 'keyboard', 'insert', [`${fits}x`], true) as Promise<unknown>, /参数超过 64 KB/);
  assert.equal(r.fire(IPC.relayCall, SHELL, 'keyboard', 'insert', [`${fits}x`], false), undefined);
  assert.deepEqual(r.logs.slice(1), ['warn a.shell: call to keyboard refused: arguments are over 64 KB']);
  // 10 秒后同一个调用方再超：再写一行
  r.clock.now += 9_999;
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'insert', args: [`${fits}x`] }, user);
  assert.equal(r.logs.length, 2);
  r.clock.now += 1;
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'insert', args: [`${fits}x`] }, user);
  assert.equal(r.logs.length, 3);
  // BigInt 按十进制数字算大小；类型数组按字节数算：不超的照转
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'insert', args: [123n] }, user);
  assert.deepEqual(ime.invokes().at(-1)?.args, [123n]);
  const bytes = new Uint8Array(ARGS_MAX - 8);
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'insert', args: [bytes] }, user);
  assert.equal(ime.invokes().at(-1)?.args[0], bytes);
  assert.equal(ime.invokes().length, 3);
});

test('参数里有普通数据以外的值(Map、Set、Error、正则、循环引用，单独的或嵌在对象里的)：算不出大小，不转给提供方', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig();
  const ime = fakeHost('a.ime');
  const user = fakeHost('a.user');
  serve(r, ime, 'a.ime', 'keyboard', {});
  const big = 'x'.repeat(8 * 1024 * 1024);
  const loop: unknown[] = [];
  loop.push(loop);
  const cases: unknown[][] = [
    [new Map([[1, big]])],
    [new Set([big])],
    [Object.assign(new Error('e'), { pad: big })],
    [/x/],
    [{ kind: 'text', text: 'a', pad: new Map([[1, big]]) }],
    [[{ deep: [new Set()] }]],
    loop,
  ];
  cases.forEach((args, i) => r.relay.message({ t: 'rvCall', component: 'a.user', req: i + 1, name: 'keyboard', method: 'act', args }, user));
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [new Map()] }, user);
  assert.deepEqual(ime.invokes(), []);
  assert.deepEqual(user.replies, cases.map((_args, i) => [i + 1, null, '参数里有普通数据以外的值']));
  assert.deepEqual(r.logs, ['warn a.user: call to keyboard refused: arguments hold something other than plain data']);
  // 页面发的同样拒绝
  await assert.rejects(r.fire(IPC.relayCall, SHELL, 'keyboard', 'act', [new Map([[1, big]])], true) as Promise<unknown>, /普通数据以外/);
  assert.equal(r.fire(IPC.relayCall, SHELL, 'keyboard', 'act', [{ kind: 'text', text: 'a', pad: new Set([big]) }], false), undefined);
  assert.deepEqual(ime.invokes(), []);
  // 普通对象、没有原型的对象、数组、null、日期(存成字符串)照转
  const plain = [{ a: [1, 'x', null, true] }, Object.assign(Object.create(null) as object, { b: 2 }), new Date(0)];
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: plain }, user);
  assert.equal(ime.invokes().length, 1);
  assert.equal(ime.invokes()[0]?.args, plain);
});

test('方法名：只收字母、数字、下划线、$ 组成、不以数字开头、最长 64 个字符的；别的不转给提供方，带 req 的按失败回，并写警告(同一个调用方 10 秒一次)', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig();
  const ime = fakeHost('a.ime');
  const user = fakeHost('a.user');
  serve(r, ime, 'a.ime', 'keyboard', {});
  const bad = ['', '1st', 'a b', 'a.b', 'act\n12:00:00 [E] a.ime forged', 'x'.repeat(65), 'x'.repeat(8 * 1024 * 1024), '方法'];
  bad.forEach((method, i) => r.relay.message({ t: 'rvCall', component: 'a.user', req: i + 1, name: 'keyboard', method, args: [] }, user));
  for (const method of bad) r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method, args: [] }, user);
  assert.deepEqual(ime.invokes(), []);
  assert.deepEqual(user.replies, bad.map((_m, i) => [i + 1, null, '参数不对']));
  assert.deepEqual(r.logs, ['warn a.user: call to keyboard refused: bad method name']);
  // 页面发的同样拒绝；日志里没有方法名
  await assert.rejects(r.fire(IPC.relayCall, SHELL, 'keyboard', 'x'.repeat(1_000_000), [], true) as Promise<unknown>, /参数不对/);
  for (let i = 0; i < 100; i++) assert.equal(r.fire(IPC.relayCall, SHELL, 'keyboard', `no such ${i}`, [], false), undefined);
  assert.deepEqual(r.logs.slice(1), ['warn a.shell: call to keyboard refused: bad method name']);
  assert.deepEqual(ime.invokes(), []);
  // 合格的照转
  const good = ['act', '_a', '$', 'a1_$', 'x'.repeat(64)];
  for (const method of good) r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method, args: [] }, user);
  assert.deepEqual(ime.invokes().map(m => m.method), good);
});

test('提供方进程退出：状态变 null 并通知订阅方，等它回结果的调用按失败回；它的订阅也清掉；重新登记后照常', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig();
  const ime = fakeHost('a.ime');
  const clock = fakeHost('a.clock');
  const user = fakeHost('a.user');
  serve(r, ime, 'a.ime', 'keyboard', { text: 'a' });
  serve(r, clock, 'a.clock', 'clock', '12:00');
  r.relay.message({ t: 'rvUse', name: 'keyboard', on: true }, user);
  r.relay.message({ t: 'rvUse', name: 'clock', on: true }, user);
  r.relay.message({ t: 'rvUse', name: 'clock', on: true }, ime);
  r.fire(IPC.relayUse, SHELL, 'keyboard', true);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 1, name: 'keyboard', method: 'slow', args: [] }, user);
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 2, name: 'clock', method: 'slow', args: [] }, user);
  const fromPage = r.fire(IPC.relayCall, SHELL, 'keyboard', 'slow', [], true) as Promise<unknown>;
  const rejected = assert.rejects(fromPage, /提供 keyboard 的组件停了/);
  r.relay.hostGone(ime);
  // keyboard：状态变 null，发给订阅的进程和页面；等着的两个调用按失败回。clock 不受影响
  assert.equal(r.relay.state('keyboard'), null);
  assert.deepEqual(user.states('keyboard'), [{ text: 'a' }, null]);
  assert.deepEqual(r.pageStates, [[SHELL, 'keyboard', { text: 'a' }], [SHELL, 'keyboard', null]]);
  assert.deepEqual(user.replies, [[1, null, '提供 keyboard 的组件停了']]);
  await rejected;
  assert.deepEqual(r.relay.state('clock'), '12:00');
  // 之后的调用：带 req 的按失败回，不带的丢掉
  r.relay.message({ t: 'rvCall', component: 'a.user', req: 3, name: 'keyboard', method: 'act', args: [] }, user);
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [] }, user);
  assert.deepEqual(user.replies.at(-1), [3, null, '没有提供 keyboard 的组件']);
  // 退出的进程订阅过 clock：不给它发
  const before = ime.posted.length;
  r.relay.message({ t: 'rvState', component: 'a.clock', name: 'clock', state: '12:01' }, clock);
  assert.equal(ime.posted.length, before);
  assert.deepEqual(user.states('clock'), ['12:00', '12:01']);
  // 失败回过的调用到了超时时间不回第二次；clock 的那个调用还等着
  t.mock.timers.tick(CALL_MS);
  assert.deepEqual(user.replies.slice(1), [[3, null, '没有提供 keyboard 的组件'], [2, null, '调用 clock.slow 超时']]);
  // 进程重启后重新登记、发布：订阅方收到新状态，调用到新的登记
  serve(r, ime, 'a.ime', 'keyboard', { text: '' });
  assert.deepEqual(user.states('keyboard').at(-1), { text: '' });
  assert.deepEqual(r.pageStates.at(-1), [SHELL, 'keyboard', { text: '' }]);
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: ['again'] }, user);
  assert.deepEqual(ime.invokes().at(-1)?.args, ['again']);
});

test('不等结果的调用：交给核心就完，按发出的先后送到提供方，不占请求号、不超时；和等结果的调用混着发也保序', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = rig();
  const ime = fakeHost('a.ime');
  const user = fakeHost('a.user');
  serve(r, ime, 'a.ime', 'keyboard', {});
  for (let i = 0; i < 20; i++) {
    if (i % 5 === 0) r.relay.message({ t: 'rvCall', component: 'a.user', req: 100 + i, name: 'keyboard', method: 'act', args: [i] }, user);
    else if (i % 2) r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [i] }, user);
    else assert.equal(r.fire(IPC.relayCall, SHELL, 'keyboard', 'act', [i], false), undefined);
  }
  const got = ime.invokes();
  assert.deepEqual(got.map(m => m.args[0]), Array.from({ length: 20 }, (_, i) => i));
  // 不等结果的不带 req，等结果的各有一个
  assert.deepEqual(got.map(m => m.req !== undefined), Array.from({ length: 20 }, (_, i) => i % 5 === 0));
  assert.ok(got.every(m => m.req !== undefined || !('req' in m)));
  // 过了超时时间：只有等结果的四个按超时回
  t.mock.timers.tick(CALL_MS);
  assert.deepEqual(user.replies.map(x => x[0]), [100, 105, 110, 115]);
  // 没有提供方时：不等结果的丢掉，什么都不回
  r.relay.hostGone(ime);
  const before = user.replies.length;
  r.relay.message({ t: 'rvCall', component: 'a.user', name: 'keyboard', method: 'act', args: [0] }, user);
  assert.equal(r.fire(IPC.relayCall, SHELL, 'keyboard', 'act', [0], false), undefined);
  assert.equal(user.replies.length, before);
});

test('面板页面发的调用：调用者带上面板 id 和 panel；够不着的名字到不了这里就被拒', async () => {
  const r = rig();
  const PANEL = 7;
  r.senders.addPanel(PANEL, 'a.kb', ['a.kb', 'a.side'], ['keyboard']);
  const ime = fakeHost('a.ime');
  serve(r, ime, 'a.ime', 'keyboard', { text: '' });
  // 订阅：当前状态发给这一页
  await r.fire(IPC.relayUse, PANEL, 'keyboard', true);
  assert.deepEqual(r.pageStates, [[PANEL, 'keyboard', { text: '' }]]);
  // 不等结果和等结果的调用
  assert.equal(r.fire(IPC.relayCall, PANEL, 'keyboard', 'act', [{ kind: 'send' }], false), undefined);
  const waited = r.fire(IPC.relayCall, PANEL, 'keyboard', 'insert', ['hi'], true) as Promise<unknown>;
  const [told, asked] = ime.invokes();
  assert.deepEqual(told, { t: 'rvInvoke', name: 'keyboard', component: 'a.ime', method: 'act', args: [{ kind: 'send' }], caller: { component: 'a.kb', where: 'panel' } });
  assert.deepEqual(asked?.caller, { component: 'a.kb', where: 'panel' });
  r.relay.message({ t: 'rvResult', req: asked?.req ?? -1, value: 2 }, ime);
  assert.equal(await waited, 2);
  // 这一页的组件没写的名字
  assert.throws(() => r.fire(IPC.relayCall, PANEL, 'clock', 'now', [], false), /不允许调用/);
  assert.throws(() => r.fire(IPC.relayUse, PANEL, 'clock', true), /不允许调用/);
  // 面板的计划变了、够不着了：之后的状态不发给它
  r.senders.addPanel(PANEL, 'a.kb', ['a.kb'], []);
  r.relay.message({ t: 'rvState', component: 'a.ime', name: 'keyboard', state: { text: 'x' } }, ime);
  assert.equal(r.pageStates.length, 1);
});

test('核心替页面发的调用(tell)：不等结果，带上给定的调用者；没有提供方时丢掉，方法名和参数照样检查', () => {
  const r = rig();
  const caller = { component: 'a.clock', where: 'panel' as const };
  // 没有提供方：丢掉，不出错
  r.relay.tell('panels', 'open', ['a.clock', false], caller);
  r.provides['a.vr'] = ['panels'];
  r.order.push('a.vr');
  const vr = fakeHost('a.vr');
  serve(r, vr, 'a.vr', 'panels', {});
  r.relay.tell('panels', 'open', ['a.clock', false], caller);
  assert.deepEqual(vr.invokes(), [{ t: 'rvInvoke', name: 'panels', component: 'a.vr', method: 'open', args: ['a.clock', false], caller }]);
  r.relay.tell('panels', 'bad name', [], caller);
  r.relay.tell('panels', 'open', [new Map()], caller);
  assert.equal(vr.invokes().length, 1);
  assert.deepEqual(r.logs.filter(l => l.startsWith('warn a.clock:')), [
    'warn a.clock: call to panels refused: bad method name',
    'warn a.clock: call to panels refused: arguments hold something other than plain data',
  ]);
});

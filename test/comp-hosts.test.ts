import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { electron, resetElectron, type FakeProcess } from './comp-helpers.ts';
import type { ComponentHost } from '../src/main/components/host.ts';
import type { HostsComponent } from '../src/main/components/hosts.ts';
import { ComponentStorage } from '../src/main/components/storage.ts';
import type { AppInfo, AppRequest, FromProcess, PanelRequest, RelayRequest } from '../src/shared/host-protocol.ts';
import type { PanelInfo } from '../src/shared/types.ts';

// host.ts 导入 electron：在假接口装好之后加载
const { ComponentHosts } = await import('../src/main/components/hosts.ts');

const comp = (id: string, own = false): HostsComponent => ({ id, file: `${id}.js`, mtime: 0, config: {}, own });
const say = (p: FakeProcess | undefined, m: FromProcess): void => void p?.emit('message', m);
const kinds = (p: FakeProcess | undefined): unknown[] => (p?.sent ?? []).map(m => (m as { t: string }).t);

interface Rig {
  hosts: InstanceType<typeof ComponentHosts>;
  changed(): number;              // deps.changed 被调了几次
  gone: ComponentHost[];          // deps.gone 收到的进程
  bus: [string, unknown][];       // 转给页面的总线消息
  relay: [RelayRequest, ComponentHost][];     // deps.relay 收到的消息和发它的进程
  requests: [AppRequest, ComponentHost][];    // deps.request 收到的消息和发它的进程
  panels: [PanelRequest, ComponentHost][];    // deps.panels 收到的消息和发它的进程
}

// 进程启动时带给它的应用信息
const INFO: AppInfo = { version: '1.2.3', packaged: false, locale: 'ja', components: [], outputs: [], inputs: [], canDictate: false };

// 进程启动时带给它的面板目录
const CLOCK: PanelInfo = {
  id: 'a.clock', name: 'Clock', width: 480, height: 200, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2,
  anchor: 'world', spawn: 'front', glance: false, keep: false,
};
const PANELS: PanelInfo[] = [CLOCK];

function rig(t: TestContext): Rig {
  resetElectron();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-hosts-'));
  let changed = 0;
  const gone: ComponentHost[] = [];
  const bus: [string, unknown][] = [];
  const relay: Rig['relay'] = [];
  const requests: Rig['requests'] = [];
  const panels: Rig['panels'] = [];
  const hosts = new ComponentHosts({
    file: 'component-host.js', shared: {}, dataDir: dir, appDir: dir, storage: new ComponentStorage(dir), log: () => undefined,
    logs: () => [], panels: (m, h) => panels.push([m, h]), panelList: () => PANELS,
    bus: (channel, data) => bus.push([channel, data]), changed: () => { changed++; }, gone: h => gone.push(h),
    info: () => INFO, relay: (m, h) => relay.push([m, h]), request: (m, h) => requests.push([m, h]),
  });
  t.after(() => {
    hosts.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { hosts, changed: () => changed, gone, bus, relay, requests, panels };
}

test('分进程：共用进程和 process: own 的各一个；计划里没有的独立进程停掉并通知，它注册的输出和听写不算在内', t => {
  const r = rig(t);
  r.hosts.load([comp('a.x'), comp('a.own', true)]);
  const [shared, own] = electron.forked;
  assert.deepEqual(electron.forked.map(p => p.name), ['FoxPanel 组件', 'FoxPanel a.own']);
  assert.deepEqual([kinds(shared), kinds(own)], [['load', 'logs'], ['load', 'logs']]);
  assert.equal(r.hosts.status, 'running');
  say(own, { t: 'outputs', outputs: [{ id: 'a.own', live: true, typing: true }], inputs: ['a.own'], translator: true });
  say(own, { t: 'status', id: 'a.own', item: { text: 'ok' } });
  assert.deepEqual([r.hosts.outputs.map(o => o.id), r.hosts.inputs, r.hosts.translator, r.hosts.hasTyping(['a.own'])], [['a.own'], ['a.own'], true, true]);

  const before = r.changed();
  r.hosts.load([comp('a.x')]);
  assert.equal(own?.killed, true);
  assert.equal(shared?.killed, false);
  assert.equal(r.changed(), before + 1);
  assert.equal(r.gone.length, 1);
  assert.deepEqual([r.hosts.outputs, r.hosts.inputs, r.hosts.translator, [...r.hosts.items]], [[], [], false, []]);
  // 停掉的进程退出：不算崩溃，不重启
  own?.emit('exit', 0);
  assert.deepEqual([electron.forked.length, r.hosts.status, r.gone.length], [2, 'running', 1]);
  // 计划没变：不通知
  r.hosts.load([comp('a.x')]);
  assert.equal(r.changed(), before + 1);
});

test('崩溃：清掉进程注册的东西、等着的翻译按失败处理，1 秒后重启；1 分钟内第 3 次停下，等手动重启', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const r = rig(t);
  r.hosts.load([comp('a.x')]);
  const first = electron.forked[0];
  say(first, { t: 'outputs', outputs: [{ id: 'a.x', live: false, typing: false }], inputs: [], translator: true });
  say(first, { t: 'loaded', id: 'a.x', error: 'boom' });
  assert.equal(r.hosts.errors.get('a.x'), 'boom');
  const translating = assert.rejects(r.hosts.translate('hi'), /已退出/);
  first?.emit('exit', 1);
  await translating;
  assert.deepEqual([r.hosts.status, r.hosts.outputs, r.hosts.translator, r.gone.length], ['restarting', [], false, 1]);
  assert.equal(r.hosts.errors.get('a.x'), 'boom');
  t.mock.timers.tick(999);
  assert.equal(electron.forked.length, 1);
  t.mock.timers.tick(1);
  assert.deepEqual([electron.forked.length, r.hosts.status], [2, 'running']);
  electron.forked[1]?.emit('exit', 1);
  t.mock.timers.tick(1000);
  assert.equal(electron.forked.length, 3);
  electron.forked[2]?.emit('exit', 1);
  assert.equal(r.hosts.status, 'crashed');
  t.mock.timers.tick(60_000);
  assert.equal(electron.forked.length, 3);
  // 同样的计划再来一次：停着的不自己起来
  r.hosts.load([comp('a.x')]);
  assert.equal(electron.forked.length, 3);
  r.hosts.restart();
  assert.deepEqual([electron.forked.length, r.hosts.status, r.hosts.errors.size], [4, 'running', 0]);
});

test('组件数据的请求：结果和错误都回 reply', t => {
  const r = rig(t);
  r.hosts.load([comp('a.x')]);
  const p = electron.forked[0];
  say(p, { t: 'storage', id: 'a.x', req: 1, call: { op: 'set', key: 'k', value: 1 } });
  say(p, { t: 'storage', id: 'a.x', req: 2, call: { op: 'get', key: 'k' } });
  // 组件进程发来的操作不认识
  p?.emit('message', { t: 'storage', id: 'a.x', req: 3, call: { op: 'clear', key: 'k' } });
  say(p, { t: 'storage', id: '../x', req: 4, call: { op: 'get', key: 'k' } });
  assert.deepEqual(p?.sent.slice(2), [
    { t: 'reply', req: 1, value: null },
    { t: 'reply', req: 2, value: 1 },
    { t: 'reply', req: 3, value: null, error: '操作不对' },
    { t: 'reply', req: 4, value: null, error: '组件 id 不对' },
  ]);
});

test('只有一个进程接了听写时交给它，停止交给开始的那个；一个进程发的总线消息转给别的进程和页面', t => {
  const r = rig(t);
  r.hosts.load([comp('a.x'), comp('a.own', true)]);
  const [shared, own] = electron.forked;
  r.hosts.dictate(true);
  assert.ok(!kinds(shared).includes('dictate') && !kinds(own).includes('dictate'));
  say(own, { t: 'outputs', outputs: [], inputs: ['a.own'], translator: false });
  r.hosts.dictate(true);
  r.hosts.dictate(false);
  r.hosts.dictate(false);
  assert.deepEqual(own?.sent.slice(2), [{ t: 'dictate', on: true }, { t: 'dictate', on: false }]);
  assert.ok(!kinds(shared).includes('dictate'));
  say(shared, { t: 'bus', channel: 'c', data: 1 });
  assert.deepEqual(own?.sent.at(-1), { t: 'bus', channel: 'c', data: 1 });
  assert.ok(!kinds(shared).includes('bus'));
  assert.deepEqual(r.bus, [['c', 1]]);
});

test('几个进程都接了听写：交给组件顺序最前的输入源所在的进程，不看进程的先后', t => {
  const r = rig(t);
  r.hosts.load([comp('a.own', true), comp('a.x'), comp('a.y')]);
  const [shared, own] = electron.forked;
  assert.deepEqual(electron.forked.map(p => p.name), ['FoxPanel 组件', 'FoxPanel a.own']);
  say(shared, { t: 'outputs', outputs: [], inputs: ['a.x', 'a.y'], translator: false });
  say(own, { t: 'outputs', outputs: [], inputs: ['a.own'], translator: false });
  r.hosts.dictate(true);
  r.hosts.dictate(false);
  assert.deepEqual(own?.sent.slice(2), [{ t: 'dictate', on: true }, { t: 'dictate', on: false }]);
  assert.ok(!kinds(shared).includes('dictate'));
  // 组件顺序变了(各进程里的组件没变)：共用进程的输入源排到前面
  r.hosts.load([comp('a.x'), comp('a.own', true), comp('a.y')]);
  r.hosts.dictate(true);
  r.hosts.dictate(false);
  assert.deepEqual(shared?.sent.slice(2), [{ t: 'dictate', on: true }, { t: 'dictate', on: false }]);
  assert.equal(own?.sent.length, 4);
  // 排在最前的输入源没接听写：往后找
  say(shared, { t: 'outputs', outputs: [], inputs: ['a.y'], translator: false });
  r.hosts.dictate(true);
  assert.deepEqual(own?.sent.at(-1), { t: 'dictate', on: true });
  assert.equal(shared?.sent.length, 4);
});

test('应用信息和面板目录：进程启动时在 load 里带上，之后变了发给全部进程；load 里只有组件、应用信息、面板目录、共用模块和两个目录', t => {
  const r = rig(t);
  r.hosts.load([comp('a.x'), comp('a.own', true)]);
  const [shared, own] = electron.forked;
  for (const p of [shared, own]) {
    const load = p?.sent[0] as { t: string; info: AppInfo; panels: PanelInfo[] };
    assert.deepEqual(load.info, INFO);
    assert.deepEqual(load.panels, PANELS);
    assert.deepEqual(Object.keys(load).sort(), ['appDir', 'components', 'dataDir', 'info', 'panels', 'shared', 't']);
  }
  const next: AppInfo = { ...INFO, locale: 'en', canDictate: true, inputs: ['a.own'] };
  r.hosts.info(next);
  assert.deepEqual([shared?.sent.at(-1), own?.sent.at(-1)], [{ t: 'info', info: next }, { t: 'info', info: next }]);
  const list = [CLOCK, { ...CLOCK, id: 'a.notes' }];
  r.hosts.panels(list);
  assert.deepEqual([shared?.sent.at(-1), own?.sent.at(-1)], [{ t: 'pnList', panels: list }, { t: 'pnList', panels: list }]);
});

test('面板页面的消息：原样交给宿主的面板页面部分，带上是哪个进程发的', t => {
  const r = rig(t);
  r.hosts.load([comp('a.x'), comp('a.own', true)]);
  const [shared, own] = electron.forked;
  const asked: PanelRequest[] = [
    { t: 'pnOpen', component: 'a.own', id: 'a.clock', mode: 'frames' },
    { t: 'pnRelease', component: 'a.own', id: 'a.clock', seq: 3 },
    { t: 'pnInput', component: 'a.own', id: 'a.clock', event: { kind: 'move', x: 1, y: 2, held: false } },
    { t: 'pnPaint', component: 'a.own', id: 'a.clock', on: false },
    { t: 'pnFps', component: 'a.own', id: 'a.clock', fps: 15 },
    { t: 'pnClose', component: 'a.own', id: 'a.clock', linger: true },
  ];
  for (const m of asked) say(own, m);
  say(shared, { t: 'pnOpen', component: 'a.x', id: 'a.clock', mode: 'window' });
  assert.deepEqual(r.panels.map(([m]) => m), [...asked, { t: 'pnOpen', component: 'a.x', id: 'a.clock', mode: 'window' }]);
  const [ownHost, sharedHost] = [r.panels[0]?.[1], r.panels.at(-1)?.[1]];
  assert.ok(ownHost && sharedHost && ownHost !== sharedHost);
  assert.ok(r.panels.slice(0, -1).every(([, h]) => h === ownHost));
  assert.deepEqual([ownHost.runs('a.own'), sharedHost.runs('a.own')], [true, false]);
  // 别的消息没有被当成面板页面的
  assert.deepEqual([r.relay.length, r.requests.length], [0, 0]);
});

test('远程服务的消息和通用请求：原样交给宿主对应的部分，带上是哪个进程发的；进程认得出自己加载的组件', t => {
  const r = rig(t);
  r.hosts.load([comp('a.x'), comp('a.y'), comp('a.own', true)]);
  const [shared, own] = electron.forked;
  const relayed: RelayRequest[] = [
    { t: 'rvServe', component: 'a.own', name: 'keyboard' },
    { t: 'rvState', component: 'a.own', name: 'keyboard', state: { text: '' } },
    { t: 'rvResult', req: 3, value: 1 },
    { t: 'rvClose', component: 'a.own', name: 'keyboard' },
  ];
  for (const m of relayed) say(own, m);
  say(shared, { t: 'rvUse', name: 'keyboard', on: true });
  say(shared, { t: 'rvCall', component: 'a.x', name: 'keyboard', method: 'act', args: [1] });
  assert.deepEqual(r.relay.map(([m]) => m), [...relayed, { t: 'rvUse', name: 'keyboard', on: true }, { t: 'rvCall', component: 'a.x', name: 'keyboard', method: 'act', args: [1] }]);
  const [ownHost, sharedHost] = [r.relay[0]?.[1], r.relay[4]?.[1]];
  assert.ok(ownHost && sharedHost && ownHost !== sharedHost);
  assert.deepEqual(r.relay.map(([, h]) => h === ownHost), [true, true, true, true, false, false]);
  assert.deepEqual([ownHost.runs('a.own'), ownHost.runs('a.x'), sharedHost.runs('a.x'), sharedHost.runs('a.y'), sharedHost.runs('a.own'), sharedHost.runs('a.none')], [true, false, true, true, false, false]);
  // 通用请求
  const asked: AppRequest[] = [
    { t: 'outSend', req: 1, payload: { text: 'a', spoken: 'a', notify: false }, live: false },
    { t: 'outTyping', on: true }, { t: 'outClear' }, { t: 'inDictate', on: true }, { t: 'trAsk', req: 2, text: 'a' }, { t: 'setOn', id: 'a.x', on: false },
    { t: 'clipRead', req: 3 }, { t: 'clipWrite', text: 'copied' },
  ];
  for (const m of asked) say(shared, m);
  assert.deepEqual(r.requests.map(([m]) => m), asked);
  assert.ok(r.requests.every(([, h]) => h === sharedHost));
  // 回复和远程调用发回发起的那个进程
  sharedHost.reply(1, ['a.out']);
  ownHost.post({ t: 'rvInvoke', name: 'keyboard', component: 'a.own', method: 'act', args: [1], caller: { component: 'a.x', where: 'process' } });
  assert.deepEqual(shared?.sent.at(-1), { t: 'reply', req: 1, value: ['a.out'] });
  assert.deepEqual((own?.sent.at(-1) as { t: string }).t, 'rvInvoke');
  // 组件列表变了：进程认的组件跟着变
  r.hosts.load([comp('a.x'), comp('a.own', true)]);
  assert.deepEqual([sharedHost.runs('a.x'), sharedHost.runs('a.y')], [true, false]);
});

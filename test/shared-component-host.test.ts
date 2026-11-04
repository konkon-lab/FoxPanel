import test, { after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handles } from '../src/component-host/handles.ts';
import type { AppInfo, FromProcess, HostComponent, ToProcess } from '../src/shared/host-protocol.ts';
import type { PanelInfo } from '../src/shared/types.ts';

// 假的 parentPort：记下组件进程发出的消息(和真的一样按结构化克隆传，传不了的抛出异常)，每发一条叫一遍在等消息的
const posted: FromProcess[] = [];
const waiters = new Set<() => void>();
const port = Object.assign(new EventEmitter(), {
  postMessage(m: FromProcess): void {
    posted.push(structuredClone(m));
    for (const look of [...waiters]) look();
  },
});
(process as unknown as { parentPort: unknown }).parentPort = port;

// 组件进程入口一加载就用 process.parentPort：在假端口装好之后加载
await import('../src/component-host/main.ts');

const send = (data: ToProcess): void => void port.emit('message', { data });

// 等第 from 条起第一条符合 match 的消息，回它的位置
function seen(match: (m: FromProcess) => boolean, from: number): Promise<number> {
  return new Promise(resolve => {
    const look = (): void => {
      const at = posted.findIndex((m, i) => i >= from && match(m));
      if (at < 0) return;
      waiters.delete(look);
      resolve(at);
    };
    waiters.add(look);
    look();
  });
}

// 测试用的组件：做了什么都写进日志(加载时带上 import 地址里的修改时间)；设置里 input 为 true 的注册听写、监听总线的 ch 频道
const PLUGIN = `const stamp = new URL(import.meta.url).searchParams.get('t');
export default {
  name: 'probe',
  apply(ctx) {
    ctx.log('load ' + stamp);
    if (ctx.config.input !== true) return;
    ctx.input.register({ start: () => ctx.log('start'), stop: () => ctx.log('stop') });
    ctx.bus.on('ch', data => ctx.log('bus ' + data));
  },
};
`;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-component-host-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
for (const name of ['a', 'b', 'end']) fs.writeFileSync(path.join(dir, `${name}.mjs`), PLUGIN);

// 一个输入源组件：id 为 t.<名字>，入口是临时目录里的 <名字>.mjs
const comp = (name: string, config: Record<string, unknown> = {}, mtime = 1): HostComponent => (
  { id: `t.${name}`, file: path.join(dir, `${name}.mjs`), mtime, config: { input: true, ...config } }
);

// 垫在列表最后的组件：每次的设置都不同，所以每次都重载；它加载完，列表里别的组件都已处理完
const END = 't.end';
let round = 0;

// 日志消息写成「组件 id 内容」(不含 END 的)
const lines = (list: readonly FromProcess[]): string[] => list.flatMap(m => m.t === 'log' && m.id !== END ? [`${m.id} ${m.text}`] : []);

interface Settled {
  inputs: string[];   // 列表处理完后上报的输入源
  loaded: string[];   // 加载了的组件(不含 END)
  logs: string[];     // 期间的日志行
}

// 发一条带组件列表的消息，等组件进程把列表处理完(末尾那次 outputs 上报)
async function settle(m: Extract<ToProcess, { components: HostComponent[] }>): Promise<Settled> {
  const from = posted.length;
  send({ ...m, components: [...m.components, { id: END, file: path.join(dir, 'end.mjs'), mtime: 0, config: { round: ++round } }] });
  const end = await seen(x => x.t === 'loaded' && x.id === END, from);
  const last = await seen(x => x.t === 'outputs', end + 1);
  const during = posted.slice(from, last + 1);
  const loads = during.filter(x => x.t === 'loaded');
  assert.deepEqual(loads.filter(x => x.error !== undefined), []);
  const final = posted[last];
  return {
    inputs: final?.t === 'outputs' ? final.inputs : [],
    loaded: loads.map(x => x.id).filter(id => id !== END),
    logs: lines(during),
  };
}

const apply = (components: HostComponent[]): Promise<Settled> => settle({ t: 'apply', components });

// 全部卸载后按 list 加载：输入源的注册次序和 list 一致
async function start(list: HostComponent[]): Promise<Settled> {
  await apply([]);
  return apply(list);
}

// run 期间(同步)发出的日志行
function logsOf(run: () => void): string[] {
  const from = posted.length;
  run();
  return lines(posted.slice(from));
}

// 开始听写后停止
const dictate = (): string[] => logsOf(() => {
  send({ t: 'dictate', on: true });
  send({ t: 'dictate', on: false });
});

// 进程启动时宿主带来的应用信息
const BOOT_INFO: AppInfo = { locale: 'ja', components: [], outputs: [{ id: 't.out', name: 'Out', on: true, live: false, typing: false }], inputs: [], canDictate: false };

// 进程启动时宿主带来的面板目录
const panelInfo = (id: string): PanelInfo => ({
  id, name: id, width: 480, height: 200, scale: 1, fps: 30, meters: 0.5, minMeters: 0.1, maxMeters: 2,
  anchor: 'world', spawn: 'front', glance: false, keep: false,
});
const BOOT_PANELS = [panelInfo('a.clock')];

await settle({ t: 'load', components: [], info: BOOT_INFO, panels: BOOT_PANELS, shared: {}, dataDir: dir, appDir: dir });

test('听写交给组件顺序最前的输入源：它重载之后仍然交给它', async () => {
  await start([comp('a'), comp('b')]);
  assert.deepEqual(dictate(), ['t.a start', 't.a stop']);
  const r = await apply([comp('a', { n: 1 }), comp('b')]);
  assert.deepEqual(r.loaded, ['t.a']);
  assert.deepEqual(r.inputs, ['t.a', 't.b']);
  assert.deepEqual(dictate(), ['t.a start', 't.a stop']);
});

test('上报的 inputs 按组件顺序：调换列表顺序后跟着换，听写交给排到最前的', async () => {
  assert.deepEqual((await start([comp('a'), comp('b')])).inputs, ['t.a', 't.b']);
  const r = await apply([comp('b'), comp('a')]);
  assert.deepEqual(r.loaded, []);
  assert.deepEqual(r.inputs, ['t.b', 't.a']);
  assert.deepEqual(dictate(), ['t.b start', 't.b stop']);
});

test('只有入口文件的修改时间变了：重载那一个组件，别的不动', async () => {
  assert.deepEqual((await start([comp('a'), comp('b')])).logs, ['t.a load 1', 't.b load 1']);
  const r = await apply([comp('a'), comp('b', {}, 2)]);
  assert.deepEqual(r.loaded, ['t.b']);
  assert.deepEqual(r.logs, ['t.b load 2']);
  assert.deepEqual((await apply([comp('a'), comp('b', {}, 2)])).loaded, []);
});

test('总线：卸载的组件收不到之后的消息，重载的只收一次', async () => {
  await start([comp('a'), comp('b')]);
  assert.deepEqual(logsOf(() => send({ t: 'bus', channel: 'ch', data: 'x' })), ['t.a bus x', 't.b bus x']);
  const r = await apply([comp('b', { n: 1 })]);
  assert.deepEqual(r.loaded, ['t.b']);
  assert.deepEqual(logsOf(() => send({ t: 'bus', channel: 'ch', data: 'y' })), ['t.b bus y']);
});

// 把关句柄换成记录用的函数：每次记下句柄和当时已经发出的消息条数
function recordCloses(t: TestContext): { handle: bigint; at: number }[] {
  const closes: { handle: bigint; at: number }[] = [];
  const real = handles.close;
  handles.close = handle => void closes.push({ handle, at: posted.length });
  t.after(() => { handles.close = real; });
  return closes;
}

// ---- 远程服务、应用信息、登记表的使用侧 ----

// 用或提供远程服务的组件。设置的 use 是要用的服务名：状态变了写日志；总线的 rv 频道点到自己的 id 时照做(读状态、tell、call)。
// serve 是要提供的服务名：收到的调用写日志，登记生效没有变了写日志；总线的 rv 频道点到自己时发布状态、撤掉、再登记一次、
// 读把手上的生效没有、取消生效没有的回调
const RV_PLUGIN = `export default {
  name: 'rv-probe',
  apply(ctx) {
    const { use, serve } = ctx.config;
    const impl = tag => ({
      echo: (caller, ...args) => { ctx.log(tag + 'echo ' + JSON.stringify(caller) + ' ' + JSON.stringify(args)); return args; },
      later: async (caller, text) => 'late ' + text,
      boom: () => { throw new Error('bad call'); },
      blank: () => { throw new Error(''); },
      refuse: async () => { throw new Error('bad later'); },
      big: () => 10n,
      fn: () => () => 0,
    });
    let handle = serve ? ctx.relay.serve(serve, impl('')) : null;
    const unwatch = handle?.watch(on => ctx.log('active ' + on));
    let old = null;
    const remote = use ? ctx.relay.use(use) : null;
    remote?.watch(s => ctx.log('watch ' + JSON.stringify(s)));
    ctx.bus.on('rv', d => {
      if (d.who !== ctx.id) return;
      if (d.op === 'state') ctx.log('state ' + JSON.stringify(ctx.relay.use(use).state));
      if (d.op === 'tell') remote.tell(d.method, ...d.args);
      if (d.op === 'call') remote.call(d.method, ...d.args).then(v => ctx.log('result ' + JSON.stringify(v)), e => ctx.log('failed ' + e.message));
      if (d.op === 'publish') handle.publish(d.state);
      if (d.op === 'close') handle.close();
      if (d.op === 'again') { old = handle; handle = ctx.relay.serve(serve, impl('2:')); handle.watch(on => ctx.log('2:active ' + on)); }
      if (d.op === 'active') ctx.log('is ' + handle.active);
      if (d.op === 'oldActive') ctx.log('old ' + old.active);
      if (d.op === 'unwatch') unwatch();
      if (d.op === 'old') { old.publish('stale'); old.close(); }
    });
  },
};
`;
for (const name of ['rv-a', 'rv-b', 'rv-c']) fs.writeFileSync(path.join(dir, `${name}.mjs`), RV_PLUGIN);

// 读应用信息、调登记表使用侧的组件：总线的 app 频道点到自己的 id 时照做，结果写日志
const APP_PLUGIN = `export default {
  name: 'app-probe',
  apply(ctx) {
    ctx.log('info ' + ctx.app.info.locale + ' ' + ctx.app.info.outputs.map(o => o.id).join(','));
    ctx.app.watch(info => ctx.log('watch ' + info.locale + ' ' + (ctx.app.info === info)));
    const done = what => v => ctx.log(what + ' ' + JSON.stringify(v));
    const failed = what => e => ctx.log(what + ' failed ' + e.message);
    const ops = {
      setOn: () => ctx.app.setOn('t.out', false),
      clipWrite: () => ctx.app.clipboard.write('copied'),
      clipRead: () => ctx.app.clipboard.read().then(done('clip'), failed('clip')),
      send: () => ctx.output.send({ text: 'hi', spoken: 'salut', notify: true }, true).then(done('sent'), failed('sent')),
      typing: () => ctx.output.typing(true),
      clear: () => ctx.output.clear(),
      dictate: () => { ctx.input.dictate(true); ctx.input.dictate(false); },
      translate: () => ctx.translator.translate('hi').then(done('translated'), failed('translated')),
    };
    ctx.bus.on('app', d => { if (d.who === ctx.id) ops[d.op](); });
  },
};
`;
for (const name of ['app-a', 'app-b']) fs.writeFileSync(path.join(dir, `${name}.mjs`), APP_PLUGIN);

// 一个用远程服务的组件：id 为 t.<名字>
const rvComp = (name: string, config: Record<string, unknown>): HostComponent => ({ id: `t.${name}`, file: path.join(dir, `${name}.mjs`), mtime: 1, config });
const appComp = (name: string, config: Record<string, unknown> = {}): HostComponent => ({ id: `t.${name}`, file: path.join(dir, `${name}.mjs`), mtime: 1, config });

// 第 from 条起组件进程发出的远程服务消息
const rvPosted = (from: number): FromProcess[] => posted.slice(from).filter(m => m.t.startsWith('rv'));
// 让组件做一件事
const rv = (who: string, op: string, more: Record<string, unknown> = {}): void => send({ t: 'bus', channel: 'rv', data: { who, op, ...more } });
const app = (who: string, op: string): void => send({ t: 'bus', channel: 'app', data: { who, op } });
// 等组件里接在 promise 后面的代码跑完
const tick = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test('远程服务(使用侧)：本进程第一个用的组件订阅一次，最后一个不用了才退订；状态到了叫每个组件的回调，卸载的不叫', async () => {
  await apply([]);
  let at = posted.length;
  const first = await apply([rvComp('rv-a', { use: 'keyboard' }), rvComp('rv-b', { use: 'keyboard' }), rvComp('rv-c', { use: 'clock' })]);
  assert.deepEqual(first.loaded, ['t.rv-a', 't.rv-b', 't.rv-c']);
  assert.deepEqual(rvPosted(at), [{ t: 'rvUse', name: 'keyboard', on: true }, { t: 'rvUse', name: 'clock', on: true }]);
  // 状态还没到时为 null
  assert.deepEqual(logsOf(() => rv('t.rv-a', 'state')), ['t.rv-a state null']);
  // 状态到了：用这个名字的组件都叫一遍，读到的是最新的；别的名字的不叫
  assert.deepEqual(logsOf(() => send({ t: 'rvState', name: 'keyboard', state: { text: 'a' } })), ['t.rv-a watch {"text":"a"}', 't.rv-b watch {"text":"a"}']);
  assert.deepEqual(logsOf(() => rv('t.rv-b', 'state')), ['t.rv-b state {"text":"a"}']);
  assert.deepEqual(logsOf(() => send({ t: 'rvState', name: 'clock', state: '12:00' })), ['t.rv-c watch "12:00"']);
  // 提供方没了：状态是 null；没人用的名字的状态丢掉
  assert.deepEqual(logsOf(() => send({ t: 'rvState', name: 'keyboard', state: null })), ['t.rv-a watch null', 't.rv-b watch null']);
  assert.deepEqual(logsOf(() => send({ t: 'rvState', name: 'panels', state: {} })), []);
  // 卸载一个：还有组件在用，不退订；它的回调不叫
  at = posted.length;
  await apply([rvComp('rv-b', { use: 'keyboard' }), rvComp('rv-c', { use: 'clock' })]);
  assert.deepEqual(rvPosted(at), []);
  assert.deepEqual(logsOf(() => send({ t: 'rvState', name: 'keyboard', state: 1 })), ['t.rv-b watch 1']);
  // 最后一个也卸载：退订；之后再有组件用，重新订阅，状态从 null 起
  at = posted.length;
  await apply([rvComp('rv-c', { use: 'clock' })]);
  assert.deepEqual(rvPosted(at), [{ t: 'rvUse', name: 'keyboard', on: false }]);
  at = posted.length;
  await apply([rvComp('rv-a', { use: 'keyboard' }), rvComp('rv-c', { use: 'clock' })]);
  assert.deepEqual(rvPosted(at), [{ t: 'rvUse', name: 'keyboard', on: true }]);
  assert.deepEqual(logsOf(() => rv('t.rv-a', 'state')), ['t.rv-a state null']);
});

test('远程服务(使用侧)：tell 不带 req、按发出的先后发给宿主；call 带 req，宿主回的结果或错误交给调用方；都带上组件 id', async () => {
  await start([rvComp('rv-a', { use: 'keyboard' }), rvComp('rv-b', { use: 'keyboard' })]);
  let at = posted.length;
  rv('t.rv-a', 'tell', { method: 'act', args: [{ kind: 'key', code: 'KeyA' }] });
  rv('t.rv-b', 'tell', { method: 'insert', args: ['x'] });
  rv('t.rv-a', 'tell', { method: 'dictationEnded', args: [] });
  assert.deepEqual(rvPosted(at), [
    { t: 'rvCall', component: 't.rv-a', name: 'keyboard', method: 'act', args: [{ kind: 'key', code: 'KeyA' }] },
    { t: 'rvCall', component: 't.rv-b', name: 'keyboard', method: 'insert', args: ['x'] },
    { t: 'rvCall', component: 't.rv-a', name: 'keyboard', method: 'dictationEnded', args: [] },
  ]);
  at = posted.length;
  rv('t.rv-a', 'call', { method: 'insert', args: ['y', 2] });
  rv('t.rv-b', 'call', { method: 'insert', args: [] });
  const calls = rvPosted(at).flatMap(m => (m.t === 'rvCall' ? [m] : []));
  assert.deepEqual(calls.map(m => [m.component, m.name, m.method, m.args, typeof m.req]), [
    ['t.rv-a', 'keyboard', 'insert', ['y', 2], 'number'],
    ['t.rv-b', 'keyboard', 'insert', [], 'number'],
  ]);
  assert.notEqual(calls[0]?.req, calls[1]?.req);
  const from = posted.length;
  send({ t: 'reply', req: calls[1]?.req ?? -1, value: null, error: '没有提供 keyboard 的组件' });
  send({ t: 'reply', req: calls[0]?.req ?? -1, value: { ok: true } });
  await tick();
  assert.deepEqual(lines(posted.slice(from)), ['t.rv-b failed 没有提供 keyboard 的组件', 't.rv-a result {"ok":true}']);
  // 宿主回的错误没有文字：照样按失败交给调用方
  at = posted.length;
  rv('t.rv-a', 'call', { method: 'insert', args: [] });
  const blank = rvPosted(at).flatMap(m => (m.t === 'rvCall' ? [m.req ?? -1] : []))[0] ?? -1;
  at = posted.length;
  send({ t: 'reply', req: blank, value: null, error: '' });
  await tick();
  assert.deepEqual(lines(posted.slice(at)), ['t.rv-a failed 请求失败']);
});

test('远程服务(提供侧)：登记、发布、撤掉都带上组件 id；宿主转来的调用交给实现，第一个参数是调用者；结果和错误回给宿主', async t => {
  await apply([]);
  let at = posted.length;
  await apply([rvComp('rv-a', { serve: 'keyboard' }), rvComp('rv-b', { serve: 'keyboard' })]);
  assert.deepEqual(rvPosted(at), [{ t: 'rvServe', component: 't.rv-a', name: 'keyboard' }, { t: 'rvServe', component: 't.rv-b', name: 'keyboard' }]);
  at = posted.length;
  rv('t.rv-a', 'publish', { state: { text: 'a' } });
  assert.deepEqual(rvPosted(at), [{ t: 'rvState', component: 't.rv-a', name: 'keyboard', state: { text: 'a' } }]);

  const caller = { component: 'x.user', where: 'process' as const };
  const invoke = (component: string, method: string, args: unknown[], req?: number): ToProcess => (
    { t: 'rvInvoke', name: 'keyboard', component, method, args, caller, ...(req === undefined ? {} : { req }) }
  );
  // 同步的结果、异步的结果、同步抛出、异步拒绝、没有这个方法、原型上的方法、这个组件没提供、结果传不了、抛出的错误没有文字
  at = posted.length;
  const logs = logsOf(() => {
    send(invoke('t.rv-a', 'echo', ['hi', { n: 1 }], 1));
    send(invoke('t.rv-b', 'echo', [], 2));
    send(invoke('t.rv-a', 'later', ['x'], 3));
    send(invoke('t.rv-a', 'boom', [], 4));
    send(invoke('t.rv-a', 'refuse', [], 5));
    send(invoke('t.rv-a', 'missing', [], 6));
    send(invoke('t.rv-a', 'toString', [], 7));
    send(invoke('t.none', 'echo', [], 8));
    send(invoke('t.rv-a', 'big', [], 9));
    send(invoke('t.rv-a', 'fn', [], 10));
    send(invoke('t.rv-a', 'blank', [], 11));
  });
  // 实现在消息到的时候就调，按到达的先后
  assert.deepEqual(logs, [
    't.rv-a echo {"component":"x.user","where":"process"} ["hi",{"n":1}]',
    't.rv-b echo {"component":"x.user","where":"process"} []',
  ]);
  await tick();
  const results = rvPosted(at).flatMap(m => (m.t === 'rvResult' ? [m] : [])).sort((a, b) => a.req - b.req);
  assert.deepEqual(results.map(m => (m.error === undefined ? [m.req, m.value] : [m.req, 'error', m.error])), [
    [1, ['hi', { n: 1 }]], [2, []], [3, 'late x'],
    [4, 'error', 'bad call'], [5, 'error', 'bad later'],
    [6, 'error', 'keyboard 没有 missing 这个方法'], [7, 'error', 'keyboard 没有 toString 这个方法'],
    [8, 'error', '这个组件没有提供 keyboard'],
    [9, 10n],
    [10, 'error', results[9]?.error],
    [11, 'error', '出错'],
  ]);
  assert.match(results[9]?.error ?? '', /could not be cloned/);

  // 不带 req 的调用：不回结果；出错只记日志(来源是提供方)，同一个组件的同一个服务 10 秒内只记一行
  t.mock.timers.enable({ apis: ['Date'], now: 1_000_000 });
  const errors = (from: number): string[] => posted.slice(from).flatMap(m => (m.t === 'log' && m.level === 'error' ? [`${m.id} ${m.text}`] : []));
  at = posted.length;
  send(invoke('t.rv-a', 'echo', ['t']));
  send(invoke('t.rv-a', 'boom', []));
  send(invoke('t.rv-a', 'refuse', []));
  for (let i = 0; i < 50; i++) send(invoke('t.rv-a', 'missing', []));
  await tick();
  assert.deepEqual(rvPosted(at), []);
  assert.deepEqual(errors(at), ['t.rv-a keyboard.boom: bad call']);
  // 另一个组件的同名服务各记各的
  at = posted.length;
  send(invoke('t.rv-b', 'missing', []));
  assert.deepEqual(errors(at), ['t.rv-b keyboard.missing: keyboard 没有 missing 这个方法']);
  // 差 1 毫秒到 10 秒：不记；到了：再记一行
  at = posted.length;
  t.mock.timers.tick(9_999);
  send(invoke('t.rv-a', 'missing', []));
  assert.deepEqual(errors(at), []);
  t.mock.timers.tick(1);
  send(invoke('t.rv-a', 'missing', []));
  send(invoke('t.rv-a', 'refuse', []));
  await tick();
  assert.deepEqual(errors(at), ['t.rv-a keyboard.missing: keyboard 没有 missing 这个方法']);
});

test('远程服务(提供侧)：撤掉后发布不出去、调用按失败回；再登记一次后前一次的把手不起作用；组件卸载时自动撤掉', async () => {
  await start([rvComp('rv-a', { serve: 'keyboard' }), rvComp('rv-b', { serve: 'clock' })]);
  const caller = { component: 'a.kb', where: 'panel' as const };
  // 再登记一次：调用到新的实现；前一次的把手发布、撤掉都不起作用
  let at = posted.length;
  rv('t.rv-a', 'again');
  rv('t.rv-a', 'old');
  assert.deepEqual(rvPosted(at), [{ t: 'rvServe', component: 't.rv-a', name: 'keyboard' }]);
  assert.deepEqual(logsOf(() => send({ t: 'rvInvoke', name: 'keyboard', component: 't.rv-a', method: 'echo', args: [1], caller })), ['t.rv-a 2:echo {"component":"a.kb","where":"panel"} [1]']);
  // 撤掉：发 rvClose；之后发布不发消息，撤第二次不发；调用按失败回
  at = posted.length;
  rv('t.rv-a', 'close');
  rv('t.rv-a', 'publish', { state: 1 });
  rv('t.rv-a', 'close');
  send({ t: 'rvInvoke', req: 5, name: 'keyboard', component: 't.rv-a', method: 'echo', args: [], caller });
  await tick();
  assert.deepEqual(rvPosted(at), [{ t: 'rvClose', component: 't.rv-a', name: 'keyboard' }, { t: 'rvResult', req: 5, error: '这个组件没有提供 keyboard' }]);
  // 卸载：还登记着的自动撤掉，已经撤掉的不发
  at = posted.length;
  await apply([]);
  assert.deepEqual(rvPosted(at), [{ t: 'rvClose', component: 't.rv-b', name: 'clock' }]);
});

test('远程服务(提供侧)：宿主说的生效没有记在把手上，变了叫回调，没变不叫；同一个进程里两个组件各记各的；再登记、撤掉、卸载之后前一个把手读到 false、回调不叫', async () => {
  await start([rvComp('rv-a', { serve: 'keyboard' }), rvComp('rv-b', { serve: 'keyboard' }), rvComp('rv-c', { serve: 'clock' })]);
  const active = (component: string, on: boolean, name = 'keyboard'): ToProcess => ({ t: 'rvActive', name, component, on });
  const ask = (...who: string[]): string[] => logsOf(() => { for (const id of who) rv(id, 'active'); });
  // 宿主还没说：都读到 false
  assert.deepEqual(ask('t.rv-a', 't.rv-b', 't.rv-c'), ['t.rv-a is false', 't.rv-b is false', 't.rv-c is false']);
  // 说等着：和把手上的一样，不叫回调
  assert.deepEqual(logsOf(() => send(active('t.rv-b', false))), []);
  // 说生效：只叫那个组件的回调，只有它读到 true
  assert.deepEqual(logsOf(() => send(active('t.rv-a', true))), ['t.rv-a active true']);
  assert.deepEqual(ask('t.rv-a', 't.rv-b', 't.rv-c'), ['t.rv-a is true', 't.rv-b is false', 't.rv-c is false']);
  // 同样的再说一遍、这个组件没登记的名字、不认识的组件：都不叫
  assert.deepEqual(logsOf(() => {
    send(active('t.rv-a', true));
    send(active('t.rv-a', false, 'clock'));
    send(active('t.none', true));
  }), []);
  assert.deepEqual(ask('t.rv-a'), ['t.rv-a is true']);
  // 别的名字的登记各记各的
  assert.deepEqual(logsOf(() => send(active('t.rv-c', true, 'clock'))), ['t.rv-c active true']);
  // 换过来：两个组件各叫各的
  assert.deepEqual(logsOf(() => {
    send(active('t.rv-a', false));
    send(active('t.rv-b', true));
  }), ['t.rv-a active false', 't.rv-b active true']);
  assert.deepEqual(ask('t.rv-a', 't.rv-b'), ['t.rv-a is false', 't.rv-b is true']);
  // 取消了回调：不叫，把手上照样读到新的
  rv('t.rv-a', 'unwatch');
  assert.deepEqual(logsOf(() => send(active('t.rv-a', true))), []);
  assert.deepEqual(ask('t.rv-a'), ['t.rv-a is true']);
  // 再登记一次：新把手从 false 起，前一个把手读到 false、它的回调不叫
  rv('t.rv-b', 'again');
  assert.deepEqual(logsOf(() => {
    rv('t.rv-b', 'active');
    rv('t.rv-b', 'oldActive');
  }), ['t.rv-b is false', 't.rv-b old false']);
  assert.deepEqual(logsOf(() => send(active('t.rv-b', true))), ['t.rv-b 2:active true']);
  assert.deepEqual(logsOf(() => rv('t.rv-b', 'oldActive')), ['t.rv-b old false']);
  // 撤掉：读到 false，宿主之后再说也不叫
  rv('t.rv-b', 'close');
  assert.deepEqual(logsOf(() => {
    send(active('t.rv-b', false));
    send(active('t.rv-b', true));
    rv('t.rv-b', 'active');
  }), ['t.rv-b is false']);
  // 卸载之后宿主发来的不叫回调、不记出错的日志
  const from = posted.length;
  await apply([]);
  const at = posted.length;
  send(active('t.rv-c', false, 'clock'));
  send(active('t.rv-a', false));
  assert.deepEqual(posted.slice(at), []);
  assert.deepEqual(rvPosted(from), [{ t: 'rvClose', component: 't.rv-a', name: 'keyboard' }, { t: 'rvClose', component: 't.rv-c', name: 'clock' }]);
});

test('应用信息：组件读到最新的一份，变了叫回调；卸载的组件不叫', async () => {
  const first = await start([appComp('app-a'), appComp('app-b')]);
  assert.deepEqual(first.logs, ['t.app-a info ja t.out', 't.app-b info ja t.out']);
  const next: AppInfo = { ...BOOT_INFO, locale: 'en', outputs: [] };
  assert.deepEqual(logsOf(() => send({ t: 'info', info: next })), ['t.app-a watch en true', 't.app-b watch en true']);
  const r = await apply([appComp('app-b', { n: 1 })]);
  // 重载的组件读到的是最新的；卸载的那个的回调不叫，重载的只叫一次
  assert.deepEqual(r.logs, ['t.app-b info en ']);
  assert.deepEqual(logsOf(() => send({ t: 'info', info: { ...next, locale: 'ko' } })), ['t.app-b watch ko true']);
});

test('开关组件、剪贴板、登记表的使用侧：发给宿主的消息；带 req 的等宿主回', async () => {
  await start([appComp('app-a')]);
  let at = posted.length;
  for (const op of ['setOn', 'clipWrite', 'typing', 'clear', 'dictate']) app('t.app-a', op);
  assert.deepEqual(posted.slice(at), [
    { t: 'setOn', id: 't.out', on: false },
    { t: 'clipWrite', text: 'copied' },
    { t: 'outTyping', on: true },
    { t: 'outClear' },
    { t: 'inDictate', on: true }, { t: 'inDictate', on: false },
  ]);
  at = posted.length;
  for (const op of ['send', 'translate', 'clipRead']) app('t.app-a', op);
  const asked = posted.slice(at);
  const reqs = asked.map(m => ('req' in m ? m.req : undefined));
  assert.deepEqual(asked, [
    { t: 'outSend', req: reqs[0], payload: { text: 'hi', spoken: 'salut', notify: true }, live: true },
    { t: 'trAsk', req: reqs[1], text: 'hi' },
    { t: 'clipRead', req: reqs[2] },
  ]);
  assert.equal(new Set(reqs).size, 3);
  at = posted.length;
  send({ t: 'reply', req: reqs[0] ?? -1, value: ['t.out'] });
  send({ t: 'reply', req: reqs[1] ?? -1, value: null, error: '翻译超时' });
  send({ t: 'reply', req: reqs[2] ?? -1, value: 'pasted' });
  await tick();
  assert.deepEqual(lines(posted.slice(at)), ['t.app-a sent ["t.out"]', 't.app-a translated failed 翻译超时', 't.app-a clip "pasted"']);
});

// ---- 面板目录和面板页面(ctx.panels) ----

// 开面板页面的组件。加载时把面板目录写进日志，目录变了也写；设置的 open 是要开的 [面板 id, 显示方式(可不写)]，
// frames 为 true 的登记帧回调；收到的大小、状态、放掉的帧、帧都写进日志。总线的 pn 频道点到自己的 id 时照做
const PN_PLUGIN = `export default {
  name: 'pn-probe',
  apply(ctx) {
    ctx.log('panels ' + ctx.panels.list.map(p => p.id).join(','));
    ctx.panels.watch(list => ctx.log('list ' + list.map(p => p.id).join(',') + ' now ' + ctx.panels.list.length));
    const feeds = ctx.config.open.map(([id, mode]) => {
      const feed = ctx.panels.open(id, mode);
      feed.onSize((w, h) => ctx.log('size ' + id + ' ' + w + 'x' + h + ' feed ' + feed.width + 'x' + feed.height));
      feed.onState((s, d) => ctx.log('state ' + id + ' ' + s + ' ' + (d ?? '-') + ' feed ' + feed.state));
      feed.onDrop(seq => ctx.log('drop ' + id + ' #' + seq));
      if (ctx.config.frames === true) feed.onFrame(f => ctx.log('frame ' + id + ' #' + f.seq + ' ' + typeof f.handle + ' ' + f.handle + ' ' + f.width + 'x' + f.height));
      return feed;
    });
    ctx.bus.on('pn', ({ who, op, arg }) => {
      if (who !== ctx.id) return;
      for (const feed of feeds) {
        if (op === 'close') feed.close();
        if (op === 'release') feed.release(arg);
        if (op === 'input') feed.input(arg);
        if (op === 'paint') feed.setPainting(arg);
        if (op === 'fps') feed.setFrameRate(arg);
        if (op === 'throw') feed.onFrame(() => { throw new Error('bad frame'); });
        if (op === 'id') ctx.log('feed ' + feed.id + ' ' + feed.width + 'x' + feed.height + ' ' + feed.state);
      }
    });
  },
};
`;
for (const name of ['pn-a', 'pn-b']) fs.writeFileSync(path.join(dir, `${name}.mjs`), PN_PLUGIN);

const pnComp = (name: string, open: [string, string?][], frames = true): HostComponent => ({ id: `t.pn-${name}`, file: path.join(dir, `pn-${name}.mjs`), mtime: 1, config: { open, frames } });
// 第 from 条起组件进程发出的面板页面消息
const pnPosted = (from: number): FromProcess[] => posted.slice(from).filter(m => m.t.startsWith('pn'));
// 经总线让一个组件对它开的面板页面做一件事
const pn = (who: string, op: string, arg?: unknown): void => send({ t: 'bus', channel: 'pn', data: { who, op, arg } });
const pnFrame = (component: string, id: string, seq: number, handle: string): ToProcess => ({ t: 'pnFrame', component, id, seq, handle, width: 960, height: 400 });

// 全部卸载后按 list 加载，回加载期间发出的面板页面消息和日志
async function pnStart(list: HostComponent[]): Promise<{ sent: FromProcess[]; logs: string[] }> {
  await apply([]);
  const from = posted.length;
  const r = await apply(list);
  return { sent: pnPosted(from), logs: r.logs };
}

test('面板目录：组件读到进程启动时带来的目录；目录变了叫回调，读到的也换成新的；卸载的组件不叫', async () => {
  const r = await pnStart([pnComp('a', []), pnComp('b', [])]);
  assert.deepEqual(r.logs, ['t.pn-a panels a.clock', 't.pn-b panels a.clock']);
  assert.deepEqual(r.sent, []);
  const next = [panelInfo('a.clock'), panelInfo('a.notes')];
  assert.deepEqual(logsOf(() => send({ t: 'pnList', panels: next })), ['t.pn-a list a.clock,a.notes now 2', 't.pn-b list a.clock,a.notes now 2']);
  await apply([pnComp('b', [])]);
  assert.deepEqual(logsOf(() => send({ t: 'pnList', panels: BOOT_PANELS })), ['t.pn-b list a.clock now 1']);
  // 之后加载的组件读到的是最新的目录
  assert.deepEqual((await apply([pnComp('b', []), pnComp('a', [])])).logs, ['t.pn-a panels a.clock']);
});

test('面板页面：开页面发 pnOpen(带上组件 id，显示方式默认离屏)；宿主发来的大小和状态按组件和面板送到，记在把手上并叫回调', async () => {
  const r = await pnStart([pnComp('a', [['a.clock'], ['a.notes', 'window']])]);
  assert.deepEqual(r.sent, [
    { t: 'pnOpen', component: 't.pn-a', id: 'a.clock', mode: 'frames' },
    { t: 'pnOpen', component: 't.pn-a', id: 'a.notes', mode: 'window' },
  ]);
  assert.deepEqual(logsOf(() => pn('t.pn-a', 'id')), ['t.pn-a feed a.clock 0x0 loading', 't.pn-a feed a.notes 0x0 loading']);
  assert.deepEqual(logsOf(() => {
    send({ t: 'pnSize', component: 't.pn-a', id: 'a.clock', width: 960, height: 400 });
    send({ t: 'pnState', component: 't.pn-a', id: 'a.clock', state: 'ready' });
    send({ t: 'pnState', component: 't.pn-a', id: 'a.notes', state: 'failed', detail: 'no such panel' });
    // 不认识的面板、别的组件的、没写组件的：不送
    send({ t: 'pnSize', component: 't.pn-a', id: 'a.none', width: 1, height: 1 });
    send({ t: 'pnState', component: 't.pn-a', id: 'a.none', state: 'ready' });
    send({ t: 'pnSize', component: 't.pn-b', id: 'a.clock', width: 2, height: 2 });
    send({ t: 'pnState', component: '', id: 'a.clock', state: 'failed', detail: 'bad request' });
  }), [
    't.pn-a size a.clock 960x400 feed 960x400',
    't.pn-a state a.clock ready - feed ready',
    't.pn-a state a.notes failed no such panel feed failed',
  ]);
});

test('面板页面：收到的帧交给帧回调，句柄留给组件自己关；宿主放掉的帧叫 onDrop；把手上的操作发成对应的消息(都带上组件 id)', async t => {
  const closes = recordCloses(t);
  await pnStart([pnComp('a', [['a.clock']])]);
  let at = posted.length;
  assert.deepEqual(logsOf(() => {
    send(pnFrame('t.pn-a', 'a.clock', 3, '18446744073709551615'));
    send({ t: 'pnDrop', component: 't.pn-a', id: 'a.clock', seq: 2 });
    send({ t: 'pnDrop', component: 't.pn-a', id: 'a.none', seq: 2 });
    send({ t: 'pnDrop', component: 't.pn-b', id: 'a.clock', seq: 2 });
  }), ['t.pn-a frame a.clock #3 bigint 18446744073709551615 960x400', 't.pn-a drop a.clock #2']);
  assert.deepEqual([pnPosted(at), closes], [[], []]);
  at = posted.length;
  pn('t.pn-a', 'release', 3);
  pn('t.pn-a', 'input', { kind: 'move', x: 10, y: 20, held: true });
  pn('t.pn-a', 'paint', false);
  pn('t.pn-a', 'fps', 15);
  assert.deepEqual(pnPosted(at), [
    { t: 'pnRelease', component: 't.pn-a', id: 'a.clock', seq: 3 },
    { t: 'pnInput', component: 't.pn-a', id: 'a.clock', event: { kind: 'move', x: 10, y: 20, held: true } },
    { t: 'pnPaint', component: 't.pn-a', id: 'a.clock', on: false },
    { t: 'pnFps', component: 't.pn-a', id: 'a.clock', fps: 15 },
  ]);
});

test('面板页面：没登记帧回调的页面、关掉之后才到的帧、不认识的面板或组件的帧，关掉句柄之后回 pnRelease(带上帧写着的组件)', async t => {
  const closes = recordCloses(t);
  await pnStart([pnComp('a', [['a.clock']], false), pnComp('b', [['a.notes']])]);
  let at = posted.length;
  send(pnFrame('t.pn-a', 'a.clock', 1, '1234'));
  assert.deepEqual(closes, [{ handle: 1234n, at }]);
  assert.deepEqual(pnPosted(at), [{ t: 'pnRelease', component: 't.pn-a', id: 'a.clock', seq: 1 }]);
  // 关掉页面：发一次 pnClose(不保留)，之后把手上的操作都不发
  at = posted.length;
  pn('t.pn-b', 'close');
  pn('t.pn-b', 'close');
  pn('t.pn-b', 'release', 1);
  pn('t.pn-b', 'input', { kind: 'leave' });
  pn('t.pn-b', 'paint', true);
  pn('t.pn-b', 'fps', 30);
  assert.deepEqual(pnPosted(at), [{ t: 'pnClose', component: 't.pn-b', id: 'a.notes', linger: false }]);
  at = posted.length;
  closes.length = 0;
  const logs = logsOf(() => {
    send(pnFrame('t.pn-b', 'a.notes', 7, '55'));
    send(pnFrame('t.pn-b', 'a.none', 8, '56'));
    send(pnFrame('t.pn-b', 'a.clock', 9, '57'));
    send({ t: 'pnState', component: 't.pn-b', id: 'a.notes', state: 'gone' });
  });
  assert.deepEqual(logs, []);
  assert.deepEqual(pnPosted(at), [
    { t: 'pnRelease', component: 't.pn-b', id: 'a.notes', seq: 7 },
    { t: 'pnRelease', component: 't.pn-b', id: 'a.none', seq: 8 },
    { t: 'pnRelease', component: 't.pn-b', id: 'a.clock', seq: 9 },
  ]);
  // 每个句柄都在回它的 pnRelease 之前关
  assert.deepEqual(closes, [{ handle: 55n, at }, { handle: 56n, at: at + 1 }, { handle: 57n, at: at + 2 }]);
});

test('面板页面：句柄要等一会儿才关掉时(库还在加载)，关掉之后才回 pnRelease', async t => {
  recordCloses(t);
  // 每次关句柄都等测试放行
  const waiting: { handle: bigint; done: () => void }[] = [];
  handles.close = handle => new Promise<void>(resolve => { waiting.push({ handle, done: resolve }); });
  await pnStart([pnComp('a', [['a.clock']], false)]);
  const at = posted.length;
  send(pnFrame('t.pn-a', 'a.clock', 1, '71'));
  send(pnFrame('t.pn-a', 'a.clock', 2, '72'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(waiting.map(w => w.handle), [71n, 72n]);
  assert.deepEqual(pnPosted(at), []);
  // 后一个句柄关掉了：只回它的那一帧
  waiting[1]?.done();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(pnPosted(at), [{ t: 'pnRelease', component: 't.pn-a', id: 'a.clock', seq: 2 }]);
  waiting[0]?.done();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(pnPosted(at).slice(1), [{ t: 'pnRelease', component: 't.pn-a', id: 'a.clock', seq: 1 }]);
});

test('面板页面：关句柄出错时照样回 pnRelease，同一个错误只记一次日志', async t => {
  recordCloses(t);
  let sync = true;
  handles.close = () => {
    if (sync) throw new Error('no kernel32');
    return Promise.reject(new Error('no kernel32'));
  };
  await pnStart([pnComp('a', [['a.clock']], false)]);
  const at = posted.length;
  send(pnFrame('t.pn-a', 'a.clock', 1, '1'));
  sync = false;
  send(pnFrame('t.pn-a', 'a.clock', 2, '2'));
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(pnPosted(at), [
    { t: 'pnRelease', component: 't.pn-a', id: 'a.clock', seq: 1 },
    { t: 'pnRelease', component: 't.pn-a', id: 'a.clock', seq: 2 },
  ]);
  assert.deepEqual(posted.slice(at).filter(m => m.t === 'log'), [{ t: 'log', id: '', text: 'panel frame: no kernel32', level: 'error' }]);
});

test('面板页面：组件卸载时放开它开的页面(pnClose 带 linger，页面留在宿主那里)；自己关过的不发', async () => {
  await pnStart([pnComp('a', [['a.clock'], ['a.notes']]), pnComp('b', [['a.todo']])]);
  pn('t.pn-a', 'close');
  const at = posted.length;
  await apply([]);
  assert.deepEqual(pnPosted(at), [{ t: 'pnClose', component: 't.pn-b', id: 'a.todo', linger: true }]);
  // 卸载时还开着的：按打开的相反次序放开
  await pnStart([pnComp('a', [['a.clock'], ['a.notes']])]);
  const from = posted.length;
  await apply([]);
  assert.deepEqual(pnPosted(from), [
    { t: 'pnClose', component: 't.pn-a', id: 'a.notes', linger: true },
    { t: 'pnClose', component: 't.pn-a', id: 'a.clock', linger: true },
  ]);
});

test('面板页面：帧回调出错记在开页面的组件名下，不影响之后的帧', async t => {
  recordCloses(t);
  await pnStart([pnComp('a', [['a.clock']])]);
  pn('t.pn-a', 'throw');
  const at = posted.length;
  send(pnFrame('t.pn-a', 'a.clock', 1, '9'));
  assert.deepEqual(posted.slice(at), [{ t: 'log', id: 't.pn-a', text: 'panel frame: bad frame', level: 'error' }]);
});

test('面板页面：同进程的两个组件开同一块面板各记各的——宿主的消息按组件送到，被拒的那个关掉自己的把手不动另一个的页面', async t => {
  recordCloses(t);
  const r = await pnStart([pnComp('a', [['a.clock']]), pnComp('b', [['a.clock', 'window']])]);
  assert.deepEqual(r.sent, [
    { t: 'pnOpen', component: 't.pn-a', id: 'a.clock', mode: 'frames' },
    { t: 'pnOpen', component: 't.pn-b', id: 'a.clock', mode: 'window' },
  ]);
  // 后开的被拒：只有它得到 failed；帧照样交给先开的那个
  assert.deepEqual(logsOf(() => {
    send({ t: 'pnState', component: 't.pn-b', id: 'a.clock', state: 'failed', detail: 'not the active display' });
    send(pnFrame('t.pn-a', 'a.clock', 1, '11'));
  }), ['t.pn-b state a.clock failed not the active display feed failed', 't.pn-a frame a.clock #1 bigint 11 960x400']);
  assert.deepEqual(logsOf(() => pn('t.pn-a', 'id')), ['t.pn-a feed a.clock 0x0 loading']);
  // 被拒的那个关掉自己的把手：发的 pnClose 写着它自己(宿主按收帧方核对，不会关掉另一个组件的页面)
  let at = posted.length;
  pn('t.pn-b', 'close');
  assert.deepEqual(pnPosted(at), [{ t: 'pnClose', component: 't.pn-b', id: 'a.clock', linger: false }]);
  // 先开的那个把手照常能用
  at = posted.length;
  pn('t.pn-a', 'release', 1);
  pn('t.pn-a', 'paint', false);
  assert.deepEqual(pnPosted(at), [
    { t: 'pnRelease', component: 't.pn-a', id: 'a.clock', seq: 1 },
    { t: 'pnPaint', component: 't.pn-a', id: 'a.clock', on: false },
  ]);
  // 后开的那个组件卸载：不放开先开的那一页
  at = posted.length;
  await apply([pnComp('a', [['a.clock']])]);
  assert.deepEqual(pnPosted(at), []);
  pn('t.pn-a', 'close');
  assert.deepEqual(pnPosted(at), [{ t: 'pnClose', component: 't.pn-a', id: 'a.clock', linger: false }]);
});

test('面板页面：自己关掉的页面不留在组件占用的东西里(反复开关不越积越多)', () => {
  const source = fs.readFileSync(path.join(import.meta.dirname, '..', 'src', 'component-host', 'main.ts'), 'utf8');
  assert.match(source, /const held = owner\.hold\(\(\) => close\(true\)\);/);
  assert.match(source, /close: \(\) => \{\n\s+close\(false\);\n\s+held\.forget\(\);\n\s+\},/);
});

// 等服务的组件：inject 里写了两个服务，都有了才起来；提供服务的组件：提供设置里 name 这个名字的服务
const WAIT_PLUGIN = `export default {
  name: 'waits',
  inject: ['clock-svc', 'other-svc'],
  apply(ctx) { ctx.log('applied'); },
};
`;
const PROVIDE_PLUGIN = `export default {
  name: 'provides',
  apply(ctx) {
    ctx.provide(ctx.config.name, {});
    ctx.log('provided ' + ctx.config.name);
  },
};
`;
fs.writeFileSync(path.join(dir, 'wait.mjs'), WAIT_PLUGIN);
fs.writeFileSync(path.join(dir, 'provide.mjs'), PROVIDE_PLUGIN);
const waitComp: HostComponent = { id: 't.wait', file: path.join(dir, 'wait.mjs'), mtime: 1, config: {} };
const provideComp = (name: string): HostComponent => ({ id: `t.${name}`, file: path.join(dir, 'provide.mjs'), mtime: 1, config: { name } });
const WAIT_MS = 5000;   // 组件加载之后过这么久还在等服务才记日志(毫秒)

// 让排着的 promise 接力做完：最多等 turns 轮事件循环，done() 为真就停
async function turnsUntil(done: () => boolean, turns = 50): Promise<void> {
  for (let i = 0; i < turns && !done(); i++) await new Promise(resolve => setImmediate(resolve));
}

test('等服务的组件：不挡住后面的组件；5 秒后每个还等着的服务记一行日志；服务都有了它自己起来', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await start([waitComp, comp('a')]);
  // 等着的那个没有起来，排在它后面的照常加载
  assert.deepEqual([r.loaded, r.logs], [['t.wait', 't.a'], ['t.a load 1']]);
  let at = posted.length;
  t.mock.timers.tick(WAIT_MS - 1);
  assert.deepEqual(posted.slice(at), []);
  t.mock.timers.tick(1);
  assert.deepEqual(posted.slice(at), [
    { t: 'log', id: 't.wait', text: 'waiting for service: clock-svc', level: 'warn' },
    { t: 'log', id: 't.wait', text: 'waiting for service: other-svc', level: 'warn' },
  ]);
  // 只记一次
  at = posted.length;
  t.mock.timers.tick(WAIT_MS * 3);
  assert.deepEqual(posted.slice(at), []);
  // 一个服务有了还不够；两个都有了它自己起来，不用重新加载
  const one = await apply([waitComp, comp('a'), provideComp('clock-svc')]);
  assert.deepEqual([one.loaded, one.logs], [['t.clock-svc'], ['t.clock-svc provided clock-svc']]);
  at = posted.length;
  const both = await apply([waitComp, comp('a'), provideComp('clock-svc'), provideComp('other-svc')]);
  assert.deepEqual(both.loaded, ['t.other-svc']);
  await turnsUntil(() => lines(posted.slice(at)).includes('t.wait applied'));
  assert.ok(lines(posted.slice(at)).includes('t.wait applied'));
});

test('等服务的组件：5 秒内服务有了、或者组件卸载了，都不记日志', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await start([waitComp]);
  t.mock.timers.tick(WAIT_MS - 1);
  let at = posted.length;
  await apply([waitComp, provideComp('clock-svc'), provideComp('other-svc')]);
  await turnsUntil(() => lines(posted.slice(at)).includes('t.wait applied'));
  at = posted.length;
  t.mock.timers.tick(WAIT_MS);
  assert.deepEqual(posted.slice(at), []);
  // 等着的时候卸载
  await start([waitComp]);
  await apply([]);
  at = posted.length;
  t.mock.timers.tick(WAIT_MS * 2);
  assert.deepEqual(posted.slice(at), []);
});

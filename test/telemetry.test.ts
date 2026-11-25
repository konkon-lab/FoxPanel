import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Context, type Plugin } from 'cordis';
import { EVERY_MS, FIRST_MS, postBeat, startBeats, type Beat } from '../components/telemetry/src/beat.ts';
import { GET, STATE } from '../components/telemetry/src/channels.ts';
import { deviceId, parseMachineGuid, randomDevice } from '../components/telemetry/src/device.ts';
import { ENDPOINT } from '../components/telemetry/src/endpoint.ts';
import { telemetry, type TelemetryDeps } from '../components/telemetry/src/main.ts';
import { readState, whyOff, type Gate, type TelemetryState } from '../components/telemetry/src/state.ts';

const GUID = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
const REG_OUT = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Cryptography\r\n    MachineGuid    REG_SZ    ${GUID.toUpperCase()}\r\n\r\n`;
const URL = 'https://t.example/v1/report';

test('设备标识：从 reg query 的输出里取 MachineGuid，加前缀取 sha256；随机的标识一样长', () => {
  assert.equal(parseMachineGuid(REG_OUT), GUID);
  assert.equal(parseMachineGuid('ERROR: The system was unable to find the specified registry key or value.'), null);
  const id = deviceId(GUID);
  assert.match(id, /^[0-9a-f]{64}$/);
  assert.equal(id, deviceId(GUID));
  // 和直接对 MachineGuid 取 sha256 的值不同
  assert.notEqual(id, crypto.createHash('sha256').update(GUID).digest('hex'));
  assert.notEqual(id, deviceId('00000000-0000-0000-0000-000000000000'));
  assert.match(randomDevice(), /^[0-9a-f]{64}$/);
  assert.notEqual(randomDevice(), randomDevice());
});

test('发不发：没有接收地址、从源码启动、环境变量关掉、设置里关着时不发，按这个顺序给原因', () => {
  const ok: Gate = { endpoint: URL, packaged: true, env: {}, enabled: true };
  assert.equal(whyOff(ok), null);
  assert.equal(whyOff({ ...ok, enabled: false }), 'disabled');
  assert.equal(whyOff({ ...ok, enabled: false, env: { FOXPANEL_NO_TELEMETRY: '1' } }), 'env');
  assert.equal(whyOff({ ...ok, env: { DO_NOT_TRACK: 'true' } }), 'env');
  assert.equal(whyOff({ ...ok, packaged: false, env: { DO_NOT_TRACK: '1' } }), 'dev');
  assert.equal(whyOff({ ...ok, endpoint: '', packaged: false }), 'unconfigured');
  // 没设、空、0、false 的环境变量不算
  for (const v of [undefined, '', '0', 'false', 'FALSE']) assert.equal(whyOff({ ...ok, env: { FOXPANEL_NO_TELEMETRY: v, DO_NOT_TRACK: v } }), null);
});

test('接收地址：空着，或是一个 https 地址', () => {
  const endpoint: string = ENDPOINT;
  assert.ok(endpoint === '' || (endpoint.startsWith('https://') && globalThis.URL.canParse(endpoint)), endpoint);
});

test('总线上的状态收窄：缺字段的不要，不认识的原因当成在发送', () => {
  const s: TelemetryState = { device: 'd', session: 's', off: 'dev' };
  assert.deepEqual(readState(s), s);
  assert.deepEqual(readState({ ...s, off: null }), { ...s, off: null });
  assert.deepEqual(readState({ ...s, off: 'what' }), { ...s, off: null });
  for (const bad of [null, 'x', [], { device: 'd' }, { device: 1, session: 's' }]) assert.equal(readState(bad), null);
});

test('心跳的间隔：开始后 1 分钟发第一条，之后每 10 分钟一条，停下后不再发', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let n = 0;
  const stop = startBeats(() => { n++; });
  t.mock.timers.tick(FIRST_MS - 1);
  assert.equal(n, 0);
  t.mock.timers.tick(1);
  assert.equal(n, 1);
  t.mock.timers.tick(EVERY_MS * 3);
  assert.equal(n, 4);
  stop();
  t.mock.timers.tick(EVERY_MS * 3);
  assert.equal(n, 4);
  // 第一条之前停下
  let m = 0;
  startBeats(() => { m++; })();
  t.mock.timers.tick(FIRST_MS + EVERY_MS);
  assert.equal(m, 0);
});

test('发一条心跳：POST 一个 JSON 数组，里面一条记录；接收端没收下时失败', async t => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 200;
  t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response(null, { status }));
  });
  const beat: Beat = { v: 1, device: 'd', session: 's', app: '1.2.3' };
  await postBeat(URL, beat);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, URL);
  assert.equal(calls[0]?.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]?.init.body)), [beat]);
  status = 503;
  await assert.rejects(postBeat(URL, beat), /http 503/);
});

interface Rig {
  posted: Beat[];
  logs: string[];
  states: TelemetryState[];           // 组件经总线发布的状态
  store: Map<string, unknown>;        // 组件数据
  fail: { on: boolean };              // 发送失败
  emit(channel: string, data?: unknown): void;   // 总线上来一条消息
  settle(): Promise<void>;            // 等组件的异步启动做完
  dispose(): Promise<void>;
}

// 假的计时器：心跳的间隔由测试拨
function fakeTimers(t: TestContext): void {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
}

// 装上遥测组件：over 是替换掉的依赖，config 是组件设置，packaged 是应用信息里的那一项，store 是已有的组件数据
async function rig(over: Partial<TelemetryDeps> = {}, config: Record<string, unknown> = { enabled: true }, packaged = true, store = new Map<string, unknown>()): Promise<Rig> {
  const posted: Beat[] = [];
  const logs: string[] = [];
  const states: TelemetryState[] = [];
  const fail = { on: false };
  const listeners = new Map<string, (data: unknown) => void>();
  const bus = {
    send: (channel: string, data?: unknown): void => {
      const s = channel === STATE ? readState(data) : null;
      if (s) states.push(s);
    },
    on: (channel: string, fn: (data: unknown) => void): (() => void) => { listeners.set(channel, fn); return () => listeners.delete(channel); },
  };
  const storage = {
    get: (key: string): Promise<unknown> => Promise.resolve(store.get(key) ?? null),
    set: (key: string, value: unknown): Promise<void> => { store.set(key, value); return Promise.resolve(); },
    delete: (key: string): Promise<void> => { store.delete(key); return Promise.resolve(); },
  };
  const plugin = telemetry({
    endpoint: URL, env: {}, machineGuid: () => Promise.resolve(GUID),
    post: (_url, beat) => {
      posted.push(beat);
      return fail.on ? Promise.reject(new Error('offline')) : Promise.resolve();
    },
    ...over,
  });
  const settle = (): Promise<void> => new Promise(resolve => { setImmediate(resolve); });
  const root = new Context();
  const fiber = await root.extend({
    id: 'yanuo.telemetry', config, bus, storage,
    app: { info: { version: '1.2.3', packaged } },
    log: (text: string, level = 'info'): void => { logs.push(`${level} ${text}`); },
  }).plugin(plugin as Plugin);
  await settle();
  return { posted, logs, states, store, fail, emit: (channel, data) => listeners.get(channel)?.(data), settle, dispose: async () => { await fiber.dispose(); } };
}

test('遥测组件：装上就按间隔发心跳，带设备标识、会话标识、程序版本；状态给主窗口；卸载后不再发', async t => {
  fakeTimers(t);
  const r = await rig();
  assert.deepEqual(r.logs, ['info heartbeat on']);
  assert.deepEqual(r.states, [{ device: deviceId(GUID), session: r.states[0]?.session, off: null }]);
  assert.equal(r.store.size, 0);
  assert.equal(r.posted.length, 0);
  t.mock.timers.tick(FIRST_MS);
  assert.equal(r.posted.length, 1);
  const beat = r.posted[0];
  assert.deepEqual(beat, { v: 1, device: deviceId(GUID), session: r.states[0]?.session, app: '1.2.3' });
  assert.match(beat?.session ?? '', /^[0-9a-f-]{36}$/);
  t.mock.timers.tick(EVERY_MS * 2);
  assert.equal(r.posted.length, 3);
  assert.equal(new Set(r.posted.map(b => b.session)).size, 1);
  // 主窗口要一份状态
  r.emit(GET);
  assert.equal(r.states.length, 2);
  assert.deepEqual(r.states[1], r.states[0]);
  await r.dispose();
  t.mock.timers.tick(EVERY_MS * 2);
  assert.equal(r.posted.length, 3);
});

test('遥测组件：发不出去只记一行日志，心跳不补发', async t => {
  fakeTimers(t);
  const r = await rig();
  r.fail.on = true;
  t.mock.timers.tick(FIRST_MS);
  t.mock.timers.tick(EVERY_MS);
  await r.settle();
  assert.equal(r.posted.length, 2);
  assert.deepEqual(r.logs, ['info heartbeat on', 'warn heartbeat not sent: offline']);
  r.fail.on = false;
  t.mock.timers.tick(EVERY_MS);
  await r.settle();
  assert.equal(r.posted.length, 3);
  await r.dispose();
});

test('遥测组件：设置里关着、从源码启动、没有接收地址、环境变量关掉时不发', async t => {
  fakeTimers(t);
  const cases: [string, Promise<Rig>][] = [
    ['disabled', rig({}, { enabled: false })],
    ['dev', rig({}, { enabled: true }, false)],
    ['unconfigured', rig({ endpoint: '' })],
    ['env', rig({ env: { FOXPANEL_NO_TELEMETRY: '1' } })],
  ];
  for (const [off, made] of cases) {
    const r = await made;
    assert.equal(r.states.at(-1)?.off, off);
    assert.deepEqual(r.logs, [`info heartbeat off: ${off}`]);
    t.mock.timers.tick(FIRST_MS);
    t.mock.timers.tick(EVERY_MS);
    assert.equal(r.posted.length, 0, off);
    await r.dispose();
  }
});

test('遥测组件：读不到 MachineGuid 时用随机的设备标识，存在组件数据里下次接着用', async t => {
  fakeTimers(t);
  const store = new Map<string, unknown>();
  const first = await rig({ machineGuid: () => Promise.resolve(null) }, { enabled: true }, true, store);
  const device = first.states.at(-1)?.device ?? '';
  assert.match(device, /^[0-9a-f]{64}$/);
  assert.equal(store.get('device'), device);
  await first.dispose();
  const again = await rig({ machineGuid: () => Promise.resolve(null) }, { enabled: true }, true, store);
  assert.equal(again.states.at(-1)?.device, device);
  await again.dispose();
});

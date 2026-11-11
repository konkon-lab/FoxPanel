import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import { AsrStream } from '../components/_bailian/asr.ts';
import asrPlugin from '../components/asr-bailian/src/main.ts';
import { MIC, MIC_ERROR, PCM } from '../components/asr-bailian/src/channels.ts';

const FRAME_BYTES = 3200;   // 100 毫秒的 16 kHz 单声道 16 位 PCM
const RECONNECT_MS = 1000;
const OPTS = { url: 'wss://dashscope.aliyuncs.com/api-ws/v1/inference', model: 'fun-asr-realtime', language: 'zh' };

type Listener = (e: { data?: unknown }) => void;

// 假的 WebSocket：记下地址、请求头和发出的数据，连接、消息、断开由测试触发
class FakeSocket {
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readonly url: string;
  readonly init: unknown;
  readonly sent: (string | Uint8Array)[] = [];
  readyState = 0;
  binaryType = '';
  private readonly listeners = new Map<string, Listener[]>();

  constructor(url: string, init: unknown) {
    this.url = url;
    this.init = init;
    FakeSocket.all.push(this);
  }

  addEventListener(type: string, fn: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
  }

  // 连上并收到 task-started
  begin(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open');
    this.emit('message', { data: '{"header":{"event":"task-started"}}' });
  }

  emit(type: string, e: { data?: unknown } = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }

  get audioBytes(): number {
    return this.sent.reduce((n, d) => n + (typeof d === 'string' ? 0 : d.byteLength), 0);
  }
}

// 换上假的 WebSocket 和假的定时器，测试结束时还原
function useFakes(t: TestContext): void {
  const real = globalThis.WebSocket;
  FakeSocket.all = [];
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => { globalThis.WebSocket = real; });
}

const last = (): FakeSocket => FakeSocket.all.at(-1)!;
const frame = (): Uint8Array<ArrayBuffer> => new Uint8Array(FRAME_BYTES);

// 连不上：每个连接都没到 task-started 就断开，直到放弃；返回一共建过几个连接
function failEveryConnection(t: TestContext): number {
  let closed = 0;
  while (FakeSocket.all.length > closed) {
    FakeSocket.all[closed++]!.close();
    t.mock.timers.tick(RECONNECT_MS);
  }
  return closed;
}

test('识别连接：地址、请求头和 run-task 指令；task-started 之前的音频只缓存最近 50 帧，发出去的才报字节数', t => {
  useFakes(t);
  let sent = 0;
  const texts: [string, boolean][] = [];
  const asr = new AsrStream({ text: (text, final) => texts.push([text, final]), sent: n => { sent += n; }, gaveUp: () => assert.fail('不该放弃'), error: m => assert.fail(m) });
  asr.push(frame());
  assert.equal(FakeSocket.all.length, 0);

  asr.start('sk-test', OPTS);
  const ws = last();
  assert.equal(ws.url, 'wss://dashscope.aliyuncs.com/api-ws/v1/inference');
  assert.deepEqual(ws.init, { headers: { Authorization: 'Bearer sk-test' } });
  assert.equal(ws.binaryType, 'arraybuffer');
  ws.readyState = FakeSocket.OPEN;
  ws.emit('open');
  assert.equal(ws.sent.length, 1);
  const runTask = ws.sent[0] as string;
  const taskId = /"task_id":"([0-9a-f]{32})"/.exec(runTask)?.[1];
  assert.ok(taskId);
  assert.equal(runTask, `{"header":{"action":"run-task","task_id":"${taskId}","streaming":"duplex"},"payload":{"task_group":"audio","task":"asr","function":"recognition",`
    + '"model":"fun-asr-realtime","parameters":{"format":"pcm","sample_rate":16000,"semantic_punctuation_enabled":false,"max_sentence_silence":400,'
    + '"heartbeat":true,"language_hints":["zh"]},"input":{}}}');

  for (let i = 0; i < 60; i++) asr.push(frame());
  assert.equal(ws.audioBytes, 0);
  assert.equal(sent, 0);
  ws.emit('message', { data: '{"header":{"event":"task-started"}}' });
  assert.equal(ws.audioBytes, 50 * FRAME_BYTES);
  assert.equal(sent, 50 * FRAME_BYTES);

  asr.push(frame());
  assert.equal(sent, 51 * FRAME_BYTES);
  ws.emit('message', { data: '{"header":{"event":"result-generated"},"payload":{"output":{"sentence":{"text":"你好。","sentence_end":true}}}}' });
  assert.deepEqual(texts, [['你好。', true]]);

  asr.stop();
  assert.equal(ws.readyState, 3);
  asr.push(frame());
  assert.equal(sent, 51 * FRAME_BYTES);
  t.mock.timers.tick(RECONNECT_MS);
  assert.equal(FakeSocket.all.length, 1);
});

test('识别连接：断线隔 1 秒重连，重连后接着发；连续 5 次没连上就放弃，这期间的音频不算发出', t => {
  useFakes(t);
  let sent = 0;
  let gaveUp = 0;
  const errors: string[] = [];
  const asr = new AsrStream({ text: () => undefined, sent: n => { sent += n; }, gaveUp: () => gaveUp++, error: m => errors.push(m) });

  asr.start('sk-test', OPTS);
  last().begin();
  asr.push(frame());
  last().close();
  asr.push(frame());
  assert.equal(FakeSocket.all.length, 1);
  t.mock.timers.tick(RECONNECT_MS);
  assert.equal(FakeSocket.all.length, 2);
  last().begin();
  assert.equal(sent, 2 * FRAME_BYTES);

  last().close();
  t.mock.timers.tick(RECONNECT_MS);
  for (let i = 0; i < 20; i++) asr.push(frame());
  assert.equal(failEveryConnection(t), 2 + 5);
  assert.equal(gaveUp, 1);
  assert.equal(errors.length, 1);
  assert.equal(sent, 2 * FRAME_BYTES);
  asr.push(frame());
  assert.equal(sent, 2 * FRAME_BYTES);
});

// 听写组件的主进程部分接在假的上下文上；发给远程服务 keyboard 的调用记在 tells 里，keyboard 的状态由 state 给
function mountAsr(config: Record<string, unknown>): {
  input: { start(): void; stop(): void };
  deliver(channel: string, data: unknown): void;
  osc(address: string, value: unknown): void;
  state: { dictating: boolean } | null;
  bus: [string, unknown][];
  usage: unknown[];
  logs: string[];
  tells: unknown[][];
  used: string[];
  ended(): number;
  dispose(): void;
} {
  const listeners: [string, (data: unknown) => void][] = [];
  const oscListeners: [string, (value: unknown) => void][] = [];
  const bus: [string, unknown][] = [];
  const usage: unknown[] = [];
  const logs: string[] = [];
  const tells: unknown[][] = [];
  const used: string[] = [];
  const disposers: (() => void)[] = [];
  let input: { start(): void; stop(): void } | undefined;
  const effect = (fn: () => () => void): void => { disposers.push(fn()); };
  const mounted = {
    state: null as { dictating: boolean } | null,
    deliver: (channel: string, data: unknown) => { for (const [c, fn] of listeners) if (c === channel) fn(data); },
    osc: (address: string, value: unknown) => { for (const [a, fn] of oscListeners) if (a === address) fn(value); },
    bus,
    usage,
    logs,
    tells,
    used,
    ended: () => tells.filter(c => c[0] === 'dictationEnded').length,
    dispose: () => { for (const d of disposers) d(); },
  };
  const ctx = {
    config,
    bus: {
      send: (channel: string, data?: unknown) => { bus.push([channel, data]); },
      on: (channel: string, fn: (data: unknown) => void) => { listeners.push([channel, fn]); return () => undefined; },
    },
    relay: {
      use: (name: string) => {
        used.push(name);
        return {
          get state() { return mounted.state; },
          tell: (...call: unknown[]) => { tells.push(call); },
          call: () => assert.fail('听写组件不等键盘的结果'),
          watch: () => assert.fail('听写组件不监听键盘状态'),
        };
      },
    },
    input: { register: (i: { start(): void; stop(): void }) => { input = i; } },
    log: (text: string) => { logs.push(text); },
    get: (name: string) => (name === 'usage' ? { add: (e: unknown) => { usage.push(e); } } : undefined),
    effect,
    // 跟随静音键的那一段要 osc：给它一个带 osc 的子上下文
    inject: (names: string[], fn: (inner: unknown) => void) => {
      assert.deepEqual(names, ['osc']);
      assert.notEqual(config['followMute'], false, '没开跟随静音，不该要 osc');
      fn({
        effect,
        osc: {
          on: (address: string, f: (value: unknown) => void) => {
            const entry: [string, (value: unknown) => void] = [address, f];
            oscListeners.push(entry);
            return () => { oscListeners.splice(oscListeners.indexOf(entry), 1); };
          },
        },
      });
    },
  };
  assert.equal('inject' in asrPlugin, false);
  asrPlugin.apply(ctx as unknown as MainContext);
  assert.ok(input);
  return Object.assign(mounted, { input });
}

const CONFIG = { apiKey: 'sk-test', domain: '', model: 'fun-asr-realtime', language: 'zh', sendEach: false, followMute: false };

test('听写用量：只按发给百炼的音频记；连不上时一秒都不记', t => {
  useFakes(t);
  const asr = mountAsr(CONFIG);
  asr.input.start();
  assert.deepEqual(asr.bus, [[MIC, true]]);
  for (let i = 0; i < 20; i++) asr.deliver(PCM, new ArrayBuffer(FRAME_BYTES));
  assert.equal(failEveryConnection(t), 5);
  assert.equal(asr.ended(), 1);
  assert.deepEqual(asr.bus, [[MIC, true], [MIC, false]]);
  assert.deepEqual(asr.usage, []);
  asr.deliver(PCM, new ArrayBuffer(FRAME_BYTES));
  asr.input.stop();
  assert.deepEqual(asr.usage, []);
});

test('听写用量：停下时记一次，累计满 10 秒也记一次；缓存里补发的帧算在内', t => {
  useFakes(t);
  const asr = mountAsr(CONFIG);
  asr.input.start();
  // 1 秒的音频在 task-started 之前到，随后补发
  for (let i = 0; i < 10; i++) asr.deliver(PCM, new ArrayBuffer(FRAME_BYTES));
  last().begin();
  assert.equal(last().audioBytes, 10 * FRAME_BYTES);
  // 视图只算它自己的那一段
  asr.deliver(PCM, new Uint8Array(new ArrayBuffer(FRAME_BYTES * 3), FRAME_BYTES, FRAME_BYTES));
  asr.deliver(PCM, 'not audio');
  assert.equal(last().audioBytes, 11 * FRAME_BYTES);
  assert.deepEqual(asr.usage, []);
  asr.input.stop();
  assert.deepEqual(JSON.parse(JSON.stringify(asr.usage)), [{ item: 'fun-asr-realtime', amount: { seconds: 1.1 }, cost: 1.1 * 0.00033 }]);
  asr.deliver(PCM, new ArrayBuffer(FRAME_BYTES));
  assert.equal(asr.usage.length, 1);

  asr.input.start();
  last().begin();
  for (let i = 0; i < 105; i++) asr.deliver(PCM, new ArrayBuffer(FRAME_BYTES));
  assert.deepEqual(asr.usage[1], { item: 'fun-asr-realtime', amount: { seconds: 10 }, cost: 10 * 0.00033 });
  asr.dispose();
  assert.deepEqual(asr.usage[2], { item: 'fun-asr-realtime', amount: { seconds: 0.5 }, cost: 0.5 * 0.00033 });
  assert.equal(asr.ended(), 0);
});

test('听写：没填密钥不开麦克风；麦克风打不开时停下并告诉键盘', t => {
  useFakes(t);
  const noKey = mountAsr({ ...CONFIG, apiKey: '' });
  noKey.input.start();
  assert.deepEqual(noKey.bus, []);
  assert.equal(noKey.ended(), 1);
  assert.deepEqual(noKey.logs, ['bailian api key not set']);
  assert.equal(FakeSocket.all.length, 0);

  const asr = mountAsr(CONFIG);
  asr.input.start();
  asr.deliver(MIC_ERROR, 'Permission denied');
  assert.equal(asr.ended(), 1);
  assert.deepEqual(asr.bus, [[MIC, true], [MIC, false]]);
  assert.equal(last().readyState, 3);
  asr.deliver(MIC_ERROR, 'again');
  assert.equal(asr.ended(), 1);
});

test('听写：识别结果和每句发送按先后经远程服务 keyboard 发，没开每句发送时只发结果', t => {
  useFakes(t);
  const sentence = (text: string, end: boolean): { data: string } => ({ data: JSON.stringify({ header: { event: 'result-generated' }, payload: { output: { sentence: { text, sentence_end: end } } } }) });
  const each = mountAsr({ ...CONFIG, sendEach: true });
  assert.deepEqual(each.used, ['keyboard']);
  each.input.start();
  last().begin();
  last().emit('message', sentence('你', false));
  last().emit('message', sentence('你好。', true));
  assert.deepEqual(each.tells, [['dictated', '你', false], ['dictated', '你好。', true], ['act', { kind: 'send' }]]);
  each.input.stop();
  assert.equal(each.ended(), 0);

  const plain = mountAsr(CONFIG);
  plain.input.start();
  last().begin();
  last().emit('message', sentence('再见。', true));
  assert.deepEqual(plain.tells, [['dictated', '再见。', true]]);
  plain.dispose();
});

test('听写：跟随 VRChat 静音键，取消静音时没在听写就开，静音时在听写就停；键盘没有状态时不动', t => {
  useFakes(t);
  const MUTE = '/avatar/parameters/MuteSelf';
  const toggle = ['act', { kind: 'dictate' }];
  const asr = mountAsr({ ...CONFIG, followMute: true });
  asr.osc(MUTE, false);
  assert.deepEqual(asr.tells, []);

  asr.state = { dictating: false };
  asr.osc(MUTE, true);
  asr.osc('/avatar/parameters/Other', false);
  assert.deepEqual(asr.tells, []);
  asr.osc(MUTE, false);
  assert.deepEqual(asr.tells, [toggle]);

  asr.state = { dictating: true };
  asr.osc(MUTE, 0);
  assert.deepEqual(asr.tells, [toggle]);
  asr.osc(MUTE, 1);
  asr.osc(MUTE, true);
  assert.deepEqual(asr.tells, [toggle, toggle, toggle]);

  asr.dispose();
  asr.osc(MUTE, true);
  assert.deepEqual(asr.tells, [toggle, toggle, toggle]);
});

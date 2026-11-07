import test from 'node:test';
import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { once } from 'node:events';
import type { MainContext, OscArg, OscService, StatusItem } from '@konkon-lab/foxpanel-sdk';
import { encodeMessage, type OscMessage } from '../components/osc/src/codec.ts';
import { OscLink } from '../components/osc/src/link.ts';
import oscComponent from '../components/osc/src/main.ts';

const LOCAL = '127.0.0.1';

// 等条件成立，超时抛出
async function until(ok: () => boolean, ms = 3000): Promise<void> {
  const end = performance.now() + ms;
  while (!ok()) {
    if (performance.now() > end) throw new Error('等待超时');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

// 占住一个本机 UDP 端口
async function occupy(port = 0): Promise<dgram.Socket> {
  const s = dgram.createSocket('udp4');
  s.bind(port, LOCAL);
  await once(s, 'listening');
  return s;
}

const close = (s: dgram.Socket): Promise<void> => new Promise(resolve => s.close(() => resolve()));

// 一个空着的端口
async function freePort(): Promise<number> {
  const s = await occupy();
  const { port } = s.address();
  await close(s);
  return port;
}

// 按 OSC 规则编码：字符串 0 结尾并补齐到 4 字节
function pad(s: string): Buffer {
  const b = Buffer.from(s + '\0');
  return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]);
}

function bundle(...msgs: Buffer[]): Buffer {
  const parts = msgs.flatMap(m => {
    const size = Buffer.alloc(4);
    size.writeInt32BE(m.length);
    return [size, m];
  });
  return Buffer.concat([pad('#bundle'), Buffer.alloc(8), ...parts]);
}

test('接收：没人订的地址不交给回调，bundle 里只交有人订的，原包全部转出', async () => {
  const got: OscMessage[] = [];
  const asked: string[] = [];
  let raw = 0;
  const link = new OscLink({
    wants: address => {
      asked.push(address);
      return address === '/wanted';
    },
    onMessage: m => got.push(m),
    onRaw: () => { raw++; },
    onError: () => {},
  });
  await link.start(0);
  const port = link.udpPort;
  assert.ok(port);
  const out = dgram.createSocket('udp4');
  const packets = [
    encodeMessage('/other', [1]),
    encodeMessage('/wanted', [true]),
    bundle(encodeMessage('/wanted', [0.5]), encodeMessage('/other', [2])),
    Buffer.from('没有结尾的坏包'),
  ];
  for (const p of packets) out.send(p, port, LOCAL);
  await until(() => raw === packets.length);
  assert.deepEqual(got, [{ address: '/wanted', args: [true] }, { address: '/wanted', args: [0.5] }]);
  assert.equal(asked.filter(a => a === '/other').length, 2);   // 单条消息问一次(不解码)，bundle 里的问一次
  assert.ok(link.lastAt > 0);
  await close(out);
  await link.stop();
  assert.equal(link.udpPort, null);
});

test('接收：端口被占时启动失败并关掉套接字，端口空出后同一个对象还能启动', async () => {
  const blocker = await occupy();
  const { port } = blocker.address();
  const link = new OscLink({ wants: () => false, onMessage: () => {}, onRaw: () => {}, onError: () => {} });
  await assert.rejects(link.start(port));
  assert.equal(link.udpPort, null);
  await close(blocker);
  await link.start(port);
  assert.equal(link.udpPort, port);
  await link.stop();
});

interface Fake {
  osc: OscService;
  logs: { text: string; level: string }[];
  status: StatusItem[];
  dispose(): void;
}

// 用假的宿主上下文加载 OSC 组件
function load(config: Record<string, unknown>): Fake {
  const logs: Fake['logs'] = [];
  const status: StatusItem[] = [];
  const disposers: (() => void)[] = [];
  let osc: OscService | null = null;
  const ctx = {
    config,
    log: (text: string, level = 'info') => { logs.push({ text, level }); },
    status: { set: (item: StatusItem) => { status.push(item); } },
    provide: (_name: string, service: OscService) => { osc = service; },
    effect: (fn: () => () => void) => { disposers.push(fn()); },
  };
  oscComponent.apply(ctx as unknown as MainContext);
  assert.ok(osc);
  return { osc, logs, status, dispose: () => disposers.forEach(d => d()) };
}

const has = (f: Fake, part: string): boolean => f.logs.some(l => l.text.includes(part));

test('OSC 服务：有订阅才开接收，一个订阅出错不影响别的，都取消后关掉', async () => {
  const port = await freePort();
  const f = load({ mode: 'fixed', port });
  assert.equal(f.status.at(-1)?.led, 'idle');
  const got: OscArg[][] = [];
  const offBad = f.osc.on('/a', () => { throw new Error('坏订阅'); });
  const offGood = f.osc.on('/a', (...args) => { got.push(args); });
  const offOther = f.osc.on('/b', (...args) => { got.push(args); });
  await until(() => has(f, `receiver on fixed port ${port}`));
  assert.equal(f.status.at(-1)?.led, 'wait');

  const out = dgram.createSocket('udp4');
  out.send(encodeMessage('/a', [1, true]), port, LOCAL);
  out.send(encodeMessage('/c', [2]), port, LOCAL);
  out.send(encodeMessage('/b', ['x']), port, LOCAL);
  await until(() => got.length === 2);
  assert.deepEqual(got, [[1, true], ['x']]);
  assert.ok(has(f, 'listener of /a: 坏订阅'));

  offBad();
  offGood();
  assert.equal(has(f, 'receiver stopped'), false);   // 还有 /b 的订阅
  offOther();
  await until(() => has(f, 'receiver stopped'));
  await close(out);
  f.dispose();
});

test('OSC 服务：端口被占时同一个错误只记一次，过了重试间隔端口空出就接上', async t => {
  t.mock.timers.enable({ apis: ['setInterval', 'Date'] });
  const blocker = await occupy();
  const { port } = blocker.address();
  const f = load({ mode: 'fixed', port });
  const off = f.osc.on('/a', () => {});
  const failures = (): number => f.logs.filter(l => l.text.startsWith('cannot start receiver')).length;
  await until(() => failures() === 1);
  assert.equal(f.logs.find(l => l.text.startsWith('cannot start receiver'))?.level, 'error');

  // 端口还被占着：到了重试时间又失败一次，不重复记
  const before = f.status.length;
  t.mock.timers.tick(10_000);
  await until(() => f.status.length >= before + 6);   // 定时刷新 5 次，重试结束后另报一次
  assert.equal(failures(), 1);
  assert.equal(has(f, 'receiver on'), false);

  await close(blocker);
  t.mock.timers.tick(10_000);
  await until(() => has(f, `receiver on fixed port ${port}`));

  off();
  await until(() => has(f, 'receiver stopped'));
  f.dispose();
});

test('OSC 服务：卸载时关掉还开着的接收', async () => {
  const port = await freePort();
  const target = await occupy();
  const f = load({ mode: 'fixed', port, forward: true, forwardPorts: [target.address().port] });
  await until(() => has(f, `receiver on fixed port ${port}`));   // 开了转发，没有订阅也接收
  const forwarded = once(target, 'message');
  const out = dgram.createSocket('udp4');
  const packet = encodeMessage('/avatar/parameters/X', [1]);
  out.send(packet, port, LOCAL);
  const [buf] = await forwarded as [Buffer];
  assert.deepEqual(buf, packet);
  f.dispose();
  await until(() => has(f, 'receiver stopped'));
  // 端口已经放开
  const again = await occupy(port);
  await close(again);
  await close(out);
  await close(target);
});

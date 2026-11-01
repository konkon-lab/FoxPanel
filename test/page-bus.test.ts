import test from 'node:test';
import assert from 'node:assert/strict';
import { BUS_MAX, CHANNEL_LENGTH_MAX, CHANNELS_MAX, PageBus } from '../src/main/page-bus.ts';
import { plainSize } from '../src/main/payload.ts';
import { Senders } from '../src/main/senders.ts';

// 测试里的页面(webContents 的 id)
const MEDIA = 2;
const SHELL = 3;
const CLOCK = 4;
const NOTES = 5;

interface Rig {
  bus: PageBus;
  senders: Senders;
  sent: [number, string, unknown][];   // 发给页面的消息(页面、频道、数据)
  logs: string[];                      // 「级别: 内容」
  clock: { now: number };
}

function rig(): Rig {
  const senders = new Senders();
  senders.add(1, 'window');
  senders.add(MEDIA, 'media', ['a.asr']);
  senders.addPanel(SHELL, 'a.shell', ['a.shell'], []);
  senders.addPanel(CLOCK, 'a.clock', ['a.clock'], []);
  senders.addPanel(NOTES, 'a.notes', ['a.notes'], []);
  const sent: Rig['sent'] = [];
  const logs: string[] = [];
  const clock = { now: 1_000_000 };
  const bus = new PageBus({
    senders, now: () => clock.now,
    send: (page, channel, data) => { sent.push([page, channel, data]); },
    log: (text, level = 'info') => { logs.push(`${level}: ${text}`); },
  });
  return { bus, senders, sent, logs, clock };
}

test('数据的大小：存成 JSON 的字节数，二进制按字节数，BigInt 按十进制数字；有普通数据以外的值或循环引用时算不出', () => {
  assert.equal(plainSize('abc'), 5);
  assert.equal(plainSize('中'), 5);
  assert.equal(plainSize({ a: 1, b: [true, null] }), Buffer.byteLength('{"a":1,"b":[true,null]}'));
  assert.equal(plainSize(undefined), 4);
  assert.equal(plainSize(123n), 5);
  assert.equal(plainSize(new Uint8Array(1000)), 1004);
  assert.equal(plainSize({ pcm: new Int16Array(100).buffer }), Buffer.byteLength('{"pcm":null}') + 200);
  assert.equal(plainSize(Object.assign(Object.create(null) as object, { a: 1 })), 7);
  const loop: Record<string, unknown> = {};
  loop['self'] = loop;
  for (const v of [new Map(), new Set([1]), new Error('x'), /x/, loop, { deep: [new Map()] }]) assert.equal(plainSize(v), null);
  // 日期存成 JSON 是一个字符串
  assert.equal(plainSize(new Date(0)), Buffer.byteLength(JSON.stringify(new Date(0))));
});

test('投递：一条消息只送到登记了这个频道的页面，不发回发出它的页面；没登记的页面什么都收不到', () => {
  const r = rig();
  r.bus.listen(MEDIA, 'a.asr/mic', true);
  r.bus.listen(CLOCK, 'a.clock/tick', true);
  r.bus.listen(SHELL, 'a.shell/x', true);
  const pcm = new Uint8Array([1, 2, 3]);
  r.bus.deliver('a.asr/mic', pcm);
  assert.deepEqual(r.sent, [[MEDIA, 'a.asr/mic', pcm]]);
  r.sent.length = 0;
  r.bus.deliver('a.clock/tick', 1, CLOCK);
  r.bus.deliver('a.asr/mic', 2, MEDIA);
  r.bus.deliver('a.asr/pcm', 3);
  r.bus.deliver('a.clock/tick', 4, SHELL);
  assert.deepEqual(r.sent, [[CLOCK, 'a.clock/tick', 4]]);
  // 核心的通知也只送到登记了它的页面；几个页面登记了同一个频道时各收一份
  r.sent.length = 0;
  r.bus.listen(NOTES, 'core/component-removed', true);
  r.bus.listen(CLOCK, 'core/component-removed', true);
  r.bus.deliver('core/component-removed', 'a.gone');
  assert.deepEqual(r.sent, [[CLOCK, 'core/component-removed', 'a.gone'], [NOTES, 'core/component-removed', 'a.gone']]);
});

test('登记：取消后收不到；重复登记只算一次；频道名不是字符串、空的、太长的不登记', () => {
  const r = rig();
  r.bus.listen(CLOCK, 'a.clock/tick', true);
  r.bus.listen(CLOCK, 'a.clock/tick', true);
  r.bus.deliver('a.clock/tick', 1);
  assert.equal(r.sent.length, 1);
  r.bus.listen(CLOCK, 'a.clock/tick', false);
  r.bus.listen(CLOCK, 'a.clock/never', false);
  r.bus.deliver('a.clock/tick', 2);
  assert.equal(r.sent.length, 1);
  // on 不是 true 的当成取消
  r.bus.listen(CLOCK, 'a.clock/tick', true);
  r.bus.listen(CLOCK, 'a.clock/tick', 'yes');
  r.bus.deliver('a.clock/tick', 3);
  assert.equal(r.sent.length, 1);
  const long = 'c'.repeat(CHANNEL_LENGTH_MAX);
  for (const channel of [undefined, 5, '', ['a.clock/tick'], `${long}x`]) r.bus.listen(CLOCK, channel, true);
  r.bus.listen(CLOCK, long, true);
  r.bus.deliver(`${long}x`, 4);
  r.bus.deliver('', 5);
  r.bus.deliver(long, 6);
  assert.deepEqual(r.sent.slice(1), [[CLOCK, long, 6]]);
});

test('登记：一个页面最多登记 CHANNELS_MAX 个频道，多的不登记并写警告；取消一个之后能再登记', () => {
  const r = rig();
  for (let i = 0; i < CHANNELS_MAX; i++) r.bus.listen(CLOCK, `a.clock/${i}`, true);
  r.bus.listen(CLOCK, 'a.clock/extra', true);
  r.bus.listen(CLOCK, 'a.clock/more', true);
  r.bus.deliver('a.clock/extra', 1);
  r.bus.deliver('a.clock/0', 2);
  assert.deepEqual(r.sent, [[CLOCK, 'a.clock/0', 2]]);
  // 警告按原因限频：频道名每次不同也只写一行
  assert.deepEqual(r.logs, ['warn: bus: a page listens to more than 256 channels, a.clock/extra ignored']);
  for (let i = 0; i < 50; i++) r.bus.listen(CLOCK, `a.clock/over${i}`, true);
  assert.equal(r.logs.length, 1);
  r.clock.now += 10_000;
  r.bus.listen(CLOCK, 'a.clock/later', true);
  assert.deepEqual(r.logs.slice(1), ['warn: bus: a page listens to more than 256 channels, a.clock/later ignored']);
  // 已经登记的再登记一次不算超
  r.bus.listen(CLOCK, 'a.clock/1', true);
  assert.equal(r.logs.length, 2);
  // 别的页面各算各的
  r.bus.listen(NOTES, 'a.clock/extra', true);
  r.bus.listen(CLOCK, 'a.clock/0', false);
  r.bus.listen(CLOCK, 'a.clock/extra', true);
  r.sent.length = 0;
  r.bus.deliver('a.clock/extra', 3);
  assert.deepEqual(r.sent, [[CLOCK, 'a.clock/extra', 3], [NOTES, 'a.clock/extra', 3]]);
});

test('页面重新加载或销毁：它登记的频道都清掉；注销了的页面不投递', () => {
  const r = rig();
  r.bus.listen(CLOCK, 'a.clock/tick', true);
  r.bus.listen(NOTES, 'a.clock/tick', true);
  r.bus.drop(CLOCK);
  r.bus.drop(99);
  r.bus.deliver('a.clock/tick', 1);
  assert.deepEqual(r.sent, [[NOTES, 'a.clock/tick', 1]]);
  // 重新加载之后页面再登记
  r.bus.listen(CLOCK, 'a.clock/tick', true);
  r.senders.remove(NOTES);
  r.sent.length = 0;
  r.bus.deliver('a.clock/tick', 2);
  assert.deepEqual(r.sent, [[CLOCK, 'a.clock/tick', 2]]);
  // 同一个 id 之后登记成别的页面：之前登记的频道不算
  r.senders.addPanel(NOTES, 'a.todo', ['a.todo'], []);
  r.sent.length = 0;
  r.bus.deliver('a.clock/tick', 3);
  assert.deepEqual(r.sent, [[CLOCK, 'a.clock/tick', 3]]);
});

test('页面发来的消息：核心的频道不转发；存成 JSON 超过 256 KB 或有普通数据以外的值的不转发；都写警告(同一种原因 10 秒一次)', () => {
  const r = rig();
  assert.equal(BUS_MAX, 256 * 1024);
  assert.ok(r.bus.accepts('a.clock/tick', { n: 1 }));
  assert.ok(r.bus.accepts('a.clock/tick', undefined));
  assert.ok(r.bus.accepts('free', 'x'));
  assert.ok(r.bus.accepts('corelike/x', 1));
  assert.ok(r.bus.accepts('a.asr/pcm', new Int16Array(3200)));
  assert.deepEqual(r.logs, []);
  // 核心的频道
  assert.ok(!r.bus.accepts('core/component-removed', 'a.x'));
  assert.ok(!r.bus.accepts('core/', null));
  // 大小：正好 256 KB 的收，多一个字节的不收；二进制按字节数
  const fits = 'x'.repeat(BUS_MAX - 2);
  assert.ok(r.bus.accepts('a.clock/big', fits));
  assert.ok(!r.bus.accepts('a.clock/big', `${fits}x`));
  assert.ok(r.bus.accepts('a.clock/bin', new Uint8Array(BUS_MAX - 4)));
  assert.ok(!r.bus.accepts('a.clock/bin', new Uint8Array(BUS_MAX)));
  // 普通数据以外的值
  assert.ok(!r.bus.accepts('a.clock/map', new Map([[1, 2]])));
  assert.deepEqual(r.logs, [
    'warn: bus message on core/component-removed dropped: pages cannot send on core channels',
    'warn: bus message on a.clock/big dropped: it is over 256 KB',
    'warn: bus message on a.clock/map dropped: it holds something other than plain data',
  ]);
  r.clock.now += 9_999;
  assert.ok(!r.bus.accepts('core/component-removed', 'a.x'));
  assert.equal(r.logs.length, 3);
  r.clock.now += 1;
  assert.ok(!r.bus.accepts('core/component-removed', 'a.x'));
  assert.equal(r.logs.length, 4);
});

test('页面发来的消息：频道名不是字符串、是空串或超过 200 个字符的不转发，数据再小也一样', () => {
  const r = rig();
  for (const channel of [undefined, 5, '', ['a.clock/tick'], { toString: () => 'a.clock/tick' }]) assert.ok(!r.bus.accepts(channel, 1));
  const long = `a.clock/${'x'.repeat(CHANNEL_LENGTH_MAX - 8)}`;
  assert.equal(long.length, CHANNEL_LENGTH_MAX);
  assert.ok(r.bus.accepts(long, 1));
  assert.ok(!r.bus.accepts(`${long}x`, 1));
  assert.ok(!r.bus.accepts(`a.clock/${'x'.repeat(2 * 1024 * 1024)}`, 1));
  assert.deepEqual(r.logs, ['warn: bus message dropped: the channel name has to be a string of 1 to 200 characters']);
});

test('页面发来的消息：警告按原因限频，页面给的频道名每次不同也只写一行；一行警告里没有超长的频道名', () => {
  const r = rig();
  const big = 'y'.repeat(BUS_MAX);
  for (let i = 0; i < 100; i++) {
    assert.ok(!r.bus.accepts(`a.clock/LOG${i}`, big));
    assert.ok(!r.bus.accepts(`core/${i}`, 1));
    assert.ok(!r.bus.accepts(`a.clock/m${i}`, new Set([i])));
    assert.ok(!r.bus.accepts(`a.clock/${'z'.repeat(50_000)}${i}`, big));
  }
  assert.deepEqual(r.logs, [
    'warn: bus message on a.clock/LOG0 dropped: it is over 256 KB',
    'warn: bus message on core/0 dropped: pages cannot send on core channels',
    'warn: bus message on a.clock/m0 dropped: it holds something other than plain data',
    'warn: bus message dropped: the channel name has to be a string of 1 to 200 characters',
  ]);
  // 最长的合格频道名写进警告：一行不超过三百个字符
  r.clock.now += 10_000;
  assert.ok(!r.bus.accepts('c'.repeat(CHANNEL_LENGTH_MAX), new Map()));
  assert.equal(r.logs.length, 5);
  assert.ok(r.logs.every(l => l.length < 300));
});

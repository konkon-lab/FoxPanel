import test from 'node:test';
import assert from 'node:assert/strict';
import { createBus, storageOver } from '../src/shared/component-services.ts';
import type { StorageOp } from '../src/shared/host-protocol.ts';

test('总线：send 送给本环境的监听并转发；转来的消息只送本环境；一个监听出错不影响别的', () => {
  const forwarded: [string, unknown][] = [];
  const errors: string[] = [];
  const hub = createBus((channel, data) => forwarded.push([channel, data]), (channel, e) => errors.push(`${channel}: ${String(e)}`));
  const a = hub.open();
  const b = hub.open();
  const got: string[] = [];
  a.bus.on('x', () => { throw new Error('boom'); });
  a.bus.on('x', d => got.push(`a:${String(d)}`));
  b.bus.on('x', d => got.push(`b:${String(d)}`));
  b.bus.on('y', d => got.push(`y:${String(d)}`));
  a.bus.send('x', 1);
  assert.deepEqual(got, ['a:1', 'b:1']);
  assert.deepEqual(forwarded, [['x', 1]]);
  assert.deepEqual(errors, ['x: Error: boom']);
  hub.deliver('y', 2);
  assert.deepEqual(got, ['a:1', 'b:1', 'y:2']);
  assert.equal(forwarded.length, 1);
});

test('总线：on 返回的函数取消这一个监听；close 取消这个组件的全部监听，别的组件的还在', () => {
  const hub = createBus(() => undefined, () => undefined);
  const a = hub.open();
  const b = hub.open();
  const got: string[] = [];
  const off = a.bus.on('x', () => got.push('a1'));
  a.bus.on('x', () => got.push('a2'));
  a.bus.on('y', () => got.push('a3'));
  b.bus.on('x', () => got.push('b'));
  off();
  hub.deliver('x', null);
  assert.deepEqual(got, ['a2', 'b']);
  a.close();
  hub.deliver('x', null);
  hub.deliver('y', null);
  assert.deepEqual(got, ['a2', 'b', 'b']);
  // 关掉之后还能发，再登记的监听照常收
  a.bus.on('x', () => got.push('again'));
  b.bus.send('x');
  assert.deepEqual(got, ['a2', 'b', 'b', 'b', 'again']);
});

test('组件数据的接口：get / set / delete 各转成一次调用，get 给出调用的结果', async () => {
  const calls: StorageOp[] = [];
  const storage = storageOver(op => {
    calls.push(op);
    return Promise.resolve(op.op === 'get' ? { n: 1 } : 'ignored');
  });
  assert.deepEqual(await storage.get('k'), { n: 1 });
  assert.equal(await storage.set('k', [1]), undefined);
  assert.equal(await storage.delete('k'), undefined);
  assert.deepEqual(calls, [{ op: 'get', key: 'k' }, { op: 'set', key: 'k', value: [1] }, { op: 'delete', key: 'k' }]);
});

test('总线：一个频道有了第一个监听时登记一次，最后一个取消时取消登记；各频道各算各的，取消两次不重复', () => {
  const listened: [string, boolean][] = [];
  const hub = createBus(() => undefined, () => undefined, (channel, on) => listened.push([channel, on]));
  const a = hub.open();
  const b = hub.open();
  const offA = a.bus.on('x', () => undefined);
  const offB = b.bus.on('x', () => undefined);
  a.bus.on('y', () => undefined);
  assert.deepEqual(listened, [['x', true], ['y', true]]);
  offA();
  offA();
  assert.deepEqual(listened.length, 2);
  offB();
  assert.deepEqual(listened.slice(2), [['x', false]]);
  // 取消登记之后再有人监听：重新登记
  b.bus.on('x', () => undefined);
  b.bus.on('y', () => undefined);
  assert.deepEqual(listened.slice(3), [['x', true]]);
  // 组件卸载：它是最后一个监听的频道取消登记，别人还在听的不取消
  b.close();
  assert.deepEqual(listened.slice(4), [['x', false]]);
  a.close();
  assert.deepEqual(listened.slice(5), [['y', false]]);
  // 关掉之后 on 返回的取消函数不会重复取消登记
  const late = a.bus.on('z', () => undefined);
  a.close();
  late();
  assert.deepEqual(listened.slice(6), [['z', true], ['z', false]]);
});

test('总线：不给登记函数时照常收发(组件进程和主窗口)', () => {
  const hub = createBus(() => undefined, () => undefined);
  const got: unknown[] = [];
  const { bus, close } = hub.open();
  bus.on('x', d => got.push(d));
  hub.deliver('x', 1);
  close();
  hub.deliver('x', 2);
  assert.deepEqual(got, [1]);
});

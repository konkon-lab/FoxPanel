import test from 'node:test';
import assert from 'node:assert/strict';
import { Owned } from '../src/component-host/owned.ts';

test('组件占用的东西：卸载时按记下的相反次序逐项放掉，放完清空；单独放掉的那一项不放第二次', () => {
  const owned = new Owned();
  const done: string[] = [];
  owned.add(() => done.push('a'));
  const dropB = owned.add(() => done.push('b'));
  owned.add(() => done.push('c'));
  assert.equal(owned.size, 3);
  dropB();
  assert.deepEqual([done, owned.size], [['b'], 2]);
  const ran: string[] = [];
  owned.release(fn => {
    ran.push('run');
    fn();
  });
  assert.deepEqual([done, ran, owned.size], [['b', 'c', 'a'], ['run', 'run'], 0]);
  owned.release(fn => fn());
  assert.equal(done.length, 3);
});

test('组件占用的东西：hold 记下的一项卸载时放掉；forget 之后不放，项数不随反复记下、拿掉而增长', () => {
  const owned = new Owned();
  let closed = 0;
  for (let i = 0; i < 100; i++) owned.hold(() => closed++).forget();
  assert.equal(owned.size, 0);
  const kept = owned.hold(() => closed++);
  assert.equal(owned.size, 1);
  owned.release(fn => fn());
  assert.equal(closed, 1);
  // 放掉之后再 forget：什么都不做
  kept.forget();
  owned.release(fn => fn());
  assert.equal(closed, 1);
});

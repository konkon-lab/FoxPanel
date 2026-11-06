import test from 'node:test';
import assert from 'node:assert/strict';
import { createSettle } from '../components/_shared/window/settle.ts';

test('待交的值：停下够久才交，只交最新的一个', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const got: number[] = [];
  const settle = createSettle<number>(300, v => got.push(v));
  settle.push(1);
  t.mock.timers.tick(299);
  settle.push(2);
  t.mock.timers.tick(299);
  assert.deepEqual(got, []);
  t.mock.timers.tick(1);
  assert.deepEqual(got, [2]);
  t.mock.timers.tick(1000);
  assert.deepEqual(got, [2]);

  // 同一个值隔开拖出两次，各交一次
  settle.push(2);
  t.mock.timers.tick(300);
  assert.deepEqual(got, [2, 2]);
});

test('待交的值：flush 立刻交没交的那个，之后到时间不重复交；没有待交的值时什么都不做', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const got: number[] = [];
  const settle = createSettle<number>(300, v => got.push(v));
  settle.flush();
  assert.deepEqual(got, []);

  settle.push(1);
  settle.push(5);
  t.mock.timers.tick(100);
  settle.flush();
  assert.deepEqual(got, [5]);
  settle.flush();
  t.mock.timers.tick(1000);
  assert.deepEqual(got, [5]);

  // 到时间交过之后 flush 也不重复交
  settle.push(7);
  t.mock.timers.tick(300);
  settle.flush();
  assert.deepEqual(got, [5, 7]);
});

test('待交的值：交的过程中记下的新值照常等着交', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const got: number[] = [];
  const settle = createSettle<number>(300, v => {
    got.push(v);
    if (v === 1) settle.push(2);
  });
  settle.push(1);
  settle.flush();
  assert.deepEqual(got, [1]);
  t.mock.timers.tick(300);
  assert.deepEqual(got, [1, 2]);
});

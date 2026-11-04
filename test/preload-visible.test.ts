import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { visibleState } from '../src/preload/visible.ts';

const ROOT = path.resolve(import.meta.dirname, '..');

test('面板是不是正被显示：宿主还没发来时算在显示，登记的回调马上得到一次', () => {
  const state = visibleState();
  const got: boolean[] = [];
  state.watch(on => got.push(on));
  assert.deepEqual(got, [true]);
});

test('面板是不是正被显示：宿主每次发来都告诉全部回调；后登记的回调先得到最近一次的值', () => {
  const state = visibleState();
  const first: boolean[] = [];
  const second: boolean[] = [];
  state.watch(on => first.push(on));
  state.receive(false);
  assert.deepEqual(first, [true, false]);
  // 停着画的时候才登记：得到的是 false，不是一开始的 true
  state.watch(on => second.push(on));
  assert.deepEqual(second, [false]);
  state.receive(true);
  state.receive(true);
  assert.deepEqual([first, second], [[true, false, true, true], [false, true, true]]);
});

test('面板是不是正被显示：宿主发来的值只有 true 算在显示', () => {
  const state = visibleState();
  const got: boolean[] = [];
  state.watch(on => got.push(on));
  for (const raw of [1, 'true', null, undefined, {}, false]) state.receive(raw);
  assert.deepEqual(got, [true, false, false, false, false, false, false]);
  state.receive(true);
  assert.equal(got.at(-1), true);
});

test('窄 preload：onVisible 用的就是这一份，宿主的显示通知交给它', () => {
  const source = fs.readFileSync(path.join(ROOT, 'src', 'preload', 'page.ts'), 'utf8');
  assert.match(source, /ipcRenderer\.on\(PAGE_IPC\.visibleEvent, \(_e, on: unknown\) => visible\.receive\(on\)\)/);
  assert.match(source, /onVisible: fn => visible\.watch\(fn\)/);
  // 不导入 electron 的那一份才能直接测
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src', 'preload', 'visible.ts'), 'utf8'), /from 'electron'/);
});

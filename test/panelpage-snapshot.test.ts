import test from 'node:test';
import assert from 'node:assert/strict';
import { reactive, watch } from 'vue';
import type { KeyboardState } from '@konkon-lab/foxpanel-sdk';
import { EMPTY_KEYBOARD } from '../components/ime/src/empty.ts';
import { applySnapshot, sameValue } from '../src/panel/relay.ts';

// 主进程每次推来的都是结构化克隆出来的新对象
const snapshot = (patch: Partial<KeyboardState> = {}): KeyboardState => structuredClone({ ...EMPTY_KEYBOARD, ...patch });

test('状态快照：内容相同的 JSON 值算相同，键、长度、类型不同都算不同', () => {
  assert.ok(sameValue({ a: [1, { b: 'x' }], c: null }, { a: [1, { b: 'x' }], c: null }));
  assert.ok(sameValue([], []));
  assert.ok(!sameValue({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!sameValue({ a: undefined }, { b: 1 }));
  assert.ok(!sameValue([1, 2], [1, 2, 3]));
  assert.ok(!sameValue([], {}));
  assert.ok(!sameValue({ a: 1 }, null));
  assert.ok(!sameValue({ a: '1' }, { a: 1 }));
});

test('状态快照：写进去后内容等于最新快照，响应式对象还是同一个', () => {
  const kb = reactive<KeyboardState>(snapshot());
  const pack = { ...EMPTY_KEYBOARD.pack, id: 'yanuo.lang-en', short: 'EN', keycaps: { q: ['й', 'Й'] as const } };
  const next = snapshot({ ready: true, lang: pack.id, packs: [pack], pack, text: 'abc', caret: 3, candidates: [{ index: 0, text: '你' }], outputs: [{ id: 'o', name: 'O', on: true }] });
  const before = kb;
  applySnapshot(kb, next);
  assert.equal(kb, before);
  assert.deepEqual(JSON.parse(JSON.stringify(kb)), JSON.parse(JSON.stringify(next)));
});

test('状态快照：只有内容变了的字段触发依赖', () => {
  const kb = reactive<KeyboardState>(snapshot());
  const first = snapshot({ ready: true, text: 'a', caret: 1, candidates: [{ index: 0, text: '你' }], outputs: [{ id: 'o', name: 'O', on: true }] });
  applySnapshot(kb, first);
  const fired: string[] = [];
  const fields = ['packs', 'pack', 'mode', 'candidates', 'outputs', 'settings', 'text', 'caret'] as const;
  const stops = fields.map(f => watch(() => kb[f], () => fired.push(f), { flush: 'sync' }));
  const packsBefore = kb.packs;
  const settingsBefore = kb.settings;

  // 只打了一个字：对象字段都是新引用但内容没变
  applySnapshot(kb, snapshot({ ...first, text: 'ab', caret: 2 }));
  assert.deepEqual(fired, ['text', 'caret']);
  assert.equal(kb.packs, packsBefore);
  assert.equal(kb.settings, settingsBefore);

  // 候选、输出开关、设置各变一处
  fired.length = 0;
  applySnapshot(kb, snapshot({ ...first, text: 'ab', caret: 2, candidates: [{ index: 0, text: '好' }], outputs: [{ id: 'o', name: 'O', on: false }], settings: { ...first.settings, autoSend: true } }));
  assert.deepEqual(fired, ['candidates', 'outputs', 'settings']);
  assert.equal(kb.candidates[0]?.text, '好');
  assert.equal(kb.outputs[0]?.on, false);
  assert.equal(kb.settings.autoSend, true);

  // 一模一样的快照：什么都不触发
  fired.length = 0;
  applySnapshot(kb, snapshot({ ...first, text: 'ab', caret: 2, candidates: [{ index: 0, text: '好' }], outputs: [{ id: 'o', name: 'O', on: false }], settings: { ...first.settings, autoSend: true } }));
  assert.deepEqual(fired, []);
  for (const stop of stops) stop();
});

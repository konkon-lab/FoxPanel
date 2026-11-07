import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAction } from '../components/ime/src/actions.ts';
import { parseLangsInfo, parseSogouResult } from '../components/ime/src/channels.ts';

test('操作：格式对的原样通过，多余的字段丢掉', () => {
  const ok = [
    { kind: 'key', code: 'KeyA', shift: true },
    { kind: 'key', code: 'Enter', shift: false },
    { kind: 'text', text: '♪' },
    { kind: 'select', index: 0 },
    { kind: 'caret', position: 3 },
    { kind: 'range', start: 1, end: 4 },
    { kind: 'paste' }, { kind: 'copy' }, { kind: 'clear' }, { kind: 'send' }, { kind: 'dictate' }, { kind: 'clearOutputs' },
    { kind: 'output', id: 'yanuo.chatbox', on: false },
    { kind: 'lang', lang: 'yanuo.lang-ja' },
    { kind: 'lang', lang: 'yanuo.lang-ja', mode: 'hiragana' },
    { kind: 'settings', patch: { autoSend: true, modes: { a: 'b' } } },
  ];
  for (const a of ok) assert.deepEqual(parseAction(a), a);
  assert.deepEqual(parseAction({ kind: 'send', extra: 1 }), { kind: 'send' });
  assert.deepEqual(parseAction({ kind: 'text', text: 'a', code: 'KeyA' }), { kind: 'text', text: 'a' });
});

test('操作：不是对象、kind 不认识、字段类型不对的丢掉', () => {
  const bad: unknown[] = [
    null, 'send', [], {}, { kind: 'nope' }, { kind: 3 },
    { kind: 'key', code: 'KeyA' }, { kind: 'key', code: 'F1', shift: false }, { kind: 'key', code: 'constructor', shift: false }, { kind: 'key', code: 'KeyA', shift: 1 },
    { kind: 'text' }, { kind: 'text', text: { a: 1 } },
    { kind: 'select', index: -1 }, { kind: 'select', index: 1.5 }, { kind: 'select', index: '1' },
    { kind: 'caret' }, { kind: 'caret', position: Number.NaN }, { kind: 'range', start: 0 }, { kind: 'range', start: 0, end: Infinity },
    { kind: 'output', id: 'a' }, { kind: 'output', id: 1, on: true },
    { kind: 'lang' }, { kind: 'lang', lang: 'a', mode: 2 },
    { kind: 'settings' }, { kind: 'settings', patch: 'x' }, { kind: 'settings', patch: [] },
  ];
  for (const a of bad) assert.equal(parseAction(a), null, JSON.stringify(a));
});

test('操作：settings 的补丁只留格式对的项', () => {
  assert.deepEqual(parseAction({ kind: 'settings', patch: { autoSend: 'yes', pinMessage: true, darkMode: true, lang: 3, modes: { a: 'b', c: 1 }, nope: 1 } }), {
    kind: 'settings', patch: { pinMessage: true, modes: { a: 'b' } },
  });
});

test('总线：语言信息和搜狗导入结果格式不对时丢掉', () => {
  const info = { langs: [{ id: 'yanuo.lang-zh', pinyin: true, modes: [{ id: 'simplified', label: { 'zh-Hans': '简体' } }, { id: 't', label: '繁' }] }], modes: { 'yanuo.lang-zh': 't' }, sogouWords: 12 };
  assert.deepEqual(parseLangsInfo(info), info);
  assert.deepEqual(parseLangsInfo({ ...info, extra: 1 }), info);
  const bad: unknown[] = [
    null, 'x', {}, { ...info, langs: 'x' }, { ...info, langs: [{ id: 'a' }] }, { ...info, langs: [{ id: 'a', pinyin: false, modes: [{ id: 'm' }] }] },
    { ...info, langs: [{ id: 'a', pinyin: false, modes: [{ id: 'm', label: { en: 1 } }] }] }, { ...info, modes: { a: 1 } }, { ...info, modes: null }, { ...info, sogouWords: '12' },
  ];
  for (const v of bad) assert.equal(parseLangsInfo(v), null, JSON.stringify(v));

  assert.deepEqual(parseSogouResult({ ok: true, count: 3 }), { ok: true, count: 3 });
  assert.deepEqual(parseSogouResult({ ok: false, error: 'x' }), { ok: false, error: 'x' });
  for (const v of [null, {}, { ok: true }, { ok: false }, { ok: 'yes', count: 1 }, { ok: true, count: '3' }]) assert.equal(parseSogouResult(v), null, JSON.stringify(v));
});

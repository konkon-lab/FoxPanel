import test from 'node:test';
import assert from 'node:assert/strict';
import { clone, dropsAfter, moveNear, readTag, writeDraft, type DraftChange } from '../components/window-components/src/values.ts';
import { hasProtected, isProtected } from '../components/_shared/window/protect.ts';
import type { ComponentRow } from '@konkon-lab/foxpanel-sdk';

test('clone：深拷贝，改副本不动原值', () => {
  const from = { a: [1, { b: 'x' }], c: null };
  const copy = clone(from);
  assert.deepEqual(copy, from);
  assert.notEqual(copy.a, from.a);
  assert.notEqual(copy.a[1], from.a[1]);
  assert.equal(clone('文字'), '文字');
  assert.equal(clone(null), null);
});

test('writeDraft：只收正在显示的组件的改动', () => {
  const config: Record<string, unknown> = { volume: 0.5 };
  const secrets: Record<string, string> = {};
  // 详情页已经换到 yanuo.b，yanuo.a 的滑块卸载前交来的值不收(两个组件都有 volume 也一样)
  writeDraft(config, secrets, 'yanuo.b', { owner: 'yanuo.a', key: 'volume', value: 0.9, secret: false });
  writeDraft(config, secrets, 'yanuo.b', { owner: 'yanuo.a', key: 'speed', value: 2, secret: false });
  writeDraft(config, secrets, 'yanuo.b', { owner: 'yanuo.a', key: 'apiKey', value: 'sk-a', secret: true });
  assert.deepEqual(config, { volume: 0.5 });
  assert.deepEqual(secrets, {});

  writeDraft(config, secrets, 'yanuo.b', { owner: 'yanuo.b', key: 'volume', value: 0.9, secret: false });
  writeDraft(config, secrets, 'yanuo.b', { owner: 'yanuo.b', key: 'voices', value: ['x'], secret: false });
  assert.deepEqual(config, { volume: 0.9, voices: ['x'] });
  assert.deepEqual(secrets, {});
});

test('writeDraft：secret 输入的字记在 secrets(空字符串 = 清除)，值不是字符串时撤销输入', () => {
  const config: Record<string, unknown> = {};
  const secrets: Record<string, string> = {};
  const change = (value: unknown, owner = 'yanuo.a'): DraftChange => ({ owner, key: 'apiKey', value, secret: true });
  writeDraft(config, secrets, 'yanuo.a', change('sk-1'));
  assert.deepEqual(secrets, { apiKey: 'sk-1' });
  writeDraft(config, secrets, 'yanuo.a', change(''));
  assert.deepEqual(secrets, { apiKey: '' });
  writeDraft(config, secrets, 'yanuo.a', change(undefined, 'yanuo.b'));
  assert.deepEqual(secrets, { apiKey: '' });
  writeDraft(config, secrets, 'yanuo.a', change(undefined));
  assert.deepEqual(secrets, {});
  assert.deepEqual(config, {});
});

test('dropsAfter：往下拖落在目标后面，往上拖或不在这个列表里落在前面', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.equal(dropsAfter(list, 'a', 'c'), true);
  assert.equal(dropsAfter(list, 'd', 'b'), false);
  assert.equal(dropsAfter(list, 'x', 'b'), false);
  assert.equal(dropsAfter(list, 'b', 'b'), false);
});

test('moveNear：挪到目标旁边，其余顺序不变', () => {
  const list = ['a', 'b', 'c', 'd'];
  assert.deepEqual(moveNear(list, 'a', 'c'), ['b', 'c', 'a', 'd']);
  assert.deepEqual(moveNear(list, 'a', 'd'), ['b', 'c', 'd', 'a']);
  assert.deepEqual(moveNear(list, 'd', 'b'), ['a', 'd', 'b', 'c']);
  assert.deepEqual(moveNear(list, 'd', 'a'), ['d', 'a', 'b', 'c']);
  assert.deepEqual(moveNear(list, 'b', 'c'), ['a', 'c', 'b', 'd']);
  assert.deepEqual(list, ['a', 'b', 'c', 'd']);
});

test('readTag：文字不算两头的空白，数字要读得出并在范围内', () => {
  assert.equal(readTag('  词  ', 'string'), '词');
  assert.equal(readTag('   ', 'string'), null);
  assert.equal(readTag('', 'number'), null);
  assert.equal(readTag(' 12 ', 'number'), 12);
  assert.equal(readTag('1.5', 'number', 0, 2), 1.5);
  assert.equal(readTag('0', 'number', 0, 9), 0);
  assert.equal(readTag('9', 'number', 0, 9), 9);
  assert.equal(readTag('10', 'number', 0, 9), null);
  assert.equal(readTag('-1', 'number', 0), null);
  assert.equal(readTag('abc', 'number'), null);
  assert.equal(readTag('Infinity', 'number'), null);
  assert.equal(readTag('12', 'string'), '12');
});

test('保护名单：外壳和组件管理，以及包含它们的一组组件', () => {
  assert.equal(isProtected('yanuo.window-shell'), true);
  assert.equal(isProtected('yanuo.window-components'), true);
  assert.equal(isProtected('yanuo.window-settings'), false);
  assert.equal(isProtected(''), false);
  const rows = (...ids: string[]): ComponentRow[] => ids.map(id => ({ id }) as ComponentRow);
  assert.equal(hasProtected(rows('yanuo.osc', 'yanuo.window-shell')), true);
  assert.equal(hasProtected(rows('yanuo.osc', 'yanuo.ime')), false);
  assert.equal(hasProtected([]), false);
});

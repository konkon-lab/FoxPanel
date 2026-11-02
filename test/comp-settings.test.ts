import test from 'node:test';
import assert from 'node:assert/strict';
import { applyPatch, parsePatch, sortByOrder } from '../src/main/components/settings.ts';
import type { ComponentPatch, ComponentSettings } from '../src/shared/types.ts';
import type { Manifest } from '../src/shared/manifest.ts';

const EMPTY: ComponentSettings = { order: [], off: [], config: {}, removed: [], dev: [], devMode: false, groups: [], folded: [], names: {}, market: { registry: 'https://registry.npmmirror.com', scripts: false } };

test('改动收窄：合格的原样通过，多余的字段丢掉；groups、market 的内容一起收窄', () => {
  const ok: ComponentPatch[] = [
    { kind: 'on', id: 'a.b', on: false },
    { kind: 'use', id: 'a.b' },
    { kind: 'order', ids: ['a.b', 'c.d'] },
    { kind: 'configs', id: 'a.b', values: { n: 1, list: [1] } },
    { kind: 'devMode', on: true },
    { kind: 'market', market: { registry: 'https://example.com', scripts: true } },
    { kind: 'groups', groups: [{ id: 'g', name: '组', ids: ['a.b'] }] },
    { kind: 'fold', key: 'u:g', folded: true },
    { kind: 'name', id: 'a.b', name: '' },
    { kind: 'none', of: 'skin' },
  ];
  for (const p of ok) assert.deepEqual(parsePatch(p), p);
  assert.deepEqual(parsePatch({ kind: 'on', id: 'a.b', on: true, extra: 1 }), { kind: 'on', id: 'a.b', on: true });
  assert.deepEqual(parsePatch({ kind: 'market', market: { registry: 'ftp://x' } }), { kind: 'market', market: { registry: 'https://registry.npmmirror.com', scripts: false } });
  assert.deepEqual(parsePatch({ kind: 'groups', groups: [{ id: 'BAD', name: 'x', ids: [] }, 5] }), { kind: 'groups', groups: [] });
});

test('改动收窄：不是对象、kind 不认识、字段类型不对的都拒绝', () => {
  const bad: unknown[] = [
    undefined, null, 'on', [], {}, { kind: 'x' }, { kind: 'config', id: 'a.b', key: 'n', value: 1 },
    { kind: 'on', id: 'a.b' }, { kind: 'on', id: 'a.b', on: 1 }, { kind: 'on', id: 5, on: true },
    { kind: 'use' }, { kind: 'order', ids: 'a.b' }, { kind: 'order', ids: ['a.b', 1] },
    { kind: 'configs', id: 'a.b' }, { kind: 'configs', id: 'a.b', values: [1] },
    { kind: 'devMode', on: 1 }, { kind: 'devMode' },
    { kind: 'market' }, { kind: 'market', market: 'https://example.com' }, { kind: 'groups', groups: {} },
    { kind: 'fold', key: {}, folded: true }, { kind: 'fold', key: 'u:g', folded: 'yes' },
    { kind: 'name', id: 'a.b' }, { kind: 'none', of: 'nope' }, { kind: 'none' },
  ];
  for (const p of bad) assert.throws(() => parsePatch(p), /格式不对/, JSON.stringify(p));
});

test('归并改动：运行时遇到不认识的 kind 抛出异常，不返回 undefined', () => {
  // 没经 parsePatch 的输入
  const raw = JSON.parse('{"kind":"x"}') as ComponentPatch;
  assert.throws(() => applyPatch(EMPTY, raw, []), /不认识的改动/);
});

test('按顺序排：顺序里重复的 id 按第一次出现的位置，没排进顺序的放最后按 id 排', () => {
  const item = (id: string): { manifest: Manifest } => ({ manifest: { id } as Manifest });
  const sorted = sortByOrder(['z.z', 'a.a', 'b.b', 'c.c'].map(item), ['c.c', 'b.b', 'c.c', 'x.x']);
  assert.deepEqual(sorted.map(x => x.manifest.id), ['c.c', 'b.b', 'a.a', 'z.z']);
});

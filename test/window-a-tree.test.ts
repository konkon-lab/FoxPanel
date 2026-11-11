import test from 'node:test';
import assert from 'node:assert/strict';
import { patches, reply, store } from './window-a-stub.ts';
import type { ComponentKind, ComponentRow } from '@konkon-lab/foxpanel-sdk';

const tree = await import('../components/window-components/src/comp-tree.ts');
const { lastError, patch, run } = await import('../components/window-components/src/ops.ts');

const row = (id: string, kind: ComponentKind): ComponentRow => ({ id, kind, name: id.toUpperCase(), on: true, active: true }) as ComponentRow;
const ROWS = [row('a', 'output'), row('b', 'output'), row('c', 'skin'), row('d', 'output'), row('e', 'sidepage'), row('f', 'sidepage')];
const find = (id: string): ComponentRow => ROWS.find(r => r.id === id) ?? row(id, 'skin');

// 分组甲里有 a、b、一个没装的 gone、c；分组乙里有 d，默认折叠；e、f 在顶层；b 重命名过
function reset(): void {
  store.comps.rows = [...ROWS];
  store.settings.components.groups = [{ id: 'g1', name: '甲', ids: ['a', 'b', 'gone', 'c'] }, { id: 'g2', name: '乙', ids: ['d'] }];
  store.settings.components.folded = ['u:g2'];
  store.settings.components.names = { b: '改名' };
  patches.length = 0;
  reply.next = { ok: true };
  lastError.value = '';
  tree.query.value = '';
  tree.resetFolded();
}
// 最近一次保存的分组：各组的成员
const savedGroups = (): Record<string, string[]> => {
  const last = patches.findLast(p => p.kind === 'groups');
  assert.ok(last?.kind === 'groups');
  return Object.fromEntries(last.groups.map(g => [g.id, g.ids]));
};
const ids = (rows: readonly ComponentRow[]): string[] => rows.map(r => r.id);

test('组件树：分组按设置的顺序，没装的成员跳过，不在分组里的在顶层', () => {
  reset();
  assert.deepEqual(tree.tree.value.map(g => [g.key, g.title, ids(g.rows), g.folded, g.defaultFolded]), [
    ['u:g1', '甲', ['a', 'b', 'c'], false, false],
    ['u:g2', '乙', ['d'], true, true],
  ]);
  assert.equal(tree.root.value.key, tree.ROOT_KEY);
  assert.deepEqual(ids(tree.root.value.rows), ['e', 'f']);
  assert.equal(tree.groupKey('g1'), 'u:g1');
  assert.equal(tree.findGroup('u:g2')?.group.id, 'g2');
  assert.equal(tree.findGroup(tree.BROKEN_KEY), undefined);
  assert.equal(tree.nameOf(find('a')), 'A');
  assert.equal(tree.nameOf(find('b')), '改名');
});

test('搜索：按名字和 id 过滤并展开，分组名匹配的分组留着', () => {
  reset();
  tree.query.value = ' D ';
  assert.deepEqual(tree.visibleTree.value.map(g => [g.key, ids(g.rows), g.folded]), [['u:g2', ['d'], false]]);
  assert.deepEqual(ids(tree.visibleRoot.value), []);
  tree.query.value = '甲';
  assert.deepEqual(tree.visibleTree.value.map(g => [g.key, ids(g.rows)]), [['u:g1', []]]);
  tree.query.value = '改名';
  assert.deepEqual(tree.visibleTree.value.map(g => [g.key, ids(g.rows)]), [['u:g1', ['b']]]);
  tree.query.value = 'e';
  assert.deepEqual(ids(tree.visibleRoot.value), ['e']);
});

test('折叠：树里展开收起不保存，默认折叠保存并带着树一起变', () => {
  reset();
  tree.setFolded('u:g2', false);
  assert.deepEqual(tree.tree.value.map(g => [g.folded, g.defaultFolded]), [[false, false], [false, true]]);
  assert.equal(patches.length, 0);
  tree.resetFolded();
  assert.equal(tree.findGroup('u:g2')?.folded, true);
  tree.setDefaultFolded('u:g1', true);
  assert.equal(tree.findGroup('u:g1')?.folded, true);
  assert.deepEqual(patches, [{ kind: 'fold', key: 'u:g1', folded: true }]);
});

test('拖到同一分组的组件上：调成员顺序，同类的还调键盘上的顺序', () => {
  reset();
  tree.dropOn('a', find('c'), 'u:g1');
  assert.deepEqual(savedGroups(), { g1: ['b', 'gone', 'c', 'a'], g2: ['d'] });
  assert.equal(patches.some(p => p.kind === 'order'), false);

  reset();
  tree.dropOn('a', find('b'), 'u:g1');
  assert.deepEqual(savedGroups(), { g1: ['b', 'a', 'gone', 'c'], g2: ['d'] });
  assert.deepEqual(patches.filter(p => p.kind === 'order'), [{ kind: 'order', ids: ['b', 'a', 'd'] }]);

  reset();
  tree.dropOn('c', find('a'), 'u:g1');
  assert.deepEqual(savedGroups(), { g1: ['c', 'a', 'b', 'gone'], g2: ['d'] });
});

test('拖到别的分组或顶层的组件上：移过去排在它前面；顶层里只调同类的顺序', () => {
  reset();
  tree.dropOn('e', find('b'), 'u:g1');
  assert.deepEqual(savedGroups(), { g1: ['a', 'e', 'b', 'gone', 'c'], g2: ['d'] });
  assert.equal(patches.length, 1);

  reset();
  tree.dropOn('a', find('e'), tree.ROOT_KEY);
  assert.deepEqual(savedGroups(), { g1: ['b', 'gone', 'c'], g2: ['d'] });
  assert.equal(patches.length, 1);

  reset();
  tree.dropOn('e', find('f'), tree.ROOT_KEY);
  assert.deepEqual(patches, [{ kind: 'order', ids: ['f', 'e'] }]);
});

test('移进分组、移到顶层、分组换位置', () => {
  reset();
  tree.moveTo('e', 'u:g2');
  assert.deepEqual(savedGroups(), { g1: ['a', 'b', 'gone', 'c'], g2: ['d', 'e'] });
  tree.moveTo('a', 'u:g2', 'd');
  assert.deepEqual(savedGroups(), { g1: ['b', 'gone', 'c'], g2: ['a', 'd'] });
  tree.moveTo('d', tree.ROOT_KEY);
  assert.deepEqual(savedGroups(), { g1: ['a', 'b', 'gone', 'c'], g2: [] });

  patches.length = 0;
  tree.moveTo('e', 'u:none');
  tree.moveGroup('u:none', null);
  assert.equal(patches.length, 0);
  tree.moveGroup('u:g2', 'u:g1');
  assert.deepEqual(Object.keys(savedGroups()), ['g2', 'g1']);
  tree.moveGroup('u:g1', null);
  assert.deepEqual(Object.keys(savedGroups()), ['g2', 'g1']);
});

test('新建、重命名、移除分组；新建没存上时不给 key', async () => {
  reset();
  const key = await tree.newGroup();
  assert.match(key ?? '', /^u:g[0-9a-z]+$/);
  assert.deepEqual(Object.keys(savedGroups()).length, 3);
  const made = patches.at(-1);
  assert.ok(made?.kind === 'groups');
  assert.deepEqual(made.groups.at(-1), { id: key?.slice(2), name: 'cp.newGroupName', ids: [] });

  reply.next = { ok: false, error: '存不上' };
  assert.equal(await tree.newGroup(), null);
  assert.equal(lastError.value, '存不上');

  reset();
  tree.renameGroup('g1', '  新名  ');
  const renamed = patches.at(-1);
  assert.ok(renamed?.kind === 'groups');
  assert.deepEqual(renamed.groups.map(g => g.name), ['新名', '乙']);
  patches.length = 0;
  tree.renameGroup('g1', '   ');
  assert.equal(patches.length, 0);
  tree.removeGroup('g1');
  assert.deepEqual(savedGroups(), { g2: ['d'] });
});

test('操作的错误：开始时清掉上一次的，出错时记下，返回是否成功', async () => {
  reset();
  lastError.value = '上一次的';
  const ok = run(Promise.resolve({ ok: true }));
  assert.equal(lastError.value, '');
  assert.equal(await ok, true);
  assert.equal(await run(Promise.resolve({ ok: false, error: '卸不掉' })), false);
  assert.equal(lastError.value, '卸不掉');

  assert.equal(await patch({ kind: 'devMode', on: true }), true);
  assert.equal(lastError.value, '');
  assert.deepEqual(patches, [{ kind: 'devMode', on: true }]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTick, ref, watchEffect } from 'vue';
import { FAILED_CLASS, markFailed, mountParts, noSlotText, placeParts, type MarkElement, type PartMount } from '../src/panel/parts.ts';
import { WAIT_LOG_MS } from '../src/shared/component-services.ts';
import type { PageComponent } from '../src/shared/types.ts';

// 假的元素：只有「在哪个元素里」和「放进一个元素」
class El {
  parentElement: El | null = null;
  readonly children: El[] = [];
  append(el: El): void {
    if (el.parentElement) el.parentElement.children.splice(el.parentElement.children.indexOf(el), 1);
    el.parentElement = this;
    this.children.push(el);
  }
}

const part = (id: string): PageComponent => ({ id, kind: 'sidepage', name: id, config: {}, url: `fox://component/${id}/page.js` });
const mountOf = (slot: string, id: string): PartMount<El> => ({ slot, el: new El(), component: part(id), loaded: false });

// 假的根组件：slots 是已经有的插槽元素；change() 像根组件的内容变了那样叫一遍盯着的回调
function rig(mounts: PartMount<El>[]) {
  const slots = new Map<string, El>();
  const loaded: string[] = [];
  const warned: string[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  let watcher: (() => void) | null = null;
  let stopped = 0;
  const deps = {
    find: (slot: string): El | null => slots.get(slot) ?? null,
    load: (c: PageComponent, el: El): void => { loaded.push(`${c.id}@${mounts.find(m => m.el === el)?.slot ?? '?'}`); },
    observe: (changed: () => void): (() => void) => {
      watcher = changed;
      return () => {
        stopped++;
        watcher = null;
      };
    },
    later: (fn: () => void, ms: number): void => { timers.push({ fn, ms }); },
    warn: (id: string, text: string): void => { warned.push(`${id}: ${text}`); },
  };
  return {
    slots, loaded, warned, timers, deps,
    get watching() { return watcher !== null; },
    get stopped() { return stopped; },
    change: (): void => watcher?.(),
  };
}

test('挂部件：插槽元素一开始就在时全部放进去、各加载一次，停止盯着根组件', () => {
  const mounts = [mountOf('candidates', 'a.bar'), mountOf('sidepage', 'a.one'), mountOf('sidepage', 'a.two')];
  const r = rig(mounts);
  const bar = new El();
  const side = new El();
  r.slots.set('candidates', bar);
  r.slots.set('sidepage', side);
  mountParts(mounts, r.deps);
  assert.deepEqual(r.loaded, ['a.bar@candidates', 'a.one@sidepage', 'a.two@sidepage']);
  assert.deepEqual([bar.children.length, side.children, mounts.map(m => m.loaded)], [1, [mounts[1]?.el, mounts[2]?.el], [true, true, true]]);
  assert.deepEqual([r.watching, r.stopped], [false, 1]);
  // 到点没有要记的
  assert.deepEqual(r.timers.map(t => t.ms), [WAIT_LOG_MS]);
  r.timers[0]?.fn();
  assert.deepEqual(r.warned, []);
});

test('挂部件：插槽元素晚出现(根组件在等服务)时，出现了才放进去并加载，只加载一次；全部放好后停止盯着', () => {
  const mounts = [mountOf('candidates', 'a.bar'), mountOf('layout', 'a.keys')];
  const r = rig(mounts);
  r.slots.set('candidates', new El());
  mountParts(mounts, r.deps);
  assert.deepEqual([r.loaded, mounts.map(m => m.loaded), r.watching], [['a.bar@candidates'], [true, false], true]);
  // 根组件的内容变了但还没有那个插槽：什么都不做
  r.change();
  r.change();
  assert.deepEqual([r.loaded.length, r.watching], [1, true]);
  const layout = new El();
  r.slots.set('layout', layout);
  r.change();
  assert.deepEqual([r.loaded, layout.children, r.watching, r.stopped], [['a.bar@candidates', 'a.keys@layout'], [mounts[1]?.el], false, 1]);
  // 之后根组件再变也不重复加载
  r.change();
  assert.equal(r.loaded.length, 2);
  r.timers[0]?.fn();
  assert.deepEqual(r.warned, []);
});

test('挂部件：根组件重画换了插槽元素时把部件的元素挪进新的那个，不重新加载', () => {
  const mounts = [mountOf('sidepage', 'a.one'), mountOf('layout', 'a.keys')];
  const r = rig(mounts);
  const first = new El();
  r.slots.set('sidepage', first);
  assert.equal(placeParts(mounts, r.deps), false);
  assert.deepEqual(r.loaded, ['a.one@sidepage']);
  const second = new El();
  r.slots.set('sidepage', second);
  assert.equal(placeParts(mounts, r.deps), false);
  assert.deepEqual([r.loaded, first.children, second.children], [['a.one@sidepage'], [], [mounts[0]?.el]]);
  // 已经在插槽元素里的不动
  assert.equal(placeParts(mounts, r.deps), false);
  assert.deepEqual(second.children, [mounts[0]?.el]);
  r.slots.set('layout', new El());
  assert.equal(placeParts(mounts, r.deps), true);
  assert.deepEqual(r.loaded, ['a.one@sidepage', 'a.keys@layout']);
});

test('挂部件：根组件里一直没有对应插槽元素的部件不加载，5 秒后各记一行警告(来源是那个部件)；有插槽的不记', () => {
  const mounts = [mountOf('candidates', 'a.bar'), mountOf('wrist', 'a.w1'), mountOf('wrist', 'a.w2')];
  const r = rig(mounts);
  r.slots.set('candidates', new El());
  mountParts(mounts, r.deps);
  assert.deepEqual([r.loaded, r.watching, r.warned], [['a.bar@candidates'], true, []]);
  assert.equal(WAIT_LOG_MS, 5000);
  assert.deepEqual(r.timers.map(t => t.ms), [5000]);
  r.timers[0]?.fn();
  assert.deepEqual(r.warned, [
    'a.w1: not loaded: the panel has no element for slot wrist',
    'a.w2: not loaded: the panel has no element for slot wrist',
  ]);
  assert.equal(noSlotText('wrist'), 'not loaded: the panel has no element for slot wrist');
  // 记过之后插槽才出现：照样挂上
  r.slots.set('wrist', new El());
  r.change();
  assert.deepEqual([r.loaded.slice(1), r.watching], [['a.w1@wrist', 'a.w2@wrist'], false]);
});

test('挂部件：没有部件时什么都不做，马上停止盯着', () => {
  const r = rig([]);
  mountParts([], r.deps);
  assert.deepEqual([r.loaded, r.watching, r.stopped], [[], false, 1]);
});

// 假的组件元素：记下里面的内容
class Box {
  children: MarkElement[] = [{ className: 'old', textContent: 'half drawn' }];
  replaceChildren(...nodes: MarkElement[]): void {
    this.children = nodes;
  }
}

test('加载失败的标记：换掉组件元素里原有的内容，只放一个带警示号和组件名字的标记', () => {
  const box = new Box();
  const made: MarkElement[] = [];
  markFailed(box, () => '常用语', {
    create: () => {
      const mark: MarkElement = { className: '', textContent: null };
      made.push(mark);
      return mark;
    },
    follow: fn => fn(),
  });
  assert.equal(made.length, 1);
  assert.deepEqual(box.children, [{ className: 'fox-notice fox-failed', textContent: '⚠ 常用语' }]);
  assert.equal(box.children[0], made[0]);
  assert.equal(FAILED_CLASS, 'fox-notice fox-failed');
});

test('加载失败的标记：界面语言换了，标记上的名字跟着换；各个组件的标记各管各的', async () => {
  const locale = ref<'zh-Hans' | 'en'>('zh-Hans');
  const names = { 'a.one': { 'zh-Hans': '常用语', en: 'Phrases' }, 'a.two': { 'zh-Hans': '时钟', en: 'Clock' } } as const;
  const deps = { create: (): MarkElement => ({ className: '', textContent: null }), follow: (fn: () => void): void => { watchEffect(fn); } };
  const one = new Box();
  const two = new Box();
  markFailed(one, () => names['a.one'][locale.value], deps);
  markFailed(two, () => names['a.two'][locale.value], deps);
  assert.deepEqual([one.children.map(m => m.textContent), two.children.map(m => m.textContent)], [['⚠ 常用语'], ['⚠ 时钟']]);
  locale.value = 'en';
  await nextTick();
  assert.deepEqual([one.children.map(m => m.textContent), two.children.map(m => m.textContent)], [['⚠ Phrases'], ['⚠ Clock']]);
  assert.deepEqual([one.children.length, one.children[0]?.className], [1, FAILED_CLASS]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlanRunner, type PlanRunner } from '../src/renderer/plan.ts';
import type { CodeComponent } from '../src/shared/types.ts';

const comp = (id: string, config: Record<string, unknown> = {}, url = `fox://component/${id}/window.js`): CodeComponent => ({ id, kind: 'window', name: id, config, url });
const tick = (): Promise<void> => new Promise(r => setTimeout(r, 0));

// 记下加载、卸载的次序；hold 里的组件加载到一半停住，等 gate 里它的函数被调用才加载完
function setup(): { events: string[]; hold: Set<string>; gate: Map<string, () => void>; failUnload: Set<string>; runner: PlanRunner } {
  const events: string[] = [];
  const hold = new Set<string>();
  const gate = new Map<string, () => void>();
  const failUnload = new Set<string>();
  const runner = createPlanRunner({
    load: async (c, index) => {
      events.push(`load ${c.id}#${index} ${JSON.stringify(c.config)}`);
      if (hold.has(c.id)) await new Promise<void>(r => gate.set(c.id, r));
      events.push(`loaded ${c.id} ${JSON.stringify(c.config)}`);
    },
    unload: async id => {
      events.push(`unload ${id}`);
      await tick();
      if (failUnload.has(id)) throw new Error('dispose failed');
    },
    reloadPage: () => { events.push('reload page'); },
    failed: (id, e) => { events.push(`failed ${id}: ${String(e)}`); },
  });
  return { events, hold, gate, failUnload, runner };
}

test('主窗口计划：只有设置变了的组件重新加载；组件增减或换了入口时整页重新加载', async () => {
  const { events, runner } = setup();
  await runner.start([comp('a.one'), comp('a.two', { n: 1 })]);
  assert.deepEqual(events, ['load a.one#0 {}', 'loaded a.one {}', 'load a.two#1 {"n":1}', 'loaded a.two {"n":1}']);
  events.length = 0;
  runner.next([comp('a.one'), comp('a.two', { n: 1 })]);
  await tick();
  assert.deepEqual(events, []);
  runner.next([comp('a.one'), comp('a.two', { n: 2 })]);
  await tick();
  await tick();
  assert.deepEqual(events, ['unload a.two', 'load a.two#1 {"n":2}', 'loaded a.two {"n":2}']);
  events.length = 0;
  runner.next([comp('a.one')]);
  runner.next([comp('a.one'), comp('a.two', { n: 2 }, 'fox://component/a.two/other.js')]);
  assert.deepEqual(events, ['reload page', 'reload page']);
});

test('主窗口计划：同一个组件连着变，重新加载一个接一个做，中间的那份跳过，最后是最后一份', async () => {
  const { events, runner } = setup();
  await runner.start([comp('a.one', { n: 0 })]);
  events.length = 0;
  runner.next([comp('a.one', { n: 1 })]);
  runner.next([comp('a.one', { n: 2 })]);
  runner.next([comp('a.one', { n: 3 })]);
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(events, ['unload a.one', 'load a.one#0 {"n":3}', 'loaded a.one {"n":3}']);
  // 已经在重新加载时又变：等这一次做完才做下一次
  events.length = 0;
  runner.next([comp('a.one', { n: 4 })]);
  await tick();
  runner.next([comp('a.one', { n: 5 })]);
  for (let i = 0; i < 6; i++) await tick();
  assert.deepEqual(events, ['unload a.one', 'load a.one#0 {"n":4}', 'loaded a.one {"n":4}', 'unload a.one', 'load a.one#0 {"n":5}', 'loaded a.one {"n":5}']);
});

test('主窗口计划：首次加载完成之前推来的计划留到加载完处理，只认最后一份', async () => {
  const { events, hold, gate, runner } = setup();
  hold.add('a.slow');
  runner.next([comp('a.slow', { n: 9 })]);
  const started = runner.start([comp('a.slow', { n: 0 })]);
  await tick();
  runner.next([comp('a.slow', { n: 1 })]);
  runner.next([comp('a.slow', { n: 2 })]);
  await tick();
  assert.deepEqual(events, ['load a.slow#0 {"n":0}']);
  hold.clear();
  gate.get('a.slow')?.();
  await started;
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(events, ['load a.slow#0 {"n":0}', 'loaded a.slow {"n":0}', 'unload a.slow', 'load a.slow#0 {"n":2}', 'loaded a.slow {"n":2}']);
});

test('主窗口计划：卸载旧的出错时记下来，新的照样加载，之后的变化照常处理', async () => {
  const { events, failUnload, runner } = setup();
  await runner.start([comp('a.one', { n: 0 })]);
  events.length = 0;
  failUnload.add('a.one');
  runner.next([comp('a.one', { n: 1 })]);
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(events, ['unload a.one', 'failed a.one: Error: dispose failed', 'load a.one#0 {"n":1}', 'loaded a.one {"n":1}']);
  events.length = 0;
  failUnload.clear();
  runner.next([comp('a.one', { n: 2 })]);
  for (let i = 0; i < 4; i++) await tick();
  assert.deepEqual(events, ['unload a.one', 'load a.one#0 {"n":2}', 'loaded a.one {"n":2}']);
});

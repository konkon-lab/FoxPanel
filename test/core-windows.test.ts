import test from 'node:test';
import assert from 'node:assert/strict';
import type { CodeComponent } from '../src/shared/types.ts';

// 组件入口：data: 地址的模块，经 globalThis.__win 和测试互通
const mod = (body: string): string => `data:text/javascript,${encodeURIComponent(body)}`;

// x.a：页面 home 和一个 layout 插槽；apply 时记下当时登记表里的页面
const A = mod(`export default { name: 'a', apply(ctx, config) {
  const w = globalThis.__win;
  w.during.push(w.pages());
  ctx.window.page({ id: 'home', title: 'A' + config.n, icon: {}, component: {} });
  ctx.window.slot({ type: 'layout', component: {} });
} }`);
// x.b：等 gate 放行才登记；页面 home(和 x.a 抢)、b2、b3(撤销函数交给测试)，设置页一节 s
const B = mod(`export default { name: 'b', async apply(ctx) {
  const w = globalThis.__win;
  await w.gate;
  ctx.window.page({ id: 'home', title: 'B', icon: {}, component: {} });
  ctx.window.page({ id: 'b2', title: 'B2', icon: {}, component: {} });
  w.undoB3 = ctx.window.page({ id: 'b3', title: 'B3', icon: {}, component: {} });
  ctx.window.settings({ id: 's', title: 'S' });
} }`);
// x.c：有 settings 服务时往设置页登记一节，服务没了随之撤销
const C = mod(`export default { name: 'c', apply(ctx) {
  ctx.window.page({ id: 'components', title: 'C', icon: {}, component: {} });
  ctx.inject(['settings'], sub => {
    globalThis.__win.runs++;
    sub.effect(() => sub.window.settings({ id: 'general', title: 'G', keys: ['devMode'] }));
  });
} }`);
// x.s：提供 settings 服务
const S = mod(`export default { name: 's', apply(ctx, config) {
  ctx.provide('settings', {});
  ctx.window.page({ id: 'settings', title: 'S' + config.n, icon: {}, component: {} });
} }`);

const logs: string[] = [];
let reloads = 0;                                             // 整页重新加载的次数
let pushPlan: (plan: CodeComponent[]) => void = () => undefined;
const config = { a: 0, s: 0 };                               // x.a、x.s 的设置里的 n
const comp = (id: string, url: string, cfg: Record<string, unknown> = {}): CodeComponent => ({ id, kind: 'window', name: id, config: cfg, url });
const plan = (): CodeComponent[] => [comp('x.a', A, { n: config.a }), comp('x.b', B), comp('x.c', C), comp('x.s', S, { n: config.s })];

Object.assign(globalThis, {
  window: { fox: {
    logWrite: (source: string, text: string, level?: string): void => { logs.push(`${source} [${level ?? 'info'}] ${text}`); },
    busSend: (): void => undefined,
    onBus: (): void => undefined,
    onWindowPlan: (fn: (p: CodeComponent[]) => void): void => { pushPlan = fn; },
    windowPlan: (): Promise<CodeComponent[]> => Promise.resolve(plan()),
  } },
  location: { reload: (): void => { reloads++; } },
});

// windows.ts 加载时就读 window.fox：在上面的假对象放好之后导入
const { startWindows, windows } = await import('../src/renderer/windows.ts');

const pages = (): string[] => windows.pages.map(p => `${p.id}@${p.owner}`);
const slots = (): string[] => windows.slots.map(s => `${s.type}@${s.owner}`);
const settings = (): string[] => windows.settings.map(s => `${s.id}@${s.owner}`);
const titleOf = (id: string): unknown => windows.pages.find(p => p.id === id)?.title;

let openGate: () => void = () => undefined;
const shared = {
  gate: new Promise<void>(r => { openGate = r; }),
  undoB3: null as (() => void) | null,
  runs: 0,                    // x.c 的 inject 回调跑过的次数
  during: [] as string[][],   // x.a 每次 apply 时登记表里的页面
  pages,
};
Object.assign(globalThis, { __win: shared });

// 等到 cond 成立；轮数用完算失败
async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 1000; i++) {
    if (cond()) return;
    await new Promise<void>(r => setTimeout(r, 5));
  }
  assert.fail(`等不到：${what}`);
}

// 推一份只有设置变了的计划，等到 id 这一页的标题变成 title(这个组件重新加载完)
async function reload(id: string, title: string): Promise<void> {
  pushPlan(plan());
  await until(() => titleOf(id) === title, `${id} 的标题变成 ${title}`);
}

test('主窗口登记表：两个组件同时加载抢同一个页面 id，加载完的那个占着，另一个的这一页不放进去并写警告', async () => {
  const started = startWindows();
  await until(() => pages().includes('home@x.a'), 'x.a 的页面进登记表');
  assert.equal(windows.ready, false);
  openGate();
  await started;
  assert.equal(windows.ready, true);
  assert.deepEqual(pages(), ['home@x.a', 'b2@x.b', 'b3@x.b', 'components@x.c', 'settings@x.s']);
  assert.equal(titleOf('home'), 'A0');
  assert.deepEqual(slots(), ['layout@x.a']);
  assert.deepEqual(settings(), ['s@x.b', 'general@x.c']);
  assert.deepEqual(logs, ['x.b [warn] page id home is already taken']);
});

test('主窗口登记表：组件重新加载后旧登记整批替换，新的加载完之前旧页面还在', async () => {
  config.a = 1;
  await reload('home', 'A1');
  assert.deepEqual(shared.during.at(-1), ['home@x.a', 'b2@x.b', 'b3@x.b', 'components@x.c', 'settings@x.s']);
  assert.deepEqual(pages(), ['home@x.a', 'b2@x.b', 'b3@x.b', 'components@x.c', 'settings@x.s']);
  assert.deepEqual(slots(), ['layout@x.a']);
  assert.equal(shared.during.length, 2);
  assert.equal(reloads, 0);
});

test('主窗口登记表：别的组件整批替换之后，撤销函数仍删掉自己那一项', async () => {
  config.a = 2;
  await reload('home', 'A2');
  shared.undoB3?.();
  assert.deepEqual(pages(), ['home@x.a', 'b2@x.b', 'components@x.c', 'settings@x.s']);
  shared.undoB3?.();
  assert.deepEqual(pages(), ['home@x.a', 'b2@x.b', 'components@x.c', 'settings@x.s']);
});

test('主窗口登记表：提供服务的组件重新加载，依赖它的组件随服务登记的那一项不重复', async () => {
  assert.equal(shared.runs, 1);
  for (const n of [1, 2]) {
    config.s = n;
    await reload('settings', `S${n}`);
    await until(() => shared.runs === n + 1, `x.c 的 inject 回调第 ${n + 1} 次运行`);
    assert.deepEqual(settings(), ['s@x.b', 'general@x.c']);
  }
  assert.deepEqual(pages(), ['home@x.a', 'b2@x.b', 'components@x.c', 'settings@x.s']);
  assert.equal(reloads, 0);
  assert.deepEqual(logs, ['x.b [warn] page id home is already taken']);
});

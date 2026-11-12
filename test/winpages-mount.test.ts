// 把日志框和依赖图挂在假的渲染器上测(没有 DOM)：.vue 由下面的加载钩子现编译，节点是普通对象，事件直接调节点上记的处理函数。
// 这个文件同时是组件代码里的 @konkon-lab/foxpanel-window，所以组件在各测试里用 await import() 加载。
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';
import { createRenderer, h, markRaw, reactive, ref, shallowRef, type Component } from 'vue';
import { compileScript, parse } from 'vue/compiler-sfc';
import type { WindowComponentsService } from '@konkon-lab/foxpanel-sdk';
import { comps } from '../components/_shared/window/components-service.ts';
import { defineMessages } from '../src/shared/messages.ts';
import type { ComponentRow, Locale, LogEntry } from '../src/shared/types.ts';

// 组件从 @konkon-lab/foxpanel-window 拿的东西：t 返回「语言 键 各参数」，openComponent 只记下要去的组件
export { defineMessages };
export const locale = ref<Locale>('zh-Hans');
export const t = (key: string, params: Readonly<Record<string, string | number>> = {}): string => [locale.value, key, ...Object.values(params)].join(' ');
export const store = reactive({ comps: { rows: [] as ComponentRow[] } });
export const opened: string[] = [];
export const openComponent = (id: string): void => { opened.push(id); };

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@konkon-lab/foxpanel-window') return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  // .vue 编译成模块：脚本和模板合成一个组件，样式不要
  load(url, context, nextLoad) {
    if (!url.endsWith('.vue')) return nextLoad(url, context);
    const filename = fileURLToPath(url);
    const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename });
    const { content } = compileScript(descriptor, { id: filename, inlineTemplate: true });
    return { format: 'module', source: transformSync(content, { loader: 'ts' }).code, shortCircuit: true };
  },
});

// 假节点：props 是渲染器给的属性和事件处理函数，style 给 v-show 写 display，三个 scroll 数值给日志框的贴底用
interface FakeNode {
  tag: string;
  text: string;
  props: Record<string, unknown>;
  style: Record<string, string>;
  children: FakeNode[];
  parent: FakeNode | null;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}
const node = (tag: string, text = ''): FakeNode => ({ tag, text, props: {}, style: {}, children: [], parent: null, scrollTop: 0, scrollHeight: 0, clientHeight: 0 });
function detach(n: FakeNode): void {
  const siblings = n.parent?.children;
  if (siblings) siblings.splice(siblings.indexOf(n), 1);
  n.parent = null;
}
const { render } = createRenderer<FakeNode, FakeNode>({
  createElement: tag => node(tag),
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (n, text) => { n.text = text; },
  setElementText: (n, text) => { Object.assign(n, { text, children: [] }); },
  insert(n, parent, anchor) {
    detach(n);
    n.parent = parent;
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(at < 0 ? parent.children.length : at, 0, n);
  },
  remove: detach,
  parentNode: n => n.parent,
  nextSibling: n => n.parent?.children[n.parent.children.indexOf(n) + 1] ?? null,
  patchProp(n, key, _prev, next) {
    if (next === null || next === undefined) delete n.props[key];
    else n.props[key] = next;
  },
});

// 每个测试结束时要做的收尾，后登记的先做
const undo: (() => void)[] = [];
afterEach(() => {
  while (undo.length) undo.pop()?.();
});

// 挂一个组件(props 每次重画时重新取)，返回容器；测试结束时卸掉
function mount(component: Component, props: () => Record<string, unknown> = () => ({})): FakeNode {
  const root = node('root');
  render(h({ render: () => h(component, props()) }), root);
  undo.push(() => render(null, root));
  return root;
}
// 等排着的重画和监听跑完
const flush = (): Promise<void> => new Promise(r => setImmediate(r));
// 带这个 class 的节点，按文档顺序
function byClass(n: FakeNode, name: string): FakeNode[] {
  const own = typeof n.props['class'] === 'string' && n.props['class'].split(' ').includes(name) ? [n] : [];
  return [...own, ...n.children.flatMap(c => byClass(c, name))];
}
const textOf = (n: FakeNode): string => (n.tag === '#comment' ? '' : n.text + n.children.map(textOf).join(''));
// 调节点上记的事件处理函数
function fire(n: FakeNode, name: string, event: unknown = {}): void {
  const handler = n.props[name];
  assert.equal(typeof handler, 'function', `节点上没有 ${name}`);
  (handler as (e: unknown) => void)(event);
}
// 加载一个 .vue 组件(路径相对这个文件)
async function load(file: string): Promise<Component> {
  return (await import(file) as { default: Component }).default;
}

// ---- 日志框 ----

// 一行日志；drawn 记每一行被画了几次(画一行要读一次它的内容)
const drawn = new Map<number, number>();
function line(id: number, source = 'yanuo.demo'): LogEntry {
  return markRaw({
    id, level: 'info' as const, source, time: new Date(2026, 10, 20, 12, 0, id).getTime(),
    get text() {
      drawn.set(id, (drawn.get(id) ?? 0) + 1);
      return `sent: ${id}`;
    },
  });
}
const total = (): number => [...drawn.values()].reduce((a, b) => a + b, 0);

test('日志框：每行的内容和分段；前面裁行、后面进新行时留下的行不重画', async () => {
  const LogLines = await load('../components/window-logs/src/LogLines.vue');
  drawn.clear();
  store.comps.rows = [];
  const lines = shallowRef([1, 2, 3, 4, 5].map(id => line(id)));
  const root = mount(LogLines, () => ({ lines: lines.value }));
  const rows = (): string[] => byClass(root, 'll').map(textOf);
  assert.deepEqual(rows(), [1, 2, 3, 4, 5].map(id => `2026-11-20 12:00:0${id}[I]demosent: ${id}`));
  assert.deepEqual(byClass(root, 'll').map(n => [n.props['class'], n.props['style']]).at(0), ['ll info', { '--src': '#9fd38a' }]);
  assert.deepEqual(byClass(root, 'hot').map(textOf).slice(0, 2), [' 1', ' 2']);
  assert.equal(total(), 5);

  // 行数到上限：前面裁两行，后面进两行
  lines.value = [...lines.value.slice(2), line(6), line(7)];
  await flush();
  assert.deepEqual(rows().map(r => r.slice(-1)), ['3', '4', '5', '6', '7']);
  assert.deepEqual([3, 4, 5, 6, 7].map(id => drawn.get(id)), [1, 1, 1, 1, 1]);

  // 内容没变的一组新数组：一行都不重画
  lines.value = [...lines.value];
  await flush();
  assert.equal(total(), 7);
});

test('日志框：来源是列表里的组件时有跳转箭头(compact 时没有)，文字跟着界面语言', async () => {
  const LogLines = await load('../components/window-logs/src/LogLines.vue');
  drawn.clear();
  opened.length = 0;
  store.comps.rows = [];
  locale.value = 'zh-Hans';
  const compact = ref(false);
  const lines = shallowRef([line(1), line(2, ''), line(3, 'yanuo.other')]);
  const root = mount(LogLines, () => ({ lines: lines.value, compact: compact.value }));
  assert.equal(byClass(root, 'go').length, 0);
  assert.equal(textOf(byClass(root, 'll')[1]!), '2026-11-20 12:00:02[I]hostsent: 2');

  // 列表里有了这个组件：只有它的行重画
  store.comps.rows = [{ id: 'yanuo.demo' } as ComponentRow];
  await flush();
  const [go] = byClass(root, 'go');
  assert.equal(byClass(root, 'go').length, 1);
  assert.equal(go?.parent, byClass(root, 'll')[0]);
  assert.deepEqual([go?.props['title'], go?.props['aria-label']], ['zh-Hans log.goto demo', 'zh-Hans log.goto demo']);
  assert.deepEqual([1, 2, 3].map(id => drawn.get(id)), [2, 1, 1]);
  fire(go!, 'onClick');
  assert.deepEqual(opened, ['yanuo.demo']);

  locale.value = 'en';
  await flush();
  assert.equal(byClass(root, 'go')[0]?.props['title'], 'en log.goto demo');

  compact.value = true;
  await flush();
  assert.equal(byClass(root, 'go').length, 0);
  assert.equal(byClass(root, 'term')[0]?.props['class'], 'term compact');
});

test('日志框：显示的最后一行变了才滚到底；内容没变、用户往上翻了时不动', async () => {
  const LogLines = await load('../components/window-logs/src/LogLines.vue');
  locale.value = 'zh-Hans';
  const lines = shallowRef([line(1), line(2), line(3)]);
  const root = mount(LogLines, () => ({ lines: lines.value }));
  const [box] = byClass(root, 'term');
  assert.ok(box);
  await flush();
  // 框高 220，内容高 500，停在最上面(没滚动过)
  Object.assign(box, { scrollHeight: 500, clientHeight: 220, scrollTop: 0 });

  // 别处来了日志：筛出来的还是这三行，只是数组是新的
  lines.value = [...lines.value];
  await flush();
  assert.equal(box.scrollTop, 0);

  lines.value = [...lines.value, line(4)];
  await flush();
  assert.equal(box.scrollTop, 500);

  // 行数到上限：行数不变，最后一行是新的
  box.scrollTop = 0;
  lines.value = [...lines.value.slice(1), line(5)];
  await flush();
  assert.equal(box.scrollTop, 500);

  // 用户往上翻了：新行进来不动；翻回离底部 24 像素以内又跟着滚
  box.scrollTop = 100;
  fire(box, 'onScroll');
  lines.value = [...lines.value, line(6)];
  await flush();
  assert.equal(box.scrollTop, 100);
  box.scrollTop = 270;
  fire(box, 'onScroll');
  lines.value = [...lines.value, line(7)];
  await flush();
  assert.equal(box.scrollTop, 500);

  // 一行都没有时显示空的提示
  lines.value = [];
  await flush();
  assert.deepEqual(byClass(root, 'empty').map(textOf), ['zh-Hans log.empty']);
});

// ---- 依赖图 ----

// 依赖图用到的浏览器接口：动画帧排在 frames 里由测试一帧帧放，尺寸监听和 window 上的事件由测试触发
function fakeBrowser(): { frames: (() => void)[]; play(): void; resize(width: number, height: number): void; emit(type: string): void } {
  const frames: (() => void)[] = [];
  const observers: ((entries: { contentRect: { width: number; height: number } }[]) => void)[] = [];
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const fakes: Record<string, unknown> = {
    requestAnimationFrame(step: (time: number) => void): number {
      return frames.push(() => step(0));
    },
    cancelAnimationFrame(): void {
      frames.length = 0;
    },
    ResizeObserver: class {
      constructor(report: (typeof observers)[number]) {
        observers.push(report);
      }

      observe(): void {}
      disconnect(): void {}
    },
    window: {
      addEventListener(type: string, fn: (e: unknown) => void): void {
        listeners.set(type, (listeners.get(type) ?? new Set()).add(fn));
      },
      removeEventListener(type: string, fn: (e: unknown) => void): void {
        listeners.get(type)?.delete(fn);
      },
    },
  };
  const globals = globalThis as Record<string, unknown>;
  const before = Object.keys(fakes).map(k => [k, Object.getOwnPropertyDescriptor(globals, k)] as const);
  for (const [k, v] of Object.entries(fakes)) Object.defineProperty(globals, k, { value: v, configurable: true, writable: true });
  undo.push(() => {
    for (const [k, d] of before) {
      if (d) Object.defineProperty(globals, k, d);
      else delete globals[k];
    }
  });
  return {
    frames,
    // 放到模拟停下、没有排着的帧为止
    play() {
      for (let n = 0; frames.length; n++) {
        assert.ok(n < 5000, '模拟应当自己停下');
        frames.shift()?.();
      }
    },
    resize: (width, height) => { for (const report of observers) report([{ contentRect: { width, height } }]); },
    emit: type => { for (const fn of listeners.get(type) ?? []) fn({}); },
  };
}

// 两个分组各四个组件；a1 提供服务，b1 用它
function running(): WindowComponentsService {
  const row = (id: string, more: Partial<ComponentRow> = {}): ComponentRow => ({ id, active: true, ...more }) as ComponentRow;
  const group = (key: string, rows: ComponentRow[]): unknown => ({ key, title: key, rows });
  return {
    tree: [
      group('a', [row('a1', { provides: ['svc'] }), row('a2'), row('a3'), row('a4')]),
      group('b', [row('b1', { requires: [{ name: 'svc', id: 'a1', on: true }] }), row('b2'), row('b3'), row('b4')]),
    ],
  } as unknown as WindowComponentsService;
}
const pointer = { clientX: 10, clientY: 20, preventDefault(): void {} };

test('依赖图：拖动后在连线上松手，连线的提示框留着；在空白处松手，高亮和提示框收起', async t => {
  const browser = fakeBrowser();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  locale.value = 'zh-Hans';
  comps.value = running();
  const root = mount(await load('../components/window-deps/src/DepsPage.vue'));
  await flush();
  const [tip] = byClass(root, 'tip');
  const [page] = byClass(root, 'page');
  const a1 = byClass(root, 'node')[2];
  const toA1 = byClass(root, 'link')[1];   // 分组 a → a1
  assert.ok(tip && page && a1 && toA1?.children[0]);
  assert.equal(tip.style['display'], 'none');

  // 按住 a1 拖出去，滑到连着它的线上松手
  fire(a1, 'onMouseenter', pointer);
  fire(a1, 'onMousedown', pointer);
  fire(a1, 'onMouseleave', pointer);
  fire(toA1.children[0], 'onMouseenter', pointer);
  browser.emit('mouseup');
  t.mock.timers.tick(300);
  await flush();
  assert.notEqual(tip.style['display'], 'none');
  assert.equal(textOf(tip), 'zh-Hans deps.tipCall Group [a] a1');
  assert.equal(toA1.props['class'], 'link hot');

  // 离开连线：提示框过 300 毫秒收起，高亮没了
  fire(toA1.children[0], 'onMouseleave', pointer);
  t.mock.timers.tick(300);
  await flush();
  assert.equal(tip.style['display'], 'none');
  assert.equal(page.props['class'], 'page');

  // 按住 a1 拖到空白处松手
  fire(a1, 'onMouseenter', pointer);
  fire(a1, 'onMousedown', pointer);
  fire(a1, 'onMouseleave', pointer);
  await flush();
  assert.equal(a1.props['class'], 'node hot');
  assert.notEqual(tip.style['display'], 'none');
  browser.emit('mouseup');
  t.mock.timers.tick(300);
  await flush();
  assert.equal(tip.style['display'], 'none');
  assert.equal(page.props['class'], 'page');
  assert.equal(byClass(root, 'hot').length, 0);
});

test('依赖图：第一次量到画布大小时收拢一遍；之后大小变了停下的图不动，新的宽高下次建图时用上', async () => {
  const browser = fakeBrowser();
  comps.value = running();
  const root = mount(await load('../components/window-deps/src/DepsPage.vue'));
  const [svg] = byClass(root, 'page')[0]?.children ?? [];
  assert.ok(svg);
  // 节点外框的宽高比(viewBox 四周各留了 100)
  const shape = async (): Promise<number> => {
    await flush();
    const [, , width = 0, height = 0] = String(svg.props['viewBox']).split(' ').map(Number);
    return (width - 200) / (height - 200);
  };
  browser.play();

  browser.resize(600, 600);
  assert.equal(browser.frames.length, 1);
  browser.play();
  const square = await shape();

  browser.resize(1800, 300);
  assert.equal(browser.frames.length, 0);
  assert.equal(await shape(), square);

  comps.value = running();
  await flush();
  assert.equal(browser.frames.length, 1);
  browser.play();
  const wide = await shape();
  assert.ok(wide > square * 1.5, `方画布 ${square}，宽画布 ${wide}`);
});

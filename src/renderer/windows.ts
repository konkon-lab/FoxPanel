// 主窗口的页面组件：按主进程给的计划 import 各组件入口，在 Cordis 子上下文里 plugin；
// 组件用 ctx.window.page 注册页面，侧栏和内容区按注册的页面显示；ctx.window.slot 往固定位置(组件详情、整个窗口)放内容；
// ctx.window.settings 把自己的配置登记到设置页的一节。
// 计划变了怎么处理(重新加载哪些组件、什么时候整页重新加载)在 ./plan.ts。

import { markRaw, reactive, type Component } from 'vue';
import { Context, type Plugin } from 'cordis';
import { fox } from './store.ts';
import { define } from './i18n/index.ts';
import { createPlanRunner } from './plan.ts';
import type { Text } from '../shared/manifest.ts';
import type { CodeComponent, LogLevel } from '../shared/types.ts';
import { createBus } from '../shared/component-services.ts';
import { errorText, isObject } from '../shared/util.ts';

export interface RegisteredPage {
  id: string;
  owner: string;          // 注册它的组件 id
  title: Text;
  icon: Component;
  component: Component;
  order: number;          // 侧栏位置，小的在上
  index: number;          // 所在组件的顺序，order 相同时按它排
}

// component-details：组件详情里的一节；app：放在整个窗口上(对话框之类)；layout：铺满窗口的外壳(用组件顺序最前的)；
// dashboard：仪表盘上的一张卡片(area 是 left / right 列)
const SLOT_TYPES = ['component-details', 'app', 'layout', 'dashboard'] as const;
export type SlotType = typeof SLOT_TYPES[number];

export interface RegisteredSlot {
  type: SlotType;
  owner: string;
  component: Component;
  order: number;
  index: number;          // 所在组件的顺序，order 相同时按它排
  area: string;           // 插槽里的位置，由开插槽的一方定义(仪表盘：left / right)；没写为空
}

// 设置页一节里一个组件的内容：自定义内容 + 本组件配置里的这些键(没写 = 全部)
export interface RegisteredSettings {
  id: string;             // 节 id，同 id 合成一节
  title: Text;
  order: number;          // 节的顺序，小的在上
  owner: string;
  index: number;          // 所在组件的顺序，一节里按它排
  keys: string[] | null;
  component: Component | null;
}

export const windows = reactive<{ ready: boolean; pages: RegisteredPage[]; slots: RegisteredSlot[]; settings: RegisteredSettings[] }>({ ready: false, pages: [], slots: [], settings: [] });

type Registry = Pick<typeof windows, 'pages' | 'slots' | 'settings'>;
type Entry = { owner: string; order: number; index: number };
type WriteLog = (text: string, level?: LogLevel) => void;

const NOOP = (): void => {};

// 组件登记时传来的值的收窄；Vue 组件没法细查，非空就收
const isSlotType = (v: unknown): v is SlotType => (SLOT_TYPES as readonly unknown[]).includes(v);
const isText = (v: unknown): v is Text => typeof v === 'string' || isObject(v);
const isComponent = (v: unknown): v is Component => !!v;
const orderOf = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

// 登记项的顺序：order 小的在前，相同时按所在组件的顺序
const byOrder = (a: Entry, b: Entry): number => a.order - b.order || a.index - b.index;

// list 里属于一个组件的登记替换为 add 这一批
const swapped = <T extends Entry>(list: T[], owner: string, add: T[]): T[] => [...list.filter(e => e.owner !== owner), ...add].sort(byOrder);

// 一个组件的登记整批替换(同步完成，页面不会有一刻不在)；页面 id 已被别的组件占着的那几页不放进去
function replace(owner: string, next: Registry, log: WriteLog): void {
  const taken = new Set(windows.pages.filter(p => p.owner !== owner).map(p => p.id));
  for (const p of next.pages) if (taken.has(p.id)) log(`page id ${p.id} is already taken`, 'warn');
  windows.pages = swapped(windows.pages, owner, next.pages.filter(p => !taken.has(p.id)));
  windows.slots = swapped(windows.slots, owner, next.slots);
  windows.settings = swapped(windows.settings, owner, next.settings);
}

const root = new Context();

// 总线：主窗口里的组件之间直接送达，同时经宿主转给组件进程和别的页面
const hub = createBus((channel, data) => fox.busSend(channel, data), (channel, e) => console.error(`bus ${channel}`, e));
fox.onBus(hub.deliver);
const unloads = new Map<string, () => Promise<void>>();   // 组件 id → 卸载它(停掉插件、取消总线监听)

// 加载一个组件：apply 里登记的收在 pending 里，加载完整批放进登记表(重新加载时旧的登记到这时才被替换)；之后登记的直接进表
async function load(c: CodeComponent, index: number): Promise<void> {
  let pending: Registry | null = { pages: [], slots: [], settings: [] };
  const log: WriteLog = (text, level) => fox.logWrite(c.id, String(text), level);
  // 一项登记放进 pick 取的那张表，返回撤销它的函数(不管它还在 pending 里还是已经进了登记表)；
  // 登记项标成不做响应式代理：登记表整批替换之后表里仍是这个对象，撤销时找得到
  const add = <T extends Entry>(pick: (r: Registry) => T[], item: T): (() => void) => {
    const entry = markRaw(item);
    const list = pick(pending ?? windows);
    list.push(entry);
    list.sort(byOrder);
    return () => {
      for (const r of [pending, windows]) {
        const from = r ? pick(r) : [];
        const i = from.indexOf(entry);
        if (i >= 0) from.splice(i, 1);
      }
    };
  };
  const { bus, close } = hub.open();
  const service = {
    // 加载中只和自己这一批比 id(和别的组件冲突在整批放进登记表时查)；加载完之后和全部页面比
    page(v: unknown): () => void {
      const o = isObject(v) ? v : {};
      const { id, title, icon, component } = o;
      if (typeof id !== 'string' || !isText(title) || !isComponent(component) || !isComponent(icon)) return log('invalid page registration', 'warn'), NOOP;
      if ((pending ?? windows).pages.some(x => x.id === id)) return log(`page id ${id} is already taken`, 'warn'), NOOP;
      return add(r => r.pages, { id, owner: c.id, title, icon: markRaw(icon), component: markRaw(component), order: orderOf(o['order']), index });
    },
    slot(v: unknown): () => void {
      const o = isObject(v) ? v : {};
      const { type, component, area } = o;
      if (!isSlotType(type) || !isComponent(component)) return log('invalid slot registration', 'warn'), NOOP;
      return add(r => r.slots, { type, owner: c.id, component: markRaw(component), order: orderOf(o['order']), index, area: typeof area === 'string' ? area : '' });
    },
    settings(v: unknown): () => void {
      const o = isObject(v) ? v : {};
      const { id, title, component } = o;
      if (typeof id !== 'string' || !isText(title)) return log('invalid settings registration', 'warn'), NOOP;
      const keys = Array.isArray(o['keys']) ? o['keys'].filter((k): k is string => typeof k === 'string') : null;
      return add(r => r.settings, { id, title, order: orderOf(o['order']), owner: c.id, index, keys, component: isComponent(component) ? markRaw(component) : null });
    },
  };
  const ctx = root.extend({ id: c.id, config: c.config, log, bus, window: service, i18n: { define } });
  try {
    const plugin = (await import(/* @vite-ignore */ c.url) as { default?: Plugin }).default;
    if (!plugin) throw new Error('入口没有默认导出');
    const fiber = await ctx.plugin(plugin, c.config);
    unloads.set(c.id, () => fiber.dispose().finally(close));
  } catch (e) {
    close();
    log(`page load failed: ${errorText(e)}`, 'error');
  }
  replace(c.id, pending, log);
  pending = null;
}

// 卸载一个组件(停掉插件、取消总线监听)；没加载着时什么都不做
async function unload(id: string): Promise<void> {
  const stop = unloads.get(id);
  unloads.delete(id);
  await stop?.();
}

// 按主进程的计划加载组件并跟着计划变；计划的监听在读首份计划之前挂上，这期间推来的不会漏
export async function startWindows(): Promise<void> {
  const runner = createPlanRunner({
    load, unload,
    reloadPage: () => location.reload(),
    failed: (id, e) => fox.logWrite(id, `page reload failed: ${errorText(e)}`, 'error'),
  });
  fox.onWindowPlan(runner.next);
  await runner.start(await fox.windowPlan());
  windows.ready = true;
}

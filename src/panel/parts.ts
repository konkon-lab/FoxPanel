// 面板页面里各插槽的部件怎么挂、加载失败的组件怎么标：每个部件一个元素，根组件里出现对应的插槽元素(data-slot)时放进去，第一次放进去时加载它。
// 根组件在等服务、晚一点才画出插槽时也挂得上；一直没有插槽元素的部件过一阵记一行日志。
// 找插槽、加载、盯着根组件的变化、计时都由调用方给，这里不碰页面的全局对象。

import { WAIT_LOG_MS } from '../shared/component-services.ts';
import type { PageComponent } from '../shared/types.ts';

// 部件的元素里用到的部分：它所在的元素(没放进去时为 null)
export interface PartElement {
  readonly parentElement: unknown;
}

// 一个要挂的部件：进哪个插槽、它的元素、加载过没有
export interface PartMount<E extends PartElement> {
  slot: string;
  el: E;
  component: PageComponent;
  loaded: boolean;
}

export interface PartsDeps<E extends PartElement> {
  find(slot: string): { append(el: E): void } | null;   // 根组件里这个插槽的元素；还没有时为 null
  load(component: PageComponent, el: E): void;          // 加载一个部件，el 是它的元素
  observe(changed: () => void): () => void;             // 根组件的内容每次变了叫 changed；返回停止的函数
  later(fn: () => void, ms: number): void;              // 过 ms 毫秒调 fn
  warn(component: string, text: string): void;          // 记一行警告日志，来源是这个组件
}

// 部件的元素放进各自的插槽元素(已经在里面的不动)，第一次放进去时加载；返回是不是都放好了
export function placeParts<E extends PartElement>(mounts: readonly PartMount<E>[], deps: Pick<PartsDeps<E>, 'find' | 'load'>): boolean {
  for (const m of mounts) {
    const where = deps.find(m.slot);
    if (!where || m.el.parentElement === where) continue;
    where.append(m.el);
    if (m.loaded) continue;
    m.loaded = true;
    deps.load(m.component, m.el);
  }
  return mounts.every(m => m.el.parentElement !== null);
}

// 加载失败的标记用的类名
export const FAILED_CLASS = 'fox-notice fox-failed';

// 标记的元素里用到的部分
export interface MarkElement {
  className: string;
  textContent: string | null;
}

// 组件加载失败时在它的元素里放的标记(原因在运行日志里)：警示号加组件的名字，换掉元素里原有的内容。
// name 给出名字；follow 让一段代码在它读到的东西变了时重跑(界面语言换了，标记上的名字跟着换)
export function markFailed<M extends MarkElement>(el: { replaceChildren(...nodes: NoInfer<M>[]): void }, name: () => string, deps: { create(): M; follow(fn: () => void): void }): void {
  const mark = deps.create();
  mark.className = FAILED_CLASS;
  deps.follow(() => { mark.textContent = `⚠ ${name()}`; });
  el.replaceChildren(mark);
}

// 一直没有插槽元素的部件记进日志的那一行
export const noSlotText = (slot: string): string => `not loaded: the panel has no element for slot ${slot}`;

// 挂部件：马上放一遍；根组件的内容变了就再放一遍，到全部放好为止。过 WAIT_LOG_MS 还没加载的部件各记一行警告
export function mountParts<E extends PartElement>(mounts: readonly PartMount<E>[], deps: PartsDeps<E>): void {
  let stop = (): void => {};
  let done = false;
  const place = (): void => {
    if (done || !placeParts(mounts, deps)) return;
    done = true;
    stop();
  };
  stop = deps.observe(place);
  place();
  deps.later(() => {
    for (const m of mounts) if (!m.loaded) deps.warn(m.component.id, noSlotText(m.slot));
  }, WAIT_LOG_MS);
}

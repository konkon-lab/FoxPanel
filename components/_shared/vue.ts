// 预装组件用 Vue 渲染：把组件挂进插槽或弹层，组件里用 useCtx() 拿到 Cordis 上下文、用 useWords() 取界面文字。

import { computed, createApp, inject, watch, type Component, type ComputedRef, type InjectionKey } from 'vue';
import type { OverlayOptions, PageContext, PageServices, UiLang } from '@konkon-lab/foxpanel-sdk';

const CTX: InjectionKey<PageContext> = Symbol('ctx');

// 在 el 里挂一个 Vue 应用，返回卸载函数
export function mountVue(ctx: PageContext, el: HTMLElement, comp: Component, props?: Record<string, unknown>): () => void {
  const app = createApp(comp, props);
  app.provide(CTX, ctx);
  app.mount(el);
  return () => app.unmount();
}

// 挂进自己的插槽，组件卸载时自动卸掉
export function mountSlot(ctx: PageContext, comp: Component): void {
  ctx.effect(() => ctx.slot.mount(el => mountVue(ctx, el, comp)));
}

// 页面组件的入口：只把一个 Vue 组件挂进自己的插槽；inject 是它用到的全局服务
export function slotPlugin(name: string, comp: Component, inject: (keyof PageServices)[] = []): { name: string; inject: string[]; apply(ctx: PageContext): void } {
  return { name, inject, apply: ctx => mountSlot(ctx, comp) };
}

// open 为真期间开着一层挂了 comp 的弹层，返回停止函数(同时关掉弹层)。
// props 在打开时取，返回 null 就不开；closed 在弹层关掉时调用(含宿主因点空白处关掉的)
export function overlayWhile(
  ctx: PageContext, open: () => boolean, comp: Component, options: OverlayOptions = {},
  props: () => Record<string, unknown> | null = () => ({}), closed?: () => void,
): () => void {
  let close: (() => void) | null = null;
  const shut = (): void => {
    close?.();
    close = null;
  };
  const stop = watch(open, now => {
    if (!now) return shut();
    const p = close ? null : props();
    if (!p) return;
    close = ctx.overlay.open(el => {
      const unmount = mountVue(ctx, el, comp, p);
      return () => {
        close = null;
        unmount();
        closed?.();
      };
    }, options);
  });
  return () => {
    stop();
    shut();
  };
}

export function useCtx(): PageContext {
  const ctx = inject(CTX);
  if (!ctx) throw new Error('useCtx 只能在 mountVue 挂的组件里用');
  return ctx;
}

// 按界面语言取文案表里的那一份；表里没有这种语言时用简体
export function useWords<T>(table: Record<UiLang, T>): ComputedRef<T> {
  const ctx = useCtx();
  return computed(() => table[ctx.i18n.locale] ?? table['zh-Hans']);
}

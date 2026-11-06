// 组件管理提供的 components 服务(清单 requires 了它的组件用，加载时一定有)；打包时内联，每个组件各有一份。
import { shallowRef } from 'vue';
import type { WindowComponentsService, WindowContext } from '@konkon-lab/foxpanel-sdk';

export const comps = shallowRef<WindowComponentsService | null>(null);

// 组件加载时存下服务，卸载时清空
export function holdComponents(ctx: WindowContext): void {
  comps.value = ctx.components;
  ctx.effect(() => () => { comps.value = null; });
}

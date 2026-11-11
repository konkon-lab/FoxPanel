// 主窗口外壳：顶栏、侧栏、内容区、状态栏铺满窗口(插槽 layout)。

import type { WindowContext } from '@konkon-lab/foxpanel-sdk';
import { defineAll } from '../../_shared/window/i18n.ts';
import { messages } from './i18n.ts';
import Layout from './Layout.vue';

export default {
  name: 'yanuo.window-shell',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    ctx.window.slot({ type: 'layout', component: Layout });
  },
};

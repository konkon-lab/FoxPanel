// 主窗口页面「依赖管理」：注册侧栏入口和页面；显示名、安装流程取自组件管理的 components 服务。

import { Package } from '@lucide/vue';
import type { WindowContext } from '@konkon-lab/foxpanel-sdk';
import { defineAll, textFrom } from '../../_shared/window/i18n.ts';
import { holdComponents } from '../../_shared/window/components-service.ts';
import { messages } from './i18n.ts';
import own from './locales.ts';
import PackagesPage from './PackagesPage.vue';

export default {
  name: 'yanuo.window-packages',
  inject: ['components'],
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    holdComponents(ctx);
    ctx.window.page({ id: 'packages', title: textFrom(own, 'pk.title'), icon: Package, component: PackagesPage, order: 2 });
  },
};

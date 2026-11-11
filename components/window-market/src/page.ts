// 主窗口页面「市场」：注册侧栏入口和页面；本组件配置里的组件来源和安装脚本交给宿主(下载组件时用)，在组件页改。

import { Store } from '@lucide/vue';
import type { WindowContext } from '@konkon-lab/foxpanel-sdk';
import { fox, store } from '@konkon-lab/foxpanel-window';
import { defineAll, textFrom } from '../../_shared/window/i18n.ts';
import { messages } from './i18n.ts';
import own from './locales.ts';
import MarketPage from './MarketPage.vue';

export default {
  name: 'yanuo.window-market',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    ctx.window.page({ id: 'market', title: textFrom(own, 'mk.title'), icon: Store, component: MarketPage, order: 1.5 });
    const registry = typeof ctx.config['registry'] === 'string' ? ctx.config['registry'] : '';
    const scripts = ctx.config['scripts'] === true;
    const now = store.settings.components.market;
    if (registry && (registry !== now.registry || scripts !== now.scripts)) void fox.compSet({ kind: 'market', market: { registry, scripts } });
  },
};

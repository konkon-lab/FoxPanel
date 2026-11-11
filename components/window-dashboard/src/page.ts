// 主窗口页面「仪表盘」：注册侧栏入口和页面。

import { Gauge } from '@lucide/vue';
import type { WindowContext } from '@konkon-lab/foxpanel-sdk';
import { defineAll } from '../../_shared/window/i18n.ts';
import { messages } from './i18n.ts';
import HomePage from './HomePage.vue';

export default {
  name: 'yanuo.window-dashboard',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    ctx.window.page({ id: 'home', title: { 'zh-Hans': '仪表盘', 'zh-Hant': '儀表板', ja: 'ダッシュボード', en: 'Dashboard', ko: '대시보드' }, icon: Gauge, component: HomePage, order: 0 });
  },
};

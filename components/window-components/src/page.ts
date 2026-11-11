// 主窗口页面「组件管理」：注册侧栏入口和页面，提供 components 服务(组件树、显示名、安装流程、最近的错误)；
// 有设置组件时把开发者模式登记到设置页「常规」；加载时把开发者模式交给宿主。

import { Puzzle } from '@lucide/vue';
import { fox, store } from '@konkon-lab/foxpanel-window';
import type { WindowComponentsService, WindowContext } from '@konkon-lab/foxpanel-sdk';
import { defineAll } from '../../_shared/window/i18n.ts';
import { messages } from './i18n.ts';
import { nameOf, tree } from './comp-tree.ts';
import { confirmInstall, installMenu, onInstallMenu, pending } from './install.ts';
import { lastError } from './ops.ts';
import { settingsService } from './settings.ts';
import ComponentsPage from './ComponentsPage.vue';

const service: WindowComponentsService = {
  get tree() { return tree.value; },
  nameOf,
  get error() { return lastError.value; },
  set error(v: string) { lastError.value = v; },
  get installMenu() { return installMenu.value; },
  install: onInstallMenu,
  get pending() { return pending.value; },
  confirm: confirmInstall,
};

export default {
  name: 'yanuo.window-components',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    ctx.provide('components', service);
    ctx.window.page({ id: 'components', title: { 'zh-Hans': '组件', 'zh-Hant': '元件', ja: 'コンポーネント', en: 'Components', ko: '컴포넌트' }, icon: Puzzle, component: ComponentsPage, order: 1 });
    ctx.inject(['settings'], inner => {
      const sub = inner as WindowContext;
      const general = sub.settings.sections.general;
      sub.effect(() => sub.window.settings({ ...general, order: general.order + 3, keys: ['devMode'] }));
      settingsService.value = sub.settings;
      sub.effect(() => () => { settingsService.value = null; });
    });
    const devMode = ctx.config['devMode'] === true;
    if (devMode !== store.comps.devMode) void fox.compSet({ kind: 'devMode', on: devMode });
  },
};

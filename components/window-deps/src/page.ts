// 主窗口页面「依赖图」：注册侧栏入口和页面；组件树取自组件管理的 components 服务。

import GraphIcon from './GraphIcon.vue';
import type { WindowContext } from '@konkon-lab/foxpanel-sdk';
import { defineAll, textFrom } from '../../_shared/window/i18n.ts';
import { holdComponents } from '../../_shared/window/components-service.ts';
import { messages } from './i18n.ts';
import own from './locales.ts';
import DepsPage from './DepsPage.vue';

export default {
  name: 'yanuo.window-deps',
  inject: ['components'],
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    holdComponents(ctx);
    ctx.window.page({ id: 'deps', title: textFrom(own, 'deps.title'), icon: GraphIcon, component: DepsPage, order: 3 });
  },
};

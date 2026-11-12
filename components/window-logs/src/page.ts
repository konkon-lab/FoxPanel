// 主窗口页面「日志」：注册侧栏入口和页面；往组件详情里放「运行日志」一节。

import { FileText } from '@lucide/vue';
import type { WindowContext } from '@konkon-lab/foxpanel-sdk';
import { defineAll, textFrom } from '../../_shared/window/i18n.ts';
import { messages } from './i18n.ts';
import own from './locales.ts';
import LogsPage from './LogsPage.vue';
import DetailLogs from './DetailLogs.vue';
import { level } from './level.ts';
import { levelOf } from './rank.ts';

export default {
  name: 'yanuo.window-logs',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    level.value = levelOf(ctx.config['level']);
    ctx.window.page({ id: 'logs', title: textFrom(own, 'log.title'), icon: FileText, component: LogsPage, order: 4 });
    ctx.window.slot({ type: 'component-details', component: DetailLogs, order: -100 });
  },
};

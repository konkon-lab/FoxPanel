// 遥测组件的主窗口部分：往本组件的详情里放「在线记录」一节(发送状态和记录里的三项，插槽 component-details)。
// 状态来自主进程部分；开关是本组件的设置项，在组件详情里改。

import type { WindowContext } from '@konkon-lab/foxpanel-sdk';
import { defineAll } from '../../_shared/window/i18n.ts';
import { messages } from './i18n.ts';
import { connect } from './view.ts';
import RecordSection from './RecordSection.vue';

export default {
  name: 'yanuo.telemetry',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    ctx.window.slot({ type: 'component-details', component: RecordSection, order: 10 });
    connect(ctx.bus);
  },
};

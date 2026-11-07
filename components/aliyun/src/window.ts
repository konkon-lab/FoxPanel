// 阿里云组件的主窗口部分(用量)：收主进程推来的账本，提供 usage 服务(响应式账本)；往组件详情放「用量」一节，往仪表盘放今日费用、
// 近 14 天、本月费用三张卡片。

import type { WindowContext, WindowUsageService } from '@konkon-lab/foxpanel-sdk';
import { dayOf, isObject } from '../../_shared/util.ts';
import { defineAll } from '../../_shared/window/i18n.ts';
import { parseBook } from './book.ts';
import { BOOK, GET } from './channels.ts';
import { messages } from './i18n.ts';
import { ledger, today } from './state.ts';
import UsageSection from './UsageSection.vue';
import CostToday from './CostToday.vue';
import CostBars from './CostBars.vue';
import CostMonth from './CostMonth.vue';

const DAY_CHECK_MS = 60_000;   // 隔多久看一次日期变没变(毫秒)

export default {
  name: 'yanuo.aliyun',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    ctx.bus.on(BOOK, book => {
      if (isObject(book)) ledger.book = parseBook(book);
    });
    // 过了零点更新「今天」，卡片跟着重算
    ctx.effect(() => {
      const timer = setInterval(() => {
        const now = new Date();
        if (dayOf(now) !== dayOf(today.value)) today.value = now;
      }, DAY_CHECK_MS);
      return () => clearInterval(timer);
    });
    const usage: WindowUsageService = {
      get book() {
        return ledger.book;
      },
    };
    ctx.provide('usage', usage);
    ctx.bus.send(GET);
    ctx.window.slot({ type: 'component-details', component: UsageSection, order: 0 });
    ctx.window.slot({ type: 'dashboard', area: 'left', component: CostToday, order: 0 });
    ctx.window.slot({ type: 'dashboard', area: 'left', component: CostBars, order: 10 });
    ctx.window.slot({ type: 'dashboard', area: 'right', component: CostMonth, order: 0 });
  },
};

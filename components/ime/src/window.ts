// 输入法组件的主窗口部分：从主进程部分拿语言信息；往语言组件的详情放「基础设置」一节(输入模式、搜狗词库导入)。

import type { WindowContext } from '@konkon-lab/foxpanel-sdk';
import { defineAll } from '../../_shared/window/i18n.ts';
import { GET, LANGS, parseLangsInfo, parseSogouResult, SOGOU_DONE } from './channels.ts';
import { messages, t } from './i18n.ts';
import { bus, info, sogou } from './state.ts';
import LangSection from './LangSection.vue';

export default {
  name: 'yanuo.ime',
  apply(ctx: WindowContext) {
    defineAll(ctx, ...messages);
    bus.value = ctx.bus;
    ctx.effect(() => () => { bus.value = null; });
    ctx.effect(() => ctx.bus.on(LANGS, v => {
      const next = parseLangsInfo(v);
      if (next) Object.assign(info, next);
    }));
    ctx.effect(() => ctx.bus.on(SOGOU_DONE, v => {
      const r = parseSogouResult(v);
      if (!r) return;
      sogou.importing = false;
      sogou.message = r.ok ? t('ime.sogouDone', { n: r.count.toLocaleString() }) : r.error;
    }));
    ctx.bus.send(GET);
    // 运行日志(-100)之后、组件自己的配置之前
    ctx.window.slot({ type: 'component-details', component: LangSection, order: -50 });
  },
};

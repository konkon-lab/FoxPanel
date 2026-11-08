// 候选栏：一行候选 + 展开按钮；展开后在弹层里盖住外壳主体，整页排满候选。
// 输入串变了回到第一页；PgUp / PgDn(kb/page)翻页。

import type { PageContext } from '@konkon-lab/foxpanel-sdk';
import { watch } from 'vue';
import { mountSlot, overlayWhile } from '../../_shared/vue.ts';
import { pageCandidates, ui } from './ui.ts';
import Bar from './Bar.vue';
import More from './More.vue';

export default {
  name: 'yanuo.candidates',
  inject: ['kb', 'overlay', 'i18n'],
  apply(ctx: PageContext) {
    mountSlot(ctx, Bar);
    ctx.on('kb/page', dir => pageCandidates(ctx.kb.state.candidates.length, dir));
    ctx.effect(() => watch(() => ctx.kb.state.composition, now => {
      ui.barStart = 0;
      ui.moreStart = 0;
      if (!now) ui.expanded = false;
    }));
    // 展开期间开着弹层；点弹层空白处不关(展开按钮、选字、输入串清空时收起)
    ctx.effect(() => overlayWhile(ctx, () => ui.expanded, More, { cover: 'body', dismiss: false }));
  },
};

// 按键渲染(跑在键盘面板的页面里)：提供 keys 服务，校验布局 JSON 并画进布局组件的插槽(不合格时插槽里显示原因并记日志)；
// 开着的语言多于两种时，语言键打开语言面板(弹层，从语言键上方弹出)。

import type { PageContext } from '@konkon-lab/foxpanel-sdk';
import { parseLayout } from './layout.ts';
import { mountVue, overlayWhile } from '../../_shared/vue.ts';
import { ui } from './ui.ts';
import Keys from './Keys.vue';
import LangPicker from './LangPicker.vue';

const PICKER_GAP_PX = 8;   // 语言面板底边到语言键上沿的距离(像素)

// 在布局组件的上下文里画键区和语言面板，返回卸载函数
function mount(ctx: PageContext, raw: unknown): () => void {
  const r = parseLayout(raw);
  if (!r.ok) {
    ctx.log(`layout is invalid: ${r.errors.join('; ')}`, 'error');
    return ctx.slot.mount(el => {
      const p = document.createElement('p');
      p.className = 'fox-notice';
      p.textContent = r.errors[0] ?? '';
      el.append(p);
      return () => p.remove();
    });
  }
  const layout = r.layout;
  const unmount = ctx.slot.mount(el => mountVue(ctx, el, Keys, { layout }));
  // 语言面板：左边对齐语言键，找不到语言键就不开；点面板外面关掉
  const stop = overlayWhile(ctx, () => ui.langOpen, LangPicker, {}, () => {
    const key = ctx.slot.el.querySelector('[data-fn="lang"]')?.getBoundingClientRect();
    return key ? { anchor: { left: key.left, bottom: window.innerHeight - key.top + PICKER_GAP_PX } } : null;
  }, () => { ui.langOpen = false; });
  return () => {
    stop();
    unmount();
  };
}

export default {
  name: 'yanuo.keys',
  apply(ctx: PageContext) {
    ctx.provide('keys', { mount });
  },
};

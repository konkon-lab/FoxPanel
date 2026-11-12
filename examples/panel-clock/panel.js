// 时钟面板：一块只有自己的面板，显示时间和日期，右上角一个收起按钮。纯 JS，不用构建。

import { watchEffect } from 'vue';

// 收起按钮的说明文字
const HIDE = { 'zh-Hans': '收起', 'zh-Hant': '收起', ja: '閉じる', en: 'Hide', ko: '닫기' };

export default {
  name: 'yanuo.panel-clock',
  inject: ['i18n'],
  apply(ctx) {
    const { hour24, seconds } = ctx.config;
    ctx.effect(() => ctx.slot.mount(el => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px';
      const time = document.createElement('div');
      time.style.cssText = 'font-size:64px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums';
      const date = document.createElement('div');
      date.style.cssText = 'font-size:22px;color:var(--sub)';
      const hide = document.createElement('button');
      hide.type = 'button';
      hide.className = 'icon-btn';
      hide.textContent = '×';
      hide.style.cssText = 'position:absolute;top:4px;right:4px;font-size:24px';
      hide.addEventListener('mousedown', () => ctx.panel.hide());
      card.append(time, date, hide);
      el.append(card);

      // 时间和日期按界面语言写
      const draw = () => {
        const now = new Date();
        const locale = ctx.i18n.locale;
        time.textContent = now.toLocaleTimeString(locale, {
          hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}), hourCycle: hour24 ? 'h23' : 'h12',
        });
        date.textContent = now.toLocaleDateString(locale, { dateStyle: 'full' });
        hide.ariaLabel = ctx.i18n.text(HIDE);
      };
      // 面板显示着时每秒画一次，没在显示时停表；界面语言变了、面板重新显示出来时马上画
      return watchEffect(onCleanup => {
        if (!ctx.panel.visible) return;
        draw();
        const timer = setInterval(draw, 1000);
        onCleanup(() => clearInterval(timer));
      });
    }));
  },
};

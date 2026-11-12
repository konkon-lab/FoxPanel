// 手腕时钟：附着在左手手柄上的一块小面板，只显示时间和星期、日期。纯 JS，不用构建。

import { watchEffect } from 'vue';

export default {
  name: 'yanuo.panel-wrist',
  inject: ['i18n'],
  apply(ctx) {
    const { hour24 } = ctx.config;
    ctx.effect(() => ctx.slot.mount(el => {
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px';
      const time = document.createElement('div');
      time.style.cssText = 'font-size:56px;font-weight:600;line-height:1;font-variant-numeric:tabular-nums';
      const date = document.createElement('div');
      date.style.cssText = 'font-size:18px;color:var(--sub)';
      card.append(time, date);
      el.append(card);

      // 时间和日期按界面语言写
      const draw = () => {
        const now = new Date();
        const locale = ctx.i18n.locale;
        time.textContent = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hourCycle: hour24 ? 'h23' : 'h12' });
        date.textContent = now.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
      };
      // 页面在画时每秒画一次(手垂着、面板没显示时也在画，抬手就是这一刻的时间)；面板被收起、页面停画时停表
      return watchEffect(onCleanup => {
        if (!ctx.panel.visible) return;
        draw();
        const timer = setInterval(draw, 1000);
        onCleanup(() => clearInterval(timer));
      });
    }));
  },
};

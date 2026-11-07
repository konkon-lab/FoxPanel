// 输入法没部署好时盖住整页的提示(弹层)：文字跟界面语言，点不到下面的键。

import type { PageContext } from '@konkon-lab/foxpanel-sdk';
import { watch, watchEffect } from 'vue';
import { TEXT } from './words.ts';

// 提示的样子：铺满弹层，半透明的面板底色，文字居中
const VEIL_STYLE = {
  width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'color-mix(in srgb, var(--panel) 70%, transparent)', color: 'var(--sub)', fontSize: '18px',
} as const;

// shown 为真期间开着提示(调用时已经为真就立即打开)；返回停止函数(同时关掉提示)
export function deployingVeil(ctx: Pick<PageContext, 'overlay' | 'i18n'>, shown: () => boolean): () => void {
  let close: (() => void) | null = null;
  const shut = (): void => {
    close?.();
    close = null;
  };
  const stop = watch(shown, on => {
    if (!on) return shut();
    close ??= ctx.overlay.open(layer => {
      const box = document.createElement('div');
      box.className = 'ime-deploying';
      Object.assign(box.style, VEIL_STYLE);
      const follow = watchEffect(() => { box.textContent = (TEXT[ctx.i18n.locale] ?? TEXT['zh-Hans']).deploying; });
      layer.append(box);
      return follow;
    }, { dismiss: false });
  }, { immediate: true, flush: 'sync' });
  return () => {
    stop();
    shut();
  };
}

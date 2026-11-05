// 主窗口给页面组件的模块 @konkon-lab/foxpanel-window：宿主的数据(store)、主进程接口(fox)、文案(t、locale)、跳转(nav、openPage 等)、金额显示、已注册的页面(windows)，
// 以及组件常用的函数：多语言文字取值(textOf)、配置项是否显示(isVisible)、只能开一个的类别(SINGLE_KINDS)、定义文案表(defineMessages)。
// 宿主启动时挂到 globalThis 上，共享库里的 window.js 再按名字转成模块导出。

import { componentName, fox, store } from './store.ts';
import { locale, text as t } from './i18n/index.ts';
import { nav, openComponent, openGroup, openPage } from './nav.ts';
import { amount, money } from './money.ts';
import { windows } from './windows.ts';
import { WINDOW_API_GLOBAL, type WindowApiName } from '../shared/window-api.ts';
import { isVisible, SINGLE_KINDS, textOf } from '../shared/manifest.ts';
import { defineMessages } from '../shared/messages.ts';

export { amount, componentName, defineMessages, fox, isVisible, locale, money, nav, openComponent, openGroup, openPage, SINGLE_KINDS, store, t, textOf, windows };

const api: Record<WindowApiName, unknown> = { store, fox, t, locale, nav, openPage, openComponent, openGroup, money, amount, componentName, windows, textOf, isVisible, SINGLE_KINDS, defineMessages };

export function installWindowApi(): void {
  (globalThis as Record<string, unknown>)[WINDOW_API_GLOBAL] = api;
}

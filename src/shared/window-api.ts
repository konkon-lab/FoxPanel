// 主窗口给页面组件的模块 @konkon-lab/foxpanel-window 导出的名字。宿主把这些挂在 globalThis 上，
// 打包时按这份名单生成转接模块 lib/window.js。

export const WINDOW_API_NAMES = ['store', 'fox', 't', 'locale', 'nav', 'openPage', 'openComponent', 'openGroup', 'money', 'amount', 'componentName', 'windows', 'textOf', 'isVisible', 'SINGLE_KINDS', 'defineMessages'] as const;

export type WindowApiName = typeof WINDOW_API_NAMES[number];

// 宿主挂对象用的全局名
export const WINDOW_API_GLOBAL = '__foxWindow';

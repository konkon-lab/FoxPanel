// 主窗口里 window.fox 的全局声明：preload 挂上去的接口。面板页面和媒体页面的 window.fox 是 PageApi，由页面宿主自己收窄(src/panel/services.ts)。

import type { FoxApi } from './types.ts';

declare global {
  interface Window {
    fox: FoxApi;
  }
}

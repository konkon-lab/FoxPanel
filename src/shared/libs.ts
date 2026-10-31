// 共享库：宿主页面和页面组件 import 这些模块时不打进各自的包，由页面的 import map 指到 dist 里的同一份文件。
// 打包脚本(scripts/build.ts、vite.config.ts)按这两张表设 external、生成库文件和各页面的 import map。

// 共享库文件所在的文件夹(相对 dist，/ 分隔)
export const LIB_DIR = 'host/lib';

// 主窗口能用的共享库：模块名 → LIB_DIR 下的文件名
export const WINDOW_LIBS = {
  vue: 'vue.js',
  'naive-ui': 'naive-ui.js',
  '@lucide/vue': 'lucide-vue.js',
  cordis: 'cordis.js',
  '@konkon-lab/foxpanel-window': 'window.js',
} as const;

export type LibName = keyof typeof WINDOW_LIBS;

// 面板页面和媒体页面能用的共享库
export const PANEL_LIBS = { vue: WINDOW_LIBS.vue, cordis: WINDOW_LIBS.cordis } as const;

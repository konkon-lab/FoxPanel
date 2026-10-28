// 主窗口页面打包：src/renderer → dist/host/window，从 fox://host/window/ 加载；
// 共享库(src/shared/libs.ts 的 WINDOW_LIBS)不打进去，由 import map 指向 dist/host/lib 里的那份。

import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { WINDOW_LIBS } from './src/shared/libs.ts';

export default defineConfig({
  root: path.resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  plugins: [vue()],
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/host/window'),
    emptyOutDir: true,
    target: 'es2023',
    sourcemap: true,
    modulePreload: false,
    rollupOptions: { external: Object.keys(WINDOW_LIBS) },
  },
});

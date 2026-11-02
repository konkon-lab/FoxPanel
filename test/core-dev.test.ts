// 只在这次运行加载的组件文件夹(src/main/dev.ts)：未打包、带 FOXPANEL_PANELS=1 才有开发用的显示方。

import test from 'node:test';
import assert from 'node:assert/strict';
import { devComponents, PANELS_ENV } from '../src/main/dev.ts';

const DISPLAY = 'dist/dev/display-desktop';

test('未打包的程序带 FOXPANEL_PANELS=1 启动时加载开发用的显示方，值不是 1 或没带时不加载', () => {
  assert.equal(PANELS_ENV, 'FOXPANEL_PANELS');
  assert.deepEqual(devComponents({ FOXPANEL_PANELS: '1' }, false, DISPLAY), [DISPLAY]);
  assert.deepEqual(devComponents({ FOXPANEL_PANELS: 'true' }, false, DISPLAY), []);
  assert.deepEqual(devComponents({ FOXPANEL_PANELS: '' }, false, DISPLAY), []);
  assert.deepEqual(devComponents({}, false, DISPLAY), []);
});

test('打包后的程序不看 FOXPANEL_PANELS', () => {
  assert.deepEqual(devComponents({ FOXPANEL_PANELS: '1' }, true, DISPLAY), []);
  assert.deepEqual(devComponents({}, true, DISPLAY), []);
});

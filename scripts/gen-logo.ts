// 把程序图标 resources/icon.png 缩成主窗口侧栏的标志 components/window-shell/src/logo.png。
// 用法：node scripts/gen-logo.ts

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import icongen from 'icon-gen';

const SIZE = 192;   // 标志的边长(像素)：侧栏里显示 64 像素，够 300% 的显示缩放

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-logo-'));
// favicon 只要它的 PNG(logo-<像素>.png)，顺带生成的 favicon.ico 留在临时文件夹里一起删掉
await icongen(path.join(root, 'resources', 'icon.png'), tmp, {
  report: false,
  favicon: { name: 'logo-', pngSizes: [SIZE], icoSizes: [SIZE] },
});
const out = path.join(root, 'components', 'window-shell', 'src', 'logo.png');
fs.copyFileSync(path.join(tmp, `logo-${SIZE}.png`), out);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`已生成 ${out}`);

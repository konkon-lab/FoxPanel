// 程序图标：icon-gen 把 resources/icon.png(1024 像素)缩到 dist/icons/：
// icon.ico(窗口、任务栏、安装包，16–256 像素多尺寸)、tray-<像素>.png(托盘，按显示缩放各一张)、icon.png(512 像素)。

import fs from 'node:fs';
import path from 'node:path';
import icongen from 'icon-gen';

const ICO_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];   // ICO 里的尺寸(像素)
const TRAY_SIZES = [16, 20, 24, 32, 40, 48, 64];            // 托盘：16 像素 × 显示缩放 100%–400%
const PNG_SIZE = 512;                                       // icon.png 的边长(像素)

export async function buildIcons(root: string, dist: string): Promise<void> {
  const out = path.join(dist, 'icons');
  fs.mkdirSync(out, { recursive: true });
  // favicon 只要它的 PNG(tray-<像素>.png)，顺带生成的 favicon.ico 删掉
  await icongen(path.join(root, 'resources', 'icon.png'), out, {
    report: false,
    ico: { name: 'icon', sizes: ICO_SIZES },
    favicon: { name: 'tray-', pngSizes: [...TRAY_SIZES, PNG_SIZE], icoSizes: [] },
  });
  fs.renameSync(path.join(out, `tray-${PNG_SIZE}.png`), path.join(out, 'icon.png'));
  fs.rmSync(path.join(out, 'favicon.ico'), { force: true });
}

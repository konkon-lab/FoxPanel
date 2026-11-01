// 数据文件夹的目录浏览(给页面的特权 API)：列子文件夹、新建文件夹；路径都限制在数据文件夹里。

import fs from 'node:fs';
import path from 'node:path';
import type { ComponentResult, DirListing } from '../shared/types.ts';
import { errorText } from '../shared/util.ts';

const OUTSIDE = '路径不在数据文件夹里';

// 页面传来的相对路径：不是字符串时当作空(数据文件夹本身)
const relOf = (rel: unknown): string => (typeof rel === 'string' ? rel : '');

// 数据文件夹里的路径(rel 用 / 分隔，空 = 数据文件夹本身)；越出数据文件夹时为 null
export function dataPath(root: string, rel: unknown): string | null {
  const base = path.resolve(root);
  const file = path.resolve(base, relOf(rel));
  return file === base || file.startsWith(base + path.sep) ? file : null;
}

// rel 下的子文件夹，按名字排序
export function listDirs(root: string, rel: unknown): DirListing {
  const dir = dataPath(root, rel);
  if (dir === null) return { ok: false, error: OUTSIDE };
  try {
    const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name).sort((a, b) => a.localeCompare(b));
    return { ok: true, rel: relOf(rel), dirs };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

// 在 rel 下新建文件夹 name(可以带 / 建多层，建好的也要在数据文件夹里)
export function makeDir(root: string, rel: unknown, name: unknown): ComponentResult {
  if (typeof name !== 'string' || !name.trim()) return { ok: false, error: '文件夹名不能为空' };
  const parent = dataPath(root, rel);
  const dir = parent === null ? null : dataPath(root, path.join(parent, name.trim()));
  if (dir === null) return { ok: false, error: OUTSIDE };
  try {
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorText(e) };
  }
}

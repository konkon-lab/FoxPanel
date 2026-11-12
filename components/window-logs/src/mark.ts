// 写到哪的标记(日志目录里的 written.json)：最后处理的那一行的时间和行号。
// 组件进程重启时宿主会补发内存里的行，不在标记之后的行跳过。

import fs from 'node:fs';
import type { LogEntry } from '@konkon-lab/foxpanel-sdk';
import { isObject } from '../../_shared/util.ts';

export interface Mark {
  time: number;   // 行的时间(毫秒时间戳)
  id: number;     // 行号；宿主每次启动从 1 数起，所以连时间一起比
}

// 这一行是否在标记之后(没有标记时都算)
export const isAfter = (e: LogEntry, m: Mark | null): boolean => !m || e.time > m.time || (e.time === m.time && e.id > m.id);

// 读标记；没有或格式不对返回 null
export function readMark(file: string): Mark | null {
  try {
    const v: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!isObject(v)) return null;
    const { time, id } = v;
    return typeof time === 'number' && typeof id === 'number' ? { time, id } : null;
  } catch {
    return null;
  }
}

// 存标记；目录用不了时忽略
export function writeMark(file: string, mark: Mark): void {
  try {
    fs.writeFileSync(file, JSON.stringify(mark));
  } catch { /* 忽略 */ }
}

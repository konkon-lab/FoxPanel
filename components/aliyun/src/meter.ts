// 用量账本文件(数据文件夹的 usage.json)：组件记的每一笔按天汇总，变化后延迟写盘并通知；写盘时只留最近 KEEP_DAYS 个有记录的日子。

import fs from 'node:fs';
import type { UsageBook } from '@konkon-lab/foxpanel-sdk';
import { dayOf, isObject } from '../../_shared/util.ts';
import { finiteNumbers, isFiniteNumber, mergeTotal, parseBook } from './book.ts';

const SAVE_MS = 3000;    // 账本变化后隔多久写盘(毫秒)
const KEEP_DAYS = 400;   // 账本里最多留多少个日子(只数有记录的日子，不是自然日)
const ITEM_MAX = 64;     // item 名最长字数

export class UsageMeter {
  private readonly file: string;
  private readonly changed: (book: UsageBook) => void;
  private data: UsageBook = {};
  private saveTimer: NodeJS.Timeout | undefined;

  constructor(file: string, changed: (book: UsageBook) => void) {
    this.file = file;
    this.changed = changed;
    try {
      this.data = parseBook(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch { /* 没有文件或读不出来：从空账本开始 */ }
  }

  get book(): UsageBook {
    return this.data;
  }

  // 记一笔；格式不对的忽略
  add(id: string, e: unknown, now = new Date()): void {
    if (!isObject(e)) return;
    const { item, amount, cost } = e;
    if (typeof item !== 'string' || !item || item.length > ITEM_MAX || !isObject(amount)) return;
    const day = (this.data[dayOf(now)] ??= {});
    const comp = (day[id] ??= {});
    comp[item] = mergeTotal(comp[item], { amount: finiteNumbers(amount), calls: 1, cost: isFiniteNumber(cost) ? cost : null });
    this.changed(this.data);
    this.saveTimer ??= setTimeout(() => this.flush(), SAVE_MS);
  }

  // 卸载组件：删掉它的用量
  removeAll(id: string): void {
    let hit = false;
    for (const day of Object.values(this.data)) {
      if (id in day) {
        delete day[id];
        hit = true;
      }
    }
    if (!hit) return;
    this.changed(this.data);
    this.flush();
  }

  // 写盘；日子超过 KEEP_DAYS 个时删掉最早的
  flush(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const days = Object.keys(this.data).sort();
    for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete this.data[d];
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.data));
    } catch {
      // 写入失败时下次重试
    }
  }
}

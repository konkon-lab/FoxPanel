// 日志文件：按天一个文件(日期.log)，写满后接着写当天的下一个(日期-2.log …)；超过保存天数的删掉。
// write 只把行攒在内存里，flush 一次追加进文件：一批行只开一次文件。

import fs from 'node:fs';
import path from 'node:path';
import type { LogEntry, LogLevel } from '@konkon-lab/foxpanel-sdk';
import { dayOf } from '../../_shared/util.ts';
import { atLeast } from './rank.ts';

const FILE = /^(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.log$/;   // 文件名：日期，可选的当天第几个
const DAY_MS = 86400_000;                                // 一天的毫秒数

export interface LogFileOptions {
  level: LogLevel;     // 记录这一级和更严重的
  dir: string;         // 存放目录(绝对路径)
  maxAge: number;      // 文件保存天数
  maxSize: number;     // 单个文件最大字节数
}

export class LogFiles {
  private readonly opts: LogFileOptions;
  private file = '';       // 正在写的文件名
  private size = 0;        // 正在写的文件大小(字节)，算上还没落盘的行
  private pending = '';    // 还没落盘的行，都属于正在写的文件

  constructor(opts: LogFileOptions) {
    this.opts = opts;
    try {
      fs.mkdirSync(opts.dir, { recursive: true });
      this.prune();
    } catch { /* 目录用不了时不写 */ }
  }

  // 收一行，等 flush 落盘；低于记录等级的不收；选不了文件时丢掉这一行
  write(e: LogEntry): void {
    if (!atLeast(e.level, this.opts.level)) return;
    const stamp = new Date(e.time).toLocaleTimeString('zh-CN', { hour12: false });
    const line = `${stamp} [${e.level[0]!.toUpperCase()}] ${e.source || 'host'} ${e.text}\n`;
    const day = dayOf(new Date(e.time));
    try {
      if (!this.file.startsWith(day)) this.pick(day);
      const bytes = Buffer.byteLength(line);
      if (this.size > 0 && this.size + bytes > this.opts.maxSize) this.pick(day, this.part(this.file) + 1);
      this.pending += line;
      this.size += bytes;
    } catch { /* 忽略 */ }
  }

  // 把攒着的行追加进正在写的文件；写不了时丢掉这些行，下一行来时重新选文件
  flush(): void {
    if (!this.pending) return;
    const text = this.pending;
    this.pending = '';
    try {
      fs.appendFileSync(path.join(this.opts.dir, this.file), text);
    } catch {
      this.file = '';
    }
  }

  // 选当天要写的文件：从 from 号开始，用第一个没写满的；攒着的行落进之前的文件
  private pick(day: string, from = 1): void {
    this.flush();
    for (let n = from; ; n++) {
      const name = n === 1 ? `${day}.log` : `${day}-${n}.log`;
      const full = path.join(this.opts.dir, name);
      const size = fs.existsSync(full) ? fs.statSync(full).size : 0;
      if (size < this.opts.maxSize) {
        this.file = name;
        this.size = size;
        return;
      }
    }
  }

  // 文件名里的「当天第几个」
  private part(name: string): number {
    return Number(FILE.exec(name)?.[2] ?? 1);
  }

  // 删掉超过保存天数的日志文件
  private prune(): void {
    const cutoff = dayOf(new Date(Date.now() - this.opts.maxAge * DAY_MS));
    for (const f of fs.readdirSync(this.opts.dir)) {
      const m = FILE.exec(f);
      if (m && m[1]! < cutoff) fs.rmSync(path.join(this.opts.dir, f), { force: true });
    }
  }
}

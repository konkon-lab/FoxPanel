// 运行日志：宿主和组件写的每一行记进内存(最近 LOG_KEEP 行)，新行合并后推出去(主窗口、组件进程)。写文件由日志组件做。

import { LOG_KEEP, type LogEntry, type LogLevel } from '../shared/types.ts';

const PUSH_MS = 300;       // 新行合并推送的间隔

export class LogBook {
  private readonly entries: LogEntry[] = [];
  private pending: LogEntry[] = [];
  private timer: NodeJS.Timeout | undefined;
  private next = 1;
  private readonly push: (lines: LogEntry[]) => void;

  constructor(push: (lines: LogEntry[]) => void) {
    this.push = push;
  }

  get list(): LogEntry[] {
    return [...this.entries];
  }

  // 写一行；source 为空 = 宿主，否则是组件 id
  add(source: string, text: string, level: LogLevel = 'info'): void {
    const e: LogEntry = { id: this.next++, time: Date.now(), level, source, text };
    this.entries.push(e);
    if (this.entries.length > LOG_KEEP) this.entries.splice(0, this.entries.length - LOG_KEEP);
    const stamp = new Date(e.time).toLocaleTimeString('zh-CN', { hour12: false });
    console.log(`${stamp} [${level[0]!.toUpperCase()}] ${source || 'host'} ${text}`);
    this.pending.push(e);
    this.timer ??= setTimeout(() => {
      this.timer = undefined;
      const lines = this.pending;
      this.pending = [];
      this.push(lines);
    }, PUSH_MS);
  }

  stop(): void {
    clearTimeout(this.timer);
  }
}

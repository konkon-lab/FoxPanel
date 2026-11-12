// 日志组件的主进程部分：把运行日志按设置写进文件(记录等级、数据文件夹里的目录、保存天数、单个文件大小 KB)。
// 组件进程重启时宿主会补发内存里的行：记下处理到哪一行(时间 + 行号)，不在它之后的行跳过。
// 宿主一次推来一批行(刚接上时是补发的全部)，整批收完落盘一次：日志在前，标记在后。

import path from 'node:path';
import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import { LogFiles } from './files.ts';
import { isAfter, readMark, writeMark } from './mark.ts';
import { levelOf } from './rank.ts';

const KB = 1024;                    // 字节
const MARK_FILE = 'written.json';   // 日志目录里记「处理到哪」的文件
const DEFAULT_ROOT = 'logs';        // 设置里没有目录时用的目录(相对数据文件夹)
const DEFAULT_MAX_AGE = 14;         // 设置里没有保存天数时用的天数
const DEFAULT_MAX_SIZE = 10240;     // 设置里没有文件大小时用的大小(KB)

const positive = (v: unknown, d: number): number => (typeof v === 'number' && v > 0 ? v : d);

export default {
  name: 'yanuo.window-logs',
  apply(ctx: MainContext) {
    const c = ctx.config;
    const dir = path.resolve(ctx.dataDir, typeof c['root'] === 'string' ? c['root'] : DEFAULT_ROOT);
    const files = new LogFiles({
      level: levelOf(c['level']), dir,
      maxAge: positive(c['maxAge'], DEFAULT_MAX_AGE), maxSize: positive(c['maxSize'], DEFAULT_MAX_SIZE) * KB,
    });
    const markFile = path.join(dir, MARK_FILE);
    let mark = readMark(markFile);

    // 这一批的落盘：排在本轮同步收行之后
    let scheduled: NodeJS.Immediate | undefined;
    const flush = (): void => {
      scheduled = undefined;
      files.flush();
      if (mark) writeMark(markFile, mark);
    };

    ctx.effect(() => {
      const off = ctx.logs.on(line => {
        if (!isAfter(line, mark)) return;
        files.write(line);
        mark = { time: line.time, id: line.id };
        scheduled ??= setImmediate(flush);
      });
      // 组件停用时把没落盘的写完
      return () => {
        off();
        if (!scheduled) return;
        clearImmediate(scheduled);
        flush();
      };
    });
  },
};

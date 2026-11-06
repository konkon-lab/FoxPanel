// 阿里云组件的主进程部分(用量账本)：提供 usage 服务(按调用方组件 id 记账)；账本经总线推给主窗口，主窗口要时也给一份；
// 核心通知某个组件卸载了就删掉它的用量。

import path from 'node:path';
import type { MainContext, UsageService } from '@konkon-lab/foxpanel-sdk';
import { UsageMeter } from './meter.ts';
import { BOOK, GET, REMOVED } from './channels.ts';

const PUSH_MS = 1000;   // 账本变化后隔这么久推给主窗口(毫秒)，这期间的变化并成一次

export default {
  name: 'yanuo.aliyun',
  apply(ctx: MainContext) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const meter = new UsageMeter(path.join(ctx.dataDir, 'usage.json'), () => {
      timer ??= setTimeout(() => {
        timer = undefined;
        ctx.bus.send(BOOK, meter.book);
      }, PUSH_MS);
    });
    // 经 ctx.usage.add 调用时 this.ctx 是调用方组件的上下文(Cordis 的 tracker)
    const usage: UsageService & { ctx?: { id?: string } } = {
      [Symbol.for('cordis.tracker')]: { property: 'ctx' },
      add(entry) {
        const id = this.ctx?.id;
        if (typeof id === 'string') meter.add(id, entry);
      },
    } as UsageService & { ctx?: { id?: string } };
    ctx.provide('usage', usage);
    ctx.bus.on(GET, () => ctx.bus.send(BOOK, meter.book));
    ctx.bus.on(REMOVED, id => {
      if (typeof id === 'string') meter.removeAll(id);
    });
    ctx.bus.send(BOOK, meter.book);
    ctx.effect(() => () => {
      clearTimeout(timer);
      meter.flush();
    });
  },
};

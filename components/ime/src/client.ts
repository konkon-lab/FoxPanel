// 输入法工作线程的调用端：请求按顺序一个个执行，返回线程的结果；线程退出后请求都以失败结束。

import { Worker } from 'node:worker_threads';
import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import type { ImeMessage, ImeReply, ImeRequest, ImeResult } from './protocol.ts';

// 键盘服务用到的那部分(测试里用假的代替)
export interface ImePort {
  request(req: Exclude<ImeRequest, { kind: 'importDict' }>): Promise<ImeResult>;
  importDict(dict: string, file: string): Promise<number>;   // 返回导入的条数，失败为 -1
  stop(): void;
}

export class ImeClient implements ImePort {
  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve: (r: ImeMessage['ok']) => void; reject: (e: Error) => void }>();
  private nextId = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private dead: Error | null = null;   // 线程退出的原因；有值时请求直接失败

  // koffi = 程序自带的 koffi 模块地址(工作线程用它加载)
  constructor(file: string, koffi: string, log: MainContext['log']) {
    this.worker = new Worker(file, { workerData: { koffi } });
    this.worker.on('message', (m: ImeMessage) => {
      const p = this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      if (m.error !== undefined) p.reject(new Error(m.error));
      else p.resolve(m.ok);
    });
    // 未捕获的异常(加载 koffi 失败、原生调用出错)：线程随之终止
    this.worker.on('error', (e: Error) => {
      log(`ime worker error: ${e.message}`, 'error');
      this.fail(new Error(`输入法线程出错：${e.message}`));
    });
    this.worker.on('exit', () => this.fail(new Error('输入法线程已退出')));
  }

  // 线程没了：在等的请求全部失败
  private fail(reason: Error): void {
    this.dead ??= reason;
    for (const p of this.pending.values()) p.reject(this.dead);
    this.pending.clear();
  }

  private send<R extends ImeRequest>(req: R): Promise<ImeReply<R>> {
    if (this.dead) return Promise.reject(this.dead);
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      // 线程按请求的 kind 回对应的结果
      this.pending.set(id, { resolve: r => resolve(r as ImeReply<R>), reject });
      this.worker.postMessage({ id, req });
    });
  }

  // 排在前面的请求完成(或失败)后再发
  private queue<R extends ImeRequest>(req: R): Promise<ImeReply<R>> {
    const run = (): Promise<ImeReply<R>> => this.send(req);
    const p = this.tail.then(run, run);
    this.tail = p.catch(() => undefined);
    return p;
  }

  request(req: Exclude<ImeRequest, { kind: 'importDict' }>): Promise<ImeResult> {
    return this.queue(req);
  }

  importDict(dict: string, file: string): Promise<number> {
    return this.queue({ kind: 'importDict', dict, file }).then(r => r.count);
  }

  stop(): void {
    void this.worker.terminate();
  }
}

// 组件服务里和运行环境无关的部分：总线的监听表、组件数据的读写接口、远程服务的接口、组件在等哪些服务。
// 组件进程、面板页面、媒体页面、主窗口共用。

import type { Context, Fiber } from 'cordis';
import type { BusService, RelayService, Serving, StorageService } from '@konkon-lab/foxpanel-sdk';
import type { StorageOp } from './host-protocol.ts';

// 组件自己的数据：每次读写交给 call(组件进程发消息给宿主，页面走 IPC)
export function storageOver(call: (op: StorageOp) => Promise<unknown>): StorageService {
  return {
    get: key => call({ op: 'get', key }) as Promise<never>,
    set: async (key, value) => { await call({ op: 'set', key, value }); },
    delete: async key => { await call({ op: 'delete', key }); },
  };
}

interface Listener {
  channel: string;
  fn: (data: unknown) => void;
}

// 一个运行环境里的总线
export interface Bus {
  deliver: (channel: string, data: unknown) => void;    // 送给本环境里的监听(别的环境转来的消息也走这里)
  open: () => { bus: BusService; close: () => void };   // 一个组件的 ctx.bus；close 取消它登记的全部监听(组件卸载时调用)
}

// 总线：send 送给本环境里的监听，同时交给 forward 转到别的环境；监听抛出的异常交给 onError，不影响别的监听。
// listen：一个频道在本环境里有了第一个监听时叫 listen(频道, true)，最后一个取消时叫 listen(频道, false)(页面用它向宿主登记要收的频道)
export function createBus(
  forward: (channel: string, data: unknown) => void,
  onError: (channel: string, e: unknown) => void,
  listen?: (channel: string, on: boolean) => void,
): Bus {
  const listeners = new Set<Listener>();
  const counts = new Map<string, number>();   // 频道 → 本环境里监听它的个数
  const add = (l: Listener): void => {
    listeners.add(l);
    const n = counts.get(l.channel) ?? 0;
    counts.set(l.channel, n + 1);
    if (n === 0) listen?.(l.channel, true);
  };
  const remove = (l: Listener): void => {
    if (!listeners.delete(l)) return;
    const n = (counts.get(l.channel) ?? 1) - 1;
    if (n > 0) return void counts.set(l.channel, n);
    counts.delete(l.channel);
    listen?.(l.channel, false);
  };
  const deliver = (channel: string, data: unknown): void => {
    for (const l of listeners) {
      if (l.channel !== channel) continue;
      try {
        l.fn(data);
      } catch (e) {
        onError(channel, e);
      }
    }
  };
  return {
    deliver,
    open: () => {
      const mine = new Set<Listener>();
      return {
        bus: {
          send(channel, data) {
            deliver(channel, data);
            forward(channel, data);
          },
          on(channel, fn) {
            const l = { channel, fn };
            add(l);
            mine.add(l);
            return () => {
              remove(l);
              mine.delete(l);
            };
          },
        },
        close: () => {
          for (const l of mine) remove(l);
          mine.clear();
        },
      };
    },
  };
}

// 一个远程服务在使用侧的内核：各运行环境自己订阅状态、发调用(组件进程发消息给宿主，页面走 IPC)
export interface RemoteCore {
  state(): unknown;                                         // 最新的状态；没有提供者时为 null
  watch(fn: (state: unknown) => void): () => void;          // 状态变了回调；返回取消函数
  call(method: string, args: unknown[]): Promise<unknown>;  // 等结果
  tell(method: string, args: unknown[]): void;              // 不等结果
}

// 组件的 ctx.relay：use 取这个名字的内核，serve 登记提供方
export function relayOver(
  use: (name: string) => RemoteCore,
  serve: (name: string, impl: Readonly<Record<string, unknown>>) => Serving<unknown>,
): RelayService {
  return {
    use(name) {
      const core = use(name);
      return {
        get state() { return core.state() as never; },
        watch: fn => core.watch(fn as (state: unknown) => void),
        call: (method, ...args) => core.call(String(method), args as unknown[]) as Promise<never>,
        tell: (method, ...args) => core.tell(String(method), args as unknown[]),
      };
    },
    serve: (name, impl) => serve(name, impl as Readonly<Record<string, unknown>>),
  };
}

export const WAIT_LOG_MS = 5000;   // 组件加载之后过这么久还在等服务，就往运行日志记一行(毫秒)

// 一个组件的插件还在等的服务：它的 inject 里写了、根上下文里还没有的名字；都有了时为空
export function waitingFor(root: Context, fiber: Fiber): string[] {
  return Object.keys(fiber.inject).filter(name => root.get(name) === undefined);
}

// 运行日志里的一行：组件在等一个服务
export const waitingText = (name: string): string => `waiting for service: ${name}`;

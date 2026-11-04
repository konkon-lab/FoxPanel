// 面板页面和媒体页面共用的组件服务和组件加载：日志、组件自己的数据、总线、远程服务。

import type { Context, Fiber, Plugin } from 'cordis';
import type { StorageService } from '@konkon-lab/foxpanel-sdk';
import { createRelay } from './relay.ts';
import { createBus, storageOver, WAIT_LOG_MS, waitingFor, waitingText } from '../shared/component-services.ts';
import type { LogLevel, PageApi, PageComponent } from '../shared/types.ts';
import { errorText } from '../shared/util.ts';

// 这两种页面的 window.fox 是窄 preload 挂上去的 PageApi
export const fox = (window as unknown as { fox: PageApi }).fox;

// 组件写日志：进主窗口的运行日志
const logService = (id: string) => (text: string, level?: LogLevel): void => fox.logWrite(id, String(text), level);

// 组件自己的数据：宿主读写 userData/component-data/<id>.json
const storageService = (id: string): StorageService => storageOver(op => fox.storageCall(id, op));

// 总线：页面里的组件之间直接送达，同时经宿主转给组件进程和别的页面；有组件监听的频道向宿主登记，宿主只把登记了的频道送来
const bus = createBus(
  (channel, data) => fox.busSend(channel, data),
  (channel, e) => console.error(`总线 ${channel}：`, e),
  (channel, on) => fox.busListen(channel, on),
);
fox.onBus(bus.deliver);

// 远程服务：这一页的组件共用一份；被宿主拒绝的订阅和调用、状态回调里的异常写到控制台
export const relay = createRelay(fox, (what, e) => console.error(`${what}：`, e));

// 这一页加载了的组件和它们的插件
const loaded: { id: string; fiber: Fiber }[] = [];

// 加载一个组件：在带 id / config / storage / bus / log / relay(和 extra)的子上下文里 plugin 它的入口；
// 不给 plugin 时 import 组件的入口取默认导出。插件在等 inject 的服务时不等它，服务有了它自己起来。
// 失败时取消它登记的总线监听、写进运行日志并抛出
export async function loadPlugin(root: Context, c: PageComponent, extra: Record<string, unknown> = {}, plugin?: Plugin): Promise<void> {
  const { bus: own, close } = bus.open();
  const ctx = root.extend({ id: c.id, config: c.config, storage: storageService(c.id), bus: own, log: logService(c.id), relay, ...extra });
  try {
    const entry = plugin ?? ('url' in c ? (await import(/* @vite-ignore */ c.url) as { default?: Plugin }).default : undefined);
    if (!entry) throw new Error('入口没有默认导出');
    const fiber = ctx.plugin(entry, c.config);
    loaded.push({ id: c.id, fiber });
    await fiber;
  } catch (e) {
    console.error(`组件 ${c.id}：`, e);
    fox.logWrite(c.id, `page load failed: ${errorText(e)}`, 'error');
    close();
    throw e;
  }
}

// 这一页加载了的组件里还在等服务的，每个等着的服务往运行日志记一行(来源是那个组件)
export function reportWaiting(root: Context): void {
  for (const { id, fiber } of loaded) {
    for (const name of waitingFor(root, fiber)) fox.logWrite(id, waitingText(name), 'warn');
  }
}

// 过 WAIT_LOG_MS 之后查一次还在等服务的组件；页面的组件都交给 loadPlugin 之后调
export function watchWaiting(root: Context): void {
  setTimeout(() => reportWaiting(root), WAIT_LOG_MS);
}

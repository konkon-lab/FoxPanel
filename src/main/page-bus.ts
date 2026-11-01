// 组件总线在页面一侧的投递：媒体页面、面板页面登记了哪些频道，一条消息只送到登记了它的页面
// (主窗口全收，由调用方另外发)；页面发来的消息里频道名不合格的、核心的频道和太大的不转发。只有数据和函数，不导入 electron。

import { plainSize } from './payload.ts';
import { CORE_PREFIX, type Senders } from './senders.ts';
import type { Log } from '../shared/types.ts';

export const BUS_MAX = 256 * 1024;      // 页面发的一条总线消息存成 JSON 的大小上限(字节；二进制缓冲按字节数加上)
export const CHANNELS_MAX = 256;        // 一个页面最多登记这么多个频道
export const CHANNEL_LENGTH_MAX = 200;  // 频道名最长这么多个字符(登记的和页面发消息用的)
const WARN_MS = 10_000;                 // 同一个原因的警告日志最少隔这么久写一行(毫秒)

// 频道名合不合格：不是空串、不超过 CHANNEL_LENGTH_MAX 个字符的字符串
const isChannel = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= CHANNEL_LENGTH_MAX;

export interface PageBusDeps {
  senders: Senders;                                          // 登记着的页面：销毁了的页面不投递
  send(page: number, channel: string, data: unknown): void;  // 把一条消息发给一个页面(webContents 的 id)
  log: Log;
  now?(): number;   // 当前时间(毫秒)，警告的限频用；不给时用系统时钟
}

export class PageBus {
  private readonly deps: PageBusDeps;
  private readonly listening = new Map<number, Set<string>>();   // 页面(webContents 的 id) → 它登记的频道
  private readonly warned = new Map<string, number>();           // 警告的原因 → 上次写它的时间

  constructor(deps: PageBusDeps) {
    this.deps = deps;
  }

  // 写一行警告；同一种原因(why)WARN_MS 内只写一次，文字里的频道名不算进去(频道名是页面给的)
  private warn(why: string, text: string): void {
    const now = (this.deps.now ?? Date.now)();
    const last = this.warned.get(why);
    if (last !== undefined && now - last < WARN_MS) return;
    this.warned.set(why, now);
    this.deps.log(text, 'warn');
  }

  // 页面登记 / 取消登记一个频道；频道名不合格，或这个页面登记的已经到上限时不登记
  listen(page: number, channel: unknown, on: unknown): void {
    if (!isChannel(channel)) return;
    const mine = this.listening.get(page);
    if (on !== true) {
      mine?.delete(channel);
      return;
    }
    if (mine && mine.size >= CHANNELS_MAX && !mine.has(channel)) return this.warn('channels', `bus: a page listens to more than ${CHANNELS_MAX} channels, ${channel} ignored`);
    this.listening.set(page, (mine ?? new Set()).add(channel));
  }

  // 页面重新加载或销毁了：它登记的频道都清掉
  drop(page: number): void {
    this.listening.delete(page);
  }

  // 页面发来的一条消息转不转发：频道名不合格的、核心的频道、存成 JSON 超过 BUS_MAX 或算不出大小(里面有普通数据以外的值)的不转发，写一行警告
  accepts(channel: unknown, data: unknown): channel is string {
    if (!isChannel(channel)) {
      this.warn('name', `bus message dropped: the channel name has to be a string of 1 to ${CHANNEL_LENGTH_MAX} characters`);
      return false;
    }
    if (channel.startsWith(CORE_PREFIX)) {
      this.warn('core', `bus message on ${channel} dropped: pages cannot send on core channels`);
      return false;
    }
    const size = plainSize(data);
    if (size !== null && size <= BUS_MAX) return true;
    if (size === null) this.warn('plain', `bus message on ${channel} dropped: it holds something other than plain data`);
    else this.warn('size', `bus message on ${channel} dropped: it is over ${BUS_MAX / 1024} KB`);
    return false;
  }

  // 一条消息送到登记了这个频道的页面；from = 发出它的页面，不发回去。已经销毁的页面顺手清掉
  deliver(channel: string, data: unknown, from?: number): void {
    for (const [page, channels] of [...this.listening]) {
      if (!this.deps.senders.get(page)) this.listening.delete(page);
      else if (page !== from && channels.has(channel)) this.deps.send(page, channel, data);
    }
  }
}

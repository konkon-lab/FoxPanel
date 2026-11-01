// 页面的边界：每个窗口是哪种页面(登记表)、它能用哪些组件 id、总线频道和远程服务、能拿到哪些权限、
// 它的页面限制(不能去别的地址、子框架不能加载地址、不能开新窗口、WebRTC 不发 UDP 包)、会话的限制(权限白名单、不能下载)。
// 只有数据和函数，不导入 electron。

// 页面的类别：主窗口、媒体页面、面板页面(离屏的和普通窗口里的)
export const SENDER_KINDS = ['window', 'media', 'panel'] as const;
export type SenderKind = typeof SENDER_KINDS[number];

// 一个窗口是谁；ids 是这一页加载的组件 id，remotes 是这些组件够得着的远程服务名(清单 requires 和 uses 里的)；panel 是面板 id
export type SenderInfo =
  | { kind: 'window' }
  | { kind: 'media'; ids: ReadonlySet<string>; remotes: ReadonlySet<string> }
  | { kind: 'panel'; panel: string; ids: ReadonlySet<string>; remotes: ReadonlySet<string> };

// 登记表：webContents 的 id → 这个窗口是谁
export class Senders {
  private readonly pages = new Map<number, SenderInfo>();

  // 登记主窗口或媒体页面；媒体页面带上这一页加载的组件 id 和够得着的远程服务名
  add(id: number, kind: Exclude<SenderKind, 'panel'>, ids: Iterable<string> = [], remotes: Iterable<string> = []): void {
    this.pages.set(id, kind === 'window' ? { kind } : { kind, ids: new Set(ids), remotes: new Set(remotes) });
  }

  // 登记一块面板的页面，或它的计划变了：带上面板 id、这一页加载的组件 id 和够得着的远程服务名
  addPanel(id: number, panel: string, ids: Iterable<string>, remotes: Iterable<string>): void {
    this.pages.set(id, { kind: 'panel', panel, ids: new Set(ids), remotes: new Set(remotes) });
  }

  // 窗口销毁了
  remove(id: number): void {
    this.pages.delete(id);
  }

  // 没登记过的窗口为 undefined
  get(id: number): SenderInfo | undefined {
    return this.pages.get(id);
  }

  // 媒体页面的加载列表变了：它的组件 id 和远程服务名整个换成新的
  loadMedia(ids: Iterable<string>, remotes: Iterable<string> = []): void {
    const next: SenderInfo = { kind: 'media', ids: new Set(ids), remotes: new Set(remotes) };
    for (const [id, info] of this.pages) if (info.kind === 'media') this.pages.set(id, next);
  }
}

// 页面能不能用这个组件 id 名下的数据和日志：主窗口都可以，媒体页面、面板页面只能用自己加载的组件
export function ownsComponent(info: SenderInfo, component: unknown): boolean {
  return info.kind === 'window' || (typeof component === 'string' && info.ids.has(component));
}

// 页面能不能往这个总线频道发：主窗口都可以，媒体页面、面板页面的频道要以自己加载的某个组件 id 加「/」开头
// (组件 id 里没有「/」；核心自己的 core/ 频道这几种页面发不了)
export function ownsChannel(info: SenderInfo, channel: unknown): boolean {
  if (info.kind === 'window') return true;
  if (typeof channel !== 'string') return false;
  const slash = channel.indexOf('/');
  return slash > 0 && info.ids.has(channel.slice(0, slash));
}

// 核心发的通知的总线频道前缀
export const CORE_PREFIX = 'core/';

// 页面能不能登记收这个总线频道：主窗口都可以，媒体页面、面板页面只能收自己加载的组件的频道和核心的通知
export function hearsChannel(info: SenderInfo, channel: unknown): boolean {
  return ownsChannel(info, channel) || (typeof channel === 'string' && channel.startsWith(CORE_PREFIX));
}

// 页面能不能用这个远程服务：媒体页面、面板页面只能用自己加载的组件在清单里写了的；主窗口不接远程服务
export function usesRemote(info: SenderInfo, name: unknown): boolean {
  return info.kind !== 'window' && typeof name === 'string' && info.remotes.has(name);
}

// 页面申请一项权限给不给：只给媒体页面的 media(麦克风)
export function mayRequest(info: SenderInfo | undefined, permission: string): boolean {
  return permission === 'media' && info?.kind === 'media';
}

// 页面查一项权限有没有：媒体页面的 media；主窗口的 media(申请不到，只用来看音频设备的名字)
export function mayCheck(info: SenderInfo | undefined, permission: string): boolean {
  return permission === 'media' && (info?.kind === 'media' || info?.kind === 'window');
}

interface Stoppable {
  preventDefault(): void;
}

// 页面限制用到的 webContents 成员
export interface Lockable {
  getURL(): string;
  on(event: 'will-navigate' | 'will-redirect', fn: (e: Stoppable, url: string) => void): unknown;
  on(event: 'will-frame-navigate', fn: (e: Stoppable & { readonly isMainFrame: boolean }) => void): unknown;
  on(event: 'will-attach-webview', fn: (e: Stoppable) => void): unknown;
  on(event: 'select-bluetooth-device', fn: (e: Stoppable, devices: unknown, pick: (deviceId: string) => void) => void): unknown;
  setWindowOpenHandler(fn: () => { action: 'deny' }): void;
  setWebRTCIPHandlingPolicy(policy: 'disable_non_proxied_udp'): void;
}

// 页面限制：页面自己不能去别的地址(重新加载当前地址可以)、不能被重定向、页面里的子框架不能加载任何地址、
// 不能开新窗口、不能嵌 webview、选不到蓝牙设备、WebRTC 不发 UDP 包(STUN 也不发)。
// 主进程调的 loadURL 和 reload 不触发 will-navigate，照常生效
export function lockDown(wc: Lockable): void {
  wc.on('will-navigate', (e, url) => {
    if (url !== wc.getURL()) e.preventDefault();
  });
  wc.on('will-frame-navigate', e => {
    if (!e.isMainFrame) e.preventDefault();
  });
  wc.setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
  wc.on('will-redirect', e => e.preventDefault());
  wc.on('will-attach-webview', e => e.preventDefault());
  // 空的设备 id = 取消这次选择
  wc.on('select-bluetooth-device', (e, _devices, pick) => {
    e.preventDefault();
    pick('');
  });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
}

// 登记一个窗口用到的 webContents 成员
export interface Adoptable extends Lockable {
  readonly id: number;
  once(event: 'destroyed', fn: () => void): unknown;
}

// 窗口建好(加载地址之前)：登记它是哪种页面(ids 是这一页加载的组件 id，remotes 是够得着的远程服务名)，加上页面限制；销毁时注销
export function adopt(senders: Senders, wc: Adoptable, kind: Exclude<SenderKind, 'panel'>, ids: Iterable<string> = [], remotes: Iterable<string> = []): void {
  const id = wc.id;
  senders.add(id, kind, ids, remotes);
  lockDown(wc);
  wc.once('destroyed', () => senders.remove(id));
}

// 权限处理函数里的窗口：只用 webContents 的 id；不是窗口发起的为 null
type Asker = { readonly id: number } | null;

// 会话里用到的成员
export interface Limitable {
  setPermissionRequestHandler(fn: (wc: Asker, permission: string, done: (granted: boolean) => void) => void): void;
  setPermissionCheckHandler(fn: (wc: Asker, permission: string) => boolean): void;
  setDevicePermissionHandler(fn: () => boolean): void;
  on(event: 'will-download', fn: (e: Stoppable) => void): unknown;
}

// 会话的限制。权限按白名单给，默认拒绝：麦克风只给媒体页面；主窗口可以查看音频设备名(设置里选设备用)，不能打开；
// HID、串口、USB 设备都不给(蓝牙在各窗口的页面限制里拒绝)。页面发起的下载一律取消
export function limitPermissions(ses: Limitable, senders: Senders): void {
  const who = (wc: Asker): SenderInfo | undefined => (wc ? senders.get(wc.id) : undefined);
  ses.setPermissionRequestHandler((wc, permission, done) => done(mayRequest(who(wc), permission)));
  ses.setPermissionCheckHandler((wc, permission) => mayCheck(who(wc), permission));
  ses.setDevicePermissionHandler(() => false);
  ses.on('will-download', e => e.preventDefault());
}

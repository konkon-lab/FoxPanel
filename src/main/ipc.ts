// 页面发来的 IPC 的注册和策略：每个通道哪几种页面能调。发送方没登记或不在名单里、消息不是页面的主框架发的、
// 媒体页面或面板页面用了不是自己加载的组件 id、往不是自己组件的总线频道发、登记收别的组件的总线频道、
// 用了自己的组件没在清单里写的远程服务，
// 都不处理，并写一行警告日志。

import { hearsChannel, ownsChannel, ownsComponent, usesRemote, type SenderInfo, type SenderKind, type Senders } from './senders.ts';
import { IPC, type Log, type PAGE_IPC } from '../shared/types.ts';

const WARN_MS = 10_000;   // 同一个原因的警告日志最少隔这么久写一行(毫秒)

const NONE: readonly SenderKind[] = [];                              // 主进程推给页面的通道：页面不能往里发
const WINDOW: readonly SenderKind[] = ['window'];
const PANEL: readonly SenderKind[] = ['panel'];
const PAGES: readonly SenderKind[] = ['media', 'panel'];              // 用窄 preload 的两种页面
const ALL: readonly SenderKind[] = ['window', 'media', 'panel'];

// 通道的键：IPC 和 PAGE_IPC 的键合在一起(两边同名的键是同一个通道)
export type Channel = keyof typeof IPC | keyof typeof PAGE_IPC;

// 每个通道谁能调(键和 IPC、PAGE_IPC 的键一一对应)
export const POLICY: Record<Channel, readonly SenderKind[]> = {
  init: WINDOW,
  language: WINDOW,
  settingsEvent: NONE,
  compList: WINDOW,
  compListEvent: NONE,
  compPick: WINDOW,
  compInstall: WINDOW,
  compRemove: WINDOW,
  compSet: WINDOW,
  compSecret: WINDOW,
  compDevAdd: WINDOW,
  compRemoveBroken: WINDOW,
  compOpenFolder: WINDOW,
  compHostRestart: WINDOW,
  storageCall: ALL,
  busSend: ALL,
  busEvent: NONE,
  busListen: PAGES,
  updateState: WINDOW,
  updateEvent: NONE,
  updateCheck: WINDOW,
  updateInstall: WINDOW,
  compSecretReveal: WINDOW,
  compNpm: WINDOW,
  marketSearch: WINDOW,
  marketInfo: WINDOW,
  windowPlan: WINDOW,
  windowPlanEvent: NONE,
  logList: WINDOW,
  logEvent: NONE,
  dirList: WINDOW,
  dirMake: WINDOW,
  logWrite: ALL,
  openExternal: WINDOW,
  winMinimize: WINDOW,
  winMaximize: WINDOW,
  winClose: WINDOW,
  closeAsk: NONE,
  closeAnswer: WINDOW,
  closeHandler: WINDOW,
  setApp: WINDOW,
  openDataDir: WINDOW,
  statsEvent: NONE,
  relayUse: PAGES,
  relayCall: PAGES,
  relayEvent: NONE,
  plan: PAGES,
  look: PAGES,
  lookEvent: NONE,
  setDark: PANEL,
  visibleEvent: NONE,
  hide: PANEL,
};

// 第一个参数是组件 id 的通道：媒体页面、面板页面只能填自己加载的组件
export const OWN_COMPONENT: ReadonlySet<string> = new Set([IPC.storageCall, IPC.logWrite]);

// 第一个参数是总线频道的通道：媒体页面、面板页面的频道要以自己加载的某个组件 id 加「/」开头
export const OWN_CHANNEL: ReadonlySet<string> = new Set([IPC.busSend]);

// 第一个参数是要登记收的总线频道的通道：媒体页面、面板页面只能登记自己加载的组件的频道和核心的通知(core/ 开头)
export const HEARD_CHANNEL: ReadonlySet<string> = new Set([IPC.busListen]);

// 第一个参数是远程服务名的通道：媒体页面、面板页面只能用自己加载的组件在清单 requires、uses 里写了的名字
export const OWN_REMOTE: ReadonlySet<string> = new Set([IPC.relayUse, IPC.relayCall]);

// 一条消息里用到的部分：发来的窗口(webContents 的 id 和主框架)、消息所在的框架
export interface IpcEvent {
  readonly sender: { readonly id: number; readonly mainFrame: unknown };
  readonly senderFrame: unknown;
}

export type IpcHandler = (e: IpcEvent, ...args: unknown[]) => unknown;
export type IpcListener = (e: IpcEvent, ...args: unknown[]) => void;

// ipcMain 里用到的两个方法
export interface IpcMainLike {
  handle(channel: string, fn: IpcHandler): void;
  on(channel: string, fn: IpcListener): unknown;
}

export interface IpcDeps {
  ipcMain: IpcMainLike;
  senders: Senders;
  log: Log;
  now?(): number;   // 当前时间(毫秒)，警告的限频用；不给时用系统时钟
}

export interface Ipc {
  // 有返回值的调用(页面用 invoke)；不处理时调用方得到一个错误
  handle(channel: string, kinds: readonly SenderKind[], fn: IpcHandler): void;
  // 单向消息(页面用 send)；不处理时丢掉
  on(channel: string, kinds: readonly SenderKind[], fn: IpcListener): void;
}

// 这条消息不处理的原因；可以处理时为 null
function refusal(channel: string, kinds: readonly SenderKind[], info: SenderInfo | undefined, e: IpcEvent, args: readonly unknown[]): string | null {
  if (!info || !kinds.includes(info.kind)) return `sender ${info?.kind ?? 'unknown'} is not allowed`;
  if (e.senderFrame !== e.sender.mainFrame) return `not from the main frame of the ${info.kind} page`;
  if (OWN_COMPONENT.has(channel) && !ownsComponent(info, args[0])) return `component id is not loaded on the ${info.kind} page`;
  if (OWN_CHANNEL.has(channel) && !ownsChannel(info, args[0])) return `bus channel does not start with a component id loaded on the ${info.kind} page`;
  if (HEARD_CHANNEL.has(channel) && !hearsChannel(info, args[0])) return `bus channel belongs to a component that is not loaded on the ${info.kind} page`;
  if (OWN_REMOTE.has(channel) && !usesRemote(info, args[0])) return `remote service is not declared by a component loaded on the ${info.kind} page`;
  return null;
}

export function createIpc(deps: IpcDeps): Ipc {
  const now = deps.now ?? Date.now;
  const warned = new Map<string, number>();   // 原因 → 上次为它写警告的时间

  // 查一条消息能不能处理；不能时写警告(同一个通道的同一个原因限频)并返回 false
  const allowed = (channel: string, kinds: readonly SenderKind[], e: IpcEvent, args: readonly unknown[]): boolean => {
    const why = refusal(channel, kinds, deps.senders.get(e.sender.id), e, args);
    if (why === null) return true;
    const key = `${channel} ${why}`;
    const time = now();
    const last = warned.get(key);
    if (last === undefined || time - last >= WARN_MS) {
      warned.set(key, time);
      deps.log(`ipc ${channel} refused: ${why}`, 'warn');
    }
    return false;
  };

  return {
    handle(channel, kinds, fn) {
      deps.ipcMain.handle(channel, (e, ...args) => {
        if (!allowed(channel, kinds, e, args)) throw new Error(`不允许调用 ${channel}`);
        return fn(e, ...args);
      });
    },
    on(channel, kinds, fn) {
      deps.ipcMain.on(channel, (e, ...args) => {
        if (allowed(channel, kinds, e, args)) fn(e, ...args);
      });
    },
  };
}

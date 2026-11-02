// 面板页面的窗口和句柄复制：把 Electron 的窗口和 kernel32 接成 panels.ts 用的接口，这里不放逻辑。
// 页面在沙箱里，只有窄 preload(PageApi)；地址由核心给，页面自己去不了别的地址。

import { BrowserWindow } from 'electron';
import koffi from 'koffi';
import type { PageEvents, PageWindow, PanelWindowSpec, SharedFrame } from './panels.ts';
import { lockDown } from './senders.ts';

const PROCESS_DUP_HANDLE = 0x40;    // OpenProcess 的权限：可以往这个进程里复制句柄
const DUPLICATE_SAME_ACCESS = 0x2;  // DuplicateHandle 的选项：新句柄的权限和原句柄相同
const ERR_ABORTED = -3;             // 加载被新的加载打断(重新加载时)，不算失败

// koffi 的 uint64：安全整数范围内是 number，否则是 bigint
type Handle = number | bigint;

interface Kernel32 {
  open: (access: number, inherit: boolean, pid: number) => Handle;
  dup: (srcProc: Handle, src: Handle, dstProc: Handle, out: [Handle], access: number, inherit: boolean, options: number) => boolean;
  close: (h: Handle) => boolean;
  self: () => Handle;
}

// kernel32：把本进程的句柄复制进另一个进程
let k32: Kernel32 | null = null;
function kernel(): Kernel32 {
  if (k32) return k32;
  const lib = koffi.load('kernel32.dll');
  k32 = {
    open: lib.func('uint64 __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)') as Kernel32['open'],
    dup: lib.func('bool __stdcall DuplicateHandle(uint64 srcProc, uint64 src, uint64 dstProc, _Out_ uint64 *dst, uint32 access, bool inherit, uint32 options)') as Kernel32['dup'],
    close: lib.func('bool __stdcall CloseHandle(uint64 h)') as Kernel32['close'],
    self: lib.func('uint64 __stdcall GetCurrentProcess()') as Kernel32['self'],
  };
  return k32;
}

// 打开 pid 进程、能往里复制句柄的进程句柄；打不开返回 null
export function openProcess(pid: number): bigint | null {
  const handle = BigInt(kernel().open(PROCESS_DUP_HANDLE, false, pid));
  return handle ? handle : null;
}

// 把本进程的句柄复制进 process 进程，返回那边的句柄值；失败返回 null
export function duplicate(process: bigint, handle: bigint): bigint | null {
  const k = kernel();
  const out: [Handle] = [0n];
  return k.dup(k.self(), handle, process, out, 0, false, DUPLICATE_SAME_ACCESS) ? BigInt(out[0]) : null;
}

export function closeHandle(handle: bigint): void {
  kernel().close(handle);
}

// 建一块面板的窗口：离屏的(画面是 GPU 共享纹理，隐藏、无边框、透明)或普通窗口(先不显示)；title 是普通窗口的标题。
// 窗口销毁之后各方法什么都不做
export function createPanelWindow(spec: PanelWindowSpec, preload: string, title: string, events: PageEvents): PageWindow {
  const offscreen = spec.mode === 'frames';
  const win = new BrowserWindow({
    show: false, width: spec.width, height: spec.height, useContentSize: true,
    ...(offscreen ? { frame: false, transparent: true } : { title, autoHideMenuBar: true, resizable: false }),
    webPreferences: {
      preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, backgroundThrottling: false,
      ...(offscreen ? { offscreen: { useSharedTexture: true, deviceScaleFactor: spec.scale } } : {}),
    },
  });
  const wc = win.webContents;
  const id = wc.id;
  if (!spec.sound) wc.setAudioMuted(true);
  lockDown(wc);
  wc.on('paint', (e: { texture?: SharedFrame }) => events.paint(e.texture));
  wc.on('did-finish-load', () => events.loaded());
  wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
    if (isMainFrame && code !== ERR_ABORTED) events.failed(`${description} (${code})`);
  });
  wc.on('render-process-gone', (_e, details) => events.failed(`page process gone: ${details.reason} ${details.exitCode}`));
  wc.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) events.restarted();
  });
  win.on('resize', () => events.resized());
  win.on('closed', () => events.closed());
  // 窗口还在时才做
  const alive = (fn: () => void): void => {
    if (!win.isDestroyed()) fn();
  };
  return {
    id,
    loadURL: url => alive(() => { wc.loadURL(url).catch(() => undefined); }),   // 加载失败经 did-fail-load 报
    reload: () => alive(() => wc.reload()),
    destroy: () => alive(() => win.destroy()),
    show: () => alive(() => win.showInactive()),
    hide: () => alive(() => win.hide()),
    setContentSize: (width, height) => alive(() => win.setContentSize(width, height)),
    getContentSize: () => (win.isDestroyed() ? [] : win.getContentSize()),
    sendInputEvent: e => alive(() => wc.sendInputEvent(e)),
    startPainting: () => alive(() => wc.startPainting()),
    stopPainting: () => alive(() => wc.stopPainting()),
    invalidate: () => alive(() => wc.invalidate()),
    setFrameRate: fps => alive(() => wc.setFrameRate(fps)),
    setBackgroundThrottling: on => alive(() => wc.setBackgroundThrottling(on)),
    send: (channel, ...args) => alive(() => wc.send(channel, ...args)),
  };
}

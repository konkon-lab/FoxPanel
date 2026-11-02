import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import type { PageEvents, PanelWindowSpec, SharedFrame } from '../src/main/panels.ts';

// 假的页面内容：记下对它做的事；事件由测试 emit
class FakeContents extends EventEmitter {
  readonly id: number;
  readonly calls: string[] = [];
  url = 'fox://a.kb.panel/panel.html';
  openHandler: (() => unknown) | null = null;

  constructor(id: number) {
    super();
    this.id = id;
  }

  getURL(): string { return this.url; }
  setWindowOpenHandler(fn: () => unknown): void { this.openHandler = fn; }
  rtcPolicy = '';
  setWebRTCIPHandlingPolicy(policy: string): void { this.rtcPolicy = policy; }
  setAudioMuted(on: boolean): void { this.calls.push(`setAudioMuted ${on}`); }
  loadURL(url: string): Promise<void> {
    this.calls.push(`loadURL ${url}`);
    return Promise.reject(new Error('ERR_FAILED'));
  }
  reload(): void { this.calls.push('reload'); }
  sendInputEvent(e: { type: string }): void { this.calls.push(`input ${e.type}`); }
  startPainting(): void { this.calls.push('startPainting'); }
  stopPainting(): void { this.calls.push('stopPainting'); }
  invalidate(): void { this.calls.push('invalidate'); }
  setFrameRate(fps: number): void { this.calls.push(`setFrameRate ${fps}`); }
  setBackgroundThrottling(on: boolean): void { this.calls.push(`throttle ${on}`); }
  send(channel: string, ...args: unknown[]): void { this.calls.push(`send ${channel} ${JSON.stringify(args)}`); }
}

// 代替 electron 的 BrowserWindow：记下构造参数和对窗口做的事
const built: FakeBrowserWindow[] = [];
class FakeBrowserWindow extends EventEmitter {
  readonly options: unknown;
  readonly webContents: FakeContents;
  readonly calls: string[] = [];
  size: number[] = [0, 0];
  destroyed = false;

  constructor(options: unknown) {
    super();
    this.options = options;
    this.webContents = new FakeContents(500 + built.length);
    built.push(this);
  }

  isDestroyed(): boolean { return this.destroyed; }
  destroy(): void {
    this.calls.push('destroy');
    this.destroyed = true;
  }
  showInactive(): void { this.calls.push('showInactive'); }
  hide(): void { this.calls.push('hide'); }
  setContentSize(width: number, height: number): void {
    this.calls.push(`setContentSize ${width}x${height}`);
    this.size = [width, height];
  }
  getContentSize(): number[] { return [...this.size]; }
}

// 代替 koffi 加载的 kernel32：记下每次调用；process = OpenProcess 的返回值(0 = 打不开)，copied = DuplicateHandle 写出的句柄(null = 复制失败)
const SELF = 0xFFFFFFFFFFFFFFFFn;   // GetCurrentProcess 返回的伪句柄
const kernel32 = {
  calls: [] as string[],
  loaded: [] as string[],
  process: 77 as number | bigint,
  copied: 4242 as number | bigint | null,
};
function nativeFunc(proto: string): (...args: unknown[]) => unknown {
  if (proto.includes('OpenProcess')) {
    return (...args) => {
      kernel32.calls.push(`open ${args.join(' ')}`);
      return kernel32.process;
    };
  }
  if (proto.includes('DuplicateHandle')) {
    return (srcProc, src, dstProc, out, ...rest) => {
      kernel32.calls.push(`dup ${String(srcProc)} ${String(src)} ${String(dstProc)} ${rest.join(' ')}`);
      if (kernel32.copied === null || !Array.isArray(out)) return false;
      out[0] = kernel32.copied;
      return true;
    };
  }
  if (proto.includes('CloseHandle')) {
    return h => {
      kernel32.calls.push(`close ${String(h)}`);
      return true;
    };
  }
  return () => SELF;
}

const KEY = Symbol.for('foxpanel.test.panel-window');
Object.assign(globalThis, {
  [KEY]: {
    BrowserWindow: FakeBrowserWindow,
    koffi: { load: (file: string) => { kernel32.loaded.push(file); return { func: nativeFunc }; } },
  },
});
const stub = (source: string): string => `data:text/javascript,${encodeURIComponent(`const fake = globalThis[Symbol.for('foxpanel.test.panel-window')];\n${source}`)}`;
const STUBS: Record<string, string> = {
  electron: stub('export const BrowserWindow = fake.BrowserWindow;'),
  koffi: stub('export default fake.koffi;'),
};
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    const url = STUBS[specifier];
    return url === undefined ? nextResolve(specifier, context) : { url, shortCircuit: true };
  },
});

// panel-window.ts 导入 electron 和 koffi：在假模块装好之后加载
const { closeHandle, createPanelWindow, duplicate, openProcess } = await import('../src/main/panel-window.ts');

const specOf = (over: Partial<PanelWindowSpec> = {}): PanelWindowSpec => ({ id: 'a.kb', name: 'Keyboard', mode: 'frames', width: 1400, height: 490, scale: 1.5, sound: true, ...over });

// 记下窗口报来的事
function recorder(): { seen: string[]; events: PageEvents } {
  const seen: string[] = [];
  return {
    seen,
    events: {
      paint: frame => seen.push(`paint ${frame ? 'frame' : 'none'}`),
      resized: () => seen.push('resized'),
      loaded: () => seen.push('loaded'),
      failed: detail => seen.push(`failed ${detail}`),
      restarted: () => seen.push('restarted'),
      closed: () => seen.push('closed'),
    },
  };
}

test('离屏方式：隐藏、无边框、透明的窗口，画面是共享纹理、按纹理倍数出；页面在沙箱里、只有窄 preload；出声的不静音', () => {
  built.length = 0;
  const win = createPanelWindow(specOf(), 'preload-page.cjs', 'Keyboard', recorder().events);
  assert.deepEqual(built.map(w => w.options), [{
    show: false, width: 1400, height: 490, useContentSize: true, frame: false, transparent: true,
    webPreferences: {
      preload: 'preload-page.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, backgroundThrottling: false,
      offscreen: { useSharedTexture: true, deviceScaleFactor: 1.5 },
    },
  }]);
  const [made] = built;
  assert.ok(made);
  assert.equal(win.id, made.webContents.id);
  assert.deepEqual(made.webContents.calls, []);
  // 页面限制装上了：新窗口一律拒绝，跳到别的地址被拦
  assert.deepEqual(made.webContents.openHandler?.(), { action: 'deny' });
  let prevented = 0;
  made.webContents.emit('will-navigate', { preventDefault: () => { prevented++; } }, 'https://example.invalid/');
  made.webContents.emit('will-navigate', { preventDefault: () => { prevented++; } }, made.webContents.url);
  assert.equal(prevented, 1);
  // 子框架不能加载地址；WebRTC 不发 UDP 包
  made.webContents.emit('will-frame-navigate', { preventDefault: () => { prevented++; }, isMainFrame: false });
  assert.equal(prevented, 2);
  assert.equal(made.webContents.rtcPolicy, 'disable_non_proxied_udp');
});

test('窗口方式：普通窗口先不显示，带标题、不能改大小，不开离屏；不出声的静音', () => {
  built.length = 0;
  createPanelWindow(specOf({ mode: 'window', scale: 1, sound: false }), 'preload-page.cjs', '键盘', recorder().events);
  assert.deepEqual(built.map(w => w.options), [{
    show: false, width: 1400, height: 490, useContentSize: true, title: '键盘', autoHideMenuBar: true, resizable: false,
    webPreferences: { preload: 'preload-page.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, backgroundThrottling: false },
  }]);
  assert.deepEqual(built[0]?.webContents.calls, ['setAudioMuted true']);
});

test('窗口的事件：出帧、加载完、加载失败(被新的加载打断、子框架的不算)、渲染进程退出、重新加载、改大小、关掉', () => {
  built.length = 0;
  const { seen, events } = recorder();
  createPanelWindow(specOf(), 'p.cjs', '', events);
  const [made] = built;
  assert.ok(made);
  const wc = made.webContents;
  const texture = { release: () => undefined, textureInfo: { widgetType: 'frame', codedSize: { width: 1, height: 1 }, handle: {} } } satisfies SharedFrame;
  wc.emit('paint', { texture });
  wc.emit('paint', {});
  wc.emit('did-finish-load');
  wc.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'fox://x', true);
  wc.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'fox://x', true);
  wc.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND', 'fox://x', false);
  wc.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  wc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false });
  made.emit('resize');
  made.emit('closed');
  assert.deepEqual(seen, [
    'paint frame', 'paint none', 'loaded', 'failed ERR_FILE_NOT_FOUND (-6)', 'failed page process gone: crashed 1', 'restarted', 'resized', 'closed',
  ]);
});

test('窗口的方法：原样转给窗口和页面内容，加载失败不往外抛；窗口销毁之后什么都不做', async () => {
  built.length = 0;
  const win = createPanelWindow(specOf(), 'p.cjs', '', recorder().events);
  const [made] = built;
  assert.ok(made);
  win.setContentSize(1400, 490);
  win.setFrameRate(60);
  win.loadURL('fox://a.kb.panel/panel.html');
  win.setBackgroundThrottling(false);
  win.startPainting();
  win.invalidate();
  win.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 });
  win.send('page:look-event', { dark: true });
  win.stopPainting();
  win.reload();
  win.show();
  win.hide();
  await new Promise(resolve => setImmediate(resolve));   // 加载失败的 promise 有人接
  assert.deepEqual(made.webContents.calls, [
    'setFrameRate 60', 'loadURL fox://a.kb.panel/panel.html', 'throttle false', 'startPainting', 'invalidate',
    'input mouseLeave', 'send page:look-event [{"dark":true}]', 'stopPainting', 'reload',
  ]);
  assert.deepEqual(made.calls, ['setContentSize 1400x490', 'showInactive', 'hide']);
  assert.deepEqual(win.getContentSize(), [1400, 490]);
  win.destroy();
  win.destroy();
  assert.deepEqual(made.calls.slice(3), ['destroy']);
  const before = made.webContents.calls.length;
  win.loadURL('fox://x');
  win.reload();
  win.show();
  win.setContentSize(1, 1);
  win.sendInputEvent({ type: 'mouseLeave', x: 0, y: 0 });
  win.startPainting();
  win.send('x');
  assert.deepEqual([made.webContents.calls.length, made.calls.length, win.getContentSize()], [before, 4, []]);
});

test('句柄：只申请复制句柄的权限打开进程；复制时权限同原句柄；失败和打不开都返回 null；kernel32 只加载一次', () => {
  kernel32.calls.length = 0;
  assert.equal(openProcess(4321), 77n);
  assert.equal(duplicate(77n, 9n), 4242n);
  closeHandle(77n);
  // 0x40 = 复制句柄的权限，不继承；复制的选项 2 = 权限同原句柄
  assert.deepEqual(kernel32.calls, ['open 64 false 4321', `dup ${SELF} 9 77 0 false 2`, 'close 77']);
  // 那边的句柄值超过安全整数范围时是 bigint
  kernel32.copied = 0x1000_0000_0000_0001n;
  assert.equal(duplicate(77n, 10n), 0x1000_0000_0000_0001n);
  kernel32.copied = null;
  assert.equal(duplicate(77n, 11n), null);
  kernel32.process = 0;
  assert.equal(openProcess(1), null);
  assert.deepEqual(kernel32.loaded, ['kernel32.dll']);
});

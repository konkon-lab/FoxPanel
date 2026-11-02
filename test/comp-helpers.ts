// 组件管理测试共用：代替 electron 模块的假接口(行为由各测试填)、写一个组件文件夹。
// 被测模块要在导入这个文件之后用 await import() 加载，'electron' 才会指到假接口。

import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { createIpc, type IpcEvent, type IpcHandler } from '../src/main/ipc.ts';
import { Senders } from '../src/main/senders.ts';

// 假的子进程：记下发给它的消息；退出由测试用 emit('exit', code) 触发
export class FakeProcess extends EventEmitter {
  readonly pid = 1;
  readonly stdout = null;
  readonly stderr = null;
  readonly sent: unknown[] = [];
  killed = false;
  name = '';   // fork 时给的 serviceName

  postMessage(m: unknown): void {
    this.sent.push(m);
  }

  kill(): boolean {
    this.killed = true;
    return true;
  }
}

type Fork = (file: string, args: readonly string[], opts: { serviceName?: string; cwd?: string }) => FakeProcess;

// 起一个假进程并记进 electron.forked
const fork: Fork = (_file, _args, opts) => {
  const p = new FakeProcess();
  p.name = opts.serviceName ?? '';
  electron.forked.push(p);
  return p;
};

export const electron = {
  handlers: new Map<string, IpcHandler>(),   // 经 ipc 登记的处理函数(handle 和 on 都记在这里)
  forked: [] as FakeProcess[],            // utilityProcess.fork 起的进程
  fork,                                   // 起进程；测试可以整个替换(比如假的 yarn)
  picked: { canceled: true, filePaths: [] as string[] },   // 下一次 showOpenDialog 的结果
  opened: [] as string[],                                   // shell.openPath 打开过的路径
  decrypts: 0,                                              // safeStorage 解密的次数
};

// 回到初始状态(每个测试开头调)
export function resetElectron(): void {
  electron.handlers.clear();
  electron.forked = [];
  electron.fork = fork;
  electron.picked = { canceled: true, filePaths: [] };
  electron.opened = [];
  electron.decrypts = 0;
}

// 测试里的窗口(webContents 的 id)：主窗口；面板页面由各测试用 senders.addPanel 登记
export const WINDOW = 1;
export const senders = new Senders();
senders.add(WINDOW, 'window');

// 被拒的调用写的警告日志
export const refused: string[] = [];

// 被测模块的 IPC 经它注册：处理函数记进 electron.handlers
export const ipc = createIpc({
  ipcMain: {
    handle: (channel, fn) => electron.handlers.set(channel, fn),
    on: (channel, fn) => electron.handlers.set(channel, fn),
  },
  senders,
  log: text => refused.push(text),
});

// 以 sender 这个窗口的身份(从它的主框架)调一个登记了的 IPC 处理函数；处理函数抛出的异常和 ipcMain.handle 一样变成拒绝
export async function invokeFrom(sender: number, channel: string, ...args: unknown[]): Promise<unknown> {
  const h = electron.handlers.get(channel);
  if (!h) throw new Error(`no handler: ${channel}`);
  const frame = {};
  const e: IpcEvent = { sender: { id: sender, mainFrame: frame }, senderFrame: frame };
  return h(e, ...args);
}

// 以主窗口的身份调
export const invoke = (channel: string, ...args: unknown[]): Promise<unknown> => invokeFrom(WINDOW, channel, ...args);

const KEY = Symbol.for('foxpanel.test.electron');
Object.assign(globalThis, {
  [KEY]: {
    app: {}, Menu: {}, nativeImage: {}, Tray: {},
    dialog: { showOpenDialog: () => Promise.resolve(electron.picked) },
    shell: { openPath: (p: string) => { electron.opened.push(p); return Promise.resolve(''); } },
    utilityProcess: { fork: (...args: Parameters<Fork>) => electron.fork(...args) },
    // "加密" = 原文的 base64
    safeStorage: {
      isAsyncEncryptionAvailable: () => Promise.resolve(true),
      encryptStringAsync: (text: string) => Promise.resolve(Buffer.from(text)),
      decryptStringAsync: (b: Buffer) => { electron.decrypts++; return Promise.resolve({ result: b.toString() }); },
    },
  },
});

const NAMES = ['app', 'Menu', 'nativeImage', 'Tray', 'dialog', 'shell', 'utilityProcess', 'safeStorage'];
const SOURCE = `const e = globalThis[Symbol.for('foxpanel.test.electron')];\n${NAMES.map(n => `export const ${n} = e.${n};`).join('\n')}`;
const STUB = `data:text/javascript,${encodeURIComponent(SOURCE)}`;

registerHooks({
  resolve: (specifier, context, nextResolve) => (specifier === 'electron' ? { url: STUB, shortCircuit: true } : nextResolve(specifier, context)),
});

// 写一个组件文件夹 root/<folder>：清单(默认是带 page 入口的侧栏页)和入口文件
export function writeComponent(root: string, id: string, extra: Record<string, unknown> = {}, folder = id): string {
  const dir = path.join(root, folder);
  const manifest: Record<string, unknown> = { id, kind: 'sidepage', name: id, version: '1.0.0', author: 'test', license: 'MIT', page: 'page.js', ...extra };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'component.json'), JSON.stringify(manifest));
  for (const k of ['page', 'main', 'window']) {
    const entry = manifest[k];
    if (typeof entry === 'string') fs.writeFileSync(path.join(dir, entry), `// ${id}`);
  }
  return dir;
}

// 等 read() 的值连续 quietMs 毫秒不变(连续的文件事件都过去了)；超过 limit 毫秒还在变时抛出异常
export async function settled(read: () => number, quietMs = 800, limit = 10_000): Promise<void> {
  const end = Date.now() + limit;
  let last = read();
  let since = Date.now();
  for (;;) {
    await new Promise(r => setTimeout(r, 50));
    const now = read();
    if (now !== last) {
      last = now;
      since = Date.now();
    } else if (Date.now() - since >= quietMs) {
      return;
    }
    if (Date.now() > end) throw new Error('never settled');
  }
}

const UNTIL_MS = 15_000;   // until 默认最多等多久(毫秒)：等真的文件事件的地方，机器忙时要好几秒

// 等到 done() 为真；超过 limit 毫秒时抛出异常，带上等了多久和 state() 给的当时的情况
export async function until(done: () => boolean, state: () => string = () => '', limit = UNTIL_MS): Promise<void> {
  const start = Date.now();
  while (!done()) {
    const waited = Date.now() - start;
    if (waited > limit) {
      const now = state();
      throw new Error(`timed out after ${waited} ms${now ? `: ${now}` : ''}`);
    }
    await new Promise(r => setTimeout(r, 20));
  }
}

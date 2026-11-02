// 检查和安装更新(src/main/updater.ts)：electron 和 electron-updater 换成假模块，查状态怎么走、安装前通知主窗口放行退出。

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { registerHooks } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type * as UpdaterModule from '../src/main/updater.ts';
import { DEFAULT_APP, type UpdateState } from '../src/shared/types.ts';

// 各假接口被调的先后
const calls: string[] = [];

// 假的 electron-updater：检查和下载由测试决定结果；quitAndInstall 和真的一样，下一轮事件循环发 before-quit-for-update 再退出
class FakeAutoUpdater extends EventEmitter {
  logger: unknown = 'unset';
  autoDownload = false;
  autoInstallOnAppQuit = true;
  allowPrerelease = false;
  download: () => Promise<void> = () => Promise.resolve();

  checkForUpdates(): Promise<void> {
    calls.push('check');
    return Promise.resolve();
  }

  downloadUpdate(): Promise<void> {
    calls.push('download');
    return this.download();
  }

  quitAndInstall(): void {
    calls.push('quitAndInstall');
    setImmediate(() => {
      native.emit('before-quit-for-update');
      app.quit();
    });
  }
}

const native = new EventEmitter();
const app = { isPackaged: true, quit: (): void => { calls.push('app.quit'); } };
let auto = new FakeAutoUpdater();

const KEY = Symbol.for('foxpanel.test.updater');
Object.assign(globalThis, { [KEY]: { app, native, updater: { get autoUpdater() { return auto; } } } });
const stub = (body: string): string => `data:text/javascript,${encodeURIComponent(`const e = globalThis[Symbol.for('foxpanel.test.updater')];\n${body}`)}`;
const ELECTRON = stub('export const app = e.app;\nexport const autoUpdater = e.native;');
const ELECTRON_UPDATER = stub('export default e.updater;');
registerHooks({
  resolve: (specifier, context, nextResolve) => {
    if (specifier === 'electron') return { url: ELECTRON, shortCircuit: true };
    if (specifier === 'electron-updater') return { url: ELECTRON_UPDATER, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

interface Rig {
  updater: UpdaterModule.Updater;
  states: UpdateState[];   // 推给主窗口的各个状态
  logs: string[];          // 运行日志的各行(「级别 文字」)
}

// 一个 Updater：打包没有、有没有 app-update.yml 由参数定；每个测试用新的假 electron-updater
async function rig(t: TestContext, packaged = true, configured = true): Promise<Rig> {
  const resources = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-updater-'));
  if (configured) fs.writeFileSync(path.join(resources, 'app-update.yml'), 'provider: generic\n');
  const before = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { value: resources, configurable: true });
  t.after(() => {
    if (before) Object.defineProperty(process, 'resourcesPath', before);
    else Reflect.deleteProperty(process, 'resourcesPath');
    fs.rmSync(resources, { recursive: true, force: true });
    native.removeAllListeners();
  });
  calls.length = 0;
  app.isPackaged = packaged;
  auto = new FakeAutoUpdater();
  // updater.ts 在模块加载时取 electron-updater 的 autoUpdater：每个测试重新加载一份
  const { Updater } = await import(`../src/main/updater.ts?rig=${Math.random()}`) as typeof UpdaterModule;
  const states: UpdateState[] = [];
  const logs: string[] = [];
  const updater = new Updater(s => { states.push(s); }, (text, level = 'info') => { logs.push(`${level} ${text}`); }, () => { calls.push('beforeQuit'); });
  return { updater, states, logs };
}

const nextTurn = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

test('开发版和没有 app-update.yml 的版本只给状态，不检查', async t => {
  let r = await rig(t, false, true);
  await r.updater.check(true);
  assert.deepEqual([r.states, calls], [[{ state: 'dev' }], []]);
  r = await rig(t, true, false);
  await r.updater.check(true);
  assert.deepEqual([r.states, calls], [[{ state: 'unconfigured' }], []]);
});

test('检查：状态跟 electron-updater 的事件走；下载中和已下载时再检查不做任何事', async t => {
  const r = await rig(t);
  assert.equal(auto.logger, null);
  assert.equal(auto.autoInstallOnAppQuit, false);
  r.updater.configure({ ...DEFAULT_APP, autoDownload: true, beta: true });
  assert.deepEqual([auto.autoDownload, auto.allowPrerelease], [true, true]);
  await r.updater.check(false);
  assert.deepEqual(calls, ['check']);
  auto.emit('checking-for-update');
  auto.emit('update-available', { version: '1.2.0' });
  auto.emit('download-progress', { percent: 41.6 });
  assert.deepEqual(r.states, [{ state: 'checking' }, { state: 'downloading', version: '1.2.0', percent: 0 }, { state: 'downloading', version: '1.2.0', percent: 42 }]);
  await r.updater.check(true);
  auto.emit('update-downloaded', { version: '1.2.0' });
  await r.updater.check(true);
  assert.deepEqual([calls, r.updater.state], [['check'], { state: 'downloaded', version: '1.2.0' }]);
  // 检查中、下载进度不写日志
  assert.deepEqual(r.logs, ['info update downloading 1.2.0', 'info update downloaded 1.2.0']);
});

test('有新版本没下载时用户点按钮：开始下载时状态已经是下载中；自动检查不下载', async t => {
  const r = await rig(t);
  r.updater.configure({ ...DEFAULT_APP, autoDownload: false, beta: false });
  auto.emit('update-available', { version: '1.2.0' });
  assert.deepEqual(r.updater.state, { state: 'available', version: '1.2.0' });
  // 不是用户点的：再检查一次
  await r.updater.check(false);
  assert.deepEqual([calls, r.updater.state.state], [['check'], 'available']);
  // 用户点的：下载还没有任何进展时状态已经是下载中
  let finish: () => void = () => undefined;
  auto.download = () => new Promise<void>(resolve => { finish = resolve; });
  const pending = r.updater.check(true);
  assert.deepEqual([calls, r.updater.state], [['check', 'download'], { state: 'downloading', version: '1.2.0', percent: 0 }]);
  assert.deepEqual(r.states.at(-1), { state: 'downloading', version: '1.2.0', percent: 0 });
  finish();
  await pending;
});

test('下载失败：没发 error 事件的也给失败状态，记成 warn；之后能再检查', async t => {
  const r = await rig(t);
  r.updater.configure({ ...DEFAULT_APP, autoDownload: false, beta: false });
  auto.emit('update-available', { version: '1.2.0' });
  auto.download = () => Promise.reject(new Error('sha512 mismatch'));
  await r.updater.check(true);
  assert.deepEqual(r.updater.state, { state: 'error', message: 'Error: sha512 mismatch' });
  assert.equal(r.logs.at(-1), 'warn update error: Error: sha512 mismatch');
  await r.updater.check(true);
  assert.deepEqual(calls, ['download', 'check']);
});

test('安装：下好了才装；程序退出之前先通知放行(关闭询问、关到托盘不拦这次退出)', async t => {
  const r = await rig(t);
  r.updater.install();
  await nextTurn();
  assert.deepEqual(calls, []);
  auto.emit('update-downloaded', { version: '1.2.0' });
  r.updater.install();
  assert.deepEqual(calls, ['quitAndInstall']);
  await nextTurn();
  assert.deepEqual(calls, ['quitAndInstall', 'beforeQuit', 'app.quit']);
});

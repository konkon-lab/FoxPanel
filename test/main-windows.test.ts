import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';
import { DEFAULT_APP, IPC, type AppSettings, type CodeComponent, type MediaPlan } from '../src/shared/types.ts';

// 各窗口做过的事，按先后(「窗口序号 做了什么」)
const steps: string[] = [];

// 假的页面内容：记下收到的消息
class FakeContents extends EventEmitter {
  readonly id: number;
  readonly sent: unknown[][] = [];
  destroyed = false;

  constructor(id: number) {
    super();
    this.id = id;
  }

  send(channel: string, ...args: unknown[]): void {
    this.sent.push([channel, ...args]);
  }

  setZoomFactor(): void { /* 缩放不在这里测 */ }

  isDestroyed(): boolean {
    return this.destroyed;
  }
}

// 假的 BrowserWindow：记下构造参数、加载的地址和重载次数；close() 发 close 事件，没被拦下才销毁
class FakeBrowserWindow extends EventEmitter {
  static readonly all: FakeBrowserWindow[] = [];
  readonly n: number;
  readonly options: Record<string, unknown>;
  readonly webContents: FakeContents;
  hidden = false;
  destroyed = false;

  constructor(options: Record<string, unknown>) {
    super();
    this.n = FakeBrowserWindow.all.push(this);
    this.options = options;
    this.webContents = new FakeContents(100 + this.n);
    steps.push(`${this.n} new`);
  }

  loadURL(url: string): Promise<void> {
    steps.push(`${this.n} load ${url}`);
    return Promise.resolve();
  }

  reload(): void {
    steps.push(`${this.n} reload`);
  }

  isDestroyed(): boolean {
    return this.destroyed;
  }

  hide(): void {
    this.hidden = true;
  }

  setBackgroundColor(): void { /* 底色不在这里测 */ }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.webContents.destroyed = true;
    steps.push(`${this.n} destroyed`);
    this.emit('closed');
  }

  close(): void {
    let stopped = false;
    this.emit('close', { preventDefault: () => { stopped = true; } });
    if (!stopped) this.destroy();
  }
}

// 假的托盘图标
class FakeTray extends EventEmitter {
  static count = 0;

  constructor() {
    super();
    FakeTray.count++;
  }

  setToolTip(): void { /* 不在这里测 */ }
  setContextMenu(): void { /* 不在这里测 */ }
  destroy(): void { /* 不在这里测 */ }
}

const KEY = Symbol.for('foxpanel.test.windows');
Object.assign(globalThis, {
  [KEY]: {
    BrowserWindow: FakeBrowserWindow,
    Tray: FakeTray,
    nativeTheme: Object.assign(new EventEmitter(), { themeSource: 'system', shouldUseDarkColors: false }),
    screen: { getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }) },
    app: { getName: () => 'FoxPanel', getAppPath: () => import.meta.dirname },
    Menu: { buildFromTemplate: (template: unknown) => template },
    // 图标文件一张都读不到的空图标
    nativeImage: { createFromPath: () => ({ isEmpty: () => true }), createEmpty: () => ({}) },
  },
});
const NAMES = ['BrowserWindow', 'Tray', 'nativeTheme', 'screen', 'app', 'Menu', 'nativeImage'];
const STUB = `data:text/javascript,${encodeURIComponent(`const e = globalThis[Symbol.for('foxpanel.test.windows')];\n${NAMES.map(n => `export const ${n} = e.${n};`).join('\n')}`)}`;
registerHooks({
  resolve: (specifier, context, nextResolve) => (specifier === 'electron' ? { url: STUB, shortCircuit: true } : nextResolve(specifier, context)),
});

// window.ts、pages.ts 导入 electron：在假模块装好之后加载
const { MainWindow } = await import('../src/main/window.ts');
const { MediaPage } = await import('../src/main/pages.ts');

const WINDOW_URL = 'fox://host/window/index.html';
const MEDIA_URL = 'fox://host/media.html';

// 清掉记录；回这之后新开的窗口
function fresh(): FakeBrowserWindow[] {
  steps.length = 0;
  FakeBrowserWindow.all.length = 0;
  FakeTray.count = 0;
  return FakeBrowserWindow.all;
}

// 窗口建好时的回调：记下那一刻是哪个 webContents
const opened = (wc: { id: number }): void => { steps.push(`opened ${wc.id}`); };

interface Rig {
  main: InstanceType<typeof MainWindow>;
  win: FakeBrowserWindow;
  app: AppSettings;
  closed: { count: number };
}

// 开好的主窗口；关闭方式可以在测试里改 app.closeAction
function mainWindow(): Rig {
  const wins = fresh();
  const app: AppSettings = { ...DEFAULT_APP };
  const closed = { count: 0 };
  const main = new MainWindow({
    url: WINDOW_URL, preload: 'preload.cjs', icon: 'icon.ico',
    app: () => app, locale: () => 'en',
    opened, closed: () => { closed.count++; },
  });
  main.open();
  const win = wins[0];
  assert.ok(win);
  return { main, win, app, closed };
}

test('主窗口：建好后在加载页面之前交给 opened；用的是给它的 preload', () => {
  const { win } = mainWindow();
  assert.deepEqual(steps, ['1 new', 'opened 101', `1 load ${WINDOW_URL}`]);
  assert.deepEqual(win.options['webPreferences'], { preload: 'preload.cjs' });
});

test('主窗口：关闭方式是询问时，主窗口的页面接了询问才问；别的窗口发来的登记不算', () => {
  // 没有页面接询问：直接关
  let r = mainWindow();
  r.win.close();
  assert.deepEqual([r.win.destroyed, r.closed.count, r.win.webContents.sent], [true, 1, []]);

  // 别的窗口说自己接了：不算，照样直接关
  r = mainWindow();
  r.main.closeHandledBy(r.win.webContents.id + 1);
  r.win.close();
  assert.deepEqual([r.win.destroyed, r.closed.count, r.win.webContents.sent], [true, 1, []]);

  // 主窗口的页面接了：不关，发询问给页面
  r = mainWindow();
  r.main.closeHandledBy(r.win.webContents.id);
  r.win.close();
  assert.deepEqual([r.win.destroyed, r.closed.count, r.win.webContents.sent], [false, 0, [[IPC.closeAsk]]]);
  // 回答退出：直接关掉，不问第二次
  r.main.answerClose('quit');
  assert.deepEqual([r.win.destroyed, r.closed.count, r.win.webContents.sent.length], [true, 1, 1]);

  // 页面重新加载后登记作废
  r = mainWindow();
  r.main.closeHandledBy(r.win.webContents.id);
  r.win.webContents.emit('did-start-loading');
  r.win.close();
  assert.deepEqual([r.win.destroyed, r.closed.count], [true, 1]);
});

test('主窗口：关闭方式是退出时直接关，是托盘时藏起来不关', () => {
  let r = mainWindow();
  r.app.closeAction = 'quit';
  r.main.closeHandledBy(r.win.webContents.id);
  r.win.close();
  assert.deepEqual([r.win.destroyed, r.closed.count, r.win.webContents.sent], [true, 1, []]);

  r = mainWindow();
  r.app.closeAction = 'tray';
  r.win.close();
  assert.deepEqual([r.win.destroyed, r.win.hidden, r.closed.count, FakeTray.count], [false, true, 0, 1]);
  r.main.stop();
});

test('主窗口：为安装更新放行之后，关闭方式是询问或托盘时关窗口也直接关', () => {
  // 询问：页面接了询问也不问
  let r = mainWindow();
  r.main.closeHandledBy(r.win.webContents.id);
  r.main.allowQuit();
  assert.equal(r.win.destroyed, false);
  r.win.close();
  assert.deepEqual([r.win.destroyed, r.closed.count, r.win.webContents.sent], [true, 1, []]);

  // 托盘：不藏起来
  r = mainWindow();
  r.app.closeAction = 'tray';
  r.main.allowQuit();
  r.win.close();
  assert.deepEqual([r.win.destroyed, r.win.hidden, r.closed.count, FakeTray.count], [true, false, 1, 0]);
});

const comp = (id: string): CodeComponent => ({ id, kind: 'output', name: id, config: {}, url: `fox://component/${id}/page.js` });
// 媒体页面的计划：页面代码和它们要用的服务
const plan = (components: CodeComponent[], services: CodeComponent[] = [], remotes: string[] = []): MediaPlan => ({ kind: 'media', components, services, remotes });

test('媒体页面：有组件才开(沙箱、窄 preload)，建好后在加载页面之前交给 opened；计划变了重载同一个窗口，不重新登记', () => {
  const wins = fresh();
  const media = new MediaPage(MEDIA_URL, 'preload-page.cjs', opened);
  media.sync(plan([]));
  assert.deepEqual([steps, media.webContents], [[], null]);
  media.sync(plan([comp('a.tts')]));
  assert.deepEqual(steps, ['1 new', 'opened 101', `1 load ${MEDIA_URL}`]);
  assert.deepEqual(wins[0]?.options, {
    show: false,
    webPreferences: { preload: 'preload-page.cjs', sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, backgroundThrottling: false },
  });
  assert.equal(media.webContents?.id, 101);
  // 计划没变不动；组件、服务、够得着的远程服务变了都重载
  media.sync(plan([comp('a.tts')]));
  media.sync(plan([comp('a.tts'), comp('a.asr')]));
  media.sync(plan([comp('a.tts'), comp('a.asr')], [comp('a.cloud')]));
  media.sync(plan([comp('a.tts'), comp('a.asr')], [comp('a.cloud')], ['keyboard']));
  assert.deepEqual(steps.slice(3), ['1 reload', '1 reload', '1 reload']);
  // 没有要跑页面代码的组件了关掉(只剩服务也关)；又有了开新的窗口，再交给 opened 一次
  media.sync(plan([], [comp('a.cloud')]));
  assert.deepEqual([steps.slice(6), media.webContents], [['1 destroyed'], null]);
  media.sync(plan([comp('a.asr')]));
  assert.deepEqual(steps.slice(7), ['2 new', 'opened 102', `2 load ${MEDIA_URL}`]);
  media.stop();
  assert.equal(wins[1]?.destroyed, true);
});

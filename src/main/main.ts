// 主进程入口：把设置、主窗口、组件管理、组件进程、远程服务、应用信息、面板页面、更新接在一起，注册核心自己的 IPC，启动和退出。

import { app, clipboard, crashReporter, ipcMain, session, shell, webContents } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppBridge } from './app.ts';
import { dataPath, listDirs, makeDir } from './datadir.ts';
import { devComponents } from './dev.ts';
import { appUsage, isElevated, relaunchElevated } from './desktop.ts';
import { createIpc, POLICY } from './ipc.ts';
import { LogBook } from './logs.ts';
import { PageBus } from './page-bus.ts';
import { MediaPage } from './pages.ts';
import { closeHandle, createPanelWindow, duplicate, openProcess } from './panel-window.ts';
import { PanelPages, planIds, type PanelSpec } from './panels.ts';
import { ServiceRelay } from './relay.ts';
import { adopt, limitPermissions, Senders } from './senders.ts';
import { isLanguage, loadSettings, readApp, saveSettings } from './settings.ts';
import { Updater } from './updater.ts';
import { MainWindow } from './window.ts';
import { ComponentHosts } from './components/hosts.ts';
import { ComponentManager } from './components/manager.ts';
import { handleScheme, registerScheme } from './components/protocol.ts';
import { LIB_DIR, PANEL_LIBS } from '../shared/libs.ts';
import { isComponentId, isWebUrl, textOf } from '../shared/manifest.ts';
import {
  IPC, PAGE_IPC, type ComponentResult, type DirListing, type InitPayload, type Locale, type Log, type MediaPlan, type PageLook,
  type PanelPlan, type Settings, type SysStats,
} from '../shared/types.ts';
import { errorText, isObject, matchLocale } from '../shared/util.ts';

const DIST = import.meta.dirname;                  // 打包产物的目录(dist/)
const PRELOAD = path.join(DIST, 'preload.cjs');
const PAGE_PRELOAD = path.join(DIST, 'preload-page.cjs');   // 面板页面和媒体页面的窄 preload(只有 PageApi)
const PRE_DIR = path.join(DIST, 'components');     // 预装组件和预装列表所在的目录
const HOST_DIR = path.join(DIST, 'host');          // 页面宿主(面板宿主页、媒体页面、主窗口)的目录
// 开发用的显示方(把每块打开的面板显示成普通窗口)：未打包的程序带环境变量 FOXPANEL_PANELS=1 启动时加载，只在这次运行有效
const DEV_DISPLAY = path.join(DIST, 'dev', 'display-desktop');
const MEDIA_PAGE = 'fox://host/media.html';
const WINDOW_PAGE = 'fox://host/window/index.html';
const UPDATE_DELAY_MS = 10_000;   // 启动后多久检查更新
const STATS_MS = 2000;            // 状态栏 CPU、内存、组件上报的项的刷新间隔
const LOG_MAX = 2000;             // 页面组件一行日志的最大长度(字符)

const dataDir = (): string => app.getPath('userData');
const configFile = (): string => path.join(dataDir(), 'config.json');

// 各窗口是哪种页面：IPC 的策略和权限按它判断
const senders = new Senders();

const mainWindow = new MainWindow({
  url: WINDOW_PAGE, preload: PRELOAD, icon: path.join(DIST, 'icons', 'icon.ico'),
  app: () => settings.app,
  locale: () => uiLocale(),
  opened: wc => adoptPage(wc, 'window'),
  // 主窗口关了就退出(媒体页面等隐藏窗口不算)
  closed: () => shutdown(),
});
const media = new MediaPage(MEDIA_PAGE, PAGE_PRELOAD, wc => adoptPage(wc, 'media'));

// 运行日志：新行推给主窗口和组件进程；组件进程建好之前的行在它启动时补发
const logs = new LogBook(lines => {
  mainWindow.send(IPC.logEvent, lines);
  host?.logs(lines);
});

// 写一行运行日志；source = 组件 id，空 = 宿主
const log: Log = (text, level = 'info', source = '') => logs.add(source, text, level);

// 页面发来的 IPC 都经它注册：按发送方是哪种页面决定处理不处理
const ipc = createIpc({ ipcMain, senders, log });

// 总线在页面一侧的投递：媒体页面、面板页面只收自己登记了的频道
const pageBus = new PageBus({
  senders, log,
  send: (page, channel, data) => {
    const wc = webContents.fromId(page);
    if (wc && !wc.isDestroyed()) wc.send(IPC.busEvent, channel, data);
  },
});

// boot() 读出设置、assemble() 建好下面这几个之后，才开始有 IPC、窗口和定时器用到它们
let settings: Settings;
let relay: ServiceRelay;
let appBridge: AppBridge;
let panels: PanelPages;
let components: ComponentManager;
let host: ComponentHosts;
let updater: Updater;

let statsTimer: NodeJS.Timeout | undefined;
let lookSig = '';        // 发给面板页面和媒体页面的最近一份外观(JSON)
let hostLoadTurn = 0;    // loadHost 的调用次数：等解密时又有新的调用，旧的那次作废
let stopped = false;     // 已经在收尾退出

const saveConfig = (): void => saveSettings(configFile(), settings);

// 界面语言：跟随系统时按系统语言选择
const uiLocale = (): Locale => (settings.language === 'system' ? matchLocale(app.getLocale()) : settings.language);

// 面板页面和媒体页面的外观和界面语言
const pageLook = (): PageLook => ({ dark: settings.panels.dark, locale: uiLocale() });

// 媒体页面的计划：页面代码和它们要用的服务
const mediaPlan = (): MediaPlan => components.store.mediaPlan(settings.components);

// 媒体页面的计划里的组件 id
const mediaIds = (plan: MediaPlan): string[] => [...plan.components, ...plan.services].map(c => c.id);

// 主窗口或媒体页面的窗口建好(加载地址之前)：登记它是哪种页面(媒体页面带上它加载的组件 id 和够得着的远程服务)，加上页面限制；
// 页面重新加载或销毁时清掉它登记的总线频道
function adoptPage(wc: Electron.WebContents, kind: 'window' | 'media'): void {
  const plan = kind === 'media' ? mediaPlan() : null;
  adopt(senders, wc, kind, plan ? mediaIds(plan) : [], plan?.remotes ?? []);
  const id = wc.id;
  wc.on('did-start-navigation', details => {
    if (details.isMainFrame && !details.isSameDocument) pageBus.drop(id);
  });
  wc.once('destroyed', () => pageBus.drop(id));
}

// 面板目录和各块面板的页面要加载的东西
function panelSpecs(): PanelSpec[] {
  const plans = new Map(components.store.panelPlans(settings.components).map(p => [p.id, p]));
  return components.store.panelInfos(settings.components).flatMap(info => {
    const plan = plans.get(info.id);
    return plan ? [{ info, plan }] : [];
  });
}

// 总线消息发给页面：媒体页面、面板页面里登记了这个频道的，和主窗口(全收)；from = 发出它的页面(webContents 的 id)，不发回去
function busToPages(channel: string, data: unknown, from?: number): void {
  pageBus.deliver(channel, data, from);
  if (mainWindow.webContents?.id !== from) mainWindow.send(IPC.busEvent, channel, data);
}

// 外观(深色、界面语言)和页面手里的不一样时发给全部面板页面和媒体页面
function pushLook(): void {
  const look = pageLook();
  const sig = JSON.stringify(look);
  if (sig === lookSig) return;
  lookSig = sig;
  panels.sendAll(PAGE_IPC.lookEvent, look);
  media.webContents?.send(PAGE_IPC.lookEvent, look);
}

// 面板页面：只有生效的显示方所在的进程能开；页面登记成面板页面，带上它的计划里的组件 id 和远程服务
function newPanels(): PanelPages {
  return new PanelPages({
    display: () => components.store.providers('panels', settings.components)[0],
    createWindow: (spec, events) => createPanelWindow(spec, PAGE_PRELOAD, textOf(spec.name, uiLocale()), events),
    adopt: (page, plan) => senders.addPanel(page, plan.id, planIds(plan), plan.remotes),
    dropped: page => {
      senders.remove(page);
      pageBus.drop(page);
    },
    restarted: page => pageBus.drop(page),
    openProcess, duplicate, closeHandle,
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
    listed: list => host.panels([...list]),
    failed: () => components.hostChanged(),
    log,
  });
}

// 远程服务：提供方按清单的 provides 和组件顺序认，状态发给订阅了的组件进程和页面
function newRelay(): ServiceRelay {
  return new ServiceRelay({
    providers: name => components.store.providers(name, settings.components),
    senders,
    toPage: (id, name, state) => {
      const wc = webContents.fromId(id);
      if (wc && !wc.isDestroyed()) wc.send(IPC.relayEvent, name, state);
    },
    log,
  });
}

// 应用信息：程序版本、界面语言、装着的组件、输出和听写的登记情况，推给全部组件进程；组件要的发送、听写、翻译、开关输出组件、剪贴板也经它
function newAppBridge(): AppBridge {
  return new AppBridge({
    hosts: () => host,
    version: app.getVersion(),
    packaged: app.isPackaged,
    locale: uiLocale,
    components: () => components.store.appComponents(settings.components),
    setOn: (id, on) => {
      try {
        components.apply({ kind: 'on', id, on });
      } catch (e) {
        log(`cannot switch ${id}: ${errorText(e)}`, 'warn');
      }
    },
    clipboard,
  });
}

// 组件管理：设置存进配置文件并推给主窗口；核心的通知发到组件进程和各页面
function newComponents(): ComponentManager {
  return new ComponentManager({
    userData: dataDir(), preinstalled: PRE_DIR, log,
    extra: devComponents(process.env, app.isPackaged, DEV_DISPLAY),
    yarn: path.join(app.getAppPath(), 'vendor', 'yarn', 'yarn.cjs'), yarnHost: path.join(DIST, 'yarn-host.cjs'), version: app.getVersion(),
    get: () => settings.components,
    save: s => {
      settings.components = s;
      saveConfig();
      mainWindow.send(IPC.settingsEvent, settings);
    },
    changed: componentsChanged,
    bus: (channel, data) => {
      host.bus(channel, data);
      busToPages(channel, data);
    },
    host: () => host,
    window: () => mainWindow.window,
    pageErrors: () => panels.errors,
  });
}

// 组件变了：媒体页面能用的组件 id 和远程服务跟上它的新计划，面板页面(计划变了的那几页重载)、
// 远程服务的提供方、应用信息、组件进程、媒体页面跟上新的组件
function componentsChanged(): void {
  const plan = mediaPlan();
  senders.loadMedia(mediaIds(plan), plan.remotes);
  panels.sync(panelSpecs());
  relay.sync();
  appBridge.refresh();
  void loadHost();
}

// 组件进程：主进程组件(输出、输入源、服务)跑在这里；它发的总线消息转给各页面，面板页面、远程服务的消息和通用请求交给对应的部分
function newHost(): ComponentHosts {
  return new ComponentHosts({
    file: path.join(DIST, 'component-host.js'),
    shared: {
      cordis: pathToFileURL(path.join(DIST, LIB_DIR, PANEL_LIBS.cordis)).href,
      koffi: pathToFileURL(createRequire(import.meta.url).resolve('koffi')).href,
    },
    dataDir: dataDir(),
    storage: components.storage,
    log,
    appDir: path.join(DIST, '..'),
    bus: busToPages,
    changed: () => {
      appBridge.refresh();
      components.hostChanged();
    },
    logs: () => logs.list,
    gone: h => {
      relay.hostGone(h);
      panels.hostGone(h);
    },
    panels: (m, h) => panels.message(m, h),
    panelList: () => panels.list,
    info: () => appBridge.info(),
    relay: (m, h) => relay.message(m, h),
    request: (m, h) => appBridge.message(m, h),
  });
}

// 建好各部分并互相接上：构造函数都只存依赖，互相的调用在启动之后才发生
function assemble(): void {
  panels = newPanels();
  components = newComponents();
  relay = newRelay();
  appBridge = newAppBridge();
  host = newHost();
  updater = new Updater(s => mainWindow.send(IPC.updateEvent, s), log, () => mainWindow.allowQuit());
}

// 组件进程和媒体页面按当前的组件加载。解密 secret 要等：等的时候又被调用，只有最后一次生效
async function loadHost(): Promise<void> {
  const turn = ++hostLoadTurn;
  const list = await components.mainComponents();
  if (turn !== hostLoadTurn) return;
  host.load(list);
  media.sync(mediaPlan());
}

// 状态栏：CPU、内存；组件上报的项按组件顺序
function sendStats(): void {
  const reported = host.items;
  const items = components.store.active(settings.components).flatMap(c => {
    const item = reported.get(c.manifest.id);
    return item ? [{ id: c.manifest.id, item }] : [];
  });
  const stats: SysStats = { ...appUsage(), items };
  mainWindow.send(IPC.statsEvent, stats);
}

// 核心自己的 IPC(组件管理的在 ComponentManager.registerIpc)；谁能调哪个通道见 ipc.ts 的 POLICY
function registerIpc(): void {
  // 页面组件发的总线消息：转给组件进程和别的页面(媒体页面、面板页面只能发自己组件的频道)；核心的频道和太大的消息不转
  ipc.on(IPC.busSend, POLICY.busSend, (e, channel, data) => {
    if (!pageBus.accepts(channel, data)) return;
    host.bus(channel, data);
    busToPages(channel, data, e.sender.id);
  });
  ipc.on(IPC.busListen, POLICY.busListen, (e, channel, on) => pageBus.listen(e.sender.id, channel, on));
  // 面板页面和媒体页面取自己的计划
  ipc.handle(PAGE_IPC.plan, POLICY.plan, (e): PanelPlan | MediaPlan => {
    if (senders.get(e.sender.id)?.kind === 'media') return mediaPlan();
    const plan = panels.planOf(e.sender.id);
    if (!plan) throw new Error('没有这一页的计划');
    return plan;
  });
  ipc.handle(PAGE_IPC.look, POLICY.look, (): PageLook => pageLook());
  // 面板页面换深色 / 浅色：存进设置，全部面板页面一起换
  ipc.on(PAGE_IPC.setDark, POLICY.setDark, (_e, on) => {
    const dark = on === true;
    if (settings.panels.dark === dark) return;
    settings.panels = { dark };
    saveConfig();
    mainWindow.send(IPC.settingsEvent, settings);
    pushLook();
  });
  // 面板页面请显示方收起自己：核心替它调远程服务 panels 的 open(面板 id, false)
  ipc.on(PAGE_IPC.hide, POLICY.hide, e => {
    const info = senders.get(e.sender.id);
    if (info?.kind === 'panel') relay.tell('panels', 'open', [info.panel, false], { component: info.panel, where: 'panel' });
  });
  ipc.handle(IPC.init, POLICY.init, (): InitPayload => ({ settings, version: app.getVersion(), dataDir: dataDir() }));
  ipc.handle(IPC.language, POLICY.language, (_e, lang) => {
    if (!isLanguage(lang)) return;
    settings.language = lang;
    saveConfig();
    appBridge.refresh();
    pushLook();
    mainWindow.localeChanged();
  });
  ipc.on(IPC.winMinimize, POLICY.winMinimize, () => mainWindow.minimize());
  ipc.on(IPC.winMaximize, POLICY.winMaximize, () => mainWindow.toggleMaximize());
  ipc.on(IPC.winClose, POLICY.winClose, () => mainWindow.close());
  ipc.on(IPC.closeAnswer, POLICY.closeAnswer, (_e, action) => {
    if (action === 'tray' || action === 'quit') mainWindow.answerClose(action);
  });
  ipc.on(IPC.closeHandler, POLICY.closeHandler, e => mainWindow.closeHandledBy(e.sender.id));
  ipc.handle(IPC.setApp, POLICY.setApp, (_e, patch) => {
    const old = settings.app;
    settings.app = readApp({ ...old, ...(isObject(patch) ? patch : {}) });
    saveConfig();
    mainWindow.send(IPC.settingsEvent, settings);
    if (settings.app.theme !== old.theme || settings.app.zoom !== old.zoom) mainWindow.applyLook();
    updater.configure(settings.app);
  });
  ipc.handle(IPC.openExternal, POLICY.openExternal, async (_e, url) => {
    if (isWebUrl(url)) await shell.openExternal(url);
  });
  ipc.on(IPC.logWrite, POLICY.logWrite, (_e, source, text, level) => {
    if (isComponentId(source) && typeof text === 'string') log(text.slice(0, LOG_MAX), level === 'warn' || level === 'error' ? level : 'info', source);
  });
  ipc.handle(IPC.logList, POLICY.logList, () => logs.list);
  // 数据文件夹的目录浏览(目录设置的选择框)和打开文件夹：路径限制在数据文件夹里
  ipc.handle(IPC.dirList, POLICY.dirList, (_e, rel): DirListing => listDirs(dataDir(), rel));
  ipc.handle(IPC.dirMake, POLICY.dirMake, (_e, rel, name): ComponentResult => makeDir(dataDir(), rel, name));
  ipc.handle(IPC.openDataDir, POLICY.openDataDir, async (_e, rel) => {
    const dir = dataPath(dataDir(), rel);
    if (dir !== null) await shell.openPath(dir);
  });
  components.registerIpc(ipc);
  relay.registerIpc(ipc);
  ipc.handle(IPC.updateState, POLICY.updateState, () => updater.state);
  ipc.handle(IPC.updateCheck, POLICY.updateCheck, () => updater.check(true));
  ipc.handle(IPC.updateInstall, POLICY.updateInstall, () => updater.install());
}

// 崩溃转储仅保存在本地(userData/Crashpad)；子进程退出和主进程未捕获的异常写入日志
function installCrashLog(): void {
  crashReporter.start({ uploadToServer: false });
  app.on('child-process-gone', (_e, d) => log(`child process gone: ${d.type} ${d.reason} ${d.exitCode}`, 'warn'));
  app.on('render-process-gone', (_e, _wc, d) => log(`page process gone: ${d.reason} ${d.exitCode}`, 'error'));
  process.on('uncaughtException', e => log(`main process exception: ${e.stack ?? e.message}`, 'error'));
}

// 设置了以管理员身份运行而这一份没有管理员权限：放开单实例锁，以管理员身份另起一份(返回 true，这一份该退出)；
// 用户拒绝 UAC 时拿回锁，以普通权限继续
async function relaunchedAsAdmin(): Promise<boolean> {
  if (!settings.app.admin || isElevated()) return false;
  app.releaseSingleInstanceLock();
  if (await relaunchElevated()) return true;
  app.requestSingleInstanceLock();
  log('no admin rights granted, running as a normal user', 'warn');
  return false;
}

// 启动时装着的组件数和开着的组件提供的服务记进日志
function logComponents(): void {
  log(`loaded ${components.store.all.length} components`);
  for (const c of components.store.active(settings.components)) {
    for (const name of c.manifest.provides ?? []) log(`service ${name} started`, 'info', c.manifest.id);
  }
}

async function boot(): Promise<void> {
  installCrashLog();
  await app.whenReady();
  settings = loadSettings(configFile(), PRE_DIR, log);
  if (await relaunchedAsAdmin()) {
    app.exit(0);
    return;
  }
  mainWindow.followTheme();
  limitPermissions(session.defaultSession, senders);
  assemble();
  components.start();
  lookSig = JSON.stringify(pageLook());
  panels.sync(panelSpecs());
  logComponents();
  handleScheme(HOST_DIR, (id, rel) => components.store.resolve(id, rel));
  void loadHost();
  updater.configure(settings.app);
  registerIpc();
  mainWindow.open();
  statsTimer = setInterval(sendStats, STATS_MS);
  if (settings.app.autoCheck) setTimeout(() => void updater.check(false), UPDATE_DELAY_MS);
}

// 收尾并退出：停定时器、托盘、面板页面、组件管理、组件进程、媒体页面
function shutdown(): void {
  if (stopped) return;
  stopped = true;
  clearInterval(statsTimer);
  logs.stop();
  mainWindow.stop();
  panels.stop();
  components.stop();
  host.stop();
  media.stop();
  app.quit();
}

registerScheme();
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', mainWindow.show);
  app.on('window-all-closed', shutdown);
  void boot();
}

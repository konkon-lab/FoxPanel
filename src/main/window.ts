// 主窗口：无边框窗口(顶栏由页面绘制)、主题和缩放、点关闭时的处理(询问 / 关到托盘 / 退出)、托盘图标。

import { BrowserWindow, nativeTheme, screen, type Tray } from 'electron';
import { createTray, setTrayMenu } from './desktop.ts';
import { IPC, type AppSettings, type CloseAction, type Locale } from '../shared/types.ts';

const DEFAULT_SIZE = { width: 1440, height: 900 };   // 默认大小(像素)，放不下时缩到工作区里
const MIN_SIZE = { width: 960, height: 600 };        // 最小大小(像素)
// 窗口底色：和页面底色一致(src/renderer/style.css 的 --page-bg)
const PAGE_BG = { light: '#f5f6f8', dark: '#16171b' };

export interface MainWindowDeps {
  url: string;             // 主窗口页面
  preload: string;
  icon: string;
  app(): AppSettings;
  locale(): Locale;        // 托盘菜单的语言
  opened(webContents: Electron.WebContents): void;   // 窗口建好、加载页面之前
  closed(): void;          // 主窗口关了
}

export class MainWindow {
  private readonly deps: MainWindowDeps;
  private win: BrowserWindow | null = null;
  private tray: Tray | null = null;
  private quitting = false;        // 托盘或关闭询问选了退出、为安装更新退出：关窗口时不询问、不关到托盘
  private asksOnClose = false;     // 页面里有组件接了关闭询问(页面重新加载时清掉)

  constructor(deps: MainWindowDeps) {
    this.deps = deps;
  }

  // 还开着的窗口；没开或已关为 null
  get window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  get webContents(): Electron.WebContents | null {
    return this.window?.webContents ?? null;
  }

  send(channel: string, ...args: unknown[]): void {
    this.webContents?.send(channel, ...args);
  }

  // 主题按设置定好(之后开的窗口都按它配色)；主题或系统配色变了时主窗口跟着换底色
  followTheme(): void {
    nativeTheme.themeSource = this.deps.app().theme;
    nativeTheme.on('updated', () => this.applyLook());
  }

  // 开主窗口并加载页面
  open(): void {
    const area = screen.getPrimaryDisplay().workAreaSize;
    const w = new BrowserWindow({
      width: Math.min(DEFAULT_SIZE.width, area.width), height: Math.min(DEFAULT_SIZE.height, area.height), minWidth: MIN_SIZE.width, minHeight: MIN_SIZE.height,
      title: 'FoxPanel', frame: false, backgroundColor: this.color(),
      icon: this.deps.icon,
      webPreferences: { preload: this.deps.preload },
    });
    this.win = w;
    this.deps.opened(w.webContents);
    w.webContents.on('did-finish-load', () => w.webContents.setZoomFactor(this.deps.app().zoom));
    w.webContents.on('did-start-loading', () => { this.asksOnClose = false; });
    // 点关闭：按关闭方式询问(有组件接了才问，没有就退出)、关到托盘或退出
    w.on('close', e => {
      if (this.quitting) return;
      const action = this.deps.app().closeAction;
      if (action === 'quit' || (action === 'ask' && !this.asksOnClose)) return;
      e.preventDefault();
      if (action === 'tray') this.hideToTray();
      else w.webContents.send(IPC.closeAsk);
    });
    w.on('closed', () => {
      this.win = null;
      this.deps.closed();
    });
    void w.loadURL(this.deps.url);
  }

  private color(): string {
    return nativeTheme.shouldUseDarkColors ? PAGE_BG.dark : PAGE_BG.light;
  }

  // 主题和缩放跟设置走
  applyLook(): void {
    const { theme, zoom } = this.deps.app();
    nativeTheme.themeSource = theme;
    const w = this.window;
    if (!w) return;
    w.setBackgroundColor(this.color());
    w.webContents.setZoomFactor(zoom);
  }

  // 显示到前面(托盘、再次启动程序时)
  readonly show = (): void => {
    const w = this.window;
    if (!w) return;
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
  };

  minimize(): void {
    this.window?.minimize();
  }

  toggleMaximize(): void {
    const w = this.window;
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  }

  // 点关闭按钮：走上面的关闭处理
  close(): void {
    this.window?.close();
  }

  // 页面里有组件接了关闭询问；sender 是发来消息的 webContents 的 id
  closeHandledBy(sender: number): void {
    if (sender === this.webContents?.id) this.asksOnClose = true;
  }

  // 关闭询问的回答(「记住」由接询问的组件改自己的配置)
  answerClose(action: Exclude<CloseAction, 'ask'>): void {
    if (action === 'tray') this.hideToTray();
    else this.quit();
  }

  // 退出程序(托盘菜单、关闭询问)：不询问地关掉窗口；窗口已经没了就直接收尾
  readonly quit = (): void => {
    this.quitting = true;
    const w = this.window;
    if (w) w.close();
    else this.deps.closed();
  };

  // 程序马上要退出(安装更新)：之后关窗口时不询问、不关到托盘。窗口由 app.quit() 关
  allowQuit(): void {
    this.quitting = true;
  }

  private hideToTray(): void {
    this.tray ??= createTray(this.show, this.quit, this.deps.locale());
    this.window?.hide();
  }

  // 界面语言变了：托盘菜单换语言
  localeChanged(): void {
    if (this.tray) setTrayMenu(this.tray, this.show, this.quit, this.deps.locale());
  }

  // 退出时拿掉托盘图标
  stop(): void {
    this.tray?.destroy();
    this.tray = null;
  }
}

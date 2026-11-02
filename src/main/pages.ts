// 媒体页面的窗口：隐藏，跑输出、输入源、翻译组件的页面代码(播放、麦克风)。页面在沙箱里，只有窄 preload(PageApi)。

import { BrowserWindow } from 'electron';
import type { MediaPlan } from '../shared/types.ts';

// 窗口建好、加载页面之前的回调
type Opened = (webContents: Electron.WebContents) => void;

export class MediaPage {
  private readonly url: string;
  private readonly preload: string;
  private readonly opened: Opened;
  private win: BrowserWindow | null = null;
  private signature = '';   // 页面当前加载的计划(JSON)

  constructor(url: string, preload: string, opened: Opened) {
    this.url = url;
    this.preload = preload;
    this.opened = opened;
  }

  get webContents(): Electron.WebContents | null {
    return this.win && !this.win.isDestroyed() ? this.win.webContents : null;
  }

  // 计划变了就重载页面；没有要跑页面代码的组件时关掉，有了才开
  sync(plan: MediaPlan): void {
    const sig = JSON.stringify(plan);
    const wanted = plan.components.length > 0;
    if (sig === this.signature && (this.win || !wanted)) return;
    this.signature = sig;
    if (!wanted) return this.stop();
    if (this.win) return this.win.reload();
    const w = new BrowserWindow({
      show: false,
      webPreferences: { preload: this.preload, sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false, backgroundThrottling: false },
    });
    this.win = w;
    this.opened(w.webContents);
    w.on('closed', () => { if (this.win === w) this.win = null; });
    void w.loadURL(this.url);
  }

  stop(): void {
    this.win?.destroy();
    this.win = null;
  }
}

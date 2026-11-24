// 检查和安装更新(electron-updater，GitHub Releases)：按设置启动后检查一次、后台下载、接收测试版，下好后等用户点「重启更新」。
// 开发版(未打包)和没配置更新源的版本不检查。有新版本时状态里带着它的发布说明(收成一条条文字)、发布日期和发布页，主窗口的新版本弹窗用。

import { app, autoUpdater as nativeUpdater } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import updater from 'electron-updater';
import type { AppSettings, Log, UpdateState } from '../shared/types.ts';
import { notesOf, releaseDay, releasePage } from '../shared/update-notes.ts';

const { autoUpdater } = updater;

// 新版本的说明：发布说明、发布日期、发布页，状态里跟着新版本一直带着
type About = Pick<UpdateState, 'notes' | 'date' | 'url'>;

// 状态里的这三项：没有的不带
function about(notes: UpdateState['notes'], date: string | null | undefined, url: string | null | undefined): About {
  return { ...(notes?.length ? { notes } : {}), ...(date ? { date } : {}), ...(url ? { url } : {}) };
}

// 更新源的配置(程序资源文件夹里的 app-update.yml)；读不到时是空串
function feedConfig(): string {
  try {
    return fs.readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8');
  } catch {
    return '';
  }
}

export class Updater {
  state: UpdateState = { state: 'idle' };
  private readonly emit: (s: UpdateState) => void;
  private readonly log: Log;

  // beforeQuit：安装程序已经启动、程序马上为安装更新退出时调(这次退出不该被关闭询问或关到托盘拦下)
  constructor(emit: (s: UpdateState) => void, log: Log, beforeQuit: () => void) {
    this.emit = emit;
    this.log = log;
    nativeUpdater.on('before-quit-for-update', beforeQuit);
    autoUpdater.logger = null;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;   // 下好的更新只在用户点「重启并安装」时装，程序正常退出时不装
    autoUpdater.on('checking-for-update', () => this.set({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => this.set({ state: 'latest' }));
    autoUpdater.on('update-available', info => {
      const more = about(notesOf(info.releaseNotes), releaseDay(info.releaseDate), releasePage(feedConfig(), info.version));
      this.set(autoUpdater.autoDownload ? { state: 'downloading', version: info.version, percent: 0, ...more } : { state: 'available', version: info.version, ...more });
    });
    autoUpdater.on('download-progress', p => this.set({ ...this.state, state: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', info => this.set({ state: 'downloaded', version: info.version, ...about(this.state.notes, this.state.date, this.state.url) }));
    autoUpdater.on('error', e => this.set({ state: 'error', message: String(e) }));
  }

  // 后台下载、测试版跟设置走
  configure(s: AppSettings): void {
    autoUpdater.autoDownload = s.autoDownload;
    autoUpdater.allowPrerelease = s.beta;
  }

  // 换状态：写一行日志(检查中、下载进度不写)，推给主窗口
  private set(s: UpdateState): void {
    const quiet = s.state === 'checking' || (s.state === 'downloading' && (s.percent ?? 0) > 0);
    this.state = s;
    if (!quiet) this.log(`update ${s.state}${s.version ? ` ${s.version}` : ''}${s.message ? `: ${s.message}` : ''}`, s.state === 'error' ? 'warn' : 'info');
    this.emit(s);
  }

  // 检查一次；开发版、没配置更新源时只给状态。manual = 用户点的，有新版本没下载时开始下载
  async check(manual: boolean): Promise<void> {
    if (!app.isPackaged) return this.set({ state: 'dev' });
    if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return this.set({ state: 'unconfigured' });
    if (this.state.state === 'downloading' || this.state.state === 'downloaded') return;
    try {
      if (this.state.state === 'available' && manual) {
        // 第一个下载进度到来之前就算下载中
        this.set({ ...this.state, state: 'downloading', percent: 0 });
        await autoUpdater.downloadUpdate();
      } else {
        await autoUpdater.checkForUpdates();
      }
    } catch (e) {
      // electron-updater 抛出之前通常已发 error 事件(状态已是 error)；没发事件的失败在这里给状态
      if (this.state.state !== 'error') this.set({ state: 'error', message: String(e) });
    }
  }

  // 已下载：启动安装程序并退出(退出之前 electron-updater 发 before-quit-for-update)
  install(): void {
    if (this.state.state === 'downloaded') autoUpdater.quitAndInstall();
  }
}

// 「更新与关于」里版本一行右边显示什么：更新状态对到徽标(文案的键、参数、色调)和按钮(做什么、能不能点)；
// 新版本弹窗开不开、左下角写什么、主按钮是哪个。

// 更新状态里用到的部分
export interface UpdateView {
  state: string;
  version?: string | undefined;
  percent?: number | undefined;
}

export interface Badge {
  key: 'upd.checking' | 'upd.latest' | 'upd.new' | 'upd.downloading' | 'upd.downloaded' | 'upd.downloadedNoVer' | 'upd.failed' | 'upd.dev' | 'upd.none';
  params: Record<string, string | number>;
  tone: 'ok' | 'wait' | 'warn';
}

// 徽标；还没检查过(idle)时没有
export function badgeOf(u: UpdateView): Badge | null {
  switch (u.state) {
    case 'checking': return { key: 'upd.checking', params: {}, tone: 'wait' };
    case 'latest': return { key: 'upd.latest', params: {}, tone: 'ok' };
    case 'available': return { key: 'upd.new', params: { v: u.version ?? '' }, tone: 'wait' };
    case 'downloading': return { key: 'upd.downloading', params: { p: u.percent ?? 0 }, tone: 'wait' };
    case 'downloaded': return u.version ? { key: 'upd.downloaded', params: { v: u.version }, tone: 'ok' } : { key: 'upd.downloadedNoVer', params: {}, tone: 'ok' };
    case 'error': return { key: 'upd.failed', params: {}, tone: 'warn' };
    // 开发版(未打包)
    case 'dev': return { key: 'upd.dev', params: {}, tone: 'wait' };
    // 打包好的程序里没有更新源
    case 'unconfigured': return { key: 'upd.none', params: {}, tone: 'wait' };
    default: return null;
  }
}

export interface UpdateButton {
  action: 'install' | 'download' | 'check';   // 下好了 → 重启安装；有新版本没下载 → 下载；其余 → 检查
  text: 'upd.restartInstall' | 'upd.downloadUpdate' | 'upd.checkUpdate';
  disabled: boolean;                           // 开发版和没有更新源的版本检查不了
}

export function buttonOf(state: string): UpdateButton {
  if (state === 'downloaded') return { action: 'install', text: 'upd.restartInstall', disabled: false };
  if (state === 'available') return { action: 'download', text: 'upd.downloadUpdate', disabled: false };
  return { action: 'check', text: 'upd.checkUpdate', disabled: state === 'dev' || state === 'unconfigured' };
}

// ---------- 新版本弹窗 ----------

// 弹窗开着没有：有新版本(发现了、下载中、下好了)且知道版本号，这个版本这次运行里没被关掉过(dismissed 是关掉的那个版本)，
// 也不是用户说了跳过的那个版本(skipped)
export function promptOf(u: UpdateView, dismissed: string | null, skipped: string | null = null): boolean {
  if (u.state !== 'available' && u.state !== 'downloading' && u.state !== 'downloaded') return false;
  return !!u.version && u.version !== dismissed && u.version !== skipped;
}

// 弹窗左下角的进展：下载中是进度(文字和进度条)，下好了是一句话，还没下载时没有
export interface PromptProgress {
  key: 'upd.bgDownloading' | 'upd.ready';
  params: Record<string, number>;
  percent: number | null;   // 进度条的百分比；不画进度条时为 null
}

export function progressOf(u: UpdateView): PromptProgress | null {
  if (u.state === 'downloading') return { key: 'upd.bgDownloading', params: { p: u.percent ?? 0 }, percent: u.percent ?? 0 };
  if (u.state === 'downloaded') return { key: 'upd.ready', params: {}, percent: null };
  return null;
}

// 弹窗的主按钮：下好了 → 重启并安装；下载中 → 重启并安装(点不了)；有新版本没下载 → 下载更新
export function promptButtonOf(state: string): UpdateButton {
  if (state === 'downloading') return { action: 'install', text: 'upd.restartInstall', disabled: true };
  return buttonOf(state);
}

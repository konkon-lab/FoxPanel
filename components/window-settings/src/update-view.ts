// 「更新与关于」里版本一行右边显示什么：更新状态对到徽标(文案的键、参数、色调)和按钮(做什么、能不能点)。

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

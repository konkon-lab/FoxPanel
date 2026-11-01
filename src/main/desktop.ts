// 桌面相关：托盘图标、以管理员身份重新启动、全部进程的 CPU 和内存占用、Windows 安全验证。

import { app, Menu, nativeImage, Tray } from 'electron';
import { execFile, execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import type { Locale, VerifyError } from '../shared/types.ts';

// 托盘菜单的文字
const TRAY_TEXT: Readonly<Record<Locale, { show: string; quit: string }>> = {
  'zh-Hans': { show: '显示 FoxPanel', quit: '退出' },
  'zh-Hant': { show: '顯示 FoxPanel', quit: '結束' },
  ja: { show: 'FoxPanel を表示', quit: '終了' },
  en: { show: 'Show FoxPanel', quit: 'Quit' },
  ko: { show: 'FoxPanel 표시', quit: '종료' },
};

// 当前进程是否有管理员权限(net session 只有管理员能执行成功)
export function isElevated(): boolean {
  try {
    execFileSync('net', ['session'], { stdio: 'ignore', windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

// 以管理员身份启动同一程序(弹 UAC)；用户拒绝或启动失败时返回 false
export function relaunchElevated(): Promise<boolean> {
  const quote = (s: string): string => `'${s.replace(/'/g, "''")}'`;
  const args = process.argv.slice(1);
  const argList = args.length ? ` -ArgumentList ${args.map(a => quote(a.includes(' ') ? `"${a}"` : a)).join(',')}` : '';
  const command = `Start-Process -FilePath ${quote(process.execPath)}${argList} -WorkingDirectory ${quote(process.cwd())} -Verb RunAs`;
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true }, err => resolve(!err));
  });
}

// 托盘图标：打包时按显示缩放渲染好的各尺寸(dist/icons/tray-<像素>.png)，高分屏挑对应的一张
const TRAY_BASE = 16;   // 缩放 100% 时的边长(像素)
const TRAY_SIZES = [16, 20, 24, 32, 40, 48, 64];

function trayIcon(): Electron.NativeImage {
  const icon = nativeImage.createEmpty();
  for (const size of TRAY_SIZES) {
    const img = nativeImage.createFromPath(path.join(import.meta.dirname, 'icons', `tray-${size}.png`));
    if (!img.isEmpty()) icon.addRepresentation({ scaleFactor: size / TRAY_BASE, width: size, height: size, buffer: img.toPNG() });
  }
  return icon;
}

// 托盘图标：单击或「显示」打开主窗口，「退出」退出程序
export function createTray(show: () => void, quit: () => void, locale: Locale): Tray {
  const tray = new Tray(trayIcon());
  tray.setToolTip(app.getName());
  setTrayMenu(tray, show, quit, locale);
  tray.on('click', show);
  return tray;
}

// 托盘右键菜单(界面语言改变时重新设置)
export function setTrayMenu(tray: Tray, show: () => void, quit: () => void, locale: Locale): void {
  const text = TRAY_TEXT[locale];
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: text.show, click: show },
    { type: 'separator' },
    { label: text.quit, click: quit },
  ]));
}

// 全部进程的 CPU(占全部核心的 %)和内存(工作集占物理内存的 %)
export function appUsage(): { cpu: number; mem: number } {
  const metrics = app.getAppMetrics();
  const cpu = metrics.reduce((s, m) => s + m.cpu.percentCPUUsage, 0) / os.cpus().length;
  const kb = metrics.reduce((s, m) => s + m.memory.workingSetSize, 0);
  return { cpu: Math.round(cpu), mem: Math.round((kb * 1024 / os.totalmem()) * 100) };
}

// UserConsentVerificationResult → 原因代码
const VERIFY_ERROR: Readonly<Record<string, VerifyError>> = {
  Canceled: 'canceled',
  DeviceNotPresent: 'noDevice',
  NotConfiguredForUser: 'notConfigured',
  DisabledByPolicy: 'disabled',
  DeviceBusy: 'busy',
  RetriesExhausted: 'retries',
};

// Windows 安全验证(Windows Hello：PIN / 指纹 / 面部)：通过返回 null，否则返回原因代码(VerifyError)
export function verifyUser(reason: string): Promise<VerifyError | null> {
  const script = `
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' })[0]
[Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime] | Out-Null
$op = [Windows.Security.Credentials.UI.UserConsentVerifier]::RequestVerificationAsync('${reason.replace(/'/g, "''")}')
$t = $asTask.MakeGenericMethod([Windows.Security.Credentials.UI.UserConsentVerificationResult]).Invoke($null, @($op))
$t.Wait(-1) | Out-Null
$t.Result`;
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { windowsHide: true }, (err, stdout) => {
      const result = stdout.trim();
      if (result === 'Verified') resolve(null);
      else resolve(err ? 'failed' : VERIFY_ERROR[result] ?? 'failed');
    });
  });
}

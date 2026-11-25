// 设备标识：Windows 的 MachineGuid(装系统时生成，重装本程序不变)加上本程序的前缀取 sha256。
// 带前缀后这个值只在本程序里有意义，和别的程序对同一个 MachineGuid 算出的值不同。

import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';

const PREFIX = 'foxpanel.telemetry.device\n';                // 算设备标识时接在 MachineGuid 前面
const GUID_KEY = 'HKLM\\SOFTWARE\\Microsoft\\Cryptography';   // MachineGuid 所在的注册表项
const REG_TIMEOUT_MS = 5000;                                  // reg.exe 最多等这么久(毫秒)

// reg query 的输出里的 MachineGuid(小写)；没有时为 null
export function parseMachineGuid(out: string): string | null {
  const m = /MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]{8,})/.exec(out);
  return m?.[1]?.toLowerCase() ?? null;
}

// MachineGuid → 设备标识(64 位十六进制)
export function deviceId(guid: string): string {
  return crypto.createHash('sha256').update(PREFIX + guid).digest('hex');
}

// 随机的设备标识：读不到 MachineGuid 时用，和 deviceId 的结果一样长
export function randomDevice(): string {
  return crypto.randomBytes(32).toString('hex');
}

// 读本机的 MachineGuid；不是 Windows、读不到时为 null
export function readMachineGuid(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const reg = path.join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'reg.exe');
  return new Promise(resolve => {
    execFile(reg, ['query', GUID_KEY, '/v', 'MachineGuid'], { windowsHide: true, timeout: REG_TIMEOUT_MS }, (error, stdout) => {
      resolve(error ? null : parseMachineGuid(stdout));
    });
  });
}

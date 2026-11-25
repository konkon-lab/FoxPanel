// 遥测的状态：主进程部分发布，主窗口部分显示。发不发的判断也在这里。

import { isObject } from '../../_shared/util.ts';

// 不发送的原因
export const OFFS = [
  'unconfigured',   // 这个版本没有接收地址
  'dev',            // 从源码启动的程序
  'env',            // 环境变量 FOXPANEL_NO_TELEMETRY 或 DO_NOT_TRACK 关掉了
  'disabled',       // 设置里关着
] as const;
export type Off = typeof OFFS[number];

export interface TelemetryState {
  device: string;     // 设备标识
  session: string;    // 会话标识
  off: Off | null;    // 不发送的原因；null = 在发送
}

export interface Gate {
  endpoint: string;                                    // 接收地址
  packaged: boolean;                                   // 是安装包里的程序
  env: Readonly<Record<string, string | undefined>>;   // 环境变量
  enabled: boolean;                                    // 设置里的开关
}

// 环境变量算不算开着：没设、空、0、false 不算
const isSet = (v: string | undefined): boolean => v !== undefined && v !== '' && v !== '0' && v.toLowerCase() !== 'false';

// 不发送的原因；都满足时为 null
export function whyOff(g: Gate): Off | null {
  if (!g.endpoint) return 'unconfigured';
  if (!g.packaged) return 'dev';
  if (isSet(g.env['FOXPANEL_NO_TELEMETRY']) || isSet(g.env['DO_NOT_TRACK'])) return 'env';
  if (!g.enabled) return 'disabled';
  return null;
}

// 总线上收到的状态收窄；格式不对时为 null
export function readState(v: unknown): TelemetryState | null {
  if (!isObject(v)) return null;
  const { device, session, off } = v;
  if (typeof device !== 'string' || typeof session !== 'string') return null;
  return { device, session, off: OFFS.find(o => o === off) ?? null };
}

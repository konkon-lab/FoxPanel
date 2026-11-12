// 日志等级：设置值的收窄和严重程度的比较；主进程部分和页面都用。
import type { LogLevel } from '@konkon-lab/foxpanel-sdk';

// 严重程度，大的更严重
const RANK: Record<LogLevel, number> = { info: 0, warn: 1, error: 2 };

// 设置里的记录等级；不认识的值按 info
export const levelOf = (v: unknown): LogLevel => (v === 'warn' || v === 'error' ? v : 'info');

// level 是否不低于 min
export const atLeast = (level: LogLevel, min: LogLevel): boolean => RANK[level] >= RANK[min];

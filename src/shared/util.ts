// 主进程、组件进程、页面都用的小函数：外部输入的收窄、错误转文字、系统语言对到界面语言。

import { LOCALES, type Locale } from './types.ts';

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const isLocale = (v: unknown): v is Locale => (LOCALES as readonly unknown[]).includes(v);

// 抛出的值 → 错误文字
export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

// 系统语言(BCP 47) → 界面语言：繁体地区用繁体，其他中文用简体，不支持的用英语
export function matchLocale(tag: string): Locale {
  const l = tag.toLowerCase();
  if (l.startsWith('zh')) return /hant|tw|hk|mo/.test(l) ? 'zh-Hant' : 'zh-Hans';
  if (l.startsWith('ja')) return 'ja';
  if (l.startsWith('ko')) return 'ko';
  return 'en';
}

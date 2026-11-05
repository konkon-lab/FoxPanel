// 主窗口多语言：简体中文、繁体中文、日语、英语、韩语；设置为「跟随系统」时按系统语言选择。
// 宿主自己的文案在 ./core.ts；组件的文案由组件用 ctx.i18n.define 加进来。

import { computed, reactive } from 'vue';
import { store } from '../store.ts';
import { LOCALES, type Locale } from '../../shared/types.ts';
import { isLocale, isObject, matchLocale } from '../../shared/util.ts';
import core from './core.ts';

// 宿主自己的文案的键
type KeysOf<B> = B extends Record<Locale, Record<infer K, string>> ? K : never;
type MessageKey = KeysOf<typeof core>;

// 各语言的文案表；组件加进来的也在这里，加了之后界面跟着更新
const MESSAGES = reactive(Object.fromEntries(LOCALES.map(l => [l, { ...core[l] } as Record<string, string>]))) as Record<Locale, Record<string, string>>;

// 加一种语言的文案(同名键覆盖)；不认识的语言忽略，值不是字符串的键跳过
export function define(lang: unknown, messages: unknown): void {
  if (!isLocale(lang) || !isObject(messages)) return;
  const table = MESSAGES[lang];
  for (const [k, v] of Object.entries(messages)) if (typeof v === 'string') table[k] = v;
}

export const locale = computed<Locale>(() => {
  const s = store.settings.language;
  return s === 'system' ? matchLocale(navigator.language) : s;
});

// 取文案；{name} 用 params 替换；当前语言没有的用简体中文，都没有时返回键
export function t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
  return text(key, params);
}

// 组件用的取文案：键不限于宿主的
export function text(key: string, params?: Readonly<Record<string, string | number>>): string {
  const s = MESSAGES[locale.value][key] ?? MESSAGES['zh-Hans'][key] ?? key;
  return params ? s.replace(/\{(\w+)\}/g, (_m, k: string) => String(params[k] ?? '')) : s;
}

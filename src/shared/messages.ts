// 文案表：zh 定义键(简体中文)，others 必须给出同样的键。宿主外壳和组件的 locales.ts 都用它。
import type { Locale } from './types.ts';

export type Messages<K extends string = string> = Record<Locale, Record<K, string>>;

export function defineMessages<K extends string>(zh: Record<K, string>, others: Record<Exclude<Locale, 'zh-Hans'>, Record<K, string>>): Messages<K> {
  return { 'zh-Hans': zh, ...others };
}

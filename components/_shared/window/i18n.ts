// 预装主窗口组件的文案：注册到宿主(ctx.i18n.define)，只收已有键的 t，类别名，把一条文案取成各语言的 Text。
import { t as hostT } from '@konkon-lab/foxpanel-window';
import type { ComponentKind, Messages, Text, WindowContext } from '@konkon-lab/foxpanel-sdk';
import shared from './locales.ts';

type Params = Readonly<Record<string, string | number>>;
type KeysOf<M> = M extends Messages<infer K> ? K : never;

// 把几组文案的每种语言都注册到宿主
export function defineAll(ctx: WindowContext, ...bundles: Messages[]): void {
  for (const b of bundles) for (const [lang, messages] of Object.entries(b)) ctx.i18n.define(lang as keyof Messages, messages);
}

// 只收这几组文案里的键的 t
export function typedT<B extends Messages[]>(..._bundles: B): (key: KeysOf<B[number]>, params?: Params) => string {
  return (key, params) => hostT(key, params);
}

// 共用代码自己用的 t
export const t = typedT(shared);

// 组件类别的名字(共用文案里的 comp.kind.*；少一个类别时类型检查报错)
export const kindName = (kind: ComponentKind): string => t(`comp.kind.${kind}`);

// 文案表里的一条在各语言下的文字(页面标题这类要 Text 的地方用)
export function textFrom<K extends string>(bundle: Messages<K>, key: K): Text {
  return Object.fromEntries(Object.entries(bundle).map(([lang, messages]) => [lang, messages[key]]));
}

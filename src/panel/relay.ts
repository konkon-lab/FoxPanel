// 面板页面和媒体页面里的远程服务(ctx.relay)：只能用，不能提供。每个名字向宿主订阅一次，这一页的组件共用；
// 状态是 Vue 响应式的，宿主推来新状态时只给内容变了的字段赋值，内容没变的字段不触发依赖它的计算和渲染。

import { reactive, shallowRef, toRaw } from 'vue';
import type { RelayService } from '@konkon-lab/foxpanel-sdk';
import { relayOver, type RemoteCore } from '../shared/component-services.ts';
import type { PageApi } from '../shared/types.ts';
import { isObject } from '../shared/util.ts';

// 这里用到的 window.fox 接口
export type RelayApi = Pick<PageApi, 'relayUse' | 'relayCall' | 'onRelay'>;

// 两个 JSON 值(基本类型、数组、普通对象)内容相同
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every(k => Object.hasOwn(b, k) && sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

// next 的每个字段整个替换 target(reactive 对象)的同名字段；内容相同的字段不赋值
export function applySnapshot<T extends object>(target: T, next: T): void {
  const current = toRaw(target);
  for (const key of Object.keys(next) as (keyof T)[]) {
    if (!sameValue(current[key], next[key])) target[key] = next[key];
  }
}

// 把 next 写进 target(reactive 对象)：内容变了的字段赋值，next 里没有的字段删掉
function patch(target: Record<string, unknown>, next: Record<string, unknown>): void {
  applySnapshot(target, next);
  for (const key of Object.keys(toRaw(target))) if (!Object.hasOwn(next, key)) delete target[key];
}

// failed：订阅或不等结果的调用被宿主拒绝、状态回调抛出异常时调，what 是当时在做的事
export function createRelay(fox: RelayApi, failed: (what: string, e: unknown) => void): RelayService {
  const remotes = new Map<string, { core: RemoteCore; apply(state: unknown): void }>();   // 服务名 → 这一页订阅了的远程服务
  fox.onRelay((name, state) => remotes.get(name)?.apply(state));

  const use = (name: string): RemoteCore => {
    const had = remotes.get(name);
    if (had) return had.core;
    const box = shallowRef<unknown>(null);   // 状态；是对象时放的是 reactive 对象
    const watchers = new Set<{ fn: (state: unknown) => void }>();
    const apply = (next: unknown): void => {
      const current = box.value;
      if (isObject(current) && isObject(next)) patch(current, next);
      else box.value = isObject(next) ? reactive(next) : next ?? null;
      for (const w of [...watchers]) {
        try {
          w.fn(box.value);
        } catch (e) {
          failed(`relay ${name}`, e);
        }
      }
    };
    const core: RemoteCore = {
      state: () => box.value,
      watch(fn) {
        const w = { fn };
        watchers.add(w);
        return () => { watchers.delete(w); };
      },
      call: (method, args) => fox.relayCall(name, method, args, true),
      tell: (method, args) => { fox.relayCall(name, method, args, false).catch((e: unknown) => failed(`relay ${name}.${method}`, e)); },
    };
    remotes.set(name, { core, apply });
    fox.relayUse(name, true).catch((e: unknown) => failed(`relay ${name}`, e));
    return core;
  };

  return relayOver(use, () => {
    throw new Error('页面里的组件不能提供远程服务');
  });
}

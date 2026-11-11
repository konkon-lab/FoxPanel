// 组件页各处操作共用的出错提示：最近一次操作的错误(浮在右栏上方)，和把操作结果记到它上面的包装。

import { ref } from 'vue';
import { fox } from '@konkon-lab/foxpanel-window';
import type { ComponentPatch, ComponentResult } from '@konkon-lab/foxpanel-sdk';

// 最近一次操作的错误，空 = 没有
export const lastError = ref('');

// 等一个操作做完：开始时清掉上一次的错误，出错时记到 lastError；返回是否成功
export async function run(op: Promise<ComponentResult>): Promise<boolean> {
  lastError.value = '';
  const r = await op;
  if (!r.ok) lastError.value = r.error;
  return r.ok;
}

// 改组件设置
export const patch = (p: ComponentPatch): Promise<boolean> => run(fox.compSet(p));

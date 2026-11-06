// 主窗口里的账本：主进程推来的整本账，和按哪一天算「今天」(都是响应式的)
import { shallowReactive, shallowRef } from 'vue';
import type { UsageBook } from '@konkon-lab/foxpanel-sdk';

export const ledger = shallowReactive<{ book: UsageBook }>({ book: {} });

// 今天：本地日期变了才更新(window.ts 定时比对)
export const today = shallowRef(new Date());

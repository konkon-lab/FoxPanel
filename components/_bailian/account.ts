// 三个百炼组件共用：从组件设置里取密钥和接口地址(密钥、域名是阿里云组件的设置，核心并进 requires 它的组件的设置里)，记一笔用量。

import type { MainContext } from '@konkon-lab/foxpanel-sdk';
import { bailianUrls, type BailianUrls } from './endpoints.ts';

// 没填密钥时的日志和报错
export const NO_KEY = 'bailian api key not set';

export function bailianAccount(config: Record<string, unknown>): { key: string; urls: BailianUrls } {
  return { key: String(config['apiKey'] ?? ''), urls: bailianUrls(String(config['domain'] ?? '')) };
}

// 记一笔用量；cost 为 undefined = 不知道价格。要传调用方组件自己的 ctx，用量服务按它认出是哪个组件
export function recordUsage(ctx: MainContext, item: string, amount: Record<string, number>, cost: number | undefined): void {
  ctx.get('usage')?.add(cost === undefined ? { item, amount } : { item, amount, cost });
}

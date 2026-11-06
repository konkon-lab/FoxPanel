// 用量账本的计算：日期、累计的合并、按组件和天汇总、读进来的账本的收窄(类型在 SDK)。
import type { UsageBook, UsageTotal } from '@konkon-lab/foxpanel-sdk';
import { dayOf, isObject } from '../../_shared/util.ts';

// 截至 to 的 n 天日期，按时间升序
export function lastDays(to: Date, n: number): string[] {
  return Array.from({ length: n }, (_, i) => dayOf(new Date(to.getFullYear(), to.getMonth(), to.getDate() - (n - 1 - i))));
}

// to 所在月从 1 号到 to 的日期
export const monthDays = (to: Date): string[] => lastDays(to, to.getDate());

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 只留值是有限数字的键
export function finiteNumbers(o: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(Object.entries(o).filter((x): x is [string, number] => isFiniteNumber(x[1])));
}

// b 并进累计 a：各用量、次数相加；费用有一边不知道价格就整项按「不知道」算
export function mergeTotal(a: UsageTotal | undefined, b: UsageTotal): UsageTotal {
  const amount = { ...a?.amount };
  for (const [k, v] of Object.entries(b.amount)) amount[k] = (amount[k] ?? 0) + v;
  return { amount, calls: (a?.calls ?? 0) + b.calls, cost: a?.cost === null || b.cost === null ? null : (a?.cost ?? 0) + b.cost };
}

// 几天里一个组件的汇总：各 item 的累计和总费用(不知道价格的项不算进总费用)
export function summarize(book: UsageBook, days: readonly string[], id: string): { items: Record<string, UsageTotal>; cost: number } {
  const items: Record<string, UsageTotal> = {};
  for (const day of days) {
    for (const [item, t] of Object.entries(book[day]?.[id] ?? {})) items[item] = mergeTotal(items[item], t);
  }
  const cost = Object.values(items).reduce((s, t) => s + (t.cost ?? 0), 0);
  return { items, cost };
}

// 一天里各组件的费用
export function dayCosts(book: UsageBook, day: string): Record<string, number> {
  return Object.fromEntries(Object.entries(book[day] ?? {}).map(([id, items]) => [id, Object.values(items).reduce((s, t) => s + (t.cost ?? 0), 0)]));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

// 对象的各项经 each 收窄，each 返回 null 的丢掉；raw 不是对象时为空
function mapEntries<T>(raw: unknown, each: (value: unknown, key: string) => T | null): Record<string, T> {
  const out: [string, T][] = [];
  for (const [key, value] of Object.entries(isObject(raw) ? raw : {})) {
    const v = each(value, key);
    if (v !== null) out.push([key, v]);
  }
  return Object.fromEntries(out);
}

// 一项累计：amount 里不是有限数字的键丢掉；calls、cost 不对时整项为 null
function parseTotal(raw: unknown): UsageTotal | null {
  if (!isObject(raw) || !isObject(raw['amount']) || !isFiniteNumber(raw['calls'])) return null;
  const cost = raw['cost'];
  if (cost !== null && !isFiniteNumber(cost)) return null;
  return { amount: finiteNumbers(raw['amount']), calls: raw['calls'], cost };
}

// 外面来的账本(usage.json、总线上收到的)：只留「日期 → 组件 → 项 → 累计」里格式对的部分
export function parseBook(raw: unknown): UsageBook {
  return mapEntries(raw, (comps, day) => (DAY.test(day) && isObject(comps)
    ? mapEntries(comps, items => (isObject(items) ? mapEntries(items, parseTotal) : null))
    : null));
}

// 仪表盘费用卡片和「用量」一节的数据：从账本按组件算今天、昨天、近 RECENT_DAYS 天和本月的费用，一个组件的主要用量。

import { computed } from 'vue';
import { amount, componentName, locale, money, store, textOf } from '@konkon-lab/foxpanel-window';
import { dayCosts, lastDays, monthDays, summarize } from './book.ts';
import { ledger, today } from './state.ts';

// 系列颜色，按本月费用从高到低分配
const COLORS = ['#4f5bd5', '#eb6834', '#1baf7a', '#2a78d6', '#c4335f', '#9a5b00', '#7a8290'];
const RECENT_DAYS = 14;   // 柱形图的天数(文案 cost.recentTitle / cost.recentAria 里写的也是 14)

export interface Series {
  id: string;
  name: string;
  color: string;
}

const sumOf = (o: Record<string, number>): number => Object.values(o).reduce((s, v) => s + v, 0);

export const cost = computed(() => {
  const now = today.value;
  const recent = lastDays(now, RECENT_DAYS);
  const month = monthDays(now);
  const [yesterdayKey, todayKey] = lastDays(now, 2) as [string, string];
  // 本月和近 RECENT_DAYS 天(今天、昨天都在里面)每天各组件的费用
  const costs = new Map([...new Set([...month, ...recent])].map(day => [day, dayCosts(ledger.book, day)]));
  const byDay = (day: string): Record<string, number> => costs.get(day) ?? {};
  const totalOf = (day: string): number => sumOf(byDay(day));

  const monthBy: Record<string, number> = {};   // 本月各组件的费用
  for (const day of month) for (const [id, v] of Object.entries(byDay(day))) monthBy[id] = (monthBy[id] ?? 0) + v;
  // 系列：这些天里有费用的组件，按本月费用从高到低
  const spenders = new Set<string>();
  for (const by of costs.values()) for (const [id, v] of Object.entries(by)) if (v > 0) spenders.add(id);
  const series: Series[] = [...spenders].sort((a, b) => (monthBy[b] ?? 0) - (monthBy[a] ?? 0))
    .map((id, i) => ({ id, name: componentName(id, locale.value), color: COLORS[i % COLORS.length] ?? '#7a8290' }));

  let running = 0;
  const cumulative = month.map(day => (running += totalOf(day)));
  const daily = running / month.length;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  return {
    series,
    currency: store.comps.rows.find(r => r.usage)?.usage?.currency ?? 'CNY',
    today: { by: byDay(todayKey), total: totalOf(todayKey) },
    yesterday: totalOf(yesterdayKey),
    recent: recent.map(day => ({ day, by: byDay(day), total: totalOf(day) })),
    month: { total: running, daily, projected: daily * daysInMonth, cumulative, daysInMonth, by: monthBy },
  };
});

// 金额：币种取第一个声明了用量的组件的，默认 2 位小数
export const price = (v: number, digits = 2): string => money(v, cost.value.currency, digits);

// 一个组件几天里的费用和主要用量。主要用量如「1,240 字」：各项按单位合计(次数记在 calls 上)，取清单 usage.units 里有的第一个单位；
// 组件没声明用量或这几天没有用量时为空
export function usageOf(id: string, days: readonly string[]): { cost: number; main: string } {
  const { items, cost } = summarize(ledger.book, days, id);
  const units = store.comps.rows.find(r => r.id === id)?.usage?.units ?? {};
  const totals: Record<string, number> = {};
  for (const t of Object.values(items)) {
    for (const [k, v] of Object.entries(t.amount)) totals[k] = (totals[k] ?? 0) + v;
    totals['calls'] = (totals['calls'] ?? 0) + t.calls;
  }
  const first = Object.entries(totals).find(([k]) => k in units);
  return { cost, main: first ? `${amount(first[1])} ${textOf(units[first[0]]!, locale.value)}` : '' };
}

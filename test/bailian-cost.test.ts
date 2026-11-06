import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import type { ComponentRow, UsageBook, UsageTotal } from '@konkon-lab/foxpanel-sdk';
import { locale, store, textOf } from './window-a-stub.ts';
import { ledger, today } from '../components/aliyun/src/state.ts';
import { amount, money } from '../src/renderer/money.ts';
import type { Locale } from '../src/shared/types.ts';

// cost.ts 从 @konkon-lab/foxpanel-window 取的东西：store、locale、textOf 是 window-a-stub.ts 的，金额和用量数字是宿主的实现，组件名照宿主的规则(没有这个组件时是 id)
export { amount, locale, money, store, textOf };
export const componentName = (id: string, lang: Locale): string => {
  const row = store.comps.rows.find(r => r.id === id);
  return row ? textOf(row.name, lang) : id;
};

// 之后加载的模块里的 @konkon-lab/foxpanel-window 解析到本文件(排在 window-a-stub.ts 的钩子前面)；cost.ts 在各条测试里用 import() 加载
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@konkon-lab/foxpanel-window') return { url: import.meta.url, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
const load = () => import('../components/aliyun/src/cost.ts');

const total = (amount: Record<string, number>, calls: number, cost: number | null): UsageTotal => ({ amount, calls, cost });

// 账本：10 月 20 日到 11 月 5 日；有不知道价格的项(cost 为 null)、费用是 0 的组件(d.zero)、清单里没有的组件(x.old、g.gone、d.zero)
const BOOK: UsageBook = {
  '2026-10-20': { 'x.old': { m: total({ chars: 9 }, 1, 7) }, 'a.tts': { 'v3-flash': total({ chars: 100 }, 1, 3) } },
  '2026-10-25': { 'a.tts': { 'v3-flash': total({ chars: 4000 }, 9, 0.5) }, 'c.asr': { 'fun-asr': total({ seconds: 600 }, 2, 1.5) } },
  '2026-10-30': { 'g.gone': { m: total({ chars: 1 }, 1, 0.5) } },
  '2026-11-01': { 'a.tts': { 'v3-flash': total({ chars: 2000 }, 5, 0.25) }, 'b.mt': { qwen: total({ input: 900, output: 700 }, 6, 2) } },
  '2026-11-03': { 'b.mt': { qwen: total({ input: 100, output: 80 }, 1, 0.25), other: total({ input: 5, output: 5 }, 1, null) }, 'd.zero': { m: total({ chars: 3 }, 1, 0) } },
  '2026-11-04': { 'a.tts': { 'v3-flash': total({ chars: 1000 }, 2, 0.125) }, 'b.mt': { qwen: total({ input: 50, output: 40 }, 1, 0.125) } },
  '2026-11-05': {
    'a.tts': { 'v3-flash': total({ chars: 1240 }, 3, 0.125), mine: total({ chars: 60 }, 1, null) },
    'b.mt': { qwen: total({ input: 300, output: 180.5 }, 4, 0.0625) },
    'e.free': { m: total({ seconds: 12.34 }, 2, null) },
  },
};

const row = (id: string, name: ComponentRow['name'], usage?: ComponentRow['usage']): ComponentRow => ({ id, name, ...(usage ? { usage } : {}) }) as ComponentRow;
// 组件清单：第一个没声明用量；声明了用量的第一个(a.tts)的币种是美元
const ROWS = [
  row('h.plain', '没有用量'),
  row('a.tts', { 'zh-Hans': '语音合成', en: 'TTS' }, { currency: 'USD', units: { calls: '句', chars: { 'zh-Hans': '字符', en: 'chars' } } }),
  row('b.mt', '翻译', { currency: 'CNY', units: { input: '输入 Token', output: '输出 Token' } }),
  row('c.asr', '语音输入', { currency: 'CNY', units: { calls: '次' } }),
  row('e.free', '免费的', { currency: 'CNY', units: { seconds: '秒' } }),
];

// 给定「今天」、账本和组件清单
function setup(now: Date, book: UsageBook = BOOK, rows: ComponentRow[] = ROWS): void {
  store.comps.rows = rows;
  ledger.book = book;
  today.value = now;
}

// 没有用量的一天
const quiet = (day: string): { day: string; by: Record<string, number>; total: number } => ({ day, by: {}, total: 0 });

test('费用汇总：系列按本月费用从高到低，今天、昨天、近 14 天、本月各项', async () => {
  const { cost, price } = await load();
  setup(new Date(2026, 10, 5, 12));
  const c = cost.value;
  // 本月没有费用的(c.asr、g.gone 只在 10 月有)排在后面，按日期先后；费用是 0 的、只有不知道价格的项的不算系列
  assert.deepEqual(c.series, [
    { id: 'b.mt', name: '翻译', color: '#4f5bd5' },
    { id: 'a.tts', name: '语音合成', color: '#eb6834' },
    { id: 'c.asr', name: '语音输入', color: '#1baf7a' },
    { id: 'g.gone', name: 'g.gone', color: '#2a78d6' },
  ]);
  assert.equal(c.currency, 'USD');
  assert.deepEqual(c.today, { by: { 'a.tts': 0.125, 'b.mt': 0.0625, 'e.free': 0 }, total: 0.1875 });
  assert.equal(c.yesterday, 0.25);
  assert.deepEqual(c.recent, [
    quiet('2026-10-23'),
    quiet('2026-10-24'),
    { day: '2026-10-25', by: { 'a.tts': 0.5, 'c.asr': 1.5 }, total: 2 },
    quiet('2026-10-26'),
    quiet('2026-10-27'),
    quiet('2026-10-28'),
    quiet('2026-10-29'),
    { day: '2026-10-30', by: { 'g.gone': 0.5 }, total: 0.5 },
    quiet('2026-10-31'),
    { day: '2026-11-01', by: { 'a.tts': 0.25, 'b.mt': 2 }, total: 2.25 },
    quiet('2026-11-02'),
    { day: '2026-11-03', by: { 'b.mt': 0.25, 'd.zero': 0 }, total: 0.25 },
    { day: '2026-11-04', by: { 'a.tts': 0.125, 'b.mt': 0.125 }, total: 0.25 },
    { day: '2026-11-05', by: { 'a.tts': 0.125, 'b.mt': 0.0625, 'e.free': 0 }, total: 0.1875 },
  ]);
  assert.deepEqual(c.month, {
    total: 2.9375,
    daily: 0.5875,
    projected: 17.625,
    cumulative: [2.25, 2.25, 2.5, 2.75, 2.9375],
    daysInMonth: 30,
    by: { 'a.tts': 0.5, 'b.mt': 2.4375, 'd.zero': 0, 'e.free': 0 },
  });
  assert.equal(price(2.5), '$2.50');
  assert.equal(price(0.125), '$0.13');
  assert.equal(price(0.125, 3), '$0.125');

  // 清单里一个组件都没有：币种按人民币，系列的名字是 id
  store.comps.rows = [];
  assert.equal(cost.value.currency, 'CNY');
  assert.deepEqual(cost.value.series.map(s => s.name), ['b.mt', 'a.tts', 'c.asr', 'g.gone']);
  assert.equal(price(2.5), '¥2.50');
});

test('一个组件几天里的费用和主要用量：取清单声明了的第一个单位，没声明或没有用量时为空', async () => {
  const { usageOf } = await load();
  setup(new Date(2026, 10, 5, 12));
  // 各项的字符数相加；不知道价格的项不算进费用
  assert.deepEqual(usageOf('a.tts', ['2026-11-05']), { cost: 0.125, main: `${amount(1300)} 字符` });
  assert.deepEqual(usageOf('b.mt', ['2026-11-05']), { cost: 0.0625, main: `${amount(300)} 输入 Token` });
  assert.deepEqual(usageOf('b.mt', ['2026-11-03', '2026-11-04', '2026-11-05']), { cost: 0.4375, main: `${amount(455)} 输入 Token` });
  assert.deepEqual(usageOf('e.free', ['2026-11-05']), { cost: 0, main: `${amount(12.34)} 秒` });
  // 只声明了次数
  assert.deepEqual(usageOf('c.asr', ['2026-10-25']), { cost: 1.5, main: `${amount(2)} 次` });
  assert.deepEqual(usageOf('c.asr', ['2026-11-05']), { cost: 0, main: '' });
  assert.deepEqual(usageOf('g.gone', ['2026-10-30']), { cost: 0.5, main: '' });
  assert.deepEqual(usageOf('h.plain', ['2026-11-05']), { cost: 0, main: '' });
  assert.deepEqual(usageOf('missing', ['2026-11-05']), { cost: 0, main: '' });
});

test('费用汇总：「今天」跨月、账本更新后重算', async () => {
  const { cost } = await load();
  setup(new Date(2026, 9, 31, 23, 59));
  const october = cost.value;
  assert.deepEqual(october.series.map(s => s.id), ['x.old', 'a.tts', 'c.asr', 'g.gone']);
  assert.deepEqual(october.today, { by: {}, total: 0 });
  assert.equal(october.yesterday, 0.5);
  assert.deepEqual(october.recent.map(d => d.day), [
    '2026-10-18', '2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24',
    '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31',
  ]);
  assert.deepEqual(october.recent.filter(d => d.total > 0), [
    { day: '2026-10-20', by: { 'x.old': 7, 'a.tts': 3 }, total: 10 },
    { day: '2026-10-25', by: { 'a.tts': 0.5, 'c.asr': 1.5 }, total: 2 },
    { day: '2026-10-30', by: { 'g.gone': 0.5 }, total: 0.5 },
  ]);
  assert.deepEqual(october.month, {
    total: 12.5,
    daily: 12.5 / 31,
    projected: 12.5,
    cumulative: [...Array<number>(19).fill(0), ...Array<number>(5).fill(10), ...Array<number>(5).fill(12), 12.5, 12.5],
    daysInMonth: 31,
    by: { 'x.old': 7, 'a.tts': 3.5, 'c.asr': 1.5, 'g.gone': 0.5 },
  });

  // 过了零点是 11 月 1 日：本月只有这一天，系列按 11 月的费用排，10 月的排在后面
  today.value = new Date(2026, 10, 1);
  const november = cost.value;
  assert.deepEqual(november.series, [
    { id: 'b.mt', name: '翻译', color: '#4f5bd5' },
    { id: 'a.tts', name: '语音合成', color: '#eb6834' },
    { id: 'x.old', name: 'x.old', color: '#1baf7a' },
    { id: 'c.asr', name: '语音输入', color: '#2a78d6' },
    { id: 'g.gone', name: 'g.gone', color: '#c4335f' },
  ]);
  assert.deepEqual(november.today, { by: { 'a.tts': 0.25, 'b.mt': 2 }, total: 2.25 });
  assert.equal(november.yesterday, 0);
  assert.equal(november.recent[0]?.day, '2026-10-19');
  assert.deepEqual(november.recent.at(-1), { day: '2026-11-01', by: { 'a.tts': 0.25, 'b.mt': 2 }, total: 2.25 });
  assert.deepEqual(november.month, { total: 2.25, daily: 2.25, projected: 67.5, cumulative: [2.25], daysInMonth: 30, by: { 'a.tts': 0.25, 'b.mt': 2 } });

  // 账本清空
  ledger.book = {};
  assert.deepEqual(cost.value.series, []);
  assert.deepEqual(cost.value.today, { by: {}, total: 0 });
  assert.deepEqual(cost.value.month, { total: 0, daily: 0, projected: 0, cumulative: [0], daysInMonth: 30, by: {} });
});

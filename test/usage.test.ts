import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dayCosts, lastDays, parseBook, summarize } from '../components/aliyun/src/book.ts';
import { UsageMeter } from '../components/aliyun/src/meter.ts';
import { tickStep } from '../components/aliyun/src/ticks.ts';
import { money } from '../src/renderer/money.ts';

test('用量：按天、组件、项累计，次数自增；有一笔不知道价格就整项不算钱；坏数据忽略', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-usage-'));
  try {
    const file = path.join(dir, 'usage.json');
    let changes = 0;
    const m = new UsageMeter(file, () => changes++);
    const d1 = new Date(2026, 9, 27, 12);
    const d2 = new Date(2026, 9, 28, 12);
    m.add('a.tts', { item: 'v3-flash', amount: { chars: 10 }, cost: 0.001 }, d1);
    m.add('a.tts', { item: 'v3-flash', amount: { chars: 20 }, cost: 0.002 }, d2);
    m.add('a.tts', { item: 'mine', amount: { chars: 5 } }, d2);
    m.add('a.mt', { item: 'qwen', amount: { input: 100, output: 50, junk: Number.NaN }, cost: 0.0003 }, d2);
    m.add('a.mt', { item: '', amount: {} }, d2);
    m.add('a.mt', 'bad', d2);
    m.add('a.mt', { item: 'qwen', amount: [1, 2] }, d2);
    assert.equal(changes, 4);
    const days = lastDays(d2, 2);
    assert.deepEqual(days, ['2026-10-27', '2026-10-28']);
    const tts = summarize(m.book, days, 'a.tts');
    assert.deepEqual(tts.items['v3-flash'], { amount: { chars: 30 }, calls: 2, cost: 0.003 });
    assert.deepEqual(tts.items['mine'], { amount: { chars: 5 }, calls: 1, cost: null });
    assert.equal(tts.cost, 0.003);
    assert.deepEqual(summarize(m.book, days, 'a.mt').items['qwen']?.amount, { input: 100, output: 50 });
    assert.deepEqual(dayCosts(m.book, '2026-10-28'), { 'a.tts': 0.002, 'a.mt': 0.0003 });
    m.flush();
    assert.equal(new UsageMeter(file, () => undefined).book['2026-10-28']?.['a.tts']?.['v3-flash']?.calls, 1);
    m.removeAll('a.tts');
    assert.equal(summarize(m.book, days, 'a.tts').cost, 0);
    assert.ok(m.book['2026-10-28']?.['a.mt']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('用量文件：格式对的原样读回；结构不对的天、组件、项读进来时丢掉，之后记账和汇总照常', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-usage-'));
  try {
    const file = path.join(dir, 'usage.json');
    const good = {
      '2026-10-27': { 'a.tts': { 'v3-flash': { amount: { chars: 10 }, calls: 1, cost: 0.001 }, mine: { amount: {}, calls: 2, cost: null } }, 'a.gone': {} },
      '2026-10-28': {},
    };
    fs.writeFileSync(file, JSON.stringify(good));
    const kept = new UsageMeter(file, () => undefined);
    assert.deepEqual(kept.book, good);
    kept.flush();
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify(good));

    fs.writeFileSync(file, JSON.stringify({
      '2026-10-27': 5,
      'not a day': { 'a.tts': { m: { amount: { chars: 1 }, calls: 1, cost: 0 } } },
      '2026-10-28': {
        'a.tts': {
          ok: { amount: { chars: 10, junk: 'x' }, calls: 1, cost: 0.5 },
          noAmount: { calls: 1, cost: 0 },
          badCalls: { amount: {}, calls: '1', cost: 0 },
          badCost: { amount: {}, calls: 1 },
        },
        'a.mt': [1, 2],
      },
    }));
    const m = new UsageMeter(file, () => undefined);
    assert.deepEqual(m.book, { '2026-10-28': { 'a.tts': { ok: { amount: { chars: 10 }, calls: 1, cost: 0.5 } } } });
    m.add('a.mt', { item: 'qwen', amount: { input: 1 } }, new Date(2026, 9, 28, 12));
    m.flush();
    assert.deepEqual(summarize(m.book, ['2026-10-27', '2026-10-28'], 'a.tts'), { items: { ok: { amount: { chars: 10 }, calls: 1, cost: 0.5 } }, cost: 0.5 });
    assert.deepEqual(dayCosts(m.book, '2026-10-28'), { 'a.tts': 0.5, 'a.mt': 0 });

    for (const bad of ['[1,2]', '"text"', 'null', '{坏的']) {
      fs.writeFileSync(file, bad);
      assert.deepEqual(new UsageMeter(file, () => undefined).book, {});
    }
    assert.deepEqual(parseBook(undefined), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('用量文件：写盘时只留最近 400 个有记录的日子，隔多久记一次不影响', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-usage-'));
  try {
    const file = path.join(dir, 'usage.json');
    const m = new UsageMeter(file, () => undefined);
    // 每 7 天记一笔，共 402 个日子(跨七年多)
    for (let i = 0; i < 402; i++) m.add('a.tts', { item: 'm', amount: { chars: 1 } }, new Date(2019, 0, 1 + i * 7, 12));
    const days = Object.keys(m.book).sort();
    m.flush();
    assert.deepEqual(Object.keys(new UsageMeter(file, () => undefined).book).sort(), days.slice(2));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// 对照：柱形图组件里刻度间隔和标签小数位的算法
const REFERENCE_STEPS = [1, 2, 2.5, 5];
function referenceLabels(max: number): string[] {
  const target = max / 2;
  const base = 10 ** Math.floor(Math.log10(target));
  const step = max > 0 ? base * (REFERENCE_STEPS.filter(s => s * base <= target).at(-1) ?? 1) : 0.05;
  const digits = Number.isInteger(Math.round(step * 1000) / 100) ? 1 : 2;
  return [step, step * 2].map(v => money(v, 'CNY', digits));
}

test('费用柱形图的刻度：间隔是不超过最大值一半的最大整档，两条刻度的标签 1 或 2 位小数', () => {
  const labels = (max: number): string[] => {
    const { step, digits } = tickStep(max);
    return [step, step * 2].map(v => money(v, 'CNY', digits));
  };
  assert.deepEqual(labels(0), ['¥0.05', '¥0.10']);
  assert.deepEqual(labels(0.0005), ['¥0.0', '¥0.0']);
  assert.deepEqual(labels(0.003), ['¥0.00', '¥0.00']);
  assert.deepEqual(labels(0.008), ['¥0.00', '¥0.01']);
  assert.deepEqual(labels(0.012), ['¥0.01', '¥0.01']);
  assert.deepEqual(labels(0.03), ['¥0.01', '¥0.02']);
  assert.deepEqual(labels(0.05), ['¥0.03', '¥0.05']);
  assert.deepEqual(labels(0.09), ['¥0.03', '¥0.05']);
  assert.deepEqual(labels(0.12), ['¥0.05', '¥0.10']);
  assert.deepEqual(labels(0.25), ['¥0.1', '¥0.2']);
  assert.deepEqual(labels(0.4), ['¥0.2', '¥0.4']);
  assert.deepEqual(labels(0.6), ['¥0.25', '¥0.50']);
  assert.deepEqual(labels(1.5), ['¥0.5', '¥1.0']);
  assert.deepEqual(labels(3), ['¥1.0', '¥2.0']);
  assert.deepEqual(labels(6), ['¥2.5', '¥5.0']);
  assert.deepEqual(labels(12), ['¥5.0', '¥10.0']);
  assert.deepEqual(labels(60), ['¥25.0', '¥50.0']);
  assert.deepEqual(labels(480), ['¥200.0', '¥400.0']);
  assert.deepEqual(labels(2600), ['¥1000.0', '¥2000.0']);
  for (let max = 0.0001; max < 100000; max *= 1.003) {
    const { step } = tickStep(max);
    assert.ok(step * 2 <= max + 1e-12 && step * 5 > max, `间隔 ${step} 对不上最大值 ${max}`);
    assert.deepEqual(labels(max), referenceLabels(max), `最大值 ${max} 的标签`);
  }
});

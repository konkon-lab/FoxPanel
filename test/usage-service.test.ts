import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Context, type Plugin } from 'cordis';
import usagePlugin from '../components/aliyun/src/main.ts';
import { BOOK, REMOVED } from '../components/aliyun/src/channels.ts';
import { BUS_COMPONENT_REMOVED } from '../src/shared/types.ts';
import type { UsageBook } from '@konkon-lab/foxpanel-sdk';

test('用量服务：按调用方组件 id 记账，账本经总线推出；核心通知组件卸载了就删掉它的用量；停用时写盘', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-usage-'));
  const sent: [string, unknown][] = [];
  const listeners = new Map<string, (data: unknown) => void>();
  const bus = {
    send: (channel: string, data?: unknown): void => { sent.push([channel, data]); },
    on: (channel: string, fn: (data: unknown) => void): (() => void) => { listeners.set(channel, fn); return () => listeners.delete(channel); },
  };
  const root = new Context();
  const fiber = await root.extend({ id: 'yanuo.aliyun', dataDir: dir, bus }).plugin(usagePlugin as Plugin);
  const caller = (id: string): Plugin => ({
    name: id,
    inject: ['usage'],
    apply(ctx: Context & { usage: { add(e: unknown): void } }) {
      ctx.usage.add({ item: 'm', amount: { chars: 10 }, cost: 0.5 });
    },
  });
  await root.extend({ id: 'yanuo.tts' }).plugin(caller('yanuo.tts'));
  await root.extend({ id: 'yanuo.mt' }).plugin(caller('yanuo.mt'));
  assert.equal(sent.length, 1);
  t.mock.timers.tick(1000);
  assert.equal(sent.length, 2);
  const book = sent.filter(([c]) => c === BOOK).at(-1)?.[1] as UsageBook;
  const day = Object.values(book)[0]!;
  assert.deepEqual(Object.keys(day).sort(), ['yanuo.mt', 'yanuo.tts']);
  assert.equal(day['yanuo.tts']?.['m']?.cost, 0.5);
  assert.equal(REMOVED, BUS_COMPONENT_REMOVED);
  listeners.get(REMOVED)?.('yanuo.mt');
  await fiber.dispose();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'), 'utf8')) as UsageBook;
  assert.deepEqual(Object.keys(Object.values(saved)[0]!), ['yanuo.tts']);
  fs.rmSync(dir, { recursive: true, force: true });
});

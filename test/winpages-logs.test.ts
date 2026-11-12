import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import logs from '../components/window-logs/src/main.ts';
import { LogFiles } from '../components/window-logs/src/files.ts';
import { isAfter, readMark, writeMark } from '../components/window-logs/src/mark.ts';
import { atLeast, levelOf } from '../components/window-logs/src/rank.ts';
import type { MainContext } from '../sdk/index.ts';
import type { LogEntry, LogLevel } from '../src/shared/types.ts';

const NOON = new Date().setHours(12, 0, 0, 0);   // 当天中午：各行同一天，不会被当成过期文件
const entry = (id: number, text: string, level: LogLevel = 'warn', time = NOON + id): LogEntry => ({ id, time, level, source: 'yanuo.demo', text });
const tick = (): Promise<void> => new Promise(r => setImmediate(r));

// 日志组件主进程部分用到的那部分上下文：replay 是接上时补发的行，push 模拟宿主推来一批，stop 模拟组件停用
function start(dataDir: string, replay: LogEntry[] = []): { push(lines: LogEntry[]): void; stop(): void } {
  let listener: ((l: LogEntry) => void) | null = null;
  const disposers: (() => void)[] = [];
  const ctx = {
    config: { level: 'warn' },
    dataDir,
    logs: {
      on(fn: (l: LogEntry) => void) {
        for (const l of replay) fn(l);
        listener = fn;
        return () => { listener = null; };
      },
    },
    effect(make: () => () => void) { disposers.push(make()); },
  };
  logs.apply(ctx as unknown as MainContext);
  return {
    push: lines => { for (const l of lines) listener?.(l); },
    stop: () => { for (const d of disposers) d(); },
  };
}

// 日志目录里所有日志文件的各行，不含开头的时间
function written(dataDir: string): string[] {
  const dir = path.join(dataDir, 'logs');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.log')).sort()
    .flatMap(f => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean)).map(l => l.slice(l.indexOf(' ') + 1));
}
const markOf = (dataDir: string): unknown => JSON.parse(fs.readFileSync(path.join(dataDir, 'logs', 'written.json'), 'utf8'));

test('日志等级：设置值收窄，按严重程度比较', () => {
  assert.deepEqual([levelOf('warn'), levelOf('error'), levelOf('info'), levelOf('debug'), levelOf(undefined), levelOf(2)], ['warn', 'error', 'info', 'info', 'info', 'info']);
  assert.ok(atLeast('error', 'warn'));
  assert.ok(atLeast('warn', 'warn'));
  assert.ok(!atLeast('info', 'warn'));
});

test('日志标记：按时间和行号比先后；读不出或格式不对当作没有', () => {
  const m = { time: 1000, id: 5 };
  assert.ok(isAfter(entry(1, 'x', 'info', 1001), m));
  assert.ok(isAfter(entry(6, 'x', 'info', 1000), m));
  assert.ok(!isAfter(entry(5, 'x', 'info', 1000), m));
  assert.ok(!isAfter(entry(9, 'x', 'info', 999), m));
  assert.ok(isAfter(entry(1, 'x', 'info', 0), null));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-mark-'));
  const file = path.join(dir, 'written.json');
  assert.equal(readMark(file), null);
  for (const bad of ['not json', '[1000,5]', 'null', '{"time":"1000","id":5}', '{"time":1000}']) {
    fs.writeFileSync(file, bad);
    assert.equal(readMark(file), null);
  }
  writeMark(file, m);
  assert.deepEqual(readMark(file), m);
  writeMark(path.join(dir, 'missing', 'written.json'), m);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('日志组件：一批行收完落盘一次；重启后补发的行不重复写；停用时把没落盘的写完', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-logs-'));
  const batch = [entry(1, 'first'), entry(2, 'second', 'error'), entry(3, 'below level', 'info')];

  const a = start(dataDir);
  a.push(batch);
  assert.deepEqual(written(dataDir), []);
  assert.ok(!fs.existsSync(path.join(dataDir, 'logs', 'written.json')));
  await tick();
  assert.deepEqual(written(dataDir), ['[W] yanuo.demo first', '[E] yanuo.demo second']);
  assert.deepEqual(markOf(dataDir), { time: NOON + 3, id: 3 });
  a.stop();

  // 组件进程重启：宿主补发内存里的三行，再推一行新的
  const b = start(dataDir, batch);
  b.push([entry(4, 'third')]);
  await tick();
  assert.deepEqual(written(dataDir), ['[W] yanuo.demo first', '[E] yanuo.demo second', '[W] yanuo.demo third']);

  // 没等到落盘就停用
  b.push([entry(5, 'fourth')]);
  b.stop();
  assert.deepEqual(written(dataDir).at(-1), '[W] yanuo.demo fourth');
  assert.deepEqual(markOf(dataDir), { time: NOON + 5, id: 5 });
  b.push([entry(6, 'after stop')]);
  await tick();
  assert.equal(written(dataDir).length, 4);

  // 宿主重启：行号从 1 数起，时间在后的照写
  const c = start(dataDir, [entry(1, 'new host', 'warn', NOON + 100)]);
  await tick();
  assert.deepEqual(written(dataDir).at(-1), '[W] yanuo.demo new host');
  c.stop();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('日志文件：攒着的行一次落盘，各进各的文件(写满换下一个、换了一天换文件)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-logfiles-'));
  const keep = { level: 'info', dir, maxAge: 100000, maxSize: 60 } as const;   // 每行 27 字节，一个文件放两行；日期是写死的，不让它过期
  const at = (day: number): number => new Date(2026, 10, day, 12).getTime();
  const hostLine = (id: number, text: string, day: number): LogEntry => ({ ...entry(id, text, 'info', at(day)), source: '' });
  const read = (name: string): string => fs.readFileSync(path.join(dir, name), 'utf8');

  const files = new LogFiles(keep);
  for (const l of [hostLine(1, 'line one', 20), hostLine(2, 'line two', 20), hostLine(3, 'line 333', 20), hostLine(4, 'line 444', 21)]) files.write(l);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-11-20-2.log', '2026-11-20.log']);   // 换文件时之前攒的行已经落盘，最后一个文件的行还攒着
  files.flush();
  assert.deepEqual(fs.readdirSync(dir).sort(), ['2026-11-20-2.log', '2026-11-20.log', '2026-11-21.log']);
  assert.equal(read('2026-11-20.log'), '12:00:00 [I] host line one\n12:00:00 [I] host line two\n');
  assert.equal(read('2026-11-20-2.log'), '12:00:00 [I] host line 333\n');
  assert.equal(read('2026-11-21.log'), '12:00:00 [I] host line 444\n');

  // 已有的文件接着写，写满的跳过；没有攒着的行时 flush 什么都不做
  const again = new LogFiles(keep);
  again.write(hostLine(5, 'line 555', 20));
  again.flush();
  again.flush();
  assert.equal(read('2026-11-20.log'), '12:00:00 [I] host line one\n12:00:00 [I] host line two\n');
  assert.equal(read('2026-11-20-2.log'), '12:00:00 [I] host line 333\n12:00:00 [I] host line 555\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

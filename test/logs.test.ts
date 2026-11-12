import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LogBook } from '../src/main/logs.ts';
import { LogFiles, type LogFileOptions } from '../components/window-logs/src/files.ts';
import type { LogEntry, LogLevel } from '../src/shared/types.ts';

const opts = (dir: string, extra: Partial<LogFileOptions> = {}): LogFileOptions => ({ level: 'info', dir, maxAge: 14, maxSize: 1024 * 1024, ...extra });
let id = 0;
const line = (text: string, level: LogLevel = 'info'): LogEntry => ({ id: ++id, time: Date.now(), level, source: '', text });

test('日志：每一行都记进内存(不分等级)，新行合并后推一次', async () => {
  const pushed: LogEntry[][] = [];
  const book = new LogBook(lines => pushed.push(lines));
  book.add('', 'started');
  book.add('yanuo.tts', 'synthesize failed', 'warn');
  assert.deepEqual(book.list.map(l => [l.source, l.level, l.text]), [['', 'info', 'started'], ['yanuo.tts', 'warn', 'synthesize failed']]);
  await new Promise(r => setTimeout(r, 400));
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0]?.length, 2);
  book.stop();
});

test('日志文件：太旧的删掉；按天写；低于记录等级的不写；写满接着写下一个', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-log-'));
  fs.writeFileSync(path.join(dir, '2000-01-01.log'), 'old');
  fs.writeFileSync(path.join(dir, '2000-01-01-2.log'), 'old');
  const files = new LogFiles(opts(dir, { level: 'warn', maxSize: 80 }));
  assert.deepEqual(fs.readdirSync(dir), []);
  files.write(line('hidden info'));
  files.flush();
  assert.deepEqual(fs.readdirSync(dir), []);
  files.write(line('first warning line', 'warn'));
  files.write(line('second warning line', 'warn'));
  files.write(line('an error line here', 'error'));
  files.flush();
  // 当天的第二个文件按结尾认：日期本身也可能含「-2」(每月 20–29 日)
  const second = /^\d{4}-\d{2}-\d{2}-2\.log$/;
  const names = fs.readdirSync(dir).sort();
  assert.equal(names.length, 2);
  assert.equal(names.filter(f => second.test(f)).length, 1);
  assert.match(fs.readFileSync(path.join(dir, names.find(f => !second.test(f))!), 'utf8'), /\[W\] host first warning line/);
  fs.rmSync(dir, { recursive: true, force: true });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { LogBook } from '../src/main/logs.ts';

test('运行日志：内存里只留最近 2000 行，行号一直往上数；停了以后不推', async () => {
  let pushed = 0;
  const book = new LogBook(lines => { pushed += lines.length; });
  const write = console.log;
  console.log = () => undefined;
  try {
    for (let i = 1; i <= 2005; i++) book.add('a.b', `line ${i}`);
  } finally {
    console.log = write;
  }
  const list = book.list;
  assert.equal(list.length, 2000);
  assert.deepEqual([list[0]?.id, list[0]?.text], [6, 'line 6']);
  assert.deepEqual([list.at(-1)?.id, list.at(-1)?.text], [2005, 'line 2005']);
  // list 是副本，改它不影响内存里的
  list.length = 0;
  assert.equal(book.list.length, 2000);
  book.stop();
  await new Promise(r => setTimeout(r, 400));
  assert.equal(pushed, 0);
});

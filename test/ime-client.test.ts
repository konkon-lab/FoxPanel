import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ImeClient } from '../components/ime/src/client.ts';

// 假的工作线程：key 回 commit = 键名(名字是 slow 的晚 30 毫秒)；raw 回错误；importDict 回 7 条；schema 不回；clear 抛出未捕获的异常
const WORKER = `
import { parentPort } from 'node:worker_threads';
parentPort.on('message', ({ id, req }) => {
  if (req.kind === 'clear') throw new Error('boom');
  if (req.kind === 'schema') return;
  if (req.kind === 'raw') return parentPort.postMessage({ id, error: 'bad request' });
  if (req.kind === 'importDict') return parentPort.postMessage({ id, ok: { count: 7 } });
  setTimeout(() => parentPort.postMessage({ id, ok: { commit: req.name, composition: '', compositionCaret: 0, candidates: [] } }), req.name === 'slow' ? 30 : 0);
});
`;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-worker-'));
const file = path.join(dir, 'worker.mjs');
fs.writeFileSync(file, WORKER);
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

function client(): { ime: ImeClient; logs: string[] } {
  const logs: string[] = [];
  return { ime: new ImeClient(file, '', text => { logs.push(text); }), logs };
}

test('调用端：请求一个个执行，结果按顺序回来；线程回的错误只让那一个请求失败', async () => {
  const { ime } = client();
  try {
    const done: string[] = [];
    const slow = ime.request({ kind: 'key', name: 'slow' }).then(r => done.push(r.commit ?? ''));
    const failed = ime.request({ kind: 'raw' });
    const fast = ime.request({ kind: 'key', name: 'fast' }).then(r => done.push(r.commit ?? ''));
    await assert.rejects(failed, /bad request/);
    await Promise.all([slow, fast]);
    assert.deepEqual(done, ['slow', 'fast']);
    assert.equal(await ime.importDict('clover', 'x.txt'), 7);
  } finally {
    ime.stop();
  }
});

test('调用端：线程出错退出后，在等的和之后的请求都失败', async () => {
  const { ime, logs } = client();
  try {
    const crashed = ime.request({ kind: 'clear' });
    const queued = ime.request({ kind: 'key', name: 'a' });
    await assert.rejects(crashed, /输入法线程出错：boom/);
    await assert.rejects(queued, /输入法线程出错：boom/);
    await assert.rejects(ime.request({ kind: 'key', name: 'b' }), /输入法线程出错：boom/);
    await assert.rejects(ime.importDict('clover', 'x.txt'), /输入法线程出错：boom/);
    assert.deepEqual(logs, ['ime worker error: boom']);
  } finally {
    ime.stop();
  }
});

test('调用端：停掉线程时在等的请求失败', async () => {
  const { ime } = client();
  const pending = ime.request({ kind: 'schema', id: 'clover', switches: {} });
  const queued = ime.request({ kind: 'key', name: 'a' });
  ime.stop();
  await assert.rejects(pending, /输入法线程已退出/);
  await assert.rejects(queued, /输入法线程已退出/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ComponentStorage } from '../src/main/components/storage.ts';

test('组件数据：按组件分文件读写删，值存成 JSON；id 不对、key 为空、超过 1 MB 都拒绝；卸载时整个删掉', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-data-'));
  try {
    const s = new ComponentStorage(dir);
    assert.equal(s.call('a.b', { op: 'get', key: 'x' }), null);
    s.call('a.b', { op: 'set', key: 'x', value: { n: 1, list: [1, 2] } });
    s.call('c.d', { op: 'set', key: 'x', value: 'other' });
    assert.deepEqual(s.call('a.b', { op: 'get', key: 'x' }), { n: 1, list: [1, 2] });
    assert.deepEqual(new ComponentStorage(dir).call('a.b', { op: 'get', key: 'x' }), { n: 1, list: [1, 2] });
    s.call('a.b', { op: 'delete', key: 'x' });
    assert.equal(s.call('a.b', { op: 'get', key: 'x' }), null);
    assert.equal(s.call('c.d', { op: 'get', key: 'x' }), 'other');
    assert.throws(() => s.call('../evil', { op: 'get', key: 'x' }), /id/);
    assert.throws(() => s.call('a.b', { op: 'get', key: '' }), /key/);
    // 不认识的操作、不是对象的参数：报错，存着的值不变
    for (const bad of [{ op: 'x', key: 'k' }, { op: 'clear', key: 'k' }, { key: 'k' }, 'get', null, [{ op: 'get', key: 'k' }]]) {
      s.call('a.b', { op: 'set', key: 'k', value: 1 });
      assert.throws(() => s.call('a.b', bad), /操作不对/, JSON.stringify(bad));
      assert.equal(s.call('a.b', { op: 'get', key: 'k' }), 1);
    }
    assert.throws(() => s.call('a.b', { op: 'set', key: 5, value: 1 }), /key/);
    assert.throws(() => s.call('a.b', { op: 'set', key: 'big', value: 'x'.repeat(1024 * 1024) }), /1 MB/);
    s.removeAll('c.d');
    assert.ok(!fs.existsSync(path.join(dir, 'c.d.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

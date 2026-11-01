import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { dataPath, listDirs, makeDir } from '../src/main/datadir.ts';

test('数据文件夹的路径：空和不是字符串 = 数据文件夹本身；绝对路径、.. 越出去的都不给', () => {
  const root = path.join(os.tmpdir(), 'foxpanel-root');
  assert.equal(dataPath(root, ''), root);
  assert.equal(dataPath(root, undefined), root);
  assert.equal(dataPath(root, 'logs/2026'), path.join(root, 'logs', '2026'));
  assert.equal(dataPath(root, 'logs/../data'), path.join(root, 'data'));
  assert.equal(dataPath(root, '..'), null);
  assert.equal(dataPath(root, 'logs/../../other'), null);
  assert.equal(dataPath(root, '../foxpanel-root-2'), null);
  assert.equal(dataPath(root, 'C:/Windows'), null);
  assert.equal(dataPath(root, '/'), null);
  assert.equal(dataPath(root, path.join(root, 'logs')), path.join(root, 'logs'));
});

test('目录浏览：只列子文件夹并排序；新建文件夹和列目录都出不了数据文件夹', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-dirs-'));
  const root = path.join(base, 'data');
  try {
    fs.mkdirSync(path.join(root, 'b'), { recursive: true });
    fs.mkdirSync(path.join(root, 'a', 'inner'), { recursive: true });
    fs.writeFileSync(path.join(root, 'file.txt'), '');
    assert.deepEqual(listDirs(root, ''), { ok: true, rel: '', dirs: ['a', 'b'] });
    assert.deepEqual(listDirs(root, 5), { ok: true, rel: '', dirs: ['a', 'b'] });
    assert.deepEqual(listDirs(root, 'a'), { ok: true, rel: 'a', dirs: ['inner'] });
    assert.equal(listDirs(root, 'missing').ok, false);
    assert.equal(listDirs(root, '..').ok, false);
    assert.equal(listDirs(root, base).ok, false);

    assert.deepEqual(makeDir(root, 'a', ' new '), { ok: true });
    assert.ok(fs.statSync(path.join(root, 'a', 'new')).isDirectory());
    assert.deepEqual(makeDir(root, '', 'x/y'), { ok: true });
    assert.ok(fs.statSync(path.join(root, 'x', 'y')).isDirectory());
    assert.equal(makeDir(root, '', '  ').ok, false);
    assert.equal(makeDir(root, '', 5).ok, false);
    for (const [rel, name] of [['', '../escaped'], ['a', '../../escaped'], ['..', 'escaped'], [base, 'escaped'], ['', path.join(base, 'escaped')]] as const) {
      assert.equal(makeDir(root, rel, name).ok, false, `${rel} + ${name}`);
    }
    assert.deepEqual(fs.readdirSync(base), ['data']);
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

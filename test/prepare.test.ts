// npm 的 prepare(scripts/prepare.ts)：有 .git 才设钩子目录；没有 .git、git 失败时退出码照样是 0。

import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HOOKS_DIR, setHooksPath, type RunGit } from '../scripts/prepare.ts';

const SCRIPT = path.resolve(import.meta.dirname, '../scripts/prepare.ts');

function tempDir(t: TestContext): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-prepare-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// 记下调用的假 git；error 是它给的出错原因
function fakeGit(error = ''): { git: RunGit; calls: [readonly string[], string][] } {
  const calls: [readonly string[], string][] = [];
  return { git: (args, cwd) => { calls.push([args, cwd]); return error; }, calls };
}

test('没有 .git 的文件夹：不调 git', t => {
  const dir = tempDir(t);
  const { git, calls } = fakeGit();
  assert.deepEqual(setHooksPath(dir, git), { result: 'no-repo' });
  assert.deepEqual(calls, []);
});

test('有 .git(文件夹，或工作树里的文件)：在仓库根把 core.hooksPath 设成 .githooks', t => {
  for (const make of [(d: string) => fs.mkdirSync(path.join(d, '.git')), (d: string) => fs.writeFileSync(path.join(d, '.git'), 'gitdir: elsewhere')]) {
    const dir = tempDir(t);
    make(dir);
    const { git, calls } = fakeGit();
    assert.deepEqual(setHooksPath(dir, git), { result: 'set' });
    assert.deepEqual(calls, [[['config', 'core.hooksPath', HOOKS_DIR], dir]]);
  }
  assert.equal(HOOKS_DIR, '.githooks');
  assert.ok(fs.existsSync(path.resolve(import.meta.dirname, '..', HOOKS_DIR, 'pre-commit')));
});

test('git 失败：给出原因', t => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, '.git'));
  assert.deepEqual(setHooksPath(dir, fakeGit('git 没装').git), { result: 'failed', error: 'git 没装' });
});

test('脚本放在没有 .git 的文件夹里运行：退出码 0，不打印说明', t => {
  const dir = tempDir(t);
  fs.mkdirSync(path.join(dir, 'scripts'));
  fs.copyFileSync(SCRIPT, path.join(dir, 'scripts', 'prepare.ts'));
  const r = spawnSync(process.execPath, [path.join(dir, 'scripts', 'prepare.ts')], { encoding: 'utf8' });
  assert.deepEqual([r.status, r.stdout], [0, '']);
  assert.doesNotMatch(r.stderr, /prepare/);
});

test('package.json 的 prepare 跑的是这个脚本', () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, '../package.json'), 'utf8')) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts['prepare'], 'node scripts/prepare.ts');
});

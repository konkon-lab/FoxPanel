// 提交信息检查(.githooks/commit-msg.ts)：合格的通过，格式不对的拒绝。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hook = path.resolve(import.meta.dirname, '../.githooks/commit-msg.ts');

function check(message: string): number {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fk-msg-'));
  const file = path.join(dir, 'MSG');
  fs.writeFileSync(file, message);
  try {
    return spawnSync(process.execPath, [hook, file]).status ?? -1;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('合格的提交信息通过', () => {
  assert.equal(check('feat：项目骨架\n\n-Electron + Vite + Vue\n'), 0);
});

test('缺类型、半角冒号、标题过长被拒绝', () => {
  assert.notEqual(check('项目骨架\n'), 0);
  assert.notEqual(check('feat: 项目骨架\n'), 0);
  assert.notEqual(check(`feat：${'字'.repeat(21)}\n`), 0);
});

test('描述行不以 - 开头或第 2 行非空被拒绝', () => {
  assert.notEqual(check('feat：项目骨架\n\n描述\n'), 0);
  assert.notEqual(check('feat：项目骨架\n-描述\n'), 0);
});

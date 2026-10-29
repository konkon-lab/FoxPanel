import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CHANGELOG_DIR, NO_NOTES, changelogOf, isPrerelease, releaseNotes, tagVersion } from '../scripts/release-notes.ts';

// 在临时目录里放几份更新日志，跑完删掉
function withChangelog(files: Record<string, string>, run: (root: string) => void): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fox-notes-'));
  try {
    fs.mkdirSync(path.join(root, CHANGELOG_DIR));
    for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, CHANGELOG_DIR, name), text);
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('发布说明：tag 只认 v<版本>，带 - 的是测试版', () => {
  assert.equal(tagVersion('v0.1.0'), '0.1.0');
  assert.equal(tagVersion('v1.2.3-beta.1'), '1.2.3-beta.1');
  assert.equal(tagVersion('0.1.0'), null);
  assert.equal(tagVersion('v0.1'), null);
  assert.equal(tagVersion('release-0.1.0'), null);
  assert.equal(isPrerelease('1.2.3-beta.1'), true);
  assert.equal(isPrerelease('1.2.3'), false);
});

test('发布说明：读 changelog/<版本>.md 的全文，空文件当作没有', () => {
  withChangelog({ '0.2.0.md': '\r\n## 修复\r\n\r\n- 修了一个问题\r\n\r\n', '0.1.1.md': '  \n' }, root => {
    assert.equal(changelogOf(root, '0.2.0'), '## 修复\n\n- 修了一个问题');
    assert.equal(changelogOf(root, '0.1.1'), null);
    assert.equal(changelogOf(root, '0.3.0'), null);
  });
});

test('发布说明：正式版用自己的文件，没有时为 null(不发布)', () => {
  withChangelog({ '0.2.0.md': '- 新功能' }, root => {
    assert.equal(releaseNotes(root, '0.2.0'), '- 新功能');
    assert.equal(releaseNotes(root, '0.3.0'), null);
  });
});

test('发布说明：测试版先用自己的文件，再用正式版本号的文件并注明测试版，都没有写暂无更新日志', () => {
  withChangelog({ '0.2.0-beta.2.md': '- 只在 beta.2', '0.2.0.md': '- 新功能' }, root => {
    assert.equal(releaseNotes(root, '0.2.0-beta.2'), '- 只在 beta.2');
    assert.equal(releaseNotes(root, '0.2.0-beta.1'), '测试版，包含 0.2.0 目前已有的更新：\n\n- 新功能');
    assert.equal(releaseNotes(root, '0.3.0-beta.1'), NO_NOTES);
    assert.equal(NO_NOTES, '暂无更新日志');
  });
});

test('发布说明：仓库里有当前版本的更新日志', () => {
  const root = path.resolve(import.meta.dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  assert.notEqual(releaseNotes(root, pkg.version), null);
  assert.notEqual(releaseNotes(root, pkg.version), NO_NOTES);
});

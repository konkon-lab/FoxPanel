// npm 的 prepare：在 git 仓库里把钩子目录设成 .githooks。
// 没有 .git 的源码(下载的压缩包)里什么都不做；git 没装或命令失败时打印一行说明。两种情况退出码都是 0，不拦 npm install。

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// 在 cwd 里跑一条 git 命令；error 为空串表示成功
export type RunGit = (args: readonly string[], cwd: string) => string;

export type Prepared = { result: 'set' } | { result: 'no-repo' } | { result: 'failed'; error: string };

// 钩子目录(相对仓库根)
export const HOOKS_DIR = '.githooks';

// root 是 git 仓库(有 .git，工作树里它是一个文件)时设 core.hooksPath
export function setHooksPath(root: string, git: RunGit): Prepared {
  if (!fs.existsSync(path.join(root, '.git'))) return { result: 'no-repo' };
  const error = git(['config', 'core.hooksPath', HOOKS_DIR], root);
  return error ? { result: 'failed', error } : { result: 'set' };
}

const runGit: RunGit = (args, cwd) => {
  const r = spawnSync('git', [...args], { cwd, encoding: 'utf8' });
  if (r.error) return r.error.message;
  return r.status === 0 ? '' : (r.stderr.trim() || `git 退出码 ${String(r.status)}`);
};

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) {
  const done = setHooksPath(path.resolve(import.meta.dirname, '..'), runGit);
  if (done.result === 'failed') console.warn(`prepare: 没设上提交钩子(${done.error})，不影响安装和构建`);
}

// 发版时的发布说明：取 changelog/<版本>.md 的内容，一个文件对应一个版本。
// 用法：node scripts/release-notes.ts <tag> <输出文件>
// tag 是 v<版本>，和 package.json 的 version 不一致时报错退出。
// 正式版(版本号不带 -)必须有自己的文件，没有就报错退出；
// 测试版(如 0.2.0-beta.1)先找自己的文件，没有时用正式版本号(0.2.0)的文件并注明是测试版，都没有写「暂无更新日志」。

import fs from 'node:fs';
import path from 'node:path';

// 测试版找不到任何更新日志时的发布说明
export const NO_NOTES = '暂无更新日志';

// 更新日志的文件夹(相对仓库根)
export const CHANGELOG_DIR = 'changelog';

// tag 去掉前面的 v；不是 v<版本> 的形式时为 null
export function tagVersion(tag: string): string | null {
  const m = /^v(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(tag.trim());
  return m?.[1] ?? null;
}

// 版本号带 - 的是测试版
export function isPrerelease(version: string): boolean {
  return version.includes('-');
}

// root 下 changelog/<版本>.md 的内容，去掉首尾空白；没有文件或内容为空时是 null
export function changelogOf(root: string, version: string): string | null {
  const file = path.join(root, CHANGELOG_DIR, `${version}.md`);
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n').trim() : '';
  return text || null;
}

// 这个版本的发布说明；正式版没有更新日志时为 null
export function releaseNotes(root: string, version: string): string | null {
  const own = changelogOf(root, version);
  if (own) return own;
  if (!isPrerelease(version)) return null;
  const base = version.slice(0, version.indexOf('-'));
  const next = changelogOf(root, base);
  return next ? `测试版，包含 ${base} 目前已有的更新：\n\n${next}` : NO_NOTES;
}

function main(args: readonly string[]): number {
  const [tag, out] = args;
  if (!tag || !out) {
    console.error('用法：node scripts/release-notes.ts <tag> <输出文件>');
    return 1;
  }
  const version = tagVersion(tag);
  if (!version) {
    console.error(`tag ${tag} 不是 v<版本> 的形式`);
    return 1;
  }
  const root = path.resolve(import.meta.dirname, '..');
  const pkg: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const own = typeof pkg === 'object' && pkg !== null && 'version' in pkg ? pkg.version : undefined;
  if (own !== version) {
    console.error(`tag ${tag} 和 package.json 的版本 ${String(own)} 不一致`);
    return 1;
  }
  const notes = releaseNotes(root, version);
  if (notes === null) {
    console.error(`正式版 ${version} 没有更新日志，先写 ${CHANGELOG_DIR}/${version}.md`);
    return 1;
  }
  fs.writeFileSync(out, `${notes}\n`);
  console.log(`${isPrerelease(version) ? '测试版' : '正式版'} ${version} 的发布说明已写到 ${out}`);
  return 0;
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) process.exitCode = main(process.argv.slice(2));

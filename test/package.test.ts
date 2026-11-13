// package.json 里和打包、发布有关的配置：本项目的许可证、语言包、第三方许可证文件的收集、不上传、Node 版本。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { LOCALES } from '../src/shared/types.ts';
import { matchLocale } from '../src/shared/util.ts';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (file: string): string => fs.readFileSync(path.join(ROOT, file), 'utf8');

interface Pkg {
  license: string;
  scripts: Record<string, string>;
  engines: Record<string, string>;
  build: { files: string[]; electronLanguages: string[]; publish: unknown };
}
const pkg = JSON.parse(read('package.json')) as Pkg;

test('安装包带的 Chromium 语言包：每种界面语言各有一个，按系统语言能对回这种界面语言', () => {
  const languages = pkg.build.electronLanguages;
  assert.equal(languages.length, LOCALES.length);
  assert.deepEqual([...new Set(languages.map(matchLocale))].sort(), [...LOCALES].sort());
});

test('许可证：package.json 写 MIT，根目录的 LICENSE 是带版权行的 MIT 全文、进安装包，README 指到它', () => {
  assert.equal(pkg.license, 'MIT');
  const text = read('LICENSE');
  assert.match(text, /^MIT License\n\nCopyright \(c\) \d{4} \S/);
  assert.match(text, /Permission is hereby granted, free of charge/);
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/);
  assert.ok(pkg.build.files.includes('LICENSE'));
  assert.match(read('.github/README.md'), /\[LICENSE\]\(\.\.\/LICENSE\)/);
});

test('npm run pack 只打包不上传，更新源是 GitHub 仓库 konkon-lab/FoxPanel；package.json 和 package-lock.json 写的 Node 版本一样', () => {
  assert.match(pkg.scripts['pack'] ?? '', /electron-builder --win --x64 --publish never$/);
  assert.deepEqual(pkg.build.publish, { provider: 'github', owner: 'konkon-lab', repo: 'FoxPanel' });
  assert.ok(!('release' in pkg.scripts));
  const lock = JSON.parse(read('package-lock.json')) as { packages: Record<string, { engines?: Record<string, string> }> };
  assert.deepEqual(pkg.engines, { node: '>=24' });
  assert.deepEqual(lock.packages['']?.engines, pkg.engines);
});

test('构建把进安装包的 esbuild 产物都记进 metafile，全部打完后写许可证全文；它在 dist/ 里、随 dist 进安装包', () => {
  const build = read('scripts/build.ts');
  // 进安装包的代码只经 bundleCode 打；直接调 esbuild 的只有 bundleCode 自己和开发用的组件
  assert.equal([...build.matchAll(/(?<![\w.])build\(\{/g)].length, 1);
  assert.match(build, /const result = await build\(\{ \.\.\.options, metafile: true \}\);\n {2}metas\.push\(result\.metafile\);/);
  assert.match(build, /const bundle = shipped \? bundleCode : build;/);
  assert.match(build, /buildComponent\(path\.join\(src, id\.split\('\.'\)\[1\] \?\? id\), path\.join\(out, id\), true\)/);
  assert.match(build, /const COPIED_PACKAGES = \['node_modules\/vue'\];/);
  assert.match(build, /fs\.writeFileSync\(path\.join\(dist, LICENSES_FILE\), licensesText\(/);
  assert.match(build, /\nwriteImportMap\([^\n]+WINDOW_LIBS\);\nwriteLicenses\(\);\n$/);
  assert.ok(pkg.build.files.includes('dist/**/*'));
  assert.ok(pkg.build.files.includes('OPEN_SOURCE_LICENSES.md'));
  assert.match(build, /const LICENSES_FILE = 'THIRD_PARTY_LICENSES\.txt';/);
});

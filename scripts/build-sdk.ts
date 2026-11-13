// 生成组件 SDK 类型包 release/sdk/(@konkon-lab/foxpanel-sdk)：tsc 只出声明，相对导入的 .ts 换成 .js，加 package.json、说明和许可证。
// 包里也带主窗口模块 @konkon-lab/foxpanel-window 的类型(子路径 ./window，外加一份 declare module)，装了 SDK 就能 import 它。

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'release', 'sdk');
fs.rmSync(out, { recursive: true, force: true });
execFileSync(process.execPath, [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(root, 'sdk', 'build.tsconfig.json')], { stdio: 'inherit' });

// 声明里的 './x.ts' → './x.js'(按 .d.ts 解析)
function rewrite(dir: string): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) rewrite(f);
    else if (f.endsWith('.d.ts')) fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/(from\s+'\.{1,2}\/[^']+)\.ts'/g, "$1.js'"));
  }
}
rewrite(path.join(out, 'types'));

// 主窗口模块的声明：运行时由程序的 import map 提供，类型从子路径 ./window 取；SDK 的入口引用它，装了就生效
fs.writeFileSync(path.join(out, 'types', 'window-module.d.ts'), [
  '// @konkon-lab/foxpanel-window 是 FoxPanel 主窗口提供给组件的模块，类型和 @konkon-lab/foxpanel-sdk/window 相同',
  "declare module '@konkon-lab/foxpanel-window' {",
  "  export * from '@konkon-lab/foxpanel-sdk/window';",
  '}',
  '',
].join('\n'));
const index = path.join(out, 'types', 'sdk', 'index.d.ts');
fs.writeFileSync(index, `/// <reference path="../window-module.d.ts" />\n${fs.readFileSync(index, 'utf8')}`);

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string; dependencies: Record<string, string>; devDependencies: Record<string, string>; repository: unknown };
fs.writeFileSync(path.join(out, 'package.json'), `${JSON.stringify({
  name: '@konkon-lab/foxpanel-sdk',
  version: pkg.version,
  description: 'FoxPanel 组件的类型',
  keywords: ['foxpanel', 'foxpanel-sdk'],
  type: 'module',
  types: './types/sdk/index.d.ts',
  exports: {
    '.': { types: './types/sdk/index.d.ts' },
    './window': { types: './types/src/renderer/window-api.d.ts' },
  },
  files: ['types', 'README.md', 'LICENSE'],
  license: 'MIT',
  repository: pkg.repository,
  publishConfig: { access: 'public' },
  peerDependencies: { cordis: pkg.dependencies['cordis'], vue: `^${pkg.dependencies['vue'] ?? pkg.devDependencies['vue'] ?? ''}` },
  // vue 只有写主窗口组件、用到 @konkon-lab/foxpanel-window 时才要
  peerDependenciesMeta: { vue: { optional: true } },
}, null, 2)}\n`);
fs.copyFileSync(path.join(root, 'docs', 'sdk.md'), path.join(out, 'README.md'));
fs.copyFileSync(path.join(root, 'LICENSE'), path.join(out, 'LICENSE'));
console.log(out);

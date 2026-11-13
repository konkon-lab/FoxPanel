// 打进 dist/ 的 npm 包的许可证全文：按 esbuild 的 metafile 找出产物里实际带着的包，
// 从各包的文件夹读名字、版本、许可证文件，拼成一份文本(scripts/build.ts 写到 dist/THIRD_PARTY_LICENSES.txt，随安装包分发)。

import fs from 'node:fs';
import path from 'node:path';
import { isObject } from '../src/shared/util.ts';

// esbuild 的 metafile 里用到的部分：每个产物由哪些输入文件组成、各占多少字节
export interface BundleMeta {
  outputs: Record<string, { inputs: Record<string, { bytesInOutput: number }> }>;
}

// 一个包和它的许可证
export interface PackageLicense {
  name: string;
  version: string;
  license: string;      // package.json 写的许可证名；没写为空串
  author: string;       // 没写为空串
  source: string;       // 仓库或主页地址；没写为空串
  texts: { file: string; text: string }[];   // 包里的许可证文件，按文件名排
}

const MODULES = 'node_modules/';
// 包最外层算许可证的文件名
const LICENSE_FILE = /^(licen[sc]e|copying|notice)([.-].*)?$/i;
const RULE = '='.repeat(80);

// 输入文件所在的包文件夹(/ 分隔)；不在 node_modules 里的为 null。嵌套的 node_modules 取最里面那一层
export function packageDirOf(input: string): string | null {
  const file = input.split(path.sep).join('/');
  const at = file.lastIndexOf(MODULES);
  if (at < 0) return null;
  const [first, second] = file.slice(at + MODULES.length).split('/');
  if (!first) return null;
  if (!first.startsWith('@')) return file.slice(0, at + MODULES.length) + first;
  return second ? `${file.slice(0, at + MODULES.length)}${first}/${second}` : null;
}

// 这些产物里实际带着代码的包文件夹，去重、排序
export function bundledPackageDirs(metas: readonly BundleMeta[]): string[] {
  const dirs = new Set<string>();
  for (const meta of metas) {
    for (const out of Object.values(meta.outputs)) {
      for (const [input, { bytesInOutput }] of Object.entries(out.inputs)) {
        const dir = bytesInOutput > 0 ? packageDirOf(input) : null;
        if (dir) dirs.add(dir);
      }
    }
  }
  return [...dirs].sort();
}

// package.json 里可能是字符串、也可能是对象的字段：对象取 key 那一项
function field(value: unknown, key: string): string {
  if (typeof value === 'string') return value;
  const inner = isObject(value) ? value[key] : undefined;
  return typeof inner === 'string' ? inner : '';
}

// 读一个包文件夹：package.json 的名字、版本、许可证名、作者、来源，和最外层的许可证文件
export function readPackage(dir: string): PackageLicense {
  const pkg: unknown = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  if (!isObject(pkg)) throw new Error(`${dir} 的 package.json 不是对象`);
  const texts = fs.readdirSync(dir, { withFileTypes: true })
    .filter(f => f.isFile() && LICENSE_FILE.test(f.name))
    .map(f => f.name)
    .sort()
    .map(file => ({ file, text: fs.readFileSync(path.join(dir, file), 'utf8') }));
  return {
    name: field(pkg['name'], 'name'),
    version: field(pkg['version'], 'version'),
    license: field(pkg['license'], 'type'),
    author: field(pkg['author'], 'name'),
    source: field(pkg['repository'], 'url') || field(pkg['homepage'], 'url'),
    texts,
  };
}

// 拼成一份文本：按包名排，同名的按版本排；每个包一段：名字和版本、许可证名、作者、来源，后面是许可证全文
export function licensesText(packages: readonly PackageLicense[]): string {
  const key = (p: PackageLicense): string => `${p.name}\n${p.version}`;
  const sorted = [...packages].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
  const parts = [[
    'FoxPanel 的 dist/ 里带着下面这些 npm 包的代码，各包的许可证全文列在后面。',
    '放在 node_modules/ 里的包的许可证在各自的文件夹里；输入法引擎、词库、OpenVR、Yarn 的在 vendor/ 下。一览见 OPEN_SOURCE_LICENSES.md。',
  ].join('\n')];
  for (const p of sorted) {
    const head = [`${p.name} ${p.version}`, `许可证：${p.license || '没有写'}`];
    if (p.author) head.push(`作者：${p.author}`);
    if (p.source) head.push(`来源：${p.source}`);
    const body = p.texts.length
      ? p.texts.map(t => t.text.replace(/\r\n/g, '\n').trimEnd()).join('\n\n')
      : '这个包里没有许可证文件，许可证以上面写的名字为准，全文见来源。';
    parts.push([RULE, ...head, RULE, '', body].join('\n'));
  }
  return `${parts.join('\n\n')}\n`;
}

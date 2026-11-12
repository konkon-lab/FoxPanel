// 把组件文件夹打包(先校验清单，不打包 src/、node_modules/ 和作者自己的 package.json)：
// 默认打成可安装的 zip，放到 release/components/<id>.zip；
// 加 --npm 打成 npm 包 release/components/<包名>-<版本>.tgz(docs/market.md)，由作者自己 npm publish。
// 用法：node scripts/pack-component.ts [--npm] <文件夹>…，不写文件夹就打包 examples/ 下全部

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseManifest, textOf, type Manifest } from '../src/shared/manifest.ts';
import { KEYWORD, PACKAGE_NAME, SDK_PACKAGE, summaryOf } from '../src/shared/market.ts';
import { hasCode, TAR } from '../src/main/components/store.ts';
import { errorText, isObject } from '../src/shared/util.ts';

const root = path.join(import.meta.dirname, '..');
const out = path.join(root, 'release', 'components');
const examples = path.join(root, 'examples');
// 文件夹里不进包的：源码、依赖、作者自己的 package.json(npm 包里的那份由 packageOf 生成)
const SKIP: ReadonlySet<string> = new Set(['src', 'node_modules', 'package.json']);

// 组件文件夹里 package.json 的内容(作者可以自己写包名、依赖、存储库)；没有时为空
function ownPackage(dir: string): Record<string, unknown> {
  const file = path.join(dir, 'package.json');
  if (!fs.existsSync(file)) return {};
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  return isObject(raw) ? raw : {};
}

// npm 包里的 package.json：own 是作者自己的那份，files 是进包的文件，code = 带代码，sdk 是程序版本；包名不合规则时抛出异常
export function packageOf(own: Record<string, unknown>, m: Manifest, files: string[], code: boolean, sdk: string): Record<string, unknown> & { name: string } {
  const name = typeof own['name'] === 'string' ? own['name'] : `foxpanel-component-${m.id.replace('.', '-')}`;
  if (!PACKAGE_NAME.test(name)) throw new Error(`包名 ${name} 要写成 foxpanel-component-<名字> 或 @作者/foxpanel-component-<名字>`);
  const keywords = Array.isArray(own['keywords']) ? own['keywords'].filter((k): k is string => typeof k === 'string') : [];
  const pkg: Record<string, unknown> & { name: string } = {
    ...own,
    name, version: m.version, type: 'module',
    description: textOf(m.description ?? m.name, 'zh-Hans'),
    keywords: [...new Set([KEYWORD, ...keywords])],
    author: m.author, license: m.license,
    files,
    peerDependencies: { ...(isObject(own['peerDependencies']) ? own['peerDependencies'] : {}), [SDK_PACKAGE]: `^${sdk}` },
    foxpanel: summaryOf(m, code),
  };
  delete pkg['private'];
  delete pkg['devDependencies'];
  delete pkg['scripts'];
  if (m.repository && pkg['repository'] === undefined) pkg['repository'] = m.repository;
  if (m.bugs && pkg['bugs'] === undefined) pkg['bugs'] = m.bugs;
  return pkg;
}

// 打成 npm 包(和 npm pack 一样是 tar.gz，文件在 package/ 下)放进 dest：在临时目录里放文件和生成的 package.json
function packNpm(dir: string, m: Manifest, files: string[], dest: string): string {
  const app = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  const pkg = packageOf(ownPackage(dir), m, files, hasCode(m, dir, files), app.version);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'foxpanel-pack-'));
  try {
    const inner = path.join(tmp, 'package');
    for (const f of files) fs.cpSync(path.join(dir, f), path.join(inner, f), { recursive: true });
    fs.writeFileSync(path.join(inner, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
    const file = path.join(dest, `${pkg.name.replace('@', '').replace('/', '-')}-${m.version}.tgz`);
    fs.rmSync(file, { force: true });
    execFileSync(TAR, ['-c', '-z', '-f', file, '-C', tmp, 'package']);
    return file;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 打包一个组件文件夹(npm = 打成 npm 包)放进 dest，返回生成的文件；清单读不了或不合格时抛出异常
export function pack(dir: string, npm: boolean, dest = out): string {
  const r = parseManifest(JSON.parse(fs.readFileSync(path.join(dir, 'component.json'), 'utf8')));
  if (!r.ok) throw new Error(r.errors.join('；'));
  const files = fs.readdirSync(dir).filter(f => !SKIP.has(f));
  if (npm) return packNpm(dir, r.manifest, files, dest);
  const file = path.join(dest, `${r.manifest.id}.zip`);
  fs.rmSync(file, { force: true });
  execFileSync(TAR, ['-a', '-c', '-f', file, '-C', dir, ...files]);
  return file;
}

// 按命令行参数打包；一个文件夹失败不影响其余的，有失败的返回退出码 1
function main(args: readonly string[]): number {
  const npm = args.includes('--npm');
  const named = args.filter(a => a !== '--npm');
  const dirs = named.length ? named.map(d => path.resolve(d)) : fs.readdirSync(examples).map(d => path.join(examples, d)).filter(d => fs.statSync(d).isDirectory());
  fs.mkdirSync(out, { recursive: true });
  let failed = false;
  for (const dir of dirs) {
    try {
      const file = pack(dir, npm);
      console.log(`${file} (${(fs.statSync(file).size / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.error(`${dir}：${errorText(e)}`);
      failed = true;
    }
  }
  return failed ? 1 : 0;
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) process.exitCode = main(process.argv.slice(2));

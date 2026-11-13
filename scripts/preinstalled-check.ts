// 预装组件的版本检查：已装的预装组件只在版本号更高时更新，所以内容变了的预装组件要升版本号。
// 构建后给 dist/components/ 下每个预装组件的文件算一个 sha256，和上一次发布时记下的(components/released.json)比：
// 内容变了而版本号没有比记下的高就报错。
// 用法：node scripts/preinstalled-check.ts            检查(还没有记录时直接通过)
//       node scripts/preinstalled-check.ts --record   把这次构建的版本号和 sha256 记成发布记录

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { compareVersions } from '../src/shared/version.ts';
import { errorText, isObject } from '../src/shared/util.ts';

const root = path.resolve(import.meta.dirname, '..');
const BUILT = path.join(root, 'dist', 'components');             // 构建好的预装组件
const RECORD = path.join(root, 'components', 'released.json');   // 发布记录

// 一个预装组件的版本号和内容的 sha256
export interface Stamp {
  version: string;
  hash: string;
}

// 发布记录：记的时候的程序版本，和每个预装组件(按 id)
export interface Released {
  app: string;
  components: Record<string, Stamp>;
}

// 文件夹里全部文件的 sha256：按相对路径(/ 分隔)排序，路径和内容都算进去
export function hashDir(dir: string): string {
  const hash = crypto.createHash('sha256');
  const walk = (rel: string): string[] => fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? walk(`${rel}${e.name}/`) : [`${rel}${e.name}`]));
  for (const file of walk('').sort()) {
    hash.update(`${file}\0`);
    hash.update(fs.readFileSync(path.join(dir, file)));
    hash.update('\0');
  }
  return hash.digest('hex');
}

// 构建目录里每个组件(带 component.json 的文件夹)的版本号和 sha256
export function stamps(built: string): Record<string, Stamp> {
  const out: Record<string, Stamp> = {};
  for (const e of fs.readdirSync(built, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const file = path.join(built, e.name, 'component.json');
    if (!e.isDirectory() || !fs.existsSync(file)) continue;
    const manifest: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
    const version = isObject(manifest) && typeof manifest['version'] === 'string' ? manifest['version'] : '';
    out[e.name] = { version, hash: hashDir(path.join(built, e.name)) };
  }
  return out;
}

// 读发布记录；没有这个文件为 null，格式不对时抛出异常
export function readRecord(file: string): Released | null {
  if (!fs.existsSync(file)) return null;
  const raw: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isObject(raw) || typeof raw['app'] !== 'string' || !isObject(raw['components'])) throw new Error(`${file} 的格式不对`);
  const components: Record<string, Stamp> = {};
  for (const [id, s] of Object.entries(raw['components'])) {
    if (!isObject(s) || typeof s['version'] !== 'string' || typeof s['hash'] !== 'string') throw new Error(`${file} 里 ${id} 的格式不对`);
    components[id] = { version: s['version'], hash: s['hash'] };
  }
  return { app: raw['app'], components };
}

// 这次构建和发布记录比：problems 是要改的(有就不能发布)，notes 是知道一下就行的
export function compare(released: Released, now: Readonly<Record<string, Stamp>>): { problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  for (const [id, was] of Object.entries(released.components)) {
    const cur = now[id];
    if (!cur) {
      notes.push(`${id} 不在预装列表里了：装过 ${released.app} 的人那里它留在组件目录里、照常加载`);
      continue;
    }
    const order = compareVersions(cur.version, was.version);
    if (order < 0) problems.push(`${id} 的版本号 ${cur.version} 比 ${released.app} 发布时的 ${was.version} 低`);
    else if (order === 0 && cur.hash !== was.hash) problems.push(`${id} 的内容变了，版本号还是 ${was.version}：升 component.json 的 version，已装的才会更新`);
  }
  for (const id of Object.keys(now)) {
    if (!(id in released.components)) notes.push(`${id} 是 ${released.app} 之后加进预装列表的`);
  }
  return { problems, notes };
}

// 检查或记录，返回退出码
export function main(argv: readonly string[], built = BUILT, record = RECORD, appVersion = readAppVersion()): number {
  const unknown = argv.filter(a => a !== '--record');
  if (unknown.length) {
    console.error(`不认识的参数 ${unknown.join(' ')}\n用法：node scripts/preinstalled-check.ts [--record]`);
    return 2;
  }
  if (!fs.existsSync(built)) {
    console.error(`没有 ${built}，要 npm run build`);
    return 1;
  }
  const now = stamps(built);
  if (argv.includes('--record')) {
    const released: Released = { app: appVersion, components: now };
    fs.writeFileSync(record, `${JSON.stringify(released, null, 2)}\n`);
    console.log(`记下了 ${Object.keys(now).length} 个预装组件(程序版本 ${appVersion})：${record}`);
    return 0;
  }
  let released: Released | null;
  try {
    released = readRecord(record);
  } catch (e) {
    console.error(errorText(e));
    return 1;
  }
  if (!released) {
    console.log(`还没有发布记录(${record})，不检查预装组件的版本号`);
    return 0;
  }
  const { problems, notes } = compare(released, now);
  for (const n of notes) console.log(n);
  for (const p of problems) console.error(p);
  if (!problems.length) console.log(`预装组件的版本号和 ${released.app} 的发布记录对得上`);
  return problems.length ? 1 : 0;
}

function readAppVersion(): string {
  const pkg: unknown = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return isObject(pkg) && typeof pkg['version'] === 'string' ? pkg['version'] : '';
}

if (path.resolve(process.argv[1] ?? '') === import.meta.filename) process.exitCode = main(process.argv.slice(2));

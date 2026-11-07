// 语言组件 → rime 用户目录：已装的语言组件(开不开都算)把 rime/ 里的文件复制进用户目录，记下清单，卸载后删掉；
// schema_list 按全部已装语言的方案生成。开关只影响语言面板，不用重新部署。

import fs from 'node:fs';
import path from 'node:path';
import type { ImeDef, ImePack, MainContext, Manifest } from '@konkon-lab/foxpanel-sdk';
import { errorText, isObject } from '../../_shared/util.ts';
import { nameOf, parseIme, schemasOf } from './imepack.ts';

export interface LangDirs {
  user: string;     // rime 用户目录
  shared: string;   // 内置 rime 数据
  record: string;   // 记录各语言放进用户目录的文件(json)
}

export interface LangComponent {
  dir: string;
  manifest: Manifest;
  ime: ImeDef;      // 校验过的 ime 字段
}

// 用户目录里程序自己写的文件
const RESERVED = ['default.custom.yaml', 'default.yaml', 'installation.yaml', 'user.yaml'];

// 目录下全部文件(相对路径，/ 分隔)；有链接时报错
function listFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.join(dir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isSymbolicLink()) throw new Error(`包里不能有链接：${rel}`);
    if (e.isDirectory()) out.push(...listFiles(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

// 语言组件 rime/ 里的文件；没有 rime/ 时为空
function rimeFiles(dir: string): string[] {
  const rime = path.join(dir, 'rime');
  return fs.existsSync(rime) ? listFiles(rime) : [];
}

// 文件内容和 text 不同(或没有这个文件)时写入，返回是否写了。
// 内容没变就不碰文件：rime 部署时按配置文件的修改时间决定方案要不要重新编译
export function writeIfChanged(file: string, text: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  fs.writeFileSync(file, text);
  return true;
}

export class LangFiles {
  private readonly dirs: LangDirs;
  private readonly reserved: ReadonlySet<string>;

  // reserved = 用户目录里调用方自己写的文件，语言组件不能带同名的
  constructor(dirs: LangDirs, reserved: readonly string[]) {
    this.dirs = dirs;
    this.reserved = new Set([...reserved, ...RESERVED].map(f => f.toLowerCase()));
  }

  // 已装的语言组件对上 rime 用户目录：ime 字段不对、文件检查不过的跳过并记日志，其余的文件同步进去，方案写进 schema_list。
  // 返回能用的输入语言，和用户目录有没有变(变了要重新部署)
  apply(installed: readonly { dir: string; manifest: Manifest }[], log: MainContext['log']): { packs: ImePack[]; changed: boolean } {
    const skip = (id: string, e: unknown): void => log(`${id} skipped: ${errorText(e)}`, 'error');
    const parsed = installed.flatMap(({ dir, manifest }): LangComponent[] => {
      try {
        return [{ dir, manifest, ime: parseIme(manifest.ime, manifest.name) }];
      } catch (e) {
        skip(manifest.id, e);
        return [];
      }
    });
    const usable = parsed.filter(c => {
      try {
        this.check(c, parsed);
        return true;
      } catch (e) {
        skip(c.manifest.id, e);
        return false;
      }
    });
    const synced = this.sync(usable);
    const packs = usable.map(({ manifest: m, ime }): ImePack => ({ ...ime, id: m.id, name: m.name }));
    const listed = this.writeSchemaList(packs);
    return { packs, changed: synced || listed };
  }

  private record(): Record<string, string[]> {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.dirs.record, 'utf8'));
      if (!isObject(raw)) return {};
      return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []]));
    } catch {
      return {};
    }
  }

  // 方案文件在组件 rime/ 或内置数据里
  private hasSchema(dir: string, schema: string): boolean {
    const f = `${schema}.schema.yaml`;
    return fs.existsSync(path.join(dir, 'rime', f)) || fs.existsSync(path.join(this.dirs.shared, f));
  }

  // 装之前检查：方案文件齐全；文件不和程序自己的、内置的、别的语言的重名。不过时抛出带原因的 Error
  check(c: LangComponent, others: readonly LangComponent[]): void {
    for (const s of schemasOf(c.ime)) if (!this.hasSchema(c.dir, s)) throw new Error(`没有 ${s}.schema.yaml`);
    const owners = new Map<string, string>();
    for (const o of others) {
      if (o.manifest.id === c.manifest.id) continue;
      for (const f of rimeFiles(o.dir)) owners.set(f.toLowerCase(), nameOf(o.manifest.name));
    }
    for (const f of rimeFiles(c.dir)) {
      const key = f.toLowerCase();
      if (this.reserved.has(key)) throw new Error(`不能带 ${f}(程序自己的配置)`);
      if (fs.existsSync(path.join(this.dirs.shared, f))) throw new Error(`${f} 和内置文件同名`);
      const owner = owners.get(key);
      if (owner) throw new Error(`${f} 和语言 ${owner} 的文件同名`);
    }
  }

  // 用户目录对上已装的语言：新的、改过的文件复制进去，卸掉的语言的文件删掉；返回是否有变化(有就要重新部署)
  sync(langs: readonly LangComponent[]): boolean {
    const before = this.record();
    const after: Record<string, string[]> = {};
    let changed = false;
    for (const { dir, manifest: m } of langs) {
      const files = rimeFiles(dir);
      if (!files.length) continue;
      after[m.id] = files;
      for (const f of files) {
        const from = path.join(dir, 'rime', f);
        const to = path.join(this.dirs.user, f);
        if (fs.existsSync(to) && fs.readFileSync(to).equals(fs.readFileSync(from))) continue;
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(from, to);
        changed = true;
      }
    }
    const keep = new Set(Object.values(after).flat().map(f => f.toLowerCase()));
    for (const [id, files] of Object.entries(before)) {
      for (const f of files) {
        if (keep.has(f.toLowerCase())) continue;
        this.removeFile(f);
        changed = true;
      }
      if (!(id in after)) changed = true;
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) fs.writeFileSync(this.dirs.record, JSON.stringify(after, null, 2));
    return changed;
  }

  // 删一个文件，空出来的文件夹一起删
  private removeFile(f: string): void {
    fs.rmSync(path.join(this.dirs.user, f), { force: true });
    let d = path.dirname(f);
    while (d !== '.' && d !== '') {
      const abs = path.join(this.dirs.user, d);
      if (!fs.existsSync(abs) || fs.readdirSync(abs).length) break;
      fs.rmdirSync(abs);
      d = path.dirname(d);
    }
  }

  // 用户目录的 default.custom.yaml：全部已装语言的方案；返回是否改了
  writeSchemaList(packs: readonly ImePack[]): boolean {
    const ids = [...new Set(packs.flatMap(schemasOf))];
    return writeIfChanged(path.join(this.dirs.user, 'default.custom.yaml'), `patch:\n  schema_list:\n${ids.map(id => `    - schema: ${id}\n`).join('')}`);
  }
}

// 组件自己的数据：userData/component-data/<id>.json，键值都是 JSON；卸载时删掉。
// 按调用方给的组件 id 存取：组件进程和页面宿主给每个组件的 ctx.storage 都固定成它自己的 id。

import fs from 'node:fs';
import path from 'node:path';
import type { StorageOp } from '../../shared/host-protocol.ts';
import { isComponentId } from '../../shared/manifest.ts';
import { isObject } from '../../shared/util.ts';

const DATA_MAX = 1024 * 1024;   // 一个组件的数据存成 JSON 后的最大长度(字符，UTF-16 码元)

// 外部传来的操作(IPC 参数、组件进程的消息)收窄；格式不对时抛出异常
function parseOp(raw: unknown): StorageOp {
  if (!isObject(raw)) throw new Error('操作不对');
  const { op, key } = raw;
  if (typeof key !== 'string' || !key) throw new Error('key 要是非空字符串');
  if (op === 'get' || op === 'delete') return { op, key };
  if (op === 'set') return { op, key, value: raw['value'] };
  throw new Error('操作不对');
}

export class ComponentStorage {
  private readonly dir: string;
  private readonly cache = new Map<string, Record<string, unknown>>();

  constructor(dir: string) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  private file(id: string): string {
    if (!isComponentId(id)) throw new Error('组件 id 不对');
    return path.join(this.dir, `${id}.json`);
  }

  private load(id: string): Record<string, unknown> {
    const hit = this.cache.get(id);
    if (hit) return hit;
    let data: Record<string, unknown> = {};
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file(id), 'utf8'));
      if (isObject(raw)) data = raw;
    } catch { /* 还没有 */ }
    this.cache.set(id, data);
    return data;
  }

  // 读、写、删一个键(op 是 StorageOp)；写入的值要能存成 JSON；id 或操作不对时抛出异常
  call(id: string, op: unknown): unknown {
    const file = this.file(id);
    const c = parseOp(op);
    const data = this.load(id);
    if (c.op === 'get') return data[c.key] ?? null;
    const next = { ...data };
    if (c.op === 'set') next[c.key] = JSON.parse(JSON.stringify(c.value ?? null)) as unknown;
    else delete next[c.key];
    const text = JSON.stringify(next);
    if (text.length > DATA_MAX) throw new Error('数据超过 1 MB');
    fs.writeFileSync(file, text);
    this.cache.set(id, next);
    return null;
  }

  removeAll(id: string): void {
    this.cache.delete(id);
    fs.rmSync(this.file(id), { force: true });
  }
}

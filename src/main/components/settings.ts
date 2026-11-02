// 组件设置(ComponentSettings)：从配置文件和预装列表读出来并收窄、按清单给出各组件的设置值、把主窗口的改动并进去。

import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig, isComponentKind, SINGLE_KINDS, type Manifest, type SettingDef } from '../../shared/manifest.ts';
import { DEFAULT_MARKET, type ComponentGroup, type ComponentPatch, type ComponentSettings, type MarketSettings } from '../../shared/types.ts';
import { isObject } from '../../shared/util.ts';
import type { Installed } from './store.ts';

const NAME_MAX = 40;                      // 分组名、显示名的最大长度(字符)
const GROUP_ID = /^[a-z0-9-]{1,32}$/;     // 分组 id 的格式

// secret 类型的设置项
export type SecretDef = Extract<SettingDef, { type: 'secret' }>;

// 配置文件里的组件设置：缺的项用默认值，格式不对的项丢掉；没有 groups 时用预装列表(preinstalledDir 下)的分组
export function readComponents(raw: unknown, preinstalledDir: string): ComponentSettings {
  const o = isObject(raw) ? raw : {};
  const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  const entries = (v: unknown): [string, unknown][] => (isObject(v) ? Object.entries(v) : []);
  return {
    order: ids(o['order']), off: ids(o['off']),
    config: Object.fromEntries(entries(o['config']).filter((e): e is [string, Record<string, unknown>] => isObject(e[1]))),
    removed: ids(o['removed']), dev: ids(o['dev']), devMode: o['devMode'] === true,
    groups: o['groups'] === undefined ? readPreinstalled(preinstalledDir).groups : readGroups(o['groups']), folded: ids(o['folded']),
    names: Object.fromEntries(entries(o['names']).filter((e): e is [string, string] => typeof e[1] === 'string')),
    market: readMarket(o['market']),
  };
}

// 组件市场的设置：仓库只认 http(s) 地址
export function readMarket(v: unknown): MarketSettings {
  const o = isObject(v) ? v : {};
  const registry = typeof o['registry'] === 'string' && /^https?:\/\/\S+$/.test(o['registry']) ? o['registry'] : DEFAULT_MARKET.registry;
  return { registry, scripts: o['scripts'] === true };
}

// 预装列表 preinstalled.json：顶层是组件 id 或 { group, ids } 分组；
// ids 是全部预装组件(按默认顺序)，groups 是首次启动时的分组
export function readPreinstalled(dir: string): { ids: string[]; groups: ComponentGroup[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'preinstalled.json'), 'utf8'));
  } catch {
    return { ids: [], groups: [] };
  }
  const ids: string[] = [];
  const groups: unknown[] = [];
  for (const x of Array.isArray(raw) ? raw : []) {
    if (typeof x === 'string') ids.push(x);
    else if (isObject(x)) {
      const members = Array.isArray(x['ids']) ? x['ids'].filter((i): i is string => typeof i === 'string') : [];
      ids.push(...members);
      groups.push({ id: x['group'], name: x['group'], ids: members });
    }
  }
  return { ids, groups: readGroups(groups) };
}

// 自建分组：id 不重复、名字不空，一个组件只在一个分组里
export function readGroups(v: unknown): ComponentGroup[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const used = new Set<string>();
  const out: ComponentGroup[] = [];
  for (const g of v) {
    if (!isObject(g)) continue;
    const id = typeof g['id'] === 'string' ? g['id'] : '';
    const name = typeof g['name'] === 'string' ? g['name'].trim().slice(0, NAME_MAX) : '';
    if (!GROUP_ID.test(id) || !name || seen.has(id)) continue;
    seen.add(id);
    const ids = Array.isArray(g['ids']) ? g['ids'].filter((x): x is string => typeof x === 'string' && !used.has(x)) : [];
    for (const x of ids) used.add(x);
    out.push({ id, name, ids });
  }
  return out;
}

// secret 存在哪：共用的放在 share:<名字>/value，否则 <组件id>/<key>
export function secretKey(id: string, d: SecretDef): [string, string] {
  return d.share ? [`share:${d.share}`, 'value'] : [id, d.key];
}

// 按设置里的顺序排；没排进顺序的放最后，按 id 排
export function sortByOrder<T extends { manifest: Manifest }>(list: readonly T[], order: readonly string[]): T[] {
  // id → 在顺序里第一次出现的位置
  const at = new Map<string, number>();
  order.forEach((id, i) => { if (!at.has(id)) at.set(id, i); });
  const rank = (id: string): number => at.get(id) ?? Number.MAX_SAFE_INTEGER;
  return [...list].sort((a, b) => rank(a.manifest.id) - rank(b.manifest.id) || a.manifest.id.localeCompare(b.manifest.id));
}

// 全部组件的顺序：设置里的顺序，后面接没排进去的组件
function withAll(order: readonly string[], all: readonly Installed[]): string[] {
  const out = [...order];
  for (const c of sortByOrder(all, order)) if (!out.includes(c.manifest.id)) out.push(c.manifest.id);
  return out;
}

// 组件的设置：默认值上叠保存的值(只认清单里有的非 secret 项)
export function configOf(m: Manifest, s: ComponentSettings): Record<string, unknown> {
  const saved = s.config[m.id] ?? {};
  const out = defaultConfig(m.settings);
  for (const d of m.settings) {
    if (d.type === 'secret' || !(d.key in saved)) continue;
    const v = checkValue(d, saved[d.key]);
    if (v !== undefined) out[d.key] = v;
  }
  return out;
}

// 按设置项类型检查一个值：数字夹在 min / max 内，下拉只收选项里的值；不合格返回 undefined
export function checkValue(d: SettingDef, v: unknown): unknown {
  switch (d.type) {
    case 'toggle': return typeof v === 'boolean' ? v : undefined;
    case 'select': return typeof v === 'string' && (d.custom || d.optionsFrom || d.options.some(o => o.value === v)) ? v : undefined;
    case 'list': {
      if (!Array.isArray(v)) return undefined;
      const keys = d.fields.map(x => x.key);
      const rows = v.filter(isObject);
      return rows.map(r => Object.fromEntries(keys.map(k => [k, typeof r[k] === 'string' ? r[k] : ''])));
    }
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.min(d.max ?? Infinity, Math.max(d.min ?? -Infinity, v));
    case 'tags': {
      // 只留类型对的项，数字要在 min / max 内；重复的只留一个
      if (!Array.isArray(v)) return undefined;
      const ok = v.filter((x: unknown): x is number | string => (d.item === 'number'
        ? typeof x === 'number' && Number.isFinite(x) && x >= (d.min ?? -Infinity) && x <= (d.max ?? Infinity)
        : typeof x === 'string' && x.length > 0));
      return [...new Set(ok)];
    }
    case 'directory':
    case 'audioOutput':
    case 'audioInput':
    case 'text': return typeof v === 'string' ? v : undefined;
    default: return undefined;
  }
}

// 页面发来的改动(IPC 参数)：按 kind 检查各字段的类型，多余的字段丢掉；kind 不认识或字段类型不对时抛出异常。
// groups、market 里面的内容由 readGroups / readMarket 收窄
export function parsePatch(raw: unknown): ComponentPatch {
  const o = isObject(raw) ? raw : {};
  const bad = (): Error => new Error('改动的格式不对');
  const str = (k: string): string => {
    const v = o[k];
    if (typeof v !== 'string') throw bad();
    return v;
  };
  const bool = (k: string): boolean => {
    const v = o[k];
    if (typeof v !== 'boolean') throw bad();
    return v;
  };
  switch (o['kind']) {
    case 'on': return { kind: 'on', id: str('id'), on: bool('on') };
    case 'use': return { kind: 'use', id: str('id') };
    case 'order': {
      const ids = o['ids'];
      if (!Array.isArray(ids) || !ids.every((x): x is string => typeof x === 'string')) throw bad();
      return { kind: 'order', ids };
    }
    case 'configs': {
      const values = o['values'];
      if (!isObject(values)) throw bad();
      return { kind: 'configs', id: str('id'), values };
    }
    case 'devMode': return { kind: 'devMode', on: bool('on') };
    case 'market':
      if (!isObject(o['market'])) throw bad();
      return { kind: 'market', market: readMarket(o['market']) };
    case 'groups':
      if (!Array.isArray(o['groups'])) throw bad();
      return { kind: 'groups', groups: readGroups(o['groups']) };
    case 'fold': return { kind: 'fold', key: str('key'), folded: bool('folded') };
    case 'name': return { kind: 'name', id: str('id'), name: str('name') };
    case 'none': {
      const of = o['of'];
      if (!isComponentKind(of)) throw bad();
      return { kind: 'none', of };
    }
    default: throw bad();
  }
}

// 一个改动 → 新的组件设置；改动不合格时抛出异常
export function applyPatch(s: ComponentSettings, patch: ComponentPatch, all: readonly Installed[]): ComponentSettings {
  const find = (id: string): Installed => {
    const c = all.find(x => x.manifest.id === id);
    if (!c) throw new Error('没有这个组件');
    return c;
  };
  switch (patch.kind) {
    case 'on': {
      find(patch.id);
      const off = s.off.filter(x => x !== patch.id);
      return { ...s, off: patch.on ? off : [...off, patch.id] };
    }
    case 'use': {
      // 单选类别：开着，并排到同类其他组件前面
      const c = find(patch.id);
      if (!SINGLE_KINDS.has(c.manifest.kind)) throw new Error('这个类别可以同时开多个');
      const same = new Set(all.filter(x => x.manifest.kind === c.manifest.kind).map(x => x.manifest.id));
      const order = withAll(s.order, all).filter(x => x !== patch.id);
      const at = order.findIndex(x => same.has(x));
      order.splice(at < 0 ? order.length : at, 0, patch.id);
      return { ...s, order, off: s.off.filter(x => x !== patch.id) };
    }
    case 'none': {
      // 这一类都不用(只能开一个的类别)
      if (!SINGLE_KINDS.has(patch.of)) throw new Error('这个类别可以单独开关');
      const ids = all.filter(x => x.manifest.kind === patch.of).map(x => x.manifest.id);
      return { ...s, off: [...s.off.filter(x => !ids.includes(x)), ...ids] };
    }
    case 'order': {
      // 同类组件的新顺序：按顺序填进这些组件在总顺序里占的位置
      const ids = patch.ids.filter(id => all.some(x => x.manifest.id === id));
      const set = new Set(ids);
      const order = withAll(s.order, all);
      let i = 0;
      return { ...s, order: order.map(x => (set.has(x) ? ids[i++]! : x)) };
    }
    case 'configs': {
      const settings = find(patch.id).manifest.settings;
      const next = { ...s.config[patch.id] };
      for (const [key, value] of Object.entries(patch.values)) {
        const def = settings.find(d => d.key === key);
        if (!def || def.type === 'secret') throw new Error(`没有这个设置项：${key}`);
        const v = checkValue(def, value);
        if (v === undefined) throw new Error(`设置的值不对：${key}`);
        next[key] = v;
      }
      return { ...s, config: { ...s.config, [patch.id]: next } };
    }
    case 'devMode':
      return { ...s, devMode: patch.on };
    case 'market':
      return { ...s, market: readMarket(patch.market) };
    case 'groups':
      return { ...s, groups: readGroups(patch.groups) };
    case 'fold': {
      const folded = s.folded.filter(k => k !== patch.key);
      return { ...s, folded: patch.folded ? [...folded, patch.key] : folded };
    }
    case 'name': {
      find(patch.id);
      const names = { ...s.names };
      const name = patch.name.trim().slice(0, NAME_MAX);
      if (name) names[patch.id] = name;
      else delete names[patch.id];
      return { ...s, names };
    }
    default: {
      // 类型上到不了；运行时遇到没经 parsePatch 的 kind 时不返回 undefined
      const rest: never = patch;
      throw new Error(`不认识的改动：${JSON.stringify(rest)}`);
    }
  }
}

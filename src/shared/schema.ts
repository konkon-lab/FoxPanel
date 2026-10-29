// 组件设置的声明：component.json 的 config 是 Schema 节点(type / dict / list / inner / meta)，
// 这里校验它并转成一组设置项和分节。配置存成一层，各节的键合在一起。

import type { Locale } from './types.ts';
import { isLocale, isObject } from './util.ts';

// 文案：一个字符串，或按界面语言分的多份
export type Text = string | Partial<Record<Locale, string>>;

export type SettingValue = string | number | boolean;

interface SettingBase {
  key: string;
  label: Text;                                  // 名字(meta.description)
  description?: Text;                           // 名字下面的一行说明(meta.hint)
  visible?: Record<string, SettingValue[]>;     // 这些设置等于这些值时才显示
}

// 下拉的选项另外取自一个 list 设置的各行：value / label / sub 是那个表格里的列，sub 那一列显示成选项旁的小字
export interface OptionsFrom {
  setting: string;
  value: string;
  label: string;
  sub?: string;
}

export type SettingDef =
  | SettingBase & { type: 'toggle'; default: boolean }
  | SettingBase & {
    type: 'select'; default: string; options: { value: string; label: Text }[];
    custom?: boolean;             // 也能直接输入选项以外的值
    radio?: boolean;              // role: radio，画成分段按钮
    optionsFrom?: OptionsFrom;
  }
  | SettingBase & { type: 'number'; default: number; min?: number; max?: number; step?: number; slider?: boolean }   // slider：role: slider，画成滑块
  | SettingBase & { type: 'text'; default: string }
  | SettingBase & { type: 'list'; default: Record<string, string>[]; fields: { key: string; label: Text }[] }   // 多行表格，每行几个文字字段
  | SettingBase & { type: 'tags'; item: 'number' | 'string'; default: (number | string)[]; min?: number; max?: number }   // 数字或文字的列表
  | SettingBase & { type: 'audioOutput' | 'audioInput'; default: '' }                                          // 音频设备 deviceId，空 = 系统默认
  | SettingBase & { type: 'directory'; default: string }                                                     // 数据文件夹里的一个文件夹(相对路径，/ 分隔)
  | SettingBase & { type: 'secret'; share?: string };   // share：同名的 secret 几个组件共用一份

// 一节设置：title 没有时第一节叫「基础设置」
export interface ConfigSection {
  title?: Text;
  keys: string[];
}

export interface ParsedConfig {
  settings: SettingDef[];
  sections: ConfigSection[];
}

// 设置的键、表格的列、用量名：字母开头的标识符
export const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
// 服务名、共用 secret 的名字：小写字母、数字和 -
export const SLUG = /^[a-z0-9-]+$/;

export const isText = (v: unknown): v is Text =>
  (typeof v === 'string' && v.length > 0) ||
  (isObject(v) && Object.keys(v).length > 0 && Object.entries(v).every(([k, s]) => isLocale(k) && typeof s === 'string'));

type Node = Record<string, unknown>;

const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isValue = (v: unknown): v is SettingValue => typeof v === 'string' || typeof v === 'boolean' || isFiniteNumber(v);
const isKey = (v: unknown): v is string => typeof v === 'string' && KEY.test(v);
const isTextRow = (v: unknown): v is Record<string, string> => isObject(v) && Object.values(v).every(x => typeof x === 'string');
const metaOf = (node: Node): Node => (isObject(node['meta']) ? node['meta'] : {});

// 记一条错误；这个设置项不合格
const fail = (errors: string[], message: string): null => {
  errors.push(message);
  return null;
};

type Limit = 'min' | 'max' | 'step';

// meta 里写了的 min / max / step 放进 target；有不是数字的就报错并返回 false
function readLimits(target: Partial<Record<Limit, number>>, meta: Node, keys: readonly Limit[], at: string, errors: string[]): boolean {
  for (const k of keys) {
    const n = meta[k];
    if (n === undefined) continue;
    if (!isFiniteNumber(n)) {
      errors.push(`${at}.meta.${k} 要是数字`);
      return false;
    }
    target[k] = n;
  }
  return true;
}

// 以下各种节点的读法：base 是读好的键、名字、说明和显示条件，at 是报错里的位置

function readBoolean(base: SettingBase, meta: Node, at: string, errors: string[]): SettingDef | null {
  const def = meta['default'];
  if (typeof def !== 'boolean') return fail(errors, `${at}.meta.default 要是布尔值`);
  return { ...base, type: 'toggle', default: def };
}

// number：数字框；role: slider 是滑块
function readNumber(base: SettingBase, meta: Node, at: string, errors: string[]): SettingDef | null {
  const def = meta['default'];
  if (!isFiniteNumber(def)) return fail(errors, `${at}.meta.default 要是数字`);
  const out: SettingDef = { ...base, type: 'number', default: def };
  const role = meta['role'];
  if (role === 'slider') {
    if (!isFiniteNumber(meta['min']) || !isFiniteNumber(meta['max'])) return fail(errors, `${at} 的 role: slider 要有 min 和 max`);
    out.slider = true;
  } else if (role !== undefined) return fail(errors, `${at}.meta.role 要是 slider`);
  return readLimits(out, meta, ['min', 'max', 'step'], at, errors) ? out : null;
}

// string：文字框；role 为 secret / audioOutput / audioInput / directory 时是密钥、音频设备、文件夹
function readString(base: SettingBase, meta: Node, at: string, errors: string[]): SettingDef | null {
  const role = meta['role'];
  if (role === 'secret') {
    const share = meta['share'];
    if (share === undefined) return { ...base, type: 'secret' };
    if (typeof share !== 'string' || !SLUG.test(share)) return fail(errors, `${at}.meta.share 只用小写字母、数字和 -`);
    return { ...base, type: 'secret', share };
  }
  if (role === 'audioOutput' || role === 'audioInput') return { ...base, type: role, default: '' };
  if (role !== undefined && role !== 'directory') return fail(errors, `${at}.meta.role 要是 secret / audioOutput / audioInput / directory`);
  const def = meta['default'];
  if (typeof def !== 'string') return fail(errors, `${at}.meta.default 要是字符串`);
  return { ...base, type: role === 'directory' ? 'directory' : 'text', default: def };
}

// union 的一个选项：{ type: "const", value: 字符串 }，没写名字时显示值
function readOption(o: unknown): { value: string; label: Text } | null {
  if (!isObject(o) || o['type'] !== 'const' || typeof o['value'] !== 'string') return null;
  const name = metaOf(o)['description'];
  return { value: o['value'], label: isText(name) ? name : o['value'] };
}

function readOptionsFrom(from: unknown): OptionsFrom | null {
  if (!isObject(from)) return null;
  const { setting, value, label, sub } = from;
  if (!isKey(setting) || !isKey(value) || !isKey(label) || (sub !== undefined && !isKey(sub))) return null;
  return sub === undefined ? { setting, value, label } : { setting, value, label, sub };
}

// union：下拉；role: radio 是分段按钮
function readUnion(base: SettingBase, node: Node, meta: Node, at: string, errors: string[]): SettingDef | null {
  const list: unknown[] = Array.isArray(node['list']) ? node['list'] : [];
  const options = list.map(readOption).filter(o => o !== null);
  if (!options.length || options.length !== list.length) return fail(errors, `${at}.list 每项要是 { type: "const", value: 字符串 }`);
  const def = meta['default'];
  const custom = meta['custom'] === true;
  if (typeof def !== 'string' || (!custom && !options.some(o => o.value === def))) return fail(errors, `${at}.meta.default 要是 list 里的值`);
  const out: SettingDef = { ...base, type: 'select', default: def, options };
  if (custom) out.custom = true;
  const role = meta['role'];
  if (role === 'radio') out.radio = true;
  else if (role !== undefined) return fail(errors, `${at}.meta.role 要是 radio`);
  if (meta['optionsFrom'] !== undefined) {
    const from = readOptionsFrom(meta['optionsFrom']);
    if (!from) return fail(errors, `${at}.meta.optionsFrom 要是 { setting, value, label, sub? }`);
    out.optionsFrom = from;
  }
  return out;
}

// array：inner 是 object 时是多行表格(dict 的每项是一列文字)，是 number / string 时是数字或文字的列表
function readArray(base: SettingBase, node: Node, meta: Node, at: string, errors: string[]): SettingDef | null {
  const inner = node['inner'];
  if (!isObject(inner)) return fail(errors, `${at}.inner 缺少`);
  const def = meta['default'] ?? [];
  if (!Array.isArray(def)) return fail(errors, `${at}.meta.default 要是数组`);
  const rows: unknown[] = def;
  const item = inner['type'];
  if (item === 'object') {
    const columns = isObject(inner['dict']) ? Object.entries(inner['dict']) : [];
    const fields = columns.flatMap(([key, column]) => {
      const label = KEY.test(key) && isObject(column) && column['type'] === 'string' ? metaOf(column)['description'] : undefined;
      return isText(label) ? [{ key, label }] : [];
    });
    if (!fields.length || fields.length !== columns.length) return fail(errors, `${at}.inner.dict 每项要是带 description 的 string`);
    if (!rows.every(isTextRow)) return fail(errors, `${at}.meta.default 要是文字字段的行`);
    return { ...base, type: 'list', default: rows, fields };
  }
  if (item === 'number' || item === 'string') {
    const isItem = (x: unknown): x is number | string => (item === 'number' ? isFiniteNumber(x) : typeof x === 'string');
    if (!rows.every(isItem)) return fail(errors, `${at}.meta.default 每项要是 ${item}`);
    const out: SettingDef = { ...base, type: 'tags', item, default: rows };
    return readLimits(out, metaOf(inner), ['min', 'max'], `${at}.inner`, errors) ? out : null;
  }
  return fail(errors, `${at}.inner.type 要是 object / number / string`);
}

// meta.visible：{ 设置键: 值或值的数组 }，单个值也记成数组；格式不对时为 null
function readVisible(visible: unknown): Record<string, SettingValue[]> | null {
  if (!isObject(visible)) return null;
  const out: Record<string, SettingValue[]> = {};
  for (const [key, v] of Object.entries(visible)) {
    const values: unknown[] = Array.isArray(v) ? v : [v];
    if (!KEY.test(key) || !values.length || !values.every(isValue)) return null;
    out[key] = values;
  }
  return out;
}

// 一个设置项：各种节点都有的 meta(名字、说明、显示条件)在这里读，其余按节点类型分给上面的函数
function readField(key: string, node: unknown, at: string, errors: string[]): SettingDef | null {
  if (!KEY.test(key)) return fail(errors, `${at} 的键要是字母开头的标识符`);
  if (!isObject(node)) return fail(errors, `${at} 不是对象`);
  const meta = metaOf(node);
  const label = meta['description'];
  if (!isText(label)) return fail(errors, `${at}.meta.description 缺少或格式不对`);
  const base: SettingBase = { key, label };
  const hint = meta['hint'];
  if (hint !== undefined) {
    if (!isText(hint)) errors.push(`${at}.meta.hint 格式不对`);
    else base.description = hint;
  }
  if (meta['visible'] !== undefined) {
    const visible = readVisible(meta['visible']);
    if (!visible) errors.push(`${at}.meta.visible 要是 { 设置键: 值或值的数组 }`);
    else base.visible = visible;
  }
  switch (node['type']) {
    case 'boolean': return readBoolean(base, meta, at, errors);
    case 'number': return readNumber(base, meta, at, errors);
    case 'string': return readString(base, meta, at, errors);
    case 'union': return readUnion(base, node, meta, at, errors);
    case 'array': return readArray(base, node, meta, at, errors);
    default: return fail(errors, `${at}.type 要是 boolean / number / string / union / array`);
  }
}

// 一节：object 节点
function readSection(node: unknown, at: string, errors: string[], out: ParsedConfig): void {
  if (!isObject(node) || node['type'] !== 'object' || !isObject(node['dict'])) {
    errors.push(`${at} 要是 { type: "object", dict: { … } }`);
    return;
  }
  const title = metaOf(node)['description'];
  if (title !== undefined && !isText(title)) errors.push(`${at}.meta.description 格式不对`);
  const section: ConfigSection = { keys: [] };
  if (isText(title)) section.title = title;
  for (const [key, field] of Object.entries(node['dict'])) {
    const def = readField(key, field, `${at}.dict.${key}`, errors);
    if (!def) continue;
    if (out.settings.some(d => d.key === key)) {
      errors.push(`config 里的键 ${key} 重复`);
      continue;
    }
    out.settings.push(def);
    section.keys.push(key);
  }
  out.sections.push(section);
}

// 校验 config：object(一节)或 intersect(多节)；没写时没有设置
export function parseConfig(raw: unknown, errors: string[]): ParsedConfig {
  const out: ParsedConfig = { settings: [], sections: [] };
  if (raw === undefined) return out;
  if (isObject(raw) && raw['type'] === 'intersect') {
    const list = raw['list'];
    if (!Array.isArray(list) || !list.length) errors.push('config.list 要是 object 的数组');
    else list.forEach((s: unknown, i) => readSection(s, `config.list[${i}]`, errors, out));
  } else readSection(raw, 'config', errors, out);
  for (const d of out.settings) {
    for (const k of Object.keys(d.visible ?? {})) if (!out.settings.some(x => x.key === k)) errors.push(`${d.key} 的 visible 用了不存在的设置 ${k}`);
    if (d.type === 'select' && d.optionsFrom && !out.settings.some(x => x.key === d.optionsFrom?.setting && x.type === 'list')) errors.push(`${d.key} 的 optionsFrom 要指向一个表格设置`);
  }
  out.sections = out.sections.filter(s => s.keys.length);
  return out;
}

// 各设置的默认值；secret 不在这里
export function defaultConfig(settings: readonly SettingDef[]): Record<string, unknown> {
  return Object.fromEntries(settings.flatMap(s => (s.type === 'secret' ? [] : [[s.key, s.default]])));
}

// 设置项是否显示：visible 里的设置都等于给的值之一
export function isVisible(d: SettingDef, values: Readonly<Record<string, unknown>>): boolean {
  return Object.entries(d.visible ?? {}).every(([k, vs]) => vs.includes(values[k] as SettingValue));
}

// 输入语言：语言组件(kind: lang)清单里 ime 字段的校验，当前语言和模式，用到的 rime 方案。

import type { ImeDef, ImePack, Labels, PackMode, Text, UiLang } from '@konkon-lab/foxpanel-sdk';
import { isObject } from '../../_shared/util.ts';
import { HANGUL_KEYS } from './hangul.ts';

// 四叶草拼音：搜狗词库导入到它的用户词库
export const PINYIN_SCHEMA = 'clover';

// 一种语言都没有时用：直接打字母
export const FALLBACK_PACK: ImePack = {
  id: '', name: 'ABC', short: 'A', lang: 'en', engine: 'rime', schema: '', enter: 'raw', latin: false,
  modes: [{ id: 'direct', direct: true, label: 'ABC' }],
};

// 这个语言当前的模式：没存过或不认识时用第一个
export function modeOf(pack: ImePack, modes: Readonly<Record<string, string>>): PackMode {
  const id = modes[pack.id];
  return pack.modes.find(m => m.id === id) ?? pack.modes[0]!;
}

// 当前语言：没有或关掉时用第一个开着的
export function currentPack(on: readonly ImePack[], lang: string): ImePack {
  return on.find(p => p.id === lang) ?? on[0] ?? FALLBACK_PACK;
}

// 日志、报错和 short 的默认值用的名字(简体中文优先，没有用第一个)
export const nameOf = (t: Text): string => (typeof t === 'string' ? t : t['zh-Hans'] ?? Object.values(t)[0] ?? '');

// 用到的全部 rime 方案
export const schemasOf = (p: ImeDef): string[] => (p.engine === 'rime' ? [...new Set([p.schema, ...p.modes.flatMap(m => (m.schema ? [m.schema] : []))])] : []);

// ---------- 校验 ----------

const MODE_ID = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const SCHEMA_ID = /^[A-Za-z0-9_.-]{1,64}$/;
// 界面语言(SDK 只给类型，名单在这里另写一份)
const UI_LANGS: readonly UiLang[] = ['zh-Hans', 'zh-Hant', 'ja', 'en', 'ko'];

// 可以不写的字符串字段
function opt(o: Record<string, unknown>, key: string, at: string): string | undefined {
  const v = o[key];
  if (v !== undefined && typeof v !== 'string') throw new Error(`${at}${key} 要是字符串`);
  return v;
}

// 必须有的字符串字段
function str(o: Record<string, unknown>, key: string, at: string): string {
  const v = opt(o, key, at);
  if (v === undefined) throw new Error(`${at}${key} 要是字符串`);
  return v;
}

function schemaId(s: string): string {
  if (!SCHEMA_ID.test(s)) throw new Error(`方案名 ${s} 不对`);
  return s;
}

// 检查清单的 ime 字段(方案文件在不在由 langs.ts 查)；name = 组件名，用来补 short 和默认模式。不对时抛出带原因的 Error
export function parseIme(raw: unknown, name: Text): ImeDef {
  const at = 'ime.';
  if (!isObject(raw)) throw new Error('ime 要是对象');
  const engine = opt(raw, 'engine', at) ?? 'rime';
  if (engine !== 'rime' && engine !== 'hangul') throw new Error('ime.engine 只能是 rime 或 hangul');
  const schema = engine === 'rime' ? schemaId(str(raw, 'schema', at)) : '';
  const short = (opt(raw, 'short', at) ?? [...nameOf(name)][0] ?? '').trim();
  if (!short || [...short].length > 4) throw new Error('ime.short 要有 1–4 个字');
  const modesRaw = raw['modes'] ?? [];
  if (!Array.isArray(modesRaw)) throw new Error('ime.modes 要是列表');
  const modes = modesRaw.map((m: unknown, i) => parseMode(m, i));
  if (new Set(modes.map(m => m.id)).size !== modes.length) throw new Error('ime.modes 里有重复的 id');
  const enter = opt(raw, 'enter', at) ?? 'raw';
  if (enter !== 'raw' && enter !== 'rime') throw new Error('ime.enter 只能是 raw 或 rime');
  const latin = raw['latin'] ?? false;
  if (typeof latin !== 'boolean') throw new Error('ime.latin 要是 true / false');
  const def: ImeDef = {
    short, schema, enter, latin, engine, lang: opt(raw, 'lang', at) ?? 'und',
    modes: modes.length ? modes : [{ id: 'default', label: name }],
  };
  if (raw['keycaps'] !== undefined) def.keycaps = parseKeycaps(raw['keycaps']);
  else if (engine === 'hangul') def.keycaps = HANGUL_KEYS;
  return def;
}

function parseMode(m: unknown, i: number): PackMode {
  const at = `ime.modes 第 ${i + 1} 个`;
  if (!isObject(m)) throw new Error(`${at}不是对象`);
  const id = str(m, 'id', at);
  if (!MODE_ID.test(id)) throw new Error(`${at}的 id 不对`);
  const mode: PackMode = { id, label: parseLabels(m['label'], at) };
  const key = opt(m, 'key', at);
  if (key !== undefined) {
    if (!key.trim() || [...key.trim()].length > 2) throw new Error(`${at}的 key 要 1–2 个字`);
    mode.key = key.trim();
  }
  const schema = opt(m, 'schema', at);
  if (schema !== undefined) mode.schema = schemaId(schema);
  const sw = m['switches'];
  if (sw !== undefined) {
    if (!isObject(sw) || !Object.values(sw).every(v => typeof v === 'boolean')) throw new Error(`${at}的 switches 要是 开关名: true / false`);
    mode.switches = sw as Record<string, boolean>;
  }
  if (m['direct'] !== undefined) {
    if (typeof m['direct'] !== 'boolean') throw new Error(`${at}的 direct 要是 true / false`);
    if (m['direct']) mode.direct = true;
  }
  const output = opt(m, 'output', at);
  if (output !== undefined) {
    if (output !== 'composition' && output !== 'katakana') throw new Error(`${at}的 output 只能是 composition 或 katakana`);
    mode.output = output;
  }
  const lang = opt(m, 'lang', at);
  if (lang !== undefined) mode.lang = lang;
  return mode;
}

function parseLabels(l: unknown, at: string): Labels {
  if (typeof l === 'string' && l.trim()) return l.trim();
  if (isObject(l)) {
    const out: Partial<Record<UiLang, string>> = {};
    for (const k of UI_LANGS) {
      const v = l[k];
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    }
    if (Object.keys(out).length) return out;
  }
  throw new Error(`${at}要有 label`);
}

function parseKeycaps(k: unknown): Record<string, readonly [string, string?]> {
  if (!isObject(k)) throw new Error('ime.keycaps 要是 字母: [平时, Shift]');
  const out: Record<string, readonly [string, string?]> = {};
  for (const [letter, v] of Object.entries(k)) {
    const ok = /^[a-z]$/.test(letter) && Array.isArray(v) && v.length >= 1 && v.length <= 2 && v.every(x => typeof x === 'string' && x);
    if (!ok) throw new Error(`ime.keycaps 的 ${letter} 不对`);
    const [a, b] = v as string[];
    out[letter] = b ? [a!, b] : [a!];
  }
  return out;
}

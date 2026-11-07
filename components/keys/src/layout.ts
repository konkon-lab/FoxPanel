// 键盘布局 JSON(布局组件的 layout.json)：行和键的格式和校验；按键渲染按它画键。

import type { KeyCode } from '@konkon-lab/foxpanel-sdk';
import { isKeyCode } from '../../_shared/keyboard.ts';
import { isObject } from '../../_shared/util.ts';

// 在页面里处理、不发给输入法的键
const FN_KEYS = ['shift', 'caps', 'pgup', 'pgdn', 'lang', 'mode'] as const;
export type FnKey = typeof FN_KEYS[number];

export interface KeyDef {
  id: string;
  units: number;                   // 宽度(u)，不写为 1
  code?: KeyCode;                  // 发给输入法的键位
  fn?: FnKey;                      // 在页面里处理的键
  letter?: string;                 // 字母键(小写)：Shift / Caps 换大写；语言包有键帽时印键帽
  dual?: [string, string];         // [平时, Shift] 印在键上，按下发 code
  text?: [string, string];         // [平时, Shift] 按下直接插入，不经过输入法
  label?: string;                  // 功能键上的字
  icon?: 'back' | 'shift';
  repeat?: boolean;                // 按住连发
  spacer?: boolean;                // 空位
}

export interface LayoutDef {
  rows: KeyDef[][];
}

type LayoutResult = { ok: true; layout: LayoutDef } | { ok: false; errors: string[] };

const ROWS_MAX = 12;    // 最多几行
const KEYS_MAX = 40;    // 每行最多几个键
const UNITS_MAX = 20;   // 一个键最宽几 u
const PAIR_MAX = 8;     // dual / text 的每个字符串最多几个字符(UTF-16)

const isFn = (v: unknown): v is FnKey => (FN_KEYS as readonly unknown[]).includes(v);
const isPair = (v: unknown): v is [string, string] => Array.isArray(v) && v.length === 2 && v.every(x => typeof x === 'string' && x.length > 0 && x.length <= PAIR_MAX);

function readKey(raw: unknown, at: string, errors: string[]): KeyDef | null {
  if (!isObject(raw)) return errors.push(`${at} 不是对象`), null;
  const id = raw['id'];
  if (typeof id !== 'string' || !id) return errors.push(`${at} 缺 id`), null;
  const units = raw['units'] ?? 1;
  if (typeof units !== 'number' || !(units > 0) || units > UNITS_MAX) return errors.push(`${at}(${id}) 的 units 要是 0–${UNITS_MAX} 的数`), null;
  const key: KeyDef = { id, units };
  if (raw['spacer'] === true) return { ...key, spacer: true };
  const { code, fn, letter, dual, text, label, icon, repeat } = raw;
  if (code !== undefined) {
    if (!isKeyCode(code)) return errors.push(`${at}(${id}) 的 code 不认识：${String(code)}`), null;
    key.code = code;
  }
  if (fn !== undefined) {
    if (!isFn(fn)) return errors.push(`${at}(${id}) 的 fn 要是 ${FN_KEYS.join(' / ')}`), null;
    key.fn = fn;
  }
  if (text !== undefined) {
    if (!isPair(text)) return errors.push(`${at}(${id}) 的 text 要是 [平时, Shift] 两个字符串`), null;
    key.text = text;
  }
  if ([key.code, key.fn, key.text].filter(x => x !== undefined).length !== 1) return errors.push(`${at}(${id}) 要有 code、text、fn 之一(只能一个)`), null;
  if (letter !== undefined) {
    if (typeof letter !== 'string' || !/^[a-z]$/.test(letter)) return errors.push(`${at}(${id}) 的 letter 要是一个小写字母`), null;
    key.letter = letter;
  }
  if (dual !== undefined) {
    if (!isPair(dual)) return errors.push(`${at}(${id}) 的 dual 要是 [平时, Shift] 两个字符串`), null;
    key.dual = dual;
  }
  if (label !== undefined) {
    if (typeof label !== 'string') return errors.push(`${at}(${id}) 的 label 要是字符串`), null;
    key.label = label;
  }
  if (icon !== undefined) {
    if (icon !== 'back' && icon !== 'shift') return errors.push(`${at}(${id}) 的 icon 要是 back / shift`), null;
    key.icon = icon;
  }
  if (repeat === true) key.repeat = true;
  return key;
}

// 校验 layout.json 的内容
export function parseLayout(raw: unknown): LayoutResult {
  const errors: string[] = [];
  const rows = isObject(raw) ? raw['rows'] : undefined;
  if (!Array.isArray(rows) || !rows.length || rows.length > ROWS_MAX) return { ok: false, errors: [`rows 要是 1–${ROWS_MAX} 行`] };
  const out: KeyDef[][] = [];
  rows.forEach((row: unknown, r) => {
    if (!Array.isArray(row) || !row.length || row.length > KEYS_MAX) return void errors.push(`第 ${r + 1} 行要有 1–${KEYS_MAX} 个键`);
    const keys = row.map((k: unknown, i) => readKey(k, `第 ${r + 1} 行第 ${i + 1} 个键`, errors)).filter((k): k is KeyDef => k !== null);
    if (new Set(keys.map(k => k.id)).size !== keys.length) errors.push(`第 ${r + 1} 行有重复的 id`);
    out.push(keys);
  });
  return errors.length ? { ok: false, errors } : { ok: true, layout: { rows: out } };
}

// 最宽一行的宽度(u)
export const layoutWidth = (l: LayoutDef): number => Math.max(...l.rows.map(r => r.reduce((s, k) => s + k.units, 0)));

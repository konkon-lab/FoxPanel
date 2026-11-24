// 预装组件共用的键盘约定：键位的判断，输入框空着时按键的通知(频道名和数据的收窄)。

import type { IdleKey, IdleKeyNotice, KeyCode } from '@konkon-lab/foxpanel-sdk';
import { isObject } from './util.ts';

// 字母和数字以外的键位；和 KeyCode 对不上(多了或少了)时类型检查不过
const NAMED: Readonly<Record<Exclude<KeyCode, `Key${string}` | `Digit${number}`>, true>> = {
  Backquote: true, Minus: true, Equal: true, BracketLeft: true, BracketRight: true, Backslash: true, Semicolon: true, Quote: true, Comma: true, Period: true, Slash: true,
  Space: true, Backspace: true, Delete: true, Tab: true, Enter: true, Home: true, ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true,
};

// v 是键位：布局 JSON 的 code、页面发来的按键操作都用它收窄
export const isKeyCode = (v: unknown): v is KeyCode => typeof v === 'string' && (/^(Key[A-Z]|Digit[0-9])$/.test(v) || Object.hasOwn(NAMED, v));

// 总线频道：输入法组件 → 别的组件，输入框空着时按了退格或方向键(IdleKeyNotice)
export const IDLE_KEY = 'yanuo.ime/idle-key';

const IDLE_KEYS: readonly unknown[] = ['Backspace', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] satisfies IdleKey[];
// v 是输入框空着时要通知出去的键
export const isIdleKey = (v: unknown): v is IdleKey => IDLE_KEYS.includes(v);

// IDLE_KEY 频道的数据(总线是公共的，别的组件也能往这个频道发)；格式不对返回 null
export function parseIdleKey(v: unknown): IdleKeyNotice | null {
  if (!isObject(v)) return null;
  const { key, repeat } = v;
  return isIdleKey(key) && typeof repeat === 'boolean' ? { key, repeat } : null;
}

// 预装组件共用的键盘约定：键位的判断。

import type { KeyCode } from '@konkon-lab/foxpanel-sdk';

// 字母和数字以外的键位；和 KeyCode 对不上(多了或少了)时类型检查不过
const NAMED: Readonly<Record<Exclude<KeyCode, `Key${string}` | `Digit${number}`>, true>> = {
  Backquote: true, Minus: true, Equal: true, BracketLeft: true, BracketRight: true, Backslash: true, Semicolon: true, Quote: true, Comma: true, Period: true, Slash: true,
  Space: true, Backspace: true, Delete: true, Tab: true, Enter: true, Home: true, ArrowLeft: true, ArrowRight: true, ArrowUp: true, ArrowDown: true,
};

// v 是键位：布局 JSON 的 code、页面发来的按键操作都用它收窄
export const isKeyCode = (v: unknown): v is KeyCode => typeof v === 'string' && (/^(Key[A-Z]|Digit[0-9])$/.test(v) || Object.hasOwn(NAMED, v));

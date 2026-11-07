// 键位 → 字符。字母、数字、符号键各有平时 / Shift 两个字符，和标准美式键盘一致。

import type { KeyCode } from '@konkon-lab/foxpanel-sdk';

// [平时字符, Shift 字符]
const SYMBOLS: Readonly<Partial<Record<KeyCode, readonly [string, string]>>> = {
  Digit1: ['1', '!'], Digit2: ['2', '@'], Digit3: ['3', '#'], Digit4: ['4', '$'], Digit5: ['5', '%'],
  Digit6: ['6', '^'], Digit7: ['7', '&'], Digit8: ['8', '*'], Digit9: ['9', '('], Digit0: ['0', ')'],
  Backquote: ['`', '~'], Minus: ['-', '_'], Equal: ['=', '+'], BracketLeft: ['[', '{'], BracketRight: [']', '}'],
  Backslash: ['\\', '|'], Semicolon: [';', ':'], Quote: ["'", '"'], Comma: [',', '<'], Period: ['.', '>'], Slash: ['/', '?'],
};

export interface KeyMeaning {
  char: string;       // 这个键打出的字符(字母键也是交给 rime 的键名)
  letter: boolean;
  digit: boolean;     // 没按 Shift 的数字键
}

// 可打字的键；功能键(退格、方向等)返回 null
export function keyMeaning(code: KeyCode, shift: boolean): KeyMeaning | null {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (letter) return { char: shift ? letter : letter.toLowerCase(), letter: true, digit: false };
  if (code === 'Space') return { char: ' ', letter: false, digit: false };
  const s = SYMBOLS[code];
  if (!s) return null;
  return { char: shift ? s[1] : s[0], letter: false, digit: !shift && code.startsWith('Digit') };
}

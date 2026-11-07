// 键盘设置(存在输入法组件的数据里)：默认值、读进来时的校验。

import type { KeyboardSettings } from '@konkon-lab/foxpanel-sdk';
import { isObject } from '../../_shared/util.ts';

export const DEFAULT_KEYBOARD: KeyboardSettings = {
  showTyping: true, autoSend: false, pinMessage: false, lang: 'yanuo.lang-zh', modes: {},
};

const SWITCHES = ['showTyping', 'autoSend', 'pinMessage'] as const;

// 设置(或设置的补丁)里格式对的项，其余丢掉；modes 里不是字符串的项丢掉。
// 语言和模式对不对得上现有的语言由键盘服务检查
export function parseSettings(raw: unknown): Partial<KeyboardSettings> {
  if (!isObject(raw)) return {};
  const out: Partial<KeyboardSettings> = {};
  for (const key of SWITCHES) {
    const v = raw[key];
    if (typeof v === 'boolean') out[key] = v;
  }
  const { lang, modes } = raw;
  if (typeof lang === 'string' && lang) out.lang = lang;
  if (isObject(modes)) out.modes = Object.fromEntries(Object.entries(modes).filter((e): e is [string, string] => typeof e[1] === 'string'));
  return out;
}

// 完整的设置：raw 里格式对的项盖在 base 上
export const normalizeKeyboard = (raw: unknown, base: KeyboardSettings = DEFAULT_KEYBOARD): KeyboardSettings => ({ ...base, ...parseSettings(raw) });

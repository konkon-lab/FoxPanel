// 键盘面板里的部件和别的组件发来的操作(KeyboardAction)：核心不看内容，各字段在这里收窄。

import type { KeyboardAction } from '@konkon-lab/foxpanel-sdk';
import { isKeyCode } from '../../_shared/keyboard.ts';
import { isObject } from '../../_shared/util.ts';
import { parseSettings } from './settings.ts';

// 文字里的位置：有限的数(落在字素中间、超出范围的由输入框对齐)
const isPosition = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

// 格式对的操作；kind 不认识或字段类型不对时返回 null。按键的 repeat 只有为真时留着；settings 的补丁只留格式对的项
export function parseAction(raw: unknown): KeyboardAction | null {
  if (!isObject(raw)) return null;
  const { kind, code, shift, text, index, position, start, end, id, on, lang, mode } = raw;
  switch (kind) {
    case 'key':
      if (!isKeyCode(code) || typeof shift !== 'boolean') return null;
      return raw['repeat'] === true ? { kind, code, shift, repeat: true } : { kind, code, shift };
    case 'text': return typeof text === 'string' ? { kind, text } : null;
    case 'select': return typeof index === 'number' && Number.isInteger(index) && index >= 0 ? { kind, index } : null;
    case 'caret': return isPosition(position) ? { kind, position } : null;
    case 'range': return isPosition(start) && isPosition(end) ? { kind, start, end } : null;
    case 'paste': case 'copy': case 'clear': case 'send': case 'dictate': case 'clearOutputs': return { kind };
    case 'output': return typeof id === 'string' && typeof on === 'boolean' ? { kind, id, on } : null;
    case 'lang':
      if (typeof lang !== 'string' || (mode !== undefined && typeof mode !== 'string')) return null;
      return mode === undefined ? { kind, lang } : { kind, lang, mode };
    case 'settings': return isObject(raw['patch']) ? { kind, patch: parseSettings(raw['patch']) } : null;
    default: return null;
  }
}

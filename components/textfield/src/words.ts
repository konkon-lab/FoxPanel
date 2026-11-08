// 输入框上的文字，按界面语言分。

import type { UiLang } from '@konkon-lab/foxpanel-sdk';

export const TEXT = {
  'zh-Hans': { clear: '清空', copy: '复制', dictate: '语音输入', send: '发送' },
  'zh-Hant': { clear: '清空', copy: '複製', dictate: '語音輸入', send: '傳送' },
  ja: { clear: 'クリア', copy: 'コピー', dictate: '音声入力', send: '送信' },
  en: { clear: 'Clear', copy: 'Copy', dictate: 'Voice input', send: 'Send' },
  ko: { clear: '지우기', copy: '복사', dictate: '음성 입력', send: '전송' },
} satisfies Record<UiLang, Record<string, string>>;

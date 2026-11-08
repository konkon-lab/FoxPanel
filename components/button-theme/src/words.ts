// 日夜切换按钮上的文字，按界面语言分。

import type { UiLang } from '@konkon-lab/foxpanel-sdk';

export const TEXT = {
  'zh-Hans': { dark: '切换深色', light: '切换浅色' },
  'zh-Hant': { dark: '切換深色', light: '切換淺色' },
  ja: { dark: 'ダークに切替', light: 'ライトに切替' },
  en: { dark: 'Dark mode', light: 'Light mode' },
  ko: { dark: '다크 모드', light: '라이트 모드' },
} satisfies Record<UiLang, Record<string, string>>;

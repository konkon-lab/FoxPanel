// 粘贴按钮上的文字，按界面语言分。

import type { UiLang } from '@konkon-lab/foxpanel-sdk';

export const TEXT = {
  'zh-Hans': { paste: '粘贴' },
  'zh-Hant': { paste: '貼上' },
  ja: { paste: '貼り付け' },
  en: { paste: 'Paste' },
  ko: { paste: '붙여넣기' },
} satisfies Record<UiLang, Record<string, string>>;

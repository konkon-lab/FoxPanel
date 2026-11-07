// 输入法的页面部分在键盘面板上显示的文字，按界面语言分。

import type { UiLang } from '@konkon-lab/foxpanel-sdk';

export const TEXT = {
  'zh-Hans': { deploying: '输入法部署中…' },
  'zh-Hant': { deploying: '輸入法部署中…' },
  ja: { deploying: '入力エンジン準備中…' },
  en: { deploying: 'Preparing input engine…' },
  ko: { deploying: '입력기 준비 중…' },
} satisfies Record<UiLang, Record<string, string>>;

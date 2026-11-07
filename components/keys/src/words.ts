// 按键渲染上的文字，按界面语言分。

import type { UiLang } from '@konkon-lab/foxpanel-sdk';

export const TEXT = {
  'zh-Hans': { backspace: '退格', space: '空格', lang: '切换语言', mode: '切换模式' },
  'zh-Hant': { backspace: '退格', space: '空格', lang: '切換語言', mode: '切換模式' },
  ja: { backspace: 'バックスペース', space: 'スペース', lang: '言語切替', mode: 'モード切替' },
  en: { backspace: 'Backspace', space: 'Space', lang: 'Switch language', mode: 'Switch mode' },
  ko: { backspace: '백스페이스', space: '스페이스', lang: '언어 전환', mode: '모드 전환' },
} satisfies Record<UiLang, Record<string, string>>;

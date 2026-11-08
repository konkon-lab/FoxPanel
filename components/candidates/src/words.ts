// 候选栏上的文字，按界面语言分。

import type { UiLang } from '@konkon-lab/foxpanel-sdk';

export const TEXT = {
  'zh-Hans': { expand: '展开候选', collapse: '收起候选', prev: '上一页', next: '下一页' },
  'zh-Hant': { expand: '展開候選', collapse: '收起候選', prev: '上一頁', next: '下一頁' },
  ja: { expand: '候補を展開', collapse: '候補を閉じる', prev: '前のページ', next: '次のページ' },
  en: { expand: 'More candidates', collapse: 'Fewer candidates', prev: 'Previous page', next: 'Next page' },
  ko: { expand: '후보 펼치기', collapse: '후보 접기', prev: '이전 페이지', next: '다음 페이지' },
} satisfies Record<UiLang, Record<string, string>>;

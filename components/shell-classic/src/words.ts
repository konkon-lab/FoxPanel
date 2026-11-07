// 经典外壳上的文字，按界面语言分：候选栏、输入框、键区的插槽里没有部件时的提示。

import type { UiLang } from '@konkon-lab/foxpanel-sdk';

// 没有部件时要提示的插槽
export const REQUIRED = ['candidates', 'textfield', 'layout'] as const;
export type RequiredSlot = typeof REQUIRED[number];

export const TEXT = {
  'zh-Hans': { candidates: '缺少候选栏组件', textfield: '缺少输入框组件', layout: '缺少键盘布局组件' },
  'zh-Hant': { candidates: '缺少候選欄元件', textfield: '缺少輸入框元件', layout: '缺少鍵盤配置元件' },
  ja: { candidates: '候補バーコンポーネントがありません', textfield: '入力欄コンポーネントがありません', layout: 'キー配列コンポーネントがありません' },
  en: { candidates: 'No candidate bar component', textfield: 'No text field component', layout: 'No keyboard layout component' },
  ko: { candidates: '후보 막대 구성 요소가 없습니다', textfield: '입력란 구성 요소가 없습니다', layout: '키 배열 구성 요소가 없습니다' },
} satisfies Record<UiLang, Record<RequiredSlot, string>>;

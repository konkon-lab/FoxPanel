// 设置页的三节：常规、外观、更新与关于(节 id、标题、顺序)；经 settings 服务给别的组件登记用。
import type { SettingsSection } from '@konkon-lab/foxpanel-sdk';

export const GENERAL: SettingsSection = {
  id: 'general', order: 0,
  title: { 'zh-Hans': '常规', 'zh-Hant': '一般', ja: '一般', en: 'General', ko: '일반' },
};
export const LOOK: SettingsSection = {
  id: 'look', order: 10,
  title: { 'zh-Hans': '外观', 'zh-Hant': '外觀', ja: '外観', en: 'Appearance', ko: '외관' },
};
export const ABOUT: SettingsSection = {
  id: 'about', order: 90,
  title: { 'zh-Hans': '更新与关于', 'zh-Hant': '更新與關於', ja: '更新と情報', en: 'Updates & About', ko: '업데이트 및 정보' },
};

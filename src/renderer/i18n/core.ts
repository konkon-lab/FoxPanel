// 宿主主窗口自己的文案：没有外壳组件时的提示。
import { defineMessages } from '../../shared/messages.ts';

export default defineMessages({
  'core.noShell': '主窗口外壳组件缺失，主窗口显示失败',
  'core.close': '关闭',
}, {
  'zh-Hant': { 'core.noShell': '主視窗外殼元件缺失，主視窗顯示失敗', 'core.close': '關閉' },
  ja: { 'core.noShell': 'メインウィンドウの外枠コンポーネントがないため、メインウィンドウを表示できません', 'core.close': '閉じる' },
  en: { 'core.noShell': 'The main window shell component is missing, so the main window cannot be shown', 'core.close': 'Close' },
  ko: { 'core.noShell': '메인 창 셸 컴포넌트가 없어 메인 창을 표시할 수 없습니다', 'core.close': '닫기' },
});

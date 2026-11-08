// 快捷设置上的文字，按界面语言分。

import type { UiLang } from '@konkon-lab/foxpanel-sdk';

export const TEXT = {
  'zh-Hans': { showTyping: '输入状态展示', autoSend: '自动送出', pinMessage: 'PIN消息', sendTo: '发送到', clearChatbox: '清除聊天气泡' },
  'zh-Hant': { showTyping: '輸入狀態展示', autoSend: '自動送出', pinMessage: 'PIN訊息', sendTo: '傳送到', clearChatbox: '清除聊天氣泡' },
  ja: { showTyping: '入力状態を表示', autoSend: '自動送信', pinMessage: 'メッセージ固定', sendTo: '送信先', clearChatbox: 'チャットを消去' },
  en: { showTyping: 'Show typing status', autoSend: 'Auto send', pinMessage: 'Pin message', sendTo: 'Send to', clearChatbox: 'Clear chatbox' },
  ko: { showTyping: '입력 상태 표시', autoSend: '자동 전송', pinMessage: '메시지 고정', sendTo: '보낼 곳', clearChatbox: '채팅 지우기' },
} satisfies Record<UiLang, Record<string, string>>;
